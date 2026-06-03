import { useMemo } from 'react';
import { useGetFilterConditionQuery } from '../lib/api';
import { LOCAL_CONDITIONS } from '../lib/localConditions';
import type { ConditionLabel } from '../../shared/types';

export function useFilterConditions(): ConditionLabel[] {
  const { data: remote = [] } = useGetFilterConditionQuery();
  return useMemo(() => [...LOCAL_CONDITIONS, ...remote], [remote]);
}
