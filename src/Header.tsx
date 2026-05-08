import { Box, Button, Flex, Text } from '@radix-ui/themes';

const navItems = [
  { label: 'op投票' },
  { label: '个人页' },
];

export default function Header() {
  return (
    <Box style={{ borderBottom: '1px solid var(--gray-4)' }} px="5">
      <Flex align="center" justify="between" py="3">
        <Text size="5" weight="bold">miku-server</Text>
        <Flex gap="4">
          {navItems.map(item => (
            <Button key={item.label} variant="ghost">{item.label}</Button>
          ))}
        </Flex>
      </Flex>
    </Box>
  );
}
