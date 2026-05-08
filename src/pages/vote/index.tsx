import { useState } from 'react';
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

  const [steamIdInput, setSteamIdInput] = useState('');

  const handleNominate = async () => {
    const id = steamIdInput.trim();
    await nominate(id || undefined);
    setSteamIdInput('');
  };

  return (
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
        {votes?.results.map(({ candidate, voteCount }) => (
          <CandidateCard
            key={candidate.steamId}
            steamId={candidate.steamId}
            name={candidate.name}
            avatar={candidate.avatar}
            voteCount={voteCount}
            isMyVote={votes.myVote === candidate.steamId}
            isSelf={me?.steamId === candidate.steamId}
            onVote={id => { void castVote(id); }}
            onUnvote={() => { void removeVote(); }}
          />
        ))}
      </Grid>
    </Container>
  );
}
