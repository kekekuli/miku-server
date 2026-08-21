import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Button, Heading, Separator, Text, TextField } from '@radix-ui/themes';
import { Page, Card } from '../../lib/styles';
import { useLoginIdentityMutation } from '../../lib/api';

const Form = styled.form`
  width: min(360px, 80vw);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
`;

const Actions = styled.div`
  width: min(360px, 80vw);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const RememberOption = styled.label`
  width: min(360px, 80vw);
  margin: 0 auto 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  text-align: left;
  color: var(--gray-11);
  font-size: var(--font-size-2);
`;

const SteamButton = styled.a`
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1rem;
  border-radius: 6px;
  background: #1b2838;
  color: #66c0f4;
  text-align: center;
  text-decoration: none;
  font-weight: 600;
  border: 1px solid #2a475e;
`;

const FullButton = styled(Button)`
  width: 100%;
  min-height: 40px;
`;

function apiError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return '登录失败，请稍后重试';
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, { isLoading }] = useLoginIdentityMutation();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await login({ username, password, remember }).unwrap();
    } catch (reason) {
      setError(apiError(reason));
    }
  };

  return (
    <Page>
      <Card>
        <Heading size="7" mb="2">Miku Server</Heading>
        <Text as="p" size="2" color="gray" mb="5">使用用户名登录，或继续使用 Steam。</Text>
        <RememberOption>
          <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
          <span>记住登录状态（适用于用户名和 Steam）</span>
        </RememberOption>
        <Form onSubmit={event => { void submit(event); }}>
          <TextField.Root placeholder="用户名" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required />
          <TextField.Root type="password" placeholder="密码" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
          {error && <Text color="red" size="2">{error}</Text>}
          <FullButton type="submit" size="3" loading={isLoading}>用户名登录</FullButton>
        </Form>
        <Separator my="4" size="4" />
        <Actions>
          <SteamButton href={`/auth/steam?remember=${remember}`}>通过 Steam 登录</SteamButton>
          <FullButton asChild size="3" variant="soft"><Link to="/signup">注册用户名</Link></FullButton>
        </Actions>
      </Card>
    </Page>
  );
}
