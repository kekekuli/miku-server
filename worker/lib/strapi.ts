import qs from 'qs';
import { withCache } from './cache';

export type AdminPermissions = Record<string, true>;

// Strapi v5 response shapes
interface StrapiListResponse<T> { data: T[] }
interface StrapiSingleResponse<T> { data: T }

// Filter operator types matching Strapi's query API
type FilterPrimitive = string | number | boolean;

type FilterOperator = {
  $eq?:        FilterPrimitive;
  $ne?:        FilterPrimitive;
  $gt?:        FilterPrimitive;
  $gte?:       FilterPrimitive;
  $lt?:        FilterPrimitive;
  $lte?:       FilterPrimitive;
  $contains?:  string;
  $in?:        FilterPrimitive[];
  $nin?:       FilterPrimitive[];
  $null?:      boolean;
};

// Primitive shorthand = $eq; or explicit operator object
type FilterValue = FilterPrimitive | FilterOperator;
export type Filters = Record<string, FilterValue>;

interface FindOptions {
  filters?: Filters;
  pagination?: { limit: number };
  cacheTtl?: number;
}

interface FindOneOptions {
  cacheTtl?: number;
}

function buildUrl(base: string, path: string, query: object): string {
  const queryString = qs.stringify(query, { encodeValuesOnly: true });
  return `${base}/api/${path}${queryString ? `?${queryString}` : ''}`;
}

async function request<T>(url: string, env: Env, cacheTtl?: number): Promise<T | null> {
  const doFetch = async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
    });
    if (!res.ok) return null;
    return res.json<T>();
  };

  return cacheTtl
    ? withCache(env.STEAM_PROFILE_CACHE, `strapi:${url}`, cacheTtl, doFetch)
    : doFetch();
}

export function strapi(env: Env) {
  return {
    async find<T>(collection: string, options: FindOptions = {}): Promise<T[]> {
      const query: Record<string, unknown> = {};
      if (options.filters)              query.filters = options.filters;
      if (options.pagination?.limit)    query.pagination = { limit: options.pagination.limit };

      const url = buildUrl(env.STRAPI_URL, collection, query);
      const res = await request<StrapiListResponse<T>>(url, env, options.cacheTtl);
      return res?.data ?? [];
    },

    async findOne<T>(uid: string, options: FindOneOptions = {}): Promise<T | null> {
      const url = buildUrl(env.STRAPI_URL, uid, {});
      const res = await request<StrapiSingleResponse<T>>(url, env, options.cacheTtl);
      return res?.data ?? null;
    },
  };
}

// --- Resource functions ---

interface StrapiAdminUser {
  steamId: string;
  [key: string]: unknown;
}

export async function getAdminPermissions(steamId: string, env: Env): Promise<AdminPermissions | null> {
  const users = await strapi(env).find<StrapiAdminUser>('miku-server-admin-users', {
    filters: { steamId },
    pagination: { limit: 1 },
    cacheTtl: 60,
  });

  if (!users.length) return null;

  const permissions: AdminPermissions = {};
  for (const [key, value] of Object.entries(users[0])) {
    if (key.startsWith('can') && value === true) {
      permissions[key] = true;
    }
  }

  return permissions;
}
