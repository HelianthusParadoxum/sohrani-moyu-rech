// Баланс Куратора — главный замер (цель в CLAUDE.md): полный режим, Куратор в каждой партии, честным — случайные
// стратегии из лобби (как «Наугад»), умелость ботов — «Вдумчивые» (живые игроки ближе к ним, чем к «Упрощённым»).
// npm run curator -- [партий] [игроков] [standard|thoughtful] [с какой партии] [файл для сырых данных]
// «Вдумчивые» медленные (~0,5 мин на партию): запускайте в несколько процессов с разным смещением и файлом,
// затем `npm run curator -- merge файл…`.
import { appendFileSync, readFileSync } from 'node:fs';
import { createGame } from '../src/engine/engine';
import { playOut, type BotSkill } from '../src/engine/bot';
import { selectablePresets } from '../src/engine/bot-presets';
import { spreadLine, spreadOf } from './spread';

// spread — «разброс победных очков»: итог первого минус итог последнего (в старых файлах его нет).
type Row = { n: number; curWin: boolean; glasnost: boolean; spread?: number };

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function report(rows: Row[]) {
  const target: Record<number, string> = { 3: '33–50%', 4: '25–33%', 5: '20–25%' };
  for (const n of [...new Set(rows.map((r) => r.n))].sort()) {
    const R = rows.filter((r) => r.n === n);
    const w = R.filter((r) => r.curWin).length;
    const se = Math.sqrt((w / R.length) * (1 - w / R.length) / R.length);
    console.log(`${n} игроков: партий ${R.length}, побед Куратора ${w} — ${Math.round((100 * w) / R.length)}% ± ${Math.round(200 * se)} п. п.`
      + ` (цель ${target[n] ?? '—'}), Гласность ${Math.round((100 * R.filter((r) => r.glasnost).length) / R.length)}%`);
    const sp = R.flatMap((r) => (r.spread === undefined ? [] : [r.spread]));
    if (sp.length) console.log(`  ${spreadLine(sp)}`);
  }
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const games = Number(process.argv[2] ?? 20);
  const n = Number(process.argv[3] ?? 4);
  const skill = (process.argv[4] ?? 'thoughtful') as BotSkill;
  const from = Number(process.argv[5] ?? 0);
  const out = process.argv[6];
  const presets = selectablePresets(false).map((p) => p.id);
  const rows: Row[] = [];
  for (let g = from; g < from + games; g++) {
    const rand = seeded(7000 + g);
    const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
    const pick = Object.fromEntries(players.map((p) => [p.id, presets[Math.floor(rand() * presets.length)]]));
    const s = playOut(createGame({ players, seed: 7000 + g, mode: 'full', forceCurator: true }), rand, 12000, pick, skill);
    if (s.phase !== 'end' || !s.result) continue;
    const cur = s.players.find((p) => p.passion === 'curator')!;
    const row = { n, curWin: s.result.winners.includes(cur.id), glasnost: s.result.glasnost, spread: spreadOf(s.result) };
    rows.push(row);
    if (out) appendFileSync(out, JSON.stringify(row) + '\n');
  }
  if (!out) report(rows);
}
