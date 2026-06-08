import { drizzle } from 'drizzle-orm/d1';
import { eq, count } from 'drizzle-orm';
import { candidates } from '../../db/schema';
import { getGameStatusNow } from './steam';
import { getVoteGate } from './strapi';
import { evaluate, memoize } from './evaluate';
import type { EvalContext } from './evaluate';

export function createEvalContext(steamId: string, env: Env): EvalContext {
  const getStatus = memoize(async () => {
    const statuses = await getGameStatusNow([steamId], env);
    return statuses[steamId];
  });

  return {
    playtime_forever: async () => (await getStatus())?.playtime_forever,
    playtime_2weeks: async () => (await getStatus())?.playtime_2weeks,
    nomination_count: memoize(async () => {
      const db = drizzle(env.DB);
      const result = await db.select({ count: count() }).from(candidates).where(eq(candidates.nominatedBy, steamId)).get();
      return result?.count;
    }),
  };
}

export async function checkGate(steamId: string, type: 'vote' | 'candidate', env: Env): Promise<string | null> {
  const gate = await getVoteGate(type, env);
  if (!gate || gate.conditions.length === 0) return null;

  const context = createEvalContext(steamId, env);
  const results = await evaluate(gate.conditions, context);
  const failedResults = results.filter(r => !r.passed);
  const passed = gate.logic === 'AND'
    ? failedResults.length === 0
    : failedResults.length < results.length;

  if (passed) return null;

  const failedLabels = failedResults
    .map(r => gate.conditions.find(c => c.key === r.key)?.label ?? r.key);

  return `不满足资格要求：${failedLabels.join('、')}`;
}
