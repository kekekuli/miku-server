export type AdminPermissions = Record<string, true>;

interface StrapiUser {
  steamId: string;
  displayName: string;
  [key: string]: unknown;
}

const CACHE_TTL = 60;
const CACHE_PREFIX = 'admin_perms:';

export async function getAdminPermissions(steamId: string, env: Env): Promise<AdminPermissions | null> {
  const cacheKey = `${CACHE_PREFIX}${steamId}`;

  const cached = await env.STEAM_PROFILE_CACHE.get(cacheKey);
  if (cached !== null) {
    return cached === '' ? null : (JSON.parse(cached) as AdminPermissions);
  }

  const url = `${env.STRAPI_URL}/api/miku-server-admin-users?filters[steamId][$eq]=${encodeURIComponent(steamId)}&pagination[limit]=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
  });

  if (!res.ok) return null;

  const body = await res.json<{ data: StrapiUser[] }>();

  if (!body.data?.length) {
    await env.STEAM_PROFILE_CACHE.put(cacheKey, '', { expirationTtl: CACHE_TTL });
    return null;
  }

  const user = body.data[0];
  const permissions: AdminPermissions = {};

  for (const [key, value] of Object.entries(user)) {
    if (key.startsWith('can') && value === true) {
      permissions[key] = true;
    }
  }

  await env.STEAM_PROFILE_CACHE.put(cacheKey, JSON.stringify(permissions), { expirationTtl: CACHE_TTL });
  return permissions;
}
