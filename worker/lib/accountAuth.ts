import { and, eq, gt, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { accounts, accountSessions } from '../../db/schema';

const PASSWORD_HASH_VERSION = 1;
// Cloudflare Workers WebCrypto rejects PBKDF2 counts above 100,000. Keep the
// versioned record so a future Argon2id/scrypt implementation can migrate hashes.
const PBKDF2_ITERATIONS = 100_000;
const SHORT_SESSION_SECONDS = 24 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TOUCH_SECONDS = 5 * 60;

export type AuthMethod = 'identity' | 'steam';

export interface AuthSession {
  sessionId: string | null;
  accountId: string | null;
  username: string | null;
  steamId: string | null;
  authMethod: AuthMethod;
  remembered: boolean;
  authenticatedAt: number;
}

export interface NewSession {
  token: string;
  expiresAt: number;
}

const encoder = new TextEncoder();

export function parseCookie(cookie: string): Record<string, string> {
  return Object.fromEntries(
    cookie.split(';').flatMap(part => {
      const [key, ...rest] = part.trim().split('=');
      return key ? [[key, rest.join('=')]] : [];
    }),
  );
}

function base64url(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export function normalizeUsername(username: string): string {
  return username.trim().normalize('NFKC').toLowerCase();
}

export function validateUsername(username: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_]{2,23}$/.test(username)) {
    return '用户名须为 3–24 个字符，且只能包含字母、数字和下划线';
  }
  const reserved = new Set(['admin', 'administrator', 'root', 'support', 'system', 'steam', 'miku']);
  return reserved.has(normalizeUsername(username)) ? '该用户名为系统保留名称，请更换一个' : null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 12) return '密码至少需要 12 个字符';
  if (password.length > 128) return '密码不能超过 128 个字符';
  return null;
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return base64url(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<{
  hash: string;
  salt: string;
  version: number;
}> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return { hash: await derivePassword(password, salt), salt: base64url(salt), version: PASSWORD_HASH_VERSION };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  version: number,
): Promise<boolean> {
  if (version !== PASSWORD_HASH_VERSION) return false;
  try {
    const salt = Uint8Array.fromBase64(storedSalt, { alphabet: 'base64url' });
    const candidate = await derivePassword(password, salt);
    const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(candidate)));
    const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(storedHash)));
    return crypto.subtle.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function createSession(
  env: Env,
  identity: { accountId: string | null; steamId: string | null },
  authMethod: AuthMethod,
  remembered: boolean,
): Promise<NewSession> {
  if (!identity.accountId && !identity.steamId) throw new Error('Session requires an account or Steam identity');
  const token = `s_${randomToken()}`;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (remembered ? REMEMBERED_SESSION_SECONDS : SHORT_SESSION_SECONDS);
  await drizzle(env.DB).insert(accountSessions).values({
    id: crypto.randomUUID(),
    tokenHash: await sha256(token),
    accountId: identity.accountId,
    steamId: identity.steamId,
    authMethod,
    remembered,
    createdAt: now,
    authenticatedAt: now,
    lastUsedAt: now,
    expiresAt,
    revokedAt: null,
  });
  return { token, expiresAt };
}

export async function resolveAuthToken(token: string | undefined, env: Env): Promise<AuthSession | null> {
  if (!token) return null;
  if (!token.startsWith('s_')) return null;

  const now = Math.floor(Date.now() / 1000);
  const db = drizzle(env.DB);
  const [row] = await db
    .select({
      id: accountSessions.id,
      accountId: accountSessions.accountId,
      username: accounts.username,
      steamId: accountSessions.steamId,
      authMethod: accountSessions.authMethod,
      remembered: accountSessions.remembered,
      authenticatedAt: accountSessions.authenticatedAt,
      lastUsedAt: accountSessions.lastUsedAt,
    })
    .from(accountSessions)
    .leftJoin(accounts, eq(accountSessions.accountId, accounts.id))
    .where(and(
      eq(accountSessions.tokenHash, await sha256(token)),
      isNull(accountSessions.revokedAt),
      gt(accountSessions.expiresAt, now),
    ))
    .limit(1);
  if (!row) return null;

  if (now - row.lastUsedAt >= SESSION_TOUCH_SECONDS) {
    await db.update(accountSessions).set({ lastUsedAt: now }).where(eq(accountSessions.id, row.id));
  }
  return {
    sessionId: row.id,
    accountId: row.accountId,
    username: row.username,
    steamId: row.steamId,
    authMethod: row.authMethod,
    remembered: row.remembered,
    authenticatedAt: row.authenticatedAt,
  };
}

export async function revokeSession(sessionId: string | null, env: Env): Promise<void> {
  if (!sessionId) return;
  await drizzle(env.DB)
    .update(accountSessions)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(accountSessions.id, sessionId));
}

export async function findAccountBySteamId(steamId: string, env: Env) {
  const [account] = await drizzle(env.DB).select().from(accounts).where(eq(accounts.steamId, steamId)).limit(1);
  return account ?? null;
}
