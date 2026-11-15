import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VAULT_KEY_PATH = path.join(DATA_DIR, '.vault_key');
const JWT_KEY_PATH = path.join(DATA_DIR, '.jwt_key');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let cachedVaultKey: Buffer | null = null;
let cachedJwtSecret: string | null = null;

export function getVaultKey(): Buffer {
  if (cachedVaultKey) return cachedVaultKey;
  const envSecret = process.env.CREDENTIAL_ENCRYPTION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    cachedVaultKey = crypto.createHash('sha256').update(envSecret).digest();
    return cachedVaultKey;
  }
  ensureDataDir();
  if (fs.existsSync(VAULT_KEY_PATH)) {
    const hex = fs.readFileSync(VAULT_KEY_PATH, 'utf8').trim();
    if (hex.length === 64) {
      cachedVaultKey = Buffer.from(hex, 'hex');
      return cachedVaultKey;
    }
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(VAULT_KEY_PATH, generated.toString('hex'), { mode: 0o600 });
  cachedVaultKey = generated;
  return cachedVaultKey;
}

export function getJwtSecret(): string {
  if (cachedJwtSecret) return cachedJwtSecret;
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    cachedJwtSecret = envSecret;
    return cachedJwtSecret;
  }
  ensureDataDir();
  if (fs.existsSync(JWT_KEY_PATH)) {
    const val = fs.readFileSync(JWT_KEY_PATH, 'utf8').trim();
    if (val.length >= 32) {
      cachedJwtSecret = val;
      return cachedJwtSecret;
    }
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(JWT_KEY_PATH, generated, { mode: 0o600 });
  cachedJwtSecret = generated;
  return cachedJwtSecret;
}

export function encryptSecret(plaintext: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedBuf = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encryptedBuf.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(encrypted: string, ivB64: string, authTagB64: string): string {
  const key = getVaultKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
