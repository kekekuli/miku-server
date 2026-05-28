import styled from 'styled-components';
import { Badge, Button, Flex, Text, Tooltip } from '@radix-ui/themes';
import { useGetVotesQuery } from '../lib/api';
import type { GameStatus } from '../../shared/types';

const Card = styled.div`
  background: #2a475e;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const Avatar = styled.img`
  width: 52px;
  height: 52px;
  border-radius: 4px;
  border: 2px solid #66c0f4;
  flex-shrink: 0;
`;

const BarTrack = styled.div`
  height: 4px;
  border-radius: 2px;
  background: #1b2838;
  margin-top: 0.35rem;
  overflow: hidden;
`;

const BarFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${p => p.$pct}%;
  background: #66c0f4;
  border-radius: 2px;
  transition: width 0.3s ease;
`;

function useTotalVotes() {
  const { data } = useGetVotesQuery();
  return data?.results.reduce((sum, r) => sum + r.voteCount, 0) ?? 0;
}

export interface CandidateCardProps {
  steamId: string;
  name: string;
  avatar: string;
  voteCount: number;
  isMyVote: boolean;
  isSelf: boolean;
  profileUrl: string;
  squad44Status: GameStatus | null;
  onVote: (steamId: string) => void;
  onUnvote: () => void;
  onCardClick?: () => void;
  disabled?: boolean;
}

function formatHours(minutes: number) {
  return `${Math.floor(minutes / 60)}h`;
}

export default function CandidateCard({
  steamId,
  name,
  avatar,
  voteCount,
  isMyVote,
  isSelf,
  profileUrl,
  squad44Status,
  onVote,
  onUnvote,
  onCardClick,
  disabled,
}: CandidateCardProps) {
  const totalVotes = useTotalVotes();
  const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

  const tooltipContent = squad44Status
    ? `总游戏时间 ${formatHours(squad44Status.playtime_forever)}${squad44Status.playtime_2weeks != null ? ` · 近两周 ${formatHours(squad44Status.playtime_2weeks)}` : ''}`
    : '暂无游戏数据';

  return (
    <Card>
      <Flex align="center" gap="3">
        <Tooltip content={tooltipContent}>
          <a href={profileUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
            <Avatar src={avatar} alt={name} style={{ cursor: 'pointer' }} />
          </a>
        </Tooltip>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Flex align="center" gap="2" wrap="wrap">
            <Text
              weight="bold"
              style={{ color: '#c6d4df', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {name}
            </Text>
            {isSelf && <Badge color="blue" size="1">你</Badge>}
            {isMyVote && <Badge color="green" size="1">已投票</Badge>}
          </Flex>
          <Text
            size="1"
            color="gray"
            style={onCardClick ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
            onClick={onCardClick}
          >
            {voteCount} 票 · {percentage}%
          </Text>
          <BarTrack>
            <BarFill $pct={percentage} />
          </BarTrack>
        </div>
      </Flex>

      {!isSelf && (
        <Flex justify="end">
          <Button
            size="2"
            variant={isMyVote ? 'soft' : 'solid'}
            color={isMyVote ? 'gray' : 'green'}
            disabled={disabled}
            onClick={() => (isMyVote ? onUnvote() : onVote(steamId))}
          >
            {isMyVote ? '取消投票' : '投票'}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
