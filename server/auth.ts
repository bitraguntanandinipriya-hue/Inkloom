import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AiPreferences, EditorPreferences, UserProfile } from '../src/types';
import { getJwtSecret } from './crypto';
import { db, UPLOADS_DIR } from './db';

export const SESSION_COOKIE_NAME = 'inkloom_session';

export const DEFAULT_EDITOR_PREFS: EditorPreferences = {
  manuscriptFont: 'lora',
  fontSizePx: 18,
  lineSpacing: 1.75,
  maxWidthCh: 68,
  defaultChapterWordTarget: 2700,
  showParagraphGuides: false,
};

export const DEFAULT_AI_PREFS: AiPreferences = {
  defaultProvider: 'gemini',
  defaultModelId: 'gemini-4-hydrogen',
  backgroundIntelligenceEnabled: true,
  economicalModelId: 'gemini-3.1-flash-lite',
  thinkingMode: 'fast',
};

interface DbUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  google_sub: string | null;
  avatar_url: string | null;
  theme_preference: 'system' | 'light' | 'dark';
  editor_prefs_json: string;
  ai_prefs_json: string;
  created_at: string;
  updated_at: string;
}

export function serializeUser(row: DbUserRow): UserProfile {
  let editorPrefs = DEFAULT_EDITOR_PREFS;
  let aiPrefs = DEFAULT_AI_PREFS;
  try {
    editorPrefs = { ...DEFAULT_EDITOR_PREFS, ...JSON.parse(row.editor_prefs_json) };
  } catch {
    // keep default
  }
  try {
    aiPrefs = { ...DEFAULT_AI_PREFS, ...JSON.parse(row.ai_prefs_json) };
  } catch {
    // keep default
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    authMethod: row.google_sub && !row.password_hash ? 'google' : 'email',
    themePreference: row.theme_preference || 'system',
    editorPrefs,
    aiPrefs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

let cachedFirebaseProjectId: string | null = null;
function getFirebaseProjectId(): string | null {
  if (cachedFirebaseProjectId !== null) return cachedFirebaseProjectId || null;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
      cachedFirebaseProjectId = parsed.projectId || '';
      return cachedFirebaseProjectId || null;
    }
  } catch {
    // ignore missing config
  }
  cachedFirebaseProjectId = '';
  return null;
}

let cachedCerts: Record<string, string> = {};
let cachedCertsExpiresAt = 0;

async function fetchFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && Date.now() < cachedCertsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Unable to fetch Firebase public verification certificates.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cc = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = certs;
  cachedCertsExpiresAt = Date.now() + maxAgeSec * 1000;
  return certs;
}

export interface VerifiedFirebaseClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseClaims> {
  const projectId = getFirebaseProjectId();
  if (!projectId) {
    throw new Error('Firebase is not configured on this server.');
  }
  const decodedComplete = jwt.decode(idToken, { complete: true }) as {
    header?: { kid?: string; alg?: string };
  } | null;
  const kid = decodedComplete?.header?.kid;
  if (!kid || decodedComplete?.header?.alg !== 'RS256') {
    throw new Error('Invalid Firebase ID token header.');
  }

  let certs = await fetchFirebasePublicCerts(false);
  if (!certs[kid]) {
    certs = await fetchFirebasePublicCerts(true);
  }
  const cert = certs[kid];
  if (!cert) {
    throw new Error('Unknown Firebase signing key.');
  }

  const payload = jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  }) as VerifiedFirebaseClaims;

  if (!payload?.sub || !payload.email) {
    throw new Error('Firebase token missing subject or email.');
  }
  return payload;
}

export function upsertFirebaseUser(claims: VerifiedFirebaseClaims): UserProfile {
  const cleanEmail = claims.email.trim().toLowerCase();
  const now = new Date().toISOString();
  let row = db
    .prepare('SELECT * FROM users WHERE id = ? OR google_sub = ? OR email = ?')
    .get(claims.sub, claims.sub, cleanEmail) as DbUserRow | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO users (id, email, name, google_sub, avatar_url, theme_preference, editor_prefs_json, ai_prefs_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'system', ?, ?, ?, ?)`
    ).run(
      claims.sub,
      cleanEmail,
      claims.name?.trim() || cleanEmail.split('@')[0],
      claims.sub,
      claims.picture || null,
      JSON.stringify(DEFAULT_EDITOR_PREFS),
      JSON.stringify(DEFAULT_AI_PREFS),
      now,
      now
    );
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(claims.sub) as DbUserRow;
  } else if (!row.google_sub || (!row.avatar_url && claims.picture)) {
    db.prepare(
      'UPDATE users SET google_sub = COALESCE(google_sub, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?'
    ).run(claims.sub, claims.picture || null, now, row.id);
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id) as DbUserRow;
  }
  return serializeUser(row);
}

export function issueSessionCookie(res: Response, userId: string, req?: Request): string {
  const token = jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: '30d' });
  const forwardedProto = req?.headers['x-forwarded-proto'];
  const isHttps =
    Boolean(req?.secure) ||
    forwardedProto === 'https' ||
    process.env.NODE_ENV === 'production';

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

export function clearSessionCookie(res: Response, req?: Request) {
  const forwardedProto = req?.headers['x-forwarded-proto'];
  const isHttps =
    Boolean(req?.secure) ||
    forwardedProto === 'https' ||
    process.env.NODE_ENV === 'production';

  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
}

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = bearerToken || cookies[SESSION_COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Check if token is a Firebase RS256 ID token
  const decodedHeader = jwt.decode(token, { complete: true }) as {
    header?: { alg?: string };
  } | null;

  if (decodedHeader?.header?.alg === 'RS256') {
    try {
      const claims = await verifyFirebaseIdToken(token);
      req.user = upsertFirebaseUser(claims);
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Firebase session expired or invalid' });
      return;
    }
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { sub?: string };
    if (!decoded?.sub) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.sub) as
      | DbUserRow
      | undefined;
    if (!row) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    req.user = serializeUser(row);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid' });
  }
}

export async function registerUser(email: string, password: string, name: string) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    throw new Error('An account with this email already exists.');
  }
  const now = new Date().toISOString();
  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);
  const displayName = name.trim() || cleanEmail.split('@')[0];

  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, theme_preference, editor_prefs_json, ai_prefs_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'system', ?, ?, ?, ?)`
  ).run(
    id,
    cleanEmail,
    passwordHash,
    displayName,
    JSON.stringify(DEFAULT_EDITOR_PREFS),
    JSON.stringify(DEFAULT_AI_PREFS),
    now,
    now
  );

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow;
  return serializeUser(row);
}

export async function loginUser(email: string, password: string) {
  const cleanEmail = email.trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as
    | DbUserRow
    | undefined;
  if (!row || !row.password_hash) {
    throw new Error('Invalid email or password.');
  }
  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) {
    throw new Error('Invalid email or password.');
  }
  return serializeUser(row);
}

export async function verifyGoogleSignIn(idToken: string) {
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      'Google Sign-In is not configured on this server (missing VITE_GOOGLE_CLIENT_ID). Please use email sign-in.'
    );
  }
  const resp = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!resp.ok) {
    throw new Error('Failed to verify Google Sign-In token.');
  }
  const payload = (await resp.json()) as {
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: string;
    name?: string;
    picture?: string;
  };
  if (payload.aud !== clientId || !payload.sub || !payload.email) {
    throw new Error('Google token audience or identity mismatch.');
  }
  const cleanEmail = payload.email.toLowerCase();
  const now = new Date().toISOString();
  let row = db
    .prepare('SELECT * FROM users WHERE google_sub = ? OR email = ?')
    .get(payload.sub, cleanEmail) as DbUserRow | undefined;

  if (!row) {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO users (id, email, name, google_sub, avatar_url, theme_preference, editor_prefs_json, ai_prefs_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'system', ?, ?, ?, ?)`
    ).run(
      id,
      cleanEmail,
      payload.name || cleanEmail.split('@')[0],
      payload.sub,
      payload.picture || null,
      JSON.stringify(DEFAULT_EDITOR_PREFS),
      JSON.stringify(DEFAULT_AI_PREFS),
      now,
      now
    );
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow;
  } else if (!row.google_sub) {
    db.prepare(
      'UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?'
    ).run(payload.sub, payload.picture || null, now, row.id);
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id) as DbUserRow;
  }

  return serializeUser(row);
}

export function createPasswordResetToken(email: string): { resetToken: string; expiresAt: string } | null {
  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail) as
    | { id: string }
    | undefined;
  if (!user) return null;

  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO password_resets (id, user_id, token, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(uuidv4(), user.id, token, expiresAt, now.toISOString());

  return { resetToken: token, expiresAt };
}

export async function completePasswordReset(token: string, newPassword: string) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters long.');
  }
  const row = db
    .prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0')
    .get(token.trim()) as
    | { id: string; user_id: string; expires_at: string }
    | undefined;
  if (!row) {
    throw new Error('Reset token is invalid or already used.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error('Reset token has expired.');
  }
  const hash = await bcrypt.hash(newPassword, 10);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hash,
      now,
      row.user_id
    );
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
  })();
}

export function deleteUserAccount(userId: string) {
  const userDir = path.join(UPLOADS_DIR, userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
}
