import { NavLink } from 'react-router-dom';
import { Box, Flex, Text } from '@radix-ui/themes';
import { useGetMeQuery, useGetAdminMeQuery } from '../lib/api';

const navStyle = ({ isActive }: { isActive: boolean }) => ({
  opacity: isActive ? 1 : 0.6,
  color: 'inherit',
  textDecoration: 'none',
  fontWeight: 500,
});

export default function Header() {
  const { data: profile } = useGetMeQuery();
  const { data: adminMe } = useGetAdminMeQuery();

  const isAdmin = !!adminMe && Object.keys(adminMe.permissions).length > 0;

  return (
    <Box style={{ borderBottom: '1px solid var(--gray-4)' }} px="5">
      <Flex align="center" justify="between" py="3">
        <Text size="5" weight="bold">miku-server</Text>
        <Flex gap="4">
          <a href="/files" target="_blank" rel="noopener noreferrer" style={navStyle({ isActive: false })}>文件</a>
          {profile && (
            <>
              <NavLink to="/vote" style={navStyle}>op投票</NavLink>
              <NavLink to="/" end style={navStyle}>个人页</NavLink>
              {isAdmin && <NavLink to="/admin" style={navStyle}>管理</NavLink>}
            </>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}
