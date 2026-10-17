// Движок правил: создание партии и применение действий.
// applyAction не меняет переданное состояние, а возвращает новое.
import {
  ADDRESSES, CARDS, COPY_TEXT_ADDRESSES, GENRE_NAMES, GROUP_ACTIONS, KEEPERS, PASSIONS, PERMANENT_ADDRESSES, RULES, SAFEHOUSES,
  SPECIALS, SPROUTS, SPROUT_BONUS_NAMES, STEP_REWARDS, FIRST_FEED_POINTS, addressInGame, groupInGame, limitFor,
} from './content';
import { finalScoring } from './scoring';
import {
  afterRaid, doKontora, gaveAway, giveToPatron, holdWorker, isFull, kontoraLost, partorgFill, payPrice, price, proseBonus, purchases,
  removePatron, rescue, seizeDenounced, setupClub, startKontora, takeFromSpetskhran,
} from './full';
import type {
  Action, AddressId, CopyTextAddress, GameState, Genre, GroupAction, Mode, PassionId, Pending, PlaceAction, PlayerState,
} from './types';
import { GENRES } from './types';
import {
  addBook, addOpenBook, addSecretBook, autoHide, cacheLimit, check, cloneJson, coversStep, discard, earn, gain, hasPatron, draw, drawLoad, fail, freeSlots, hasBook, iconsOf, isBanned, isEvidence,
  isGenreBook, isLoad, isPropaganda, isSingle, log, pay, player, pointsText, random, removeBook, roman, shuffle,
  talonsText, title, titles, logEvent, logNote, logAfter, toSpetskhranPublic, isExposed,
} from './util';

export interface NewGameOptions {
  players: { id: string; name: string }[];
  seed?: number;
  mode?: Mode;
  curator?: boolean; // полный режим: Куратор в колоде Пристрастий (по умолчанию — да)
  reserve?: boolean; // «Заповедник»: полный режим без Конторы и Куратора
}

export function createGame(opts: NewGameOptions): GameState {
  const n = opts.players.length;
  check(n >= 1 && n <= 4, 'В игре участвуют от 1 до 4 игроков');
  const solo = n === 1; // «Несистемный»
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const mode = opts.reserve ? 'full' : opts.mode ?? 'beginner';
  const cards = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const state: GameState = {
    version: 1, seed, rng: seed, mode, cards, restored: {},
    round: 1, phase: 'passion',
    censorship: RULES.startCensorship,
    censorshipPool: RULES.censorshipTokens.filter((t) => t !== RULES.startCensorship),
    banned: [], order: [], turn: 0, nextOrder: [],
    players: [],
    deck: [], discard: [], loadDeck: [], loadDiscard: [],
    tolkuchka: [], razval: [], baraholka: [], baraholkaSeen: {}, knigoobmen: [], raspredelitel: [],
    safehouses: [], safehouseDeck: [], occupancy: {},
    sprouts: [], patrons: [], spetskhran: [], spetskhranSeen: {}, pending: [], ready: [], log: [],
  };
  if (solo) state.solo = true;
  if (opts.reserve) state.reserve = true;
  state.deck = shuffle(state, CARDS.filter((c) => !['load', 'loadReturnable', 'loadEvidence'].includes(c.kind)).map((c) => c.id));
  state.loadDeck = shuffle(state, CARDS.filter((c) => ['load', 'loadReturnable', 'loadEvidence'].includes(c.kind)).map((c) => c.id));
  state.safehouseDeck = shuffle(state, [...SAFEHOUSES]);
  state.sprouts = shuffle(state, SPROUTS.map((s) => s.id)).slice(0, solo ? RULES.soloSprouts[mode] : n + RULES.extraSprouts[mode]).map((id) => ({ id, progress: 0 }));

  // Колода Пристрастий.
  let passions: PassionId[];
  if (solo) {
    // Одиночная игра: все Пристрастия, кроме Куратора.
    passions = [...SPECIALS.filter((p) => p !== 'curator'), ...KEEPERS];
  } else if (n >= 3) {
    let keepers = shuffle(state, [...KEEPERS]);
    if (n === 3) keepers = keepers.slice(3);
    const curator = mode === 'full' && opts.curator !== false && !opts.reserve;
    passions = [...SPECIALS.filter((p) => curator || p !== 'curator'), ...keepers];
    state.curatorPossible = SPECIALS.includes('curator') && curator;
  } else {
    passions = [...KEEPERS];
  }
  shuffle(state, passions);

  const seats = shuffle(state, [...opts.players]);
  for (const s of seats) {
    const p: PlayerState = {
      id: s.id, name: s.name,
      workers: RULES.startWorkers, available: RULES.startWorkers, bonusGroupTurns: 0,
      talons: RULES.startTalons, points: 0,
      capacity: RULES.startCapacity, cache: 0, warehouse: [],
      published: [], tamizdat: [],
      passion: null, passionOptions: [passions.pop()!, passions.pop()!],
      groupUsed: [], visitedRedCorner: false, sproutsFed: [], subscriptions: [],
      held: 0, buzoterUsed: false, pointsBy: {}, actions: [], patronBonus: { capacity: 0, cache: 0 },
    };
    for (let i = 0; i < 2; i++) addBook(p, draw(state)!);
    for (let i = 0; i < 2; i++) addBook(p, drawLoad(state)!);
    state.players.push(p);
  }
  state.order = seats.map((s) => s.id);
  state.razval = [null, null, null, null];
  fillRazval(state);
  state.baraholka = Array.from({ length: RULES.displaySize }, () => draw(state));
  if (mode === 'full') setupClub(state);
  // Спецхран Конторы с начала партии не пуст (в «Заповеднике» Конторы нет).
  if (mode === 'full' && !opts.reserve) {
    for (let i = 0; i < RULES.spetskhranStart; i++) {
      const c = draw(state);
      if (c) state.spetskhran.push(c);
    }
  }
  log(state, `Партия началась. Порядок хода: ${state.order.map((id) => player(state, id).name).join(', ')}.`);
  // Опала первой Пятилетки известна до выбора Пристрастий (остальной стол откроется после выбора).
  state.banned = shuffle(state, [...GENRES]).slice(0, state.censorship);
  logNote(state, solo
    ? `Несистемный: одиночная игра. Цензура растёт на 1 каждую Пятилетку; в конце вскроются ${RULES.soloEndCards[mode]} Непечатных — каждая Пропаганда срежет ступень Ростка.`
    : 'Каждый игрок тайно выбирает одно из двух Пристрастий.');
  return state;
}

// Стартовый Тайник: опальные книги (не Пропаганда) по порядку — больше значков, затем жанр Пристрастия, затем случайно.
export function startHide(state: GameState, p: PlayerState) {
  const favored: Genre[] = (p.passion && PASSIONS[p.passion].genres) || [];
  const fits = (c: string) => (iconsOf(state, c).some((g) => favored.includes(g)) ? 1 : 0);
  const books = shuffle(state, p.warehouse.filter((w) => !w.hidden && !w.memorized && isBanned(state, w.card) && !isPropaganda(state, w.card)))
    .sort((a, b) => iconsOf(state, b.card).length - iconsOf(state, a.card).length || fits(b.card) - fits(a.card));
  let room = cacheLimit(state, p) - p.warehouse.filter((w) => w.hidden).length;
  for (const w of books) if (room-- > 0) w.hidden = true;
}

// ---------- Кто сейчас ходит ----------

export function activePlayers(state: GameState): string[] {
  if (state.pending.length) return [state.pending[0].player];
  if (state.phase === 'orders') return [state.order[state.turn]];
  if (state.phase === 'passion' || state.phase === 'setupCache' || state.phase === 'gathering' || state.phase === 'hiding') {
    return state.order.filter((id) => !state.ready.includes(id));
  }
  return [];
}

export function mustVisitRedCorner(state: GameState, p: PlayerState): boolean {
  return p.available === 1 && !p.visitedRedCorner && !hasPatron(state, p.id, 'doctor');
}

// ---------- Применение действия ----------

export function applyAction(prev: GameState, playerId: string, action: Action): GameState {
  // Справочник карт по ходу партии не меняется — его не копируем (так намного быстрее, особенно для ботов).
  const { cards, ...rest } = prev;
  const state: GameState = { ...cloneJson(rest), cards };
  check(state.phase !== 'end', 'Партия окончена');
  check(activePlayers(state).includes(playerId), 'Сейчас не ваш ход');
  const p = player(state, playerId);
  const pointsBefore = p.points;
  const logStart = state.log.length;
  const shown = displayed(state);
  const done = (s: GameState) => finishAction(s, p, pointsBefore, logStart, shown);

  if (state.pending.length) {
    resolvePending(state, p, action);
  } else {
    switch (state.phase) {
      case 'passion': {
        check(action.type === 'choosePassion', 'Сначала выберите Пристрастие');
        check(p.passionOptions.includes(action.passion), 'Этого Пристрастия нет среди ваших карт');
        p.passion = action.passion;
        state.ready.push(p.id);
        log(state, `${p.name} выбрал(а) Пристрастие.`);
        state.log[state.log.length - 1].who = p.id;
        log(state, `Ваше Пристрастие (${p.name}): ${PASSIONS[action.passion].name}.`, [p.id]);
        state.log[state.log.length - 1].who = p.id;
        if (action.passion === 'curator') state.log[state.log.length - 1].strong = true;
        if (state.ready.length === state.players.length) {
          startRound(state);
          // Перед первым действием партии все раскладывают стартовые книги по Тайникам.
          if (!state.pending.length) {
            state.phase = 'setupCache';
            state.ready = [];
            // Опальные стартовые книги сразу предложены в Тайник (если есть место) — игрок может переложить.
            for (const q of state.players) startHide(state, q);
            logNote(state, 'Все раскладывают стартовые книги: что спрятать в Тайник, что оставить на виду.');
          }
        }
        return done(state);
      }
      case 'setupCache': {
        check(action.type === 'hiding', 'Разложите стартовые книги по Тайнику');
        setHidden(state, p, action.hidden);
        state.ready.push(p.id);
        log(state, `${p.name} готов(а) начать.`);
        if (state.ready.length === state.players.length) {
          state.phase = 'orders';
          state.ready = [];
        }
        return done(state);
      }
      case 'orders':
        {
          // Пометить в журнале поручение: первая открытая запись этого действия получает кружок с его номером.
          const logFrom = state.log.length;
          const actsFrom = p.actions.length;
          doOrder(state, p, action);
          const first = p.actions[actsFrom];
          const entry = first && state.log.slice(logFrom).find((l) => !l.only);
          if (entry) entry.act = { player: p.id, n: first.n };
        }
        break;
      case 'gathering':
        check(action.type === 'gathering', 'Сейчас Посиделки');
        doGathering(state, p, action.show);
        return done(state);
      case 'hiding':
        if (action.type === 'memorize') {
          memorize(state, p, action.card);
          return done(state);
        }
        check(action.type === 'hiding', 'Сейчас Укрытие');
        doHiding(state, p, action);
        return done(state);
    }
  }
  if (state.holdTurn) delete state.holdTurn;
  else if (state.phase === 'orders' && state.pending.length === 0) {
    if (state.freeHold) delete state.freeHold;
    // Ход передаётся, только когда игрок сам его закончит (или спасует); до тех пор — свободные действия.
    else if (action.type === 'endTurn' || action.type === 'pass') advanceTurn(state);
    else state.turnDone = state.order[state.turn];
  }
  return done(state);
}

// Открытые адреса, куда выходят книги (для журнала: что и куда вышло).
const DISPLAYS: [keyof Pick<GameState, 'razval' | 'tolkuchka' | 'knigoobmen' | 'raspredelitel'>, string][] = [
  ['razval', 'На Развал'], ['tolkuchka', 'На Толкучку'], ['knigoobmen', 'На Книгообмен'], ['raspredelitel', 'В Распределитель'],
];

function displayed(state: GameState): Set<string> {
  return new Set(DISPLAYS.flatMap(([k]) => (state[k] as (string | null)[]).filter((c): c is string => !!c)));
}

// Записать, какие книги вышли на открытые адреса (кроме уже названных в журнале этого действия — например, проданных).
function logArrivals(state: GameState, before: Set<string>, mentioned = '') {
  for (const [k, where] of DISPLAYS) {
    const fresh = (state[k] as (string | null)[]).filter((c): c is string => !!c && !before.has(c) && !mentioned.includes(state.cards[c].title));
    if (fresh.length) log(state, `${where} ${fresh.length > 1 ? 'выходят' : 'выходит'}: ${titles(state, fresh)}.`);
  }
}

function finishAction(state: GameState, p: PlayerState, pointsBefore: number, logStart = state.log.length, shown?: Set<string>): GameState {
  if (shown) logArrivals(state, shown, state.log.slice(logStart).map((l) => l.text).join('\n'));
  // Проза «Вдохновиться»: действие принесло очки — бонус за прозу (см. proseBonus).
  if (p.points > pointsBefore) {
    const bonus = proseBonus(state, p);
    if (bonus) {
      gain(p, bonus, 'prose');
      logAfter(state, `↳ Проза вдохновляет: +${pointsText(bonus)}.`);
    }
  }
  // Следствия («↳ …») — сразу после последней строки самого действия игрока (до смены фазы и прочего).
  const fresh = state.log.slice(logStart);
  if (fresh.some((l) => l.after)) {
    const main = fresh.filter((l) => !l.after);
    let at = main.map((l) => l.text.startsWith(`${p.name} `)).lastIndexOf(true);
    if (at < 0) at = main.length - 1;
    const tail = fresh.filter((l) => l.after);
    state.log = [...state.log.slice(0, logStart), ...main.slice(0, at + 1), ...tail, ...main.slice(at + 1)];
    for (const l of fresh) delete l.after;
  }
  if (state.phase !== 'end' && kontoraLost(state)) {
    state.phase = 'end';
    state.pending = [];
    const curator = state.players.find((x) => x.passion === 'curator');
    state.result = {
      glasnost: false,
      winners: curator ? [curator.id] : [],
      scores: [],
      note: `Контора удерживает ${7} Единомышленников — подполье разгромлено.${curator ? ` Побеждает Куратор — ${curator.name}.` : ' Все проиграли.'}`,
    };
    log(state, state.result.note);
  }
  return state;
}

// ---------- Пятилетка ----------

function startRound(state: GameState, newSafehouse?: AddressId) {
  state.phase = 'orders';
  state.ready = [];
  state.occupancy = {};
  state.sproutRound = {};
  state.nextOrder = [];
  delete state.turnDone;
  delete state.lastBuy;
  delete state.clubGiftBy;
  for (const pt of state.patrons) pt.turned = false;
  for (const p of state.players) {
    p.available = p.workers - p.held;
    p.buzoterUsed = false;
    p.bonusGroupTurns = 0;
    p.groupUsed = [];
    p.actions = [];
    p.visitedRedCorner = false;
  }
  // Обстановка: опала и обновление каналов.
  let change = '';
  if (state.round > 1) {
    // Инерция: самый старый опальный жанр выходит из опалы, взамен (и при росте Цензуры — сверх того) в опалу попадают
    // новые, только что освобождённый в ту же Пятилетку не возвращается. Окостенение: давно ненавистное так и остаётся —
    // выходит самый свежий жанр, опала добирается из всех свободных (он может тут же вернуться).
    const ossified = RULES.censorshipShift === 'ossified';
    const kept = ossified ? state.banned.slice(0, -1) : state.banned.slice(1);
    const released = ossified ? state.banned[state.banned.length - 1] : state.banned[0];
    const fresh = shuffle(state, GENRES.filter((g) => !kept.includes(g) && (ossified || g !== released))).slice(0, Math.max(0, state.censorship - kept.length));
    state.banned = [...kept, ...fresh].slice(-state.censorship);
    const back = released && fresh.includes(released);
    const out = fresh.filter((g) => g !== released);
    change = back
      ? ` Опала остаётся: ${GENRE_NAMES[released]}${out.length ? `; в опалу попадает: ${out.map((g) => GENRE_NAMES[g]).join(', ')}` : ''}.`
      : ` Из опалы выходит: ${released ? GENRE_NAMES[released] : '—'}; в опалу попадает: ${fresh.map((g) => GENRE_NAMES[g]).join(', ') || '—'}.`;
  } else if (!state.banned.length) {
    state.banned = shuffle(state, [...GENRES]).slice(0, state.censorship);
  }
  logEvent(state, `Пятилетка ${state.round}.`);
  log(state, `Цензура: ${state.censorship}. В опале: ${state.banned.map((g) => GENRE_NAMES[g]).join(', ')}.${change}`);
  if (newSafehouse) log(state, `Открылся новый явочный адрес: ${ADDRESSES[newSafehouse].name}.`);

  refreshChannels(state, state.round === 1);
  // В первой Пятилетке стол открывается после выбора Пристрастий — перечислим, что лежит на открытых адресах.
  if (state.round === 1) logArrivals(state, new Set());
  if (state.solo && isFull(state) && state.round >= 2) soloPressure(state);
  // Главлитовец: после Обстановки — в порядке, обратном порядку хода.
  if (isFull(state)) {
    for (const id of [...state.order].reverse()) {
      if (hasPatron(state, id, 'glavlit')) state.pending.push({ kind: 'glavlitSwap', player: id, roundStart: true });
    }
  }
  state.turn = 0;
  state.turn = -1;
  advanceTurn(state);
}

// Несистемный: ещё один жетон жанра — Профилактика его Завсегдатаю, а если того уже нет, Контора удерживает Единомышленника.
function soloPressure(state: GameState) {
  const genre = shuffle(state, GENRES.filter((g) => !state.banned.includes(g)))[0];
  if (!genre) return;
  const p = state.players[0];
  const pt = state.patrons.find((x) => x.genre === genre);
  log(state, `Несистемный: вытянут жетон «${GENRE_NAMES[genre]}».`);
  if (pt && !pt.removed) removePatron(state, pt.id);
  else holdWorker(state, p, `Завсегдатая жанра «${GENRE_NAMES[genre]}» уже нет в Клубе`);
}

function refreshChannels(state: GameState, first: boolean) {
  while (state.tolkuchka.length < RULES.displaySize) {
    const c = draw(state);
    if (!c) break;
    state.tolkuchka.push(c);
  }
  if (!first) {
    // Развал: сбросить самую залежавшуюся и пополнить свежими.
    const rest = state.razval.filter((c): c is string => c !== null);
    const stale = rest.pop();
    if (stale) discard(state, stale);
    state.razval = [...rest];
    fillRazval(state);
    for (const c of state.baraholka) if (c) discard(state, c);
    state.baraholka = Array.from({ length: RULES.displaySize }, () => draw(state));
    state.baraholkaSeen = {};
  }
  if (state.safehouses.includes('knigoobmen')) {
    state.knigoobmen.forEach((c) => discard(state, c));
    state.knigoobmen = [];
    for (let i = 0; i < RULES.displaySize; i++) {
      const c = draw(state);
      if (c) state.knigoobmen.push(c);
    }
  }
  if (state.safehouses.includes('raspredelitel')) {
    state.raspredelitel.forEach((c) => discard(state, c));
    state.raspredelitel = [];
    const skipped: string[] = [];
    while (state.raspredelitel.length < RULES.raspredelitelSize) {
      const c = draw(state);
      if (!c) break;
      if (state.cards[c].kind === 'genre' && iconsOf(state, c).length >= 2) state.raspredelitel.push(c);
      else skipped.push(c);
    }
    skipped.forEach((c) => discard(state, c));
  }
}

// Развал: [0] — самая свежая. Новые книги ложатся на свежий край.
function fillRazval(state: GameState) {
  const books = state.razval.filter((c): c is string => c !== null);
  while (books.length < RULES.displaySize) {
    const c = draw(state);
    if (!c) break;
    books.unshift(c);
  }
  state.razval = [...books, ...Array(RULES.displaySize - books.length).fill(null)];
}

function canAct(p: PlayerState) {
  return p.available > 0 || p.bonusGroupTurns > 0;
}

function advanceTurn(state: GameState) {
  delete state.turnDone;
  delete state.lastBuy;
  delete state.clubGiftBy;
  delete state.freeHold;
  const n = state.order.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.turn + i + n) % n;
    if (canAct(player(state, state.order[idx]))) {
      state.turn = idx;
      return;
    }
  }
  endOrders(state);
}

function endOrders(state: GameState) {
  // Подписка: книги приходят в конце фазы поручений.
  for (const id of state.order) {
    const p = player(state, id);
    for (const sub of p.subscriptions) {
      if (sub.rounds <= 0) continue;
      sub.rounds--;
      let got: string | null = null;
      for (let guard = 0; guard < 200 && !got; guard++) {
        const c = draw(state);
        if (!c) break;
        if (iconsOf(state, c).includes(sub.genre)) got = c;
        else discard(state, c);
      }
      if (!got) continue;
      if (freeSlots(p) > 0) {
        addSecretBook(state, p, got);
        log(state, `${p.name} получает по Подписке книгу жанра ${GENRE_NAMES[sub.genre]}.`);
        log(state, `По Подписке пришла ${title(state, got)}.`, [p.id]);
      } else {
        discard(state, got);
        log(state, `${p.name}: книга по Подписке ушла в сброс — нет места на складе.`);
      }
    }
    p.subscriptions = p.subscriptions.filter((s) => s.rounds > 0);
  }
  if (isFull(state)) {
    for (const id of state.order) {
      if (hasPatron(state, id, 'apprentice')) state.pending.push({ kind: 'extraGroup', player: id });
      if (hasPatron(state, id, 'chairman')) state.pending.push({ kind: 'freeConnection', player: id });
    }
  }
  state.phase = 'gathering';
  state.ready = [];
  logEvent(state, 'Посиделки.');
  logNote(state, 'Можно показать опальные книги и Улики со склада — по 1 очку за каждую.');
}

function doGathering(state: GameState, p: PlayerState, show: string[]) {
  check(new Set(show).size === show.length, 'Книга указана дважды');
  let pts = 0;
  let dramaPts = 0;
  let geo = 0;
  for (const id of show) {
    // Драматургия «Разыграть»: можно показывать и неопальную, и из изданного — +1 очко.
    const drama = isFull(state) && iconsOf(state, id).includes('drama');
    // Опальная жанровая книга или Улика (Улики тоже можно показывать).
    const banned = (isGenreBook(state, id) || isEvidence(state, id)) && isBanned(state, id);
    check(hasBook(p, id) || (drama && p.published.includes(id)), 'Показывать можно только книги со своего склада');
    check(banned || drama, `${title(state, id)} — не опальная жанровая книга и не Улика`);
    if (banned && hasBook(p, id)) {
      pts += 1;
      if (hasPatron(state, p.id, 'geologist')) geo++;
    }
    if (drama) dramaPts += 1;
  }
  // Опальные книги из Тайника, которые игрок не показал (честному показывать опальное выгодно; у Куратора в Тайнике —
  // Пропаганда). Неопальные книги в Тайнике (спрятанные впрок) показать нельзя — они не в счёт.
  const unshown = p.warehouse.filter((s) => s.hidden && !s.memorized && !show.includes(s.card) && isBanned(state, s.card)).length;
  if (unshown) p.cacheUnshown = (p.cacheUnshown ?? 0) + unshown;
  gain(p, pts, 'gathering');
  gain(p, dramaPts, 'drama');
  pts += dramaPts;
  if (geo) {
    earn(state, p, geo);
    log(state, `${p.name}: Геолог — +${talonsText(geo)}.`);
  }
  state.ready.push(p.id);
  if (show.length) {
    log(state, `${p.name} показывает на Посиделках: ${titles(state, show)} — +${pointsText(pts)}.`);
  } else {
    log(state, `${p.name} ничего не показывает на Посиделках.`);
  }
  if (state.ready.length === state.players.length) {
    state.phase = 'hiding';
    state.ready = [];
    logEvent(state, 'Укрытие.');
    logNote(state, 'Прячьте опальные книги в Тайник (каждые 2 Нагрузки на складе дают +1 место).');
  }
}

function doHiding(state: GameState, p: PlayerState, a: Extract<Action, { type: 'hiding' }>) {
  if (a.fillLoad) partorgFill(state, p);
  setHidden(state, p, a.hidden, a.memorize);
  state.ready.push(p.id);
  log(state, `${p.name} готов(а) к облаве.`);
  if (state.ready.length === state.players.length) raid(state);
}

function memorize(state: GameState, p: PlayerState, card: string | null) {
  check(isFull(state), 'Заучивать стихи можно только в полном режиме');
  if (card) check(hasBook(p, card) && iconsOf(state, card).includes('poetry'), 'Заучить можно только сборник поэзии со своего склада');
  for (const s of p.warehouse) {
    s.memorized = s.card === card || undefined;
    if (s.memorized) s.hidden = false;
  }
  check(freeSlots(p) >= 0, 'Склад переполнен: сначала освободите место');
  log(state, card ? `${p.name} заучивает ${title(state, card)}.` : `${p.name} больше не держит сборник заученным.`);
}

// Расставить книги по Тайнику. memorize — заученный сборник поэзии (полный режим), undefined — не менять.
function setHidden(state: GameState, p: PlayerState, hidden: string[], memorize?: string | null) {
  check(new Set(hidden).size === hidden.length, 'Книга указана дважды');
  for (const id of hidden) check(hasBook(p, id), 'Прятать можно только книги со своего склада');
  if (memorize !== undefined) {
    if (memorize) {
      check(isFull(state), 'Заучивать стихи можно только в полном режиме');
      check(hasBook(p, memorize) && iconsOf(state, memorize).includes('poetry'), 'Заучить можно только сборник поэзии со своего склада');
      check(!hidden.includes(memorize), 'Заученная книга не прячется в Тайник');
    }
    for (const s of p.warehouse) s.memorized = s.card === memorize || undefined;
  }
  for (const s of p.warehouse) s.hidden = hidden.includes(s.card) && !s.memorized;
  check(freeSlots(p) >= 0, 'Склад переполнен');
  check(hidden.length <= cacheLimit(state, p), `В Тайнике помещается только ${cacheLimit(state, p)} книг(и)`);
}

function raid(state: GameState) {
  logEvent(state, 'Облава!');
  const sweep = (list: string[]) => {
    const keep: string[] = [];
    for (const c of list) {
      if (isBanned(state, c)) discard(state, c);
      else keep.push(c);
    }
    return keep;
  };
  const discardBefore = state.discard.length;
  const before = state.tolkuchka.length + state.knigoobmen.length + state.raspredelitel.length + state.razval.filter(Boolean).length;
  state.tolkuchka = sweep(state.tolkuchka);
  state.knigoobmen = sweep(state.knigoobmen);
  state.raspredelitel = sweep(state.raspredelitel);
  state.razval = state.razval.map((c) => (c && isBanned(state, c) ? (discard(state, c), null) : c));
  const after = state.tolkuchka.length + state.knigoobmen.length + state.raspredelitel.length + state.razval.filter(Boolean).length;
  if (before > after) log(state, `С адресов изъято книг: ${before - after}.`);
  for (const p of state.players) {
    const seized = p.warehouse.filter((s) => !s.hidden && !s.memorized && isBanned(state, s.card));
    if (!seized.length) continue;
    p.warehouse = p.warehouse.filter((s) => !seized.includes(s));
    toSpetskhranPublic(state, seized.map((s) => s.card));
    log(state, `У ${p.name} изъято в Спецхран: ${titles(state, seized.map((s) => s.card))}.`);
    if (isFull(state)) holdWorker(state, p, 'изъятие при облаве');
  }
  // Лейтенант: после изъятий — одна из книг, изъятых с адресов.
  const swept = state.discard.slice(discardBefore);
  if (swept.length) {
    for (const id of state.order) {
      if (hasPatron(state, id, 'lieutenant')) state.pending.push({ kind: 'lieutenantPick', player: id, cards: swept });
    }
  }
  if (!state.pending.length) finishRound(state);
}

function finishRound(state: GameState) {
  afterRaid(state);
  changeRound(state);
}

function changeRound(state: GameState) {
  if (state.round >= RULES.rounds) {
    state.phase = 'end';
    state.result = finalScoring(state);
    log(state, `Конец Застоя. ${state.result.note}`);
    return;
  }
  // Новый порядок хода: сперва посетившие Красный уголок, затем остальные в прежнем порядке.
  state.order = [...state.nextOrder, ...state.order.filter((id) => !state.nextOrder.includes(id))];
  const safe = state.safehouseDeck.pop();
  if (safe) state.safehouses.push(safe); // в журнале — после строки о цензуре новой Пятилетки
  // Масштаб цензуры: прежний жетон и жетон на 1 больше — случайный из двух (в одиночной игре — всегда больший).
  const next = state.censorshipPool.find((t) => t === state.censorship + 1);
  if (next !== undefined) {
    const pick = state.solo ? next : random(state) < 0.5 ? state.censorship : next;
    if (pick === next) {
      state.censorshipPool = state.censorshipPool.filter((t) => t !== next).concat(state.censorship);
      state.censorship = next;
    }
  }
  state.round++;
  startRound(state, safe);
}

// ---------- Фаза поручений ----------

function doOrder(state: GameState, p: PlayerState, action: Action) {
  if (action.type === 'memorize') {
    // «Заучить» не тратит действие и не завершает ход.
    memorize(state, p, action.card);
    state.holdTurn = true;
    return;
  }
  if (action.type === 'hiding') {
    // Пересобрать Тайник в свой ход — свободно, ход не заканчивается.
    setHidden(state, p, action.hidden);
    log(state, `${p.name} перекладывает книги в Тайнике.`);
    state.holdTurn = true;
    return;
  }
  if (action.type === 'endTurn') {
    check(state.turnDone === p.id, 'Сначала сделайте действие (или спасуйте)');
    return;
  }
  // Тиражирование вдогонку: только что купил на адресе — второй Единомышленник берёт оттуда же книгу даром.
  if (action.type === 'group' && action.group.action === 'copyText' && !action.group.buy && state.lastBuy?.player === p.id) {
    doGroup(state, p, action.group, { limited: true, worker: true, followUp: true });
    track(p, 'group:copyText');
    p.available--;
    delete state.lastBuy;
    return;
  }
  if (action.type === 'clubGift') {
    // Клуб как свободное действие: одна книга одному Завсегдатаю за ход, ход не завершается.
    check(isFull(state) && RULES.clubFreeGift, 'Связь в Клубе так не завести');
    check(action.gift, 'Выберите, кому из Завсегдатаев что отдать');
    check(state.clubGiftBy !== p.id, 'В этот ход вы уже отдали книгу в Клуб');
    giveToPatron(state, p, action.gift);
    state.clubGiftBy = p.id;
    // Ход не заканчивается — и после решений, которые вызвала связь (Главлитовец, Управдом…).
    state.freeHold = true;
    return;
  }
  check(state.turnDone !== p.id, 'Действие уже сделано: можно пересобрать Тайник, заучить, отдать книгу в Клуб — или закончите ход');
  if (p.available === 0) {
    check(p.bonusGroupTurns > 0, 'У вас не осталось Единомышленников');
    if (action.type === 'pass') {
      p.bonusGroupTurns = 0;
      log(state, `${p.name} отказывается от дополнительных действий Группы.`);
      return;
    }
    check(action.type === 'group', 'Сейчас можно только действие Инициативной группы');
    doGroup(state, p, action.group, { limited: true });
    track(p, `group:${action.group.action}`);
    p.bonusGroupTurns--;
    return;
  }
  if (action.type === 'pass') {
    // Добровольный пас — только после Красного уголка; до конца Пятилетки игрок больше не ходит.
    check(p.visitedRedCorner, 'Спасовать можно только после того, как Единомышленник побывал в Красном уголке');
    p.available = 0;
    p.bonusGroupTurns = 0;
    log(state, `${p.name} пасует до конца Пятилетки.`);
    return;
  }
  if (action.type === 'group') {
    // Исключение: Расширение сети можно и последним Единомышленником — новый тут же займёт его место (и пойдёт в Красный уголок).
    check(!mustVisitRedCorner(state, p) || action.group.action === 'hire', 'Последнего Единомышленника нужно отправить в Красный уголок');
    doGroup(state, p, action.group, { limited: true, worker: true });
    track(p, `group:${action.group.action}`);
    p.available--;
    return;
  }
  check(action.type === 'place', 'Отправьте Единомышленника по адресу или в Группу');
  const a = action.place;
  check(
    (PERMANENT_ADDRESSES.includes(a.address) && addressInGame(state, a.address)) || state.safehouses.includes(a.address),
    'Этого адреса нет на столе',
  );
  if (mustVisitRedCorner(state, p)) check(a.address === 'redCorner', 'Последнего Единомышленника нужно отправить в Красный уголок');
  const here = state.occupancy[a.address] ?? [];
  const info = ADDRESSES[a.address];
  let buzoter = false;
  if (here.length >= limitFor(a.address, state.players.length)) {
    // Бузотёр: раз в Пятилетку — на адрес, где достигнут общий лимит.
    buzoter = hasPatron(state, p.id, 'buzoter') && !p.buzoterUsed;
    check(buzoter, `${info.name}: все места заняты`);
  }
  if (info.perPlayer) check(!here.includes(p.id), `${info.name}: не больше одного Единомышленника от игрока`);
  if (a.address === 'kontora') {
    // Единомышленник отправится в Контору, когда игрок выберет пункты и книгу для Спецхрана (или передумает).
    startKontora(state, p);
    return;
  }
  doPlace(state, p, a);
  // Купил на адресе Тиражирования — можно следом (до конца хода) взять оттуда же книгу даром.
  if ((COPY_TEXT_ADDRESSES as readonly string[]).includes(a.address) && (a.address !== 'tolkuchka' || a.ops.some((op) => op.op === 'buy'))) {
    const exclude = a.address === 'tolkuchka' ? a.ops.filter((op) => op.op === 'sell').map((op) => op.card)
      : a.address === 'knigoobmen' ? [a.give] : [];
    state.lastBuy = { player: p.id, address: a.address as CopyTextAddress, exclude };
  }
  if (buzoter) { p.buzoterUsed = true; log(state, `${p.name}: Бузотёр пробивается на занятый адрес.`); }
  state.occupancy[a.address] = [...here, p.id];
  track(p, a.address);
  p.available--;
}

// Запомнить, каким по счёту в Пятилетке было действие игрока (номер на жетоне).
function track(p: PlayerState, target: string) {
  p.actions.push({ target, n: p.actions.length + 1 });
}

function doPlace(state: GameState, p: PlayerState, a: PlaceAction) {
  const name = ADDRESSES[a.address].name;
  switch (a.address) {
    case 'gostorg': {
      check(Number.isInteger(a.pairs) && a.pairs >= 1, 'Укажите число пар');
      check(freeSlots(p) >= a.pairs * 2, 'На складе не хватит места');
      // Завмаг: состав каждой книги выбирается свободно.
      const mix = a.mix ?? [];
      if (mix.length) {
        check(hasPatron(state, p.id, 'zavmag'), 'Свободный выбор книг — только со связью с Завмагом');
        check(mix.length === a.pairs * 2, 'Укажите состав всех книг');
      }
      // Завмаг ещё и не платит.
      const cost = hasPatron(state, p.id, 'zavmag') ? 0 : purchases(state, p)(a.pairs);
      const got: string[] = [];
      const kinds = mix.length ? mix : Array.from({ length: a.pairs }, () => ['load', 'unprinted'] as const).flat();
      for (const k of kinds) {
        const c = k === 'load' ? drawLoad(state) : draw(state);
        if (c) { addSecretBook(state, p, c); got.push(c); }
      }
      log(state, `${p.name} в Госкниготорге: ${got.length} книг(и) за ${talonsText(cost)}.`);
      log(state, `Вы получили: ${titles(state, got)}.`, [p.id]);
      return;
    }
    case 'tolkuchka': {
      check(a.ops.length > 0, 'Купите или продайте хотя бы одну книгу');
      const sold: string[] = [];
      const parts: string[] = [];
      let income = 0;
      const buy = purchases(state, p);
      for (const op of a.ops) {
        if (op.op === 'buy') {
          check(state.tolkuchka.includes(op.card), 'Этой книги нет на Толкучке');
          const cost = buy(RULES.tolkuchkaBuy);
          state.tolkuchka = state.tolkuchka.filter((c) => c !== op.card);
          addOpenBook(state, p, op.card);
          parts.push(`купил(а) ${title(state, op.card)} за ${talonsText(cost)}`);
        } else {
          check(hasBook(p, op.card), 'Продавать можно только книги со своего склада');
          check(!isEvidence(state, op.card), 'Улики нельзя продать — у них ноль подпольного спроса');
          check(!isPropaganda(state, op.card), 'Пропаганду можно сбыть только в Красном уголке');
          const icons = iconsOf(state, op.card);
          check(icons.length > 0, 'Книгу без жанра не продать');
          const demand = icons.some((g) => state.banned.includes(g)) || hasPatron(state, p.id, 'fartsovshchik');
          const gain = demand ? RULES.tolkuchkaSellBanned : RULES.tolkuchkaSellFree;
          removeBook(p, op.card);
          income += gain;
          gaveAway(state, p, op.card);
          sold.push(op.card);
          parts.push(`продал(а) ${title(state, op.card)} за ${talonsText(gain)}`);
        }
      }
      for (const c of sold) {
        state.tolkuchka.push(c);
        if (state.tolkuchka.length > RULES.displaySize) discard(state, state.tolkuchka.shift()!);
      }
      log(state, `${p.name} на Толкучке: ${parts.join('; ')}.`);
      earn(state, p, income);
      return;
    }
    case 'redCorner': {
      const unprinted = a.recycle.filter((c) => !isFromLoadDeck(state, c));
      const load = a.recycle.filter((c) => isFromLoadDeck(state, c));
      const komsorg = hasPatron(state, p.id, 'komsorg');
      check(
        (unprinted.length <= 1 && load.length <= 1) || komsorg,
        'Сдать можно до 1 Непечатной и до 1 книги Нагрузки',
      );
      const extra = hasPatron(state, p.id, 'zavkhoz') ? 1 : 0;
      // Ретивость: рано и первым в очереди (выгоднее всего ходить первым Куратору), особенно ничего не сдав.
      const used = p.workers - p.held - p.available;
      if (state.round < RULES.rounds && state.nextOrder.length === 0 && used <= 2) {
        p.redEager = (p.redEager ?? 0) + 1;
        const couldRecycle = p.warehouse.some((s) => !s.hidden && !isPropaganda(state, s.card) && !isEvidence(state, s.card));
        if (!a.recycle.length && couldRecycle) p.redEmpty = (p.redEmpty ?? 0) + 1;
      }
      let income = 0;
      p.propagandaDumped = (p.propagandaDumped ?? 0) + a.recycle.filter((c) => isPropaganda(state, c)).length;
      for (const c of a.recycle) {
        const perBook = (isFromLoadDeck(state, c) ? RULES.redCornerLoad : RULES.redCornerUnprinted) + extra;
        removeBook(p, c);
        discard(state, c);
        income += perBook;
        gaveAway(state, p, c);
      }
      p.visitedRedCorner = true;
      state.nextOrder.push(p.id);
      log(state, `${p.name} в Красном уголке (${state.nextOrder.length}-й в очереди)${a.recycle.length ? `, сдал(а) в макулатуру: ${titles(state, a.recycle)}` : ''}.`);
      earn(state, p, income);
      // Комсорг: за каждую сданную книгу — очко Гласности.
      if (komsorg && a.recycle.length) {
        gain(p, RULES.komsorgPoints * a.recycle.length, 'komsorg');
        logAfter(state, `↳ Комсорг: +${pointsText(RULES.komsorgPoints * a.recycle.length)}.`);
      }
      return;
    }
    case 'razval': {
      const slots = [...new Set(a.slots?.length ? a.slots : [a.slot])];
      check(slots.length === 1 || hasPatron(state, p.id, 'veteran'), 'Несколько книг за одно действие — только со связью с Ветераном');
      const buy = purchases(state, p);
      for (const slot of slots) {
        const c = state.razval[slot];
        check(c, 'Эта ячейка Развала пуста');
        const cost = buy(RULES.razvalPrices[slot]);
        addOpenBook(state, p, c);
        state.razval[slot] = null;
        log(state, `${p.name} покупает на Развале ${title(state, c)} за ${talonsText(cost)}.`);
      }
      return;
    }
    case 'zavoz': {
      earn(state, p, RULES.zavozIncome);
      state.razval.forEach((c) => c && discard(state, c));
      state.razval = [null, null, null, null];
      fillRazval(state);
      log(state, `${p.name} подрабатывает на Завозе: +${talonsText(RULES.zavozIncome)}, Развал обновлён.`);
      return;
    }
    case 'baraholka': {
      const filled = state.baraholka.filter((c) => c).length;
      const need = Math.min(RULES.baraholkaLook, filled);
      check(need > 0, 'На Барахолке не осталось книг');
      const slots = [...new Set(a.slots)];
      check(slots.length === need, `Выберите на Барахолке книг: ${need}`);
      const seen = slots.map((slot) => {
        const card = state.baraholka[slot];
        check(card, 'Эта ячейка Барахолки пуста');
        return { slot, card };
      });
      state.pending.push({ kind: 'baraholkaLook', player: p.id, seen });
      rememberBaraholka(state, p.id, slots);
      log(state, `${p.name} роется на Барахолке.`);
      return;
    }
    case 'podpiska': {
      check(GENRES.includes(a.genre), 'Нет такого жанра');
      check(Number.isInteger(a.talons) && a.talons >= 1 && a.talons <= RULES.rounds - state.round + 1, 'Неверный срок подписки');
      payPrice(state, p, a.talons);
      p.subscriptions.push({ genre: a.genre, rounds: a.talons });
      log(state, `${p.name} оформляет Подписку: ${GENRE_NAMES[a.genre]}, на ${a.talons} Пятилетк(и).`);
      return;
    }
    case 'sprouts': {
      check(a.feeds.length > 0, 'Выберите, какие ступени закрыть');
      check(a.feeds.length <= RULES.sproutFeedsPerAction, RULES.sproutFeedsPerAction === 1
        ? 'За одно поручение можно закрыть только 1 ступень одного Ростка'
        : `За одно поручение — не больше ${RULES.sproutFeedsPerAction} ступеней`);
      const used = new Set<string>();
      let labtechUsed = false;
      for (const f of a.feeds) {
        const sp = state.sprouts.find((s) => s.id === f.sprout);
        check(sp, 'Этого Ростка нет в игре');
        const info = SPROUTS.find((s) => s.id === sp.id)!;
        check(sp.progress < 4, `${info.name}: все ступени уже закрыты`);
        // Росток растёт постепенно: за Пятилетку — не больше RULES.sproutSlotsPerRound ступеней.
        const fedNow = (state.sproutRound ??= {})[sp.id] ?? [];
        check(fedNow.length < RULES.sproutSlotsPerRound, `${info.name}: в эту Пятилетку на этом Ростке уже закрыто ${RULES.sproutSlotsPerRound} ступени — ждите следующей`);
        state.sproutRound[sp.id] = [...fedNow, p.id];
        const step = info.steps[sp.progress];
        for (const b of f.books) {
          check(!used.has(b), 'Одна книга не может пойти дважды');
          check(hasBook(p, b), 'Отдавать можно только книги со своего склада');
          used.add(b);
        }
        const need = `${info.name}: нужно значков «${GENRE_NAMES[info.main]}»: ${step.main}` + (step.support ? ` и значок поддержки «${GENRE_NAMES[step.support]}»` : '');
        if (!coversStep(state, f.books, info.main, step.main, step.support, { wildScifi: isFull(state) })) {
          // Лаборант: скидка в 1 значок — одна на всё поручение, а не на каждую ступень.
          check(hasPatron(state, p.id, 'labtech') && coversStep(state, f.books, info.main, step.main, step.support, { wildScifi: isFull(state), labtech: true }), need);
          check(!labtechUsed, 'Лаборант даёт скидку в 1 значок только один раз за поручение');
          labtechUsed = true;
        }
        for (const b of f.books) { removeBook(p, b); discard(state, b); gaveAway(state, p, b); }
        const reward = STEP_REWARDS[sp.progress];
        sp.progress++;
        earn(state, p, reward.talons + (hasPatron(state, p.id, 'professor') ? 1 : 0));
        gain(p, reward.points, 'sprouts');
        let text = `${p.name} питает Росток «${info.name}»: ступень ${roman(sp.progress)} закрыта (${titles(state, f.books)})`;
        text += reward.talons ? `, +${talonsText(reward.talons)}` : `, +${pointsText(reward.points)}`;
        if (!p.sproutsFed.includes(sp.id)) {
          p.sproutsFed.push(sp.id);
          gain(p, FIRST_FEED_POINTS, 'firstFeed');
          text += `, +${pointsText(FIRST_FEED_POINTS)} за первое питание`;
        }
        log(state, text + '.');
        const options = info.bonuses.filter((b) => b !== 'rescue' || (state.mode === 'full' && !state.reserve));
        state.pending.push({ kind: 'sproutBonus', player: p.id, sprout: sp.id, options });
      }
      return;
    }
    case 'samizdat':
    case 'tamizdat': {
      check(hasBook(p, a.card), 'Издавать можно только книги со своего склада');
      check(!isPropaganda(state, a.card), 'Пропаганду нельзя издать');
      // Разоблачение издают как книгу с одним значком (без жанра).
      const icons = iconsOf(state, a.card).length + (isExposed(state, a.card) ? 1 : 0);
      if (a.address === 'samizdat') {
        check(icons > 0 && !isEvidence(state, a.card), 'Через Самиздат можно издать только книгу с жанровым значком');
      } else {
        check(icons > 0 || isEvidence(state, a.card), 'Через Тамиздат можно издать книгу с жанровым значком или Улику');
      }
      removeBook(p, a.card);
      p.published.push(a.card);
      const genres = iconsOf(state, a.card);
      const perIcon = a.address === 'samizdat' ? RULES.samizdatTalons : RULES.tamizdatTalons;
      const talons = icons * perIcon + (hasPatron(state, p.id, 'correspondent') ? RULES.correspondentTalons : 0);
      let pts = 0;
      const add = (n: number, src: Parameters<typeof gain>[2]) => { gain(p, n, src); pts += n; };
      if (a.address === 'tamizdat') {
        p.tamizdat.push(a.card);
        add(icons * RULES.tamizdatPoints, 'tamizdat');
        if (isFull(state) && genres.includes('testimony')) add(RULES.testimonyPoints, 'testimony'); // «Придать огласке»
      } else if (isFull(state) && genres.includes('foreign')) {
        add(RULES.foreignPoints, 'foreign'); // «Перевести»
      }
      gaveAway(state, p, a.card);
      log(state, `${p.name} издаёт ${title(state, a.card)} через ${name}: +${talonsText(talons)}${pts ? `, +${pointsText(pts)}` : ''}.`);
      earn(state, p, talons);
      return;
    }
    case 'glavlit': {
      // Сдать любое число подцензурных книг (жанр под цензурой) и взять столько же из стопок Непечатных и Нагрузки.
      const cards = [...new Set(a.cards)];
      check(cards.length > 0 && cards.length === a.cards.length, 'Выберите книги для Главлита');
      check(a.draws.length === cards.length, 'Для каждой отданной книги выберите стопку, из которой взять замену');
      const editor = hasPatron(state, p.id, 'editor');
      let pts = 0;
      for (const c of cards) {
        check(hasBook(p, c), 'Отдать можно только книги со своего склада');
        check(isGenreBook(state, c) && iconsOf(state, c).some((g) => state.banned.includes(g)), `${title(state, c)} — не подцензурная книга`);
        if (editor) pts += iconsOf(state, c).length;
        removeBook(p, c);
        discard(state, c);
        gaveAway(state, p, c);
      }
      log(state, `${p.name} сдаёт в Главлит книг: ${cards.length} (${titles(state, cards)}).`);
      for (const k of a.draws) {
        const c = k === 'load' ? drawLoad(state) : draw(state);
        if (c) addSecretBook(state, p, c);
      }
      log(state, `${p.name} берёт взамен: ${a.draws.filter((k) => k === 'unprinted').length} Непечатных, ${a.draws.filter((k) => k === 'load').length} Нагрузки.`);
      if (pts) {
        gain(p, pts, 'editor');
        logAfter(state, `↳ Главред: +${pointsText(pts)}.`);
      }
      earn(state, p, cards.length * RULES.glavlitTalons);
      return;
    }
    case 'knigoobmen': {
      check(hasBook(p, a.give) && isGenreBook(state, a.give), 'Отдать нужно жанровую книгу со своего склада');
      check(state.knigoobmen.includes(a.take), 'Этой книги нет на витрине Книгообмена');
      removeBook(p, a.give);
      addOpenBook(state, p, a.take);
      state.knigoobmen = state.knigoobmen.map((c) => (c === a.take ? a.give : c));
      gaveAway(state, p, a.give);
      p.bonusGroupTurns++;
      log(state, `${p.name} на Книгообмене: отдаёт ${title(state, a.give)}, берёт ${title(state, a.take)}.`);
      return;
    }
    case 'kvartirnik': {
      check(a.to !== p.id, 'Обмен — с другим игроком');
      const other = player(state, a.to);
      check(hasBook(p, a.give), 'Отдать можно только книгу со своего склада');
      const slot = other.warehouse.find((s) => s.card === a.want);
      check(slot && !slot.hidden, 'Просить можно только книгу, открыто лежащую у другого игрока');
      p.bonusGroupTurns++;
      state.pending.push({ kind: 'kvartirnikReply', player: other.id, from: p.id, give: a.give, want: a.want });
      log(state, `${p.name} на Квартирнике предлагает ${other.name} обмен: ${title(state, a.give)} на ${title(state, a.want)}.`);
      return;
    }
    case 'raspredelitel': {
      const cards = [...new Set(a.cards?.length ? a.cards : [a.card])];
      check(cards.length === 1 || hasPatron(state, p.id, 'veteran'), 'Несколько книг за одно действие — только со связью с Ветераном');
      const buy = purchases(state, p);
      for (const card of cards) {
        check(state.raspredelitel.includes(card), 'Этой книги нет в Распределителе');
        buy(RULES.raspredelitelPrice);
        addOpenBook(state, p, card);
        state.raspredelitel = state.raspredelitel.filter((c) => c !== card);
        log(state, `${p.name} получает из Распределителя ${title(state, card)}.`);
      }
      return;
    }
    case 'nasledniki': {
      check(freeSlots(p) > 0, 'На складе нет места');
      check(state.discard.length > 0, 'Сброс Непечатных пуст');
      payPrice(state, p, RULES.safehousePrice);
      state.pending.push({ kind: 'naslednikiPick', player: p.id, cards: [...state.discard] });
      log(state, `${p.name} навещает Наследников.`);
      return;
    }
    case 'posrednichestvo': {
      check(freeSlots(p) > 0, 'На складе нет места');
      payPrice(state, p, RULES.posrednichestvoPrice);
      const cards = Array.from({ length: RULES.posrednichestvoDraw }, () => draw(state)).filter((c): c is string => !!c);
      check(cards.length > 0, 'Стопка Непечатных пуста');
      state.pending.push({ kind: 'posrednichestvoKeep', player: p.id, cards });
      log(state, `${p.name} занимается Посредничеством авторам.`);
      return;
    }
    case 'club': {
      check(!RULES.clubFreeGift, 'В Клуб не нужно ходить: отдать книгу Завсегдатаю можно в свой ход без Единомышленника');
      check(a.gifts.length > 0, 'Выберите, кому из Завсегдатаев что отдать');
      for (const g of a.gifts) giveToPatron(state, p, g);
      return;
    }
    case 'kontora':
      return;
    case 'spisanie': {
      check(freeSlots(p) > 0, 'На складе нет места');
      payPrice(state, p, RULES.spisaniePrice);
      const cards = Array.from({ length: RULES.spisanieDraw }, () => draw(state)).filter((c): c is string => !!c);
      check(cards.length > 0, 'Стопка Непечатных пуста');
      state.pending.push({ kind: 'spisanieKeep', player: p.id, cards });
      log(state, `${p.name} разбирает Библиотечное списание.`);
      return;
    }
  }
}

function isFromLoadDeck(state: GameState, id: string) {
  const k = state.cards[id].kind;
  return k === 'load' || k === 'loadReturnable' || k === 'loadEvidence';
}

// ---------- Действия Инициативной группы ----------

// Тиражирование: взять книгу даром с адреса (Машинистка — +1 Талон; при обычном Тиражировании её Талон начисляется ниже).
function takeCopy(state: GameState, p: PlayerState, addr: CopyTextAddress, c: string, inAction = false) {
  const name = ADDRESSES[addr].name;
  if (addr === 'razval') {
    check(state.razval.includes(c), 'Бесплатную книгу нужно взять с того же Развала');
    state.razval = state.razval.map((x) => (x === c ? null : x));
  } else {
    const key = addr as 'tolkuchka' | 'raspredelitel' | 'knigoobmen';
    check(state[key].includes(c), `Бесплатную книгу нужно взять там же: ${name}`);
    state[key] = state[key].filter((x) => x !== c);
  }
  addOpenBook(state, p, c);
  log(state, `${p.name} тиражирует ${title(state, c)} (${name}).`);
  if (!inAction && hasPatron(state, p.id, 'typist')) {
    logAfter(state, '↳ Машинистка: +1 Талон.');
    earn(state, p, 1);
  }
}

// worker — действие делает Единомышленник из Группы (он занимает место на адресе, куда идёт тиражировать).
function doGroup(state: GameState, p: PlayerState, g: GroupAction, opts: { limited: boolean; worker?: boolean; followUp?: boolean }) {
  const info = GROUP_ACTIONS[g.action];
  check(info, 'Нет такого действия');
  if (opts.limited) check(!p.groupUsed.includes(g.action), `«${info.name}» уже сделано в эту Пятилетку`);
  check(groupInGame(state, g.action), `«${info.name}» в этой партии нет`);
  switch (g.action) {
    case 'expandWarehouse':
      check(p.capacity < RULES.maxCapacity, 'Склад уже максимального размера');
      p.capacity++;
      log(state, `${p.name}: склад увеличен до ${p.capacity}.`);
      break;
    case 'expandCache':
      check(p.cache < RULES.maxCache, 'Тайник уже максимального размера');
      // Столяр: Тайник растёт сразу на несколько мест.
      p.cache = Math.min(RULES.maxCache, p.cache + (hasPatron(state, p.id, 'carpenter') ? RULES.carpenterCache : 1));
      log(state, `${p.name}: Тайник увеличен до ${p.cache}.`);
      break;
    case 'copyText': {
      // «Покупая книгу на адресе, можете поставить Единомышленника на Тиражирование текста и взять с этого адреса
      // ещё одну книгу бесплатно». Покупатель идёт на адрес (занимает там место), второй Единомышленник — на Тиражирование.
      // Из бонуса Тиражирование уже есть — по адресу идёт только покупатель.
      const addr = g.address;
      const name = ADDRESSES[addr]?.name;
      if (opts.followUp) {
        // Покупка уже сделана этим ходом — Единомышленник на Тиражировании берёт книгу оттуда же.
        const last = state.lastBuy!;
        check(addr === last.address, `Тиражировать можно только там, где вы только что купили: ${ADDRESSES[last.address].name}`);
        check(g.card, 'Выберите книгу, которую взять бесплатно');
        check(p.available >= 1, 'Нет свободного Единомышленника для Тиражирования');
        check(p.visitedRedCorner || hasPatron(state, p.id, 'doctor') || p.available > 1, 'Последнего Единомышленника нужно отправить в Красный уголок');
        check(!last.exclude.includes(g.card), 'Только что отданную книгу нельзя забрать обратно');
        check(isGenreBook(state, g.card), 'Тиражировать можно только жанровую книгу — не Улику и не Пропаганду');
        takeCopy(state, p, addr, g.card);
        break;
      }
      check((COPY_TEXT_ADDRESSES as readonly string[]).includes(addr), 'Тиражировать можно на Развале, Толкучке, в Распределителе или на Книгообмене');
      check(!ADDRESSES[addr].safehouse || state.safehouses.includes(addr), `${name}: этого адреса нет на столе`);
      check(!g.buy || g.buy.address === addr, 'Покупать нужно на том же адресе');
      check(g.buy, 'Тиражирование — только вместе с покупкой (на Книгообмене — обменом) на этом адресе');
      check(g.buy.address !== 'tolkuchka' || g.buy.ops.some((op) => op.op === 'buy'), 'На Толкучке нужно купить хотя бы одну книгу');
      check(g.card, 'Выберите книгу, которую взять бесплатно');
      // Сколько Единомышленников уходит: покупатель, а в обычном ходе — ещё и тот, что на Тиражировании.
      const going = opts.worker ? 2 : 1;
      check(p.available >= going, opts.worker
        ? 'Нужны два Единомышленника: один покупает на адресе, другой — на Тиражировании'
        : 'Нет доступного Единомышленника, чтобы отправить его покупать');
      check(p.visitedRedCorner || hasPatron(state, p.id, 'doctor') || p.available > going, 'Последнего Единомышленника нужно отправить в Красный уголок');
      const here = state.occupancy[addr] ?? [];
      check(here.length < limitFor(addr, state.players.length), `${name}: все места заняты`);
      if (g.buy) doPlace(state, p, g.buy);
      const c = g.card;
      if (c) {
        const own = g.buy?.address === 'tolkuchka' ? g.buy.ops.some((op) => op.op === 'sell' && op.card === c)
          : g.buy?.address === 'knigoobmen' ? g.buy.give === c : false;
        check(!own, 'Только что отданную книгу нельзя забрать обратно');
        check(isGenreBook(state, c), 'Тиражировать можно только жанровую книгу — не Улику и не Пропаганду');
        takeCopy(state, p, addr, c, true);
      } else {
        log(state, `${p.name} тиражирует: ${name}.`);
      }
      state.occupancy[addr] = [...here, p.id];
      // Покупатель; Единомышленника на Тиражировании в обычном ходе спишет doOrder.
      p.available--;
      track(p, addr);
      if (hasPatron(state, p.id, 'typist')) {
        logAfter(state, '↳ Машинистка: +1 Талон.');
        earn(state, p, 1);
      }
      break;
    }
    case 'restore': {
      const slot = p.warehouse.find((s) => s.card === g.card);
      check(slot, 'Возвращать смыслы можно книге со своего склада');
      const c = state.cards[g.card];
      check(!state.restored[g.card], 'Этой книге смыслы уже возвращены');
      check(c.kind === 'genre' || c.kind === 'loadReturnable' || c.kind === 'loadEvidence' || (c.kind === 'propaganda' && RULES.exposePropaganda),
        RULES.exposePropaganda
          ? 'Смыслы можно вернуть только жанровой книге, возвращаемой Нагрузке, Нагрузке-улике или Пропаганде'
          : 'Смыслы можно вернуть только жанровой книге, возвращаемой Нагрузке или Нагрузке-улике');
      state.restored[g.card] = true;
      if (c.kind === 'propaganda') {
        log(state, `${p.name} возвращает смыслы: ${title(state, g.card)} становится Разоблачением (+${pointsText(RULES.exposePoints)} в конце).`);
      } else if (c.kind === 'loadEvidence') {
        log(state, `${p.name} возвращает смыслы: ${title(state, g.card)} становится Уликой.`);
      } else if (c.kind === 'loadReturnable') {
        log(state, `${p.name} возвращает смыслы: ${title(state, g.card)} становится «${c.returned}» (3 значка).`);
      } else {
        log(state, `${p.name} возвращает смыслы книге ${title(state, g.card)}: +1 значок.`);
      }
      payPrice(state, p, RULES.restoreCost);
      if (hasPatron(state, p.id, 'postgrad')) {
        gain(p, 2, 'postgrad');
        logAfter(state, '↳ Аспирант: +2 очка Гласности.');
      }
      break;
    }
    case 'hire':
      check(p.workers < RULES.maxWorkers, 'У вас уже максимум Единомышленников');
      payPrice(state, p, RULES.hireCost);
      p.workers++;
      p.available++;
      log(state, `${p.name} расширяет сеть: +1 Единомышленник.`);
      break;
    case 'rescue': {
      const n = rescue(state, p, g.returns);
      gain(p, n * RULES.rescuePoints, 'rescue');
      logAfter(state, `↳ За помощь товарищам: +${pointsText(n * RULES.rescuePoints)}.`);
      break;
    }
  }
  if (opts.limited) p.groupUsed.push(g.action);
}

// ---------- Отложенные решения ----------

// Игрок помнит, какие книги Барахолки он уже видел (до её обновления или покупки этой книги).
function rememberBaraholka(state: GameState, playerId: string, slots: number[]) {
  state.baraholkaSeen ??= {};
  state.baraholkaSeen[playerId] = [...new Set([...(state.baraholkaSeen[playerId] ?? []), ...slots])];
}

function resolvePending(state: GameState, p: PlayerState, action: Action) {
  const pend = state.pending[0];
  switch (pend.kind) {
    case 'baraholkaLook': {
      check(action.type === 'baraholkaBuy', 'Решите, покупать ли книгу с Барахолки');
      const bought = pend.bought ?? 0;
      const veteran = hasPatron(state, p.id, 'veteran');
      if (action.slot !== undefined) {
        const i = pend.seen.findIndex((x) => x.slot === action.slot);
        check(i >= 0, 'Купить можно только одну из просмотренных книг');
        const { slot, card } = pend.seen[i];
        // Ветеран платит за все книги действия в сумме на 1 Талон меньше (минимум 1): вторая книга — бесплатно.
        const cost = veteran && bought === 1 ? 0 : bought === 0 ? price(state, p, RULES.baraholkaPrice) : RULES.baraholkaPrice;
        pay(p, cost);
        state.baraholka[slot] = null;
        for (const id of Object.keys(state.baraholkaSeen ?? {})) state.baraholkaSeen![id] = state.baraholkaSeen![id].filter((x) => x !== slot);
        addSecretBook(state, p, card);
        pend.seen.splice(i, 1);
        pend.bought = bought + 1;
        log(state, `${p.name} покупает книгу на Барахолке.`);
        log(state, `Вы купили ${title(state, card)}.`, [p.id]);
      }
      if (action.next !== undefined) {
        check(veteran, 'Смотреть ещё книги может только игрок со связью с Ветераном');
        const card = state.baraholka[action.next];
        check(card && !pend.seen.some((x) => x.slot === action.next), 'Эту книгу нельзя посмотреть');
        pend.seen.push({ slot: action.next, card });
        rememberBaraholka(state, p.id, [action.next]);
      }
      // Ветеран покупает сколько угодно книг: решение закрывается, только когда он заканчивает.
      if (veteran && (action.slot !== undefined || action.next !== undefined)) return;
      if (action.slot === undefined) log(state, `${p.name} ${bought ? 'больше ничего не берёт' : 'ничего не берёт'} на Барахолке.`);
      break;
    }
    case 'kvartirnikReply': {
      check(action.type === 'kvartirnikReply', 'Ответьте на предложение обмена');
      const from = player(state, pend.from);
      if (action.accept && hasBook(from, pend.give) && hasBook(p, pend.want)) {
        removeBook(from, pend.give);
        removeBook(p, pend.want);
        addBook(from, pend.want);
        addBook(p, pend.give);
        autoHide(state, from, pend.want);
        autoHide(state, p, pend.give);
        gaveAway(state, from, pend.give);
        gaveAway(state, p, pend.want);
        log(state, `${p.name} соглашается на обмен с ${from.name}.`);
      } else {
        log(state, `${p.name} отказывается от обмена с ${from.name}.`);
      }
      break;
    }
    case 'naslednikiPick': {
      check(action.type === 'naslednikiPick', 'Выберите книги из сброса');
      check(action.cards.length >= 1 && action.cards.length <= 2, 'Возьмите 1 или 2 книги');
      check(action.cards.length <= freeSlots(p), 'На складе не хватит места');
      for (const c of action.cards) {
        check(state.discard.includes(c), 'Этой книги нет в сбросе');
        state.discard = state.discard.filter((x) => x !== c);
        addSecretBook(state, p, c);
      }
      state.deck = shuffle(state, [...state.deck, ...state.discard]);
      state.discard = [];
      log(state, `${p.name} берёт у Наследников ${action.cards.length} книг(и); сброс замешан в стопку.`);
      log(state, `Вы взяли: ${titles(state, action.cards)}.`, [p.id]);
      break;
    }
    case 'posrednichestvoKeep': {
      check(action.type === 'posrednichestvoKeep', 'Выберите, что оставить');
      const need = Math.min(RULES.posrednichestvoKeep, pend.cards.length);
      check(action.keep.length === need && new Set(action.keep).size === need, `Оставьте книг: ${need}`);
      check(action.keep.length <= freeSlots(p), 'На складе не хватит места');
      for (const c of action.keep) check(pend.cards.includes(c), 'Эта книга не из вытянутых');
      for (const c of pend.cards) {
        if (action.keep.includes(c)) addSecretBook(state, p, c);
        else discard(state, c);
      }
      log(state, `${p.name} оставляет себе ${action.keep.length} книг(и).`);
      log(state, `Вы оставили: ${titles(state, action.keep)}.`, [p.id]);
      state.pending.shift();
      state.pending.unshift({ kind: 'posrednichestvoGroup', player: p.id });
      return;
    }
    case 'spisanieKeep': {
      check(action.type === 'spisanieKeep', 'Выберите, что оставить из Библиотечного списания');
      check(new Set(action.keep).size === action.keep.length, 'Книга указана дважды');
      check(action.keep.length <= freeSlots(p), 'На складе не хватит места');
      for (const c of action.keep) check(pend.cards.includes(c), 'Эта книга не из взятых');
      for (const c of pend.cards) {
        if (action.keep.includes(c)) addSecretBook(state, p, c);
        else discard(state, c);
      }
      log(state, `${p.name} оставляет себе из Библиотечного списания ${action.keep.length} книг(и).`);
      if (action.keep.length) log(state, `Вы оставили: ${titles(state, action.keep)}.`, [p.id]);
      break;
    }
    case 'posrednichestvoGroup': {
      if (action.type === 'pass') break;
      check(action.type === 'group', 'Выберите действие Инициативной группы или откажитесь');
      doGroup(state, p, action.group, { limited: false });
      break;
    }
    case 'sproutBonus': {
      if (action.type === 'pass') break;
      check(action.type === 'sproutBonus', 'Выберите бонус Ростка');
      check(pend.options.includes(action.bonus), 'Этот бонус недоступен');
      // Сначала — какой бонус выбран, потом его последствия.
      log(state, `${p.name} выбирает бонус Ростка: ${SPROUT_BONUS_NAMES[action.bonus]}.`);
      if (action.bonus === 'sideJob') {
        logAfter(state, `↳ Приработок: +${talonsText(RULES.sideJobIncome)}.`);
        earn(state, p, RULES.sideJobIncome);
      } else if (action.bonus === 'underCounter') {
        let found: string | null = null;
        let given = 0;
        for (let guard = 0; guard < 200 && !found; guard++) {
          const c = draw(state);
          if (!c) break;
          if (state.cards[c].kind === 'genre' && iconsOf(state, c).length >= 2) found = c;
          else { discard(state, c); given++; }
        }
        if (found && freeSlots(p) > 0) {
          log(state, `${p.name} достаёт из-под полы выдающуюся книгу (в сброс ушло ${given}).`);
          log(state, `Из-под полы: ${title(state, found)}.`, [p.id]);
          addSecretBook(state, p, found);
        } else if (found) {
          discard(state, found);
          log(state, `${p.name}: выдающаяся книга из-под полы ушла в сброс — нет места.`);
        }
      } else {
        check(action.group && action.group.action === action.bonus, 'Уточните параметры действия');
        doGroup(state, p, action.group, { limited: false });
      }
      break;
    }
    case 'glavlitSwap': {
      check(action.type === 'glavlitSwap', 'Перенесите опалу с одного жанра на другой');
      check(state.banned.includes(action.from), 'Снять опалу можно только с опального жанра');
      check(GENRES.includes(action.to) && !state.banned.includes(action.to), 'Наложить опалу можно только на жанр, который сейчас не в опале');
      // Новая опала — самая свежая: из опалы она выйдет последней.
      state.banned = [...state.banned.filter((g) => g !== action.from), action.to];
      log(state, `${p.name} (Главлитовец): опала снята с жанра «${GENRE_NAMES[action.from]}» и наложена на «${GENRE_NAMES[action.to]}».`);
      state.pending.shift();
      if (pend.roundStart) state.holdTurn = true; // Пятилетка только началась — первый ход ещё впереди
      return;
    }
    case 'lieutenantPick': {
      check(action.type === 'lieutenantPick', 'Выберите изъятую книгу или откажитесь');
      if (action.card) {
        check(pend.cards.includes(action.card) && state.discard.includes(action.card), 'Эту книгу уже забрали');
        check(freeSlots(p) > 0, 'На Складе нет места');
        state.discard = state.discard.filter((c) => c !== action.card);
        addBook(p, action.card);
        autoHide(state, p, action.card);
        log(state, `${p.name}: Лейтенант приносит изъятую книгу ${title(state, action.card)}.`);
      }
      state.pending.shift();
      if (!state.pending.length) {
        finishRound(state);
        state.holdTurn = true; // новый раунд уже начался — ход не сдвигаем
      }
      return;
    }
    case 'discardExcess': {
      check(action.type === 'discardExcess', 'Выберите, какие книги отдать');
      check(action.cards.length === pend.count && new Set(action.cards).size === pend.count, `Нужно отдать книг: ${pend.count}`);
      for (const c of action.cards) {
        removeBook(p, c);
        discard(state, c);
      }
      log(state, `${p.name} отдаёт лишние книги: ${titles(state, action.cards)}.`);
      break;
    }
    case 'kontoraWarning': {
      // Старые сохранения: раньше соперников предупреждали о походе в Контору.
      check(action.type === 'kontoraHide', 'Перепрячьте книги или подтвердите, что готовы');
      setHidden(state, p, action.hidden);
      log(state, `${p.name} готов(а) к визиту в Контору.`);
      break;
    }
    case 'kontoraDecide': {
      check(action.type === 'kontoraDecide', 'Решите, идти ли в Контору');
      state.pending.shift();
      if (!action.go) {
        log(state, `${p.name} передумывает идти в Контору.`);
        state.holdTurn = true;
        return;
      }
      check(action.choice, 'Выберите пункты');
      check(!mustVisitRedCorner(state, p), 'Последнего Единомышленника нужно отправить в Красный уголок');
      state.occupancy.kontora = [...(state.occupancy.kontora ?? []), p.id];
      track(p, 'kontora');
      p.available--;
      log(state, `${p.name} идёт в Контору.`);
      state.log[state.log.length - 1].act = { player: p.id, n: p.actions[p.actions.length - 1].n };
      doKontora(state, p, action.choice);
      return;
    }
    case 'kontoraHandout': {
      check(action.type === 'kontoraHandout', 'Выберите книгу из Спецхрана');
      takeFromSpetskhran(state, p, action.card);
      if (pend.seize) seizeDenounced(state, pend.seize);
      break;
    }
    case 'extraGroup': {
      if (action.type === 'pass') break;
      check(action.type === 'group', 'Выберите действие Группы или откажитесь');
      // Подмастерье повторяет одно из действий Группы, уже сделанных в эту Пятилетку.
      check(p.groupUsed.includes(action.group.action), 'Подмастерье повторяет только действие Группы, уже сделанное в эту Пятилетку');
      doGroup(state, p, action.group, { limited: false });
      log(state, `${p.name}: Подмастерье выполняет действие Группы.`);
      break;
    }
    case 'freeConnection': {
      check(action.type === 'clubGift' || action.type === 'pass', 'Завяжите связь или откажитесь');
      if (action.type === 'clubGift' && action.gift) giveToPatron(state, p, action.gift);
      break;
    }
  }
  state.pending.shift();
}

export { cacheLimit, iconsOf, isBanned, isLoad, isGenreBook, isSingle, freeSlots };
export type { AddressId, Genre, PassionId };

// Сохранения, сделанные до появления полного режима, дополняем недостающими полями.
export function migrate(state: GameState): GameState {
  state.patrons ??= [];
  state.spetskhran ??= [];
  state.spetskhranSeen ??= {};
  state.baraholkaSeen ??= {};
  for (const p of state.players as (PlayerState & { spetskhran?: string[] })[]) {
    if (p.spetskhran) { state.spetskhran.push(...p.spetskhran); delete p.spetskhran; }
    p.held ??= 0;
    p.buzoterUsed ??= false;
    p.pointsBy ??= {};
    p.actions ??= [];
    p.patronBonus ??= { capacity: 0, cache: 0 };
  }
  // Завпунктом переименован в Комсорга.
  for (const pt of state.patrons as { id: string }[]) if (pt.id === 'zavpunktom') pt.id = 'komsorg';
  // Барахолка: раньше смотрели одну книгу.
  for (const x of state.pending as (Pending & { slot?: number; card?: string })[]) {
    if (x.kind === 'baraholkaLook' && !x.seen) x.seen = [{ slot: x.slot!, card: x.card! }];
  }
  return state;
}
