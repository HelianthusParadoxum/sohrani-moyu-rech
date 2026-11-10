// Драматургия «Разыграть»: помогает ли боту знание о ней. Парный опыт: каждая раздача играется дважды — один бот не знает
// о бонусе (BOT_BASE.dramaValue = 0) и знает (как обычно); остальные — как обычно. Место этого бота сдвигается по кругу.
// Полный режим, Куратора нет (сравниваем очки), стратегии — случайные из лобби.
// npm run drama -- [раздач] [игроков] [standard|thoughtful] [с какой раздачи] [файл]; затем `npm run drama -- merge файл…`
import { appendFileSync, readFileSync } from 'node:fs';
import { createGame } from '../src/engine/engine';
import { playOut, type BotSkill } from '../src/engine/bot';
import { BOT_PRESETS, selectablePresets } from '../src/engine/bot-presets';

type Side = { total: number; drama: number; win: boolean; place: number };
type Row = { n: number; seed: number; preset: string; blind: Side; aware: Side };

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const PRESETS = selectablePresets(false).map((p) => p.id);

// Копия пресета, не знающая о Драматургии.
function blindPreset(id: string): string {
  const spec = `${id}@drama0`;
  if (!BOT_PRESETS.some((p) => p.id === spec)) {
    const src = BOT_PRESETS.find((p) => p.id === id)!;
    BOT_PRESETS.push({ ...src, id: spec, name: `${src.name} без Драматургии`, base: { ...src.base, dramaValue: 0 } });
  }
  return spec;
}

function side(s: ReturnType<typeof playOut>, id: string): Side {
  const r = s.result!;
  const me = r.scores.find((x) => x.player === id)!.total;
  const totals = r.scores.map((x) => x.total).sort((a, b) => b - a);
  return { total: me, drama: s.players.find((p) => p.id === id)!.pointsBy.drama ?? 0, win: r.winners.includes(id), place: totals.indexOf(me) + 1 };
}

function play(n: number, seed: number, skill: BotSkill): Row | null {
  const players = Array.from({ length: n }, (_, j) => ({ id: `p${j}`, name: `Бот ${j}` }));
  const pr = seeded(seed * 7 + 1);
  const pick = Object.fromEntries(players.map((p) => [p.id, PRESETS[Math.floor(pr() * PRESETS.length)]]));
  const who = players[seed % n].id;
  const run = (presets: Record<string, string>) => playOut(createGame({ players, seed, mode: 'full', curator: false }), seeded(seed), 12000, presets, skill);
  const a = run({ ...pick, [who]: blindPreset(pick[who]) });
  const b = run(pick);
  if (a.phase !== 'end' || b.phase !== 'end' || !a.result?.scores.length || !b.result?.scores.length) return null;
  return { n, seed, preset: pick[who], blind: side(a, who), aware: side(b, who) };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function report(rows: Row[]) {
  for (const n of [...new Set(rows.map((r) => r.n))].sort()) {
    const R = rows.filter((r) => r.n === n);
    const d = R.map((r) => r.aware.total - r.blind.total);
    console.log(`\n=== ${n} игроков: раздач ${R.length}`);
    console.log(`  очки за Драматургию: ${mean(R.map((r) => r.blind.drama)).toFixed(1)} → ${mean(R.map((r) => r.aware.drama)).toFixed(1)}`);
    console.log(`  итоговые очки: ${mean(R.map((r) => r.blind.total)).toFixed(1)} → ${mean(R.map((r) => r.aware.total)).toFixed(1)} (разница ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(1)} ± ${(2 * sd(d) / Math.sqrt(R.length)).toFixed(1)})`);
    console.log(`  побед: ${Math.round(100 * mean(R.map((r) => +r.blind.win)))}% → ${Math.round(100 * mean(R.map((r) => +r.aware.win)))}%, среднее место ${mean(R.map((r) => r.blind.place)).toFixed(2)} → ${mean(R.map((r) => r.aware.place)).toFixed(2)}`);
  }
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const games = Number(process.argv[2] ?? 20);
  const n = Number(process.argv[3] ?? 4);
  const skill = (process.argv[4] ?? 'standard') as BotSkill;
  const from = Number(process.argv[5] ?? 0);
  const out = process.argv[6];
  const rows: Row[] = [];
  for (let g = from; g < from + games; g++) {
    const row = play(n, 13000 + g, skill);
    if (!row) continue;
    rows.push(row);
    if (out) appendFileSync(out, JSON.stringify(row) + '\n');
  }
  if (!out) report(rows);
}
