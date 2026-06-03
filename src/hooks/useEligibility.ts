import { useMemo } from 'react';
import { useGetEligibilityQuery } from '../lib/api';
import { LOCAL_CONDITIONS, LOCAL_KEYS } from '../lib/localConditions';
import type { ConditionLabel, EligibilityResult, VoteResult } from '../../shared/types';

export interface EligibilityEntry {
  conditions: EligibilityResult[];
  noGameStatus: boolean;
}

export function useEligibility(
  results: VoteResult[] | undefined,
  conditions: ConditionLabel[],
  selectedKeys: string[],
) {
  const remoteKeys = useMemo(
    () => selectedKeys.filter(k => !LOCAL_KEYS.has(k)),
    [selectedKeys]
  );

  const localKeys = useMemo(
    () => selectedKeys.filter(k => LOCAL_KEYS.has(k)),
    [selectedKeys]
  );

  const eligibilityRequest = useMemo(() =>
    results?.map(({ candidate }) => ({
      steamId: candidate.steamId,
      conditionKeys: remoteKeys,
    })) ?? [],
    [results, remoteKeys]
  );

  const { data: eligibilityData } = useGetEligibilityQuery(eligibilityRequest, {
    skip: remoteKeys.length === 0,
  });

  const eligibilityMap = useMemo(() => {
    if (selectedKeys.length === 0) return new Map<string, EligibilityEntry>();

    const map = new Map<string, EligibilityEntry>();

    if (remoteKeys.length > 0) {
      for (const r of eligibilityData ?? []) {
        map.set(r.steamId, { conditions: [...r.conditions], noGameStatus: r.noGameStatus });
      }
    }

    if (localKeys.length > 0 && results) {
      const activeLocal = LOCAL_CONDITIONS.filter(c => localKeys.includes(c.key));
      for (const { candidate } of results) {
        const ctx = { noGameStatus: candidate.profile.squad44Status === null };
        const localResults = activeLocal.map(c => ({ key: c.key, passed: c.resolve(ctx) }));
        const existing = map.get(candidate.steamId);
        if (existing) {
          existing.conditions = [...existing.conditions, ...localResults];
        } else {
          map.set(candidate.steamId, { conditions: localResults, noGameStatus: ctx.noGameStatus });
        }
      }
    }

    return map;
  }, [eligibilityData, selectedKeys, remoteKeys, localKeys, results]);

  const labelMap = useMemo(() =>
    new Map(conditions.map(c => [c.key, c.label])),
    [conditions]
  );

  return { eligibilityMap, labelMap };
}
