import { v4 as uuidv4 } from 'uuid';
import type { AiPreferences } from '../src/types';
import { DEFAULT_AI_PREFS } from './auth';
import { resolveCredentialForProvider, runSingleAiTextCompletion } from './aiProviders';
import { db } from './db';

const activeJobs = new Set<string>();

export async function runChapterSummaryAndExtraction(params: {
  userId: string;
  novelId: string;
  chapterId: string;
}): Promise<{
  summaryText: string;
  proposedCanonCount: number;
  proposedStateCount: number;
}> {
  const chapter = db
    .prepare(
      `SELECT * FROM chapters WHERE id = ? AND novel_id = ? AND user_id = ? AND trashed_at IS NULL`
    )
    .get(params.chapterId, params.novelId, params.userId) as
    | {
        id: string;
        chapter_number: number;
        title: string;
        content: string;
        timeline_anchor: string;
        location_anchor: string;
      }
    | undefined;

  if (!chapter || !chapter.content.trim()) {
    throw new Error('Chapter has no manuscript prose to summarize.');
  }

  const userRow = db.prepare('SELECT ai_prefs_json FROM users WHERE id = ?').get(params.userId) as
    | { ai_prefs_json: string }
    | undefined;
  let aiPrefs: AiPreferences = DEFAULT_AI_PREFS;
  if (userRow) {
    try {
      aiPrefs = { ...DEFAULT_AI_PREFS, ...JSON.parse(userRow.ai_prefs_json) };
    } catch {
      // default
    }
  }

  const characters = db
    .prepare('SELECT id, name, status, location FROM characters WHERE novel_id = ? AND user_id = ?')
    .all(params.novelId, params.userId) as Array<{
    id: string;
    name: string;
    status: string;
    location: string;
  }>;

  const modelId = aiPrefs.economicalModelId || 'gemini-3.1-flash-lite';
  const credential = resolveCredentialForProvider(params.userId, 'gemini');

  const systemInstruction = `You are Inkloom's Story Bible analyst.
Analyze the chapter prose carefully and return strict JSON ONLY with this structure:
{
  "summaryText": "Chronological ~140-160 word summary covering key plot events, character interactions, emotional shifts, revelations, timeline, locations, and important objects.",
  "timelineNote": "Short timeline marker",
  "locations": ["Location 1"],
  "characters": ["Character Name"],
  "objects": ["Important Object"],
  "revelations": ["Key revelation"],
  "proposedCanonFacts": [
    { "factText": "Concrete established world/character fact that must remain consistent", "category": "Plot | Relationship | World | Object" }
  ],
  "proposedCharacterStateChanges": [
    { "characterName": "Exact character name from cast", "proposedStatus": "Active | Injured | Missing | Estranged | Deceased", "proposedLocation": "New location if changed", "reason": "Brief justification from the text" }
  ]
}
Never invent facts not present in the chapter.`;

  const castSummary = characters
    .map((c) => `- ${c.name} (current status: ${c.status}, location: ${c.location || 'unspecified'})`)
    .join('\n');

  const userPrompt = `CHAPTER ${chapter.chapter_number}: ${chapter.title}
TIMELINE ANCHOR: ${chapter.timeline_anchor || 'Unspecified'}
LOCATION ANCHOR: ${chapter.location_anchor || 'Unspecified'}
KNOWN CAST:
${castSummary || 'None yet'}

MANUSCRIPT TEXT:
${chapter.content.slice(0, 28000)}`;

  const rawJson = await runSingleAiTextCompletion({
    credential,
    modelId,
    systemInstruction,
    userPrompt,
    jsonMode: true,
  });

  const cleaned = rawJson.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as {
    summaryText?: string;
    timelineNote?: string;
    locations?: string[];
    characters?: string[];
    objects?: string[];
    revelations?: string[];
    proposedCanonFacts?: Array<{ factText?: string; category?: string }>;
    proposedCharacterStateChanges?: Array<{
      characterName?: string;
      proposedStatus?: string;
      proposedLocation?: string;
      reason?: string;
    }>;
  };

  const now = new Date().toISOString();
  const summaryText = (parsed.summaryText || '').trim();
  if (!summaryText) {
    throw new Error('Model returned an empty chapter summary.');
  }

  // Upsert chapter summary
  const existingSummary = db
    .prepare('SELECT id FROM chapter_summaries WHERE chapter_id = ?')
    .get(chapter.id) as { id: string } | undefined;

  if (existingSummary) {
    db.prepare(
      `UPDATE chapter_summaries
       SET summary_text = ?, timeline_note = ?, locations_json = ?, characters_json = ?, objects_json = ?, revelations_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      summaryText,
      parsed.timelineNote || chapter.timeline_anchor || '',
      JSON.stringify(parsed.locations || []),
      JSON.stringify(parsed.characters || []),
      JSON.stringify(parsed.objects || []),
      JSON.stringify(parsed.revelations || []),
      now,
      existingSummary.id
    );
  } else {
    db.prepare(
      `INSERT INTO chapter_summaries
       (id, novel_id, chapter_id, user_id, summary_text, timeline_note, locations_json, characters_json, objects_json, revelations_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      params.novelId,
      chapter.id,
      params.userId,
      summaryText,
      parsed.timelineNote || chapter.timeline_anchor || '',
      JSON.stringify(parsed.locations || []),
      JSON.stringify(parsed.characters || []),
      JSON.stringify(parsed.objects || []),
      JSON.stringify(parsed.revelations || []),
      now,
      now
    );
  }

  // Queue proposed canon facts (NEVER auto-pinned — author must approve!)
  let proposedCanonCount = 0;
  for (const item of (parsed.proposedCanonFacts || []).slice(0, 4)) {
    const fact = item.factText?.trim();
    if (!fact) continue;
    const dup = db
      .prepare('SELECT id FROM canon_facts WHERE novel_id = ? AND lower(fact_text) = lower(?)')
      .get(params.novelId, fact);
    if (dup) continue;
    db.prepare(
      `INSERT INTO canon_facts (id, novel_id, user_id, fact_text, category, source_chapter_id, approval_status, is_pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    ).run(
      uuidv4(),
      params.novelId,
      params.userId,
      fact,
      item.category?.trim() || 'Plot',
      chapter.id,
      now,
      now
    );
    proposedCanonCount += 1;
  }

  // Queue proposed character state changes (NEVER silently alter character status!)
  let proposedStateCount = 0;
  for (const sc of (parsed.proposedCharacterStateChanges || []).slice(0, 4)) {
    const targetName = sc.characterName?.trim().toLowerCase();
    if (!targetName) continue;
    const charMatch = characters.find((c) => c.name.toLowerCase() === targetName);
    if (!charMatch) continue;
    const statusChanged =
      sc.proposedStatus && sc.proposedStatus !== charMatch.status;
    const locChanged =
      sc.proposedLocation && sc.proposedLocation.trim() && sc.proposedLocation !== charMatch.location;
    if (!statusChanged && !locChanged) continue;

    db.prepare(
      `INSERT INTO character_state_proposals
       (id, novel_id, chapter_id, character_id, user_id, proposed_status, proposed_location, reason, approval_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      uuidv4(),
      params.novelId,
      chapter.id,
      charMatch.id,
      params.userId,
      sc.proposedStatus || charMatch.status,
      sc.proposedLocation || charMatch.location,
      sc.reason || 'Observed in chapter prose.',
      now
    );
    proposedStateCount += 1;
  }

  return { summaryText, proposedCanonCount, proposedStateCount };
}

export function enqueueBackgroundSummaryJob(userId: string, novelId: string, chapterId: string) {
  const userRow = db.prepare('SELECT ai_prefs_json FROM users WHERE id = ?').get(userId) as
    | { ai_prefs_json: string }
    | undefined;
  if (userRow) {
    try {
      const prefs = JSON.parse(userRow.ai_prefs_json) as Partial<AiPreferences>;
      if (prefs.backgroundIntelligenceEnabled === false) {
        return null;
      }
    } catch {
      // continue
    }
  }

  const now = new Date().toISOString();
  const jobId = uuidv4();
  db.prepare(
    `INSERT INTO background_jobs (id, user_id, novel_id, chapter_id, job_type, status, attempts, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'summarize_and_extract', 'queued', 0, '{}', ?, ?)`
  ).run(jobId, userId, novelId, chapterId, now, now);

  void processBackgroundJob(jobId);
  return jobId;
}

export async function processBackgroundJob(jobId: string) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  try {
    const job = db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(jobId) as
      | {
          id: string;
          user_id: string;
          novel_id: string;
          chapter_id: string;
          attempts: number;
        }
      | undefined;
    if (!job) return;

    db.prepare(
      `UPDATE background_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), jobId);

    await runChapterSummaryAndExtraction({
      userId: job.user_id,
      novelId: job.novel_id,
      chapterId: job.chapter_id,
    });

    db.prepare(
      `UPDATE background_jobs SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE background_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`
    ).run(msg.slice(0, 300), new Date().toISOString(), jobId);
  } finally {
    activeJobs.delete(jobId);
  }
}
