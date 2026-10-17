// Полный режим: Клуб книголюбов, Завсегдатаи, Контора, особенности жанров.
import { CLUB_SIZE, GENRE_NAMES, KONTORA_LOSS, KONTORA_PATRONS, PATRONS, RULES } from './content';
import type { ClubGift, GameState, KontoraChoice, PatronId, PlayerState } from './types';
import { GENRES } from './types';
import {
  addBook, addSecretBook, check, discard, drawLoad, earn, freeSlots, hasBook, hasPatron, iconsOf, isBanned, isGenreBook, isPropaganda, log, pay, player,
  removeBook, shuffle, talonsText, title,
} from './util';

export const isFull = (state: GameState) => state.mode === 'full';

// ---------- Подготовка ----------

export function setupClub(state: GameState) {
  const pool = shuffle(state, Object.values(PATRONS).filter((p) => p.implemented && !(state.reserve && KONTORA_PATRONS.includes(p.id))).map((p) => p.id));
  const genres = shuffle(state, [...GENRES]);
  state.patrons = pool.slice(0, CLUB_SIZE).map((id, i) => ({ id, genre: genres[i], connections: [], turned: false, removed: false }));
}

// ---------- Цены и мелкие эффекты ----------

// Скупщик: каждое действие с ценой в Талонах — на 1 дешевле, до минимума в 1.
export function price(state: GameState, p: PlayerState, cost: number): number {
  return cost > 0 && hasPatron(state, p.id, 'buyer') ? Math.max(1, cost - 1) : cost;
}

// Ирония «Пустить в народ»: +1 Талон, когда игрок отдаёт ироническую книгу куда-либо.
export function gaveAway(state: GameState, p: PlayerState, card: string) {
  if (isFull(state) && iconsOf(state, card).includes('irony')) {
    log(state, `${p.name}: ирония «пущена в народ» — +1 Талон.`);
    earn(state, p, 1);
  }
}

// Проза «Вдохновиться»: +1 очко за каждую книгу прозы на складе и в изданном, когда действие принесло очки.
export function proseBonus(state: GameState, p: PlayerState): number {
  if (!isFull(state)) return 0;
  return [...p.warehouse.map((s) => s.card), ...p.published].filter((c) => iconsOf(state, c).includes('prose')).length;
}

export function heldTotal(state: GameState) {
  return state.players.reduce((s, p) => s + p.held, 0);
}

// Удержать Единомышленника в Конторе (облава, Сигнал). Психиатр защищает.
export function holdWorker(state: GameState, p: PlayerState, reason: string): boolean {
  if (state.reserve) return false; // «Заповедник»: Конторы нет — никого не удерживают
  if (hasPatron(state, p.id, 'psychiatrist')) {
    log(state, `${p.name}: Психиатр не даёт Конторе удержать Единомышленника.`);
    return false;
  }
  if (p.held >= p.workers) return false;
  p.held++;
  if (p.available > 0) p.available--;
  log(state, `Контора удерживает Единомышленника ${p.name} (${reason}). Всего удержано: ${heldTotal(state)}.`);
  return true;
}

export function releaseWorker(state: GameState, p: PlayerState, n: number) {
  const k = Math.min(n, p.held);
  p.held -= k;
  p.available += k;
  return k;
}

// ---------- Клуб книголюбов ----------

export function giveToPatron(state: GameState, p: PlayerState, gift: ClubGift) {
  const patron = state.patrons.find((x) => x.id === gift.patron);
  check(patron && !patron.removed, 'Этого Завсегдатая нет в Клубе');
  const name = PATRONS[patron.id].name;
  check(!patron.turned, `${name}: занят на Пятилетку`);
  check(!patron.connections.includes(p.id), `У вас уже есть связь с Завсегдатаем «${name}»`);
  check(hasBook(p, gift.card), 'Отдать можно только книгу со своего склада');
  const icons = iconsOf(state, gift.card);
  check(icons.includes(patron.genre) || icons.includes('album'),
    `${name} ждёт книгу жанра «${GENRE_NAMES[patron.genre]}» (или Альбом)`);
  removeBook(p, gift.card);
  discard(state, gift.card);
  gaveAway(state, p, gift.card);
  patron.connections.push(p.id);
  patron.since = { ...patron.since, [p.id]: state.round };
  patron.turned = true;
  log(state, `${p.name} заводит связь в Клубе: ${name} (отдана ${title(state, gift.card)}).`);
  state.log[state.log.length - 1].club = { player: p.id, round: state.round };
  onConnect(state, p, patron.id);
  // Маклер: каждая новая связь (включая с ним самим) — Талоны.
  if (hasPatron(state, p.id, 'broker')) {
    log(state, `${p.name}: Маклер — +${talonsText(RULES.brokerTalons)}.`);
    earn(state, p, RULES.brokerTalons);
  }
}

export function onConnect(state: GameState, p: PlayerState, id: PatronId) {
  switch (id) {
    case 'glavlit':
      state.pending.push({ kind: 'glavlitSwap', player: p.id });
      break;
    case 'housekeeper': {
      const add = Math.min(2, RULES.maxCapacity - p.capacity);
      p.capacity += add;
      p.patronBonus.capacity += add;
      break;
    }
  }
}

// Профилактика: Завсегдатай уходит из Клуба, все связи с ним теряются.
export function removePatron(state: GameState, id: PatronId) {
  const patron = state.patrons.find((x) => x.id === id);
  check(patron && !patron.removed, 'Этого Завсегдатая нет в Клубе');
  patron.removed = true;
  log(state, `Профилактика: Завсегдатай «${PATRONS[id].name}» больше не ходит в Клуб.`);
  for (const pid of patron.connections) {
    const p = player(state, pid);
    if (id === 'housekeeper') {
      p.capacity -= p.patronBonus.capacity;
      p.patronBonus.capacity = 0;
      // Лишние книги немедленно отдаются — какие, выбирает сам игрок.
      if (freeSlots(p) < 0) {
        state.pending.unshift({ kind: 'discardExcess', player: p.id, count: -freeSlots(p) });
        log(state, `${p.name}: Склад уменьшился — нужно отдать книг: ${-freeSlots(p)}.`);
      }
    }
    if (id === 'carpenter') {
      p.cache -= p.patronBonus.cache;
      p.patronBonus.cache = 0;
    }
  }
}

// ---------- Контора ----------

// Открытые опальные книги на Складах — цена похода в Контору (одна уходит в Спецхран).
type TargetsInfo = Pick<GameState, 'cards' | 'restored' | 'banned'> & {
  players: { id: string; warehouse: { card: string | null; hidden: boolean; memorized?: boolean }[] }[];
};

export function kontoraTargets(state: TargetsInfo): { player: string; card: string }[] {
  return state.players.flatMap((o) => o.warehouse
    .filter((s) => s.card && !s.hidden && !s.memorized && isGenreBook(state, s.card) && isBanned(state, s.card))
    .map((s) => ({ player: o.id, card: s.card! })));
}

// Сигнал — только на того, кто видимо нарушает: у него на Складе открыто лежит хотя бы одна опальная книга (или Улика).
export function signalable(state: TargetsInfo, playerId: string): boolean {
  const o = state.players.find((x) => x.id === playerId);
  return !!o && o.warehouse.some((s) => s.card && !s.hidden && !s.memorized && isBanned(state, s.card) && !isPropaganda(state, s.card));
}

export function startKontora(state: GameState, p: PlayerState) {
  check(kontoraTargets(state).length > 0, 'В Контору сейчас не пойти: ни у кого на Складе нет открытой опальной книги — нечем заплатить');
  // Перепрятать книги соперники уже не успеют: перепрятывают только в свой ход. Игрок сразу выбирает пункты и цену.
  state.pending.push({ kind: 'kontoraDecide', player: p.id });
}

export function doKontora(state: GameState, p: PlayerState, c: KontoraChoice) {
  const chosen = [c.petition?.length, c.handout, c.signal, c.prophylaxis].filter(Boolean).length;
  check(chosen >= 1, 'Выберите от 1 до 4 пунктов');
  check(c.seize, 'Выберите открытую опальную книгу, которая уйдёт в Спецхран — это цена похода в Контору');
  if (c.petition?.length) {
    check(c.petition.length <= 2, 'Ходатайство возвращает до 2 Единомышленников');
    for (const id of c.petition) {
      const o = player(state, id);
      check(o.held > 0, `У ${o.name} нет удержанных Единомышленников`);
      releaseWorker(state, o, 1);
      log(state, `Ходатайство: ${o.name} получает Единомышленника обратно.`);
    }
  }
  if (c.signal) {
    const o = player(state, c.signal);
    check(signalable(state, o.id), `Сигнал — только на того, у кого открыто лежит опальная книга: у ${o.name} таких нет`);
    holdWorker(state, o, `сигнал от ${p.name}`);
  }
  if (c.prophylaxis) removePatron(state, c.prophylaxis);
  if (c.seize) {
    const o = player(state, c.seize.player);
    const s = o.warehouse.find((x) => x.card === c.seize!.card);
    check(s && !s.hidden && !s.memorized, 'Изъять можно только открыто лежащую на складе книгу');
    check(isGenreBook(state, s.card) && isBanned(state, s.card), 'Изъять можно только книгу опального жанра');
    removeBook(o, s.card);
    state.spetskhran.push(s.card);
    log(state, `По доносу из Конторы у ${o.name} изъята в Спецхран ${title(state, s.card)}.`);
  }
  if (c.handout) {
    const cards = [...state.spetskhran];
    if (cards.length && freeSlots(p) > 0) state.pending.push({ kind: 'kontoraHandout', player: p.id, cards });
    else log(state, `${p.name}: Выдача на руки — брать нечего или некуда.`);
  }
}

export function takeFromSpetskhran(state: GameState, p: PlayerState, card: string) {
  check(state.spetskhran.includes(card), 'Этой книги нет в Спецхране');
  state.spetskhran = state.spetskhran.filter((c) => c !== card);
  addSecretBook(state, p, card);
  log(state, `${p.name} получает книгу из Спецхрана (Выдача на руки).`);
  log(state, `Вы получили ${title(state, card)}.`, [p.id]);
}

export function rescue(state: GameState, p: PlayerState, returns: Record<string, number>) {
  let total = 0;
  for (const [id, n] of Object.entries(returns)) {
    if (!n) continue;
    const o = player(state, id);
    check(Number.isInteger(n) && n > 0 && n <= o.held, `У ${o.name} удержано только ${o.held}`);
    total += releaseWorker(state, o, n);
  }
  check(total > 0, 'Выберите, кого вызволить');
  log(state, `${p.name} вызволяет из Конторы Единомышленников: ${total}.`);
  return total;
}

export function kontoraLost(state: GameState): boolean {
  return isFull(state) && heldTotal(state) >= KONTORA_LOSS;
}

// ---------- Конец Пятилетки ----------

export function afterRaid(state: GameState) {
  if (!isFull(state)) return;
  for (const id of state.order) {
    const p = player(state, id);
    // Несун: +1 Талон за каждое пустое потайное место.
    if (hasPatron(state, p.id, 'nesun')) {
      const used = p.warehouse.filter((s) => s.hidden).length;
      const n = Math.max(0, p.cache - used);
      if (n) { log(state, `${p.name}: Несун — +${talonsText(n)}.`); earn(state, p, n); }
    }
    // Библиотекарь: до 2 книг сверху перетасованного сброса.
    if (hasPatron(state, p.id, 'librarian') && state.discard.length) {
      shuffle(state, state.discard);
      let n = 0;
      while (n < 2 && freeSlots(p) > 0 && state.discard.length) { addSecretBook(state, p, state.discard.pop()!); n++; }
      if (n) log(state, `${p.name}: Библиотекарь приносит книг из сброса: ${n}.`);
    }
  }
}

// Парторг: перед облавой бесплатно заполнить пустые места Нагрузкой.
export function partorgFill(state: GameState, p: PlayerState) {
  check(hasPatron(state, p.id, 'partorg'), 'Нужна связь с Парторгом');
  let n = 0;
  while (freeSlots(p) > 0) {
    const c = drawLoad(state);
    if (!c) break;
    addBook(p, c);
    n++;
  }
  if (n) log(state, `${p.name}: Парторг заполняет склад Нагрузкой (${n}).`);
}

// Покупки за одно действие. Скупщик: первая — на 1 дешевле (минимум 1). Ветеран: в сумме на 1 Талон дешевле (минимум 1) —
// скидка достаётся первой покупке, после которой сумма всё ещё не меньше 1 Талона.
export function purchases(state: GameState, p: PlayerState) {
  let spent = 0;
  let count = 0;
  let veteran = hasPatron(state, p.id, 'veteran');
  return (cost: number): number => {
    let c = count === 0 ? price(state, p, cost) : cost;
    if (veteran && c > 0 && spent + c - 1 >= 1) { c--; veteran = false; }
    pay(p, c);
    spent += c;
    count++;
    return c;
  };
}

export function payPrice(state: GameState, p: PlayerState, cost: number) {
  const c = price(state, p, cost);
  pay(p, c);
  return c;
}
