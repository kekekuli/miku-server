import type { VoteResult } from '../../shared/types';
import type { EligibilityEntry } from '../hooks/useEligibility';
import type { FilterMode, LogicMode } from '../types';

export function filterCandidates(
  results: VoteResult[],
  eligibilityMap: Map<string, EligibilityEntry>,
  selectedKeys: string[],
  logic: LogicMode,
  filterMode: FilterMode,
): VoteResult[] {
  if (filterMode === 'all' || selectedKeys.length === 0) return results;
  return results.filter(({ candidate }) => {
    const entry = eligibilityMap.get(candidate.steamId);
    if (!entry) return true;
    const pass = logic === 'AND'
      ? entry.conditions.every(r => r.passed)
      : entry.conditions.some(r => r.passed);
    return filterMode === 'passing' ? pass : !pass;
  });
}
