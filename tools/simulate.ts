// Симуляция партий ботами: npm run simulate -- [партий] [игроков]
import { createGame } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { PASSIONS, SPROUTS } from '../src/engine/content';

const games = Number(process.argv[2] ?? 200);
const n = Number(process.argv[3] ?? 3);
let glasnost = 0;
const totals: number[] = [];
const passionWins: Record<string, number> = {};
const passionPlays: Record<string, number> = {};
const progress: number[] = [];
const prose: number[] = [];

for (let i = 0; i < games; i++) {
  const s = playOut(createGame({ players: Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` })), seed: i + 1, mode: (process.argv[4] as 'full') ?? 'beginner' }));
  const r = s.result!;
  if (r.glasnost) glasnost++;
  s.sprouts.forEach((sp) => progress.push(sp.progress));
  for (const p of s.players) {
    prose.push(p.pointsBy?.prose ?? 0);
    passionPlays[p.passion!] = (passionPlays[p.passion!] ?? 0) + 1;
    if (r.winners.includes(p.id)) passionWins[p.passion!] = (passionWins[p.passion!] ?? 0) + 1;
  }
  r.scores.forEach((x) => totals.push(x.total));
}
const avg = (a: number[]) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
console.log(`Партий: ${games}, игроков: ${n}`);
console.log(`Гласность наступила: ${((glasnost / games) * 100).toFixed(0)}%`);
console.log(`Средний итог очков: ${avg(totals)}, макс: ${Math.max(...totals)}`);
console.log(`Средняя ступень Ростка к концу: ${avg(progress)}`);
console.log(`Очки от Прозы («Вдохновиться») на игрока: в среднем ${avg(prose)}, максимум ${Math.max(...prose)}`);
console.log('Победы по Пристрастиям (побед / сыграно):');
for (const [id, plays] of Object.entries(passionPlays).sort()) {
  console.log(`  ${PASSIONS[id as keyof typeof PASSIONS].name.padEnd(16)} ${passionWins[id] ?? 0} / ${plays}`);
}
void SPROUTS;
