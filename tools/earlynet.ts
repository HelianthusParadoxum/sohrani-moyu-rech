// «Расширить Сеть» — приоритет в 1–2-й Пятилетке. Парный опыт: каждая раздача играется трижды, меняется один бот
// (место сдвигается по кругу), остальные — как обычно:
//   base — прежняя логика; net — вес цели «Расширить Сеть» в П1–2 = 10 (наивысший);
//   save — то же и копит на наём (BOT_BASE.hireSave = 1: Талоны до цены найма ценнее, пока сеть не максимальна).
// Полный режим, Куратор в каждой партии (как в замере баланса; изменяемый бот — честный), стратегии — случайные из лобби.
// npm run earlynet -- [раздач] [игроков] [standard|thoughtful] [с какой раздачи] [файл]; затем `npm run earlynet -- merge файл…`
import { appendFileSync, readFileSync } from 'node:fs';
import { createGame } from '../src/engine/engine';
import { playOut, type BotSkill } from '../src/engine/bot';
import { BOT_PRESETS, selectablePresets } from '../src/engine/bot-presets';

type Side = { total: number; win: boolean; place: number; workers: number; hiredEarly: number; glasnost: boolean };
type Row = { n: number; seed: number; preset: string; base: Side; net: Side; save: Side };
const VARIANTS = ['net', 'save'] as const;

function seeded(seed: number) {
  let t = seed;
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const PRESETS = selectablePresets(false).map((p) => p.id);

function variant(id: string, v: (typeof VARIANTS)[number]): string {
  const spec = `${id}@early-${v}`;
  if (!BOT_PRESETS.some((p) => p.id === spec)) {
    const src = BOT_PRESETS.find((p) => p.id === id)!;
    const network = src.goals.network.map((x, i) => (i < 2 ? 10 : x)) as typeof src.goals.network;
    BOT_PRESETS.push({ ...src, id: spec, name: `${src.name} (сеть в П1–2${v === 'save' ? ', копит' : ''})`,
      goals: { ...src.goals, network }, base: { ...src.base, ...(v === 'save' ? { hireSave: 1 } : {}) } });
  }
  return spec;
}

function side(s: ReturnType<typeof playOut>, id: string): Side {
  const r = s.result!;
  const me = r.scores.find((x) => x.player === id)?.total ?? 0;
  const totals = r.scores.map((x) => x.total).sort((a, b) => b - a);
  const hiredEarly = s.log.filter((l) => l.round <= 2 && l.text === `${s.players.find((p) => p.id === id)!.name} расширяет сеть: +1 Единомышленник.`).length;
  return { total: me, win: r.winners.includes(id), place: totals.indexOf(me) + 1, workers: s.players.find((p) => p.id === id)!.workers, hiredEarly, glasnost: r.glasnost };
}

function play(n: number, seed: number, skill: BotSkill): Row | null {
  const players = Array.from({ length: n }, (_, j) => ({ id: `p${j}`, name: `Бот ${j}` }));
  const pr = seeded(seed * 7 + 1);
  const pick = Object.fromEntries(players.map((p) => [p.id, PRESETS[Math.floor(pr() * PRESETS.length)]]));
  // Куратор — первый игрок (forceCurator); меняем честного.
  const who = players[1 + (seed % (n - 1))].id;
  const run = (presets: Record<string, string>) => playOut(createGame({ players, seed, mode: 'full', forceCurator: true }), seeded(seed), 12000, presets, skill);
  const a = run(pick), b = run({ ...pick, [who]: variant(pick[who], 'net') }), c = run({ ...pick, [who]: variant(pick[who], 'save') });
  if ([a, b, c].some((s) => s.phase !== 'end' || !s.result)) return null;
  return { n, seed, preset: pick[who], base: side(a, who), net: side(b, who), save: side(c, who) };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function report(rows: Row[]) {
  for (const n of [...new Set(rows.map((r) => r.n))].sort()) {
    const R = rows.filter((r) => r.n === n);
    console.log(`\n=== ${n} игроков: раздач ${R.length} (меняется один честный бот; Куратор в каждой партии)`);
    const line = (name: string, f: (r: Row) => Side) => {
      const S = R.map(f);
      return `${name.padEnd(26)} наём в П1–2 ${mean(S.map((x) => x.hiredEarly)).toFixed(2)}, Единомышленников к концу ${mean(S.map((x) => x.workers)).toFixed(2)}, `
        + `итог ${mean(S.map((x) => x.total)).toFixed(1)}, побед ${Math.round(100 * mean(S.map((x) => +x.win)))}%, место ${mean(S.map((x) => x.place)).toFixed(2)}, Гласность ${Math.round(100 * mean(S.map((x) => +x.glasnost)))}%`;
    };
    console.log(line('прежняя логика', (r) => r.base));
    console.log(line('сеть — приоритет в П1–2', (r) => r.net));
    console.log(line('...и копит на наём', (r) => r.save));
    for (const v of VARIANTS) {
      const d = R.map((r) => r[v].total - r.base.total);
      // Очки важны, только когда Гласность наступила; при её провале честные проигрывают все — смотрим и победы.
      console.log(`  ${v === 'net' ? 'приоритет' : 'приоритет + копит'} против прежней: итог ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(1)} ± ${(2 * sd(d) / Math.sqrt(R.length)).toFixed(1)}, `
        + `побед ${mean(R.map((r) => +r[v].win - +r.base.win)) >= 0 ? '+' : ''}${Math.round(100 * mean(R.map((r) => +r[v].win - +r.base.win)))} п. п.`);
    }
  }
}

if (process.argv[2] === 'merge') {
  report(process.argv.slice(3).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const games = Number(process.argv[2] ?? 20), n = Number(process.argv[3] ?? 4);
  const skill = (process.argv[4] ?? 'standard') as BotSkill;
  const from = Number(process.argv[5] ?? 0), out = process.argv[6];
  const rows: Row[] = [];
  for (let g = from; g < from + games; g++) {
    const row = play(n, 15000 + g, skill);
    if (!row) continue;
    rows.push(row);
    if (out) appendFileSync(out, JSON.stringify(row) + '\n');
  }
  if (!out) report(rows);
}
