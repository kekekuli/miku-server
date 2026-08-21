import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Badge, Button, Flex, Text, TextField } from '@radix-ui/themes';
import {
  useGetGameMapsInfiniteQuery,
  useGetGameServersQuery,
  useGetPresetCommandPresetsQuery,
  useRunPresetCommandMutation,
} from '../../lib/api';
import type { GameMapOption, RconCommandPreset } from '../../../shared/types';
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
const ButtonGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;
const MapPicker = styled.div`
  background: #1b2838;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
`;
const MapList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 320px;
  overflow-y: auto;
`;
const MapItem = styled.button<{ $selected: boolean }>`
  background: ${props => props.$selected ? '#2a475e' : 'transparent'};
  border: 0;
  border-radius: 4px;
  color: ${props => props.$selected ? '#66c0f4' : '#c6d4df'};
  cursor: pointer;
  padding: 0.55rem 0.7rem;
  text-align: left;
  &:hover { background: #2a475e; }
  &:disabled { cursor: not-allowed; opacity: 0.6; }
`;
const Result = styled.pre<{ $error?: boolean }>`
  background: #1b2838;
  border-radius: 6px;
  color: ${props => props.$error ? '#ff6b6b' : '#c6d4df'};
  font-size: 0.8rem;
  margin: 0;
  min-height: 2.5rem;
  overflow-wrap: anywhere;
  padding: 0.75rem;
  white-space: pre-wrap;
`;

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return '命令执行失败，请稍后重试';
}

export default function PresetCommandsPanel({ onPending }: { onPending: (action: PendingAction) => void }) {
  const { data: servers, isLoading: serversLoading } = useGetGameServersQuery();
  const { data: presets, isLoading: presetsLoading } = useGetPresetCommandPresetsQuery();
  const [runPreset, { isLoading: commandPending }] = useRunPresetCommandMutation();
  const [serverId, setServerId] = useState<string | null>(null);
  const [activeMapPreset, setActiveMapPreset] = useState<RconCommandPreset | null>(null);
  const [selectedMap, setSelectedMap] = useState<GameMapOption | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const mapPickerRef = useRef<HTMLDivElement>(null);

  const {
    data: mapPages,
    isFetching: mapsFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useGetGameMapsInfiniteQuery(search, { skip: !activeMapPreset });
  const maps = useMemo(() => mapPages?.pages.flatMap(page => page.items) ?? [], [mapPages]);
  const totalMaps = mapPages?.pages[0]?.total ?? 0;

  useEffect(() => {
    if (!serverId && servers?.length) setServerId((servers.find(server => server.isActive) ?? servers[0]).id);
  }, [serverId, servers]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (activeMapPreset) mapPickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeMapPreset]);

  const execute = async (preset: RconCommandPreset, map?: GameMapOption) => {
    if (!serverId || (preset.argumentType === 'map' && !map)) return;
    const attempt = (attempts[preset.id] ?? 0) + 1;
    setAttempts(current => ({ ...current, [preset.id]: attempt }));
    setResult(null);
    try {
      const response = await runPreset({ presetId: preset.id, gameServerId: serverId, mapId: map?.id, attempt }).unwrap();
      setResult({ text: `${response.command}\n${response.output || '命令已发送，服务器未返回文本'}`, error: false });
    } catch (error) {
      setResult({ text: errorMessage(error), error: true });
    }
  };

  const confirmOrExecute = (preset: RconCommandPreset, map?: GameMapOption) => {
    if (!preset.confirmationRequired) return void execute(preset, map);
    onPending({
      label: preset.displayName,
      description: `将立即在所选服务器执行${map ? `，地图切换为 ${map.displayName}` : ''}。确定继续吗？`,
      run: () => { void execute(preset, map); },
    });
  };

  const clickPreset = (preset: RconCommandPreset) => {
    if (preset.argumentType !== 'map') return confirmOrExecute(preset);
    setActiveMapPreset(preset);
    setSelectedMap(null);
    setSearchInput('');
    setSearch('');
    setResult(null);
  };

  const unavailable = !servers?.length || !presets?.length;
  return (
    <Section>
      <Flex justify="between" align="center">
        <SectionTitle>服务器操作</SectionTitle>
        {!serversLoading && !presetsLoading && unavailable && <Badge color="red">未配置</Badge>}
      </Flex>
      <Text size="2" color="gray">
        命令和地图由 Strapi 管理。支持逗号重试的命令会在奇数次点击时不带逗号、偶数次点击时带逗号。
      </Text>
      <Text size="2" weight="bold">选择服务器</Text>
      <ButtonGroup>
        {servers?.map(server => (
          <Button key={server.id} variant={server.id === serverId ? 'solid' : 'soft'} disabled={commandPending} onClick={() => setServerId(server.id)}>
            {server.displayName}{server.isActive ? '（当前启用）' : ''}
          </Button>
        ))}
      </ButtonGroup>
      <Text size="2" weight="bold">选择操作</Text>
      <ButtonGroup>
        {presets?.map(preset => {
          const nextAttempt = (attempts[preset.id] ?? 0) + 1;
          const usesComma = preset.supportsTrailingComma && nextAttempt % 2 === 0;
          return (
            <Button
              key={preset.id}
              color={preset.confirmationRequired ? 'red' : undefined}
              variant={activeMapPreset?.id === preset.id ? 'solid' : 'soft'}
              disabled={commandPending || !serverId}
              onClick={() => clickPreset(preset)}
            >
              {preset.displayName}{usesComma ? '（加逗号）' : ''}
            </Button>
          );
        })}
      </ButtonGroup>

      {activeMapPreset && (
        <MapPicker ref={mapPickerRef}>
          <Flex justify="between" align="center">
            <Text weight="bold">为“{activeMapPreset.displayName}”选择地图</Text>
            <Text size="1" color="gray">{totalMaps} 个结果</Text>
          </Flex>
          <TextField.Root
            placeholder="模糊搜索地图名称或代码"
            value={searchInput}
            onChange={event => { setSearchInput(event.target.value); setSelectedMap(null); }}
            disabled={commandPending}
          />
          <MapList onScroll={event => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 80 && hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
          }}>
            {maps.map(map => (
              <MapItem key={map.id} $selected={selectedMap?.id === map.id} disabled={commandPending} onClick={() => setSelectedMap(map)}>
                {map.displayName}
                {map.displayName !== map.rconName && <><br /><small>{map.rconName}</small></>}
              </MapItem>
            ))}
            {(mapsFetching || isFetchingNextPage) && <Text size="1" color="gray">加载中...</Text>}
            {!mapsFetching && maps.length === 0 && <Text size="1" color="gray">没有匹配的地图</Text>}
          </MapList>
          <Flex gap="2" justify="end">
            <Button variant="soft" color="gray" disabled={commandPending} onClick={() => setActiveMapPreset(null)}>取消</Button>
            <Button
              color={activeMapPreset.confirmationRequired ? 'red' : undefined}
              disabled={commandPending || !selectedMap}
              onClick={() => selectedMap && confirmOrExecute(activeMapPreset, selectedMap)}
            >
              执行{activeMapPreset.displayName}
            </Button>
          </Flex>
        </MapPicker>
      )}
      {commandPending && <Text size="2" color="gray">命令执行中，请勿重复点击...</Text>}
      {result && <Result $error={result.error}>{result.text}</Result>}
    </Section>
  );
}
