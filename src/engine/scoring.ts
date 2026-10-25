// Финальный подсчёт очков Гласности.
import { PASSIONS, RULES, SPROUTS } from './content';
import type { GameResult, GameState, Genre, PlayerState, ScoreLine } from './types';
import { GENRES } from './types';
import { discard, draw, iconCount, iconVariants, iconsOf, isEvidence, isExposed, isPropaganda, log, roman } from './util';

// Коллекция для Пристрастия: склад (включая Тайник) + изданное.
export function collection(state: GameState, p: PlayerState): string[] {
  return [...p.warehouse.map((s) => s.card), ...p.published];
}

export function passionPoints(state: GameState, p: PlayerState): number {
  if (!p.passion) return 0;
  // У каждой книги берём лучший для подсчёта вариант гибкого значка.
  const variants = collection(state, p).map((id) => iconVariants(state, id));
  const best = (f: (icons: Genre[]) => number) => variants.reduce((s, vs) => s + Math.max(...vs.map(f)), 0);
  const count = (g: Genre) => best((icons) => icons.filter((x) => x === g).length);
  const books = variants.map((vs) => vs[0]);
  const info = PASSIONS[p.passion];
  if (info.genres) {
    const [a, b] = info.genres;
    return RULES.passionKeeper * best((icons) => icons.filter((x) => x === a || x === b).length);
  }
  switch (p.passion) {
    case 'historian': {
      // Вдвое за Улики и Разоблачения: ещё столько же, сколько они приносят сами. Жанровые книги — ничего.
      const stash = p.warehouse.map((s) => s.card);
      const evidence = [...stash, ...p.tamizdat].filter((id) => isEvidence(state, id)).length;
      const exposed = [...stash, ...p.published].filter((id) => isExposed(state, id)).length;
      return RULES.evidencePoints * evidence + RULES.exposePoints * exposed;
    }
    case 'monogamist': {
      // Лучший жанр и второй по силе. Перебираем пары жанров: так гибкий значок возвращения
      // у каждой книги засчитывается ровно в одном жанре — там, где выгоднее.
      if (!RULES.monogamistSecond) return RULES.passionMonogamist * Math.max(...GENRES.map(count));
      let top = 0;
      for (const g1 of GENRES) for (const g2 of GENRES) {
        if (g1 === g2) continue;
        top = Math.max(top, best((icons) => RULES.passionMonogamist * icons.filter((x) => x === g1).length
          + RULES.monogamistSecond * icons.filter((x) => x === g2).length));
      }
      return top;
    }
    case 'innovator': {
      const dual = books.filter((icons) => new Set(icons).size >= 2).reduce((s, icons) => s + icons.length, 0);
      const single = books.filter((icons) => new Set(icons).size === 1).length; // книги одного жанра (и шедевры)
      return RULES.passionInnovator * dual + RULES.innovatorSingle * single;
    }
    case 'erudite': {
      // Очки за значки и (если включено) за каждый засчитанный жанр, не больше eruditeMaxGenres жанров.
      const best = eruditeBest(variants);
      let top = 0;
      best.forEach((icons, mask) => {
        const genres = popcount(mask);
        if (icons === -Infinity || genres > RULES.eruditeMaxGenres) return;
        top = Math.max(top, RULES.passionErudite * icons + RULES.eruditePerGenre * genres);
      });
      return top;
    }
    default:
      return 0;
  }
}

function popcount(x: number): number {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

// Эрудит: в каждом жанре засчитывается максимум одна книга; книга идёт в зачёт одного жанра.
// Перебор по маске жанров (8 жанров → 256 состояний): для каждого набора жанров — лучшая сумма значков.
function eruditeBest(books: Genre[][][]): number[] {
  let best = new Array(1 << GENRES.length).fill(-Infinity);
  best[0] = 0;
  for (const icons of books) {
    const next = [...best];
    for (let mask = 0; mask < best.length; mask++) {
      if (best[mask] === -Infinity) continue;
      GENRES.forEach((g, i) => {
        if (mask & (1 << i)) return;
        const v = Math.max(...icons.map((vs) => vs.filter((x) => x === g).length));
        if (!v) return;
        const m2 = mask | (1 << i);
        next[m2] = Math.max(next[m2], best[mask] + v);
      });
    }
    best = next;
  }
  return best;
}

export function glasnostReached(state: GameState, progress = state.sprouts.map((s) => s.progress)): boolean {
  return RULES.glasnostAllSprouts
    ? progress.every((x) => x >= RULES.glasnostStep)
    : progress.some((x) => x >= RULES.glasnostStep);
}

export function scoreLine(state: GameState, p: PlayerState): ScoreLine {
  const passion = passionPoints(state, p);
  const stash = p.warehouse.map((s) => s.card);
  // Колонка «Пропаганда»: минус за Пропаганду на складе, плюс за Разоблачения (на складе и изданные).
  const propaganda = RULES.propagandaPoints * stash.filter((id) => isPropaganda(state, id)).length
    + RULES.exposePoints * [...stash, ...p.published].filter((id) => isExposed(state, id)).length;
  const evidence = RULES.evidencePoints * [...stash, ...p.tamizdat].filter((id) => isEvidence(state, id)).length;
  const icons = collection(state, p).reduce((s, id) => s + iconCount(state, id), 0);
  const connections = state.patrons.filter((x) => !x.removed && x.connections.includes(p.id)).length;
  const talonPoints = Math.floor(p.talons / RULES.talonsPerPoint);
  return {
    player: p.id, during: p.points, duringBy: { ...p.pointsBy }, passion, propaganda, evidence, connections, talonPoints,
    total: p.points + passion + propaganda + evidence + connections + talonPoints, icons,
  };
}

export function finalScoring(state: GameState): GameResult {
  const scores = state.players.map((p) => scoreLine(state, p));
  const curator = state.players.find((p) => p.passion === 'curator');
  const sproutName = (id: string) => SPROUTS.find((s) => s.id === id)!.name;

  if (state.solo) return soloResult(state, scores, sproutName);

  if (!glasnostReached(state)) {
    return {
      glasnost: false, scores,
      winners: curator ? [curator.id] : [],
      note: curator
        ? `Гласность не наступила. Побеждает Куратор — ${curator.name}.`
        : 'Гласность не наступила: все Единомышленники проиграли.',
      summary: curator ? 'Гласность не наступила.' : 'Гласность не наступила: все Единомышленники проиграли.',
      winTail: ' (Куратор).',
    };
  }
  if (curator) {
    // Срез: за каждую Пропаганду у Куратора — минус ступень у самого развитого Ростка.
    const cuts = curator.warehouse.filter((s) => isPropaganda(state, s.card)).length;
    const cutLog: string[] = [];
    log(state, `Куратор раскрывается: ${curator.name}. Пропаганды у него на Складе и в Тайнике: ${cuts}${cuts ? ' — столько ступеней он срежет.' : ' — срезать нечем.'}`);
    for (let i = 0; i < cuts; i++) {
      const top = [...state.sprouts].sort((a, b) => b.progress - a.progress)[0];
      top.progress--;
      cutLog.push(sproutName(top.id));
      log(state, `Срез: Росток «${sproutName(top.id)}» — ступень ${roman(top.progress + 1)} → ${top.progress ? roman(top.progress) : '0'}.`);
    }
    if (!glasnostReached(state)) {
      return {
        glasnost: false, scores, winners: [curator.id],
        note: `Куратор (${curator.name}) срезал Ростки (${cutLog.join(', ')}) — Гласность не устояла. Куратор побеждает в одиночку.`,
        summary: `Куратор (${curator.name}) срезал Ростки (${cutLog.join(', ')}) — Гласность не устояла.`,
        winTail: ' (Куратор, в одиночку).',
      };
    }
  }
  const ranked = scores
    .filter((s) => s.player !== curator?.id)
    .map((s) => ({ s, talons: state.players.find((p) => p.id === s.player)!.talons }))
    // Ничья: больше связей → больше значков → больше Талонов.
    .sort((a, b) => b.s.total - a.s.total || b.s.connections - a.s.connections || b.s.icons - a.s.icons || b.talons - a.talons);
  const top = ranked[0];
  const winners = ranked
    .filter((r) => r.s.total === top.s.total && r.s.connections === top.s.connections && r.s.icons === top.s.icons && r.talons === top.talons)
    .map((r) => r.s.player);
  const name = (id: string) => state.players.find((p) => p.id === id)!.name;
  const names = winners.map(name).join(', ');
  // При ничьей по очкам — по очереди: связи (полный режим) → значки → Талоны.
  const crit: { by: string; get: (r: (typeof ranked)[number]) => number }[] = [
    ...(state.mode === 'full' ? [{ by: 'связям', get: (r: (typeof ranked)[number]) => r.s.connections }] : []),
    { by: 'значкам', get: (r) => r.s.icons },
    { by: 'Талонам', get: (r) => r.talons },
  ];
  let contenders = ranked.filter((r) => r.s.total === top.s.total);
  const steps: string[] = [];
  if (contenders.length > 1) {
    steps.push(`ничья по очкам (${top.s.total})`);
    for (const c of crit) {
      if (contenders.length < 2) break;
      const best = Math.max(...contenders.map(c.get));
      const next = contenders.filter((r) => c.get(r) === best);
      steps.push(next.length === contenders.length
        ? `ничья по ${c.by} (${best})`
        : `победа по ${c.by}: ${contenders.map((r) => `${name(r.s.player)} — ${c.get(r)}`).join(', ')}`);
      contenders = next;
    }
    if (contenders.length > 1) steps.push('полная ничья — победа делится');
  }
  const tie = steps.length ? ` ${steps.join(' → ').replace(/^./, (ch) => ch.toUpperCase())}.` : '';
  return {
    glasnost: true, scores, winners, note: `Гласность наступила! Победа: ${names} (${top.s.total} очков).${tie}`,
    summary: `Гласность наступила!${tie}`, winTail: ` (${top.s.total} очков).`,
  };
}

// Несистемный: вскрываются верхние Непечатные, каждая Пропаганда срезает ступень у самого развитого Ростка.
// Победа — только если после этого все Ростки не ниже III ступени; дальше важны очки.
function soloResult(state: GameState, scores: ScoreLine[], sproutName: (id: string) => string): GameResult {
  const me = state.players[0];
  const total = scores[0].total;
  if (!glasnostReached(state)) {
    const note = `Гласность не наступила — поражение (${total} очк.).`;
    return { glasnost: false, scores, winners: [], note, summary: note };
  }
  let propaganda = 0;
  const cards = RULES.soloEndCards[state.mode];
  for (let i = 0; i < cards; i++) {
    const c = draw(state);
    if (!c) break;
    if (isPropaganda(state, c)) {
      propaganda++;
      const top = [...state.sprouts].sort((a, b) => b.progress - a.progress)[0];
      if (top.progress > 0) {
        top.progress--;
        log(state, `Пропаганда «${state.cards[c].title}»: Росток «${sproutName(top.id)}» — ступень ${roman(top.progress + 1)} → ${top.progress ? roman(top.progress) : '0'}.`);
      }
    }
    discard(state, c);
  }
  log(state, `Вскрыто ${cards} Непечатных, Пропаганды среди них: ${propaganda}.`);
  const won = glasnostReached(state);
  return {
    glasnost: won, scores, winners: won ? [me.id] : [],
    note: won
      ? `Гласность устояла (Пропаганды: ${propaganda}). Победа! Итог: ${total} очк.`
      : `Пропаганда (${propaganda}) срезала Ростки — Гласность не устояла. Поражение (${total} очк.).`,
    summary: won ? `Гласность устояла (Пропаганды: ${propaganda}).` : `Пропаганда (${propaganda}) срезала Ростки — Гласность не устояла. Поражение (${total} очк.).`,
    winTail: ` (итог: ${total} очк.).`,
  };
}
