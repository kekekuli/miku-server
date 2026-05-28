import { Dialog, Flex, Text, Spinner, Separator } from '@radix-ui/themes';
import { useGetVotersQuery } from '../lib/api';
import type { VoterInfo } from '../../shared/types';

interface Props {
  candidateId: string | null;
  candidateName: string;
  nominatedByProfile: VoterInfo | null;
  onClose: () => void;
}

function VoterRow({ voter }: { voter: VoterInfo }) {
  return (
    <Flex align="center" gap="2">
      {voter.avatar && (
        <img
          src={voter.avatar}
          alt={voter.name}
          style={{ width: 32, height: 32, borderRadius: 4, flexShrink: 0 }}
        />
      )}
      <a
        href={voter.profileUrl}
        target="_blank"
        rel="noreferrer"
        style={{ color: '#66c0f4', textDecoration: 'none', fontSize: 14 }}
      >
        {voter.name}
      </a>
    </Flex>
  );
}

export default function VotersModal({ candidateId, candidateName, nominatedByProfile, onClose }: Props) {
  const { data: voters, isLoading } = useGetVotersQuery(candidateId ?? '', { skip: !candidateId });

  return (
    <Dialog.Root open={!!candidateId} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Content maxWidth="400px">
        <Dialog.Title>关于 {candidateName}</Dialog.Title>

        {nominatedByProfile && (
          <Flex direction="column" gap="1" mb="3">
            <Text size="1" color="gray" weight="bold">提名人</Text>
            <VoterRow voter={nominatedByProfile} />
          </Flex>
        )}

        <Separator size="4" mb="3" />

        <Text size="1" color="gray" weight="bold">投票玩家</Text>

        {isLoading && (
          <Flex justify="center" py="4">
            <Spinner />
          </Flex>
        )}

        {!isLoading && voters?.length === 0 && (
          <Text color="gray" size="2" mt="2" style={{ display: "block" }}>暂无投票</Text>
        )}

        {!isLoading && voters && voters.length > 0 && (
          <Flex direction="column" gap="2" mt="2">
            {voters.map(voter => (
              <VoterRow key={voter.steamId} voter={voter} />
            ))}
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
