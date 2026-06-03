import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { Button, Flex, Text, TextField } from '@radix-ui/themes';
import {
  useGetVotesQuery,
  useGetMeQuery,
  useCastVoteMutation,
  useRemoveVoteMutation,
  useNominateMutation,
} from '../../lib/api';
import CandidateCard from '../../components/CandidateCard';
import FilterConditionSelect from '../../components/FilterConditionSelect';
import VotersModal from '../../components/VotersModal';
import { openModal } from '../../lib/modalSlice';
import { useEligibility } from '../../hooks/useEligibility';
import { useFilterConditions } from '../../hooks/useFilterConditions';
import { filterCandidates } from '../../lib/filterCandidates';
import type { SteamProfile } from '../../../shared/types';
import type { FilterMode, LogicMode } from '../../types';

const Container = styled.div`
  flex: 1;
  background: #1b2838;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
`;

export default function VotePage() {
  const { data: votes } = useGetVotesQuery();
  const { data: me } = useGetMeQuery();
  const [castVote] = useCastVoteMutation();
  const [removeVote] = useRemoveVoteMutation();
  const [nominate, { isLoading: isNominating }] = useNominateMutation();
  const conditions = useFilterConditions();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [logic, setLogic] = useState<LogicMode>('AND');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const { eligibilityMap, labelMap } = useEligibility(votes?.results, conditions, selectedKeys);

  const visibleResults = useMemo(
    () => filterCandidates(votes?.results ?? [], eligibilityMap, selectedKeys, logic, filterMode),
    [votes?.results, eligibilityMap, selectedKeys, logic, filterMode]
  );

  const dispatch = useDispatch();
  const [steamIdInput, setSteamIdInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<{ steamId: string; name: string; nominatorProfile: SteamProfile } | null>(null);

  const handleNominate = async () => {
    const id = steamIdInput.trim();
    const result = await nominate(id || undefined);
    if ('error' in result) {
      const message = (result.error as { data?: string }).data ?? '提名失败';
      dispatch(openModal({ title: '提名失败', content: message }));
    } else {
      setSteamIdInput('');
    }
  };

  return (
    <>
      <Container>
        <form onSubmit={e => { e.preventDefault(); void handleNominate(); }}>
          <Flex gap="2" align="center">
            <TextField.Root
              placeholder="输入 Steam ID 提名玩家"
              value={steamIdInput}
              onChange={e => setSteamIdInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" disabled={isNominating}>
              {steamIdInput.trim() ? '提名' : '提名自己'}
            </Button>
          </Flex>
        </form>

        <FilterConditionSelect
          conditions={conditions}
          selectedKeys={selectedKeys}
          logic={logic}
          filterMode={filterMode}
          onSelectedKeysChange={setSelectedKeys}
          onLogicChange={setLogic}
          onFilterModeChange={setFilterMode}
        />

        {votes?.results.length === 0 && (
          <Text color="gray" size="2">暂无候选人。</Text>
        )}

        <Grid>
          {visibleResults.map(({ candidate, voteCount }) => (
            <CandidateCard
              key={candidate.steamId}
              steamId={candidate.steamId}
              name={candidate.profile.name}
              avatar={candidate.profile.avatar}
              voteCount={voteCount}
              isMyVote={votes?.myVote === candidate.steamId}
              isSelf={me?.steamId === candidate.steamId}
              profileUrl={candidate.profile.profileUrl}
              squad44Status={candidate.profile.squad44Status}
              onVote={id => { void castVote(id); }}
              onUnvote={() => { void removeVote(); }}
              onCardClick={() => setSelectedCandidate({ steamId: candidate.steamId, name: candidate.profile.name, nominatorProfile: candidate.nominatorProfile })}
            eligibilityResults={eligibilityMap.get(candidate.steamId)?.conditions}
            noGameStatus={eligibilityMap.get(candidate.steamId)?.noGameStatus}
            labelMap={labelMap}
            logic={logic}
            />
          ))}
        </Grid>
      </Container>

      <VotersModal
        candidateId={selectedCandidate?.steamId ?? null}
        candidateName={selectedCandidate?.name ?? ''}
        nominatorProfile={selectedCandidate?.nominatorProfile ?? null}
        onClose={() => setSelectedCandidate(null)}
      />
    </>
  );
}
