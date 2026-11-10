// «Разброс победных очков»: разница итогов первого и последнего игрока в партии.
// Не цель «всегда в пару очков», но если разброс растёт от правки к правке — скорее плохой знак (отстающие безнадёжно отстают).
import type { GameState } from '../src/engine/types';

export function spreadOf(result: NonNullable<GameState['result']>): number {
  const t = result.scores.map((x) => x.total);
  return t.length ? Math.max(...t) - Math.min(...t) : 0;
}

const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function spreadLine(a: number[]): string {
  if (!a.length) return 'Разброс победных очков: нет данных';
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return `Разброс победных очков (первый − последний): в среднем ${mean.toFixed(1)}, медиана ${q(a, 0.5)}, `
    + `в 9 партиях из 10 не больше ${q(a, 0.9)}, наибольший ${Math.max(...a)}`;
}
