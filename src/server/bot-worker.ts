// Отдельный поток для ходов ботов: пока «Вдумчивый» бот думает, основной поток сервера отвечает игрокам и проверке /health.
import { parentPort } from 'node:worker_threads';
import { botMove, type BotSkill } from '../engine/bot';
import type { GameState } from '../engine/types';

export interface BotJob { id: number; state: GameState; who: string; preset?: string | null; skill: BotSkill; budgetMs?: number }
export type BotReply = { id: number; state: GameState } | { id: number; error: string };

parentPort!.on('message', (job: BotJob) => {
  try {
    const state = botMove(job.state, job.who, Math.random, job.preset, job.skill, job.budgetMs);
    parentPort!.postMessage({ id: job.id, state } satisfies BotReply);
  } catch (e) {
    parentPort!.postMessage({ id: job.id, error: String((e as Error)?.stack ?? e) } satisfies BotReply);
  }
});
