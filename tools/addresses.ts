// Посещаемость адресов с учётом того, сколько Пятилеток адрес лежал на столе:
// npm run addresses -- [партий] [игроков] [пресет]. Явочные адреса выкладываются по одному в конце Пятилетки,
// поэтому сравнивать их с постоянными честнее «за Пятилетку на столе» и по заполненности мест.
import { createGame, activePlayers } from '../src/engine/engine';
import { botMove } from '../src/engine/bot';
import { ADDRESSES, PERMANENT_ADDRESSES, limitFor } from '../src/engine/content';
import type { AddressId } from '../src/engine/types';
const games = Number(process.argv[2] ?? 100), n = Number(process.argv[3] ?? 3), preset = process.argv[4] ?? 'bookman';
const visits: Record<string, number> = {}, viaCopy: Record<string, number> = {}, present: Record<string, number> = {};
for (let seed = 1; seed <= games; seed++) {
  let t = seed; const rand = () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  let s = createGame({ players: Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'Б' + k })), seed });
  let lastRound = 0;
  for (let i = 0; i < 6000 && s.phase !== 'end'; i++) {
    if (s.phase === 'orders' && s.round !== lastRound) {
      lastRound = s.round;
      for (const a of [...PERMANENT_ADDRESSES.filter((x) => !ADDRESSES[x].fullOnly), ...s.safehouses]) present[a] = (present[a] ?? 0) + 1;
    }
    const who = activePlayers(s)[0];
    const before = s.players.find((p) => p.id === who)!.actions.length;
    const round = s.round;
    s = botMove(s, who, rand, preset);
    const p = s.players.find((x) => x.id === who)!;
    if (s.round === round && p.actions.length > before) {
      const added = p.actions.slice(before).map((x) => x.target);
      const copy = added.includes('group:copyText');
      for (const a of added) if (!a.startsWith('group:')) { visits[a] = (visits[a] ?? 0) + 1; if (copy) viaCopy[a] = (viaCopy[a] ?? 0) + 1; }
    }
  }
}
console.log(`${games} партий на ${n}, ${preset}`);
console.log('Адрес                       на столе    за партию   за пятилетку      заполненность мест   (из них через Тиражирование)');
console.log('                            (пятилеток  на игрока   на столе,         (доля занятых мест');
console.log('                            за партию)              на игрока         за пятилетку на столе)');
const rows = Object.keys(present).map((a) => {
  const v = visits[a] ?? 0, pr = present[a];
  const lim = limitFor(a as AddressId, n);
  return { a, pr: pr / games, perGame: v / games / n, perRound: v / pr / n, fill: isFinite(lim) ? v / (pr * lim) : NaN, copy: (viaCopy[a] ?? 0) / Math.max(1, v) };
}).sort((x, y) => (isNaN(y.fill) ? -1 : y.fill) - (isNaN(x.fill) ? -1 : x.fill));
for (const r of rows) console.log(`${ADDRESSES[r.a as AddressId].name.padEnd(28)}${r.pr.toFixed(2).padStart(5)}      ${r.perGame.toFixed(2).padStart(5)}       ${r.perRound.toFixed(2).padStart(5)}             ${isNaN(r.fill) ? '   —' : (Math.round(r.fill * 100) + '%').padStart(4)}                ${r.copy ? Math.round(r.copy * 100) + '%' : ''}`);
