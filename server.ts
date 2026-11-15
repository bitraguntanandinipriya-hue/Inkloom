import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createServer as createViteServer } from 'vite';
import type {
  AiProviderId,
  CharacterProfile,
  Chapter,
  ChapterStatus,
  Novel,
  StoryDna,
} from './src/types';
import {
  classifyProviderError,
  discoverModelsForUser,
  estimateCostUsd,
  listAuthorCredentialsPublic,
  PROVIDER_CATALOG_MODELS,
  resolveCredentialForProvider,
  runSingleAiTextCompletion,
  saveAuthorCredential,
  streamAiCompletion,
  testProviderCredential,
} from './server/aiProviders';
import {
  clearSessionCookie,
  completePasswordReset,
  createPasswordResetToken,
  deleteUserAccount,
  issueSessionCookie,
  loginUser,
  registerUser,
  requireAuth,
  serializeUser,
  upsertFirebaseUser,
  verifyFirebaseIdToken,
  verifyGoogleSignIn,
  type AuthenticatedRequest,
} from './server/auth';
import {
  enqueueBackgroundSummaryJob,
  processBackgroundJob,
  runChapterSummaryAndExtraction,
} from './server/backgroundWorker';
import {
  buildThreeLayerContext,
  estimateTokens,
  extractCanonDirectivesFromText,
} from './server/contextBuilder';
import { countWords, db, initDatabase, UPLOADS_DIR } from './server/db';
import { generateDocxExport, generateTxtExport } from './server/exportService';

initDatabase();

const app = express();
app.use(express.json({ limit: '8mb' }));

// Track active streaming requests for genuine server-side cancellation & deduplication
const activeGenerations = new Map<
  string,
  { controller: AbortController; userId: string; status: string }
>();

// Multer setup for JPEG, PNG, WebP uploads into user-isolated disk storage
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.id || 'shared';
      const userDir = path.join(UPLOADS_DIR, userId);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      cb(null, userDir);
    },
    filename: (_req, file, cb) => {
      const ext =
        file.mimetype === 'image/png'
          ? '.png'
          : file.mimetype === 'image/webp'
            ? '.webp'
            : '.jpg';
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are supported.'));
    }
  },
});

function formatNovelRow(row: Record<string, unknown>): Novel {
  let storyDna: StoryDna;
  try {
    storyDna = JSON.parse(String(row.story_dna_json));
  } catch {
    storyDna = {
      narrationLanguage: 'English',
      dialogueLanguages: ['English'],
      mixedLanguageWriting: false,
      romanScriptOnly: false,
      perspective: 'Third Person Limited',
      tense: 'Past Tense',
      pacing: 'Measured',
      contentBoundaries: '',
      writingRules: '',
    };
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    authorName: String(row.author_name || ''),
    genre: String(row.genre),
    synopsis: String(row.synopsis || ''),
    coverImageId: row.cover_image_id ? String(row.cover_image_id) : null,
    status: row.status as Novel['status'],
    completedAt: row.completed_at ? String(row.completed_at) : null,
    trashedAt: row.trashed_at ? String(row.trashed_at) : null,
    storyDna,
    chapterCount: row.chapter_count !== undefined ? Number(row.chapter_count) : undefined,
    totalWordCount: row.total_word_count !== undefined ? Number(row.total_word_count) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function formatChapterRow(row: Record<string, unknown>): Chapter {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    userId: String(row.user_id),
    chapterNumber: Number(row.chapter_number),
    title: String(row.title),
    content: String(row.content || ''),
    prompt: String(row.prompt || ''),
    timelineAnchor: String(row.timeline_anchor || ''),
    locationAnchor: String(row.location_anchor || ''),
    status: (row.status as ChapterStatus) || 'Draft',
    wordCount: Number(row.word_count || 0),
    trashedAt: row.trashed_at ? String(row.trashed_at) : null,
    clientUpdatedAt: String(row.client_updated_at),
    version: Number(row.version || 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    syncState: 'synced',
  };
}

function formatCharacterRow(row: Record<string, unknown>): CharacterProfile {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    userId: String(row.user_id),
    roleType: row.role_type as CharacterProfile['roleType'],
    name: String(row.name),
    age: String(row.age || ''),
    role: String(row.role || ''),
    archetype: String(row.archetype || ''),
    personality: String(row.personality || ''),
    psychologicalTraits: String(row.psychological_traits || ''),
    triggers: String(row.triggers || ''),
    vulnerabilities: String(row.vulnerabilities || ''),
    relationshipDynamics: String(row.relationship_dynamics || ''),
    relationships: String(row.relationships || ''),
    physicalAppearance: String(row.physical_appearance || ''),
    backstory: String(row.backstory || ''),
    characterDevelopment: String(row.character_development || ''),
    status: (row.status as CharacterProfile['status']) || 'Active',
    customStatus: String(row.custom_status || ''),
    location: String(row.location || ''),
    imageId: row.image_id ? String(row.image_id) : null,
    sortOrder: Number(row.sort_order || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function assertNovelOwned(novelId: string, userId: string): Novel {
  const row = db
    .prepare('SELECT * FROM novels WHERE id = ? AND user_id = ?')
    .get(novelId, userId) as Record<string, unknown> | undefined;
  if (!row) {
    throw Object.assign(new Error('Novel not found.'), { statusCode: 404 });
  }
  return formatNovelRow(row);
}

// ============================================================================
// AUTHENTICATION & ACCOUNT ROUTES
// ============================================================================

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    user: req.user,
    googleClientIdConfigured: Boolean(process.env.VITE_GOOGLE_CLIENT_ID?.trim()),
    managedGeminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    googleClientId: process.env.VITE_GOOGLE_CLIENT_ID?.trim() || null,
    managedGeminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };
    const user = await registerUser(email || '', password || '', name || '');
    issueSessionCookie(res, user.id, req);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    const user = await loginUser(email || '', password || '');
    issueSessionCookie(res, user.id, req);
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      res.status(400).json({ error: 'Missing Google ID token.' });
      return;
    }
    const user = await verifyGoogleSignIn(idToken);
    issueSessionCookie(res, user.id, req);
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Google Sign-In failed' });
  }
});

app.post('/api/auth/firebase-session', async (req, res) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      res.status(400).json({ error: 'Missing Firebase ID token.' });
      return;
    }
    const claims = await verifyFirebaseIdToken(idToken);
    const user = upsertFirebaseUser(claims);
    issueSessionCookie(res, user.id, req);
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Firebase authentication failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.post('/api/auth/password-reset/request', (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  const result = createPasswordResetToken(email);
  // In self-hosted/sandbox environments without an outbound SMTP server, return the token
  // clearly marked as local recovery so the user can complete the flow reliably.
  res.json({
    ok: true,
    message: result
      ? 'Password reset token generated. Enter the verification token below to set a new password.'
      : 'If an account matches that email, a reset token has been generated.',
    localResetToken: result?.resetToken || null,
    expiresAt: result?.expiresAt || null,
  });
});

app.post('/api/auth/password-reset/complete', async (req, res) => {
  try {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    await completePasswordReset(token || '', newPassword || '');
    res.json({ ok: true, message: 'Password updated. You may now sign in.' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Reset failed' });
  }
});

app.patch('/api/auth/preferences', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { name, themePreference, editorPrefs, aiPrefs } = req.body as {
    name?: string;
    themePreference?: 'system' | 'light' | 'dark';
    editorPrefs?: Partial<typeof user.editorPrefs>;
    aiPrefs?: Partial<typeof user.aiPrefs>;
  };

  const nextEditor = { ...user.editorPrefs, ...(editorPrefs || {}) };
  const nextAi = { ...user.aiPrefs, ...(aiPrefs || {}) };
  const nextTheme = themePreference || user.themePreference;
  const nextName = name !== undefined ? name.trim() || user.name : user.name;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE users SET name = ?, theme_preference = ?, editor_prefs_json = ?, ai_prefs_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextName, nextTheme, JSON.stringify(nextEditor), JSON.stringify(nextAi), now, user.id);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as never;
  res.json({ user: serializeUser(row) });
});

app.delete('/api/auth/account', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  deleteUserAccount(user.id);
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.post('/api/sync/hydrate', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { novels, bundle } = req.body as {
      novels?: Novel[];
      bundle?: {
        novel: Novel;
        characters?: CharacterProfile[];
        chapters?: Chapter[];
        trashedChapters?: Chapter[];
        canonFacts?: Array<{
          id: string;
          novelId: string;
          factText: string;
          category: string;
          sourceChapterId: string | null;
          approvalStatus: string;
          isPinned: boolean;
          createdAt: string;
          updatedAt: string;
        }>;
        summaries?: Array<{
          id: string;
          novelId: string;
          chapterId: string;
          summaryText: string;
          timelineNote: string;
          locations: string[];
          characters: string[];
          objects: string[];
          revelations: string[];
          createdAt: string;
          updatedAt: string;
        }>;
        scratchpadNotes?: Array<{
          id: string;
          novelId: string;
          title: string;
          content: string;
          category: string;
          createdAt: string;
          updatedAt: string;
        }>;
      };
    };

    const insertNovel = (n: Novel) => {
      db.prepare(
        `INSERT OR IGNORE INTO novels
         (id, user_id, title, author_name, genre, synopsis, cover_image_id, status, completed_at, trashed_at, story_dna_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        n.id,
        userId,
        n.title,
        n.authorName || '',
        n.genre || 'Dark Romance',
        n.synopsis || '',
        n.coverImageId || null,
        n.status || 'active',
        n.completedAt || null,
        n.trashedAt || null,
        JSON.stringify(n.storyDna),
        n.createdAt,
        n.updatedAt
      );
    };

    db.transaction(() => {
      if (Array.isArray(novels)) {
        for (const n of novels) {
          if (n?.id) insertNovel(n);
        }
      }
      if (bundle?.novel?.id) {
        insertNovel(bundle.novel);
        for (const ch of bundle.characters || []) {
          db.prepare(
            `INSERT OR IGNORE INTO characters
             (id, novel_id, user_id, role_type, name, age, role, archetype, personality, psychological_traits, triggers, vulnerabilities, relationship_dynamics, relationships, physical_appearance, backstory, character_development, status, custom_status, location, image_id, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            ch.id,
            bundle.novel.id,
            userId,
            ch.roleType,
            ch.name,
            ch.age || '',
            ch.role || '',
            ch.archetype || '',
            ch.personality || '',
            ch.psychologicalTraits || '',
            ch.triggers || '',
            ch.vulnerabilities || '',
            ch.relationshipDynamics || '',
            ch.relationships || '',
            ch.physicalAppearance || '',
            ch.backstory || '',
            ch.characterDevelopment || '',
            ch.status || 'Active',
            ch.customStatus || '',
            ch.location || '',
            ch.imageId || null,
            ch.sortOrder || 0,
            ch.createdAt,
            ch.updatedAt
          );
        }
        for (const chap of [...(bundle.chapters || []), ...(bundle.trashedChapters || [])]) {
          db.prepare(
            `INSERT OR IGNORE INTO chapters
             (id, novel_id, user_id, chapter_number, title, content, prompt, timeline_anchor, location_anchor, status, word_count, trashed_at, client_updated_at, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            chap.id,
            bundle.novel.id,
            userId,
            chap.chapterNumber,
            chap.title,
            chap.content || '',
            chap.prompt || '',
            chap.timelineAnchor || '',
            chap.locationAnchor || '',
            chap.status || 'Draft',
            chap.wordCount || 0,
            chap.trashedAt || null,
            chap.clientUpdatedAt || chap.updatedAt,
            chap.version || 1,
            chap.createdAt,
            chap.updatedAt
          );
        }
        for (const fact of bundle.canonFacts || []) {
          db.prepare(
            `INSERT OR IGNORE INTO canon_facts
             (id, novel_id, user_id, fact_text, category, source_chapter_id, approval_status, is_pinned, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            fact.id,
            bundle.novel.id,
            userId,
            fact.factText,
            fact.category || 'General',
            fact.sourceChapterId || null,
            fact.approvalStatus || 'pending',
            fact.isPinned ? 1 : 0,
            fact.createdAt,
            fact.updatedAt
          );
        }
        for (const sum of bundle.summaries || []) {
          db.prepare(
            `INSERT OR IGNORE INTO chapter_summaries
             (id, novel_id, chapter_id, user_id, summary_text, timeline_note, locations_json, characters_json, objects_json, revelations_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            sum.id,
            bundle.novel.id,
            sum.chapterId,
            userId,
            sum.summaryText,
            sum.timelineNote || '',
            JSON.stringify(sum.locations || []),
            JSON.stringify(sum.characters || []),
            JSON.stringify(sum.objects || []),
            JSON.stringify(sum.revelations || []),
            sum.createdAt,
            sum.updatedAt
          );
        }
        for (const note of bundle.scratchpadNotes || []) {
          db.prepare(
            `INSERT OR IGNORE INTO scratchpad_notes
             (id, novel_id, user_id, title, content, category, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            note.id,
            bundle.novel.id,
            userId,
            note.title,
            note.content || '',
            note.category || 'Idea',
            note.createdAt,
            note.updatedAt
          );
        }
      }
    })();

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Hydration failed' });
  }
});

// ============================================================================
// NOVELS LIBRARY & CREATION WIZARD ROUTES
// ============================================================================

app.get('/api/novels', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id AND c.trashed_at IS NULL) as chapter_count,
              (SELECT COALESCE(SUM(c.word_count), 0) FROM chapters c WHERE c.novel_id = n.id AND c.trashed_at IS NULL) as total_word_count
       FROM novels n
       WHERE n.user_id = ?
       ORDER BY n.updated_at DESC`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  res.json({ novels: rows.map(formatNovelRow) });
});

app.post('/api/novels', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { title, authorName, genre, synopsis, storyDna, characters } = req.body as {
      title?: string;
      authorName?: string;
      genre?: string;
      synopsis?: string;
      storyDna?: Partial<StoryDna>;
      characters?: Array<Partial<CharacterProfile>>;
    };

    if (!title?.trim()) {
      res.status(400).json({ error: 'Novel title is required.' });
      return;
    }

    const now = new Date().toISOString();
    const novelId = uuidv4();
    const dna: StoryDna = {
      narrationLanguage: storyDna?.narrationLanguage || 'English',
      dialogueLanguages: storyDna?.dialogueLanguages?.length
        ? storyDna.dialogueLanguages
        : ['English'],
      mixedLanguageWriting: Boolean(storyDna?.mixedLanguageWriting),
      romanScriptOnly: Boolean(storyDna?.romanScriptOnly),
      perspective: storyDna?.perspective || 'Third Person Limited',
      tense: storyDna?.tense || 'Past Tense',
      pacing: storyDna?.pacing || 'Measured',
      contentBoundaries: storyDna?.contentBoundaries || '',
      writingRules: storyDna?.writingRules || '',
      customGenreLabel: storyDna?.customGenreLabel || '',
    };

    const firstChapterId = uuidv4();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO novels (id, user_id, title, author_name, genre, synopsis, status, story_dna_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      ).run(
        novelId,
        userId,
        title.trim(),
        (authorName || req.user!.name || '').trim(),
        (genre || 'Dark Romance').trim(),
        (synopsis || '').trim(),
        JSON.stringify(dna),
        now,
        now
      );

      if (Array.isArray(characters)) {
        const capped = characters.slice(0, 32);
        capped.forEach((ch, idx) => {
          if (!ch.name?.trim()) return;
          db.prepare(
            `INSERT INTO characters
             (id, novel_id, user_id, role_type, name, age, role, archetype, personality, psychological_traits, triggers, vulnerabilities, relationship_dynamics, relationships, physical_appearance, backstory, character_development, status, custom_status, location, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            uuidv4(),
            novelId,
            userId,
            ch.roleType || 'supporting',
            ch.name.trim(),
            ch.age || '',
            ch.role || '',
            ch.archetype || '',
            ch.personality || '',
            ch.psychologicalTraits || '',
            ch.triggers || '',
            ch.vulnerabilities || '',
            ch.relationshipDynamics || '',
            ch.relationships || '',
            ch.physicalAppearance || '',
            ch.backstory || '',
            ch.characterDevelopment || '',
            ch.status || 'Active',
            ch.customStatus || '',
            ch.location || '',
            idx,
            now,
            now
          );
        });
      }

      // Create Chapter 1 ready for writing
      db.prepare(
        `INSERT INTO chapters
         (id, novel_id, user_id, chapter_number, title, content, prompt, timeline_anchor, location_anchor, status, word_count, client_updated_at, version, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'Chapter One', '', '', '', '', 'Draft', 0, ?, 1, ?, ?)`
      ).run(firstChapterId, novelId, userId, now, now, now);
    })();

    const novel = assertNovelOwned(novelId, userId);
    res.status(201).json({ novel, firstChapterId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create novel' });
  }
});

app.get('/api/novels/:novelId', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const novel = assertNovelOwned(req.params.novelId, userId);

    const characters = (
      db
        .prepare(
          `SELECT * FROM characters WHERE novel_id = ? AND user_id = ? ORDER BY sort_order ASC, created_at ASC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map(formatCharacterRow);

    const activeChapters = (
      db
        .prepare(
          `SELECT * FROM chapters WHERE novel_id = ? AND user_id = ? AND trashed_at IS NULL ORDER BY chapter_number ASC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map(formatChapterRow);

    const trashedChapters = (
      db
        .prepare(
          `SELECT * FROM chapters WHERE novel_id = ? AND user_id = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map(formatChapterRow);

    const images = (
      db
        .prepare(`SELECT * FROM images WHERE novel_id = ? AND user_id = ? ORDER BY created_at DESC`)
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map((img) => ({
      id: String(img.id),
      userId: String(img.user_id),
      novelId: String(img.novel_id),
      entityType: img.entity_type,
      entityId: img.entity_id ? String(img.entity_id) : null,
      category: img.category,
      title: String(img.title || ''),
      notes: String(img.notes || ''),
      mimeType: img.mime_type,
      sizeBytes: Number(img.size_bytes),
      url: `/api/images/${img.id}/file`,
      createdAt: String(img.created_at),
    }));

    const canonFacts = (
      db
        .prepare(
          `SELECT * FROM canon_facts WHERE novel_id = ? AND user_id = ? ORDER BY is_pinned DESC, created_at DESC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map((c) => ({
      id: String(c.id),
      novelId: String(c.novel_id),
      factText: String(c.fact_text),
      category: String(c.category),
      sourceChapterId: c.source_chapter_id ? String(c.source_chapter_id) : null,
      approvalStatus: c.approval_status,
      isPinned: Number(c.is_pinned) === 1,
      createdAt: String(c.created_at),
      updatedAt: String(c.updated_at),
    }));

    const summaries = (
      db
        .prepare(
          `SELECT cs.*, ch.chapter_number, ch.title as chapter_title
           FROM chapter_summaries cs
           JOIN chapters ch ON cs.chapter_id = ch.id
           WHERE cs.novel_id = ? AND cs.user_id = ? AND ch.trashed_at IS NULL
           ORDER BY ch.chapter_number ASC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map((s) => ({
      id: String(s.id),
      novelId: String(s.novel_id),
      chapterId: String(s.chapter_id),
      chapterNumber: Number(s.chapter_number),
      chapterTitle: String(s.chapter_title),
      summaryText: String(s.summary_text),
      timelineNote: String(s.timeline_note || ''),
      locations: JSON.parse(String(s.locations_json || '[]')),
      characters: JSON.parse(String(s.characters_json || '[]')),
      objects: JSON.parse(String(s.objects_json || '[]')),
      revelations: JSON.parse(String(s.revelations_json || '[]')),
      createdAt: String(s.created_at),
      updatedAt: String(s.updated_at),
    }));

    const stateProposals = (
      db
        .prepare(
          `SELECT sp.*, c.name as character_name
           FROM character_state_proposals sp
           JOIN characters c ON sp.character_id = c.id
           WHERE sp.novel_id = ? AND sp.user_id = ? AND sp.approval_status = 'pending'
           ORDER BY sp.created_at DESC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map((p) => ({
      id: String(p.id),
      novelId: String(p.novel_id),
      chapterId: String(p.chapter_id),
      characterId: String(p.character_id),
      characterName: String(p.character_name),
      proposedStatus: p.proposed_status,
      proposedLocation: String(p.proposed_location || ''),
      reason: String(p.reason || ''),
      approvalStatus: p.approval_status,
      createdAt: String(p.created_at),
    }));

    const scratchpadNotes = (
      db
        .prepare(
          `SELECT * FROM scratchpad_notes WHERE novel_id = ? AND user_id = ? ORDER BY updated_at DESC`
        )
        .all(novel.id, userId) as Array<Record<string, unknown>>
    ).map((n) => ({
      id: String(n.id),
      novelId: String(n.novel_id),
      title: String(n.title),
      content: String(n.content || ''),
      category: String(n.category || 'Idea'),
      createdAt: String(n.created_at),
      updatedAt: String(n.updated_at),
    }));

    res.json({
      novel,
      characters,
      chapters: activeChapters,
      trashedChapters,
      images,
      canonFacts,
      summaries,
      stateProposals,
      scratchpadNotes,
    });
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode || 500;
    res.status(code).json({ error: err instanceof Error ? err.message : 'Failed to load novel' });
  }
});

app.patch('/api/novels/:novelId', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const existing = assertNovelOwned(req.params.novelId, userId);
    const { title, authorName, genre, synopsis, storyDna, action } = req.body as {
      title?: string;
      authorName?: string;
      genre?: string;
      synopsis?: string;
      storyDna?: Partial<StoryDna>;
      action?: 'complete' | 'reopen' | 'trash' | 'restore';
    };

    const now = new Date().toISOString();
    let nextStatus = existing.status;
    let completedAt = existing.completedAt;
    let trashedAt = existing.trashedAt;

    if (action === 'complete') {
      nextStatus = 'completed';
      completedAt = now;
    } else if (action === 'reopen') {
      nextStatus = 'active';
      completedAt = null;
      trashedAt = null;
    } else if (action === 'trash') {
      nextStatus = 'trashed';
      trashedAt = now;
    } else if (action === 'restore') {
      nextStatus = completedAt ? 'completed' : 'active';
      trashedAt = null;
    }

    const nextDna: StoryDna = storyDna ? { ...existing.storyDna, ...storyDna } : existing.storyDna;

    db.prepare(
      `UPDATE novels
       SET title = ?, author_name = ?, genre = ?, synopsis = ?, status = ?, completed_at = ?, trashed_at = ?, story_dna_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      title !== undefined ? title.trim() || existing.title : existing.title,
      authorName !== undefined ? authorName.trim() : existing.authorName,
      genre !== undefined ? genre.trim() || existing.genre : existing.genre,
      synopsis !== undefined ? synopsis : existing.synopsis,
      nextStatus,
      completedAt,
      trashedAt,
      JSON.stringify(nextDna),
      now,
      existing.id,
      userId
    );

    res.json({ novel: assertNovelOwned(existing.id, userId) });
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode || 400;
    res.status(code).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

app.delete('/api/novels/:novelId', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const novel = assertNovelOwned(req.params.novelId, userId);

    // Delete ONLY this novel's uploaded image files; never touch unrelated novels
    const images = db
      .prepare('SELECT file_path FROM images WHERE novel_id = ? AND user_id = ?')
      .all(novel.id, userId) as Array<{ file_path: string }>;

    db.prepare('DELETE FROM novels WHERE id = ? AND user_id = ?').run(novel.id, userId);

    for (const img of images) {
      if (img.file_path && fs.existsSync(img.file_path)) {
        fs.unlinkSync(img.file_path);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode || 400;
    res.status(code).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
});

// ============================================================================
// CHARACTERS ROUTES (LEADS + UP TO 30 SUPPORTING)
// ============================================================================

app.post('/api/novels/:novelId/characters', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const novel = assertNovelOwned(req.params.novelId, userId);
    const body = req.body as Partial<CharacterProfile>;

    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Character name is required.' });
      return;
    }

    if ((body.roleType || 'supporting') === 'supporting') {
      const countRow = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM characters WHERE novel_id = ? AND user_id = ? AND role_type = 'supporting'`
        )
        .get(novel.id, userId) as { cnt: number };
      if (countRow.cnt >= 30) {
        res.status(400).json({ error: 'Supporting cast limit of 30 characters reached.' });
        return;
      }
    }

    const now = new Date().toISOString();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO characters
       (id, novel_id, user_id, role_type, name, age, role, archetype, personality, psychological_traits, triggers, vulnerabilities, relationship_dynamics, relationships, physical_appearance, backstory, character_development, status, custom_status, location, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      novel.id,
      userId,
      body.roleType || 'supporting',
      body.name.trim(),
      body.age || '',
      body.role || '',
      body.archetype || '',
      body.personality || '',
      body.psychologicalTraits || '',
      body.triggers || '',
      body.vulnerabilities || '',
      body.relationshipDynamics || '',
      body.relationships || '',
      body.physicalAppearance || '',
      body.backstory || '',
      body.characterDevelopment || '',
      body.status || 'Active',
      body.customStatus || '',
      body.location || '',
      body.sortOrder || 0,
      now,
      now
    );

    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ character: formatCharacterRow(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create character' });
  }
});

app.patch(
  '/api/novels/:novelId/characters/:characterId',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      assertNovelOwned(req.params.novelId, userId);
      const existing = db
        .prepare('SELECT * FROM characters WHERE id = ? AND novel_id = ? AND user_id = ?')
        .get(req.params.characterId, req.params.novelId, userId) as
        | Record<string, unknown>
        | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Character not found.' });
        return;
      }

      const cur = formatCharacterRow(existing);
      const b = req.body as Partial<CharacterProfile>;
      const now = new Date().toISOString();

      db.prepare(
        `UPDATE characters
         SET name = ?, role_type = ?, age = ?, role = ?, archetype = ?, personality = ?, psychological_traits = ?, triggers = ?, vulnerabilities = ?, relationship_dynamics = ?, relationships = ?, physical_appearance = ?, backstory = ?, character_development = ?, status = ?, custom_status = ?, location = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        b.name !== undefined ? b.name.trim() || cur.name : cur.name,
        b.roleType ?? cur.roleType,
        b.age ?? cur.age,
        b.role ?? cur.role,
        b.archetype ?? cur.archetype,
        b.personality ?? cur.personality,
        b.psychologicalTraits ?? cur.psychologicalTraits,
        b.triggers ?? cur.triggers,
        b.vulnerabilities ?? cur.vulnerabilities,
        b.relationshipDynamics ?? cur.relationshipDynamics,
        b.relationships ?? cur.relationships,
        b.physicalAppearance ?? cur.physicalAppearance,
        b.backstory ?? cur.backstory,
        b.characterDevelopment ?? cur.characterDevelopment,
        b.status ?? cur.status,
        b.customStatus ?? cur.customStatus,
        b.location ?? cur.location,
        now,
        cur.id,
        userId
      );

      const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(cur.id) as Record<
        string,
        unknown
      >;
      res.json({ character: formatCharacterRow(updated) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update character' });
    }
  }
);

app.delete(
  '/api/novels/:novelId/characters/:characterId',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    db.prepare('DELETE FROM characters WHERE id = ? AND novel_id = ? AND user_id = ?').run(
      req.params.characterId,
      req.params.novelId,
      userId
    );
    res.json({ ok: true });
  }
);

// ============================================================================
// AUTHOR-UPLOADED IMAGE OBJECT STORAGE ROUTES (NO AI IMAGE GENERATION)
// ============================================================================

app.post(
  '/api/novels/:novelId/images',
  requireAuth,
  upload.single('file'),
  (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const novel = assertNovelOwned(req.params.novelId, userId);

      if (!req.file) {
        res.status(400).json({ error: 'Please select a JPEG, PNG, or WebP image file.' });
        return;
      }

      const { entityType, entityId, category, title, notes } = req.body as {
        entityType?: 'cover' | 'character' | 'reference';
        entityId?: string;
        category?: string;
        title?: string;
        notes?: string;
      };

      const resolvedEntityType = entityType || 'reference';
      const resolvedCategory = category || resolvedEntityType;
      const imageId = uuidv4();
      const now = new Date().toISOString();

      db.transaction(() => {
        // If replacing cover or character portrait, clean up previous one cleanly
        if (resolvedEntityType === 'cover' && novel.coverImageId) {
          const oldCover = db
            .prepare('SELECT file_path FROM images WHERE id = ? AND user_id = ?')
            .get(novel.coverImageId, userId) as { file_path: string } | undefined;
          db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(
            novel.coverImageId,
            userId
          );
          if (oldCover?.file_path && fs.existsSync(oldCover.file_path)) {
            fs.unlinkSync(oldCover.file_path);
          }
        }

        if (resolvedEntityType === 'character' && entityId) {
          const charRow = db
            .prepare('SELECT image_id FROM characters WHERE id = ? AND novel_id = ? AND user_id = ?')
            .get(entityId, novel.id, userId) as { image_id: string | null } | undefined;
          if (charRow?.image_id) {
            const oldImg = db
              .prepare('SELECT file_path FROM images WHERE id = ? AND user_id = ?')
              .get(charRow.image_id, userId) as { file_path: string } | undefined;
            db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(
              charRow.image_id,
              userId
            );
            if (oldImg?.file_path && fs.existsSync(oldImg.file_path)) {
              fs.unlinkSync(oldImg.file_path);
            }
          }
        }

        db.prepare(
          `INSERT INTO images (id, user_id, novel_id, entity_type, entity_id, category, title, notes, mime_type, file_path, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          imageId,
          userId,
          novel.id,
          resolvedEntityType,
          entityId || null,
          resolvedCategory,
          title || req.file!.originalname,
          notes || '',
          req.file!.mimetype,
          req.file!.path,
          req.file!.size,
          now
        );

        if (resolvedEntityType === 'cover') {
          db.prepare('UPDATE novels SET cover_image_id = ?, updated_at = ? WHERE id = ?').run(
            imageId,
            now,
            novel.id
          );
        } else if (resolvedEntityType === 'character' && entityId) {
          db.prepare(
            'UPDATE characters SET image_id = ?, updated_at = ? WHERE id = ? AND novel_id = ?'
          ).run(imageId, now, entityId, novel.id);
        }
      })();

      res.status(201).json({
        image: {
          id: imageId,
          userId,
          novelId: novel.id,
          entityType: resolvedEntityType,
          entityId: entityId || null,
          category: resolvedCategory,
          title: title || req.file.originalname,
          notes: notes || '',
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          url: `/api/images/${imageId}/file`,
          createdAt: now,
        },
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Image upload failed' });
    }
  }
);

app.patch('/api/images/:imageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { title, notes, category, entityId } = req.body as {
    title?: string;
    notes?: string;
    category?: string;
    entityId?: string | null;
  };
  const existing = db
    .prepare('SELECT * FROM images WHERE id = ? AND user_id = ?')
    .get(req.params.imageId, userId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Image not found.' });
    return;
  }

  const nextTitle = title !== undefined ? title : existing.title;
  const nextNotes = notes !== undefined ? notes : existing.notes;
  const nextCategory = category !== undefined ? category : existing.category;
  const nextEntityId = entityId !== undefined ? entityId : existing.entity_id;

  db.prepare(
    `UPDATE images SET title = ?, notes = ?, category = ?, entity_id = ? WHERE id = ? AND user_id = ?`
  ).run(nextTitle, nextNotes, nextCategory, nextEntityId, req.params.imageId, userId);

  res.json({
    ok: true,
    image: {
      id: String(existing.id),
      userId: String(existing.user_id),
      novelId: String(existing.novel_id),
      entityType: existing.entity_type,
      entityId: nextEntityId ? String(nextEntityId) : null,
      category: nextCategory,
      title: String(nextTitle || ''),
      notes: String(nextNotes || ''),
      mimeType: existing.mime_type,
      sizeBytes: Number(existing.size_bytes),
      url: `/api/images/${existing.id}/file`,
      createdAt: String(existing.created_at),
    },
  });
});

app.get('/api/images/:imageId/file', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT file_path, mime_type FROM images WHERE id = ? AND user_id = ?')
    .get(req.params.imageId, req.user!.id) as { file_path: string; mime_type: string } | undefined;

  if (!row || !fs.existsSync(row.file_path)) {
    res.status(404).json({ error: 'Image file not found.' });
    return;
  }

  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(row.file_path).pipe(res);
});

app.delete('/api/images/:imageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const row = db
    .prepare('SELECT * FROM images WHERE id = ? AND user_id = ?')
    .get(req.params.imageId, userId) as
    | { id: string; file_path: string; entity_type: string; entity_id: string | null; novel_id: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Image not found.' });
    return;
  }

  db.transaction(() => {
    if (row.entity_type === 'cover') {
      db.prepare('UPDATE novels SET cover_image_id = NULL WHERE id = ? AND user_id = ?').run(
        row.novel_id,
        userId
      );
    } else if (row.entity_type === 'character' && row.entity_id) {
      db.prepare('UPDATE characters SET image_id = NULL WHERE id = ? AND user_id = ?').run(
        row.entity_id,
        userId
      );
    }
    db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(row.id, userId);
  })();

  if (row.file_path && fs.existsSync(row.file_path)) {
    fs.unlinkSync(row.file_path);
  }
  res.json({
    ok: true,
    novelId: row.novel_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
  });
});

// ============================================================================
// CHAPTERS, VERSION HISTORY, TRASH & SYNC ROUTES
// ============================================================================

app.post('/api/novels/:novelId/chapters', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const novel = assertNovelOwned(req.params.novelId, userId);
    if (novel.status === 'completed') {
      res.status(403).json({
        error: 'This novel is in Completed Read-Only Mode. Reopen the novel to add chapters.',
      });
      return;
    }

    const { title, timelineAnchor, locationAnchor, prompt, content } = req.body as {
      title?: string;
      timelineAnchor?: string;
      locationAnchor?: string;
      prompt?: string;
      content?: string;
    };

    const maxRow = db
      .prepare(
        `SELECT COALESCE(MAX(chapter_number), 0) as max_num FROM chapters WHERE novel_id = ? AND user_id = ? AND trashed_at IS NULL`
      )
      .get(novel.id, userId) as { max_num: number };
    const nextNum = (maxRow?.max_num || 0) + 1;

    const now = new Date().toISOString();
    const id = uuidv4();
    const bodyText = content || '';
    const wc = countWords(bodyText);

    db.prepare(
      `INSERT INTO chapters
       (id, novel_id, user_id, chapter_number, title, content, prompt, timeline_anchor, location_anchor, status, word_count, client_updated_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, 1, ?, ?)`
    ).run(
      id,
      novel.id,
      userId,
      nextNum,
      (title || `Chapter ${nextNum}`).trim(),
      bodyText,
      prompt || '',
      timelineAnchor || '',
      locationAnchor || '',
      wc,
      now,
      now,
      now
    );

    db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now, novel.id);
    const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ chapter: formatChapterRow(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create chapter' });
  }
});

app.patch('/api/chapters/:chapterId', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const row = db
      .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
      .get(req.params.chapterId, userId) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }

    const cur = formatChapterRow(row);
    const novel = assertNovelOwned(cur.novelId, userId);

    // Novel completion protects manuscript; chapter status (Draft/Confirmed/Completed) NEVER locks editing!
    if (novel.status === 'completed') {
      res.status(403).json({
        error: 'Novel is in Completed Read-Only Mode. Click Reopen Novel to edit chapters.',
      });
      return;
    }

    const {
      title,
      content,
      prompt,
      timelineAnchor,
      locationAnchor,
      status,
      clientUpdatedAt,
      force,
      snapshotReason,
    } = req.body as {
      title?: string;
      content?: string;
      prompt?: string;
      timelineAnchor?: string;
      locationAnchor?: string;
      status?: ChapterStatus;
      clientUpdatedAt?: string;
      force?: boolean;
      snapshotReason?: string;
    };

    // Conflict-aware check: never silently overwrite newer server edits with older offline edits
    if (
      !force &&
      clientUpdatedAt &&
      new Date(clientUpdatedAt).getTime() < new Date(cur.clientUpdatedAt).getTime()
    ) {
      res.status(409).json({
        error: 'Conflict detected: server has a newer version of this chapter.',
        serverChapter: cur,
      });
      return;
    }

    const now = new Date().toISOString();
    const nextTitle = title !== undefined ? title.trim() || cur.title : cur.title;
    const nextContent = content !== undefined ? content : cur.content;
    const nextPrompt = prompt !== undefined ? prompt : cur.prompt;
    const nextTimeline = timelineAnchor !== undefined ? timelineAnchor : cur.timelineAnchor;
    const nextLocation = locationAnchor !== undefined ? locationAnchor : cur.locationAnchor;
    const nextStatus = status !== undefined ? status : cur.status;
    const wc = countWords(nextContent);

    const contentChangedSignificantly =
      content !== undefined && Math.abs(nextContent.length - cur.content.length) >= 40;

    db.transaction(() => {
      if (snapshotReason || contentChangedSignificantly) {
        if (cur.content.trim() || cur.prompt.trim()) {
          db.prepare(
            `INSERT INTO chapter_versions (id, chapter_id, user_id, title, content, prompt, word_count, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            uuidv4(),
            cur.id,
            userId,
            cur.title,
            cur.content,
            cur.prompt,
            cur.wordCount,
            snapshotReason || 'Auto-snapshot before edit',
            now
          );
        }
      }

      db.prepare(
        `UPDATE chapters
         SET title = ?, content = ?, prompt = ?, timeline_anchor = ?, location_anchor = ?, status = ?, word_count = ?, client_updated_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        nextTitle,
        nextContent,
        nextPrompt,
        nextTimeline,
        nextLocation,
        nextStatus,
        wc,
        clientUpdatedAt || now,
        now,
        cur.id,
        userId
      );

      db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now, novel.id);
    })();

    // Detect explicit canon directives in prompt/notes and propose them (never auto-pin!)
    if (prompt && prompt !== cur.prompt) {
      const cues = extractCanonDirectivesFromText(prompt);
      for (const fact of cues) {
        const dup = db
          .prepare('SELECT id FROM canon_facts WHERE novel_id = ? AND lower(fact_text) = lower(?)')
          .get(novel.id, fact);
        if (!dup) {
          db.prepare(
            `INSERT INTO canon_facts (id, novel_id, user_id, fact_text, category, source_chapter_id, approval_status, is_pinned, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'Author Cue', ?, 'pending', 0, ?, ?)`
          ).run(uuidv4(), novel.id, userId, fact, cur.id, now, now);
        }
      }
    }

    // Trigger non-blocking background summary if author confirmed/completed chapter and it has prose
    if (status && (status === 'Confirmed' || status === 'Completed') && status !== cur.status && wc > 60) {
      enqueueBackgroundSummaryJob(userId, novel.id, cur.id);
    }

    const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(cur.id) as Record<
      string,
      unknown
    >;
    res.json({ chapter: formatChapterRow(updated) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save chapter' });
  }
});

app.post('/api/chapters/:chapterId/duplicate', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const row = db
      .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
      .get(req.params.chapterId, userId) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }
    const cur = formatChapterRow(row);
    const novel = assertNovelOwned(cur.novelId, userId);
    if (novel.status === 'completed') {
      res.status(403).json({ error: 'Reopen the completed novel to duplicate chapters.' });
      return;
    }

    const maxRow = db
      .prepare(
        `SELECT COALESCE(MAX(chapter_number), 0) as max_num FROM chapters WHERE novel_id = ? AND user_id = ? AND trashed_at IS NULL`
      )
      .get(cur.novelId, userId) as { max_num: number };
    const nextNum = (maxRow?.max_num || 0) + 1;
    const now = new Date().toISOString();
    const id = uuidv4();

    db.prepare(
      `INSERT INTO chapters
       (id, novel_id, user_id, chapter_number, title, content, prompt, timeline_anchor, location_anchor, status, word_count, client_updated_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, 1, ?, ?)`
    ).run(
      id,
      cur.novelId,
      userId,
      nextNum,
      `${cur.title} (Copy)`,
      cur.content,
      cur.prompt,
      cur.timelineAnchor,
      cur.locationAnchor,
      cur.wordCount,
      now,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    res.status(201).json({ chapter: formatChapterRow(created) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Duplicate failed' });
  }
});

app.post('/api/chapters/:chapterId/trash', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const row = db
    .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
    .get(req.params.chapterId, userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Chapter not found.' });
    return;
  }
  const cur = formatChapterRow(row);
  const novel = assertNovelOwned(cur.novelId, userId);
  if (novel.status === 'completed') {
    res.status(403).json({ error: 'Reopen the completed novel before deleting chapters.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE chapters SET trashed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    now,
    now,
    cur.id,
    userId
  );
  res.json({ ok: true, novelId: cur.novelId });
});

app.post('/api/chapters/:chapterId/restore', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const row = db
    .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
    .get(req.params.chapterId, userId) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Chapter not found.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE chapters SET trashed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(now, req.params.chapterId, userId);
  const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.chapterId) as Record<
    string,
    unknown
  >;
  res.json({ chapter: formatChapterRow(updated) });
});

app.delete('/api/chapters/:chapterId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const row = db
    .prepare('SELECT novel_id FROM chapters WHERE id = ? AND user_id = ?')
    .get(req.params.chapterId, userId) as { novel_id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Chapter not found.' });
    return;
  }
  const novel = assertNovelOwned(row.novel_id, userId);
  if (novel.status === 'completed') {
    res.status(403).json({ error: 'Reopen the completed novel before deleting chapters.' });
    return;
  }
  db.prepare('DELETE FROM chapters WHERE id = ? AND user_id = ?').run(req.params.chapterId, userId);
  res.json({ ok: true, novelId: row.novel_id });
});

app.get('/api/chapters/:chapterId/versions', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM chapter_versions WHERE chapter_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 40`
    )
    .all(req.params.chapterId, req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    versions: rows.map((v) => ({
      id: String(v.id),
      chapterId: String(v.chapter_id),
      title: String(v.title),
      content: String(v.content),
      prompt: String(v.prompt || ''),
      wordCount: Number(v.word_count || 0),
      reason: String(v.reason || ''),
      createdAt: String(v.created_at),
    })),
  });
});

app.post('/api/chapters/:chapterId/versions', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const ch = db
    .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
    .get(req.params.chapterId, userId) as Record<string, unknown> | undefined;
  if (!ch) {
    res.status(404).json({ error: 'Chapter not found.' });
    return;
  }
  const { reason } = req.body as { reason?: string };
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO chapter_versions (id, chapter_id, user_id, title, content, prompt, word_count, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(ch.id),
    userId,
    String(ch.title),
    String(ch.content || ''),
    String(ch.prompt || ''),
    Number(ch.word_count || 0),
    reason || 'Manual snapshot',
    now
  );
  res.status(201).json({
    ok: true,
    id,
    novelId: String(ch.novel_id),
    version: {
      id,
      chapterId: String(ch.id),
      title: String(ch.title),
      content: String(ch.content || ''),
      prompt: String(ch.prompt || ''),
      wordCount: Number(ch.word_count || 0),
      reason: reason || 'Manual snapshot',
      createdAt: now,
    },
  });
});

app.post(
  '/api/chapters/:chapterId/versions/:versionId/restore',
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const ch = db
      .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
      .get(req.params.chapterId, userId) as Record<string, unknown> | undefined;
    const ver = db
      .prepare('SELECT * FROM chapter_versions WHERE id = ? AND chapter_id = ? AND user_id = ?')
      .get(req.params.versionId, req.params.chapterId, userId) as
      | Record<string, unknown>
      | undefined;

    if (!ch || !ver) {
      res.status(404).json({ error: 'Chapter or version not found.' });
      return;
    }

    const novel = assertNovelOwned(String(ch.novel_id), userId);
    if (novel.status === 'completed') {
      res.status(403).json({ error: 'Reopen the completed novel to restore versions.' });
      return;
    }

    const now = new Date().toISOString();
    const restoredContent = String(ver.content || '');
    const restoredWc = countWords(restoredContent);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO chapter_versions (id, chapter_id, user_id, title, content, prompt, word_count, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pre-restore backup', ?)`
      ).run(
        uuidv4(),
        String(ch.id),
        userId,
        String(ch.title),
        String(ch.content || ''),
        String(ch.prompt || ''),
        Number(ch.word_count || 0),
        now
      );

      db.prepare(
        `UPDATE chapters SET title = ?, content = ?, prompt = ?, word_count = ?, client_updated_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        String(ver.title),
        restoredContent,
        String(ver.prompt || ''),
        restoredWc,
        now,
        now,
        String(ch.id),
        userId
      );
    })();

    const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(String(ch.id)) as Record<
      string,
      unknown
    >;
    res.json({ chapter: formatChapterRow(updated), novelId: String(ch.novel_id) });
  }
);

// Conflict-aware batch offline sync
app.post('/api/chapters/sync', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { chapters } = req.body as {
    chapters?: Array<{
      id: string;
      novelId: string;
      title: string;
      content: string;
      prompt: string;
      timelineAnchor: string;
      locationAnchor: string;
      status: ChapterStatus;
      clientUpdatedAt: string;
      version: number;
    }>;
  };

  if (!Array.isArray(chapters)) {
    res.status(400).json({ error: 'Expected chapters array.' });
    return;
  }

  const synced: Chapter[] = [];
  const conflicts: Array<{ localId: string; serverChapter: Chapter }> = [];

  for (const item of chapters) {
    const row = db
      .prepare('SELECT * FROM chapters WHERE id = ? AND user_id = ?')
      .get(item.id, userId) as Record<string, unknown> | undefined;

    if (!row) continue;
    const serverCh = formatChapterRow(row);
    const localTime = new Date(item.clientUpdatedAt).getTime();
    const serverTime = new Date(serverCh.clientUpdatedAt).getTime();

    // Never overwrite newer local edits with older cloud data; if server is newer AND content differs, report conflict
    if (serverTime > localTime && serverCh.content !== item.content) {
      conflicts.push({ localId: item.id, serverChapter: serverCh });
      continue;
    }

    const wc = countWords(item.content);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE chapters
       SET title = ?, content = ?, prompt = ?, timeline_anchor = ?, location_anchor = ?, status = ?, word_count = ?, client_updated_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      item.title,
      item.content,
      item.prompt,
      item.timelineAnchor,
      item.locationAnchor,
      item.status,
      wc,
      item.clientUpdatedAt || now,
      now,
      item.id,
      userId
    );
    const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(item.id) as Record<
      string,
      unknown
    >;
    synced.push(formatChapterRow(updated));
  }

  res.json({ synced, conflicts });
});

// ============================================================================
// STORY BIBLE ROUTES (CANON, SUMMARIES, STATE PROPOSALS, SCRATCHPAD)
// ============================================================================

app.post('/api/novels/:novelId/canon', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const novel = assertNovelOwned(req.params.novelId, userId);
    const { factText, category, isPinned } = req.body as {
      factText?: string;
      category?: string;
      isPinned?: boolean;
    };
    if (!factText?.trim()) {
      res.status(400).json({ error: 'Canon fact text is required.' });
      return;
    }
    const now = new Date().toISOString();
    const id = uuidv4();
    const pinned = isPinned !== false;
    db.prepare(
      `INSERT INTO canon_facts (id, novel_id, user_id, fact_text, category, approval_status, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      novel.id,
      userId,
      factText.trim(),
      (category || 'General').trim(),
      pinned ? 'pinned' : 'pending',
      pinned ? 1 : 0,
      now,
      now
    );

    res.status(201).json({
      canonFact: {
        id,
        novelId: novel.id,
        factText: factText.trim(),
        category: (category || 'General').trim(),
        sourceChapterId: null,
        approvalStatus: pinned ? 'pinned' : 'pending',
        isPinned: pinned,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add canon fact' });
  }
});

app.patch('/api/canon/:canonId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const existing = db
    .prepare('SELECT * FROM canon_facts WHERE id = ? AND user_id = ?')
    .get(req.params.canonId, userId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Canon fact not found.' });
    return;
  }

  const { factText, category, approvalStatus, isPinned } = req.body as {
    factText?: string;
    category?: string;
    approvalStatus?: 'pending' | 'pinned' | 'rejected';
    isPinned?: boolean;
  };

  const nextStatus = approvalStatus ?? (existing.approval_status as string);
  const nextPinned =
    isPinned !== undefined ? (isPinned ? 1 : 0) : nextStatus === 'pinned' ? 1 : nextStatus === 'rejected' ? 0 : Number(existing.is_pinned);
  const now = new Date().toISOString();

  const nextFactText = factText !== undefined ? factText.trim() : String(existing.fact_text);
  const nextCategory = category !== undefined ? category.trim() : String(existing.category);

  db.prepare(
    `UPDATE canon_facts SET fact_text = ?, category = ?, approval_status = ?, is_pinned = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(nextFactText, nextCategory, nextStatus, nextPinned, now, req.params.canonId, userId);

  res.json({
    ok: true,
    canonFact: {
      id: String(existing.id),
      novelId: String(existing.novel_id),
      factText: nextFactText,
      category: nextCategory,
      sourceChapterId: existing.source_chapter_id ? String(existing.source_chapter_id) : null,
      approvalStatus: nextStatus,
      isPinned: nextPinned === 1,
      createdAt: String(existing.created_at),
      updatedAt: now,
    },
  });
});

app.delete('/api/canon/:canonId', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT novel_id FROM canon_facts WHERE id = ? AND user_id = ?')
    .get(req.params.canonId, req.user!.id) as { novel_id: string } | undefined;
  db.prepare('DELETE FROM canon_facts WHERE id = ? AND user_id = ?').run(
    req.params.canonId,
    req.user!.id
  );
  res.json({ ok: true, novelId: existing?.novel_id || null });
});

app.post('/api/chapters/:chapterId/summarize', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const ch = db
      .prepare('SELECT novel_id FROM chapters WHERE id = ? AND user_id = ?')
      .get(req.params.chapterId, userId) as { novel_id: string } | undefined;
    if (!ch) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }
    const result = await runChapterSummaryAndExtraction({
      userId,
      novelId: ch.novel_id,
      chapterId: req.params.chapterId,
    });
    res.json({ ok: true, novelId: ch.novel_id, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Summarization failed' });
  }
});

app.patch('/api/summaries/:summaryId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { summaryText, timelineNote } = req.body as {
    summaryText?: string;
    timelineNote?: string;
  };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE chapter_summaries SET summary_text = COALESCE(?, summary_text), timeline_note = COALESCE(?, timeline_note), updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(summaryText ?? null, timelineNote ?? null, now, req.params.summaryId, req.user!.id);

  const row = db
    .prepare(
      `SELECT cs.*, ch.chapter_number, ch.title as chapter_title
       FROM chapter_summaries cs
       JOIN chapters ch ON cs.chapter_id = ch.id
       WHERE cs.id = ? AND cs.user_id = ?`
    )
    .get(req.params.summaryId, req.user!.id) as Record<string, unknown> | undefined;

  res.json({
    ok: true,
    summary: row
      ? {
          id: String(row.id),
          novelId: String(row.novel_id),
          chapterId: String(row.chapter_id),
          chapterNumber: Number(row.chapter_number),
          chapterTitle: String(row.chapter_title),
          summaryText: String(row.summary_text),
          timelineNote: String(row.timeline_note || ''),
          locations: JSON.parse(String(row.locations_json || '[]')),
          characters: JSON.parse(String(row.characters_json || '[]')),
          objects: JSON.parse(String(row.objects_json || '[]')),
          revelations: JSON.parse(String(row.revelations_json || '[]')),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }
      : null,
  });
});

app.patch('/api/state-proposals/:proposalId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { action } = req.body as { action?: 'approve' | 'reject' };
  const proposal = db
    .prepare('SELECT * FROM character_state_proposals WHERE id = ? AND user_id = ?')
    .get(req.params.proposalId, userId) as
    | {
        id: string;
        novel_id: string;
        character_id: string;
        proposed_status: string;
        proposed_location: string;
      }
    | undefined;

  if (!proposal) {
    res.status(404).json({ error: 'Proposal not found.' });
    return;
  }

  const nextApprovalStatus = action === 'approve' ? 'approved' : 'rejected';
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE character_state_proposals SET approval_status = ? WHERE id = ?').run(
      nextApprovalStatus,
      proposal.id
    );
    if (action === 'approve') {
      db.prepare(
        `UPDATE characters SET status = ?, location = COALESCE(NULLIF(?, ''), location), updated_at = ? WHERE id = ? AND user_id = ?`
      ).run(
        proposal.proposed_status,
        proposal.proposed_location,
        now,
        proposal.character_id,
        userId
      );
    }
  })();

  const updatedCharRow =
    action === 'approve'
      ? (db.prepare('SELECT * FROM characters WHERE id = ?').get(proposal.character_id) as
          | Record<string, unknown>
          | undefined)
      : undefined;

  res.json({
    ok: true,
    novelId: proposal.novel_id,
    approvalStatus: nextApprovalStatus,
    character: updatedCharRow ? formatCharacterRow(updatedCharRow) : null,
  });
});

app.post('/api/novels/:novelId/scratchpad', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const novel = assertNovelOwned(req.params.novelId, userId);
    const { title, content, category } = req.body as {
      title?: string;
      content?: string;
      category?: string;
    };
    const now = new Date().toISOString();
    const id = uuidv4();
    db.prepare(
      `INSERT INTO scratchpad_notes (id, novel_id, user_id, title, content, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, novel.id, userId, (title || 'Untitled Note').trim(), content || '', category || 'Idea', now, now);

    res.status(201).json({
      note: {
        id,
        novelId: novel.id,
        title: (title || 'Untitled Note').trim(),
        content: content || '',
        category: category || 'Idea',
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create note' });
  }
});

app.patch('/api/scratchpad/:noteId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { title, content, category } = req.body as {
    title?: string;
    content?: string;
    category?: string;
  };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE scratchpad_notes SET title = COALESCE(?, title), content = COALESCE(?, content), category = COALESCE(?, category), updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(title ?? null, content ?? null, category ?? null, now, req.params.noteId, req.user!.id);
  const noteRow = db
    .prepare('SELECT * FROM scratchpad_notes WHERE id = ? AND user_id = ?')
    .get(req.params.noteId, req.user!.id) as Record<string, unknown> | undefined;
  res.json({
    ok: true,
    note: noteRow
      ? {
          id: String(noteRow.id),
          novelId: String(noteRow.novel_id),
          title: String(noteRow.title),
          content: String(noteRow.content || ''),
          category: String(noteRow.category || 'Idea'),
          createdAt: String(noteRow.created_at),
          updatedAt: String(noteRow.updated_at),
        }
      : null,
  });
});

app.delete('/api/scratchpad/:noteId', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT novel_id FROM scratchpad_notes WHERE id = ? AND user_id = ?')
    .get(req.params.noteId, req.user!.id) as { novel_id: string } | undefined;
  db.prepare('DELETE FROM scratchpad_notes WHERE id = ? AND user_id = ?').run(
    req.params.noteId,
    req.user!.id
  );
  res.json({ ok: true, novelId: existing?.novel_id || null });
});

// ============================================================================
// AI PROVIDERS, CREDENTIALS, MODELS, PREFLIGHT, GENERATION & EDITING
// ============================================================================

app.get('/api/ai/credentials', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    credentials: listAuthorCredentialsPublic(req.user!.id),
    managedGeminiAvailable: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

app.post('/api/ai/credentials', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const { provider, label, apiKey, endpointUrl, isDefault } = req.body as {
      provider?: AiProviderId;
      label?: string;
      apiKey?: string;
      endpointUrl?: string;
      isDefault?: boolean;
    };
    if (!provider || !apiKey?.trim()) {
      res.status(400).json({ error: 'Provider and API key are required.' });
      return;
    }
    const id = saveAuthorCredential({
      userId: req.user!.id,
      provider,
      label: label || `${provider} key`,
      apiKey,
      endpointUrl,
      isDefault,
    });
    res.status(201).json({ id, credentials: listAuthorCredentialsPublic(req.user!.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Save failed' });
  }
});

app.put('/api/ai/credentials/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const { provider, label, apiKey, endpointUrl, isDefault } = req.body as {
      provider?: AiProviderId;
      label?: string;
      apiKey?: string;
      endpointUrl?: string;
      isDefault?: boolean;
    };
    saveAuthorCredential({
      userId: req.user!.id,
      id: req.params.id,
      provider: provider || 'gemini',
      label: label || 'Updated key',
      apiKey,
      endpointUrl,
      isDefault,
    });
    res.json({ credentials: listAuthorCredentialsPublic(req.user!.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

app.post('/api/ai/credentials/:id/test', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await testProviderCredential(req.user!.id, req.params.id);
    res.json({ ...result, credentials: listAuthorCredentialsPublic(req.user!.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Test failed' });
  }
});

app.delete('/api/ai/credentials/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('DELETE FROM provider_credentials WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.user!.id
  );
  res.json({ credentials: listAuthorCredentialsPublic(req.user!.id) });
});

app.get('/api/ai/models', requireAuth, async (req: AuthenticatedRequest, res) => {
  const provider = req.query.provider as AiProviderId | undefined;
  const data = await discoverModelsForUser(req.user!.id, provider);
  res.json(data);
});

app.post('/api/ai/preflight', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const {
      novelId,
      chapterId,
      prompt,
      timelineAnchor,
      locationAnchor,
      targetWordCount,
      provider,
      modelId,
      selectedImageIds,
      canonOverride,
      overrideStoryDna,
      forceCredentialSource,
    } = req.body as {
      novelId: string;
      chapterId?: string;
      prompt: string;
      timelineAnchor?: string;
      locationAnchor?: string;
      targetWordCount?: number;
      provider?: AiProviderId;
      modelId?: string;
      selectedImageIds?: string[];
      canonOverride?: string[];
      overrideStoryDna?: Partial<StoryDna>;
      forceCredentialSource?: 'managed' | 'author';
    };

    const resolvedProvider: AiProviderId = provider || req.user!.aiPrefs.defaultProvider || 'gemini';
    const resolvedModelId = modelId || req.user!.aiPrefs.defaultModelId || 'gemini-4-hydrogen';

    const cred = resolveCredentialForProvider(userId, resolvedProvider, {
      forceSource: forceCredentialSource,
    });

    const modelMeta = PROVIDER_CATALOG_MODELS.find(
      (m) => m.provider === resolvedProvider && m.id === resolvedModelId
    );

    const assembled = buildThreeLayerContext({
      userId,
      novelId,
      chapterId,
      prompt: prompt || '',
      timelineAnchor,
      locationAnchor,
      targetWordCount: targetWordCount || req.user!.editorPrefs.defaultChapterWordTarget || 2700,
      provider: resolvedProvider,
      modelId: resolvedModelId,
      contextWindow: modelMeta?.contextWindow || 128000,
      modelSupportsVision: modelMeta?.supportsVision ?? resolvedProvider === 'gemini',
      credentialSource: cred.source,
      credentialLabel: cred.label,
      selectedImageIds,
      canonOverride,
      overrideStoryDna,
    });

    res.json({ preflight: assembled.preflight });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Preflight failed' });
  }
});

// Genuine SSE Streaming Generation Endpoint
app.post('/api/ai/generate/stream', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const startedAt = Date.now();
  const {
    requestId,
    novelId,
    chapterId,
    prompt,
    timelineAnchor,
    locationAnchor,
    targetWordCount,
    provider,
    modelId,
    selectedImageIds,
    canonOverride,
    overrideStoryDna,
    mode,
    existingContent,
    forceCredentialSource,
    thinkingMode,
  } = req.body as {
    requestId?: string;
    novelId: string;
    chapterId: string;
    prompt: string;
    timelineAnchor?: string;
    locationAnchor?: string;
    targetWordCount?: number;
    provider?: AiProviderId;
    modelId?: string;
    selectedImageIds?: string[];
    canonOverride?: string[];
    overrideStoryDna?: Partial<StoryDna>;
    mode?: 'draft' | 'regenerate' | 'continue';
    existingContent?: string;
    forceCredentialSource?: 'managed' | 'author';
    thinkingMode?: 'fast' | 'balanced' | 'deep';
  };

  const reqId = requestId || uuidv4();

  // Deduplicate simultaneous identical request IDs
  if (activeGenerations.has(reqId)) {
    res.status(409).json({ error: 'A generation with this request ID is already running.' });
    return;
  }

  // Validate novel & read-only guard BEFORE opening stream
  let novel: Novel;
  try {
    novel = assertNovelOwned(novelId, userId);
    if (novel.status === 'completed') {
      res.status(403).json({ error: 'Novel is in Completed Read-Only Mode. Reopen it to generate.' });
      return;
    }
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Novel not found' });
    return;
  }

  if (!prompt?.trim() && mode !== 'continue') {
    res.status(400).json({ error: 'Scene prompt is required before generating.' });
    return;
  }

  const resolvedProvider: AiProviderId = provider || req.user!.aiPrefs.defaultProvider || 'gemini';
  const resolvedModelId = modelId || req.user!.aiPrefs.defaultModelId || 'gemini-4-hydrogen';

  let credential;
  try {
    credential = resolveCredentialForProvider(userId, resolvedProvider, {
      forceSource: forceCredentialSource,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Credential missing' });
    return;
  }

  // Set up SSE headers immediately and flush to eliminate "stuck at Connecting" buffering!
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  activeGenerations.set(reqId, { controller, userId, status: 'Preparing Context' });

  // Detect genuine client disconnect / abort on the response socket
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  // Periodic SSE keepalive prevents idle proxy timeouts while waiting on long-context first token
  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }
  }, 5000);

  let assembledInputTokens = 0;
  let generatedText = '';

  try {
    sendEvent('lifecycle', {
      state: 'Preparing Context',
      requestId: reqId,
      credentialSource: credential.source,
      credentialLabel: credential.label,
    });

    const modelMeta = PROVIDER_CATALOG_MODELS.find(
      (m) => m.provider === resolvedProvider && m.id === resolvedModelId
    );

    const effectivePrompt =
      mode === 'continue' && existingContent?.trim()
        ? `Continue seamlessly from the EXACT ending below without repeating any sentences or paragraphs. Maintain tone, pacing, and continuity.\n\nEXACT PREVIOUS ENDING:\n${existingContent
            .trim()
            .slice(-1800)}\n\nCONTINUATION INSTRUCTIONS:\n${prompt || 'Continue the scene naturally to its completion.'}`
        : prompt;

    const context = buildThreeLayerContext({
      userId,
      novelId,
      chapterId,
      prompt: effectivePrompt,
      timelineAnchor,
      locationAnchor,
      targetWordCount: targetWordCount || req.user!.editorPrefs.defaultChapterWordTarget || 2700,
      provider: resolvedProvider,
      modelId: resolvedModelId,
      contextWindow: modelMeta?.contextWindow || 128000,
      modelSupportsVision: modelMeta?.supportsVision ?? resolvedProvider === 'gemini',
      credentialSource: credential.source,
      credentialLabel: credential.label,
      selectedImageIds,
      canonOverride,
      overrideStoryDna,
    });

    assembledInputTokens = context.preflight.estimatedInputTokens;

    if (assembledInputTokens > context.preflight.contextWindow * 0.96) {
      throw new Error(
        `Context overflow (${assembledInputTokens.toLocaleString()} tokens exceeds model limit of ${context.preflight.contextWindow.toLocaleString()}).`
      );
    }

    const result = await streamAiCompletion({
      credential,
      modelId: resolvedModelId,
      systemInstruction: context.systemInstruction,
      userPrompt: context.userPrompt,
      attachedImages: context.attachedImages,
      thinkingMode: thinkingMode || req.user!.aiPrefs.thinkingMode || 'fast',
      signal: controller.signal,
      onPhase: (phase) => {
        const entry = activeGenerations.get(reqId);
        if (entry) entry.status = phase;
        sendEvent('lifecycle', { state: phase, requestId: reqId });
      },
      onDelta: (delta) => {
        generatedText += delta;
        sendEvent('delta', { text: delta, requestId: reqId });
      },
    });

    generatedText = result.fullText;

    // Save chapter snapshot & updated manuscript
    sendEvent('lifecycle', { state: 'Saving', requestId: reqId });

    const now = new Date().toISOString();
    const existingChapter = db
      .prepare('SELECT * FROM chapters WHERE id = ? AND novel_id = ? AND user_id = ?')
      .get(chapterId, novelId, userId) as Record<string, unknown> | undefined;

    let savedChapter: Chapter | null = null;
    if (existingChapter) {
      const prevContent = String(existingChapter.content || '');
      if (prevContent.trim()) {
        db.prepare(
          `INSERT INTO chapter_versions (id, chapter_id, user_id, title, content, prompt, word_count, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(),
          chapterId,
          userId,
          String(existingChapter.title),
          prevContent,
          String(existingChapter.prompt || ''),
          Number(existingChapter.word_count || 0),
          mode === 'continue' ? 'Before AI continuation' : 'Before AI generation',
          now
        );
      }

      const finalContent =
        mode === 'continue' && prevContent.trim()
          ? `${prevContent.trimEnd()}\n\n${generatedText.trimStart()}`
          : generatedText;
      const wc = countWords(finalContent);

      db.prepare(
        `UPDATE chapters
         SET content = ?, prompt = ?, timeline_anchor = COALESCE(NULLIF(?, ''), timeline_anchor), location_anchor = COALESCE(NULLIF(?, ''), location_anchor), word_count = ?, client_updated_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        finalContent,
        prompt || String(existingChapter.prompt || ''),
        timelineAnchor || '',
        locationAnchor || '',
        wc,
        now,
        now,
        chapterId,
        userId
      );

      db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(now, novelId);
      const updatedRow = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as Record<
        string,
        unknown
      >;
      savedChapter = formatChapterRow(updatedRow);
    }

    // Queue non-blocking background summary & canon extraction
    sendEvent('lifecycle', { state: 'Summarising', requestId: reqId });
    const jobId = enqueueBackgroundSummaryJob(userId, novelId, chapterId);

    const outTokens = estimateTokens(generatedText);
    const cost = estimateCostUsd(resolvedModelId, assembledInputTokens, outTokens);
    db.prepare(
      `INSERT INTO ai_usage_logs
       (id, user_id, novel_id, chapter_id, request_id, provider, model_id, credential_source, input_tokens_est, output_tokens_est, estimated_cost_usd, status, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
    ).run(
      uuidv4(),
      userId,
      novelId,
      chapterId,
      reqId,
      resolvedProvider,
      resolvedModelId,
      credential.source,
      assembledInputTokens,
      outTokens,
      cost,
      Date.now() - startedAt,
      now
    );

    const truncatedByOutputLimit =
      result.finishReason.toUpperCase().includes('MAX_TOKENS') ||
      result.finishReason.toLowerCase() === 'length';

    sendEvent('done', {
      state: 'Completed',
      requestId: reqId,
      chapter: savedChapter,
      finishReason: result.finishReason,
      truncatedByOutputLimit,
      backgroundJobId: jobId,
      usage: {
        inputTokensEst: assembledInputTokens,
        outputTokensEst: outTokens,
        estimatedCostUsd: cost,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    const partial = (err as Error & { partialText?: string }).partialText || generatedText;
    const isCancelled = controller.signal.aborted || (err instanceof Error && err.message.includes('Cancelled'));
    const classified = classifyProviderError(err, resolvedProvider);
    const now = new Date().toISOString();

    // If author key failed on Gemini and managed fallback exists, explicitly inform client (NEVER switch silently)
    const canFallbackToManaged =
      !isCancelled &&
      credential.source === 'author' &&
      resolvedProvider === 'gemini' &&
      Boolean(process.env.GEMINI_API_KEY?.trim());

    db.prepare(
      `INSERT INTO ai_usage_logs
       (id, user_id, novel_id, chapter_id, request_id, provider, model_id, credential_source, input_tokens_est, output_tokens_est, estimated_cost_usd, status, duration_ms, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      userId,
      novelId,
      chapterId,
      reqId,
      resolvedProvider,
      resolvedModelId,
      credential.source,
      assembledInputTokens,
      estimateTokens(partial),
      isCancelled ? 'cancelled' : 'failed',
      Date.now() - startedAt,
      classified.message,
      now
    );

    sendEvent('error', {
      state: isCancelled ? 'Cancelled' : partial.trim() ? 'Recoverable Interruption' : 'Failed',
      requestId: reqId,
      error: classified.message,
      code: classified.code,
      partialText: partial,
      credentialSource: credential.source,
      canFallbackToManaged,
    });
  } finally {
    clearInterval(keepalive);
    activeGenerations.delete(reqId);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

app.post('/api/ai/generate/:requestId/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
  const entry = activeGenerations.get(req.params.requestId);
  if (!entry || entry.userId !== req.user!.id) {
    res.json({ ok: false, message: 'No active generation found for this request ID.' });
    return;
  }
  entry.controller.abort();
  res.json({ ok: true });
});

// Selected-text editing tool (rewrites ONLY the selected passage, never overwrites the whole chapter)
app.post('/api/ai/edit-selection', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { novelId, selectedText, surroundingContext, action, customInstruction, provider, modelId } =
      req.body as {
        novelId: string;
        selectedText: string;
        surroundingContext?: string;
        action:
          | 'rewrite'
          | 'expand'
          | 'shorten'
          | 'improve_dialogue'
          | 'adjust_intensity'
          | 'correct_grammar'
          | 'translate_dialogue'
          | 'change_style';
        customInstruction?: string;
        provider?: AiProviderId;
        modelId?: string;
      };

    const novel = assertNovelOwned(novelId, userId);
    if (!selectedText?.trim()) {
      res.status(400).json({ error: 'Please select a passage of text to edit.' });
      return;
    }

    const resolvedProvider = provider || req.user!.aiPrefs.defaultProvider || 'gemini';
    const resolvedModelId = modelId || req.user!.aiPrefs.defaultModelId || 'gemini-4-hydrogen';
    const credential = resolveCredentialForProvider(userId, resolvedProvider);

    const actionPrompts: Record<string, string> = {
      rewrite: 'Rewrite the selected passage for sharper imagery, rhythm, and emotional clarity while keeping the same events and character voices.',
      expand: 'Expand the selected passage with deeper sensory detail, internal subtext, and pacing without adding unrelated plot events.',
      shorten: 'Tighten and condense the selected passage for brisk pacing while preserving all essential meaning and dialogue beats.',
      improve_dialogue: 'Elevate the dialogue in the selected passage so it sounds natural, subtext-rich, and distinct to each speaker.',
      adjust_intensity: 'Adjust the emotional intensity of the selected passage according to the author instruction while preserving character continuity.',
      correct_grammar: 'Correct grammar, punctuation, and syntax errors in the selected passage without altering voice or style.',
      translate_dialogue: 'Translate or refine the dialogue language in the selected passage per the Story DNA and author instruction.',
      change_style: 'Adjust the prose cadence and literary style of the selected passage per the author instruction.',
    };

    const systemInstruction = `You are a line-level literary editor for the novel "${novel.title}" (${novel.genre}, ${novel.storyDna.perspective}, ${novel.storyDna.tense}).
Return ONLY the replacement text for the selected passage. Do NOT include quotes, explanations, or surrounding text.`;

    const userPrompt = `TASK: ${actionPrompts[action] || 'Refine the selected passage.'}
${customInstruction ? `AUTHOR INSTRUCTION: ${customInstruction}` : ''}
${surroundingContext ? `SURROUNDING CONTEXT (DO NOT REPEAT THIS):\n${surroundingContext.slice(0, 1000)}` : ''}

SELECTED PASSAGE TO REPLACE:
${selectedText}`;

    const replacement = await runSingleAiTextCompletion({
      credential,
      modelId: resolvedModelId,
      systemInstruction,
      userPrompt,
    });

    res.json({ replacementText: replacement });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Selection edit failed' });
  }
});

// Brainstorm tool
app.post('/api/ai/brainstorm', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { novelId, category, prompt, provider, modelId } = req.body as {
      novelId: string;
      category:
        | 'plot_twists'
        | 'transitions'
        | 'dialogue'
        | 'emotional_beats'
        | 'character_reactions'
        | 'conflicts';
      prompt?: string;
      provider?: AiProviderId;
      modelId?: string;
    };

    const resolvedProvider = provider || req.user!.aiPrefs.defaultProvider || 'gemini';
    const resolvedModelId = modelId || req.user!.aiPrefs.defaultModelId || 'gemini-4-hydrogen';
    const credential = resolveCredentialForProvider(userId, resolvedProvider);

    const ctx = buildThreeLayerContext({
      userId,
      novelId,
      prompt: prompt || `Brainstorm ${category.replace('_', ' ')}`,
      targetWordCount: 500,
      provider: resolvedProvider,
      modelId: resolvedModelId,
      contextWindow: 128000,
      modelSupportsVision: false,
      credentialSource: credential.source,
      credentialLabel: credential.label,
    });

    const brainstormSystem = `${ctx.systemInstruction}

BRAINSTORMING MODE: Provide 4–5 concrete, emotionally grounded, canon-faithful ideas for "${category.replace('_', ' ')}" as clean numbered points.`;

    const ideas = await runSingleAiTextCompletion({
      credential,
      modelId: resolvedModelId,
      systemInstruction: brainstormSystem,
      userPrompt: prompt?.trim() || `Suggest compelling ${category.replace('_', ' ')} for the next scene.`,
    });

    res.json({ ideas });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Brainstorming failed' });
  }
});

app.get('/api/ai/usage', requireAuth, (req: AuthenticatedRequest, res) => {
  const logs = db
    .prepare(
      `SELECT * FROM ai_usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 60`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    logs: logs.map((l) => ({
      id: String(l.id),
      requestId: String(l.request_id),
      novelId: l.novel_id ? String(l.novel_id) : null,
      chapterId: l.chapter_id ? String(l.chapter_id) : null,
      provider: l.provider,
      modelId: String(l.model_id),
      credentialSource: l.credential_source,
      inputTokensEst: Number(l.input_tokens_est || 0),
      outputTokensEst: Number(l.output_tokens_est || 0),
      estimatedCostUsd: Number(l.estimated_cost_usd || 0),
      status: String(l.status),
      durationMs: Number(l.duration_ms || 0),
      errorMessage: l.error_message ? String(l.error_message) : null,
      createdAt: String(l.created_at),
    })),
  });
});

app.get('/api/novels/:novelId/jobs', requireAuth, (req: AuthenticatedRequest, res) => {
  const jobs = db
    .prepare(
      `SELECT * FROM background_jobs WHERE novel_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(req.params.novelId, req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    jobs: jobs.map((j) => ({
      id: String(j.id),
      novelId: String(j.novel_id),
      chapterId: String(j.chapter_id),
      jobType: j.job_type,
      status: j.status,
      attempts: Number(j.attempts || 0),
      lastError: j.last_error ? String(j.last_error) : null,
      createdAt: String(j.created_at),
      updatedAt: String(j.updated_at),
    })),
  });
});

app.post('/api/jobs/:jobId/retry', requireAuth, (req: AuthenticatedRequest, res) => {
  const job = db
    .prepare('SELECT id FROM background_jobs WHERE id = ? AND user_id = ?')
    .get(req.params.jobId, req.user!.id) as { id: string } | undefined;
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  void processBackgroundJob(job.id);
  res.json({ ok: true });
});

// ============================================================================
// EXPORT & DOCUMENTATION ROUTES
// ============================================================================

app.get('/api/novels/:novelId/export/txt', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const includeStoryBible = req.query.includeStoryBible === 'true';
    const { filename, content } = generateTxtExport({
      userId: req.user!.id,
      novelId: req.params.novelId,
      includeStoryBible,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'TXT export failed' });
  }
});

app.get('/api/novels/:novelId/export/docx', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const includeStoryBible = req.query.includeStoryBible === 'true';
    const { filename, buffer } = await generateDocxExport({
      userId: req.user!.id,
      novelId: req.params.novelId,
      includeStoryBible,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'DOCX export failed' });
  }
});

app.get('/api/docs/architecture', (_req, res) => {
  const docPath = path.resolve(process.cwd(), 'docs/PLATFORM_AND_MIGRATION.md');
  if (!fs.existsSync(docPath)) {
    res.status(404).json({ error: 'Documentation not found.' });
    return;
  }
  res.json({ markdown: fs.readFileSync(docPath, 'utf8') });
});

// Error handler for multer & unexpected errors
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(400).json({ error: err.message || 'Bad request' });
  }
);

// ============================================================================
// VITE DEV MIDDLEWARE / STATIC PROD SERVING ON PORT 3000
// ============================================================================

async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Inkloom server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
