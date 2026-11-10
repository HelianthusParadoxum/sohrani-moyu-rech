// Движок правил: создание партии и применение действий.
// applyAction не меняет переданное состояние, а возвращает новое.
import {
  ADDRESSES, CARDS, CLUB_ORDER, COPY_TEXT_ADDRESSES, GENRE_NAMES, GENRE_SHORT, GROUP_ACTIONS, KEEPERS, PASSIONS, PATRONS, PERMANENT_ADDRESSES, RULES, SAFEHOUSES,
  SPECIALS, SPROUTS, SPROUT_BONUS_NAMES, STEP_REWARDS, sproutSlotBonuses, addressInGame, groupInGame, limitFor,
} from './content';
import { finalScoring } from './scoring';
import {
  afterRaid, befriendPatron, befriendTargets, startConnectionTargets, doKontora, gaveAway, giveToPatron, holdWorker, isFull, partorgFill, offerBlatnoy, doBlatnoy, payPrice, price, proseBonus, purchases,
  flushIrony, removePatron, seizeDenounced, setupClub, startKontora, takeFromSpetskhran,
} from './full';
import type {
  Action, AddressId, CatalogThen, CopyTextAddress, GameState, Genre, GroupAction, Mode, PassionId, Pending, PlaceAction, PlayerState,
} from './types';
import { GENRES } from './types';
import {
  addBook, addBoughtBook, addOpenBook, noteAutoHidden, canMemorizeOnBuy, countsAsLoad, isFromLoadDeck, roomToBuy, addSecretBook, autoHide, cacheLimit, check, cloneJson, coversStep, discard, earn, gain, hasPatron, draw, drawLoad, fail, freeSlots, hasBook, iconsOf, isBanned, isEvidence,
  isGenreBook, isLoad, isPropaganda, isPropagandaKind, isSingle, log, pay, player, pointsText, random, removeBook, roman, shuffle,
  talonsText, title, titles, logEvent, logNote, logAfter, toSpetskhranPublic, seeSpetskhran, isExposed, saved, logRecap, plural, bulletTitles, iconCount, genresOf, genreOn,
} from './util';

export interface NewGameOptions {
  players: { id: string; name: string }[];
  seed?: number;
  mode?: Mode;
  curator?: boolean; // полный режим: Куратор в колоде Пристрастий (по умолчанию — да)
  reserve?: boolean; // «Заповедник»: полный режим без Конторы и Куратора
  forceCurator?: boolean; // для тестов: первый игрок из списка — Куратор
  curatorStyle?: 'open' | 'ambush' | 'boa'; // для тестов: стратегия Куратора-бота (иначе — случайная)
}

export function createGame(opts: NewGameOptions): GameState {
  const n = opts.players.length;
  check(n >= 1 && n <= 5, 'В игре участвуют от 1 до 5 игроков');
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
    tolkuchka: [], razval: [], baraholka: [], baraholkaSeen: {}, knigoobmen: [], raspredelitel: [], agitpunkt: [],
    safehouses: [], safehouseDeck: [], occupancy: {},
    sprouts: [], patrons: [], spetskhran: [], spetskhranSeen: {}, pending: [], ready: [], log: [],
  };
  if (solo) state.solo = true;
  if (opts.reserve) state.reserve = true;
  state.deck = shuffle(state, CARDS.filter((c) => !['load', 'loadReturnable', 'loadEvidence', 'loadPropaganda'].includes(c.kind)).map((c) => c.id));
  state.loadDeck = shuffle(state, CARDS.filter((c) => ['load', 'loadReturnable', 'loadEvidence', 'loadPropaganda'].includes(c.kind) && (RULES.legalPropaganda || !c.legal)).map((c) => c.id));
  state.safehouseDeck = shuffle(state, [...SAFEHOUSES]);
  state.sprouts = shuffle(state, SPROUTS.map((s) => s.id)).slice(0, solo ? RULES.soloSprouts[mode] : n + RULES.extraSprouts[opts.reserve ? 'reserve' : mode]).map((id) => ({ id, progress: 0 }));

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
      capacity: RULES.startCapacity, cache: RULES.startCache, warehouse: [],
      published: [], tamizdat: [],
      passion: null, passionOptions: [passions.pop()!, passions.pop()!],
      groupUsed: [], visitedRedCorner: false, sproutsFed: [], subscriptions: [],
      held: 0, buzoterUsed: false, pointsBy: {}, actions: [], patronBonus: { capacity: 0, cache: 0 },
    };
    for (let i = 0; i < RULES.startUnprinted; i++) addBook(p, draw(state)!);
    for (let i = 0; i < RULES.startLoad; i++) addBook(p, drawLoad(state)!);
    state.players.push(p);
  }
  // Для тестов: первый игрок — Куратор (выбора у него нет), у остальных Куратора среди карт нет.
  if (opts.forceCurator && mode === 'full' && !opts.reserve && n > 1 && opts.curator !== false) {
    const first = opts.players[0].id;
    for (const p of state.players) {
      if (p.id === first) p.passionOptions = ['curator'];
      else p.passionOptions = p.passionOptions.map((x) => (x === 'curator' ? passions.pop() ?? 'erudite' : x));
    }
    state.forcedCurator = first;
  }
  if (opts.curatorStyle) state.curatorStyleOverride = opts.curatorStyle;
  state.order = seats.map((s) => s.id);
  state.razval = [null, null, null, null];
  fillRazval(state);
  state.baraholka = Array.from({ length: RULES.displaySize }, () => draw(state));
  if (mode === 'full') setupClub(state);
  log(state, 'Партия началась.');
  logOrder(state);
  logSetup(state);
  // Опала первой Пятилетки известна до выбора Пристрастий (остальной стол откроется после выбора).
  state.banned = shuffle(state, [...GENRES]).slice(0, state.censorship);
  logNote(state, solo
    ? `Несистемный: одиночная игра. Цензура растёт на 1 каждую Пятилетку; в конце вскроются ${RULES.soloEndCards[mode]} Непечатных — каждая ЧНЛ срежет ступень Ростка.`
    : 'Каждый игрок тайно выбирает одно из двух Пристрастий.');
  return state;
}

// Стартовый Тайник: сначала ЧНЛ (открыто лежащая — готовый донос и подозрение), потом прочие опальные книги, потом — если
// место осталось — и неопальные (соперники их не увидят); внутри — больше значков, затем жанр Пристрастия, затем случайно.
// Нагрузку не прячут.
export function startHide(state: GameState, p: PlayerState) {
  const favored: Genre[] = (p.passion && PASSIONS[p.passion].genres) || [];
  const fits = (c: string) => (genresOf(state, c).some((g) => favored.includes(g)) ? 1 : 0);
  const books = shuffle(state, p.warehouse.filter((w) => !w.hidden && !w.memorized && !isLoad(state, w.card)))
    // Легальная ЧНЛ не опальна — Контора её не изымает, прятать её первой незачем.
    .sort((a, b) => Number(isPropaganda(state, b.card) && isBanned(state, b.card)) - Number(isPropaganda(state, a.card) && isBanned(state, a.card))
      || Number(isBanned(state, b.card)) - Number(isBanned(state, a.card))
      || iconCount(state, b.card) - iconCount(state, a.card) || fits(b.card) - fits(a.card));
  let room = cacheLimit(state, p) - p.warehouse.filter((w) => w.hidden).length;
  for (const w of books) if (room-- > 0) w.hidden = true;
}

// ---------- Кто сейчас ходит ----------

export function activePlayers(state: GameState): string[] {
  if (state.pending.length) return [state.pending[0].player];
  if (state.phase === 'orders') return [state.order[state.turn]];
  if (state.phase === 'passion' || state.phase === 'setupCache' || state.phase === 'gathering' || state.phase === 'ambush' || state.phase === 'hiding') {
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
  const talonsBefore = p.talons;
  const logStart = state.log.length;
  const shown = displayed(state);
  const done = (s: GameState) => finishAction(s, p, pointsBefore, logStart, shown, talonsBefore);

  if (state.pending.length) {
    const logFrom = state.log.length;
    resolvePending(state, p, action);
    // Поручение без своей строки в журнале (её пишет решение после него) — кружок с номером на первую строку решения.
    const act = state.pendingAct;
    if (act?.player === p.id) {
      const entry = state.log.slice(logFrom).find((l) => !l.only && !l.after);
      if (entry) entry.act = act;
      if (entry || !state.pending.some((x) => x.player === p.id)) delete state.pendingAct;
    }
  } else {
    switch (state.phase) {
      case 'passion': {
        check(action.type === 'choosePassion', 'Сначала выберите Пристрастие');
        check(p.passionOptions.includes(action.passion), 'Этого Пристрастия нет среди ваших карт');
        p.passion = action.passion;
        state.ready.push(p.id);
        log(state, `${p.name} выбрал(а) Пристрастие.`);
        state.log[state.log.length - 1].who = p.id;
        log(state, `${p.name}: Пристрастие — ${PASSIONS[action.passion].name}.`, [p.id]);
        if (action.passion === 'curator') state.log[state.log.length - 1].strong = true;
        // Карта Куратора одна: кто её сбросил, тот знает, что Куратора в партии нет (тайно — видят он сам и зритель).
        else if (p.passionOptions.includes('curator')) log(state, `${p.name} сбрасывает карту Куратора и знает, что Куратора в этой партии нет.`, [p.id]);
        if (state.ready.length === state.players.length) {
          // Первый явочный адрес выкладывается сразу, в начале 1-й Пятилетки (дальше — по одному в каждой новой).
          const safe = RULES.safehouseAtStart ? state.safehouseDeck.pop() : undefined;
          if (safe) state.safehouses.push(safe);
          startRound(state, safe);
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
          logStartBooks(state);
          // Стартовые связи: каждый — с одним свободным Завсегдатаем, в порядке, обратном порядку хода
          // (кто ходит последним, выбирает первым). Завсегдатай занят до конца 1-й Пятилетки.
          if (isFull(state) && RULES.startConnection && state.patrons.length) {
            logNote(state, 'Стартовые связи в Клубе: каждый выбирает одного Завсегдатая — в порядке, обратном порядку хода.');
            for (const id of [...state.order].reverse()) state.pending.push({ kind: 'startConnection', player: id });
          } else {
            logEvent(state, 'Поручения');
          }
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
          // Следствия («↳ …») пропускаем: кружок — на строке самого действия.
          const entry = first && state.log.slice(logFrom).find((l) => !l.only && !l.after);
          if (entry) entry.act = { player: p.id, n: first.n };
          else if (first && state.pending.some((x) => x.player === p.id)) state.pendingAct = { player: p.id, n: first.n };
        }
        break;
      case 'gathering':
        check(action.type === 'gathering', 'Сейчас Посиделки');
        doGathering(state, p, action.show);
        return done(state);
      case 'ambush':
        check(action.type === 'ambush', 'Сейчас решается Засада');
        doAmbush(state, p, action.go, action.picks);
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
const DISPLAYS: [keyof Pick<GameState, 'razval' | 'tolkuchka' | 'knigoobmen' | 'raspredelitel' | 'agitpunkt'>, string][] = [
  ['razval', 'На Развал'], ['tolkuchka', 'На Толкучку'], ['knigoobmen', 'На Книгообмен'], ['raspredelitel', 'В Распределитель'],
  ['agitpunkt', 'На Агитпункт'],
];

function displayed(state: GameState): Set<string> {
  return new Set(DISPLAYS.flatMap(([k]) => ((state[k] ?? []) as (string | null)[]).filter((c): c is string => !!c)));
}

// Записать, какие книги вышли на открытые адреса (кроме уже названных в журнале этого действия — например, проданных).
function logArrivals(state: GameState, before: Set<string>, mentioned = '') {
  for (const [k, where] of DISPLAYS) {
    const fresh = ((state[k] ?? []) as (string | null)[]).filter((c): c is string => !!c && !before.has(c) && !mentioned.includes(state.cards[c].title));
    if (!fresh.length) continue;
    // На Развале цена зависит от места (свежести) — пишем её у каждой книги.
    const items = fresh.map((c) => title(state, c) + (k === 'razval' ? ` — ${talonsText(RULES.razvalPrices[state.razval.indexOf(c)])}` : ''));
    const list = items.length < 3 ? items.join(', ') : '\n' + items.map((x) => `• ${x}`).join('\n');
    log(state, `${where} ${fresh.length > 1 ? 'выходят' : 'выходит'}: ${list}.`);
  }
}

function finishAction(state: GameState, p: PlayerState, pointsBefore: number, logStart = state.log.length, shown?: Set<string>, talonsBefore?: number): GameState {
  flushIrony(state);
  tsekhovikBonus(state);
  if (shown) logArrivals(state, shown, state.log.slice(logStart).map((l) => l.text).join('\n'));
  // Проза «Вдохновиться»: действие принесло очки — бонус за прозу (см. proseBonus).
  if (p.points > pointsBefore) {
    const bonus = proseBonus(state, p);
    if (bonus) {
      gain(p, bonus, 'prose');
      logAfter(state, `↳ [ПР] вдохновляет: +${pointsText(bonus)}.`);
    }
  }
  // Талоны изменились — в конце действия: сколько было и сколько стало. Если строки самого действия ещё нет
  // (Талоны отданы, а действие продолжится решением — Спецхран и т. п.), строка — после неё, когда она появится.
  if (talonsBefore !== undefined) {
    const from = state.talonCarry?.player === p.id ? state.talonCarry.from : talonsBefore;
    delete state.talonCarry;
    const ownLine = state.log.slice(logStart).some((l) => !l.only && l.text.startsWith(`${p.name} `));
    if (p.talons !== from) {
      if (ownLine || !state.pending.some((x) => x.player === p.id)) logAfter(state, `↳ Талоны ${from} → ${p.talons}`);
      else state.talonCarry = { player: p.id, from };
    }
  }
  // Следствия («↳ …») — сразу после последней строки самого действия игрока (до смены фазы и прочего).
  // Только до первого заголовка события (новая Пятилетка, Посиделки, Облава): что случилось после — там и остаётся.
  const all = state.log.slice(logStart);
  const header = all.findIndex((l, i) => i > 0 && l.strong && !l.who);
  const fresh = header < 0 ? all : all.slice(0, header);
  const rest = header < 0 ? [] : all.slice(header);
  for (const l of rest) delete l.after;
  if (fresh.some((l) => l.after)) {
    const main = fresh.filter((l) => !l.after);
    let at = main.map((l) => l.text.startsWith(`${p.name} `)).lastIndexOf(true);
    if (at < 0) at = main.length - 1;
    const tail = fresh.filter((l) => l.after);
    // Кружок с номером действия — на строке самого действия, а не на следствии.
    for (const l of tail) {
      if (l.act && main[at] && !main[at].act) main[at].act = l.act;
      delete l.act;
    }
    state.log = [...state.log.slice(0, logStart), ...main.slice(0, at + 1), ...tail, ...main.slice(at + 1), ...rest];
    for (const l of fresh) delete l.after;
  }
  return state;
}

// Цеховик: за любое действие, приносящее Талоны, — на 1 Талон больше. Один раз за поручение, сколько бы частей ни было
// (адрес, Ирония, Завсегдатаи, бонус Ростка, выбранный следом).
function tsekhovikBonus(state: GameState) {
  for (const q of state.players) {
    if (!q.talonsEarned) continue;
    delete q.talonsEarned;
    if (!hasPatron(state, q.id, 'tsekhovik')) continue;
    const at = `${state.round}:${state.phase}:${q.actions.length}`;
    if (q.tsekhovikAt === at) continue;
    q.tsekhovikAt = at;
    q.talons += RULES.tsekhovikBonus;
    (q.talonsBy ??= {}).tsekhovik = (q.talonsBy.tsekhovik ?? 0) + RULES.tsekhovikBonus;
    logAfter(state, `↳ Цеховик${q.id === state.order[state.turn] ? '' : ` (${q.name})`}: ещё +${talonsText(RULES.tsekhovikBonus)}.`);
  }
}

// ---------- Пятилетка ----------

// Порядок хода — отдельной строкой (в одиночной игре не нужен); в клиенте перед именами — кружки игроков.
function logOrder(state: GameState) {
  if (state.players.length < 2) return;
  log(state, `Порядок хода: ${state.order.map((id) => player(state, id).name).join(', ')}.`);
  state.log[state.log.length - 1].order = [...state.order];
}

// Жанр в журнале: значок (в клиенте — цветной) и название — «[ПО] Поэзия».
function genreLabel(g: Genre): string {
  return `[${GENRE_SHORT[g]}] ${GENRE_NAMES[g]}`;
}

function startRound(state: GameState, newSafehouse?: AddressId, prevCensorship?: number) {
  state.phase = 'orders';
  state.ready = [];
  state.occupancy = {};
  state.sproutRound = {};
  state.sproutRoundN = {};
  state.sproutRoundSlot = {};
  state.nextOrder = [];
  delete state.turnDone;
  delete state.lastBuy;
  delete state.clubGiftBy;
  for (const pt of state.patrons) pt.turned = false;
  for (const p of state.players) {
    p.available = p.workers - p.held;
    p.buzoterUsed = false;
    p.bonusGroupTurns = 0;
    p.bonusGroupFrom = [];
    p.groupUsed = [];
    p.actions = [];
    p.visitedRedCorner = false;
  }
  // Обстановка: опала и обновление каналов.
  const before = [...state.banned];
  if (state.round > 1) {
    // Инерция: самый старый опальный жанр выходит из опалы, взамен (и при росте Цензуры — сверх того) в опалу попадают
    // новые, только что освобождённый в ту же Пятилетку не возвращается. Окостенение: давно ненавистное так и остаётся —
    // выходит самый свежий жанр, опала добирается из всех свободных (он может тут же вернуться).
    const ossified = RULES.censorshipShift === 'ossified';
    const kept = ossified ? state.banned.slice(0, -1) : state.banned.slice(1);
    const released = ossified ? state.banned[state.banned.length - 1] : state.banned[0];
    const fresh = shuffle(state, GENRES.filter((g) => !kept.includes(g) && (ossified || g !== released))).slice(0, Math.max(0, state.censorship - kept.length));
    // Вернувшийся в ту же Пятилетку жанр (Окостенение) встаёт перед новыми: только что попавшие в опалу — в конце строки.
    fresh.sort((a, b) => Number(!before.includes(a)) - Number(!before.includes(b)));
    state.banned = [...kept, ...fresh].slice(-state.censorship);
  } else if (!state.banned.length) {
    state.banned = shuffle(state, [...GENRES]).slice(0, state.censorship);
  }
  logEvent(state, `ПЯТИЛЕТКА ${state.round}`);
  if (state.round > 1) logOrder(state);
  // Усилилась ли Цензура (в одиночной игре она растёт всегда — не пишем).
  if (prevCensorship !== undefined && !state.solo) {
    log(state, state.censorship > prevCensorship ? `Цензура усилилась: ${prevCensorship} → ${state.censorship}.` : `Цензура не усилилась: ${state.censorship}.`);
  }
  // Цензура списком: что вышло из опалы, что попало, что в опале теперь.
  const list = (gs: Genre[]) => gs.map(genreLabel).join(' ') || '—';
  log(state, state.round > 1
    ? `Цензура: ${state.censorship}\n• Из опалы выходит: ${list(before.filter((g) => !state.banned.includes(g)))}`
      + `\n• В опалу попадает: ${list(state.banned.filter((g) => !before.includes(g)))}\n• В опале теперь: ${list(state.banned)}`
    : `Цензура: ${state.censorship}\n• В опале: ${list(state.banned)}`);
  if (newSafehouse) log(state, `Открылся новый явочный адрес: ${ADDRESSES[newSafehouse].name}.`);

  refreshChannels(state, state.round === 1);
  // Все открытые адреса обновлены полностью — перечислим всё, что на них лежит. (Раньше книги, лежавшие на столе и
  // в прошлой Пятилетке, — например, вернувшиеся после перетасовки сброса, — в перечень не попадали.)
  logArrivals(state, new Set());
  // Спецхран (в Главлите): в начале каждой Пятилетки — по книге Непечатных на игрока, вслепую.
  let toSpets = 0;
  for (let i = 0; i < RULES.spetskhranPerPlayer * state.players.length; i++) {
    const c = draw(state);
    if (!c) break;
    state.spetskhran.push(c);
    toSpets++;
  }
  if (toSpets) log(state, `В 🗄️ Спецхран поступает ${plural(toSpets, 'непечатный текст', 'непечатных текста', 'непечатных текстов')} (всего там ${state.spetskhran.length}).`);
  if (state.solo && isFull(state) && state.round >= 2) soloPressure(state);
  // В 1-й Пятилетке поручения начинаются после раскладки стартовых книг.
  if (state.round > 1) logEvent(state, 'Поручения');
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
  log(state, `Несистемный: на действие Конторы вытянут жетон [${GENRE_SHORT[genre]}].`);
  if (pt && !pt.removed) removePatron(state, pt.id);
  else holdWorker(state, p, `Завсегдатая жанра [${GENRE_SHORT[genre]}] уже нет в Клубе`);
}

function refreshChannels(state: GameState, first: boolean) {
  // Все адреса с книгами каждую Пятилетку обновляются полностью: что осталось — в сброс, выкладка заново.
  if (!first) {
    state.tolkuchka.forEach((c) => discard(state, c));
    state.tolkuchka = [];
  }
  while (state.tolkuchka.length < RULES.displaySize) {
    const c = draw(state);
    if (!c) break;
    state.tolkuchka.push(c);
  }
  if (!first) {
    state.razval.forEach((c) => c && discard(state, c));
    state.razval = [null, null, null, null];
    fillRazval(state);
    for (const c of state.baraholka) if (c) discard(state, c);
    state.baraholka = Array.from({ length: RULES.displaySize }, () => draw(state));
    state.baraholkaSeen = {};
  }
  if (state.safehouses.includes('agitpunkt')) {
    (state.agitpunkt ?? []).forEach((c) => discard(state, c));
    state.agitpunkt = [];
    for (let i = 0; i < RULES.agitpunktSize; i++) {
      const c = drawLoad(state);
      if (c) state.agitpunkt.push(c);
    }
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

// Начало партии: какие Ростки Гласности в игре и какие Завсегдатаи в Клубе (с жанром, который каждый из них ждёт).
function logSetup(state: GameState) {
  const sprouts = state.sprouts.map((sp) => {
    const info = SPROUTS.find((x) => x.id === sp.id)!;
    const sup = info.steps.map((st) => st.support).filter((g): g is Genre => !!g).map(genreLabel);
    return `• «${info.name}» — ${genreLabel(info.main)}; поддержка по ступеням: ${sup.join(' ')}`;
  });
  log(state, `Ростки Гласности:\n${sprouts.join('\n')}`);
  if (state.patrons?.length) {
    const patrons = [...state.patrons].sort((a, b) => CLUB_ORDER.indexOf(a.genre) - CLUB_ORDER.indexOf(b.genre)).map((pt) => `• [${GENRE_SHORT[pt.genre]}] ${PATRONS[pt.id].name} — ${PATRONS[pt.id].hint}`);
    log(state, `Завсегдатаи Клуба (значок — жанр книги, за которую заводится связь):\n${patrons.join('\n')}`);
  }
}

// Стартовые книги, когда все разложили их по Тайникам: что на виду — всем; что в Тайнике — только хозяину (и зрителю).
function logStartBooks(state: GameState) {
  for (const id of state.order) {
    const p = player(state, id);
    const open = p.warehouse.filter((s) => !s.hidden).map((s) => s.card);
    const hidden = p.warehouse.filter((s) => s.hidden).map((s) => s.card);
    log(state, open.length ? `${p.name} на складе на виду: ${bulletTitles(state, open)}.` : `${p.name}: на складе на виду ничего.`);
    state.log[state.log.length - 1].who = p.id;
    // ЧНЛ, которую все видели на складе при раскладке, — как взятая открыто: все знают, что она у него.
    const seen = open.filter((c) => isPropaganda(state, c)).length;
    if (seen) p.propagandaDealt = (p.propagandaDealt ?? 0) + seen;
    if (hidden.length) {
      // Без кружка игрока: он уже стоит у строки «на виду» прямо над этой.
      log(state, `${p.name} прячет в Тайнике: ${bulletTitles(state, hidden)}.`, [p.id]);
    }
  }
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
        if (genresOf(state, c).includes(sub.genre)) got = c;
        else discard(state, c);
      }
      if (!got) continue;
      if (freeSlots(p) > 0) {
        // Подписка приходит в открытую: все видят книгу (спрятать её можно при укрытии перед облавой).
        addBook(p, got);
        log(state, `${p.name} получает по Подписке: ${title(state, got)}.`);
        state.log[state.log.length - 1].who = p.id;
      } else {
        discard(state, got);
        log(state, `${p.name}: непечатный текст по Подписке ушёл в сброс — нет места на складе.`);
        state.log[state.log.length - 1].who = p.id;
      }
    }
    p.subscriptions = p.subscriptions.filter((s) => s.rounds > 0);
  }
  // Врач: в Красный уголок можно не ходить, но книга Нагрузки всё равно приходит в конце поручений —
  // по тем же правилам: нет места — отдать книгу Непечатных; склад весь в Нагрузке — не брать.
  if (isFull(state)) {
    for (const id of state.order) {
      const p = player(state, id);
      if (p.visitedRedCorner || !hasPatron(state, id, 'doctor')) continue;
      if (freeSlots(p) > 0) doctorLoad(state, p);
      else if (p.warehouse.every((s) => countsAsLoad(state, s.card))) {
        log(state, `${p.name} (Врач): Нагрузка не приходит — склад весь в Нагрузке.`);
        state.log[state.log.length - 1].who = p.id;
      } else state.pending.push({ kind: 'doctorLoad', player: id });
    }
  }
  if (isFull(state)) {
    for (const id of state.order) {
      if (hasPatron(state, id, 'apprentice')) state.pending.push({ kind: 'extraGroup', player: id });
      if (hasPatron(state, id, 'chairman')) state.pending.push({ kind: 'freeConnection', player: id });
    }
  }
  if (isFull(state) && genreOn('drama')) dramaBonus(state);
  state.phase = 'gathering';
  state.ready = [];
  state.shownAtGathering = {};
  state.cacheAtGathering = {};
  logEvent(state, 'Посиделки');
  const pts = RULES.gatheringPoints;
  logNote(state, `Можно показать опальные книги, Улики и Разоблачения со склада — ${pointsText(pts)} за каждую.${ambushPossible(state) ? ' Но Куратор может раскрыться и устроить Засаду: всех, кто показал опальное, ждёт Контора.' : ''}`);
  // Раскрывшийся Куратор на Посиделки не допускается: выбора у него нет.
  const cur = state.curatorRevealed && state.players.find((x) => x.id === state.curatorRevealed);
  if (cur) {
    state.ready.push(cur.id);
    log(state, `${cur.name} на Посиделки не допущен.`);
    state.log[state.log.length - 1].who = cur.id;
  }
}

// Врач: книга Нагрузки вслепую в конце поручений (у того, кто не был в Красном уголке).
function doctorLoad(state: GameState, p: PlayerState) {
  const c = drawLoad(state);
  if (!c) return;
  addBook(p, c);
  log(state, `${p.name} (Врач) получает Нагрузку: ${title(state, c)}.`);
  state.log[state.log.length - 1].who = p.id;
}

// Драматургия «Разыграть»: в конце фазы поручений +RULES.dramaPoints очка за каждую книгу драматургии в открытую на складе
// (не в Тайнике) и в изданном.
function dramaBonus(state: GameState) {
  for (const id of state.order) {
    const p = player(state, id);
    const cards = [...p.warehouse.filter((s) => !s.hidden).map((s) => s.card), ...p.published]
      .filter((c) => iconsOf(state, c).includes('drama'));
    if (!cards.length) continue;
    const pts = cards.length * RULES.dramaPoints;
    gain(p, pts, 'drama');
    log(state, `${p.name} разыгрывает [ДР]: ${titles(state, cards)} — +${pointsText(pts)}.`);
    state.log[state.log.length - 1].who = p.id;
  }
}

function doGathering(state: GameState, p: PlayerState, show: string[]) {
  check(new Set(show).size === show.length, 'Книга указана дважды');
  check(state.curatorRevealed !== p.id, 'Раскрывшийся Куратор на Посиделки не допущен');
  let pts = 0;
  let geo = 0;
  for (const id of show) {
    // Опальная жанровая книга, Улика или Разоблачение.
    const banned = (isGenreBook(state, id) || isEvidence(state, id) || isExposed(state, id)) && isBanned(state, id);
    check(hasBook(p, id), 'Показывать можно только книги со своего склада');
    check(banned, `${title(state, id)} — не опальная жанровая книга, не Улика и не Разоблачение`);
    pts += RULES.gatheringPoints;
    (state.shownAtGathering ??= {})[p.id] = [...(state.shownAtGathering[p.id] ?? []), id];
    if (hasPatron(state, p.id, 'geologist')) geo++;
  }
  // Опальные книги из Тайника, которые игрок не показал (честному показывать опальное выгодно; у Куратора в Тайнике —
  // ЧНЛ). Неопальные книги в Тайнике (спрятанные впрок) показать нельзя — они не в счёт.
  const unshown = p.warehouse.filter((s) => s.hidden && !s.memorized && !show.includes(s.card) && isBanned(state, s.card)).length;
  if (unshown) p.cacheUnshown = (p.cacheUnshown ?? 0) + unshown;
  const shownCached = p.warehouse.filter((s) => s.hidden && show.includes(s.card)).length;
  (state.cacheAtGathering ??= {})[p.id] = { unshown, shown: shownCached };
  gain(p, pts, 'gathering');
  state.ready.push(p.id);
  if (show.length) {
    log(state, `${p.name} показывает на Посиделках на +${pointsText(pts)}:\n${show.map((c) => `• ${title(state, c)}`).join('\n')}`);
  } else {
    log(state, `${p.name} ничего не показывает на Посиделках.`);
  }
  state.log[state.log.length - 1].who = p.id;
  // Геолог — следствие показа: строкой «↳ …» под ней, как Цеховик.
  if (geo) {
    earn(state, p, geo, 'geologist');
    logAfter(state, `↳ Геолог: +${talonsText(geo)}.`);
  }
  if (state.ready.length === state.players.length) {
    state.ready = [];
    // Кто ещё в этот раз прятал опальное из Тайника, а кто показал всё: для подозрений ботов.
    const at = state.cacheAtGathering ?? {};
    for (const o of state.players) {
      const mine = at[o.id];
      if (!mine?.unshown) continue;
      const others = state.players.filter((x) => x.id !== o.id).map((x) => at[x.id]).filter(Boolean);
      (o.cacheUnshownAt ??= []).push({
        n: mine.unshown,
        hiders: others.filter((x) => x.unshown > 0).length,
        brave: others.filter((x) => x.unshown === 0 && x.shown > 0).length,
      });
    }
    // Засада возможна, если кто-то показал опальное, — ждём решения всех (так не видно, кто Куратор).
    if (ambushPossible(state) && Object.values(state.shownAtGathering ?? {}).some((x) => x.length)) state.phase = 'ambush';
    else startHiding(state);
  }
}


// Засада: в полном режиме с Конторой, пока Куратор не раскрылся (есть ли он на самом деле — не выдаём).
function ambushPossible(state: GameState): boolean {
  return isFull(state) && !state.reserve && !!state.curatorPossible && !state.curatorRevealed;
}

function startHiding(state: GameState) {
  state.phase = 'hiding';
  state.ready = [];
  logEvent(state, 'Укрытие');
  logNote(state, 'Прячьте опальные книги в Тайник (каждые 2 Нагрузки на складе дают +1 место).');
}

// Засада: Куратор раскрывается; на каждого, кто показал на Посиделках опальное, — Контора: Сигнал и Изъятие показанной
// книги (показанные книги в этот момент не считаются лежащими в Тайнике).
function doAmbush(state: GameState, p: PlayerState, go: boolean, picks: Record<string, string> = {}) {
  if (go) {
    check(p.passion === 'curator', 'Засаду может устроить только Куратор');
    check(state.players.some((o) => o.id !== p.id && (state.shownAtGathering?.[o.id] ?? []).some((c) => hasBook(o, c))),
      'Засаду не на кого устраивать: никто, кроме вас, не показывал опальное');
    state.curatorRevealed = p.id;
    logEvent(state, 'Засада!');
    log(state, `Куратор раскрывается: ${p.name}. На всех, кто показал на Посиделках опальное, — Контора.`);
    for (const o of state.players) {
      if (o.id === p.id) continue;
      const shown = (state.shownAtGathering?.[o.id] ?? []).filter((c) => hasBook(o, c));
      if (!shown.length) continue;
      // Книгу выбирает Куратор лично (не выбрал — самая «значкастая»).
      if (picks[o.id]) check(shown.includes(picks[o.id]), `У ${o.name} изымают только книгу, показанную на Посиделках`);
      const card = picks[o.id] ?? [...shown].sort((a, b) => iconCount(state, b) - iconCount(state, a))[0];
      holdWorker(state, o, `Засада: ${p.name}`);
      removeBook(o, card);
      toSpetskhranPublic(state, [card]);
      log(state, `Засада: у ${o.name} изъята в Спецхран ${title(state, card)}.`);
    }
    startHiding(state);
    return;
  }
  state.ready.push(p.id);
  if (state.ready.length === state.players.length) startHiding(state);
}

function doHiding(state: GameState, p: PlayerState, a: Extract<Action, { type: 'hiding' }>) {
  if (a.fillLoad) partorgFill(state, p);
  setHidden(state, p, a.hidden, a.memorize);
  state.ready.push(p.id);
  log(state, `${p.name} готов(а) к облаве.`);
  state.log[state.log.length - 1].who = p.id;
  if (state.ready.length === state.players.length) raid(state);
}

function memorize(state: GameState, p: PlayerState, card: string | null) {
  check(isFull(state) && genreOn('poetry'), 'Заучивать стихи можно только в полном режиме');
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
  for (const id of hidden) check(!isLoad(state, id), `${title(state, id)} — Нагрузка: её в Тайник не прячут`);
  if (memorize !== undefined) {
    if (memorize) {
      check(isFull(state) && genreOn('poetry'), 'Заучивать стихи можно только в полном режиме');
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
    state.log[state.log.length - 1].who = p.id;
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
  // Библиотекарь с Каталогизатором выбирает книги из сброса — Пятилетка сменится после решения.
  if (state.pending.some((x) => x.kind === 'catalogPick')) return;
  changeRound(state);
}

function changeRound(state: GameState) {
  if (state.round >= RULES.rounds) {
    state.phase = 'end';
    flushIrony(state);
    // Заголовок — жирно заглавными, до подсчёта: вскрытие Куратора и срезы Ростков идут уже под ним.
    log(state, 'КОНЕЦ ЗАСТОЯ');
    state.log[state.log.length - 1].strong = true;
    state.result = finalScoring(state);
    // Итог Гласности — отдельной строкой, и самой последней строкой победитель (с кружком игрока в клиенте).
    const r = state.result!;
    log(state, r.summary);
    const cur = state.players.find((x) => x.passion === 'curator');
    if (cur && r.summary.includes(cur.name)) state.log[state.log.length - 1].names = [cur.id];
    if (r.winners.length) {
      log(state, `Победа: ${r.winners.map((id) => player(state, id).name).join(', ')}${r.winTail ?? '.'}`);
      state.log[state.log.length - 1].winners = [...r.winners];
    }
    return;
  }
  // Новый порядок хода: сперва посетившие Красный уголок, затем остальные в прежнем порядке.
  state.order = [...state.nextOrder, ...state.order.filter((id) => !state.nextOrder.includes(id))];
  const safe = state.safehouseDeck.pop();
  if (safe) state.safehouses.push(safe); // в журнале — после строки о цензуре новой Пятилетки
  // Масштаб цензуры: прежний жетон и жетон на 1 больше — случайный из двух (в одиночной игре — всегда больший).
  const prevCensorship = state.censorship;
  const next = state.censorshipPool.find((t) => t === state.censorship + 1);
  if (next !== undefined) {
    const pick = state.solo ? next : random(state) < 0.5 ? state.censorship : next;
    if (pick === next) {
      state.censorshipPool = state.censorshipPool.filter((t) => t !== next).concat(state.censorship);
      state.censorship = next;
    }
  }
  state.round++;
  startRound(state, safe, prevCensorship);
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
    // Что было на виду и ушло в Тайник (его все видели), и что вышло из Тайника на склад (теперь видно всем).
    const wasHidden = new Set(p.warehouse.filter((w) => w.hidden).map((w) => w.card));
    setHidden(state, p, action.hidden);
    const nowHidden = new Set(p.warehouse.filter((w) => w.hidden).map((w) => w.card));
    const toCache = p.warehouse.filter((w) => w.hidden && !wasHidden.has(w.card)).map((w) => w.card);
    const fromCache = p.warehouse.filter((w) => !nowHidden.has(w.card) && wasHidden.has(w.card)).map((w) => w.card);
    log(state, `${p.name} перекладывает книги в Тайнике.`);
    if (toCache.length) log(state, `↳ В Тайник: ${titles(state, toCache)}.`);
    if (fromCache.length) log(state, `↳ Из Тайника на склад: ${titles(state, fromCache)}.`);
    state.holdTurn = true;
    return;
  }
  if (action.type === 'endTurn') {
    check(state.turnDone === p.id, 'Сначала сделайте действие (или спасуйте)');
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
      p.bonusGroupFrom = [];
      log(state, `${p.name} отказывается от дополнительных действий Группы.`);
      return;
    }
    check(action.type === 'group', 'Сейчас можно только действие Инициативной группы');
    // Отдельной строкой — откуда это действие: свои Единомышленники кончились, а явочный адрес дал ещё одно.
    const from = p.bonusGroupFrom?.shift();
    logEvent(state, `${p.name}: дополнительное действие${from ? ` за ${ADDRESSES[from].name}` : ''} — «${GROUP_ACTIONS[action.group.action].name}»`);
    state.log[state.log.length - 1].who = p.id;
    doGroup(state, p, action.group, { limited: true });
    track(p, `group:${action.group.action}`);
    p.bonusGroupTurns--;
    return;
  }
  if (action.type === 'pass') {
    // Добровольный пас — только после Красного уголка; до конца Пятилетки игрок больше не ходит.
    // С Врачом в Красный уголок можно не ходить — пасовать тоже можно.
    check(p.visitedRedCorner || hasPatron(state, p.id, 'doctor'), 'Спасовать можно только после того, как Единомышленник побывал в Красном уголке');
    // Номера пропущенных действий — по счёту поручений игрока в эту Пятилетку.
    const from = p.actions.length + 1;
    const to = p.actions.length + p.available;
    p.available = 0;
    p.bonusGroupTurns = 0;
    p.bonusGroupFrom = [];
    log(state, `${p.name} пасует до конца Пятилетки${to >= from ? ` (не сделаны действия: ${from === to ? from : `${from}–${to}`})` : ''}.`);
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
  // Блатной: купил здесь — можно ещё одну книгу в другом месте.
  if (a.address === 'razval' || a.address === 'raspredelitel' || (a.address === 'tolkuchka' && a.ops.some((op) => op.op === 'buy'))) offerBlatnoy(state, p, a.address);
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
      // Бесплатно, но за заход — одна пара.
      check(a.pairs === 1, 'В Госкниготорге за заход — одна пара книг');
      check(freeSlots(p) >= a.pairs * 2, 'На складе не хватит места');
      // Завмаг: состав каждой книги выбирается свободно.
      const mix = a.mix ?? [];
      if (mix.length) {
        check(hasPatron(state, p.id, 'zavmag'), 'Свободный выбор книг — только со связью с Завмагом');
        check(mix.length === a.pairs * 2, 'Укажите состав всех книг');
      }
      const kinds = mix.length ? mix : Array.from({ length: a.pairs }, () => ['load', 'unprinted'] as const).flat();
      takeTop(state, p, kinds[0], 1, { kind: 'gostorg', got: [], rest: kinds.slice(1) });
      return;
    }
    case 'tolkuchka': {
      check(a.ops.length > 0, 'Купите или продайте хотя бы одну книгу');
      const veteran = hasPatron(state, p.id, 'veteran');
      check(a.ops.filter((op) => op.op === 'buy').length <= 1 || veteran, 'Купить несколько книг за одно действие — только со связью с Ветераном');
      check(a.ops.filter((op) => op.op === 'sell').length <= 1 || veteran, 'Продать несколько книг за одно действие — только со связью с Ветераном');
      const sold: string[] = [];
      const parts: string[] = [];
      let income = 0;
      let bonus = 0; // Фарцовщик: +1 Талон за каждую проданную книгу
      const fartsovshchik = hasPatron(state, p.id, 'fartsovshchik');
      const buy = purchases(state, p);
      // Сначала продажи: вырученные Талоны (и освобождённое место) сразу идут на покупку в той же сделке.
      const ops = [...a.ops.filter((op) => op.op !== 'buy'), ...a.ops.filter((op) => op.op === 'buy')];
      for (const op of ops) {
        if (op.op === 'buy') {
          if (income || bonus) { earn(state, p, 0, { tolkuchka: income, fartsovshchik: bonus }); income = 0; bonus = 0; }
          check(state.tolkuchka.includes(op.card), 'Этой книги нет на Толкучке');
          const cost = buy(RULES.tolkuchkaBuy);
          state.tolkuchka = state.tolkuchka.filter((c) => c !== op.card);
          addBoughtBook(state, p, op.card);
          parts.push(`купил(а) ${title(state, op.card)} за ${talonsText(cost)}`);
        } else {
          check(hasBook(p, op.card), 'Продавать можно только книги со своего склада');
          check(!isEvidence(state, op.card), 'Улики нельзя продать — у них ноль подпольного спроса');
          check(!isPropaganda(state, op.card), 'ЧНЛ можно сбыть только в Красном уголке');
          check(isGenreBook(state, op.card), 'Книгу без жанра не продать');
          const demand = genresOf(state, op.card).some((g) => state.banned.includes(g));
          const gain = demand ? RULES.tolkuchkaSellBanned : RULES.tolkuchkaSellFree;
          removeBook(p, op.card);
          income += gain;
          if (fartsovshchik) bonus += RULES.fartsovshchikTalons;
          gaveAway(state, p, op.card);
          sold.push(op.card);
          parts.push(`продал(а) ${title(state, op.card)} за ${talonsText(gain)}`);
        }
      }
      // Проданное на Толкучке уходит в сброс, а не на прилавок.
      for (const c of sold) discard(state, c);
      log(state, `${p.name} на Толкучке: ${parts.join('; ')}.`);
      noteAutoHidden(state, p);
      if (fartsovshchik && sold.length) logAfter(state, `↳ Фарцовщик: +${talonsText(sold.length * RULES.fartsovshchikTalons)}.`);
      earn(state, p, 0, { tolkuchka: income, fartsovshchik: bonus });
      return;
    }
    case 'redCorner': {
      // Ретивость: рано и первым в очереди (выгоднее всего ходить первым Куратору).
      const used = p.workers - p.held - p.available;
      if (state.round < RULES.rounds && state.nextOrder.length === 0 && used <= 2) p.redEager = (p.redEager ?? 0) + 1;
      // Обязательная Нагрузка: нет места — отдать книгу Непечатных; склад весь в Нагрузке — не брать.
      const loadOnly = p.warehouse.every((s) => countsAsLoad(state, s.card));
      const take = freeSlots(p) > 0 || !loadOnly;
      // Завхоз сперва смотрит Нагрузку: отдавать книгу Непечатных — только если решит её оставить.
      const zavkhoz = hasPatron(state, p.id, 'zavkhoz');
      if (freeSlots(p) > 0 || !take || zavkhoz) {
        check(!a.drop, 'Отдавать книгу не нужно');
      } else {
        check(a.drop, 'Для Нагрузки нет места: выберите книгу Непечатных, которую отдать');
        check(hasBook(p, a.drop) && !countsAsLoad(state, a.drop), 'Отдать можно только книгу Непечатных со своего склада');
      }
      p.visitedRedCorner = true;
      state.nextOrder.push(p.id);
      log(state, `${p.name} в Красном уголке (${state.nextOrder.length}-й в очереди).`);
      const dropTitle = a.drop ? title(state, a.drop) : undefined; // до сброса (с монографией)
      if (a.drop) {
        if (isPropaganda(state, a.drop)) p.propagandaDumped = (p.propagandaDumped ?? 0) + 1;
        removeBook(p, a.drop);
        discard(state, a.drop);
        gaveAway(state, p, a.drop);
      }
      // Склад переполнен (лишнее отдают позже) — и после отдачи места может не хватить: тогда Нагрузку не берёт.
      const room = take && (freeSlots(p) > 0 || zavkhoz);
      if (!room) {
        logAfter(state, !take ? '↳ Склад полон Нагрузки — новую не берёт.' : `↳ Отдаёт ${title(state, a.drop!)}, но места для Нагрузки всё равно нет — не берёт.`);
        return;
      }
      takeTop(state, p, 'load', 1, { kind: 'redCorner', drop: a.drop, dropTitle });
      return;
    }
    case 'razval': {
      const slots = [...new Set(a.slots?.length ? a.slots : [a.slot])];
      check(slots.length === 1 || hasPatron(state, p.id, 'veteran'), 'Несколько книг за одно действие — только со связью с Ветераном');
      check(roomToBuy(state, p, slots.map((i) => state.razval[i]).filter((c): c is string => !!c)), 'На складе нет места');
      // Сборник, который можно заучить сверх склада, — последним: остальным достанутся свободные места.
      slots.sort((x, y) => Number(!!state.razval[x] && canMemorizeOnBuy(state, p, state.razval[x]!)) - Number(!!state.razval[y] && canMemorizeOnBuy(state, p, state.razval[y]!)));
      const buy = purchases(state, p);
      for (const slot of slots) {
        const c = state.razval[slot];
        check(c, 'Эта ячейка Развала пуста');
        const cost = buy(RULES.razvalPrices[slot]);
        addBoughtBook(state, p, c);
        state.razval[slot] = null;
        log(state, `${p.name} покупает на Развале ${title(state, c)} за ${talonsText(cost)}.`);
        noteAutoHidden(state, p);
      }
      return;
    }
    case 'zavoz': {
      earn(state, p, RULES.zavozIncome, 'zavoz');
      state.razval.forEach((c) => c && discard(state, c));
      state.razval = [null, null, null, null];
      fillRazval(state);
      log(state, `${p.name} подрабатывает развозом книг на точки: +${talonsText(RULES.zavozIncome)}, Развал обновлён.`);
      return;
    }
    case 'baraholka': {
      // Игрок тайно смотрит все книги Барахолки и может купить любую (с Ветераном — сколько угодно).
      const slots = state.baraholka.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
      check(slots.length > 0, 'На Барахолке не осталось книг');
      const seen = slots.map((slot) => ({ slot, card: state.baraholka[slot]! }));
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
      check(a.feeds.length > 0, 'Выберите, какие ступени питать');
      check(a.feeds.length <= RULES.sproutFeedsPerAction, RULES.sproutFeedsPerAction === 1
        ? 'За одно поручение можно питать только 1 ступень одного Ростка'
        : `За одно поручение — не больше ${RULES.sproutFeedsPerAction} ступеней`);
      const used = new Set<string>();
      let labtechUsed = false;
      for (const f of a.feeds) {
        const sp = state.sprouts.find((s) => s.id === f.sprout);
        check(sp, 'Этого Ростка нет в игре');
        const info = SPROUTS.find((s) => s.id === sp.id)!;
        check(sp.progress < 4, `${info.name}: все ступени уже напитаны`);
        // Росток растёт постепенно: у каждого его бонуса — одно место на Пятилетку.
        const slots = sproutSlotBonuses(state, info);
        const taken = (state.sproutRoundSlot ??= {})[sp.id] ?? [];
        const slot = f.slot ?? slots.findIndex((_, i) => !taken.includes(i));
        check(slot >= 0 || f.slot !== undefined, `${info.name}: в эту Пятилетку все места Ростка уже заняты — ждите следующей`);
        check(Number.isInteger(slot) && slot >= 0 && slot < slots.length, 'Нет такого бонуса у Ростка');
        const slotName = slots[slot] ? SPROUT_BONUS_NAMES[slots[slot]!] : 'без бонуса';
        check(!taken.includes(slot), `${info.name}: место «${slotName}» в эту Пятилетку уже занято — выберите другой бонус или ждите следующей`);
        state.sproutRoundSlot[sp.id] = [...taken, slot];
        state.sproutRound = { ...state.sproutRound, [sp.id]: [...(state.sproutRound?.[sp.id] ?? []), p.id] };
        // Поручение ещё не записано в p.actions (это делается после doPlace) — его номер следующий.
        (state.sproutRoundN ??= {})[sp.id] = [...(state.sproutRoundN[sp.id] ?? []), p.actions.length + 1];
        const step = info.steps[sp.progress];
        for (const b of f.books) {
          check(!used.has(b), 'Одна книга не может пойти дважды');
          check(hasBook(p, b), 'Отдавать можно только книги со своего склада');
          used.add(b);
        }
        const need = `${info.name}: нужно значков «${GENRE_NAMES[info.main]}»: ${step.main}` + (step.support ? ` и значок поддержки «${GENRE_NAMES[step.support]}»` : '');
        const lab = !coversStep(state, f.books, info.main, step.main, step.support, { wildScifi: isFull(state) });
        if (lab) {
          // Скидка Лаборанта (RULES.labtechDiscount) — один раз на всё поручение, а не на каждой ступени.
          check(hasPatron(state, p.id, 'labtech') && coversStep(state, f.books, info.main, step.main, step.support, { wildScifi: isFull(state), labtech: true }), need);
          check(!labtechUsed, 'Скидка Лаборанта — только один раз за поручение');
          labtechUsed = true;
        }
        // Названия — до сброса: в сброс книга уходит без монографии (её значок пропал бы из журнала).
        const fedTitles = titles(state, f.books);
        for (const b of f.books) { removeBook(p, b); discard(state, b); gaveAway(state, p, b); }
        const reward = STEP_REWARDS[sp.progress];
        sp.progress++;
        (p.fedSteps ??= []).push(sp.progress);
        earn(state, p, reward.talons, 'sprouts');
        gain(p, reward.points, 'sprouts');
        let text = `${p.name} питает ступень ${roman(sp.progress)} Ростка «${info.name}» (${fedTitles}${lab ? '; скидка Лаборанта' : ''})`;
        text += `, +${[reward.talons ? talonsText(reward.talons) : '', reward.points ? pointsText(reward.points) : ''].filter(Boolean).join(' и +')}`;
        // Кто вкладывался в Росток — запоминаем: по этому боты судят, кто не Куратор (на поле не показывается).
        if (!p.sproutsFed.includes(sp.id)) p.sproutsFed.push(sp.id);
        log(state, text + '.');
        // Профессор: каждый, кто с ним связан (кроме кормящего), получает Талон и очки за эту ступень.
        for (const o of state.players) {
          if (o.id === p.id || !hasPatron(state, o.id, 'professor')) continue;
          earn(state, o, RULES.professorTalons, 'professor');
          gain(o, RULES.professorPoints, 'professor');
          logAfter(state, `↳ Профессор: ${o.name} +${talonsText(RULES.professorTalons)} и +${pointsText(RULES.professorPoints)}.`);
        }
        // Фантастика «Заронить зерно»: без неё (её значков вместо других жанров) ступень не закрылась бы.
        if (isFull(state) && !coversStep(state, f.books, info.main, step.main, step.support, { labtech: lab })) {
          logAfter(state, '↳ [ФА] заронила зерно: значок засчитан за другой жанр.');
        }
        const bonus = slots[slot];
        const options = bonus && (bonus !== 'acquaintance' || befriendTargets(state, p.id).length > 0) ? [bonus] : [];
        if (options.length) state.pending.push({ kind: 'sproutBonus', player: p.id, sprout: sp.id, options });
        else logAfter(state, bonus ? `↳ ${SPROUT_BONUS_NAMES[bonus]}: знакомиться не с кем.` : '↳ Бонуса у этого места нет.');
      }
      return;
    }
    case 'samizdat':
    case 'tamizdat': {
      check(hasBook(p, a.card), 'Издавать можно только книги со своего склада');
      check(!isPropaganda(state, a.card), 'ЧНЛ нельзя издать');
      // Разоблачение издают как книгу с одним значком (без жанра).
      const icons = iconCount(state, a.card) + (isExposed(state, a.card) ? 1 : 0);
      if (a.address === 'samizdat') {
        check(icons > 0 && !isEvidence(state, a.card), 'Через Самиздат можно издать только книгу с жанровым значком');
      } else {
        check(icons > 0 || isEvidence(state, a.card), 'Через Тамиздат можно издать книгу с жанровым значком или Улику');
      }
      removeBook(p, a.card);
      p.published.push(a.card);
      const genres = iconsOf(state, a.card);
      // Самиздат — очки за значок, Тамиздат — Талоны и очки за значок.
      const talons = a.address === 'tamizdat' ? icons * RULES.tamizdatTalons : 0;
      const corr = hasPatron(state, p.id, 'correspondent') ? RULES.correspondentTalons : 0;
      let pts = 0;
      const add = (n: number, src: Parameters<typeof gain>[2]) => { gain(p, n, src); pts += n; };
      // Бонус жанра — отдельной строкой после строки об издании.
      let genreBonus = '';
      if (a.address === 'tamizdat') {
        p.tamizdat.push(a.card);
        add(icons * RULES.tamizdatPoints, 'tamizdat');
        if (isFull(state) && genreOn('testimony') && genres.includes('testimony')) { // «Придать огласке»
          gain(p, RULES.testimonyPoints, 'testimony');
          genreBonus = `↳ [СВ] преданы огласке: +${pointsText(RULES.testimonyPoints)}.`;
        }
      } else {
        add(icons * RULES.samizdatPoints, 'samizdat');
        if (isFull(state) && genreOn('foreign') && genres.includes('foreign')) { // «Перевести»
          gain(p, RULES.foreignPoints, 'foreign');
          genreBonus = `↳ [ИН] переведена: +${pointsText(RULES.foreignPoints)}.`;
        }
      }
      if (corr) gain(p, RULES.correspondentPoints, 'correspondent');
      gaveAway(state, p, a.card);
      const gains = [talons ? `+${talonsText(talons)}` : '', pts ? `+${pointsText(pts)}` : ''].filter(Boolean).join(', ');
      log(state, `${p.name} издаёт ${title(state, a.card)} через ${name}${gains ? `: ${gains}` : ''}.`);
      if (genreBonus) logAfter(state, genreBonus);
      if (corr) logAfter(state, `↳ Корреспондент: +${talonsText(corr)} и +${pointsText(RULES.correspondentPoints)}.`);
      earn(state, p, 0, { [a.address]: talons, correspondent: corr });
      return;
    }
    case 'glavlit': {
      const recycle = [...new Set(a.recycle)];
      check(recycle.length > 0 && recycle.length === a.recycle.length, 'Выберите книги, которые сдать');
      const unprinted = recycle.filter((c) => !countsAsLoad(state, c));
      const load = recycle.filter((c) => countsAsLoad(state, c));
      const komsorg = hasPatron(state, p.id, 'komsorg');
      check((unprinted.length <= 1 && load.length <= 1) || komsorg, 'Сдать можно до 1 Непечатной и до 1 книги Нагрузки');
      const editor = hasPatron(state, p.id, 'editor');
      let income = 0;
      let pts = 0;
      p.propagandaDumped = (p.propagandaDumped ?? 0) + recycle.filter((c) => isPropaganda(state, c)).length;
      const recycledTitles = titles(state, recycle); // до сброса (с монографией)
      for (const c of recycle) {
        check(hasBook(p, c), 'Сдать можно только книги со своего склада');
        income += countsAsLoad(state, c) ? RULES.glavlitLoad : RULES.glavlitUnprinted;
        if (editor) pts += iconCount(state, c); // значков у сданных книг
        removeBook(p, c);
        discard(state, c);
        gaveAway(state, p, c);
      }
      log(state, `${p.name} сдаёт в Главлит: ${recycledTitles}.`);
      earn(state, p, 0, { glavlit: income, editor: pts * RULES.editorTalons });
      // Комсорг: за каждую сданную книгу — очко Гласности.
      if (komsorg) {
        gain(p, RULES.komsorgPoints * recycle.length, 'komsorg');
        logAfter(state, `↳ Комсорг: +${pointsText(RULES.komsorgPoints * recycle.length)}.`);
      }
      if (pts) {
        gain(p, pts * RULES.editorPoints, 'editor');
        logAfter(state, `↳ Главред: +${talonsText(pts * RULES.editorTalons)} и +${pointsText(pts * RULES.editorPoints)}.`);
      }
      return;
    }
    case 'knigoobmen': {
      check(hasBook(p, a.give) && isGenreBook(state, a.give), 'Отдать нужно жанровую книгу со своего склада');
      check(state.knigoobmen.includes(a.take), 'Этой книги нет на витрине Книгообмена');
      const givenTitle = title(state, a.give); // до сброса (с монографией)
      removeBook(p, a.give);
      addOpenBook(state, p, a.take);
      // Отданная книга уходит в сброс, а не на витрину.
      state.knigoobmen = state.knigoobmen.filter((c) => c !== a.take);
      discard(state, a.give);
      gaveAway(state, p, a.give);
      p.bonusGroupTurns++;
      (p.bonusGroupFrom ??= []).push('knigoobmen');
      log(state, `${p.name} на Книгообмене: отдаёт ${givenTitle}, берёт ${title(state, a.take)}.`);
      noteAutoHidden(state, p);
      return;
    }
    case 'kvartirnik': {
      check(a.to !== p.id, 'Обмен — с другим игроком');
      const other = player(state, a.to);
      check(hasBook(p, a.give), 'Отдать можно только книгу со своего склада');
      const slot = other.warehouse.find((s) => s.card === a.want);
      check(slot && !slot.hidden, 'Просить можно только книгу, открыто лежащую у другого игрока');
      p.bonusGroupTurns++;
      (p.bonusGroupFrom ??= []).push('kvartirnik');
      state.pending.push({ kind: 'kvartirnikReply', player: other.id, from: p.id, give: a.give, want: a.want });
      log(state, `${p.name} на Квартирнике предлагает ${other.name} обмен: ${title(state, a.give)} на ${title(state, a.want)}.`);
      return;
    }
    case 'raspredelitel': {
      const cards = [...new Set(a.cards?.length ? a.cards : [a.card])];
      check(cards.length === 1 || hasPatron(state, p.id, 'veteran'), 'Несколько книг за одно действие — только со связью с Ветераном');
      for (const card of cards) check(state.raspredelitel.includes(card), 'Этой книги нет в Распределителе');
      check(roomToBuy(state, p, cards), 'На складе нет места');
      cards.sort((x, y) => Number(canMemorizeOnBuy(state, p, x)) - Number(canMemorizeOnBuy(state, p, y)));
      const buy = purchases(state, p);
      for (const card of cards) {
        buy(RULES.raspredelitelPrice);
        addBoughtBook(state, p, card);
        state.raspredelitel = state.raspredelitel.filter((c) => c !== card);
        log(state, `${p.name} получает из Распределителя ${title(state, card)}.`);
        noteAutoHidden(state, p);
      }
      return;
    }
    case 'agitpunkt': {
      const cards = [...new Set(a.cards?.length ? a.cards : [a.card])];
      check(cards.length === 1 || hasPatron(state, p.id, 'veteran'), 'Несколько книг за одно действие — только со связью с Ветераном');
      for (const card of cards) {
        check((state.agitpunkt ?? []).includes(card), 'Этой книги нет на Агитпункте');
        addOpenBook(state, p, card);
        state.agitpunkt = (state.agitpunkt ?? []).filter((c) => c !== card);
        log(state, `${p.name} берёт на Агитпункте ${title(state, card)}.`);
        noteAutoHidden(state, p);
      }
      // Как Книгообмен и Квартирник: отсюда Единомышленник в конце поручений идёт ещё и в Инициативную группу.
      p.bonusGroupTurns++;
      (p.bonusGroupFrom ??= []).push('agitpunkt');
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
      check(state.deck.length + state.discard.length > 0, 'Стопка Непечатных пуста');
      log(state, `${p.name} занимается Посредничеством авторам.`);
      takeTop(state, p, 'unprinted', RULES.posrednichestvoDraw, { kind: 'posrednichestvo' });
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
    case 'makulatura': {
      // Платить можно Талоном или любой книгой со склада (она же освобождает место).
      check(p.talons >= RULES.makulaturaPrice || p.warehouse.length > 0, `Нужен хотя бы ${RULES.makulaturaPrice} Талон или книга на складе`);
      check(freeSlots(p) > 0 || p.warehouse.length > 0, 'На складе нет места');
      state.pending.push({ kind: 'makulatura', player: p.id, cards: [] });
      log(state, `${p.name} роется в Макулатуре.`);
      return;
    }
    case 'spisanie': {
      check(freeSlots(p) > 0, 'На складе нет места');
      payPrice(state, p, RULES.spisaniePrice);
      check(state.deck.length + state.discard.length > 0, 'Стопка Непечатных пуста');
      log(state, `${p.name} разбирает Библиотечное списание.`);
      takeTop(state, p, 'unprinted', RULES.spisanieDraw, { kind: 'spisanie' });
      return;
    }
  }
}

// Взять n книг сверху стопки и продолжить действие. Каталогизатор: тайно смотрит ещё n книг снизу и выбирает набор.
function takeTop(state: GameState, p: PlayerState, deck: 'unprinted' | 'load', n: number, then: CatalogThen) {
  const pile = deck === 'load' ? state.loadDeck : state.deck;
  // Книг меньше, чем на два набора, — наборы частично совпадают; меньше, чем на один, — берут как обычно (с перетасовкой сброса).
  if (hasPatron(state, p.id, 'cataloguer') && pile.length >= n) {
    // Верх стопки — её конец: книги берут с конца (pop).
    state.pending.unshift({ kind: 'catalogPick', player: p.id, deck, top: pile.slice(-n).reverse(), bottom: pile.slice(0, n), then });
    return;
  }
  const cards = Array.from({ length: n }, () => (deck === 'load' ? drawLoad(state) : draw(state))).filter((c): c is string => !!c);
  continueTake(state, p, cards, then);
}

// Продолжение действия с взятыми книгами.
function continueTake(state: GameState, p: PlayerState, cards: string[], then: CatalogThen) {
  switch (then.kind) {
    case 'posrednichestvo':
      check(cards.length > 0, 'Стопка Непечатных пуста');
      state.pending.push({ kind: 'posrednichestvoKeep', player: p.id, cards });
      return;
    case 'spisanie':
      check(cards.length > 0, 'Стопка Непечатных пуста');
      state.pending.push({ kind: 'spisanieKeep', player: p.id, cards });
      return;
    case 'makulatura': {
      const m = state.pending.find((x) => x.kind === 'makulatura' && x.player === p.id) as Extract<Pending, { kind: 'makulatura' }> | undefined;
      check(m && cards.length > 0, 'Стопка пуста');
      m.cards.push(...cards);
      log(state, `Вытянута ${title(state, cards[0])}.`, [p.id]);
      return;
    }
    case 'gostorg': {
      const got = [...then.got, ...cards];
      if (then.rest.length) { takeTop(state, p, then.rest[0], 1, { kind: 'gostorg', got, rest: then.rest.slice(1) }); return; }
      // Как при выуживании из Спецхрана: сперва что сделано, потом по строке на каждую книгу —
      // открытая ложится на склад при всех, спрятанную в Тайник соперники не видят («Получена: …» — только себе).
      log(state, `${p.name} берёт в Госкниготорге даром ${plural(got.length, 'книгу', 'книги', 'книг')}.`);
      for (const c of got) addSecretBook(state, p, c, null);
      // Открытые — по строке на книгу; спрятанные — одной строкой с общим числом (какие — только себе).
      const hiddenGot = got.filter((c) => p.warehouse.find((x) => x.card === c)?.hidden);
      for (const c of got) if (!hiddenGot.includes(c)) log(state, `↳ ${title(state, c)}.`);
      if (hiddenGot.length) {
        log(state, `↳ Взакрытую в Тайник: ${plural(hiddenGot.length, 'непечатный текст', 'непечатных текста', 'непечатных текстов')}.`);
        log(state, `${hiddenGot.length > 1 ? 'Получены' : 'Получена'}: ${titles(state, hiddenGot)}.`, [p.id]);
      }
      return;
    }
    case 'librarian': {
      for (const c of cards) addSecretBook(state, p, c, null);
      log(state, `${p.name}: Библиотекарь приносит из сброса ${plural(cards.length, 'непечатный текст', 'непечатных текста', 'непечатных текстов')}.`);
      state.log[state.log.length - 1].who = p.id;
      logCached(state, p, cards);
      return;
    }
    case 'redCorner': {
      const load = cards[0];
      // Завхоз: посмотрев Нагрузку, можно вместо неё взять Талон; книга пока не на складе.
      if (load && hasPatron(state, p.id, 'zavkhoz')) {
        state.pending.push({ kind: 'zavkhozLoad', player: p.id, card: load });
        logAfter(state, '↳ Завхоз смотрит полученную Нагрузку.');
        return;
      }
      if (load) addBook(p, load);
      logAfter(state, load ? `↳ ${title(state, load)}${then.drop ? `; места нет — отдаёт ${then.dropTitle ?? title(state, then.drop)}` : ''}.` : '↳ Нагрузка кончилась.');
      return;
    }
  }
}

// ---------- Действия Инициативной группы ----------

// Тиражирование: взять книгу даром с адреса (Машинистка — Талоны; при обычном Тиражировании они начисляются ниже).
function takeCopy(state: GameState, p: PlayerState, addr: CopyTextAddress, c: string) {
  const name = ADDRESSES[addr].name;
  if (addr === 'razval') {
    check(state.razval.includes(c), `Этой книги нет: ${name}`);
    state.razval = state.razval.map((x) => (x === c ? null : x));
  } else {
    const shelf = state[addr] ?? [];
    check(shelf.includes(c), `Этой книги нет: ${name}`);
    state[addr] = shelf.filter((x) => x !== c);
  }
  addOpenBook(state, p, c);
  log(state, `${p.name} тиражирует ${title(state, c)} (${name}).`);
  noteAutoHidden(state, p);
  typistBonus(state, p);
}

function typistBonus(state: GameState, p: PlayerState) {
  if (!hasPatron(state, p.id, 'typist')) return;
  logAfter(state, `↳ Машинистка: +${talonsText(RULES.typistTalons)}.`);
  earn(state, p, RULES.typistTalons, 'typist');
}

// worker — действие делает Единомышленник из Группы (он занимает место на адресе, куда идёт тиражировать).
function doGroup(state: GameState, p: PlayerState, g: GroupAction, opts: { limited: boolean; worker?: boolean }) {
  const info = GROUP_ACTIONS[g.action];
  check(info, 'Нет такого действия');
  if (opts.limited) check(!p.groupUsed.includes(g.action), `«${info.name}» уже сделано в эту Пятилетку`);
  check(groupInGame(state, g.action), `«${info.name}» в этой партии нет`);
  switch (g.action) {
    case 'expandWarehouse':
      check(p.capacity < RULES.maxCapacity, 'Склад уже максимального размера');
      payPrice(state, p, RULES.expandWarehouseCost);
      p.capacity++;
      log(state, `${p.name}: склад увеличен до ${p.capacity}.`);
      break;
    case 'expandCache':
      check(p.cache < RULES.maxCache, 'Тайник уже максимального размера');
      // Столяр: Закладка Тайника бесплатна.
      if (!hasPatron(state, p.id, 'carpenter')) payPrice(state, p, RULES.expandCacheCost);
      // Столяр: Тайник растёт сразу на несколько мест.
      p.cache = Math.min(RULES.maxCache, p.cache + (hasPatron(state, p.id, 'carpenter') ? RULES.carpenterCache : 1));
      log(state, `${p.name}: Тайник увеличен до ${p.cache}.`);
      break;
    case 'copyText': {
      // Бесплатно — открытую книгу с адреса, где уже стоит свой Единомышленник (Машинистке — с любого).
      const addr = g.address;
      check((COPY_TEXT_ADDRESSES as readonly string[]).includes(addr), 'Тиражировать можно на Развале, Толкучке, в Распределителе, на Книгообмене или Агитпункте');
      check(addressInGame(state, addr) || state.safehouses.includes(addr), `${ADDRESSES[addr].name}: этого адреса нет на столе`);
      check(hasPatron(state, p.id, 'typist') || (state.occupancy[addr] ?? []).includes(p.id), `Тиражировать можно только там, где уже стоит ваш Единомышленник: ${ADDRESSES[addr].name}`);
      check(freeSlots(p) > 0, 'На складе нет места');
      takeCopy(state, p, addr, g.card);
      break;
    }
    case 'restore': {
      const slot = p.warehouse.find((s) => s.card === g.card);
      check(slot, 'Монографию можно написать только о книге со своего склада');
      const c = state.cards[g.card];
      check(!state.restored[g.card], 'Об этой книге монография уже написана');
      check(c.kind === 'genre' || c.kind === 'loadReturnable' || c.kind === 'loadEvidence' || (isPropagandaKind(c.kind) && RULES.exposePropaganda),
        RULES.exposePropaganda
          ? 'Смыслы можно вернуть только жанровой книге, возвращаемой Нагрузке, Нагрузке-улике или ЧНЛ'
          : 'Смыслы можно вернуть только жанровой книге, возвращаемой Нагрузке или Нагрузке-улике');
      state.restored[g.card] = true;
      if (isPropagandaKind(c.kind)) {
        p.propagandaExposed = (p.propagandaExposed ?? 0) + 1;
        log(state, `${p.name} пишет монографию: ${title(state, g.card)} становится Разоблачением (+${pointsText(RULES.exposePoints)} в конце).`);
      } else if (c.kind === 'loadEvidence') {
        log(state, `${p.name} пишет монографию: ${title(state, g.card)} становится Уликой.`);
      } else if (c.kind === 'loadReturnable') {
        log(state, `${p.name} пишет монографию: «${c.title}» становится ${title(state, g.card)}.`);
      } else {
        log(state, `${p.name} пишет монографию о книге ${title(state, g.card)}: +1 значок${c.wild ? ' любого жанра' : ''}.`);
      }
      payPrice(state, p, RULES.restoreCost);
      if (hasPatron(state, p.id, 'postgrad')) {
        gain(p, 2, 'postgrad');
        logAfter(state, '↳ Архивист: +2 очка Гласности.');
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
    case 'spetskhran': {
      // Возвращение из Спецхрана: игрок смотрит Спецхран и выбирает книгу следом.
      check(state.spetskhran.length > 0, 'Спецхран пуст');
      check(freeSlots(p) > 0, 'На складе нет места');
      payPrice(state, p, RULES.spetskhranCost);
      state.pending.push({ kind: 'kontoraHandout', player: p.id, cards: [...state.spetskhran], group: true });
      seeSpetskhran(state, p.id, state.spetskhran);
      break;
    }
  }
  if (opts.limited) p.groupUsed.push(g.action);
}

// ---------- Отложенные решения ----------

// После строки «берёт / оставляет себе…»: книги на виду — с названиями при всех; спрятанные в Тайник — одной строкой
// «берёт N 📃 взакрытую и кладёт в 🔒», а какие — только себе.
function logTaken(state: GameState, p: PlayerState, cards: string[]) {
  const hidden = cards.filter((c) => p.warehouse.find((w) => w.card === c)?.hidden);
  const open = cards.filter((c) => !hidden.includes(c));
  if (open.length) log(state, `↳ ${open.length > 1 ? 'Оставлены' : 'Оставлена'} на виду: ${titles(state, open)}.`);
  if (hidden.length) {
    log(state, `↳ ${p.name} берёт ${hidden.length === 1 ? 'непечатный текст' : plural(hidden.length, 'непечатный текст', 'непечатных текста', 'непечатных текстов')} взакрытую и кладёт в Тайник.`);
    logRecap(state, `${hidden.length > 1 ? 'Получены' : 'Получена'}: ${titles(state, hidden)}.`, [p.id]);
  }
}

// После строки «оставляет себе…» — сколько из этих книг легло в Тайник (их видел только он — «взакрытую»).
function logCached(state: GameState, p: PlayerState, cards: string[]) {
  const n = cards.filter((c) => p.warehouse.find((w) => w.card === c)?.hidden).length;
  if (n) log(state, `↳ Взакрытую в Тайник: ${plural(n, 'непечатный текст', 'непечатных текста', 'непечатных текстов')}.`);
}

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
        // Ветеран: всё действие на 1 Талон дешевле (как на Развале) — первая книга за 1 Талон выходит даром.
        let cost = bought === 0 ? price(state, p, RULES.baraholkaPrice) : RULES.baraholkaPrice;
        if (veteran && bought === 0 && cost > 0) { cost--; saved(p, 'veteran', 1); }
        pay(p, cost);
        state.baraholka[slot] = null;
        for (const id of Object.keys(state.baraholkaSeen ?? {})) state.baraholkaSeen![id] = state.baraholkaSeen![id].filter((x) => x !== slot);
        pend.seen.splice(i, 1);
        pend.bought = bought + 1;
        log(state, `${p.name} покупает непечатный текст на Барахолке.`);
        log(state, `Куплена: ${title(state, card)}.`, [p.id]);
        addBoughtBook(state, p, card, true);
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
      // «Больше ничего не берёт» после покупок — лишнее; «ничего не берёт» — если не купил ни одной.
      if (action.slot === undefined && !bought) log(state, `${p.name} ничего не берёт на Барахолке.`);
      if ((pend.bought ?? 0) > 0) offerBlatnoy(state, p, 'baraholka');
      break;
    }
    case 'kvartirnikReply': {
      check(action.type === 'kvartirnikReply', 'Ответьте на предложение обмена');
      const from = player(state, pend.from);
      if (action.accept && hasBook(from, pend.give) && hasBook(p, pend.want)) {
        removeBook(from, pend.give);
        removeBook(p, pend.want);
        // Ушла со склада — Монография не переходит к новому владельцу.
        delete state.restored[pend.give];
        delete state.restored[pend.want];
        addBook(from, pend.want);
        addBook(p, pend.give);
        gaveAway(state, from, pend.give);
        gaveAway(state, p, pend.want);
        log(state, `${p.name} соглашается на обмен с ${from.name}.`);
        autoHide(state, from, pend.want);
        noteAutoHidden(state, from);
        autoHide(state, p, pend.give);
        noteAutoHidden(state, p);
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
        addSecretBook(state, p, c, null);
      }
      state.deck = shuffle(state, [...state.deck, ...state.discard]);
      state.discard = [];
      log(state, `${p.name} берёт у Наследников ${plural(action.cards.length, 'непечатный текст', 'непечатных текста', 'непечатных текстов')}; сброс замешан в стопку.`);
      logTaken(state, p, action.cards);
      offerBlatnoy(state, p, 'nasledniki');
      break;
    }
    case 'posrednichestvoKeep': {
      check(action.type === 'posrednichestvoKeep', 'Выберите, что оставить');
      // Оставить можно от 0 до положенного числа книг (автор: можно не брать ни одной).
      const need = Math.min(RULES.posrednichestvoKeep, pend.cards.length);
      check(action.keep.length <= need && new Set(action.keep).size === action.keep.length, `Оставить можно не больше ${need}`);
      check(action.keep.length <= freeSlots(p), 'На складе не хватит места');
      for (const c of action.keep) check(pend.cards.includes(c), 'Эта книга не из вытянутых');
      for (const c of pend.cards) {
        if (action.keep.includes(c)) addSecretBook(state, p, c, null);
        else discard(state, c);
      }
      log(state, action.keep.length ? `${p.name} оставляет себе ${plural(action.keep.length, 'непечатный текст', 'непечатных текста', 'непечатных текстов')}.` : `${p.name} ничего не оставляет себе.`);
      logTaken(state, p, action.keep);
      state.pending.shift();
      state.pending.unshift({ kind: 'posrednichestvoGroup', player: p.id });
      if (action.keep.length) offerBlatnoy(state, p, 'posrednichestvo');
      return;
    }
    case 'makulatura': {
      if (action.type === 'makulaturaDraw') {
        const from = action.deck === 'load' ? 'Нагрузки' : 'Непечатных';
        const payTitle = action.pay ? title(state, action.pay) : ''; // до сброса (с монографией)
        if (action.pay) {
          check(hasBook(p, action.pay), 'Платить можно только книгой со своего склада');
          check((action.deck === 'load' ? state.loadDeck.length + state.loadDiscard.length : state.deck.length + state.discard.length) > 0, `Стопка ${from} пуста`);
          if (isPropaganda(state, action.pay)) p.propagandaDumped = (p.propagandaDumped ?? 0) + 1;
          removeBook(p, action.pay);
          discard(state, action.pay);
          gaveAway(state, p, action.pay);
        } else {
          payPrice(state, p, RULES.makulaturaPrice);
        }
        check(action.deck === 'load' ? state.loadDeck.length + state.loadDiscard.length > 0 : state.deck.length + state.discard.length > 0, `Стопка ${from} пуста`);
        log(state, `${p.name} тянет ${action.deck === 'load' ? 'книгу из стопки Нагрузки' : 'непечатный текст'} (${action.pay ? `отдаёт ${payTitle}` : `−${talonsText(RULES.makulaturaPrice)}`}).`);
        takeTop(state, p, action.deck, 1, { kind: 'makulatura' });
        return;
      }
      check(action.type === 'makulaturaKeep', 'Тяните ещё книгу или оставьте себе одну из вытянутых');
      check(pend.cards.includes(action.card), 'Эта книга не из вытянутых');
      check(freeSlots(p) > 0, 'На складе нет места: отдайте книгу, вытягивая следующую');
      for (const c of pend.cards) if (c !== action.card) discard(state, c);
      // По порядку: что оставил и что спрятал в Тайник (её видел только он — «взакрытую»), затем тайно — какую.
      addSecretBook(state, p, action.card, null);
      log(state, `${p.name} оставляет себе одну книгу из Макулатуры (вытянуто: ${pend.cards.length}).`);
      logTaken(state, p, [action.card]);
      break;
    }
    case 'spisanieKeep': {
      check(action.type === 'spisanieKeep', 'Выберите, что оставить из Библиотечного списания');
      check(new Set(action.keep).size === action.keep.length, 'Книга указана дважды');
      check(action.keep.length <= freeSlots(p), 'На складе не хватит места');
      for (const c of action.keep) check(pend.cards.includes(c), 'Эта книга не из взятых');
      for (const c of pend.cards) {
        if (action.keep.includes(c)) addSecretBook(state, p, c, null);
        else discard(state, c);
      }
      log(state, `${p.name} оставляет себе из Библиотечного списания ${plural(action.keep.length, 'непечатный текст', 'непечатных текста', 'непечатных текстов')}.`);
      logTaken(state, p, action.keep);
      if (action.keep.length) offerBlatnoy(state, p, 'spisanie');
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
      if (action.bonus === 'acquaintance') {
        check(action.patron, 'Выберите Завсегдатая');
        befriendPatron(state, p, action.patron);
      } else if (action.bonus === 'sideJob') {
        logAfter(state, `↳ Приработок: +${talonsText(RULES.sideJobIncome)}.`);
        earn(state, p, RULES.sideJobIncome, 'sideJob');
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
      log(state, `${p.name} (Главлитовец): опала снята с жанра ${genreLabel(action.from)} и наложена на ${genreLabel(action.to)}.`);
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
        state.log[state.log.length - 1].who = p.id;
        noteAutoHidden(state, p);
      }
      state.pending.shift();
      if (!state.pending.length) {
        finishRound(state);
        state.holdTurn = true; // новый раунд уже начался — ход не сдвигаем
      }
      return;
    }
    case 'zavkhozLoad': {
      check(action.type === 'zavkhozLoad', 'Решите, оставить ли Нагрузку (Завхоз)');
      if (!action.keep) {
        const t = title(state, pend.card);
        discard(state, pend.card);
        earn(state, p, RULES.zavkhozTalons, 'zavkhoz');
        log(state, `${p.name} (Завхоз) сбывает Нагрузку: +${talonsText(RULES.zavkhozTalons)}.`);
        log(state, `В сброс: ${t}.`, [p.id]);
        break;
      }
      // Оставить: места нет — отдать книгу Непечатных (только теперь).
      if (freeSlots(p) > 0) {
        check(!action.drop, 'Отдавать книгу не нужно');
      } else {
        check(action.drop, 'Для Нагрузки нет места: выберите книгу Непечатных, которую отдать');
        check(hasBook(p, action.drop) && !countsAsLoad(state, action.drop), 'Отдать можно только книгу Непечатных со своего склада');
        const dropTitle = title(state, action.drop);
        if (isPropaganda(state, action.drop)) p.propagandaDumped = (p.propagandaDumped ?? 0) + 1;
        removeBook(p, action.drop);
        discard(state, action.drop);
        gaveAway(state, p, action.drop);
        check(freeSlots(p) > 0, 'Места для Нагрузки всё равно нет');
        log(state, `${p.name} отдаёт ${dropTitle} — место для Нагрузки.`);
      }
      addBook(p, pend.card);
      log(state, `${p.name} оставляет Нагрузку.`);
      log(state, `Оставлена: ${title(state, pend.card)}.`, [p.id]);
      break;
    }
    case 'doctorLoad': {
      check(action.type === 'doctorLoad', 'Выберите книгу Непечатных, которую отдать ради Нагрузки');
      check(hasBook(p, action.drop) && !countsAsLoad(state, action.drop), 'Отдать можно только книгу Непечатных со своего склада');
      const dropTitle = title(state, action.drop);
      if (isPropaganda(state, action.drop)) p.propagandaDumped = (p.propagandaDumped ?? 0) + 1;
      removeBook(p, action.drop);
      discard(state, action.drop);
      gaveAway(state, p, action.drop);
      log(state, `${p.name} (Врач) отдаёт ${dropTitle} — место для Нагрузки.`);
      state.log[state.log.length - 1].who = p.id;
      if (freeSlots(p) > 0) doctorLoad(state, p);
      break;
    }
    case 'discardExcess': {
      check(action.type === 'discardExcess', 'Выберите, какие книги отдать');
      check(action.cards.length === pend.count && new Set(action.cards).size === pend.count, `Нужно отдать книг: ${pend.count}`);
      // Заученный сборник места на складе не занимает — его отдача склад не освобождает.
      for (const c of action.cards) check(p.warehouse.some((s) => s.card === c && !s.memorized), 'Отдать можно только книги, лежащие на складе (не заученные)');
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
      // Отказаться можно, когда книги из списка уже забрали (другой игрок успел раньше) и от действия Группы.
      const left = pend.cards.filter((c) => state.spetskhran.includes(c));
      if (action.type === 'pass') {
        check(!!pend.group || !left.length, 'Выберите книгу из Спецхрана');
        log(state, `${p.name}: ${left.length ? 'передумывает брать книгу' : 'книгу уже забрали'} из Спецхрана.`);
        if (pend.seize) seizeDenounced(state, pend.seize);
        break;
      }
      check(action.type === 'kontoraHandout', 'Выберите книгу из Спецхрана');
      takeFromSpetskhran(state, p, action.card, !!pend.group);
      if (pend.seize) seizeDenounced(state, pend.seize);
      break;
    }
    case 'extraGroup': {
      if (action.type === 'pass') break;
      check(action.type === 'group', 'Выберите действие Группы или откажитесь');
      // Подмастерье повторяет одно из действий Группы, уже сделанных в эту Пятилетку.
      check(p.groupUsed.includes(action.group.action), 'Подмастерье повторяет только действие Группы, уже сделанное в эту Пятилетку');
      // Сперва — что повторяет Подмастерье, потом последствия.
      logEvent(state, `${p.name}: дополнительное действие за Подмастерья — «${GROUP_ACTIONS[action.group.action].name}»`);
      state.log[state.log.length - 1].who = p.id;
      doGroup(state, p, action.group, { limited: false });
      break;
    }
    case 'catalogPick': {
      check(action.type === 'catalogPick', 'Выберите, какие книги взять: сверху или снизу стопки');
      state.pending.shift();
      // Наборы запомнены, когда решение возникло; с тех пор кто-то мог забрать книгу из той же стопки
      // (другой Библиотекарь после той же облавы) — берём только то, что в ней ещё лежит.
      const pile = pend.deck === 'load' ? state.loadDeck : pend.deck === 'discard' ? state.discard : state.deck;
      const cards = (action.from === 'bottom' ? pend.bottom : pend.top).filter((c) => pile.includes(c));
      // Взятые — из стопки (где бы они ни лежали); невыбранные остаются на своих местах.
      if (pend.deck === 'load') state.loadDeck = state.loadDeck.filter((c) => !cards.includes(c));
      else if (pend.deck === 'discard') state.discard = state.discard.filter((c) => !cards.includes(c));
      else state.deck = state.deck.filter((c) => !cards.includes(c));
      if (action.from === 'bottom') log(state, `${p.name} берёт книги снизу ${pend.deck === 'discard' ? 'сброса' : 'стопки'} (Каталогизатор).`);
      continueTake(state, p, cards, pend.then);
      // Конец Пятилетки ждал этого решения (Библиотекарь) — теперь новая Пятилетка.
      if (pend.then.kind === 'librarian' && !state.pending.length) {
        changeRound(state);
        state.holdTurn = true;
      }
      return;
    }
    case 'blatnoyBuy': {
      if (action.type === 'pass') break;
      check(action.type === 'blatnoyBuy', 'Купите книгу или откажитесь');
      doBlatnoy(state, p, pend.from, action.address, action.card);
      break;
    }
    case 'startConnection': {
      // Стартовая связь: бесплатно, без книги, с любым Завсегдатаем, с которым в эту Пятилетку ещё никто не связался.
      // Связь обязательна; отказаться можно, только если свободных Завсегдатаев не осталось.
      const targets = startConnectionTargets(state, p.id);
      check(action.type === 'befriend' || (action.type === 'pass' && !targets.length), 'Выберите Завсегдатая: стартовая связь обязательна');
      state.pending.shift();
      if (action.type === 'befriend') {
        check(targets.includes(action.patron), 'С этим Завсегдатаем в эту Пятилетку уже связались');
        // Решения, вызванные связью (Главлитовец и т. п.), — сразу, до выбора следующего игрока.
        const before = state.pending.length;
        befriendPatron(state, p, action.patron, 'стартовая связь');
        state.pending.unshift(...state.pending.splice(before));
      }
      // Ход не передаётся: поручения ещё не начались. Когда все выбрали — начинаются поручения.
      state.holdTurn = true;
      if (!state.pending.some((x) => x.kind === 'startConnection')) logEvent(state, 'Поручения');
      return;
    }
    case 'freeConnection': {
      // Председатель: связь полностью бесплатная — без книги, с любым Завсегдатаем, с которым её ещё нет.
      check(action.type === 'befriend' || action.type === 'pass', 'Выберите Завсегдатая или откажитесь');
      if (action.type === 'befriend') befriendPatron(state, p, action.patron, 'через Председателя');
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
