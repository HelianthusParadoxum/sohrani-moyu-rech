// Симуляция партий ботами: npm run simulate -- [партий] [игроков] [режим] [пресеты через запятую]
// Пример: npm run simulate -- 100 3 beginner networker,gardener,collector
// Пресеты раздаются по местам по кругу и каждую партию сдвигаются, чтобы никому не доставалось одно и то же место.
import { createGame } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { BOT_PRESETS, CURATOR_STYLES, DEFAULT_PRESET, curatorStyle, presetById, type CuratorStyle } from '../src/engine/bot-presets';
import { PASSIONS } from '../src/engine/content';
import type { Mode } from '../src/engine/types';

const games = Number(process.argv[2] ?? 100);
const n = Number(process.argv[3] ?? 3);
const mode = (process.argv[4] ?? 'beginner') as Mode | 'reserve'; // reserve — «Заповедник»
const presetIds = (process.argv[5] ?? DEFAULT_PRESET).split(',').filter(Boolean);
for (const id of presetIds) {
  if (!BOT_PRESETS.some((p) => p.id === id)) throw new Error(`Нет пресета «${id}». Есть: ${BOT_PRESETS.map((p) => p.id).join(', ')}`);
}

// Тот же генератор, что в движке: партии воспроизводимы.
function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

let glasnost = 0;
const progress: number[] = [];
const passionWins: Record<string, number> = {};
const curatorStyles: Record<string, { plays: number; wins: number }> = {};
const passionPlays: Record<string, number> = {};
const stat: Record<string, { plays: number; wins: number; total: number[]; workers: number[]; sources: Record<string, number> }> = {};
const started = Date.now();

for (let i = 0; i < games; i++) {
  const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
  const presets = Object.fromEntries(players.map((p, k) => [p.id, presetIds[(k + i) % presetIds.length]]));
  const s = playOut(createGame({ players, seed: i + 1, mode: mode === 'reserve' ? 'full' : mode, reserve: mode === 'reserve' }), seeded(i + 1), 5000, presets);
  const r = s.result!;
  if (r.glasnost) glasnost++;
  s.sprouts.forEach((sp) => progress.push(sp.progress));
  for (const p of s.players) {
    const id = presets[p.id];
    const st = (stat[id] ??= { plays: 0, wins: 0, total: [], workers: [], sources: {} });
    const line = r.scores.find((x) => x.player === p.id);
    st.plays++;
    if (r.winners.includes(p.id)) st.wins++;
    if (line) {
      st.total.push(line.total);
      const parts: Record<string, number> = {
        'по ходу игры': line.during, 'Пристрастие': line.passion,
        'ЧНЛ': line.propaganda, 'Улики': line.evidence,
      };
      for (const [k, v] of Object.entries(parts)) st.sources[k] = (st.sources[k] ?? 0) + v;
    }
    st.workers.push(p.workers);
    passionPlays[p.passion!] = (passionPlays[p.passion!] ?? 0) + 1;
    if (p.passion === 'curator') {
      const st = (curatorStyles[curatorStyle(s, p.id)] ??= { plays: 0, wins: 0 });
      st.plays++;
      if (r.winners.includes(p.id)) st.wins++;
    }
    if (r.winners.includes(p.id)) passionWins[p.passion!] = (passionWins[p.passion!] ?? 0) + 1;
  }
}

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0).toFixed(1);
console.log(`Партий: ${games}, игроков: ${n}, режим: ${mode}, пресеты: ${presetIds.map((id) => presetById(id).name).join(', ')}`);
console.log(`Время: ${((Date.now() - started) / 1000).toFixed(1)} с`);
console.log(`Гласность наступила: ${((glasnost / games) * 100).toFixed(0)}%`);
console.log(`Средняя ступень Ростка к концу: ${avg(progress)}`);
console.log('По пресетам (побед / мест, средний итог, Единомышленников к концу):');
for (const [id, st] of Object.entries(stat)) {
  console.log(`  ${presetById(id).name.padEnd(14)} ${st.wins} / ${st.plays}, итог ${avg(st.total)}, сеть ${avg(st.workers)}`);
  console.log(`    ${Object.entries(st.sources).map(([k, v]) => `${k} ${(v / st.plays).toFixed(1)}`).join(', ')}`);
}
if (Object.keys(curatorStyles).length) {
  console.log('Куратор по характерам (побед / сыграно):');
  for (const [id, x] of Object.entries(curatorStyles)) console.log(`  ${CURATOR_STYLES[id as CuratorStyle].name.padEnd(18)} ${x.wins} / ${x.plays}`);
}
console.log('Победы по Пристрастиям (побед / сыграно):');
for (const [id, plays] of Object.entries(passionPlays).sort()) {
  console.log(`  ${PASSIONS[id as keyof typeof PASSIONS].name.padEnd(16)} ${passionWins[id] ?? 0} / ${plays}`);
}
