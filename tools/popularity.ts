// Популярность адресов и действий Инициативной группы — в условиях замера баланса: полный режим, Куратор в каждой партии,
// честным — случайные стратегии из лобби, умелость — «Вдумчивые» (или «Упрощённые» для прикидки).
// npm run popularity -- [партий] [игроков] [thoughtful|standard] [с какой партии] [файл]; затем `npm run popularity -- merge файл…`
// Адреса: посещений за партию на игрока и заполненность мест (явочные адреса лежат на столе не всю партию — считаем
// «за Пятилетку на столе»). Действия Группы: за партию на игрока, по источнику — Единомышленник, явочный адрес, Росток.
import { appendFileSync, readFileSync } from 'node:fs';
import { activePlayers, createGame } from '../src/engine/engine';
import { botMove, type BotSkill } from '../src/engine/bot';
import { selectablePresets } from '../src/engine/bot-presets';
import { ADDRESSES, GROUP_ACTIONS, PERMANENT_ADDRESSES, addressInGame, limitFor } from '../src/engine/content';
import type { AddressId, GameState } from '../src/engine/types';

type Row = { n: number; present: Record<string, number>; visits: Record<string, number>; groups: Record<string, number>; club: number; rescue: number; kontora: number };

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
  const present: Record<string, number> = {}, visits: Record<string, number> = {};
  let lastRound = 0;
  for (let i = 0; i < 12000 && s.phase !== 'end'; i++) {
    if (s.phase === 'orders' && s.round !== lastRound) {
      lastRound = s.round;
      for (const a of [...PERMANENT_ADDRESSES.filter((x) => x !== 'club' && addressInGame(s, x)), ...s.safehouses]) present[a] = (present[a] ?? 0) + 1;
    }
    const who = activePlayers(s)[0];
    const before = s.players.find((p) => p.id === who)!.actions.length;
    const round = s.round;
    s = botMove(s, who, rand, pick[who], skill);
    const p = s.players.find((x) => x.id === who)!;
    if (s.round === round && p.actions.length > before) {
      for (const a of p.actions.slice(before).map((x) => x.target)) if (!a.startsWith('group:')) visits[a] = (visits[a] ?? 0) + 1;
    }
  }
  if (s.phase !== 'end') return null;
  const groups: Record<string, number> = {};
  for (const p of s.players) for (const [k, v] of Object.entries(p.groupBy ?? {})) groups[k] = (groups[k] ?? 0) + v;
  const texts = s.log.map((l) => l.text);
  return {
    n, present, visits, groups,
    // Связи в Клубе по ходу партии (стартовая пишется без пояснения в скобках — её не считаем).
    club: texts.filter((t) => t.includes('заводит связь в Клубе') && t.endsWith(').')).length,
    rescue: texts.filter((t) => t.startsWith('↳ За помощь товарищам')).length,
    kontora: visits.kontora ?? 0,
  };
}

function report(rows: Row[]) {
  for (const n of [...new Set(rows.map((r) => r.n))].sort()) {
    const R = rows.filter((r) => r.n === n);
    const G = R.length, per = (x: number) => (x / G / n).toFixed(2).padStart(5);
    const sum = (f: (r: Row) => Record<string, number>) => { const o: Record<string, number> = {}; for (const r of R) for (const [k, v] of Object.entries(f(r))) o[k] = (o[k] ?? 0) + v; return o; };
    const present = sum((r) => r.present), visits = sum((r) => r.visits), groups = sum((r) => r.groups);
    console.log(`\n=== ${n} игроков, партий ${G}`);
    console.log('Адрес                      на столе   за партию   заполненность мест');
    console.log('                           (Пятилеток) на игрока  (за Пятилетку на столе)');
    const rows2 = Object.keys(present).map((a) => {
      const v = visits[a] ?? 0, pr = present[a], lim = limitFor(a as AddressId, n);
      return { a, pr: pr / G, v, fill: isFinite(lim) ? v / (pr * lim) : NaN };
    }).sort((x, y) => y.v / y.pr - x.v / x.pr);
    for (const r of rows2) console.log(`${ADDRESSES[r.a as AddressId].name.padEnd(27)}${r.pr.toFixed(1).padStart(5)}      ${per(r.v)}      ${isNaN(r.fill) ? '  —' : (Math.round(r.fill * 100) + '%').padStart(4)}`);
    console.log('\nДействие Группы             всего за партию на игрока: Единомышленником / за явочный адрес / с Ростка и пр.');
    const ids = Object.keys(GROUP_ACTIONS);
    const tot = (id: string, src: string) => groups[`${id}:${src}`] ?? 0;
    for (const id of ids.sort((a, b) => ['worker', 'extra', 'free'].reduce((s, x) => s + tot(b, x) - tot(a, x), 0))) {
      const all = tot(id, 'worker') + tot(id, 'extra') + tot(id, 'free');
      console.log(`${GROUP_ACTIONS[id as keyof typeof GROUP_ACTIONS].name.padEnd(28)}${per(all)}       ${per(tot(id, 'worker'))} / ${per(tot(id, 'extra'))} / ${per(tot(id, 'free'))}`);
    }
    const rescue = R.reduce((s, r) => s + r.rescue, 0), kontora = R.reduce((s, r) => s + r.kontora, 0);
    console.log(`\nКлуб: связей по ходу партии (без стартовой) ${per(R.reduce((s, r) => s + r.club, 0))} на игрока`);
    console.log(`\nКонтора: заходов ${per(kontora)} за партию на игрока, из них «Вызволить из бед» ${Math.round(100 * rescue / Math.max(1, kontora))}%`);
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
    const r = play(n, g, skill);
    if (!r) continue;
    rows.push(r);
    if (out) appendFileSync(out, JSON.stringify(r) + '\n');
  }
  if (!out) report(rows);
}
