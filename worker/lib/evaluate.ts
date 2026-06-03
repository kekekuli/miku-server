import type { EligibilityCondition } from '../types';
import type { EligibilityResult } from '../../shared/types';

export type EvalContext = Record<string, number | undefined>;

function toMinutes(value: number, unit: string): number {
  switch (unit) {
    case 'hours':   return value * 60;
    case 'minutes': return value;
    case 'seconds': return value / 60;
    default:        return value;
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

export function evaluate(conditions: EligibilityCondition[], context: EvalContext): EligibilityResult[] {
  return conditions.map(condition => ({
    key: condition.key,
    passed: condition.rules.every(rule =>
      compare(context[condition.field], rule.operator, toMinutes(rule.value, rule.unit))
    ),
  }));
}
