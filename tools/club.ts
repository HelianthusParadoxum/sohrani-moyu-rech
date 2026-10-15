// Клуб книголюбов глазами ботов (полный режим): npm run club -- [партий] [игроков] [пресеты через запятую]
// Пресет можно усилить или ослабить по цели «Связи в Клубе»: bookman*2 — вес Клуба вдвое больше, bookman*0 — Клуб не ценит.
// Пример A/B-теста: npm run club -- 200 4 bookman,bookman*2
// Куратор в этих партиях отключён, чтобы сравнивать только очки.

import { botMove } from '../src/engine/bot';
import { activePlayers, createGame } from '../src/engine/engine';
import { BOT_PRESETS, presetById } from '../src/engine/bot-presets';
import { PATRONS } from '../src/engine/content';
import type { GameState, PatronId } from '../src/engine/types';

const games = Number(process.argv[2] ?? 100);
const n = Number(process.argv[3] ?? 4);
const specs = (process.argv[4] ?? 'bookman').split(',').filter(Boolean);
const first = Number(process.argv[5] ?? 0); // с какого номера партии начинать (для запуска в несколько процессов)

// «bookman*2» — копия пресета с весами Клуба, умноженными на 2 (не больше 10).
for (const spec of specs) {
  if (BOT_PRESETS.some((p) => p.id === spec)) continue;
  const [base, k] = spec.split('*');
  const src = BOT_PRESETS.find((p) => p.id === base);
  if (!src || k === undefined) throw new Error(`Не понимаю пресет «${spec}»`);
  const goals = { ...src.goals, club: src.goals.club.map((x) => Math.min(10, x * Number(k))) as typeof src.goals.club };
  BOT_PRESETS.push({ ...src, id: spec, name: `${src.name} ×${k} Клуб`, goals });
}

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const conns = (s: GameState, pid: string) => s.patrons.filter((x) => x.connections.includes(pid)).length;

type PresetStat = { plays: number; wins: number; total: number; conns: number; visits: number; gifts: number; byRound: number[] };
type PatronStat = { games: number; links: number; withPlays: number; withWins: number; withTotal: number; withoutPlays: number; withoutWins: number; withoutTotal: number; round: number };
const preset: Record<string, PresetStat> = {};
const patron: Partial<Record<PatronId, PatronStat>> = {};
const visitSizes: Record<number, number> = {};
const started = Date.now();

for (let i = first; i < first + games; i++) {
  const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
  const presets = Object.fromEntries(players.map((p, k) => [p.id, specs[(k + i) % specs.length]]));
  let s = createGame({ players, seed: i + 1, mode: 'full', curator: false });
  const rand = seeded(i + 1);
  const linkRound: Partial<Record<PatronId, Record<string, number>>> = {};
  for (let step = 0; step < 5000 && s.phase !== 'end'; step++) {
    const who = activePlayers(s)[0];
    const before = conns(s, who);
    const was = new Set(s.patrons.filter((x) => x.connections.includes(who)).map((x) => x.id));
    s = botMove(s, who, rand, presets[who]);
    const got = conns(s, who) - before;
    if (got > 0) {
      const st = (preset[presets[who]] ??= { plays: 0, wins: 0, total: 0, conns: 0, visits: 0, gifts: 0, byRound: [0, 0, 0, 0, 0] });
      st.visits++;
      st.gifts += got;
      st.byRound[s.round - 1] += got;
      visitSizes[got] = (visitSizes[got] ?? 0) + 1;
      for (const pt of s.patrons) if (pt.connections.includes(who) && !was.has(pt.id)) (linkRound[pt.id] ??= {})[who] = s.round;
    }
  }
  const r = s.result!;
  const best = Math.max(...r.scores.map((x) => x.total));
  for (const p of s.players) {
    const st = (preset[presets[p.id]] ??= { plays: 0, wins: 0, total: 0, conns: 0, visits: 0, gifts: 0, byRound: [0, 0, 0, 0, 0] });
    const line = r.scores.find((x) => x.player === p.id)!;
    st.plays++;
    st.total += line.total;
    st.conns += conns(s, p.id);
    if (r.winners.includes(p.id)) st.wins++;
  }
  // Связь против отсутствия связи с каждым Завсегдатаем: средний отрыв от лидера и доля побед.
  for (const pt of s.patrons) {
    const ps = (patron[pt.id] ??= { games: 0, links: 0, withPlays: 0, withWins: 0, withTotal: 0, withoutPlays: 0, withoutWins: 0, withoutTotal: 0, round: 0 });
    ps.games++;
    for (const p of s.players) {
      const line = r.scores.find((x) => x.player === p.id)!;
      const win = r.winners.includes(p.id) ? 1 : 0;
      const gap = line.total - best;
      if (pt.connections.includes(p.id)) {
        ps.links++; ps.withPlays++; ps.withWins += win; ps.withTotal += gap;
        ps.round += linkRound[pt.id]?.[p.id] ?? 0;
      } else {
        ps.withoutPlays++; ps.withoutWins += win; ps.withoutTotal += gap;
      }
    }
  }
}

const f = (x: number, d = 1) => x.toFixed(d);
console.log(`Партий: ${games}, игроков: ${n}, полный режим без Куратора. Время: ${f((Date.now() - started) / 1000)} с`);
console.log('\nПо пресетам: побед / мест, средний итог, связей к концу, приходов в Клуб за партию, связей за приход, связей по Пятилеткам');
for (const [id, st] of Object.entries(preset)) {
  console.log(`  ${presetById(id).name.padEnd(20)} ${st.wins} / ${st.plays} (${f((100 * st.wins) / st.plays, 0)}%), итог ${f(st.total / st.plays)}, связей ${f(st.conns / st.plays)}, `
    + `приходов ${f(st.visits / st.plays)}, за приход ${f(st.gifts / Math.max(1, st.visits), 2)}, по Пятилеткам ${st.byRound.map((x) => f(x / st.plays, 2)).join(' / ')}`);
}
console.log(`\nСколько связей заводят за один приход: ${Object.entries(visitSizes).map(([k, v]) => `${k} — ${v} раз`).join(', ')}`);
console.log('\nЗавсегдатаи (по убыванию популярности): связей на партию (из возможных ' + n + '), средняя Пятилетка связи,');
console.log('доля побед и средний отрыв от лидера — у игроков со связью и без неё:');
const rows = Object.entries(patron).map(([id, ps]) => ({ id: id as PatronId, ...ps! }))
  .sort((a, b) => b.links / b.games - a.links / a.games);
for (const ps of rows) {
  console.log(`  ${PATRONS[ps.id].name.padEnd(14)} ${f(ps.links / ps.games, 2)} / партию (в ${ps.games} партиях), Пятилетка ${f(ps.round / Math.max(1, ps.links))}; `
    + `со связью: побед ${f((100 * ps.withWins) / Math.max(1, ps.withPlays), 0)}%, отрыв ${f(ps.withTotal / Math.max(1, ps.withPlays))}; `
    + `без: побед ${f((100 * ps.withoutWins) / Math.max(1, ps.withoutPlays), 0)}%, отрыв ${f(ps.withoutTotal / Math.max(1, ps.withoutPlays))}`);
}
