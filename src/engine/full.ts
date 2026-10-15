// Полный режим: Клуб книголюбов, Завсегдатаи, Контора, особенности жанров.
import { CLUB_SIZE, GENRE_NAMES, KONTORA_LOSS, PATRONS, RULES } from './content';
import type { ClubGift, GameState, KontoraChoice, PatronId, PlayerState } from './types';
import { GENRES } from './types';
import {
  addBook, check, discard, drawLoad, freeSlots, hasBook, hasPatron, iconsOf, isBanned, isGenreBook, log, pay, player,
  removeBook, shuffle, talonsText, title,
} from './util';

export const isFull = (state: GameState) => state.mode === 'full';

// ---------- Подготовка ----------

export function setupClub(state: GameState) {
  const pool = shuffle(state, Object.values(PATRONS).filter((p) => p.implemented).map((p) => p.id));
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
    p.talons += 1;
    log(state, `${p.name}: ирония «пущена в народ» — +1 Талон.`);
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
  check(!patron.turned, `${name}: связь в эту Пятилетку уже завязана`);
  check(!patron.connections.includes(p.id), `У вас уже есть связь с Завсегдатаем «${name}»`);
  check(hasBook(p, gift.card), 'Отдать можно только книгу со своего склада');
  const icons = iconsOf(state, gift.card);
  check(icons.includes(patron.genre) || icons.includes('album'),
    `${name} ждёт книгу жанра «${GENRE_NAMES[patron.genre]}» (или Альбом)`);
  removeBook(p, gift.card);
  discard(state, gift.card);
  gaveAway(state, p, gift.card);
  patron.connections.push(p.id);
  patron.turned = true;
  log(state, `${p.name} заводит связь в Клубе: ${name} (отдана ${title(state, gift.card)}).`);
  onConnect(state, p, patron.id);
  // Маклер: каждая новая связь (включая с ним самим) — +1 Талон.
  if (hasPatron(state, p.id, 'broker')) {
    p.talons += 1;
    log(state, `${p.name}: Маклер — +1 Талон.`);
  }
}

function onConnect(state: GameState, p: PlayerState, id: PatronId) {
  switch (id) {
    case 'tsekhovik':
      p.talons += 4;
      log(state, `${p.name}: Цеховик — +4 Талона.`);
      break;
    case 'housekeeper': {
      const add = Math.min(2, RULES.maxCapacity - p.capacity);
      p.capacity += add;
      p.patronBonus.capacity += add;
      break;
    }
    case 'carpenter': {
      const add = Math.min(2, RULES.maxCache - p.cache);
      p.cache += add;
      p.patronBonus.cache += add;
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
      // Лишние книги немедленно отдаются: уходят последние положенные открытые.
      while (freeSlots(p) < 0) {
        const s = [...p.warehouse].reverse().find((x) => !x.memorized) ?? p.warehouse[p.warehouse.length - 1];
        removeBook(p, s.card);
        discard(state, s.card);
        log(state, `${p.name}: склад уменьшился, ${title(state, s.card)} уходит в сброс.`);
      }
    }
    if (id === 'carpenter') {
      p.cache -= p.patronBonus.cache;
      p.patronBonus.cache = 0;
    }
  }
}

// ---------- Контора ----------

export function startKontora(state: GameState, p: PlayerState) {
  // Предупреждение: другие игроки могут перепрятать книги, прежде чем вы решите.
  const others = rotate(state.order, p.id).filter((id) => id !== p.id);
  for (const id of others) {
    const o = player(state, id);
    if (o.warehouse.some((s) => isBanned(state, s.card))) state.pending.push({ kind: 'kontoraWarning', player: id, from: p.id });
  }
  state.pending.push({ kind: 'kontoraDecide', player: p.id });
  log(state, `${p.name} предупреждает, что собирается в Контору. Остальные могут перепрятать книги.`);
}

function rotate(order: string[], first: string) {
  const i = order.indexOf(first);
  return [...order.slice(i), ...order.slice(0, i)];
}

export function doKontora(state: GameState, p: PlayerState, c: KontoraChoice) {
  const chosen = [c.petition?.length, c.handout, c.signal, c.prophylaxis].filter(Boolean).length;
  check(chosen >= 1, 'Выберите от 1 до 4 пунктов');
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
    holdWorker(state, o, `сигнал от ${p.name}`);
  }
  if (c.prophylaxis) removePatron(state, c.prophylaxis);
  if (c.seize) {
    const o = player(state, c.seize.player);
    const s = o.warehouse.find((x) => x.card === c.seize!.card);
    check(s && !s.hidden && !s.memorized, 'Изъять можно только открыто лежащую на складе книгу');
    check(isGenreBook(state, s.card) && isBanned(state, s.card), 'Изъять можно только книгу опального жанра');
    removeBook(o, s.card);
    o.spetskhran.push(s.card);
    log(state, `По доносу из Конторы у ${o.name} изъята в Спецхран ${title(state, s.card)}.`);
  }
  if (c.handout) {
    const cards = state.players.flatMap((o) => o.spetskhran.map((card) => ({ owner: o.id, card })));
    if (cards.length && freeSlots(p) > 0) state.pending.push({ kind: 'kontoraHandout', player: p.id, cards });
    else log(state, `${p.name}: Выдача на руки — брать нечего или некуда.`);
  }
}

export function takeFromSpetskhran(state: GameState, p: PlayerState, card: string) {
  const owner = state.players.find((o) => o.spetskhran.includes(card));
  check(owner, 'Этой книги нет в Спецхране');
  owner.spetskhran = owner.spetskhran.filter((c) => c !== card);
  addBook(p, card);
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
      if (n) { p.talons += n; log(state, `${p.name}: Несун — +${talonsText(n)}.`); }
    }
    // Библиотекарь: до 2 книг сверху перетасованного сброса.
    if (hasPatron(state, p.id, 'librarian') && state.discard.length) {
      shuffle(state, state.discard);
      let n = 0;
      while (n < 2 && freeSlots(p) > 0 && state.discard.length) { addBook(p, state.discard.pop()!); n++; }
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

export function payPrice(state: GameState, p: PlayerState, cost: number) {
  const c = price(state, p, cost);
  pay(p, c);
  return c;
}
