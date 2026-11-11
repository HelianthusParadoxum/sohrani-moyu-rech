// Почему не расширяют сеть: по каждому игроку и Пятилетке — Талоны на старте поручений, сколько ходов был «шанс нанять»
// (свой ход, есть свободный Единомышленник, Талонов хватает на цену, не максимум Единомышленников, в эту Пятилетку ещё
// не нанимал), нанял ли и что выбрал вместо найма. Условия — как в замере баланса (полный режим, Куратор, случайные стратегии).
// npm run hire -- [партий] [игроков] [thoughtful|standard] [с какой партии] [файл]; затем `npm run hire -- merge файл…`
import { appendFileSync, readFileSync } from 'node:fs';
import { activePlayers, createGame } from '../src/engine/engine';
import { botMove, type BotSkill } from '../src/engine/bot';
import { selectablePresets, presetById } from '../src/engine/bot-presets';
import { RULES } from '../src/engine/content';
import { price } from '../src/engine/full';
import type { GameState } from '../src/engine/types';

type PR = { player: string; round: number; preset: string; curator: boolean; talonsStart: number; chances: number; hired: number; instead: Record<string, number>; held: number; endTalons: number; workers: number };
type Row = { n: number; final: { workers: number; curator: boolean; preset: string; total: number; win: boolean }[]; rounds: PR[] };

function seeded(seed: number) {
  let t = seed;
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

function play(n: number, seed: number, skill: BotSkill): Row | null {
  const rand = seeded(9000 + seed);
  const presets = selectablePresets(false).map((p) => p.id);
  const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
  const pick = Object.fromEntries(players.map((p) => [p.id, presets[Math.floor(rand() * presets.length)]]));
  let s: GameState = createGame({ players, seed: 9000 + seed, mode: 'full', forceCurator: true });
  const cur: Record<string, PR> = {};
  const rounds: PR[] = [];
  const flush = () => { for (const k of Object.keys(cur)) { const p = s.players.find((x) => x.id === k)!; cur[k].endTalons = p.talons; cur[k].workers = p.workers; rounds.push(cur[k]); delete cur[k]; } };
  let lastRound = 0;
  for (let i = 0; i < 12000 && s.phase !== 'end'; i++) {
    if (s.phase === 'orders' && s.round !== lastRound) {
      flush();
      lastRound = s.round;
      for (const p of s.players) cur[p.id] = { player: p.id, round: s.round, preset: pick[p.id], curator: p.passion === 'curator', talonsStart: p.talons, chances: 0, hired: 0, instead: {}, held: p.held, endTalons: 0, workers: p.workers };
    }
    const who = activePlayers(s)[0];
    const p = s.players.find((x) => x.id === who)!;
    const free = s.phase === 'orders' && !s.pending.length && (p.available > 0 || p.bonusGroupTurns > 0);
    const chance = free && p.workers < RULES.maxWorkers && !p.groupUsed.includes('hire') && p.talons >= price(s, p, RULES.hireCost);
    const before = p.actions.length, workers = p.workers, round = s.round;
    s = botMove(s, who, rand, pick[who], skill);
    const q = s.players.find((x) => x.id === who)!;
    // Свободные ходы (Клуб, пересборка Тайника и т. п.) поручения не тратят — шансом не считаем: следом будет настоящий ход.
    const spent = q.workers > workers || q.actions.length > before || q.available < p.available || s.round !== round;
    if (chance && spent && cur[who] && s.round === round) {
      cur[who].chances++;
      if (q.workers > workers) cur[who].hired++;
      else {
        const t = q.actions.slice(before).map((x) => x.target)[0] ?? 'пас';
        cur[who].instead[t] = (cur[who].instead[t] ?? 0) + 1;
      }
    }
  }
  flush();
  if (s.phase !== 'end' || !s.result) return null;
  return {
    n, rounds,
    final: s.players.map((p) => ({ workers: p.workers, curator: p.passion === 'curator', preset: pick[p.id], total: s.result!.scores.find((x) => x.player === p.id)?.total ?? 0, win: s.result!.winners.includes(p.id) })),
  };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;

function report(rows: Row[]) {
  const honest = rows.flatMap((r) => r.final.filter((f) => !f.curator));
  console.log(`Партий ${rows.length}, честных игроков ${honest.length}`);
  const dist: Record<number, number> = {};
  for (const f of honest) dist[f.workers] = (dist[f.workers] ?? 0) + 1;
  console.log(`Единомышленников к концу у честных: ${Object.entries(dist).map(([k, v]) => `${k} — ${pct(v, honest.length)}`).join(', ')}`);
  for (const w of Object.keys(dist).map(Number).sort()) {
    const F = honest.filter((f) => f.workers === w);
    console.log(`  с ${w}: средний итог ${mean(F.map((f) => f.total)).toFixed(1)}, побед ${pct(F.filter((f) => f.win).length, F.length)}`);
  }
  console.log('\nПо Пятилеткам (честные): Талонов на старте поручений; доля игроков, у кого был хоть один шанс нанять; из них наняли; ходов-шансов на игрока');
  const R = rows.flatMap((r) => r.rounds.filter((x) => !x.curator));
  for (let r = 1; r <= RULES.rounds; r++) {
    const X = R.filter((x) => x.round === r);
    const withChance = X.filter((x) => x.chances > 0);
    const hist: Record<string, number> = {};
    for (const x of X) { const k = x.talonsStart >= 10 ? '10+' : String(x.talonsStart); hist[k] = (hist[k] ?? 0) + 1; }
    console.log(`П${r}: Талонов на старте ${mean(X.map((x) => x.talonsStart)).toFixed(1)} (≥${RULES.hireCost}: ${pct(X.filter((x) => x.talonsStart >= RULES.hireCost).length, X.length)}), `
      + `шанс был у ${pct(withChance.length, X.length)}, наняли ${pct(withChance.filter((x) => x.hired).length, withChance.length)} из них, `
      + `ходов-шансов ${mean(withChance.map((x) => x.chances)).toFixed(1)}, Талонов в конце поручений ${mean(X.map((x) => x.endTalons)).toFixed(1)}, удержано ${mean(X.map((x) => x.held)).toFixed(2)}`);
    const inst: Record<string, number> = {};
    for (const x of withChance) for (const [k, v] of Object.entries(x.instead)) inst[k] = (inst[k] ?? 0) + v;
    const tot = Object.values(inst).reduce((a, b) => a + b, 0);
    console.log(`    вместо найма (ходы с шансом): ${Object.entries(inst).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${pct(v, tot)}`).join(', ')}`);
  }
  console.log('\nНаём в П1–2 по стратегиям (доля игроков, нанявших хоть раз в П1–2):');
  const by: Record<string, { n: number; h: number }> = {};
  for (const r of rows) {
    const per: Record<string, { preset: string; hired: number }> = {};
    for (const x of r.rounds.filter((y) => !y.curator && y.round <= 2)) {
      per[x.player] ??= { preset: x.preset, hired: 0 };
      per[x.player].hired += x.hired;
    }
    for (const v of Object.values(per)) { const b = (by[v.preset] ??= { n: 0, h: 0 }); b.n++; if (v.hired) b.h++; }
  }
  for (const [k, v] of Object.entries(by)) console.log(`  ${presetById(k).name}: ${pct(v.h, v.n)} (${v.n})`);
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const games = Number(process.argv[2] ?? 10), n = Number(process.argv[3] ?? 4);
  const skill = (process.argv[4] ?? 'thoughtful') as BotSkill;
  const from = Number(process.argv[5] ?? 0), out = process.argv[6];
  const rows: Row[] = [];
  for (let g = from; g < from + games; g++) {
    const r = play(n, g, skill);
    if (!r) continue;
    rows.push(r);
    if (out) appendFileSync(out, JSON.stringify(r) + '\n');
  }
  if (!out) report(rows);
}
