import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Button, Flex, Text, TextField, Tooltip } from '@radix-ui/themes';
import {
  useGetTeamSwapStatusQuery,
  useSendTeamSwapMutation,
  useCancelTeamSwapMutation,
  useGetMeQuery,
  useGetRosterQuery,
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

const AdminBadge = styled.span`
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  background: rgba(180, 120, 220, 0.15);
  color: #c79ae0;
  border: 1px solid rgba(180, 120, 220, 0.35);
`;

const AdminNotice = styled.div`
  font-size: 0.82rem;
  line-height: 1.5;
  color: #c79ae0;
  background: rgba(180, 120, 220, 0.08);
  border: 1px solid rgba(180, 120, 220, 0.25);
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
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

const RosterList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 320px;
  overflow-y: auto;
`;

const RosterRow = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: ${p => p.$selected ? 'rgba(74, 107, 165, 0.3)' : '#1b2838'};
  border: 1px solid ${p => p.$selected ? 'rgba(74, 107, 165, 0.6)' : 'transparent'};
  border-radius: 6px;
  padding: 0.45rem 0.6rem;

  &:hover:not(:disabled) {
    background: ${p => p.$selected ? 'rgba(74, 107, 165, 0.35)' : '#22384d'};
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

// Shown when a player has no resolvable Steam profile, so the row still lines up
// with the avatars above and below it.
const AvatarFallback = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 4px;
  flex-shrink: 0;
  background: #2a475e;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  color: #8f98a0;
`;

const RosterNames = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.1rem;
`;

const SubText = styled.span`
  font-size: 0.72rem;
  color: #8f98a0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

function formatCountdown(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Anchors on the server's remaining seconds and ticks down locally, so the page
 * needs a single read rather than repeated polling. Re-anchors whenever the server
 * value changes, and calls onExpire once it reaches zero so the caller can resync.
 *
 * Display only — the server re-checks the cooldown on every submit.
 */
function useCountdown(seconds: number, onExpire?: () => void): number {
  const [remaining, setRemaining] = useState(seconds);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    setRemaining(seconds);
    if (seconds <= 0) return;

    const timer = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          expireRef.current?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  return remaining;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function RosterPicker({ myId, selectedId, onSelect }: {
  myId: string | undefined;
  selectedId: string;
  onSelect: (steamId: string) => void;
}) {
  const { data: roster, isFetching, refetch } = useGetRosterQuery();
  const [search, setSearch] = useState('');

  const players = roster?.players ?? [];
  const query = search.trim().toLowerCase();
  // Match on either name the player might be known by, plus the raw ID, since a
  // player's in-game name and Steam persona name often differ.
  const filtered = query
    ? players.filter(p =>
      p.name.toLowerCase().includes(query) ||
      (p.steamName?.toLowerCase().includes(query) ?? false) ||
      p.steamId.includes(query))
    : players;

  return (
    <Section>
      <Flex justify="between" align="center">
        <SectionTitle>在线玩家 ({roster?.playerCount ?? 0})</SectionTitle>
        <Flex align="center" gap="2">
          {roster && <Text size="1" color="gray">{formatAge(roster.ageSeconds)}更新</Text>}
          <Button size="1" variant="ghost" disabled={isFetching} onClick={() => void refetch()}>
            刷新
          </Button>
        </Flex>
      </Flex>

      {roster && !roster.parseOk && (
        <Warning>名单解析失败，以下为最后一次成功获取的结果，可能已过期。</Warning>
      )}

      {!roster ? (
        <Text size="2" color="gray">{isFetching ? '加载中…' : '暂无在线名单'}</Text>
      ) : (
        <>
          <TextField.Root
            placeholder="搜索名字或 Steam ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {filtered.length === 0 ? (
            <Text size="2" color="gray">
              {players.length === 0 ? '服务器当前无玩家' : '没有匹配的玩家'}
            </Text>
          ) : (
            <RosterList>
              {filtered.map(p => {
                const isMe = p.steamId === myId;
                return (
                  <RosterRow
                    key={p.steamId}
                    type="button"
                    $selected={p.steamId === selectedId}
                    disabled={isMe}
                    title={p.steamId}
                    onClick={() => onSelect(p.steamId)}
                  >
                    {p.avatar
                      ? <Avatar src={p.avatar} alt={p.name} />
                      : <AvatarFallback>?</AvatarFallback>}
                    <RosterNames>
                      <PlayerName>{p.name || p.steamName || p.steamId}</PlayerName>
                      {/* Fall back to the raw ID when there is no profile, so the row
                          is still actionable without a Steam name or avatar. */}
                      <SubText>{p.steamName ?? p.steamId}</SubText>
                    </RosterNames>
                    <Spacer />
                    {isMe && <MyLabel>我</MyLabel>}
                  </RosterRow>
                );
              })}
            </RosterList>
          )}

          {roster.connectingCount > 0 && (
            <Text size="1" color="gray">另有 {roster.connectingCount} 名玩家正在进入服务器</Text>
          )}
        </>
      )}
    </Section>
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
  const { data: status, isLoading, refetch } = useGetTeamSwapStatusQuery();
  const [sendTeamSwap, { isLoading: isSending }] = useSendTeamSwapMutation();
  const [cancelTeamSwap, { isLoading: isCancelling }] = useCancelTeamSwapMutation();

  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  // Set locally on a successful jump so the countdown starts immediately, without
  // waiting for the refetch to come back.
  const [localCooldown, setLocalCooldown] = useState<number | null>(null);

  const lowHours = status?.lowHours ?? false;
  // Server-decided; the wording comes with it so the two can never disagree.
  // For admins the server already reports blocked: null and cooldownSeconds: 0, so
  // nothing below needs to special-case them — isAdmin only drives the labelling.
  const blocked = status?.blocked ?? null;
  const isAdmin = status?.isAdmin ?? false;
  // Resync with the server the moment the timer runs out — the local tick is only
  // an estimate, and the server is the authority on whether the jump is allowed.
  const cooldown = useCountdown(localCooldown ?? status?.cooldownSeconds ?? 0, () => void refetch());
  const onCooldown = cooldown > 0;

  const submit = async (targetSteamId?: string) => {
    const id = targetSteamId?.trim();
    // Only low-hours players may submit without naming a target.
    if (!id && !lowHours) return;

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
      if (data.cooldownSeconds > 0) setLocalCooldown(data.cooldownSeconds);
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
              {isAdmin ? (
                <AdminBadge>管理员 · 不受限制</AdminBadge>
              ) : (
                <>
                  <Text size="1" color="gray">{onCooldown ? '冷却中' : '状态'}</Text>
                  <QuotaBadge $used={onCooldown}>
                    {onCooldown ? formatCountdown(cooldown) : lowHours ? '可跳边' : '可熟人认领'}
                  </QuotaBadge>
                </>
              )}
            </Flex>
          )}
        </Flex>

        {isAdmin && (
          <AdminNotice>
            你拥有 RCON 权限，不受 30 分钟冷却和「必须在服务器内」的限制。普通玩家仍受这两项约束。
          </AdminNotice>
        )}

        {lowHours ? (
          <>
            <Notice>
              你的游戏时长不足 200 小时，无需对方确认，点击下方按钮即可立即换边。每次换边后进入 30 分钟冷却。
            </Notice>
            <Warning>禁止在打乱后的对局或开局5分钟后使用此功能，否则将面临封禁</Warning>

            {blocked && <Warning>{status?.blockedMessage}</Warning>}

            <Button size="3" disabled={busy || onCooldown || !!blocked} onClick={() => void submit()}>
              {onCooldown ? `冷却中 ${formatCountdown(cooldown)}` : '一键跳边'}
            </Button>
          </>
        ) : (
          <>
            <Notice>
              在下方选择或直接输入对方 Steam ID 发送请求。双方互相发出请求后立即随机挑一人换边，随后双方各进入 30 分钟冷却；未匹配的请求 5 分钟内有效。
            </Notice>
            {/* Without this, a player with a private profile just silently loses the
                solo-jump path and has no idea why. */}
            {blocked && <Warning>{status?.blockedMessage}</Warning>}
            {status && !status.hoursKnown && (
              <Warning>
                无法读取你的游戏时长（Steam 个人资料未公开，或未公开游戏详情）。无法确认时长的玩家一律按 200 小时以上处理，需与他人互相确认才能换边。
              </Warning>
            )}
            <Warning>禁止在打乱后的对局或开局5分钟后使用此功能，否则将面临封禁</Warning>
            <Warning>此功能会随机挑一人换边</Warning>

            <form onSubmit={handleSubmit}>
              <Flex gap="2" align="center">
                <TextField.Root
                  placeholder="输入对方 Steam ID"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button type="submit" disabled={busy || onCooldown || !!blocked || !input.trim()}>
                  发送请求
                </Button>
              </Flex>
            </form>

            {onCooldown && (
              <Notice>冷却剩余 {formatCountdown(cooldown)}，结束后即可再次跳边。</Notice>
            )}
          </>
        )}

        {feedback && (
          <ResultBanner $type={feedback.type}>{feedback.message}</ResultBanner>
        )}
      </Section>

      {/* Low-hours players jump solo, so they have no target to pick. */}
      {!lowHours && <RosterPicker myId={myId} selectedId={input.trim()} onSelect={setInput} />}

      {/* Low-hours players never queue or match, so the list is not actionable for them. */}
      {!isLoading && !lowHours && (
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
                      <Tooltip content={
                        req.target?.steamId !== myId ? '只有被请求的玩家才能匹配'
                          : blocked ? status?.blockedMessage ?? undefined
                            : onCooldown ? `冷却中，剩余 ${formatCountdown(cooldown)}`
                              : undefined
                      }>
                        <Button
                          size="1"
                          variant="soft"
                          disabled={busy || onCooldown || !!blocked || req.target?.steamId !== myId}
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
