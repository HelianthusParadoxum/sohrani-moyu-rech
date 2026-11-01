// Вложения в Ростки «ради общего дела»: npm run motives -- [партий] [игроков] [beginner|force] [смещение].
// Для каждого вложения честного бота сравнивает его выбор с выбором того же бота, который ценит только личную выгоду
// (веса Ростков и Гласности обнулены). Не совпало — вложение «не личное»: ради Гласности (ступени I–III) или страховки (IV).
import { createGame, activePlayers } from '../src/engine/engine';
import { botMove } from '../src/engine/bot';
import { rankActions } from '../src/engine/bot-smart';
import { BOT_BASE, presetById } from '../src/engine/bot-presets';
import { RULES } from '../src/engine/content';
const [games, n, kind, from] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 0)];
const ids = ['bookman', 'networker', 'collector', 'gardener'];
const personal = (id: string) => { const p = presetById(id); return { ...p, goals: { ...p.goals, sprouts: p.goals.sprouts.map(() => 0) as typeof p.goals.sprouts } }; };
const B = BOT_BASE as Record<string, unknown>;
const saved = { glasnostDone: B.glasnostDone, lateStep: B.lateStep };
const off = () => { B.glasnostDone = [0, 0, 0, 0, 0]; B.lateStep = 0; };
const on = () => { B.glasnostDone = saved.glasnostDone; B.lateStep = saved.lateStep; };
const isFeed = (a: { type: string; place?: { address: string } }) => a.type === 'place' && a.place?.address === 'sprouts';
const gaps: number[][] = [[], [], [], []]; // по ступеням I–IV: сколько не хватило вложению до лучшего личного хода (0 — выгодно и так)
const st = { feeds: 0, selfish: 0, toGlas: 0, toGlasAltru: 0, ins: 0, insAltru: 0, gap: 0, byRound: [0, 0, 0, 0, 0], byRoundAll: [0, 0, 0, 0, 0], skipped: 0 };
for (let seed = from + 1; seed <= from + games; seed++) {
  let t = seed; const rand = () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  let s = createGame({ players: Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'Б' + k })), seed, mode: kind === 'beginner' ? 'beginner' : 'full', forceCurator: kind === 'force' } as never);
  for (let i = 0; i < 9000 && s.phase !== 'end'; i++) {
    const who = activePlayers(s)[0];
    const preset = ids[(Number(who.slice(1)) + seed) % ids.length];
    const p = s.players.find((x) => x.id === who)!;
    const decide = s.phase === 'orders' && !s.pending.length && s.turnDone !== who && p.passion !== 'curator';
    let personalTop: { a: unknown; v: number }[] | null = null;
    if (decide) {
      let r = seed * 7919 + i; const prand = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
      off();
      try { personalTop = rankActions(s, who, personal(preset) as never, prand, true); } catch { personalTop = null; }
      on();
    }
    const before = s.sprouts.map((sp) => sp.progress);
    const logFrom = s.log.length;
    s = botMove(s, who, rand, preset);
    if (!decide) continue;
    const fed = s.log.slice(logFrom).find((l) => l.text.startsWith(`${p.name} питает ступень`));
    if (!fed) continue;
    const sp = s.sprouts.findIndex((x, k) => x.progress > before[k]);
    const insurance = sp >= 0 && before[sp] >= RULES.glasnostStep;
    st.feeds++; st.byRoundAll[s.round - 1]++;
    if (insurance) st.ins++; else st.toGlas++;
    if (!personalTop?.length) { st.skipped++; continue; }
    const best = personalTop[0];
    const feedV = personalTop.filter((x) => isFeed(x.a as never)).reduce((m, x) => Math.max(m, x.v), -Infinity);
    const step = sp >= 0 ? before[sp] : 0;
    if (isFeed(best.a as never)) { st.selfish++; gaps[step].push(0); continue; }
    const g = best.v - (Number.isFinite(feedV) ? feedV : best.v);
    gaps[step].push(g);
    st.gap += g;
    st.byRound[s.round - 1]++;
    if (insurance) st.insAltru++; else st.toGlasAltru++;
  }
}
console.log(JSON.stringify({ kind, n, games, ...st, gaps: gaps.map((g) => g.map((x) => +x.toFixed(2))) }));
