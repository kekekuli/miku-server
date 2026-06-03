import type { ConditionLabel } from '../../shared/types';

export interface LocalCondition extends ConditionLabel {
  resolve: (ctx: { noGameStatus: boolean }) => boolean;
}

export const LOCAL_CONDITIONS: LocalCondition[] = [
  {
    key: 'local:no_game_status',
    label: '无游戏数据',
    resolve: ({ noGameStatus }) => noGameStatus,
  },
];

export const LOCAL_KEYS = new Set(LOCAL_CONDITIONS.map(c => c.key));
