// Влияет ли место в стартовом порядке хода на победу. Условия — как в замере баланса (полный режим, Куратор в каждой партии,
// честным — случайные стратегии). Для честных по месту в порядке хода 1-й Пятилетки: побед, средний итог и итог против
// среднего честных той же партии (так убирается разница между партиями); Куратор — побед по месту.
// npm run order -- [партий] [игроков] [thoughtful|standard] [с какой партии] [файл]; затем `npm run order -- merge файл…`
import { appendFileSync, readFileSync } from 'node:fs';
import { createGame } from '../src/engine/engine';
import { playOut, type BotSkill } from '../src/engine/bot';
import { selectablePresets } from '../src/engine/bot-presets';

type P = { pos: number; curator: boolean; total: number; win: boolean };
type Row = { n: number; seed: number; glasnost: boolean; players: P[] };

function seeded(seed: number) {
  let t = seed;
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

function play(n: number, seed: number, skill: BotSkill): Row | null {
  const rand = seeded(seed);
  const presets = selectablePresets(false).map((p) => p.id);
  const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
  const pick = Object.fromEntries(players.map((p) => [p.id, presets[Math.floor(rand() * presets.length)]]));
  const start = createGame({ players, seed, mode: 'full', forceCurator: true });
  const order = [...start.order]; // порядок хода в 1-й Пятилетке
  const s = playOut(start, rand, 12000, pick, skill);
  if (s.phase !== 'end' || !s.result) return null;
  return {
    n, seed, glasnost: s.result.glasnost,
    players: s.players.map((p) => ({ pos: order.indexOf(p.id) + 1, curator: p.passion === 'curator', total: s.result!.scores.find((x) => x.player === p.id)?.total ?? 0, win: s.result!.winners.includes(p.id) })),
  };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2)) / Math.max(1, a.length)); };

function report(rows: Row[]) {
  for (const n of [...new Set(rows.map((r) => r.n))].sort()) {
    const R = rows.filter((r) => r.n === n);
    const G = R.filter((r) => r.glasnost);
    console.log(`\n=== ${n} игроков: партий ${R.length}, Гласность наступила в ${G.length} (только в них честный может победить)`);
    console.log('Место   честных  побед честного  (ожидание)  итог   итог против среднего честных партии   | Куратор на этом месте: побед');
    let chi = 0;
    for (let pos = 1; pos <= n; pos++) {
      const H = R.flatMap((r) => r.players.filter((p) => !p.curator && p.pos === pos).map((p) => ({ p, r })));
      const HG = H.filter((x) => x.r.glasnost);
      // Ожидание побед: в каждой партии с Гласностью побеждает один из честных (ничьи делят) — доля 1/(n−1).
      const wins = HG.filter((x) => x.p.win).length;
      const exp = HG.length / (n - 1);
      chi += exp ? (wins - exp) ** 2 / exp : 0;
      const rel = HG.map(({ p, r }) => p.total - mean(r.players.filter((q) => !q.curator).map((q) => q.total)));
      const C = R.filter((r) => r.players.some((p) => p.curator && p.pos === pos));
      const cw = C.filter((r) => r.players.some((p) => p.curator && p.win)).length;
      console.log(`${String(pos).padStart(3)}     ${String(H.length).padStart(4)}    ${String(wins).padStart(4)} из ${String(HG.length).padStart(3)} (${Math.round((100 * wins) / Math.max(1, HG.length))}%)   ${exp.toFixed(1).padStart(5)}   `
        + `${mean(H.map((x) => x.p.total)).toFixed(1).padStart(5)}   ${(mean(rel) >= 0 ? '+' : '') + mean(rel).toFixed(1)} ± ${(2 * se(rel)).toFixed(1)}`.padEnd(40)
        + `   | ${cw} из ${C.length} (${Math.round((100 * cw) / Math.max(1, C.length))}%)`);
    }
    // Хи-квадрат по победам честных (n−1 степеней свободы): порог значимости 5% — 6,0 (3 места), 7,8 (4), 9,5 (5).
    const crit: Record<number, number> = { 2: 3.84, 3: 5.99, 4: 7.81, 5: 9.49 };
    console.log(`Хи-квадрат по победам: ${chi.toFixed(2)} (порог значимости 5% — ${crit[n] ?? '?'})${chi > (crit[n] ?? Infinity) ? ' — ЗНАЧИМО' : ' — не значимо'}`);
  }
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const games = Number(process.argv[2] ?? 10), n = Number(process.argv[3] ?? 4);
  const skill = (process.argv[4] ?? 'thoughtful') as BotSkill;
  const from = Number(process.argv[5] ?? 0), out = process.argv[6];
  const rows: Row[] = [];
  for (let g = from; g < from + games; g++) {
    const r = play(n, 17000 + g, skill);
    if (!r) continue;
    rows.push(r);
    if (out) appendFileSync(out, JSON.stringify(r) + '\n');
  }
  if (!out) report(rows);
}
