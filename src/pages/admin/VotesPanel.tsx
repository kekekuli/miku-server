import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Badge, Button, Checkbox, Flex, Text } from '@radix-ui/themes';
import {
  useGetVotesQuery,
  useResetVotesMutation,
  useDeleteCandidateMutation,
} from '../../lib/api';
import FilterConditionSelect from '../../components/FilterConditionSelect';
import { useEligibility } from '../../hooks/useEligibility';
import { useFilterConditions } from '../../hooks/useFilterConditions';
import { filterCandidates } from '../../lib/filterCandidates';
import type { FilterMode, LogicMode } from '../../types';
import type { PendingAction } from './types';

const Section = styled.div`
  background: #2a475e;
  border-radius: 8px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const SectionTitle = styled.span`
  font-size: 0.85rem;
  font-weight: bold;
  color: #66c0f4;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const CandidateRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #1b2838;
  &:last-child { border-bottom: none; }
`;

const Avatar = styled.img`
  width: 36px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid #66c0f4;
  flex-shrink: 0;
`;

interface Props {
  permissions: Record<string, true>;
  onPending: (action: PendingAction) => void;
}

export default function VotesPanel({ permissions, onPending }: Props) {
  const { data: votes } = useGetVotesQuery();
  const conditions = useFilterConditions();
  const [resetVotes, { isLoading: resetting }] = useResetVotesMutation();
  const [deleteCandidate] = useDeleteCandidateMutation();

  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [logic, setLogic] = useState<LogicMode>('AND');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const { eligibilityMap, labelMap } = useEligibility(votes?.results, conditions, selectedKeys);

  const visibleCandidates = useMemo(
    () => filterCandidates(votes?.results ?? [], eligibilityMap, selectedKeys, logic, filterMode),
    [votes?.results, eligibilityMap, selectedKeys, logic, filterMode]
  );

  const toggleCandidate = (steamId: string) => {
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (next.has(steamId)) next.delete(steamId);
      else next.add(steamId);
      return next;
    });
  };

  return (
    <Section>
      <Flex justify="between" align="center" wrap="wrap" gap="2">
        <SectionTitle>投票管理</SectionTitle>
        <FilterConditionSelect
          conditions={conditions}
          selectedKeys={selectedKeys}
          logic={logic}
          filterMode={filterMode}
          onSelectedKeysChange={setSelectedKeys}
          onLogicChange={setLogic}
          onFilterModeChange={setFilterMode}
        />
        <Flex gap="2">
          {permissions.canManageCandidates && selectedCandidates.size > 0 && (
            <Button
              color="red"
              variant="soft"
              size="2"
              onClick={() => onPending({
                label: '删除所选候选人',
                description: `将移除 ${selectedCandidates.size} 位候选人及其所有投票记录，无法撤销。确定继续吗？`,
                run: () => {
                  selectedCandidates.forEach(id => { void deleteCandidate(id); });
                  setSelectedCandidates(new Set());
                },
              })}
            >
              删除所选 ({selectedCandidates.size})
            </Button>
          )}
          {permissions.canManageVotes && (
            <Button
              color="red"
              variant="soft"
              size="2"
              disabled={resetting}
              onClick={() => onPending({
                label: '重置所有投票',
                description: '此操作将清除所有投票记录，无法撤销。确定继续吗？',
                run: () => { void resetVotes(); },
              })}
            >
              重置所有投票
            </Button>
          )}
        </Flex>
      </Flex>

      {!visibleCandidates.length && (
        <Text size="2" color="gray">暂无候选人。</Text>
      )}

      {permissions.canManageCandidates && selectedCandidates.size > 0 && !!visibleCandidates.length && (
        <CandidateRow>
          <Checkbox
            checked={selectedCandidates.size === visibleCandidates.length ? true : 'indeterminate'}
            onCheckedChange={checked => {
              if (checked) setSelectedCandidates(new Set(visibleCandidates.map(r => r.candidate.steamId)));
              else setSelectedCandidates(new Set());
            }}
          />
          <Text size="2" color="gray">全选 ({visibleCandidates.length})</Text>
        </CandidateRow>
      )}

      {visibleCandidates.map(({ candidate, voteCount }) => {
        const entry = eligibilityMap.get(candidate.steamId);
        const passed = entry
          ? logic === 'AND' ? entry.conditions.every(r => r.passed) : entry.conditions.some(r => r.passed)
          : null;
        return (
          <CandidateRow key={candidate.steamId}>
            {permissions.canManageCandidates && (
              <Checkbox
                checked={selectedCandidates.has(candidate.steamId)}
                onCheckedChange={() => toggleCandidate(candidate.steamId)}
              />
            )}
            <Avatar src={candidate.profile.avatar} alt={candidate.profile.name} />
            <Flex direction="column" style={{ flex: 1 }}>
              <Text style={{ color: '#c6d4df' }} weight="medium">{candidate.profile.name}</Text>
              {entry && (
                <Flex gap="1" wrap="wrap" align="center">
                  {entry.noGameStatus && (
                    <Badge color="orange" size="1">无游戏数据</Badge>
                  )}
                  {entry.conditions.map(r => (
                    <Text key={r.key} size="1" color={r.passed ? 'green' : 'red'}>
                      {r.passed ? '✓' : '✗'} {labelMap.get(r.key) ?? r.key}
                    </Text>
                  ))}
                </Flex>
              )}
            </Flex>
            {passed !== null && (
              <Badge color={passed ? 'green' : 'red'} size="1">
                {passed ? '符合' : '不符合'}
              </Badge>
            )}
            <Text size="2" color="gray">{voteCount} 票</Text>
            {permissions.canManageCandidates && (
              <Button
                size="1"
                color="red"
                variant="soft"
                onClick={() => onPending({
                  label: '移除候选人',
                  description: `将移除候选人 ${candidate.profile.name} 及其所有投票记录，无法撤销。确定继续吗？`,
                  run: () => { void deleteCandidate(candidate.steamId); },
                })}
              >
                移除
              </Button>
            )}
          </CandidateRow>
        );
      })}
    </Section>
  );
}
