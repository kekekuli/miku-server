import qs from 'qs';
import { withCache } from './cache';
import type { EligibilityCondition, EligibilityRule } from '../types';

export type AdminPermissions = Record<string, true>;

// Strapi v5 response shapes
interface StrapiListResponse<T> { data: T[] }
interface StrapiSingleResponse<T> { data: T }

// Filter operator types matching Strapi's query API
type FilterPrimitive = string | number | boolean;

type FilterOperator = {
  $eq?: FilterPrimitive;
  $ne?: FilterPrimitive;
  $gt?: FilterPrimitive;
  $gte?: FilterPrimitive;
  $lt?: FilterPrimitive;
  $lte?: FilterPrimitive;
  $contains?: string;
  $containsi?: string;
  $in?: FilterPrimitive[];
  $nin?: FilterPrimitive[];
  $null?: boolean;
};

// Primitive shorthand = $eq; or explicit operator object
type FilterValue = FilterPrimitive | FilterOperator;
export type Filters = Record<string, FilterValue | Filters[]>;

interface FindOptions {
  filters?: Filters;
  pagination?: { limit: number } | { page: number; pageSize: number };
  populate?: string[];
  sort?: string;
  cacheTtl?: number;
}

interface StrapiPaginatedResponse<T> extends StrapiListResponse<T> {
  meta: { pagination: { page: number; pageSize: number; pageCount: number; total: number } };
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
      if (options.filters) query.filters = options.filters;
      if (options.pagination) query.pagination = options.pagination;
      if (options.populate) query.populate = options.populate;
      if (options.sort) query.sort = options.sort;

      const url = buildUrl(env.STRAPI_URL, collection, query);
      const res = await request<StrapiListResponse<T>>(url, env, options.cacheTtl);
      return res?.data ?? [];
    },

    async findPage<T>(collection: string, options: FindOptions): Promise<StrapiPaginatedResponse<T> | null> {
      const query: Record<string, unknown> = {};
      if (options.filters) query.filters = options.filters;
      if (options.pagination) query.pagination = options.pagination;
      if (options.populate) query.populate = options.populate;
      if (options.sort) query.sort = options.sort;
      const url = buildUrl(env.STRAPI_URL, collection, query);
      return request<StrapiPaginatedResponse<T>>(url, env, options.cacheTtl);
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

interface StrapiFilterRule {
  operator: string;
  value: number;
  unit: string;
}

interface StrapiFilterCondition {
  documentId: string;
  label: string;
  order: number;
  rules: StrapiFilterRule[];
  field_definition: { key: string } | null;
}

export async function getFilterConditions(env: Env): Promise<EligibilityCondition[]> {
  const items = await strapi(env).find<StrapiFilterCondition>('filter-conditions', {
    filters: {
      visibleInFilter: true,
    },
    populate: ['rules', 'field_definition'],
    sort: 'order',
    cacheTtl: 300,
  });

  return items
    .filter(item => item.field_definition !== null)
    .map(item => ({
      key: item.documentId,
      label: item.label,
      field: item.field_definition!.key,
      rules: item.rules.map(r => ({ operator: r.operator as EligibilityRule['operator'], value: r.value, unit: r.unit as EligibilityRule['unit'] })),
    }));
}

interface StrapiVoteGate {
  type: 'vote' | 'candidate',
  logic: 'AND' | 'OR',
  filter_conditions: StrapiFilterCondition[];
}
export interface VoteGate {
  logic: 'AND' | 'OR',
  conditions: EligibilityCondition[]
}

export async function getVoteGate(type: 'vote' | 'candidate', env: Env): Promise<VoteGate | null> {
  const items = await strapi(env).find<StrapiVoteGate>('vote-gates', {
    filters: { type },
    populate: ['filter_conditions', 'filter_conditions.rules', 'filter_conditions.field_definition'],
    pagination: { limit: 1 },
    cacheTtl: 300
  })
  if (!items.length) return null;

  const item = items[0];
  return {
    logic: item.logic,
    conditions: item.filter_conditions
      .filter(c => c.field_definition !== null)
      .map(c => ({
        key: c.documentId,
        label: c.label,
        field: c.field_definition!.key,
        rules: c.rules.map(r => ({ operator: r.operator as EligibilityRule['operator'], value: r.value, unit: r.unit as EligibilityRule['unit'] })),
      }))
  }
}

export interface GameServer {
  documentId: string;
  displayName: string;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  filesTunnelUrl: string;
  isActive: boolean;
}

// Cached well above the roster poll interval on purpose: withCache writes to KV on
// every miss, so a 60s TTL against a 60s cron would miss every tick and burn ~1,440
// KV writes/day against a 1,000/day free limit. Which server is active changes rarely,
// so ten minutes of staleness costs nothing.
const ACTIVE_SERVER_CACHE_TTL = 600;

export async function getActiveGameServer(env: Env): Promise<GameServer | null> {
  const servers = await strapi(env).find<GameServer>('game-servers', {
    filters: { isActive: true },
    pagination: { limit: 1 },
    cacheTtl: ACTIVE_SERVER_CACHE_TTL,
  });
  const server = servers[0];
  // rconPort is stored as a string field in Strapi (mirrors the old RCON_PORT env var)
  return server ? { ...server, rconPort: Number(server.rconPort) } : null;
}

export interface GameServerOption {
  id: string;
  displayName: string;
  isActive: boolean;
}

export async function listRconGameServers(env: Env): Promise<GameServerOption[]> {
  const servers = await strapi(env).find<GameServer>('game-servers', {
    cacheTtl: 60,
  });
  return servers
    .filter(s => s.rconHost && s.rconPort && s.rconPassword)
    .map(s => ({ id: s.documentId, displayName: s.displayName, isActive: s.isActive }));
}

export async function getGameServerById(id: string, env: Env): Promise<GameServer | null> {
  const server = await strapi(env).findOne<GameServer>(`game-servers/${id}`, { cacheTtl: 60 });
  return server ? { ...server, rconPort: Number(server.rconPort) } : null;
}

export interface GameMap {
  documentId: string;
  displayName: string;
  rconName: string;
  enabled: boolean;
  sortOrder: number;
}

export interface RconCommandPreset {
  documentId: string;
  displayName: string;
  baseCommand: string;
  argumentType: 'none' | 'map';
  supportsTrailingComma: boolean;
  confirmationRequired: boolean;
  enabled: boolean;
  sortOrder: number;
}

export async function listGameMapsPage(
  env: Env,
  options: { page: number; pageSize: number; search: string },
): Promise<{ items: GameMap[]; page: number; pageCount: number; total: number }> {
  const searchFilters: Filters[] = options.search
    ? [
        { displayName: { $containsi: options.search } },
        { rconName: { $containsi: options.search } },
      ]
    : [];
  const response = await strapi(env).findPage<GameMap>('game-maps', {
    filters: { enabled: true, ...(searchFilters.length ? { $or: searchFilters } : {}) },
    pagination: { page: options.page, pageSize: options.pageSize },
    sort: 'sortOrder:asc',
    cacheTtl: 60,
  });
  return {
    items: response?.data ?? [],
    page: response?.meta.pagination.page ?? options.page,
    pageCount: response?.meta.pagination.pageCount ?? 0,
    total: response?.meta.pagination.total ?? 0,
  };
}

export async function getGameMapById(id: string, env: Env): Promise<GameMap | null> {
  const map = await strapi(env).findOne<GameMap>(`game-maps/${id}`, { cacheTtl: 60 });
  return map?.enabled ? map : null;
}

export async function listRconCommandPresets(env: Env): Promise<RconCommandPreset[]> {
  return strapi(env).find<RconCommandPreset>('rcon-command-presets', {
    filters: { enabled: true },
    sort: 'sortOrder:asc',
    cacheTtl: 60,
  });
}

export async function getRconCommandPresetById(id: string, env: Env): Promise<RconCommandPreset | null> {
  const preset = await strapi(env).findOne<RconCommandPreset>(`rcon-command-presets/${id}`, { cacheTtl: 60 });
  return preset?.enabled ? preset : null;
}
