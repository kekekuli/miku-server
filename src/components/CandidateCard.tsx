import { useState } from 'react';
import styled from 'styled-components';
import { Badge, Button, Flex, Text, Tooltip } from '@radix-ui/themes';
import { useGetVotesQuery, useGetGameStatusQuery } from '../lib/api';
import type { EligibilityResult, GameStatus } from '../../shared/types';
import type { LogicMode } from '../types';

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
  eligibilityResults?: EligibilityResult[];
  noGameStatus?: boolean;
  labelMap?: Map<string, string>;
  logic?: LogicMode;
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
  eligibilityResults,
  noGameStatus,
  labelMap,
  logic = 'AND',
}: CandidateCardProps) {
  const totalVotes = useTotalVotes();
  const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

  const [hovered, setHovered] = useState(false);
  const { data: fetchedStatus, isFetching } = useGetGameStatusQuery(steamId, { skip: !hovered });
  const gameStatus = hovered ? (fetchedStatus ?? squad44Status) : squad44Status;

  const tooltipContent = isFetching
    ? '查询中…'
    : gameStatus
      ? `总游戏时间 ${formatHours(gameStatus.playtime_forever)}${gameStatus.playtime_2weeks != null ? ` · 近两周 ${formatHours(gameStatus.playtime_2weeks)}` : ''}`
      : '暂无游戏数据';

  return (
    <Card>
      <Flex align="center" gap="3">
        <Tooltip content={tooltipContent}>
          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            style={{ flexShrink: 0 }}
            onMouseEnter={() => setHovered(true)}
          >
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

      {eligibilityResults && eligibilityResults.length > 0 && (
        <Flex direction="column" gap="1">
          {noGameStatus && (
            <Badge color="orange" size="1">无法获取游戏数据</Badge>
          )}
          {eligibilityResults.map(r => (
            <Flex key={r.key} align="center" gap="1">
              <Text size="1">{r.passed ? '✓' : '✗'}</Text>
              <Text size="1" color={r.passed ? 'green' : 'red'}>{labelMap?.get(r.key) ?? r.key}</Text>
            </Flex>
          ))}
          <Badge color={
            logic === 'AND'
              ? eligibilityResults.every(r => r.passed) ? 'green' : 'red'
              : eligibilityResults.some(r => r.passed) ? 'green' : 'red'
          } size="1">
            {logic === 'AND'
              ? eligibilityResults.every(r => r.passed) ? '符合条件' : '不符合条件'
              : eligibilityResults.some(r => r.passed) ? '符合条件' : '不符合条件'
            }
          </Badge>
        </Flex>
      )}

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
