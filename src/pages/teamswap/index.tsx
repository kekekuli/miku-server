import { useState } from 'react';
import styled from 'styled-components';
import { Button, Flex, Text, TextField, Tooltip } from '@radix-ui/themes';
import {
  useGetTeamSwapStatusQuery,
  useSendTeamSwapMutation,
  useCancelTeamSwapMutation,
  useGetMeQuery,
} from '../../lib/api';
import type { TeamSwapRequest } from '../../../shared/types';

const Container = styled.div`
  flex: 1;
  background: #1b2838;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
`;

const Section = styled.div`
  background: #2a475e;
  border-radius: 8px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const SectionTitle = styled.div`
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8f98a0;
`;

const QuotaBadge = styled.span<{ $used: boolean }>`
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  background: ${p => p.$used ? 'rgba(255,80,80,0.15)' : 'rgba(100,200,100,0.15)'};
  color: ${p => p.$used ? '#ff8080' : '#7ec87e'};
  border: 1px solid ${p => p.$used ? 'rgba(255,80,80,0.3)' : 'rgba(100,200,100,0.3)'};
`;

const Notice = styled.div`
  font-size: 0.82rem;
  color: #8f98a0;
  line-height: 1.5;
`;

const Warning = styled.div`
  font-size: 0.82rem;
  color: #ff6b6b;
  line-height: 1.5;
`;

const ResultBanner = styled.div<{ $type: 'success' | 'pending' | 'error' }>`
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.88rem;
  background: ${p =>
    p.$type === 'success' ? 'rgba(100,200,100,0.12)' :
      p.$type === 'pending' ? 'rgba(200,160,60,0.12)' :
        'rgba(255,80,80,0.12)'};
  color: ${p =>
    p.$type === 'success' ? '#7ec87e' :
      p.$type === 'pending' ? '#d4a84b' :
        '#ff8080'};
  border: 1px solid ${p =>
    p.$type === 'success' ? 'rgba(100,200,100,0.25)' :
      p.$type === 'pending' ? 'rgba(200,160,60,0.25)' :
        'rgba(255,80,80,0.25)'};
`;

const RequestList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const RequestRow = styled.div<{ $isMine: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: ${p => p.$isMine ? 'rgba(74, 107, 165, 0.2)' : '#1b2838'};
  border: 1px solid ${p => p.$isMine ? 'rgba(74, 107, 165, 0.4)' : 'transparent'};
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
`;

const PlayerCell = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
`;

const Avatar = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 4px;
  flex-shrink: 0;
`;

const PlayerName = styled.span`
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Arrow = styled.span`
  color: #4e6b7c;
  font-size: 0.85rem;
  flex-shrink: 0;
`;

const Spacer = styled.div`
  flex: 1;
`;

const MyLabel = styled.span`
  font-size: 0.72rem;
  color: #8f98a0;
  white-space: nowrap;
`;

function PlayerChip({ player }: { player: TeamSwapRequest['requester'] }) {
  return (
    <PlayerCell title={player.steamId}>
      <Avatar src={player.avatar} alt={player.name} />
      <PlayerName>{player.name}</PlayerName>
    </PlayerCell>
  );
}

type FeedbackState =
  | { type: 'success'; message: string }
  | { type: 'pending'; message: string }
  | { type: 'error'; message: string }
  | null;

export default function TeamSwapPage() {
  const { data: me } = useGetMeQuery();
  const myId = me?.steamId;
  const { data: status, isLoading } = useGetTeamSwapStatusQuery();
  const [sendTeamSwap, { isLoading: isSending }] = useSendTeamSwapMutation();
  const [cancelTeamSwap, { isLoading: isCancelling }] = useCancelTeamSwapMutation();

  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const submit = async (targetSteamId: string) => {
    const id = targetSteamId.trim();
    if (!id) return;

    setFeedback(null);
    const result = await sendTeamSwap(id);

    if ('error' in result) {
      const data = (result.error as { data?: { error?: string } }).data;
      setFeedback({ type: 'error', message: data?.error ?? '请求失败' });
      return;
    }

    const data = result.data;
    if (data.status === 'changed') {
      const who = data.changedSteamId === myId ? '你' : '对方';
      const suffix = data.reason === 'low_hours' ? '（游戏时间不足200小时）' : '';
      setFeedback({ type: 'success', message: `已强制换队 ${who} ${suffix}`.trim() });
      setInput('');
    } else {
      setFeedback({ type: 'pending', message: data.message });
      setInput('');
    }
  };

  const handleCancel = async () => {
    setFeedback(null);
    await cancelTeamSwap();
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    void submit(input);
  };

  const requests: TeamSwapRequest[] = status?.requests ?? [];
  const busy = isSending || isCancelling;

  return (
    <Container>
      <Section>
        <Flex justify="between" align="center">
          <SectionTitle>自助跳边</SectionTitle>
          {!isLoading && status && (
            <Flex align="center" gap="2">
              <Text size="1" color="gray">今日剩余</Text>
              <QuotaBadge $used={status.usedToday}>
                {status.usedToday ? '0' : '1'} / 1
              </QuotaBadge>
            </Flex>
          )}
        </Flex>

        <Notice>
          输入对方 Steam ID 发送请求，若对方已有待匹配请求且双方都有今日剩余次数，则立即随机挑一人换队并扣除双方今日剩余次数，否则等待对方响应（5分钟有效）（200小时以下无限制）。
        </Notice>
        <Warning>禁止在打乱后的对局或开局5分钟后使用此功能，否则将面临封禁(200小时以下无限制)</Warning>
        <Warning>此功能会随机挑一人换边</Warning>

        <form onSubmit={handleSubmit}>
          <Flex gap="2" align="center">
            <TextField.Root
              placeholder="输入对方 Steam ID"
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              发送请求
            </Button>
          </Flex>
        </form>

        {feedback && (
          <ResultBanner $type={feedback.type}>{feedback.message}</ResultBanner>
        )}
      </Section>

      {!isLoading && (
        <Section>
          <Flex justify="between" align="center">
            <SectionTitle>等待匹配 ({requests.length})</SectionTitle>
            {status?.myPending && (
              <Button
                size="1"
                variant="ghost"
                color="red"
                disabled={busy}
                onClick={() => void handleCancel()}
              >
                取消我的请求
              </Button>
            )}
          </Flex>

          {requests.length === 0 ? (
            <Text size="2" color="gray">暂无待匹配请求</Text>
          ) : (
            <RequestList>
              {requests.map(req => {
                const isMine = req.requester.steamId === me?.steamId;
                return (
                  <RequestRow key={req.requester.steamId} $isMine={isMine}>
                    <PlayerChip player={req.requester} />
                    <Arrow>→</Arrow>
                    {req.target
                      ? <PlayerChip player={req.target} />
                      : <PlayerName style={{ color: '#4e6b7c' }}>未知</PlayerName>}
                    <Spacer />
                    {isMine ? (
                      <MyLabel>我的请求</MyLabel>
                    ) : (
                      <Tooltip content={req.target?.steamId !== myId ? '只有被请求的玩家才能匹配' : undefined}>
                        <Button
                          size="1"
                          variant="soft"
                          disabled={busy || req.target?.steamId !== myId}
                          onClick={() => void submit(req.requester.steamId)}
                        >
                          立即匹配
                        </Button>
                      </Tooltip>
                    )}
                  </RequestRow>
                );
              })}
            </RequestList>
          )}
        </Section>
      )}
    </Container>
  );
}
