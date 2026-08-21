import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Heading, Text, TextField } from '@radix-ui/themes';
import { Page, Card } from '../../lib/styles';
import { useUnlinkSteamMutation } from '../../lib/api';
import { useAccount, useProfile, useSessionInfo } from '../../hooks/useSession';

function apiError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return '操作失败，请稍后重试';
}

export default function AccountPage() {
  const { account } = useAccount();
  const { profile } = useProfile();
  const { session } = useSessionInfo();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unlink, { isLoading }] = useUnlinkSteamMutation();

  const unlinkSteam = async () => {
    if (!window.confirm('解绑后，投票、跳边和管理员功能将不可用，直到重新绑定 Steam。确定继续吗？')) return;
    setError(null);
    try {
      await unlink({ password }).unwrap();
      setPassword('');
    } catch (reason) {
      setError(apiError(reason));
    }
  };

  return (
    <Page>
      <Card>
        <Heading size="6" mb="3">账户设置</Heading>
        {account ? (
          <>
            <Text as="p">用户名：{account.username}</Text>
            {profile ? (
              <>
                <Text as="p" mt="3">已绑定 Steam：{profile.name}</Text>
                <TextField.Root
                  mt="3"
                  type="password"
                  placeholder="输入密码以解绑 Steam"
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
                {error && <Text as="p" color="red" size="2" mt="2">{error}</Text>}
                <Button mt="3" color="red" variant="soft" disabled={!password} loading={isLoading} onClick={() => { void unlinkSteam(); }}>
                  解绑 Steam
                </Button>
              </>
            ) : (
              <>
                <Text as="p" color="gray" mt="3">当前没有绑定 Steam，游戏相关功能不可用。</Text>
                <Button asChild mt="3"><a href={`/auth/steam?intent=link&remember=${session?.remembered === true}`}>绑定 Steam</a></Button>
              </>
            )}
          </>
        ) : profile ? (
          <>
            <Text as="p">Steam：{profile.name}</Text>
            <Text as="p" color="gray" mt="2">创建用户名后，下次无需通过 Steam 登录。</Text>
            <Button asChild mt="3"><Link to="/signup">创建用户名</Link></Button>
          </>
        ) : null}
      </Card>
    </Page>
  );
}
