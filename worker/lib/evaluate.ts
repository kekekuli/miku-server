import type { EligibilityCondition } from '../types';
import type { EligibilityResult } from '../../shared/types';

export type EvalContext = Record<string, () => Promise<number | undefined>>;

export function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let cache: Promise<T> | undefined;
  return () => cache ??= fn();
}

function normalize(value: number, unit: string): number {
  switch (unit) {
    case 'none': return value;
    case 'hours': return value * 60;
    case 'minutes': return value;
    case 'seconds': return value / 60;
    default: return value;
  }
}

function compare(value: number | undefined, operator: string, threshold: number): boolean {
  if (value === undefined) return false;
  switch (operator) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

export async function evaluate(conditions: EligibilityCondition[], context: EvalContext): Promise<EligibilityResult[]> {
  return Promise.all(conditions.map(async condition => {
    const value = await context[condition.field]?.();
    return {
      key: condition.key,
      passed: condition.rules.every(rule =>
        compare(value, rule.operator, normalize(rule.value, rule.unit))
      ),
    };
  }));
}

