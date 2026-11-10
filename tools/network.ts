// «Расширить Сеть»: недооценивают ли его боты. Парный опыт: каждая раздача играется дважды — как обычно и с одним ботом,
// у которого вес цели «Расширить Сеть» (goals.network) умножен на k. Место «усиленного» бота сдвигается по кругу.
// Сравнивается тот же бот в той же раздаче: итоговые очки, место, победа, сколько Единомышленников нанял.
// Полный режим, Куратора нет (сравниваем очки), честным — случайные стратегии из лобби.
// npm run network -- [раздач] [игроков] [k] [standard|thoughtful] [с какой раздачи] [файл]; затем `npm run network -- merge файл…`
import { appendFileSync, readFileSync } from 'node:fs';
import { createGame } from '../src/engine/engine';
import { playOut, type BotSkill } from '../src/engine/bot';
import { BOT_PRESETS, selectablePresets } from '../src/engine/bot-presets';
import { RULES } from '../src/engine/content';

type Side = { total: number; place: number; win: boolean; workers: number };
type Row = { n: number; k: number; seed: number; preset: string; base: Side; boosted: Side; bestOther: number };

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Копия пресета с весом «Расширить Сеть», умноженным на k (не больше 10).
function boostedPreset(id: string, k: number): string {
  const spec = `${id}@network*${k}`;
  if (BOT_PRESETS.some((p) => p.id === spec)) return spec;
  const src = BOT_PRESETS.find((p) => p.id === id)!;
  const goals = { ...src.goals, network: src.goals.network.map((x) => Math.min(10, x * k)) as typeof src.goals.network };
  BOT_PRESETS.push({ ...src, id: spec, name: `${src.name} ×${k} Сеть`, goals });
  return spec;
}

function side(s: ReturnType<typeof playOut>, id: string): Side {
  const r = s.result!;
  const totals = r.scores.map((x) => x.total).sort((a, b) => b - a);
  const me = r.scores.find((x) => x.player === id)!.total;
  return { total: me, place: totals.indexOf(me) + 1, win: r.winners.includes(id), workers: s.players.find((p) => p.id === id)!.workers - RULES.startWorkers };
}

function play(n: number, k: number, seed: number, skill: BotSkill): Row | null {
  const presets = selectablePresets(false).map((p) => p.id);
  const players = Array.from({ length: n }, (_, j) => ({ id: `p${j}`, name: `Бот ${j}` }));
  const pickRand = seeded(seed * 7 + 1);
  const pick = Object.fromEntries(players.map((p) => [p.id, presets[Math.floor(pickRand() * presets.length)]]));
  const who = players[seed % n].id;
  const run = (presetsOf: Record<string, string>) => playOut(createGame({ players, seed, mode: 'full', curator: false }), seeded(seed), 12000, presetsOf, skill);
  const a = run(pick);
  const b = run({ ...pick, [who]: boostedPreset(pick[who], k) });
  if (a.phase !== 'end' || b.phase !== 'end' || !a.result?.scores.length || !b.result?.scores.length) return null;
  const bestOther = Math.max(...b.result.scores.filter((x) => x.player !== who).map((x) => x.total));
  return { n, k, seed, preset: pick[who], base: side(a, who), boosted: side(b, who), bestOther };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function report(rows: Row[]) {
  for (const key of [...new Set(rows.map((r) => `${r.n}:${r.k}`))].sort()) {
    const R = rows.filter((r) => `${r.n}:${r.k}` === key);
    const [n, k] = key.split(':').map(Number);
    const d = R.map((r) => r.boosted.total - r.base.total);
    const se = sd(d) / Math.sqrt(R.length);
    const wb = mean(R.map((r) => (r.base.win ? 1 : 0))), wk = mean(R.map((r) => (r.boosted.win ? 1 : 0)));
    console.log(`\n=== ${n} игроков, вес «Расширить Сеть» ×${k}: раздач ${R.length}`);
    console.log(`  нанято Единомышленников за партию: ${mean(R.map((r) => r.base.workers)).toFixed(2)} → ${mean(R.map((r) => r.boosted.workers)).toFixed(2)}`);
    console.log(`  итоговые очки: ${mean(R.map((r) => r.base.total)).toFixed(1)} → ${mean(R.map((r) => r.boosted.total)).toFixed(1)} (разница ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(1)} ± ${(2 * se).toFixed(1)})`);
    console.log(`  побед: ${Math.round(100 * wb)}% → ${Math.round(100 * wk)}% (случайно было бы ${Math.round(100 / n)}%)`);
    console.log(`  среднее место: ${mean(R.map((r) => r.base.place)).toFixed(2)} → ${mean(R.map((r) => r.boosted.place)).toFixed(2)}`);
    const by = new Map<string, number[]>();
    for (const r of R) by.set(r.preset, [...(by.get(r.preset) ?? []), r.boosted.total - r.base.total]);
    console.log(`  по стратегиям (разница очков): ${[...by].map(([p, a]) => `${BOT_PRESETS.find((x) => x.id === p)?.name ?? p} ${mean(a) >= 0 ? '+' : ''}${mean(a).toFixed(1)} (${a.length})`).join(', ')}`);
  }
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const games = Number(process.argv[2] ?? 20);
  const n = Number(process.argv[3] ?? 4);
  const k = Number(process.argv[4] ?? 2);
  const skill = (process.argv[5] ?? 'standard') as BotSkill;
  const from = Number(process.argv[6] ?? 0);
  const out = process.argv[7];
  const rows: Row[] = [];
  for (let g = from; g < from + games; g++) {
    const row = play(n, k, 11000 + g, skill);
    if (!row) continue;
    rows.push(row);
    if (out) appendFileSync(out, JSON.stringify(row) + '\n');
  }
  if (!out) report(rows);
}
