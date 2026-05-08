import type { SteamProfile } from '../../shared/types';

export function parseCookie(cookie: string): Record<string, string> {
  return Object.fromEntries(
    cookie.split(';').flatMap(part => {
      const [key, ...rest] = part.trim().split('=');
      return key ? [[key, rest.join('=')]] : [];
    })
  );
}

export async function verifyJWT(token: string, secret: string): Promise<{ steamid: string; exp: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const b64decode = (str: string) => Uint8Array.fromBase64(str, { alphabet: 'base64url' });

  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64decode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!isValid) return null;

  const decoded = JSON.parse(new TextDecoder().decode(b64decode(payload))) as { steamid: string; exp: number };
  if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

  return decoded;
}

export async function issueJWT(profile: SteamProfile, secret: string, expiresIn: string): Promise<string> {
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiresIn: ${expiresIn}`);
  const exp = Math.floor(Date.now() / 1000) + parseInt(match[1]) * units[match[2]];

  const encoder = new TextEncoder();
  const headerB64Url = encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toBase64({ alphabet: 'base64url', omitPadding: true });
  const payloadB64Url = encoder.encode(JSON.stringify({ steamid: profile.steamId, exp })).toBase64({ alphabet: 'base64url', omitPadding: true });
  const data = `${headerB64Url}.${payloadB64Url}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = new Uint8Array(sig).toBase64({ alphabet: 'base64url', omitPadding: true });
  return `${data}.${signature}`;
}
