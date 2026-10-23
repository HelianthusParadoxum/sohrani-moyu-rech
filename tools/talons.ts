// Откуда у игроков Талоны и на что уходят: npm run talons -- [партий] [игроков] [режим] [пресет]
// Пример: npm run talons -- 40 5 full
// Доходы — по источникам (p.talonsBy пишет earn), расходы — по поручению, на котором Талоны ушли.
import { activePlayers, createGame } from '../src/engine/engine';
import { botMove } from '../src/engine/bot';
import { ADDRESSES, GROUP_ACTIONS, PATRONS } from '../src/engine/content';
import { DEFAULT_PRESET } from '../src/engine/bot-presets';
import type { AddressId, GroupActionId, Mode, PatronId } from '../src/engine/types';

const games = Number(process.argv[2] ?? 40);
const n = Number(process.argv[3] ?? 4);
const mode = (process.argv[4] ?? 'full') as Mode;
const preset = process.argv[5] ?? DEFAULT_PRESET;

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES: Record<string, string> = {
  irony: 'Ирония пущена в народ', sideJob: 'Приработок (бонус Ростка)', sprouts: 'Ростки (ступени I)', other: 'прочее (решения, ответы)',
};
// Завсегдатаи, которые дают или экономят Талоны (ключи в p.talonsBy / p.talonsSaved).
const PATRON_SOURCES: PatronId[] = ['typist', 'broker', 'tsekhovik', 'professor', 'nesun', 'geologist', 'correspondent', 'zavkhoz', 'buyer', 'veteran', 'zavmag'];
const nameOf = (k: string) => NAMES[k] ?? ((PATRON_SOURCES as string[]).includes(k) ? `Завсегдатай ${PATRONS[k as PatronId].name}` : k.startsWith('group:') ? `Группа: ${GROUP_ACTIONS[k.slice(6) as GroupActionId]?.name ?? k}` : ADDRESSES[k as AddressId]?.name ?? k);

const income: Record<string, number> = {};
const savedBy: Record<string, number> = {};
const holders: Record<string, number> = {}; // сколько раз у игрока к концу партии была связь с Завсегдатаем
const rounds: Record<string, number> = {}; // и сколько Пятилеток в сумме
const spent: Record<string, number> = {};
let start = 0, end = 0, playerGames = 0;
const endByRound: number[] = [0, 0, 0, 0, 0];
for (let i = 0; i < games; i++) {
  const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
  let s = createGame({ players, seed: 9000 + i, mode });
  const rand = seeded(9000 + i);
  start += s.players.reduce((a, p) => a + p.talons, 0);
  let round = s.round;
  for (let step = 0; step < 6000 && s.phase !== 'end'; step++) {
    const who = activePlayers(s)[0];
    const before = new Map(s.players.map((p) => [p.id, { t: p.talons, inc: Object.values(p.talonsBy ?? {}).reduce((a, b) => a + b, 0), acts: p.actions.length }]));
    s = botMove(s, who, rand, preset);
    for (const p of s.players) {
      const b = before.get(p.id)!;
      const inc = Object.values(p.talonsBy ?? {}).reduce((a, x) => a + x, 0) - b.inc;
      const out = b.t + inc - p.talons;
      if (out > 0) {
        const label = p.actions.length > b.acts ? p.actions[p.actions.length - 1].target : 'other';
        spent[label] = (spent[label] ?? 0) + out;
      }
    }
    if (s.round !== round) { endByRound[round - 1] += s.players.reduce((a, p) => a + p.talons, 0); round = s.round; }
  }
  for (const pt of s.patrons) {
    for (const id of pt.connections) {
      holders[pt.id] = (holders[pt.id] ?? 0) + 1;
      rounds[pt.id] = (rounds[pt.id] ?? 0) + (6 - (pt.since?.[id] ?? 5));
    }
  }
  for (const p of s.players) {
    for (const [k, v] of Object.entries(p.talonsBy ?? {})) income[k] = (income[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.talonsSaved ?? {})) savedBy[k] = (savedBy[k] ?? 0) + v;
    end += p.talons;
    playerGames++;
  }
  endByRound[4] += s.players.reduce((a, p) => a + p.talons, 0);
}
const per = (x: number) => (x / playerGames).toFixed(1);
const table = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `  ${nameOf(k).padEnd(34)} ${per(v).padStart(5)}`).join('\n');
const total = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
console.log(`${games} партий, ${n} игроков, режим ${mode}, пресет ${preset}. Всё — Талонов на игрока за партию.`);
console.log(`На старте: ${per(start)}; заработано: ${per(total(income))}; потрачено: ${per(total(spent))}; осталось в конце: ${per(end)}.`);
console.log(`Талонов на руках в конце Пятилетки: ${endByRound.map((x) => per(x)).join(' / ')}`);
console.log(`\nДоходы:\n${table(income)}`);
console.log(`\nРасходы:\n${table(spent)}`);

// Завсегдатаи: Талоны сверху и сэкономленные — всего за все партии и на одну связь.
const rows = PATRON_SOURCES.filter((k) => income[k] || savedBy[k]).map((k) => {
  const total = (income[k] ?? 0) + (savedBy[k] ?? 0);
  return { k, total, perLink: holders[k] ? total / holders[k] : 0, perRound: rounds[k] ? total / rounds[k] : 0, how: income[k] ? 'даёт' : 'экономит' };
}).sort((a, b) => b.total - a.total);
console.log(`\nЗавсегдатаи (Талонов: в среднем на игрока за партию / на одну связь за партию / на связь за Пятилетку):`);
for (const r of rows) {
  console.log(`  ${PATRONS[r.k as PatronId].name.padEnd(14)} ${r.how.padEnd(9)} ${per(r.total).padStart(5)}  ${r.perLink.toFixed(1).padStart(5)}  ${r.perRound.toFixed(1).padStart(5)}   (связей: ${((holders[r.k] ?? 0) / games).toFixed(1)} за партию)`);
}
