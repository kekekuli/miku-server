import { NavLink } from 'react-router-dom';
import { Box, Flex, Text } from '@radix-ui/themes';
import { useGetMeQuery } from '../lib/api';

export default function Header() {
  const { data: profile } = useGetMeQuery();

  return (
    <Box style={{ borderBottom: '1px solid var(--gray-4)' }} px="5">
      <Flex align="center" justify="between" py="3">
        <Text size="5" weight="bold">miku-server</Text>
        {profile && (
          <Flex gap="4">
            <NavLink to="/vote" style={({ isActive }) => ({ opacity: isActive ? 1 : 0.6, color: 'inherit', textDecoration: 'none', fontWeight: 500 })}>op投票</NavLink>
            <NavLink to="/" end style={({ isActive }) => ({ opacity: isActive ? 1 : 0.6, color: 'inherit', textDecoration: 'none', fontWeight: 500 })}>个人页</NavLink>
          </Flex>
        )}
      </Flex>
    </Box>
  );
}
