import { useState } from 'react';
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
import VotersModal from '../../components/VotersModal';
import { openModal } from '../../lib/modalSlice';
import type { VoterInfo } from '../../../shared/types';

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

  const dispatch = useDispatch();
  const [steamIdInput, setSteamIdInput] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<{ steamId: string; name: string; nominatedByProfile: VoterInfo } | null>(null);

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

      {votes?.results.length === 0 && (
        <Text color="gray" size="2">暂无候选人。</Text>
      )}

      <Grid>
        {votes?.results.map(({ candidate, voteCount, profileUrl, squad44Status, nominatedByProfile }) => (
          <CandidateCard
            key={candidate.steamId}
            steamId={candidate.steamId}
            name={candidate.name}
            avatar={candidate.avatar}
            voteCount={voteCount}
            isMyVote={votes.myVote === candidate.steamId}
            isSelf={me?.steamId === candidate.steamId}
            profileUrl={profileUrl}
            squad44Status={squad44Status}
            onVote={id => { void castVote(id); }}
            onUnvote={() => { void removeVote(); }}
            onCardClick={() => setSelectedCandidate({ steamId: candidate.steamId, name: candidate.name, nominatedByProfile })}
          />
        ))}
      </Grid>
    </Container>

    <VotersModal
      candidateId={selectedCandidate?.steamId ?? null}
      candidateName={selectedCandidate?.name ?? ''}
      nominatedByProfile={selectedCandidate?.nominatedByProfile ?? null}
      onClose={() => setSelectedCandidate(null)}
    />
    </>
  );
}
