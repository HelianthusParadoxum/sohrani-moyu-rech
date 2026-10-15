// Движок правил: создание партии и применение действий.
// applyAction не меняет переданное состояние, а возвращает новое.
import {
  ADDRESSES, CARDS, GENRE_NAMES, GROUP_ACTIONS, KEEPERS, PASSIONS, PERMANENT_ADDRESSES, RULES, SAFEHOUSES,
  SPECIALS, SPROUTS, SPROUT_BONUS_NAMES, STEP_REWARDS, FIRST_FEED_POINTS, limitFor,
} from './content';
import { finalScoring } from './scoring';
import type {
  Action, AddressId, GameState, Genre, GroupAction, Mode, PassionId, PlaceAction, PlayerState,
} from './types';
import { GENRES } from './types';
import {
  addBook, cacheLimit, check, discard, draw, drawLoad, fail, freeSlots, hasBook, iconsOf, isBanned, isEvidence,
  isGenreBook, isLoad, isPropaganda, isSingle, log, pay, player, pointsText, random, removeBook, shuffle,
  talonsText, title,
} from './util';

export interface NewGameOptions {
  players: { id: string; name: string }[];
  seed?: number;
  mode?: Mode;
}

export function createGame(opts: NewGameOptions): GameState {
  const n = opts.players.length;
  check(n >= 2 && n <= 4, 'В игре участвуют от 2 до 4 игроков');
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const mode = opts.mode ?? 'beginner';
  const cards = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const state: GameState = {
    version: 1, seed, rng: seed, mode, cards, restored: {},
    round: 1, phase: 'passion',
    censorship: RULES.startCensorship,
    censorshipPool: RULES.censorshipTokens.filter((t) => t !== RULES.startCensorship),
    banned: [], order: [], turn: 0, nextOrder: [],
    players: [],
    deck: [], discard: [], loadDeck: [], loadDiscard: [],
    tolkuchka: [], razval: [], baraholka: [], knigoobmen: [], raspredelitel: [],
    safehouses: [], safehouseDeck: [], occupancy: {},
    sprouts: [], pending: [], ready: [], log: [],
  };
  state.deck = shuffle(state, CARDS.filter((c) => !['load', 'loadReturnable', 'loadEvidence'].includes(c.kind)).map((c) => c.id));
  state.loadDeck = shuffle(state, CARDS.filter((c) => ['load', 'loadReturnable', 'loadEvidence'].includes(c.kind)).map((c) => c.id));
  state.safehouseDeck = shuffle(state, [...SAFEHOUSES]);
  state.sprouts = shuffle(state, SPROUTS.map((s) => s.id)).slice(0, n + 1).map((id) => ({ id, progress: 0 }));

  // Колода Пристрастий.
  let passions: PassionId[];
  if (n >= 3) {
    let keepers = shuffle(state, [...KEEPERS]);
    if (n === 3) keepers = keepers.slice(3);
    passions = [...SPECIALS.filter((p) => mode === 'full' || p !== 'curator'), ...keepers];
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
      published: [], tamizdat: [], spetskhran: [],
      passion: null, passionOptions: [passions.pop()!, passions.pop()!],
      groupUsed: [], visitedRedCorner: false, sproutsFed: [], subscriptions: [],
    };
    for (let i = 0; i < 2; i++) addBook(p, draw(state)!);
    for (let i = 0; i < 2; i++) addBook(p, drawLoad(state)!);
    state.players.push(p);
  }
  state.order = seats.map((s) => s.id);
  state.razval = [null, null, null, null];
  fillRazval(state);
  state.baraholka = Array.from({ length: RULES.displaySize }, () => draw(state));
  log(state, `Партия началась. Порядок хода: ${state.order.map((id) => player(state, id).name).join(', ')}.`);
  log(state, 'Каждый игрок тайно выбирает одно из двух Пристрастий.');
  return state;
}

// ---------- Кто сейчас ходит ----------

export function activePlayers(state: GameState): string[] {
  if (state.pending.length) return [state.pending[0].player];
  if (state.phase === 'orders') return [state.order[state.turn]];
  if (state.phase === 'passion' || state.phase === 'gathering' || state.phase === 'hiding') {
    return state.order.filter((id) => !state.ready.includes(id));
  }
  return [];
}

export function mustVisitRedCorner(p: PlayerState): boolean {
  return p.available === 1 && !p.visitedRedCorner;
}

// ---------- Применение действия ----------

export function applyAction(prev: GameState, playerId: string, action: Action): GameState {
  const state = structuredClone(prev);
  check(state.phase !== 'end', 'Партия окончена');
  check(activePlayers(state).includes(playerId), 'Сейчас не ваш ход');
  const p = player(state, playerId);

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
        log(state, `Ваше Пристрастие: ${PASSIONS[action.passion].name}.`, [p.id]);
        if (state.ready.length === state.players.length) startRound(state);
        return state;
      }
      case 'orders':
        doOrder(state, p, action);
        break;
      case 'gathering':
        check(action.type === 'gathering', 'Сейчас Посиделки');
        doGathering(state, p, action.show);
        return state;
      case 'hiding':
        check(action.type === 'hiding', 'Сейчас Укрытие');
        doHiding(state, p, action.hidden);
        return state;
    }
  }
  if (state.phase === 'orders' && state.pending.length === 0) advanceTurn(state);
  return state;
}

// ---------- Пятилетка ----------

function startRound(state: GameState) {
  state.phase = 'orders';
  state.ready = [];
  state.occupancy = {};
  state.nextOrder = [];
  for (const p of state.players) {
    p.available = p.workers;
    p.bonusGroupTurns = 0;
    p.groupUsed = [];
    p.visitedRedCorner = false;
  }
  // Обстановка: опала и обновление каналов.
  state.banned = shuffle(state, [...GENRES]).slice(0, state.censorship);
  log(state, `— Пятилетка ${state.round}. Цензура: ${state.censorship}. В опале: ${state.banned.map((g) => GENRE_NAMES[g]).join(', ')}.`);
  refreshChannels(state, state.round === 1);
  state.turn = 0;
  state.turn = -1;
  advanceTurn(state);
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
        addBook(p, got);
        log(state, `${p.name} получает по Подписке книгу жанра ${GENRE_NAMES[sub.genre]}.`);
        log(state, `По Подписке пришла ${title(state, got)}.`, [p.id]);
      } else {
        discard(state, got);
        log(state, `${p.name}: книга по Подписке ушла в сброс — нет места на складе.`);
      }
    }
    p.subscriptions = p.subscriptions.filter((s) => s.rounds > 0);
  }
  state.phase = 'gathering';
  state.ready = [];
  log(state, 'Посиделки: можно показать опальные книги со склада — по 1 очку за значок опального жанра.');
}

function doGathering(state: GameState, p: PlayerState, show: string[]) {
  check(new Set(show).size === show.length, 'Книга указана дважды');
  let pts = 0;
  for (const id of show) {
    check(hasBook(p, id), 'Показывать можно только книги со своего склада');
    check(isGenreBook(state, id) && isBanned(state, id), `${title(state, id)} — не опальная жанровая книга`);
    pts += iconsOf(state, id).filter((g) => state.banned.includes(g)).length;
  }
  p.points += pts;
  state.ready.push(p.id);
  if (show.length) {
    log(state, `${p.name} показывает на Посиделках: ${show.map((id) => title(state, id)).join(', ')} — +${pointsText(pts)}.`);
  } else {
    log(state, `${p.name} ничего не показывает на Посиделках.`);
  }
  if (state.ready.length === state.players.length) {
    state.phase = 'hiding';
    state.ready = [];
    log(state, 'Укрытие: прячьте опальные книги в Тайник (2 открытые Нагрузки укрывают ещё 1 книгу).');
  }
}

function doHiding(state: GameState, p: PlayerState, hidden: string[]) {
  check(new Set(hidden).size === hidden.length, 'Книга указана дважды');
  for (const id of hidden) check(hasBook(p, id), 'Прятать можно только книги со своего склада');
  for (const s of p.warehouse) s.hidden = hidden.includes(s.card);
  check(hidden.length <= cacheLimit(state, p), `В Тайнике помещается только ${cacheLimit(state, p)} книг(и)`);
  state.ready.push(p.id);
  log(state, `${p.name} готов(а) к облаве.`);
  if (state.ready.length === state.players.length) {
    raid(state);
    changeRound(state);
  }
}

function raid(state: GameState) {
  log(state, 'Облава!');
  const sweep = (list: string[]) => {
    const keep: string[] = [];
    for (const c of list) {
      if (isBanned(state, c)) discard(state, c);
      else keep.push(c);
    }
    return keep;
  };
  const before = state.tolkuchka.length + state.knigoobmen.length + state.raspredelitel.length + state.razval.filter(Boolean).length;
  state.tolkuchka = sweep(state.tolkuchka);
  state.knigoobmen = sweep(state.knigoobmen);
  state.raspredelitel = sweep(state.raspredelitel);
  state.razval = state.razval.map((c) => (c && isBanned(state, c) ? (discard(state, c), null) : c));
  const after = state.tolkuchka.length + state.knigoobmen.length + state.raspredelitel.length + state.razval.filter(Boolean).length;
  if (before > after) log(state, `С адресов изъято книг: ${before - after}.`);
  for (const p of state.players) {
    const seized = p.warehouse.filter((s) => !s.hidden && isBanned(state, s.card));
    if (!seized.length) continue;
    p.warehouse = p.warehouse.filter((s) => !seized.includes(s));
    p.spetskhran.push(...seized.map((s) => s.card));
    log(state, `У ${p.name} изъято в Спецхран: ${seized.map((s) => title(state, s.card)).join(', ')}.`);
  }
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
  if (safe) {
    state.safehouses.push(safe);
    log(state, `Открылся новый явочный адрес: ${ADDRESSES[safe].name}.`);
  }
  // Масштаб цензуры: прежний жетон и жетон на 1 больше — случайный из двух.
  const next = state.censorshipPool.find((t) => t === state.censorship + 1);
  if (next !== undefined) {
    const pick = random(state) < 0.5 ? state.censorship : next;
    if (pick === next) {
      state.censorshipPool = state.censorshipPool.filter((t) => t !== next).concat(state.censorship);
      state.censorship = next;
    }
  }
  state.round++;
  startRound(state);
}

// ---------- Фаза поручений ----------

function doOrder(state: GameState, p: PlayerState, action: Action) {
  if (p.available === 0) {
    check(p.bonusGroupTurns > 0, 'У вас не осталось Единомышленников');
    if (action.type === 'pass') {
      p.bonusGroupTurns = 0;
      log(state, `${p.name} отказывается от дополнительных действий Группы.`);
      return;
    }
    check(action.type === 'group', 'Сейчас можно только действие Инициативной группы');
    doGroup(state, p, action.group, { limited: true });
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
    check(!mustVisitRedCorner(p), 'Последнего Единомышленника нужно отправить в Красный уголок');
    doGroup(state, p, action.group, { limited: true });
    p.available--;
    return;
  }
  check(action.type === 'place', 'Отправьте Единомышленника по адресу или в Группу');
  const a = action.place;
  check(PERMANENT_ADDRESSES.includes(a.address) || state.safehouses.includes(a.address), 'Этого адреса нет на столе');
  if (mustVisitRedCorner(p)) check(a.address === 'redCorner', 'Последнего Единомышленника нужно отправить в Красный уголок');
  const here = state.occupancy[a.address] ?? [];
  check(here.length < limitFor(a.address, state.players.length), `${ADDRESSES[a.address].name}: все места заняты`);
  if (a.address === 'redCorner') check(!here.includes(p.id), 'В Красный уголок — не больше одного Единомышленника');
  doPlace(state, p, a);
  state.occupancy[a.address] = [...here, p.id];
  p.available--;
}

function doPlace(state: GameState, p: PlayerState, a: PlaceAction) {
  const name = ADDRESSES[a.address].name;
  switch (a.address) {
    case 'gostorg': {
      check(Number.isInteger(a.pairs) && a.pairs >= 1, 'Укажите число пар');
      check(freeSlots(p) >= a.pairs * 2, 'На складе не хватит места');
      pay(p, a.pairs);
      const got: string[] = [];
      for (let i = 0; i < a.pairs; i++) {
        const l = drawLoad(state), c = draw(state);
        if (l) { addBook(p, l); got.push(l); }
        if (c) { addBook(p, c); got.push(c); }
      }
      log(state, `${p.name} в Госкниготорге: ${a.pairs} пар(ы) за ${talonsText(a.pairs)}.`);
      log(state, `Вы получили: ${got.map((c) => title(state, c)).join(', ')}.`, [p.id]);
      return;
    }
    case 'tolkuchka': {
      check(a.ops.length > 0, 'Купите или продайте хотя бы одну книгу');
      const sold: string[] = [];
      const parts: string[] = [];
      for (const op of a.ops) {
        if (op.op === 'buy') {
          check(state.tolkuchka.includes(op.card), 'Этой книги нет на Толкучке');
          const cost = RULES.tolkuchkaBuy;
          pay(p, cost);
          state.tolkuchka = state.tolkuchka.filter((c) => c !== op.card);
          addBook(p, op.card);
          parts.push(`купил(а) ${title(state, op.card)} за ${talonsText(cost)}`);
        } else {
          check(hasBook(p, op.card), 'Продавать можно только книги со своего склада');
          check(!isEvidence(state, op.card), 'Улики нельзя продать — у них ноль подпольного спроса');
          check(!isPropaganda(state, op.card), 'Пропаганду можно сбыть только в Красном уголке');
          const icons = iconsOf(state, op.card);
          check(icons.length > 0, 'Книгу без жанра не продать');
          const gain = icons.some((g) => state.banned.includes(g)) ? RULES.tolkuchkaSellBanned : RULES.tolkuchkaSellFree;
          removeBook(p, op.card);
          p.talons += gain;
          sold.push(op.card);
          parts.push(`продал(а) ${title(state, op.card)} за ${talonsText(gain)}`);
        }
      }
      for (const c of sold) {
        state.tolkuchka.push(c);
        if (state.tolkuchka.length > RULES.displaySize) discard(state, state.tolkuchka.shift()!);
      }
      log(state, `${p.name} на Толкучке: ${parts.join('; ')}.`);
      return;
    }
    case 'redCorner': {
      const unprinted = a.recycle.filter((c) => !isFromLoadDeck(state, c));
      const load = a.recycle.filter((c) => isFromLoadDeck(state, c));
      check(unprinted.length <= 1 && load.length <= 1, 'Сдать можно до 1 Непечатной и до 1 книги Нагрузки');
      for (const c of a.recycle) {
        removeBook(p, c);
        discard(state, c);
        p.talons += 1;
      }
      p.visitedRedCorner = true;
      state.nextOrder.push(p.id);
      log(state, `${p.name} в Красном уголке (${state.nextOrder.length}-й в очереди)${a.recycle.length ? `, сдал(а) в макулатуру: ${a.recycle.map((c) => title(state, c)).join(', ')}` : ''}.`);
      return;
    }
    case 'razval': {
      const c = state.razval[a.slot];
      check(c, 'Эта ячейка Развала пуста');
      pay(p, RULES.razvalPrices[a.slot]);
      addBook(p, c);
      state.razval[a.slot] = null;
      log(state, `${p.name} покупает на Развале ${title(state, c)} за ${talonsText(RULES.razvalPrices[a.slot])}.`);
      return;
    }
    case 'zavoz': {
      p.talons += RULES.zavozIncome;
      state.razval.forEach((c) => c && discard(state, c));
      state.razval = [null, null, null, null];
      fillRazval(state);
      log(state, `${p.name} подрабатывает на Завозе: +${talonsText(RULES.zavozIncome)}, Развал обновлён.`);
      return;
    }
    case 'baraholka': {
      const c = state.baraholka[a.slot];
      check(c, 'Эта ячейка Барахолки пуста');
      state.pending.push({ kind: 'baraholkaLook', player: p.id, slot: a.slot, card: c });
      log(state, `${p.name} роется на Барахолке.`);
      return;
    }
    case 'podpiska': {
      check(GENRES.includes(a.genre), 'Нет такого жанра');
      check(Number.isInteger(a.talons) && a.talons >= 1 && a.talons <= RULES.rounds - state.round + 1, 'Неверный срок подписки');
      pay(p, a.talons);
      p.subscriptions.push({ genre: a.genre, rounds: a.talons });
      log(state, `${p.name} оформляет Подписку: ${GENRE_NAMES[a.genre]}, на ${a.talons} Пятилетк(и).`);
      return;
    }
    case 'sprouts': {
      check(a.feeds.length > 0, 'Выберите, какие ступени закрыть');
      const used = new Set<string>();
      for (const f of a.feeds) {
        const sp = state.sprouts.find((s) => s.id === f.sprout);
        check(sp, 'Этого Ростка нет в игре');
        const info = SPROUTS.find((s) => s.id === sp.id)!;
        check(sp.progress < 4, `${info.name}: все ступени уже закрыты`);
        const step = info.steps[sp.progress];
        for (const b of f.books) {
          check(!used.has(b), 'Одна книга не может пойти дважды');
          check(hasBook(p, b), 'Отдавать можно только книги со своего склада');
          used.add(b);
        }
        const icons = f.books.flatMap((b) => iconsOf(state, b));
        const main = icons.filter((g) => g === info.main).length;
        check(main >= step.main, `${info.name}: нужно значков «${GENRE_NAMES[info.main]}»: ${step.main}`);
        if (step.support) check(icons.includes(step.support), `${info.name}: нужен значок поддержки «${GENRE_NAMES[step.support]}»`);
        for (const b of f.books) { removeBook(p, b); discard(state, b); }
        const reward = STEP_REWARDS[sp.progress];
        sp.progress++;
        p.talons += reward.talons;
        p.points += reward.points;
        let text = `${p.name} питает Росток «${info.name}»: ступень ${sp.progress} закрыта (${f.books.map((b) => title(state, b)).join(', ')})`;
        text += reward.talons ? `, +${talonsText(reward.talons)}` : `, +${pointsText(reward.points)}`;
        if (!p.sproutsFed.includes(sp.id)) {
          p.sproutsFed.push(sp.id);
          p.points += FIRST_FEED_POINTS;
          text += `, +${pointsText(FIRST_FEED_POINTS)} за первое питание`;
        }
        log(state, text + '.');
        const options = info.bonuses.filter((b) => state.mode === 'full' || b !== 'rescue');
        state.pending.push({ kind: 'sproutBonus', player: p.id, sprout: sp.id, options });
      }
      return;
    }
    case 'samizdat':
    case 'tamizdat': {
      check(hasBook(p, a.card), 'Издавать можно только книги со своего склада');
      check(!isPropaganda(state, a.card), 'Пропаганду нельзя издать');
      const icons = iconsOf(state, a.card).length;
      if (a.address === 'samizdat') {
        check(icons > 0 && !isEvidence(state, a.card), 'Через Самиздат можно издать только книгу с жанровым значком');
      } else {
        check(icons > 0 || isEvidence(state, a.card), 'Через Тамиздат можно издать книгу с жанровым значком или Улику');
      }
      removeBook(p, a.card);
      p.published.push(a.card);
      p.talons += icons;
      if (a.address === 'tamizdat') {
        p.tamizdat.push(a.card);
        p.points += icons;
      }
      log(state, `${p.name} издаёт ${title(state, a.card)} через ${name}: +${talonsText(icons)}${a.address === 'tamizdat' ? `, +${pointsText(icons)}` : ''}.`);
      return;
    }
    case 'knigoobmen': {
      check(hasBook(p, a.give) && isGenreBook(state, a.give), 'Отдать нужно жанровую книгу со своего склада');
      check(state.knigoobmen.includes(a.take), 'Этой книги нет на витрине Книгообмена');
      removeBook(p, a.give);
      addBook(p, a.take);
      state.knigoobmen = state.knigoobmen.map((c) => (c === a.take ? a.give : c));
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
      check(state.raspredelitel.includes(a.card), 'Этой книги нет в Распределителе');
      pay(p, RULES.safehousePrice);
      addBook(p, a.card);
      state.raspredelitel = state.raspredelitel.filter((c) => c !== a.card);
      log(state, `${p.name} получает из Распределителя ${title(state, a.card)}.`);
      return;
    }
    case 'nasledniki': {
      check(freeSlots(p) > 0, 'На складе нет места');
      check(state.discard.length > 0, 'Сброс Непечатных пуст');
      pay(p, RULES.safehousePrice);
      state.pending.push({ kind: 'naslednikiPick', player: p.id, cards: [...state.discard] });
      log(state, `${p.name} навещает Наследников.`);
      return;
    }
    case 'posrednichestvo': {
      check(freeSlots(p) > 0, 'На складе нет места');
      pay(p, RULES.safehousePrice);
      const cards = [draw(state), draw(state), draw(state)].filter((c): c is string => !!c);
      check(cards.length > 0, 'Стопка Непечатных пуста');
      state.pending.push({ kind: 'posrednichestvoKeep', player: p.id, cards });
      log(state, `${p.name} занимается Посредничеством авторам.`);
      return;
    }
    case 'spisanie': {
      check(freeSlots(p) > 0, 'На складе нет места');
      pay(p, RULES.safehousePrice);
      let got = 0;
      const titles: string[] = [];
      for (let i = 0; i < 3; i++) {
        const c = draw(state);
        if (!c) break;
        if (freeSlots(p) > 0) { addBook(p, c); got++; titles.push(title(state, c)); }
        else discard(state, c);
      }
      log(state, `${p.name} забирает из Библиотечного списания ${got} книг(и).`);
      log(state, `Вы получили: ${titles.join(', ')}.`, [p.id]);
      return;
    }
  }
}

function isFromLoadDeck(state: GameState, id: string) {
  const k = state.cards[id].kind;
  return k === 'load' || k === 'loadReturnable' || k === 'loadEvidence';
}

// ---------- Действия Инициативной группы ----------

function doGroup(state: GameState, p: PlayerState, g: GroupAction, opts: { limited: boolean }) {
  const info = GROUP_ACTIONS[g.action];
  check(info, 'Нет такого действия');
  if (opts.limited) check(!p.groupUsed.includes(g.action), `«${info.name}» уже сделано в эту Пятилетку`);
  check(!info.fullOnly || state.mode === 'full', `«${info.name}» доступно только в полном режиме`);
  switch (g.action) {
    case 'expandWarehouse':
      check(p.capacity < RULES.maxCapacity, 'Склад уже максимального размера');
      p.capacity++;
      log(state, `${p.name}: склад увеличен до ${p.capacity}.`);
      break;
    case 'expandCache':
      check(p.cache < RULES.maxCache, 'Тайник уже максимального размера');
      p.cache++;
      log(state, `${p.name}: Тайник увеличен до ${p.cache}.`);
      break;
    case 'copyText': {
      check(freeSlots(p) > 0, 'На складе нет места');
      if (g.card === 'deck') {
        const c = draw(state);
        check(c, 'Стопка Непечатных пуста');
        addBook(p, c);
        log(state, `${p.name} тиражирует текст: берёт книгу из стопки.`);
        log(state, `Вы получили ${title(state, c)}.`, [p.id]);
      } else {
        const c = g.card;
        if (state.raspredelitel.includes(c)) state.raspredelitel = state.raspredelitel.filter((x) => x !== c);
        else if (state.tolkuchka.includes(c)) state.tolkuchka = state.tolkuchka.filter((x) => x !== c);
        else if (state.knigoobmen.includes(c)) state.knigoobmen = state.knigoobmen.filter((x) => x !== c);
        else if (state.razval.includes(c)) state.razval = state.razval.map((x) => (x === c ? null : x));
        else fail('Эта книга не лежит открыто по адресу');
        addBook(p, c);
        log(state, `${p.name} тиражирует ${title(state, c)}.`);
      }
      break;
    }
    case 'restore': {
      const slot = p.warehouse.find((s) => s.card === g.card);
      check(slot, 'Возвращать смыслы можно книге со своего склада');
      const c = state.cards[g.card];
      check(!state.restored[g.card], 'Этой книге смыслы уже возвращены');
      if (c.kind === 'loadReturnable') {
        state.restored[g.card] = [c.genre!, c.genre!, c.genre!];
        log(state, `${p.name} возвращает смыслы: ${title(state, g.card)} становится «${c.returned}» (3 значка).`);
      } else {
        check(c.kind === 'genre', 'Смыслы можно вернуть только жанровой книге или возвращаемой Нагрузке');
        const genre = g.genre ?? c.icons[0];
        check(c.icons.includes(genre), 'Значок должен быть жанра этой книги');
        state.restored[g.card] = [genre];
        log(state, `${p.name} возвращает смыслы книге ${title(state, g.card)}: +1 значок «${GENRE_NAMES[genre]}».`);
      }
      pay(p, RULES.restoreCost);
      break;
    }
    case 'hire':
      check(p.workers < RULES.maxWorkers, 'У вас уже максимум Единомышленников');
      pay(p, RULES.hireCost);
      p.workers++;
      p.available++;
      log(state, `${p.name} расширяет сеть: +1 Единомышленник.`);
      break;
    case 'rescue':
      fail('Контора пока не реализована');
  }
  if (opts.limited) p.groupUsed.push(g.action);
}

// ---------- Отложенные решения ----------

function resolvePending(state: GameState, p: PlayerState, action: Action) {
  const pend = state.pending[0];
  switch (pend.kind) {
    case 'baraholkaLook': {
      check(action.type === 'baraholkaBuy', 'Решите, покупать ли книгу с Барахолки');
      if (action.buy) {
        pay(p, RULES.baraholkaPrice);
        addBook(p, pend.card);
        state.baraholka[pend.slot] = null;
        log(state, `${p.name} покупает книгу на Барахолке.`);
        log(state, `Вы купили ${title(state, pend.card)}.`, [p.id]);
      } else {
        log(state, `${p.name} уходит с Барахолки ни с чем.`);
      }
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
        addBook(p, c);
      }
      state.deck = shuffle(state, [...state.deck, ...state.discard]);
      state.discard = [];
      log(state, `${p.name} берёт у Наследников ${action.cards.length} книг(и); сброс замешан в стопку.`);
      log(state, `Вы взяли: ${action.cards.map((c) => title(state, c)).join(', ')}.`, [p.id]);
      break;
    }
    case 'posrednichestvoKeep': {
      check(action.type === 'posrednichestvoKeep', 'Выберите, что оставить');
      check(action.keep.length >= 1 && action.keep.length <= 2, 'Оставьте 1 или 2 книги');
      check(action.keep.length <= freeSlots(p), 'На складе не хватит места');
      for (const c of action.keep) check(pend.cards.includes(c), 'Эта книга не из вытянутых');
      for (const c of pend.cards) {
        if (action.keep.includes(c)) addBook(p, c);
        else discard(state, c);
      }
      log(state, `${p.name} оставляет себе ${action.keep.length} книг(и).`);
      log(state, `Вы оставили: ${action.keep.map((c) => title(state, c)).join(', ')}.`, [p.id]);
      state.pending.shift();
      state.pending.unshift({ kind: 'posrednichestvoGroup', player: p.id });
      return;
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
      if (action.bonus === 'sideJob') {
        p.talons += RULES.sideJobIncome;
        log(state, `${p.name}: Приработок, +${talonsText(RULES.sideJobIncome)}.`);
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
          addBook(p, found);
          log(state, `${p.name} достаёт из-под полы выдающуюся книгу ${title(state, found)} (в сброс ушло ${given}).`);
        } else if (found) {
          discard(state, found);
          log(state, `${p.name}: выдающаяся книга из-под полы ушла в сброс — нет места.`);
        }
      } else {
        check(action.group && action.group.action === action.bonus, 'Уточните параметры действия');
        doGroup(state, p, action.group, { limited: false });
      }
      log(state, `Бонус Ростка: ${SPROUT_BONUS_NAMES[action.bonus]}.`, [p.id]);
      break;
    }
  }
  state.pending.shift();
}

export { cacheLimit, iconsOf, isBanned, isLoad, isGenreBook, isSingle, freeSlots };
export type { AddressId, Genre, PassionId };
