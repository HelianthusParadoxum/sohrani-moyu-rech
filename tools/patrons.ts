// Сколько на самом деле стоит связь с каждым Завсегдатаем (полный режим):
// npm run patrons -- [пар партий на Завсегдатая] [игроков] [пресеты через запятую] [с какой партии] [файл для сырых данных]
// Для каждого Завсегдатая играем пары партий с одной раздачей: в одной игрок получает связь с ним с самого начала (бесплатно),
// в другой — нет. Разница итога этого игрока между партиями и есть цена связи (в ней есть и 1 очко за саму связь).
// Куратор отключён. Без файла печатает таблицу; с файлом — дописывает сырые суммы (для запуска в несколько процессов),
// а `npm run patrons -- merge файл…` сводит их в таблицу.
import { readFileSync, writeFileSync } from 'node:fs';
import { createGame } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { onConnect } from '../src/engine/full';
import { PATRONS } from '../src/engine/content';
import type { GameState, PatronId } from '../src/engine/types';

type Acc = { n: number; diff: number; diff2: number; winT: number; winB: number };
const ids = (Object.keys(PATRONS) as PatronId[]).filter((id) => PATRONS[id].implemented);

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function report(acc: Record<string, Acc>) {
  const rows = Object.entries(acc).map(([id, a]) => {
    const mean = a.diff / a.n;
    const sd = Math.sqrt(Math.max(0, a.diff2 / a.n - mean * mean));
    return { id: id as PatronId, mean, se: sd / Math.sqrt(a.n), n: a.n, winT: a.winT / a.n, winB: a.winB / a.n };
  }).sort((x, y) => y.mean - x.mean);
  console.log('Завсегдатай       пар  итог со связью − без (± погрешность)  без очка за связь   побед со связью / без');
  for (const r of rows) {
    const flag = r.mean - 1 < -2 * r.se ? '  ← вредит' : r.mean - 1 < 0 ? '  ← скорее бесполезен' : '';
    console.log(`  ${PATRONS[r.id].name.padEnd(15)} ${String(r.n).padStart(4)}   ${(r.mean >= 0 ? '+' : '') + r.mean.toFixed(1)} ± ${r.se.toFixed(1)}`.padEnd(58)
      + `${(r.mean - 1 >= 0 ? '+' : '') + (r.mean - 1).toFixed(1)}`.padEnd(20) + `${(100 * r.winT).toFixed(0)}% / ${(100 * r.winB).toFixed(0)}%${flag}`);
  }
}

if (process.argv[2] === 'merge') {
  const acc: Record<string, Acc> = {};
  for (const f of process.argv.slice(3)) {
    for (const [id, a] of Object.entries(JSON.parse(readFileSync(f, 'utf8')) as Record<string, Acc>)) {
      const t = (acc[id] ??= { n: 0, diff: 0, diff2: 0, winT: 0, winB: 0 });
      t.n += a.n; t.diff += a.diff; t.diff2 += a.diff2; t.winT += a.winT; t.winB += a.winB;
    }
  }
  report(acc);
} else {
  const games = Number(process.argv[2] ?? 20);
  const n = Number(process.argv[3] ?? 4);
  const presetIds = (process.argv[4] ?? 'bookman,networker,collector,gardener').split(',');
  const first = Number(process.argv[5] ?? 0);
  const out = process.argv[6];
  const acc: Record<string, Acc> = {};
  const started = Date.now();
  for (const id of ids) {
    const a = (acc[id] = { n: 0, diff: 0, diff2: 0, winT: 0, winB: 0 });
    for (let g = first; g < first + games; g++) {
      const players = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` }));
      const presets = Object.fromEntries(players.map((p, k) => [p.id, presetIds[(k + g) % presetIds.length]]));
      const seat = `p${g % n}`;
      const setup = (connect: boolean): GameState => {
        const s = createGame({ players, seed: 1000 + g, mode: 'full', curator: false });
        // Завсегдатай обязательно в Клубе: если его нет, он занимает слот первого.
        if (!s.patrons.some((x) => x.id === id)) s.patrons[0].id = id;
        if (connect) {
          s.patrons.find((x) => x.id === id)!.connections.push(seat);
          if (id !== 'glavlit') onConnect(s, s.players.find((p) => p.id === seat)!, id);
        }
        return s;
      };
      const play = (connect: boolean) => {
        const s = playOut(setup(connect), seeded(1000 + g), 5000, presets);
        const r = s.result!;
        return { total: r.scores.find((x) => x.player === seat)?.total ?? 0, win: r.winners.includes(seat) ? 1 : 0 };
      };
      const t = play(true);
      const b = play(false);
      const d = t.total - b.total;
      a.n++; a.diff += d; a.diff2 += d * d; a.winT += t.win; a.winB += b.win;
    }
    if (!out) process.stderr.write(`${PATRONS[id].name} `);
  }
  if (out) writeFileSync(out, JSON.stringify(acc));
  else {
    console.log(`\nПар партий на Завсегдатая: ${games}, игроков: ${n}. Время: ${((Date.now() - started) / 1000).toFixed(0)} с`);
    report(acc);
  }
}
