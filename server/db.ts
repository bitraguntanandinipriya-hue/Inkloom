import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'inkloom.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      name TEXT NOT NULL,
      google_sub TEXT,
      avatar_url TEXT,
      theme_preference TEXT NOT NULL DEFAULT 'system',
      editor_prefs_json TEXT NOT NULL,
      ai_prefs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL,
      synopsis TEXT NOT NULL DEFAULT '',
      cover_image_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      completed_at TEXT,
      trashed_at TEXT,
      story_dna_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_type TEXT NOT NULL,
      name TEXT NOT NULL,
      age TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      archetype TEXT NOT NULL DEFAULT '',
      personality TEXT NOT NULL DEFAULT '',
      psychological_traits TEXT NOT NULL DEFAULT '',
      triggers TEXT NOT NULL DEFAULT '',
      vulnerabilities TEXT NOT NULL DEFAULT '',
      relationship_dynamics TEXT NOT NULL DEFAULT '',
      relationships TEXT NOT NULL DEFAULT '',
      physical_appearance TEXT NOT NULL DEFAULT '',
      backstory TEXT NOT NULL DEFAULT '',
      character_development TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      custom_status TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      image_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      category TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      timeline_anchor TEXT NOT NULL DEFAULT '',
      location_anchor TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      word_count INTEGER NOT NULL DEFAULT 0,
      trashed_at TEXT,
      client_updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_versions (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT 'Snapshot',
      created_at TEXT NOT NULL,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS canon_facts (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      source_chapter_id TEXT,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapter_summaries (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      timeline_note TEXT NOT NULL DEFAULT '',
      locations_json TEXT NOT NULL DEFAULT '[]',
      characters_json TEXT NOT NULL DEFAULT '[]',
      objects_json TEXT NOT NULL DEFAULT '[]',
      revelations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_state_proposals (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      proposed_status TEXT NOT NULL,
      proposed_location TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scratchpad_notes (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Idea',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      endpoint_url TEXT,
      encrypted_api_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT 'untested',
      last_error TEXT,
      last_tested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      novel_id TEXT,
      chapter_id TEXT,
      request_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      credential_source TEXT NOT NULL,
      input_tokens_est INTEGER NOT NULL DEFAULT 0,
      output_tokens_est INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      novel_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novels_user ON novels(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, trashed_at, chapter_number);
    CREATE INDEX IF NOT EXISTS idx_canon_novel ON canon_facts(novel_id, is_pinned);
    CREATE INDEX IF NOT EXISTS idx_images_novel ON images(novel_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_creds_user ON provider_credentials(user_id, provider);
    CREATE INDEX IF NOT EXISTS idx_usage_user ON ai_usage_logs(user_id, created_at);
  `);
}

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}
