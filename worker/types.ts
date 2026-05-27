import type { AdminPermissions } from './lib/strapi';

export type Variables = { steamid: string };
export type AdminVariables = Variables & { adminPermissions: AdminPermissions };
