import { NavLink } from 'react-router-dom';
import { Box, Flex, Text } from '@radix-ui/themes';
import styled from 'styled-components';
import { useProfile, useAdmin, useAccount } from '../hooks/useSession';
import { useLogoutMutation } from '../lib/api';

const navStyle = ({ isActive }: { isActive: boolean }) => ({
  opacity: isActive ? 1 : 0.6,
  color: 'inherit',
  textDecoration: 'none',
  fontWeight: 500,
});

const LogoutButton = styled.button`
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 500;
  opacity: 0.6;
  cursor: pointer;

  &:hover {
    opacity: 1;
  }
`;

export default function Header() {
  const { profile } = useProfile();
  const { admin } = useAdmin();
  const { account } = useAccount();
  const [logout] = useLogoutMutation();

  const isAdmin = !!admin;

  return (
    <Box style={{ borderBottom: '1px solid var(--gray-4)' }} px="5">
      <Flex align="center" justify="between" py="3">
        <Text size="5" weight="bold">miku-server</Text>
        <Flex gap="4">
          <a href="/files" target="_blank" rel="noopener noreferrer" style={navStyle({ isActive: false })}>文件</a>
          {(profile || account) && (
            <>
              {profile && <NavLink to="/vote" style={navStyle}>op投票</NavLink>}
              {profile && <NavLink to="/team-swap" style={navStyle}>自助跳边</NavLink>}
              <NavLink to="/" end style={navStyle}>个人页</NavLink>
              {isAdmin && <NavLink to="/admin" style={navStyle}>管理</NavLink>}
              <NavLink to="/account" style={navStyle}>账户</NavLink>
              <LogoutButton type="button" onClick={() => { void logout(); }}>退出</LogoutButton>
            </>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}
