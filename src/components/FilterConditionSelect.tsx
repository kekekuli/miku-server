import styled from 'styled-components';
import { Button, Checkbox, Flex, Popover, SegmentedControl, Text } from '@radix-ui/themes';
import type { ConditionLabel } from '../../shared/types';
import type { FilterMode, LogicMode } from '../types';

interface Props {
  conditions: ConditionLabel[];
  selectedKeys: string[];
  logic: LogicMode;
  filterMode: FilterMode;
  onSelectedKeysChange: (keys: string[]) => void;
  onLogicChange: (logic: LogicMode) => void;
  onFilterModeChange: (mode: FilterMode) => void;
}

const Item = styled.label`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  cursor: pointer;
`;

export default function FilterConditionSelect({ conditions, selectedKeys, logic, filterMode, onSelectedKeysChange, onLogicChange, onFilterModeChange }: Props) {

  function toggle(key: string) {
    onSelectedKeysChange(
      selectedKeys.includes(key)
        ? selectedKeys.filter(k => k !== key)
        : [...selectedKeys, key]
    );
  }

  const label = selectedKeys.length === 0
    ? '选择筛选条件'
    : `已选 ${selectedKeys.length} 项`;

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Popover.Root>
        <Popover.Trigger>
          <Button variant="outline">{label}</Button>
        </Popover.Trigger>
        <Popover.Content>
          <Flex direction="column" gap="2" style={{ minWidth: 200 }}>
            {conditions.map(condition => (
              <Item key={condition.key}>
                <Checkbox
                  checked={selectedKeys.includes(condition.key)}
                  onCheckedChange={() => toggle(condition.key)}
                />
                <Text size="2">{condition.label}</Text>
              </Item>
            ))}
          </Flex>
        </Popover.Content>
      </Popover.Root>

      {selectedKeys.length > 0 && (
        <>
          <SegmentedControl.Root value={logic} onValueChange={v => onLogicChange(v as LogicMode)}>
            <SegmentedControl.Item value="AND">全部满足</SegmentedControl.Item>
            <SegmentedControl.Item value="OR">满足其一</SegmentedControl.Item>
          </SegmentedControl.Root>

          <SegmentedControl.Root value={filterMode} onValueChange={v => onFilterModeChange(v as FilterMode)}>
            <SegmentedControl.Item value="all">全部</SegmentedControl.Item>
            <SegmentedControl.Item value="passing">仅符合</SegmentedControl.Item>
            <SegmentedControl.Item value="failing">仅不符合</SegmentedControl.Item>
          </SegmentedControl.Root>
        </>
      )}
    </Flex>
  );
}
