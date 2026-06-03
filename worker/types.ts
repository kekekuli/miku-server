import type { AdminPermissions } from './lib/strapi';

export type Variables = { steamid: string };
export type AdminVariables = Variables & { adminPermissions: AdminPermissions };

export interface EligibilityRule {
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
  unit: 'hours' | 'minutes' | 'seconds';
}

export interface EligibilityCondition {
  key: string;
  label: string;
  field: string;
  rules: EligibilityRule[];
}
