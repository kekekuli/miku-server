import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import styled from 'styled-components';
import { Avatar, Button, Heading, Text, TextField } from '@radix-ui/themes';
import { Page, Card } from '../../lib/styles';
import { useCreateIdentityMutation } from '../../lib/api';
import { useAccount, useProfile, useSessionInfo } from '../../hooks/useSession';

const Form = styled.form`
  width: min(400px, 80vw);
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
`;

const Verification = styled.div<{ $verified: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.8rem;
  border: 1px solid ${p => p.$verified ? 'var(--green-8)' : 'var(--gray-7)'};
  border-radius: 8px;
`;

function suggestedUsername(name: string): string {
  return name.normalize('NFKD').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
}

function apiError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return '创建用户名失败，请稍后重试';
}

export default function SignupPage() {
  const { profile, isLoading } = useProfile();
  const { account } = useAccount();
  const { session } = useSessionInfo();
  const [username, setUsername] = useState(() => sessionStorage.getItem('signupUsername') ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [remember, setRemember] = useState(() => sessionStorage.getItem('signupRemember') === 'true');
  const [error, setError] = useState<string | null>(null);
  const [createIdentity, { isLoading: isCreating }] = useCreateIdentityMutation();

  useEffect(() => {
    if (profile && !username) setUsername(suggestedUsername(profile.name));
  }, [profile, username]);

  useEffect(() => {
    sessionStorage.setItem('signupUsername', username);
    sessionStorage.setItem('signupRemember', String(remember));
  }, [username, remember]);

  if (!isLoading && account) return <Navigate to="/" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError('两次输入的密码不一致');
      return;
    }
    try {
      await createIdentity({ username, password }).unwrap();
      sessionStorage.removeItem('signupUsername');
      sessionStorage.removeItem('signupRemember');
    } catch (reason) {
      setError(apiError(reason));
    }
  };

  const startSteamVerification = () => {
    sessionStorage.setItem('signupUsername', username);
    sessionStorage.setItem('signupRemember', String(remember));
    window.location.assign(`/auth/steam?intent=signup&remember=${remember}`);
  };

  return (
    <Page>
      <Card>
        <Heading size="6" mb="2">注册用户名</Heading>
        <Text as="p" size="2" color="gray" mb="4">验证一次 Steam，以后即可使用用户名和密码登录。</Text>
        <Form onSubmit={event => { void submit(event); }}>
          <TextField.Root placeholder="用户名" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required />
          <Text size="1" color="gray">3–24 个字符，只能使用字母、数字和下划线；不区分大小写。</Text>
          <TextField.Root type="password" placeholder="密码" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={!profile} required />
          <TextField.Root type="password" placeholder="确认密码" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={!profile} required />
          <Text size="1" color="gray">至少 12 个字符，建议使用独一无二的长密码。</Text>
          <Verification $verified={!!profile}>
            {profile ? (
              <>
                <Avatar src={profile.avatar} fallback={profile.name[0] ?? '?'} size="2" />
                <div><Text color="green">✓ Steam 已验证</Text><br /><Text size="2">{profile.name}</Text></div>
              </>
            ) : (
              <><Text size="5">○</Text><Text>Steam 未验证</Text></>
            )}
          </Verification>
          {!profile && (
            <>
              <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{' '}记住我</label>
              <Button type="button" variant="soft" onClick={startSteamVerification}>验证 Steam</Button>
            </>
          )}
          {profile && session?.authMethod === 'steam' && <Text size="1" color="gray">当前 Steam 会话已通过验证，无需再次跳转。</Text>}
          {error && <Text color="red" size="2">{error}</Text>}
          <Button type="submit" disabled={!profile} loading={isCreating}>创建用户名</Button>
        </Form>
      </Card>
    </Page>
  );
}
