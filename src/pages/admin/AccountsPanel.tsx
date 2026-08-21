import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Badge, Button, Flex, Text, TextField } from '@radix-ui/themes';
import {
  useDeleteAccountMutation,
  useGetAdminAccountsQuery,
  useResetAccountPasswordMutation,
} from '../../lib/api';
import type { PendingAction } from './types';

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

const AccountRow = styled.div`
  background: #1b2838;
  border-radius: 6px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const AccountMeta = styled.div`
  color: #8f98a0;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
`;

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return '操作失败，请稍后重试';
}

interface Props {
  onPending: (action: PendingAction) => void;
}

export default function AccountsPanel({ onPending }: Props) {
  const { data: accounts, isLoading } = useGetAdminAccountsQuery();
  const [resetPassword, { isLoading: isResetting }] = useResetAccountPasswordMutation();
  const [deleteAccount] = useDeleteAccountMutation();
  const [search, setSearch] = useState('');
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return accounts ?? [];
    return (accounts ?? []).filter(account =>
      account.username.toLowerCase().includes(query) || account.steamId?.includes(query),
    );
  }, [accounts, search]);

  const handleReset = async (accountId: string, username: string) => {
    const password = passwords[accountId] ?? '';
    setMessage(null);
    try {
      await resetPassword({ accountId, password }).unwrap();
      setPasswords(current => ({ ...current, [accountId]: '' }));
      setMessage(`已修改 ${username} 的密码，并撤销其全部登录会话`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <Section>
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <SectionTitle>账户管理</SectionTitle>
        <Badge color="blue">{accounts?.length ?? 0} 个 identity</Badge>
      </Flex>
      <Text size="2" color="gray">
        修改密码或删除 identity 都会使该账户的全部会话失效。删除 identity 不会删除 Steam 资料。
      </Text>
      <TextField.Root
        placeholder="按用户名或 Steam ID 搜索"
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      {message && <Text size="2" color="gray">{message}</Text>}
      {isLoading && <Text size="2" color="gray">正在加载账户...</Text>}
      {!isLoading && visibleAccounts.length === 0 && (
        <Text size="2" color="gray">没有找到符合条件的账户</Text>
      )}
      {visibleAccounts.map(account => (
        <AccountRow key={account.id}>
          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <div>
              <Text weight="bold">{account.username}</Text>
              <AccountMeta>
                Steam：{account.steamId ?? '未绑定'} · 创建于{' '}
                {new Date(account.createdAt * 1000).toLocaleString('zh-CN')}
              </AccountMeta>
            </div>
            <Button
              color="red"
              variant="soft"
              onClick={() => onPending({
                label: `删除 ${account.username} 的 identity？`,
                description: '该 identity 和所有登录会话将被永久删除。Steam 资料不会删除，用户之后仍可通过 Steam 登录并重新创建 identity。',
                run: () => {
                  void deleteAccount(account.id).unwrap().catch(error => setMessage(errorMessage(error)));
                },
              })}
            >
              删除 identity
            </Button>
          </Flex>
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              type="password"
              placeholder="输入新密码（至少 12 个字符）"
              value={passwords[account.id] ?? ''}
              onChange={event => setPasswords(current => ({
                ...current,
                [account.id]: event.target.value,
              }))}
              style={{ flex: '1 1 260px' }}
            />
            <Button
              disabled={isResetting || (passwords[account.id]?.length ?? 0) < 12}
              onClick={() => { void handleReset(account.id, account.username); }}
            >
              修改密码
            </Button>
          </Flex>
        </AccountRow>
      ))}
    </Section>
  );
}
