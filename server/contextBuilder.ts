import type {
  AiProviderId,
  CharacterProfile,
  Novel,
  PreflightContextSummary,
  StoryDna,
} from '../src/types';
import { db } from './db';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Recognizes explicit author canon directives in prompts or notes:
 * "Remember that...", "Note that...", "Keep in mind...", "Important...",
 * "This is canon...", "Never change..."
 */
export function extractCanonDirectivesFromText(text: string): string[] {
  if (!text) return [];
  const cues = [
    /\b(?:remember that|note that|keep in mind(?: that)?|important[:\s]|this is canon[:\s]|never change[:\s])\s*([^.\n!?]+(?:[.\n!?]|$))/gi,
  ];
  const found = new Set<string>();
  for (const regex of cues) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const candidate = match[1]?.trim().replace(/[.!?]+$/, '').trim();
      if (candidate && candidate.length >= 12 && candidate.length <= 400) {
        found.add(candidate);
      }
    }
  }
  return Array.from(found);
}

interface BuildContextParams {
  userId: string;
  novelId: string;
  chapterId?: string;
  prompt: string;
  timelineAnchor?: string;
  locationAnchor?: string;
  targetWordCount: number;
  provider: AiProviderId;
  modelId: string;
  contextWindow: number;
  modelSupportsVision: boolean;
  credentialSource: 'managed' | 'author';
  credentialLabel: string;
  selectedImageIds?: string[];
  canonOverride?: string[];
  overrideStoryDna?: Partial<StoryDna>;
}

export interface AssembledGenerationContext {
  preflight: PreflightContextSummary;
  systemInstruction: string;
  userPrompt: string;
  attachedImages: Array<{ id: string; filePath: string; mimeType: string; title: string }>;
}

export function buildThreeLayerContext(params: BuildContextParams): AssembledGenerationContext {
  const novelRow = db
    .prepare('SELECT * FROM novels WHERE id = ? AND user_id = ?')
    .get(params.novelId, params.userId) as
    | {
        id: string;
        user_id: string;
        title: string;
        author_name: string;
        genre: string;
        synopsis: string;
        story_dna_json: string;
      }
    | undefined;

  if (!novelRow) {
    throw new Error('Novel not found.');
  }

  const baseDna: StoryDna = JSON.parse(novelRow.story_dna_json);
  const storyDna: StoryDna = { ...baseDna, ...(params.overrideStoryDna || {}) };

  // Layer 1: Story DNA & Approved Pinned Canon
  const canonRows = db
    .prepare(
      `SELECT id, fact_text, category FROM canon_facts
       WHERE novel_id = ? AND user_id = ? AND is_pinned = 1 AND approval_status = 'pinned'
       ORDER BY created_at ASC`
    )
    .all(params.novelId, params.userId) as Array<{ id: string; fact_text: string; category: string }>;

  const effectiveCanon =
    params.canonOverride !== undefined
      ? params.canonOverride.map((text, idx) => ({
          id: `override-${idx}`,
          fact_text: text,
          category: 'Author Review',
        }))
      : canonRows;

  // Characters
  const charRows = db
    .prepare(
      `SELECT * FROM characters WHERE novel_id = ? AND user_id = ? ORDER BY sort_order ASC, created_at ASC`
    )
    .all(params.novelId, params.userId) as Array<Record<string, unknown>>;

  const characters: CharacterProfile[] = charRows.map((c) => ({
    id: String(c.id),
    novelId: String(c.novel_id),
    userId: String(c.user_id),
    roleType: c.role_type as CharacterProfile['roleType'],
    name: String(c.name),
    age: String(c.age || ''),
    role: String(c.role || ''),
    archetype: String(c.archetype || ''),
    personality: String(c.personality || ''),
    psychologicalTraits: String(c.psychological_traits || ''),
    triggers: String(c.triggers || ''),
    vulnerabilities: String(c.vulnerabilities || ''),
    relationshipDynamics: String(c.relationship_dynamics || ''),
    relationships: String(c.relationships || ''),
    physicalAppearance: String(c.physical_appearance || ''),
    backstory: String(c.backstory || ''),
    characterDevelopment: String(c.character_development || ''),
    status: (c.status as CharacterProfile['status']) || 'Active',
    customStatus: String(c.custom_status || ''),
    location: String(c.location || ''),
    imageId: c.image_id ? String(c.image_id) : null,
    sortOrder: Number(c.sort_order || 0),
    createdAt: String(c.created_at),
    updatedAt: String(c.updated_at),
  }));

  // Layer 2: Relevant Historical Summaries (never dump all blindly; score by recency + entity/keyword overlap)
  const allSummaries = db
    .prepare(
      `SELECT cs.*, ch.chapter_number, ch.title as chapter_title
       FROM chapter_summaries cs
       JOIN chapters ch ON cs.chapter_id = ch.id
       WHERE cs.novel_id = ? AND cs.user_id = ? AND ch.trashed_at IS NULL
       ORDER BY ch.chapter_number ASC`
    )
    .all(params.novelId, params.userId) as Array<{
    id: string;
    chapter_id: string;
    chapter_number: number;
    chapter_title: string;
    summary_text: string;
    timeline_note: string;
    locations_json: string;
    characters_json: string;
    objects_json: string;
    revelations_json: string;
  }>;

  const queryText = `${params.prompt} ${params.timelineAnchor || ''} ${params.locationAnchor || ''}`.toLowerCase();
  const queryTerms = new Set(
    queryText
      .split(/[^a-z0-9\u00C0-\u024F]+/)
      .filter((w) => w.length >= 3)
  );

  // Reserve budget for Story DNA, Pinned Canon, Recent Prose, Prompt, and Output
  const maxInputBudgetTokens = Math.max(4000, Math.floor(params.contextWindow * 0.55));
  const summaryBudgetTokens = Math.min(3500, Math.floor(maxInputBudgetTokens * 0.25));

  const scoredSummaries = allSummaries
    .filter((s) => s.chapter_id !== params.chapterId)
    .map((s, idx, arr) => {
      let score = 0;
      // Recency boost (last 2 chapters prioritized)
      if (idx >= arr.length - 2) score += 10;
      const hay = `${s.summary_text} ${s.timeline_note} ${s.locations_json} ${s.characters_json} ${s.objects_json}`.toLowerCase();
      for (const term of queryTerms) {
        if (hay.includes(term)) score += 3;
      }
      return { summary: s, score };
    })
    .sort((a, b) => b.score - a.score || b.summary.chapter_number - a.summary.chapter_number);

  const selectedSummaries: typeof allSummaries = [];
  let usedSummaryTokens = 0;
  for (const item of scoredSummaries) {
    const tokens = estimateTokens(item.summary.summary_text) + 30;
    if (usedSummaryTokens + tokens <= summaryBudgetTokens) {
      selectedSummaries.push(item.summary);
      usedSummaryTokens += tokens;
    }
  }
  // Re-sort selected summaries chronologically
  selectedSummaries.sort((a, b) => a.chapter_number - b.chapter_number);

  // Layer 3: Immediate Previous Chapter Ending + Current Chapter Context
  const chapters = db
    .prepare(
      `SELECT id, chapter_number, title, content, timeline_anchor, location_anchor
       FROM chapters
       WHERE novel_id = ? AND user_id = ? AND trashed_at IS NULL
       ORDER BY chapter_number ASC`
    )
    .all(params.novelId, params.userId) as Array<{
    id: string;
    chapter_number: number;
    title: string;
    content: string;
    timeline_anchor: string;
    location_anchor: string;
  }>;

  let previousChapterEnding = '';
  if (chapters.length > 0) {
    const currentIdx = params.chapterId
      ? chapters.findIndex((c) => c.id === params.chapterId)
      : chapters.length;
    const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
    if (prevChapter && prevChapter.content.trim()) {
      const words = prevChapter.content.trim().split(/\s+/);
      const tail = words.slice(Math.max(0, words.length - 850)).join(' ');
      previousChapterEnding = `Previous Chapter (Ch. ${prevChapter.chapter_number}: ${prevChapter.title}) ending:\n${tail}`;
    }
  }

  // Reference Images & Written Notes
  const allNovelImages = db
    .prepare(
      `SELECT id, entity_type, entity_id, category, title, notes, mime_type, file_path
       FROM images WHERE novel_id = ? AND user_id = ?`
    )
    .all(params.novelId, params.userId) as Array<{
    id: string;
    entity_type: string;
    entity_id: string | null;
    category: string;
    title: string;
    notes: string;
    mime_type: string;
    file_path: string;
  }>;

  const requestedIds = new Set(params.selectedImageIds || []);
  const attachedImages =
    params.modelSupportsVision && requestedIds.size > 0
      ? allNovelImages
          .filter((img) => requestedIds.has(img.id))
          .map((img) => ({
            id: img.id,
            filePath: img.file_path,
            mimeType: img.mime_type,
            title: img.title || img.category,
          }))
      : [];

  const writtenImageNotes = allNovelImages
    .filter((img) => img.notes.trim() || img.title.trim())
    .map((img) => `- [${img.category.toUpperCase()}] ${img.title || 'Untitled'}: ${img.notes || 'Visual reference uploaded by author.'}`);

  // Build System Instruction
  const storyDnaBlock = [
    `NOVEL TITLE: ${novelRow.title}`,
    `GENRE: ${novelRow.genre}`,
    novelRow.synopsis ? `SYNOPSIS: ${novelRow.synopsis}` : '',
    `NARRATION LANGUAGE: ${storyDna.narrationLanguage}`,
    `DIALOGUE LANGUAGES: ${storyDna.dialogueLanguages.join(', ') || storyDna.narrationLanguage}`,
    `MIXED-LANGUAGE WRITING: ${storyDna.mixedLanguageWriting ? 'Allowed/Encouraged naturally' : 'Keep strictly in primary language'}`,
    `SCRIPT CONSTRAINT: ${storyDna.romanScriptOnly ? 'Use Roman/Latin script ONLY even for non-English dialogue phrases' : 'Use natural script as appropriate'}`,
    `PERSPECTIVE: ${storyDna.perspective}`,
    `TENSE: ${storyDna.tense}`,
    `PACING: ${storyDna.pacing}`,
    storyDna.contentBoundaries ? `CONTENT BOUNDARIES: ${storyDna.contentBoundaries}` : '',
    storyDna.writingRules ? `AUTHOR WRITING RULES: ${storyDna.writingRules}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const canonBlock =
    effectiveCanon.length > 0
      ? effectiveCanon.map((c, i) => `${i + 1}. [${c.category}] ${c.fact_text}`).join('\n')
      : 'No pinned canon facts recorded yet.';

  const castBlock =
    characters.length > 0
      ? characters
          .map((ch) => {
            const st = ch.status === 'Custom' && ch.customStatus ? ch.customStatus : ch.status;
            const details = [
              `${ch.name} (${ch.roleType.replace('_', ' ')}${ch.role ? `, ${ch.role}` : ''}${ch.age ? `, age ${ch.age}` : ''})`,
              `Status: ${st}${ch.location ? ` @ ${ch.location}` : ''}`,
              ch.personality ? `Personality: ${ch.personality}` : '',
              ch.psychologicalTraits ? `Psychology: ${ch.psychologicalTraits}` : '',
              ch.triggers ? `Triggers: ${ch.triggers}` : '',
              ch.vulnerabilities ? `Vulnerabilities: ${ch.vulnerabilities}` : '',
              ch.relationshipDynamics || ch.relationships
                ? `Dynamics: ${[ch.relationshipDynamics, ch.relationships].filter(Boolean).join('; ')}`
                : '',
              ch.physicalAppearance ? `Appearance: ${ch.physicalAppearance}` : '',
            ]
              .filter(Boolean)
              .join(' | ');
            return `- ${details}`;
          })
          .join('\n')
      : 'No characters configured yet.';

  const summariesBlock =
    selectedSummaries.length > 0
      ? selectedSummaries
          .map(
            (s) =>
              `Ch. ${s.chapter_number} (${s.chapter_title})${s.timeline_note ? ` [${s.timeline_note}]` : ''}: ${s.summary_text}`
          )
          .join('\n\n')
      : 'No prior chapter summaries available.';

  const systemInstruction = `You are Inkloom's literary fiction co-authoring engine, writing serious long-form novel prose strictly tailored to the author's Story DNA, character psychology, and established canon.

FICTIONAL CRAFT & CONTENT POLICY:
- Support complex fictional themes including dark romance, soft romance, obsession, possessiveness, forced marriage, kidnapping, violence, psychological tension, trauma, coercion, and morally complex characters.
- Passionate kissing, sensual touching, and non-explicit partial nudity are permitted when organically grounded in the scene; do NOT write graphic sexual descriptions or explicit sexual acts.
- Preserve character agency, emotional realism, gradual psychological development, cultural authenticity, and strict canon continuity. Avoid rushed forgiveness, unrealistic instant personality shifts, or gratuitous gore.
- Write rich, immersive, literary prose ready for publication. Do NOT include meta-commentary, AI disclaimers, or chapter outlines unless requested. Output ONLY the novel prose itself.

=== LAYER 1: STORY DNA ===
${storyDnaBlock}

=== LAYER 1: PINNED CANON (NEVER VIOLATE) ===
${canonBlock}

=== CAST & CURRENT CHARACTER STATES ===
${castBlock}
${writtenImageNotes.length > 0 ? `\n=== WRITTEN VISUAL REFERENCE NOTES ===\n${writtenImageNotes.join('\n')}` : ''}`;

  const userPromptParts = [
    `TARGET LENGTH: Approximately ${params.targetWordCount} words.`,
    params.timelineAnchor ? `TIMELINE ANCHOR: ${params.timelineAnchor}` : '',
    params.locationAnchor ? `LOCATION ANCHOR: ${params.locationAnchor}` : '',
    selectedSummaries.length > 0 ? `=== LAYER 2: RELEVANT PRIOR SUMMARIES ===\n${summariesBlock}` : '',
    previousChapterEnding ? `=== LAYER 3: IMMEDIATE CONTINUITY ===\n${previousChapterEnding}` : '',
    `=== AUTHOR SCENE PROMPT ===\n${params.prompt.trim()}`,
  ].filter(Boolean);

  const userPrompt = userPromptParts.join('\n\n');

  const estimatedStoryDnaTokens = estimateTokens(storyDnaBlock + castBlock);
  const estimatedCanonTokens = estimateTokens(canonBlock);
  const estimatedSummaryTokens = estimateTokens(summariesBlock);
  const estimatedRecentProseTokens = estimateTokens(previousChapterEnding);
  const estimatedPromptTokens = estimateTokens(params.prompt);
  const estimatedInputTokens = estimateTokens(systemInstruction) + estimateTokens(userPrompt);

  const warnings: string[] = [];
  if (estimatedInputTokens > params.contextWindow * 0.8) {
    warnings.push(
      `Input context (~${estimatedInputTokens.toLocaleString()} tokens) is near this model's ${params.contextWindow.toLocaleString()}-token context window.`
    );
  }
  if (requestedIds.size > 0 && !params.modelSupportsVision) {
    warnings.push(
      `Selected model (${params.modelId}) is text-only; written reference descriptions were sent instead of image files.`
    );
  }

  return {
    preflight: {
      provider: params.provider,
      modelId: params.modelId,
      credentialSource: params.credentialSource,
      credentialLabel: params.credentialLabel,
      modelSupportsVision: params.modelSupportsVision,
      contextWindow: params.contextWindow,
      estimatedInputTokens,
      estimatedPromptTokens,
      estimatedStoryDnaTokens,
      estimatedCanonTokens,
      estimatedSummaryTokens,
      estimatedRecentProseTokens,
      includedCanonCount: effectiveCanon.length,
      includedSummaryIds: selectedSummaries.map((s) => s.id),
      totalSummariesCount: allSummaries.length,
      includedCharacterNames: characters.map((c) => c.name),
      writtenImageNotesCount: writtenImageNotes.length,
      selectedImageIds: attachedImages.map((a) => a.id),
      warnings,
      assembledSystemPromptPreview: systemInstruction,
    },
    systemInstruction,
    userPrompt,
    attachedImages,
  };
}
