// «Снежный ком»: отрывается ли вырвавшийся вперёд всё сильнее, а отставший — отстаёт ли всё больше, и что к этому ведёт.
// Полный режим, Куратор — как в обычной партии (может и не выпасть), честным — случайные стратегии из лобби.
// В конце каждой Пятилетки записывается срез каждого игрока: «счёт, если бы партия кончилась сейчас» (scoreLine.total —
// очки, Пристрастие, связи, Талоны), ресурсы и куда он ходил в эту Пятилетку. Анализ — только по честным игрокам.
// npm run snowball -- [партий] [игроков] [standard|thoughtful] [с какой партии] [файл]
// Долгий на «Вдумчивых»: запускайте в несколько процессов с разным смещением и файлом, затем `npm run snowball -- merge файл…`.
import { appendFileSync, readFileSync } from 'node:fs';
import { activePlayers, createGame } from '../src/engine/engine';
import { botMove, type BotSkill } from '../src/engine/bot';
import { selectablePresets, presetById } from '../src/engine/bot-presets';
import { scoreLine } from '../src/engine/scoring';
import { ADDRESSES, GROUP_ACTIONS } from '../src/engine/content';
import type { GameState } from '../src/engine/types';

type Snap = {
  round: number; total: number; during: number; talons: number; workers: number; held: number; connections: number;
  cache: number; capacity: number; fed: number; published: number; books: number; actions: string[];
};
type PlayerRow = { id: string; preset: string; curator: boolean; snaps: Snap[]; final: number; won: boolean };
type Game = { n: number; seed: number; glasnost: boolean; players: PlayerRow[] };

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function snap(s: GameState, before: GameState, id: string, round: number): Snap {
  const p = s.players.find((x) => x.id === id)!;
  const b = before.players.find((x) => x.id === id)!;
  const line = scoreLine(s, p);
  return {
    round, total: line.total, during: p.points, talons: p.talons, workers: p.workers, held: p.held, connections: line.connections,
    cache: p.cache, capacity: p.capacity, fed: p.sproutsFed.length, published: p.published.length + p.tamizdat.length,
    books: p.warehouse.length, actions: b.actions.map((a) => a.target),
  };
}

function play(n: number, seed: number, skill: BotSkill): Game | null {
  const rand = seeded(seed);
  const presets = selectablePresets(false).map((p) => p.id);
  const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
  const pick = Object.fromEntries(players.map((p) => [p.id, presets[Math.floor(rand() * presets.length)]]));
  let s = createGame({ players, seed, mode: 'full' });
  const snaps: Record<string, Snap[]> = Object.fromEntries(players.map((p) => [p.id, []]));
  for (let i = 0; i < 12000 && s.phase !== 'end'; i++) {
    const prev = s;
    const who = activePlayers(s)[0];
    s = botMove(s, who, rand, pick[who], skill);
    // Конец Пятилетки: новая Пятилетка или конец партии (срез — после облавы; куда ходил — из состояния до перехода).
    if (s.round > prev.round || (s.phase === 'end' && prev.phase !== 'end')) {
      for (const p of players) snaps[p.id].push(snap(s, prev, p.id, prev.round));
    }
  }
  if (s.phase !== 'end' || !s.result) return null;
  return {
    n, seed, glasnost: s.result.glasnost,
    players: s.players.map((p) => ({
      id: p.id, preset: presetById(pick[p.id]).name, curator: p.passion === 'curator', snaps: snaps[p.id],
      final: s.result!.scores.find((x) => x.player === p.id)!.total, won: s.result!.winners.includes(p.id),
    })),
  };
}

// ---------- Анализ ----------

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '—');

function ranks(vals: number[]): number[] {
  const order = vals.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const r = new Array(vals.length).fill(0);
  order.forEach(([, i], k) => { r[i] = k; });
  return r;
}
function corr(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; }
  return a / Math.sqrt(b * c);
}

function report(games: Game[]) {
  for (const n of [...new Set(games.map((g) => g.n))].sort()) {
    const G = games.filter((g) => g.n === n);
    const honest = (g: Game) => g.players.filter((p) => !p.curator && p.snaps.length === 5);
    console.log(`\n=== ${n} игроков: партий ${G.length} (с Куратором ${G.filter((g) => g.players.some((p) => p.curator)).length}), Гласность ${pct(mean(G.map((g) => (g.glasnost ? 1 : 0))))}`);

    // 1. Разрыв по Пятилеткам: размах (лидер − последний) и разрыв лидера со вторым среди честных.
    console.log('\n1. Разрыв между честными игроками по «счёту, если бы партия кончилась сейчас»:');
    console.log('   Пятилетка | средний счёт | лидер − последний | лидер − второй | последний − предпоследний');
    for (let r = 0; r < 5; r++) {
      const spread: number[] = [], lead: number[] = [], tail: number[] = [], avg: number[] = [];
      for (const g of G) {
        const t = honest(g).map((p) => p.snaps[r].total).sort((a, b) => b - a);
        if (t.length < 2) continue;
        spread.push(t[0] - t[t.length - 1]); lead.push(t[0] - t[1]); tail.push(t[t.length - 2] - t[t.length - 1]); avg.push(mean(t));
      }
      console.log(`   ${r + 1}          | ${f1(mean(avg)).padStart(5)}        | ${f1(mean(spread)).padStart(5)}             | ${f1(mean(lead)).padStart(5)}          | ${f1(mean(tail)).padStart(5)}`);
    }

    // 2. Импульс: сколько игрок набирает в следующей Пятилетке в зависимости от места после текущей.
    console.log('\n2. Импульс: прирост счёта за следующую Пятилетку по месту среди честных после текущей (1 — лидер):');
    const places = Math.max(...G.map((g) => honest(g).length));
    console.log(`   после Пятилетки | ${Array.from({ length: places }, (_, k) => `${k + 1}-е место`.padStart(9)).join(' | ')}`);
    for (let r = 0; r < 4; r++) {
      const gain: number[][] = Array.from({ length: places }, () => []);
      for (const g of G) {
        const H = honest(g);
        const rk = ranks(H.map((p) => p.snaps[r].total));
        H.forEach((p, i) => gain[rk[i]].push(p.snaps[r + 1].total - p.snaps[r].total));
      }
      console.log(`   ${r + 1}               | ${gain.map((a) => f1(mean(a)).padStart(9)).join(' | ')}`);
    }

    // 3. Устойчивость мест: совпадает ли место после Пятилетки с итоговым; выигрывает ли лидер.
    console.log('\n3. Устойчивость мест среди честных:');
    console.log('   после Пятилетки | связь места с итоговым (Спирмен) | лидер остаётся первым к концу | последний остаётся последним');
    for (let r = 0; r < 4; r++) {
      const rho: number[] = []; let lead = 0, last = 0, cnt = 0;
      for (const g of G) {
        const H = honest(g);
        if (H.length < 3) continue;
        const a = ranks(H.map((p) => p.snaps[r].total)), b = ranks(H.map((p) => p.final));
        rho.push(corr(a, b)); cnt++;
        if (b[a.indexOf(0)] === 0) lead++;
        if (b[a.indexOf(H.length - 1)] === H.length - 1) last++;
      }
      console.log(`   ${r + 1}               | ${f2(mean(rho)).padStart(5)}                            | ${pct(lead / cnt).padStart(4)}                          | ${pct(last / cnt).padStart(4)}`);
    }
    console.log(`   (случайно: лидер остаётся первым и последний — последним в ${pct(1 / Math.max(1, places))} партий)`);

    // 4. Что отличает лидера от последнего после 2-й Пятилетки — и что предсказывает прирост в 3–5-й.
    console.log('\n4. Ресурсы после 2-й Пятилетки: лидер vs последний среди честных; связь ресурса с приростом счёта в 3–5-й:');
    const keys: [keyof Snap, string][] = [['workers', 'Единомышленники'], ['held', 'удержано Конторой'], ['talons', 'Талоны'], ['connections', 'связи с Завсегдатаями'],
      ['cache', 'Тайник'], ['capacity', 'Склад'], ['fed', 'накормлено ступеней Ростков'], ['published', 'издано'], ['books', 'книг на складе'], ['during', 'очки Гласности']];
    const all = G.flatMap((g) => honest(g));
    for (const [k, name] of keys) {
      const lead: number[] = [], lastV: number[] = [];
      for (const g of G) {
        const H = honest(g);
        const rk = ranks(H.map((p) => p.snaps[1].total));
        lead.push(H[rk.indexOf(0)].snaps[1][k] as number); lastV.push(H[rk.indexOf(H.length - 1)].snaps[1][k] as number);
      }
      const c = corr(all.map((p) => p.snaps[1][k] as number), all.map((p) => p.snaps[4].total - p.snaps[1].total));
      console.log(`   ${name.padEnd(28)} лидер ${f1(mean(lead)).padStart(5)}  последний ${f1(mean(lastV)).padStart(5)}  связь с приростом ${f2(c).padStart(5)}`);
    }

    // 5. Куда ходят в 1–2-й Пятилетке будущие лидеры и аутсайдеры (доля действий, в среднем на игрока за Пятилетку).
    console.log('\n5. Поручения в 1–2-й Пятилетке: итоговый лидер vs итоговый последний среди честных (действий за Пятилетку):');
    const count = (rows: PlayerRow[]) => {
      const m = new Map<string, number>();
      for (const p of rows) for (const sn of p.snaps.slice(0, 2)) for (const a of sn.actions) m.set(a, (m.get(a) ?? 0) + 1);
      return m;
    };
    const tops = G.map((g) => { const H = honest(g); return H[ranks(H.map((p) => p.final)).indexOf(0)]; });
    const lasts = G.map((g) => { const H = honest(g); return H[ranks(H.map((p) => p.final)).indexOf(H.length - 1)]; });
    const ct = count(tops), cl = count(lasts);
    const targets = [...new Set([...ct.keys(), ...cl.keys()])]
      .map((t) => ({ t, top: (ct.get(t) ?? 0) / (2 * tops.length), last: (cl.get(t) ?? 0) / (2 * lasts.length) }))
      .sort((a, b) => Math.abs(b.top - b.last) - Math.abs(a.top - a.last));
    const nameOf = (t: string) => (t.startsWith('group:') ? `Группа: ${GROUP_ACTIONS[t.slice(6) as keyof typeof GROUP_ACTIONS]?.name ?? t.slice(6)}` : (ADDRESSES as Record<string, { name: string }>)[t]?.name ?? t);
    for (const x of targets.slice(0, 14)) console.log(`   ${nameOf(x.t).padEnd(34)} лидер ${f2(x.top)}  последний ${f2(x.last)}  разница ${(x.top - x.last >= 0 ? '+' : '') + f2(x.top - x.last)}`);

    // 6. Стратегии: доля побед среди честных и средний итоговый счёт.
    console.log('\n6. Стратегии честных: средний итоговый счёт и доля «первых мест среди честных»:');
    const by = new Map<string, { s: number[]; first: number }>();
    for (const g of G) {
      const H = honest(g);
      const rk = ranks(H.map((p) => p.final));
      H.forEach((p, i) => { const e = by.get(p.preset) ?? { s: [], first: 0 }; e.s.push(p.final); if (rk[i] === 0) e.first++; by.set(p.preset, e); });
    }
    for (const [name, e] of [...by].sort((a, b) => mean(b[1].s) - mean(a[1].s))) console.log(`   ${name.padEnd(20)} счёт ${f1(mean(e.s)).padStart(5)}  первое место ${pct(e.first / e.s.length)} (из ${e.s.length})`);
  }
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Game)));
} else {
  const games = Number(process.argv[2] ?? 10);
  const n = Number(process.argv[3] ?? 4);
  const skill = (process.argv[4] ?? 'thoughtful') as BotSkill;
  const from = Number(process.argv[5] ?? 0);
  const out = process.argv[6];
  const rows: Game[] = [];
  for (let g = from; g < from + games; g++) {
    const game = play(n, 9000 + g, skill);
    if (!game) continue;
    rows.push(game);
    if (out) appendFileSync(out, JSON.stringify(game) + '\n');
  }
  if (!out) report(rows);
}
