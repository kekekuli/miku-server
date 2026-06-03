import { useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import styled from 'styled-components';
import { Badge, Button, Flex, Text, TextField } from '@radix-ui/themes';
import { useSendRconMutation } from '../../lib/api';
import { openModal } from '../../lib/modalSlice';

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

interface LogLine {
  cmd: string;
  output: string;
  isError: boolean;
}

interface Props {
  rconEnabled: boolean;
}

export default function RconPanel({ rconEnabled }: Props) {
  const dispatch = useDispatch();
  const [command, setCommand] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [sendRcon, { isLoading }] = useSendRconMutation();

  const handleSubmit = async () => {
    if (!rconEnabled) {
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
    <Section>
      <Flex justify="between" align="center">
        <SectionTitle>RCON 终端</SectionTitle>
        {!rconEnabled && <Badge color="red">未配置</Badge>}
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
      <form onSubmit={e => { e.preventDefault(); void handleSubmit(); }}>
        <Flex gap="2">
          <TextField.Root
            placeholder="输入 RCON 命令..."
            value={command}
            onChange={e => setCommand(e.target.value)}
            disabled={isLoading}
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
          <Button type="submit" disabled={isLoading || !command.trim()}>
            发送
          </Button>
        </Flex>
      </form>
    </Section>
  );
}
