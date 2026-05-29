import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { AlertDialog, Badge, Button, Flex, Text, TextField } from '@radix-ui/themes';
import {
  useGetAdminMeQuery,
  useGetVotesQuery,
  useSendRconMutation,
  useResetVotesMutation,
  useDeleteCandidateMutation,
} from '../../lib/api';
import { openModal } from '../../lib/modalSlice';

const Container = styled.div`
  flex: 1;
  background: #1b2838;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  max-width: 1200px;
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

const SectionTitle = styled.span`
  font-size: 0.85rem;
  font-weight: bold;
  color: #66c0f4;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const Terminal = styled.div`
  background: #1b2838;
  border-radius: 4px;
  padding: 1rem;
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const LogEntry = styled.div<{ $isError?: boolean }>`
  color: ${p => (p.$isError ? '#ff6b6b' : '#c6d4df')};
  white-space: pre-wrap;
  word-break: break-word;
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

interface LogLine {
  cmd: string;
  output: string;
  isError: boolean;
}

interface PendingAction {
  label: string;
  description: string;
  run: () => void;
}

export default function AdminPage() {
  const { data, isLoading, isError } = useGetAdminMeQuery();
  const { data: votes } = useGetVotesQuery();
  const dispatch = useDispatch();

  const [command, setCommand] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const [sendRcon, { isLoading: rconLoading }] = useSendRconMutation();
  const [resetVotes, { isLoading: resetting }] = useResetVotesMutation();
  const [deleteCandidate] = useDeleteCandidateMutation();

  if (isLoading) return null;
  if (isError || !data || Object.keys(data.permissions).length === 0) {
    return <Navigate to="/" replace />;
  }

  const { permissions, features } = data;

  const handleRcon = async () => {
    if (!features.rcon) {
      dispatch(openModal({ title: 'RCON 未配置', content: '服务器尚未配置 RCON，请联系管理员设置相关环境变量。' }));
      return;
    }
    const cmd = command.trim();
    if (!cmd) return;
    setCommand('');
    const result = await sendRcon(cmd);
    const isError = 'error' in result;
    const output = isError
      ? ((result.error as { data?: { error?: string } }).data?.error ?? 'RCON 命令失败')
      : result.data.output;
    setLog(prev => [...prev, { cmd, output, isError }]);
    setTimeout(() => terminalRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
  };

  return (
    <Container>
      {permissions.canRcon && (
        <Section>
          <Flex justify="between" align="center">
            <SectionTitle>RCON 终端</SectionTitle>
            {!features.rcon && <Badge color="red">未配置</Badge>}
          </Flex>

          <Terminal ref={terminalRef}>
            {log.length === 0 && (
              <Text size="1" color="gray">输入命令并按回车发送...</Text>
            )}
            {log.map((entry, i) => (
              <div key={i}>
                <LogEntry style={{ color: '#66c0f4' }}>{'> '}{entry.cmd}</LogEntry>
                <LogEntry $isError={entry.isError}>{entry.output || '(no output)'}</LogEntry>
              </div>
            ))}
          </Terminal>

          <form onSubmit={e => { e.preventDefault(); void handleRcon(); }}>
            <Flex gap="2">
              <TextField.Root
                placeholder="输入 RCON 命令..."
                value={command}
                onChange={e => setCommand(e.target.value)}
                disabled={rconLoading}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <Button type="submit" disabled={rconLoading || !command.trim()}>
                发送
              </Button>
            </Flex>
          </form>
        </Section>
      )}

      {(permissions.canManageVotes || permissions.canManageCandidates) && (
        <Section>
          <Flex justify="between" align="center">
            <SectionTitle>投票管理</SectionTitle>
            {permissions.canManageVotes && (
              <Button
                color="red"
                variant="soft"
                size="2"
                disabled={resetting}
                onClick={() => setPending({
                  label: '重置所有投票',
                  description: '此操作将清除所有投票记录，无法撤销。确定继续吗？',
                  run: () => { void resetVotes(); },
                })}
              >
                重置所有投票
              </Button>
            )}
          </Flex>

          {!votes?.results.length && (
            <Text size="2" color="gray">暂无候选人。</Text>
          )}

          {votes?.results.map(({ candidate, voteCount }) => (
            <CandidateRow key={candidate.steamId}>
              <Avatar src={candidate.profile.avatar} alt={candidate.profile.name} />
              <Text style={{ flex: 1, color: '#c6d4df' }} weight="medium">{candidate.profile.name}</Text>
              <Text size="2" color="gray">{voteCount} 票</Text>
              {permissions.canManageCandidates && (
                <Button
                  size="1"
                  color="red"
                  variant="soft"
                  onClick={() => setPending({
                    label: '移除候选人',
                    description: `将移除候选人 ${candidate.profile.name} 及其所有投票记录，无法撤销。确定继续吗？`,
                    run: () => { void deleteCandidate(candidate.steamId); },
                  })}
                >
                  移除
                </Button>
              )}
            </CandidateRow>
          ))}
        </Section>
      )}

      <AlertDialog.Root open={!!pending} onOpenChange={v => { if (!v) setPending(null); }}>
        <AlertDialog.Content>
          <AlertDialog.Title>{pending?.label}</AlertDialog.Title>
          <AlertDialog.Description>{pending?.description}</AlertDialog.Description>
          <Flex gap="3" justify="end" mt="4">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() => { pending?.run(); setPending(null); }}
              >
                确认
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Container>
  );
}
