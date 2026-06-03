import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import styled from 'styled-components';
import { AlertDialog, Button, Flex } from '@radix-ui/themes';
import { useGetAdminMeQuery } from '../../lib/api';
import RconPanel from './RconPanel';
import VotesPanel from './VotesPanel';
import type { PendingAction } from './types';

const AdminLayout = styled.div`
  flex: 1;
  display: flex;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  padding: 2rem;
  gap: 1.5rem;
`;

const Sidebar = styled.div`
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const SidebarItem = styled.button<{ $active?: boolean }>`
  background: ${p => (p.$active ? '#2a475e' : 'transparent')};
  border: none;
  border-radius: 6px;
  color: ${p => (p.$active ? '#66c0f4' : '#c6d4df')};
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: ${p => (p.$active ? 'bold' : 'normal')};
  padding: 0.6rem 0.9rem;
  text-align: left;
  width: 100%;
  &:hover {
    background: #2a475e;
    color: #66c0f4;
  }
`;

const PageBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2rem;
`;

export default function AdminPage() {
  const { data, isLoading, isError } = useGetAdminMeQuery();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  if (isLoading) return null;
  if (isError || !data || Object.keys(data.permissions).length === 0) {
    return <Navigate to="/" replace />;
  }

  const { permissions, features } = data;

  const panels: { key: string; label: string }[] = [];
  if (permissions.canRcon) panels.push({ key: 'rcon', label: 'RCON 终端' });
  if (permissions.canManageVotes || permissions.canManageCandidates) panels.push({ key: 'votes', label: '投票管理' });

  const activeKey = selectedKey ?? panels[0]?.key ?? null;

  return (
    <AdminLayout>
      <Sidebar>
        {panels.map(p => (
          <SidebarItem
            key={p.key}
            $active={p.key === activeKey}
            onClick={() => setSelectedKey(p.key)}
          >
            {p.label}
          </SidebarItem>
        ))}
      </Sidebar>

      <PageBody>
        {activeKey === 'rcon' && <RconPanel rconEnabled={!!features.rcon} />}
        {activeKey === 'votes' && <VotesPanel permissions={permissions} onPending={setPending} />}
      </PageBody>

      <AlertDialog.Root open={!!pending} onOpenChange={v => { if (!v) setPending(null); }}>
        <AlertDialog.Content>
          <AlertDialog.Title>{pending?.label}</AlertDialog.Title>
          <AlertDialog.Description>{pending?.description}</AlertDialog.Description>
          <Flex gap="3" justify="end" mt="4">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={() => { pending?.run(); setPending(null); }}>
                确认
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </AdminLayout>
  );
}
