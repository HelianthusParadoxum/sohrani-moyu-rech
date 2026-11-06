// Игровой стол.
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  ADDRESSES, ADDRESS_ICONS, CENSOR_ICON, PASSION_ICON, ROUND_ICON, addressLabel, BONUS_ICONS, GROUP_ICONS, ICON_JOIN, COPY_TEXT_ADDRESSES, GENRE_NAMES, GROUP_ACTIONS, groupCost, safehouseCost, PASSIONS, POINT_SOURCES, passionLabel, RULES, SPROUTS, SPROUT_BONUS_NAMES, STEP_REWARDS, limitFor,
  groupInGame, addressInGame, PATRONS, sproutSlotBonuses,
} from '../engine/content';
import type { Action, AddressId, CopyTextAddress, CopyTextBuy, Genre, GroupAction, GroupActionId, PassionId, PatronId, PlaceAction, PointSource, SproutBonusId } from '../engine/types';
import { GENRES } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { title as bookTitle, bestFeedBooks, canMemorizeOnBuy, coversStep, roomToBuy, freeSproutSlots, genresOf, hasPatron, iconCount, isEvidence, isExposed, isGenreBook, isPropaganda, loadCover, roman } from '../engine/util';
import { blatnoyOptions, kontoraTargets } from '../engine/full';
import {
  BefriendPicker, ClubContents, fittingBooks, patronOpen, patronWhy, ClubGiftModal, ClubPanel, FreeConnectionPrompt, HandoutPrompt, KontoraContents, KontoraDecidePrompt, KontoraPanel,
  KontoraWarningPrompt,
} from './full-ui';
import type { ClientMessage, RoomInfo } from '../shared/protocol';
import { Book, Dropdown, GENRE_SHORT, GenreChip, KindChip, withKindChips, workerIcon, addressIcons, iconize, SpeedSelect, Modal, ModalCollapse, PLAYER_COLORS, fromLoadDeck, iconsOf, isBanned, isLoad, toggle } from './ui';

type Send = (m: ClientMessage) => void;
type VPlayer = PlayerView['players'][number];
// Нажали на недоступное — объяснить почему (окно «Сейчас нельзя»).
const Explain = createContext<(why: string) => void>(() => {});

type Panel = { kind: 'address'; id: AddressId; sprout?: string; slot?: number; patron?: PatronId; pick?: string } | { kind: 'group'; id: GroupActionId } | { kind: 'cache' } | null;

const PHASE_NAMES: Record<string, string> = {
  passion: 'Выбор Пристрастий', setupCache: 'Тайники перед началом', orders: 'Поручения', gathering: 'Посиделки', ambush: 'Засада?', hiding: 'Укрытие', end: 'Конец Застоя',
};

export function Game({ view, room, you, isHost, send, canStepBack }: { view: PlayerView; room: RoomInfo; you: string | null; isHost: boolean; send: Send; canStepBack?: boolean }) {
  const me = view.players.find((p) => p.id === you) ?? null;
  const act = (action: Action) => send({ t: 'action', action });
  const [panel, setPanel] = useState<Panel>(null);
  const [showResult, setShowResult] = useState(true);
  const [collapsed, setCollapsed] = useState<string | null>(null);
  const collapse = useMemo(() => ({ collapsed, set: setCollapsed }), [collapsed]);
  const seatIndex = (id: string) => room.seats.findIndex((s) => s.id === id);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const myTurn = !!you && view.active.includes(you);
  const head = view.pending[0];
  const myPending = head && head.player === you && !('secret' in head) ? head : null;
  // Действие сделано — дальше только свободные действия и «Закончить ход».
  const afterAction = myTurn && view.phase === 'orders' && !myPending && !!me && view.turnDone === me.id;
  const canPlace = myTurn && view.phase === 'orders' && !myPending && !!me && me.available > 0 && !afterAction;
  // Только что купил на адресе Тиражирования — можно вдогонку взять оттуда же книгу даром.
  const bonusTurn = myTurn && view.phase === 'orders' && !myPending && !!me && me.available === 0 && me.bonusGroupTurns > 0 && !afterAction;
  const canGift = myTurn && view.mode === 'full' && RULES.clubFreeGift && view.phase === 'orders' && !myPending && !!me && view.clubGiftBy !== me.id;
  const mustRed = !!me && me.available === 1 && !me.visitedRedCorner && !hasPatron(view, me.id, 'doctor');

  useEffect(() => { if (!canPlace && !bonusTurn && !canGift && !afterAction) setPanel(null); }, [canPlace, bonusTurn, canGift, afterAction]);

  // Имя игрока в строке статуса — с его цветным кружком.
  const who = (id: string) => <Fragment key={id}><span className="dot" style={{ background: PLAYER_COLORS[seatIndex(id)] }} /> {nameOf(id)}</Fragment>;
  const whoList = (ids: string[]) => ids.map((id, i) => <Fragment key={id}>{i ? ', ' : ''}{who(id)}</Fragment>);
  // Итог партии: перед именем каждого победителя — его кружок.
  const withWinnerDots = (note: string, winners: string[]): ReactNode => {
    let parts: (string | ReactElement)[] = [note];
    for (const id of winners) {
      const name = nameOf(id);
      parts = parts.flatMap((x) => {
        if (typeof x !== 'string') return [x];
        const i = x.indexOf(name);
        return i < 0 ? [x] : [x.slice(0, i), who(id), x.slice(i + name.length)];
      });
    }
    return <>{parts}</>;
  };
  // Строка статуса начинается с того, кто действует; ждём нескольких сразу — «Ждём: …».
  const mine = (text: string) => <>{you && who(you)} (вы): {workerIcon(text)}</>;
  let status: ReactNode;
  if (view.phase === 'end') status = view.result ? withWinnerDots(view.result.note, view.result.winners) : 'Партия окончена';
  else if (head && head.player !== you) status = <>{who(head.player)} принимает решение…</>;
  else if (myPending) status = mine('примите решение');
  else if (view.phase === 'orders') {
    if (afterAction) status = mine('действие сделано. Можно пересобрать Тайник' + (view.mode === 'full' ? ', заучить сборник поэзии, отдать книгу в Клуб' : '') + ' — или закончите ход');
    else if (canPlace) status = mine(mustRed ? 'последнего 👤 — в Красный уголок' : 'отправьте 👤 действовать');
    else if (bonusTurn) status = mine('дополнительное действие Группы с явочного адреса — или откажитесь');
    else status = view.active.length === 1 ? <>{who(view.active[0])} ходит</> : <>Ходят: {whoList(view.active)}</>;
  } else if (you && view.active.includes(you)) status = mine('ваше решение');
  else status = view.active.length === 1 ? <>{who(view.active[0])} принимает решение…</> : <>Ждём: {whoList(view.active)}</>;

  // Порядок на столе: Клуб на всю ширину, под ним Контора и Ростки (вместе с их действием), затем адреса и явочные.
  const full = view.mode === 'full';
  const addresses: AddressId[] = [...BOARD_ORDER, ...view.safehouses];
  // Адрес активен, только если хватает ресурсов (Талонов, книг, места); Клуб — если есть кому дарить.
  const enabledFor = (id: AddressId) => (id === 'club' && RULES.clubFreeGift
    ? canGift && !!me && view.patrons.some((pt) => patronOpen(view, me, pt))
    : canPlace && (!mustRed || id === 'redCorner') && !!me && !addressBlocker(view, me, id));
  // Почему сейчас нельзя: сперва общее (чей ход, какая фаза), потом про адрес или действие Группы.
  const [why, setWhy] = useState<string | null>(null);
  const turnWhy = (): string | null => {
    if (!me) return 'Вы смотрите партию со стороны.';
    if (view.phase !== 'orders') return `Сейчас фаза «${PHASE_NAMES[view.phase]}»: поручения не раздают.`;
    if (myPending) return 'Сначала примите решение в открытом окне.';
    if (!myTurn) return `Сейчас ход: ${view.active.map(nameOf).join(', ')}.`;
    return null;
  };
  const addressWhy = (id: AddressId, withBlocker = true): string | null => {
    const t = turnWhy();
    if (t || !me) return t;
    if (id === 'club' && RULES.clubFreeGift) {
      if (view.clubGiftBy === me.id) return 'Отдать книгу в Клуб можно один раз за ход.';
      return 'Нет Завсегдатая, которому подойдёт ваша книга: нужна книга его жанра или Альбом, а занятые на Пятилетку связей не берут.';
    }
    if (afterAction) return 'Поручение этого хода уже дано. Закончите ход — или сделайте свободное действие (Тайник, Клуб, «Заучить»).';
    if (bonusTurn) return 'Своих 👤 не осталось: сейчас — дополнительное действие Инициативной группы, а не поручение по адресу.';
    if (me.available === 0) return 'Свободных 👤 не осталось.';
    if (mustRed && id !== 'redCorner') return 'Последнего 👤 нужно отправить в Красный уголок.';
    if (addressFull(id, view, me)) return 'Все места на этом адресе заняты.';
    return withBlocker ? addressBlocker(view, me, id) : null;
  };
  const groupWhy = (g: GroupActionId): string | null => {
    if (!me) return turnWhy();
    if (!(canPlace || bonusTurn)) {
      const t = turnWhy();
      if (t) return t;
      if (afterAction) return 'Поручение этого хода уже дано: действие Группы — тоже поручение. Закончите ход.';
      return 'Свободных 👤 не осталось.';
    }
    if (me.groupUsed.includes(g)) return 'Это действие Группы уже сделано в эту Пятилетку.';
    if (canPlace && mustRed && g !== 'hire') return 'Последнего 👤 нужно отправить в Красный уголок; из действий Группы сейчас можно только Расширить Сеть.';
    return groupBlocker(view, me, g);
  };

  // Клуб: нажатие на Завсегдатая — сразу дарение ему; подходящая книга одна — отдаётся без окна.
  const giftTo = (patron: PatronId) => {
    const pt = view.patrons.find((x) => x.id === patron);
    if (!me || !pt) return;
    const books = fittingBooks(view, me, pt.genre);
    if (books.length === 1) act({ type: 'clubGift', gift: { patron, card: books[0] } });
    else setPanel({ kind: 'address', id: 'club', patron });
  };
  const card = (id: AddressId) => (
    <AddressCard key={id} id={id} view={view} seatIndex={seatIndex} me={me} enabled={enabledFor(id)} onOpen={(pick) => setPanel({ kind: 'address', id, pick })} why={addressWhy(id)}
      blocked={canPlace && me && !(id === 'club' && RULES.clubFreeGift) ? addressBlocker(view, me, id) : null}
      onPatron={id === 'club' && RULES.clubFreeGift && canGift ? giftTo : undefined}
      onBlocked={id === 'club' && me ? (pid) => {
        const pt = view.patrons.find((x) => x.id === pid)!;
        setWhy((canGift ? null : addressWhy('club')) ?? patronWhy(view, me, pt) ?? 'Сейчас книгу этому Завсегдатаю не отдать.');
      } : undefined} />
  );

  return (
    <ModalCollapse.Provider value={collapse}>
    <Explain.Provider value={setWhy}>
    <div className="game">
      <header className="topbar">
        <div className="title">Сохрани мою речь</div>
        <div>{ROUND_ICON} Пятилетка <b>{view.round}</b>/{RULES.rounds}</div>
        <div className="banned">{CENSOR_ICON} Цензура {view.censorship}: {view.banned.map((g) => <GenreChip key={g} g={g} banned />)}</div>
        <div className="muted small">📃 Непечатные: {view.deckCount} (сброс {view.discardCount}) · 📕 Нагрузка: {view.loadDeckCount} (сброс {view.loadDiscardCount}){view.spotter && <SpotterButton view={view} />}</div>
        {isHost && (
          <div className="host-tools">
            <label className="row small">
              <input type="checkbox" checked={room.hostBot} onChange={(e) => send({ t: 'hostBot', on: e.target.checked })} />
              за меня бот
            </label>
            <SpeedSelect room={room} send={send} />
            <button className="small" onClick={() => send({ t: 'botPause', on: !room.paused })} title="Остановить или продолжить ходы ботов">
              {room.paused ? '▶ Продолжить' : '⏸ Пауза'}
            </button>
            <button className="small" disabled={!room.canUndo} onClick={() => send({ t: 'undo' })} title="Отменить последнее действие (для плейтеста)">↶ Отмена</button>
            <button className="small" onClick={() => confirm('Вернуть комнату в лобби? Текущая партия будет потеряна.') && send({ t: 'restart' })}>В лобби</button>
          </div>
        )}
      </header>
      <div className={`status ${myTurn ? 'mine' : ''}`}>
        {view.order.length > 1 && (
          <span className="turn-order">Порядок:{' '}
            {view.order.map((id) => <span key={id} className="dot" style={{ background: PLAYER_COLORS[seatIndex(id)] }} title={nameOf(id)} />)}
          </span>
        )}
        <b className="phase">{PHASE_NAMES[view.phase]}</b>
        {/* Один элемент строки: иначе flex разносит кружок и имя игрока на ширину промежутка. */}
        <span className="status-text">{status}</span>
        {bonusTurn && <button className="small" onClick={() => act({ type: 'pass' })}>Отказаться</button>}
        {afterAction && <button className="primary small end-turn-inline" onClick={() => act({ type: 'endTurn' })}>Закончить ход</button>}
        {view.phase === 'end' && view.result && <button className="small" onClick={() => setShowResult(true)}>Таблица счёта</button>}
        {canPlace && (me.visitedRedCorner || hasPatron(view, me.id, 'doctor')) && <button className="small" onClick={() => confirm('Спасовать до конца Пятилетки? Оставшиеся 👤 не будут действовать.') && act({ type: 'pass' })}>Спасовать</button>}
      </div>

      {me && view.phase !== 'passion' && <MobileBar view={view} me={me} />}

      {/* На телефоне «Закончить ход» выезжает снизу экрана, чтобы не листать к строке статуса. Там же — «Развернуть» свёрнутое окно. */}
      <div className={`end-turn-sheet ${afterAction || collapsed ? 'show' : ''}`} aria-hidden={!afterAction && !collapsed}>
        {collapsed ? (
          <>
            <span className="muted small">Окно «{collapsed}» свёрнуто</span>
            <button className="primary" onClick={() => setCollapsed(null)}>Развернуть</button>
          </>
        ) : (
          <>
            {canStepBack
              ? <button tabIndex={afterAction ? 0 : -1} onClick={() => send({ t: 'stepBack' })} title="Отменить действия этого хода — до момента, когда вы узнали что-то новое">← Назад</button>
              : <span className="muted small" title="Вы уже узнали новое (например, увидели закрытые книги) — отменить ход нельзя">Действие сделано</span>}
            <button className="primary" tabIndex={afterAction ? 0 : -1} onClick={() => act({ type: 'endTurn' })}>Закончить ход</button>
          </>
        )}
      </div>
      {view.phase === 'passion' && me ? (
        <>
          <p className="center muted">Адреса откроются, когда все выберут Пристрастия. Завсегдатаи и Ростки Гласности — уже на столе.</p>
          {/* Перед выбором Пристрастия видно, какие в партии Завсегдатаи и Ростки. */}
          <main className="layout">
            <section className="board">
              <div className="addresses">
                {full && card('club')}
                <Sprouts view={view} me={me} beside={full && !view.reserve} seatIndex={seatIndex}
                  head={<AddressHead id="sprouts" view={view} seatIndex={seatIndex} me={me} enabled={false} onOpen={() => {}} rightHint={SPROUTS_TIP} />} />
              </div>
            </section>
          </main>
        </>
      ) : (
      <main className="layout">
        <section className="board">
          <div className="addresses">
            {full && card('club')}
            <Sprouts view={view} me={me} beside={full && !view.reserve} seatIndex={seatIndex}
              onOpen={enabledFor('sprouts') ? (sprout, slot) => setPanel({ kind: 'address', id: 'sprouts', sprout, slot }) : undefined} why={addressWhy('sprouts')} turnWhy={addressWhy('sprouts', false)}
              head={<AddressHead id="sprouts" view={view} seatIndex={seatIndex} me={me} enabled={enabledFor('sprouts')} onOpen={() => setPanel({ kind: 'address', id: 'sprouts' })}
                rightHint={SPROUTS_TIP} />} />
            {full && !view.reserve && card('kontora')}
            {addresses.map(card)}
          </div>
        </section>
        <aside className="side">
          {me && (
            <MyPanel view={view} me={me} color={PLAYER_COLORS[seatIndex(me.id)]}
              groupWhy={groupWhy} onGroup={(id) => setPanel({ kind: 'group', id })}
              onMemorize={view.mode === 'full' && (canPlace || bonusTurn || afterAction) ? (card) => act({ type: 'memorize', card }) : null}
              onCache={canPlace || bonusTurn || afterAction ? () => setPanel({ kind: 'cache' }) : null} />
          )}
          {view.players.filter((p) => p.id !== you).map((p, i, all) => (
            <OtherPlayer key={p.id} view={view} p={p} color={PLAYER_COLORS[seatIndex(p.id)]} active={view.active.includes(p.id)} rev={all.length - i} />
          ))}
          <Log view={view} seatIndex={seatIndex} />
        </aside>
      </main>
      )}

      {panel?.kind === 'address' && panel.id === 'club' && RULES.clubFreeGift && me && canGift && (
        <ClubGiftModal view={view} me={me} act={act} close={() => setPanel(null)} patron={panel.patron} />
      )}
      {panel?.kind === 'address' && !(panel.id === 'club' && RULES.clubFreeGift) && me && (
        <AddressPanel id={panel.id} sprout={panel.sprout} slot={panel.slot} pick={panel.pick} view={view} me={me} close={() => setPanel(null)} place={(place) => { act({ type: 'place', place }); setPanel(null); }} />
      )}
      {panel?.kind === 'cache' && me && (
        <CacheModal view={view} me={me} close={() => setPanel(null)} done={(hidden) => { act({ type: 'hiding', hidden }); setPanel(null); }} />
      )}
      {panel?.kind === 'group' && me && (
        <GroupPanel id={panel.id} view={view} me={me} close={() => setPanel(null)} done={(group) => { act({ type: 'group', group }); setPanel(null); }} />
      )}
      {myPending && me && <PendingPrompt view={view} me={me} act={act} nameOf={nameOf} cancel={canStepBack ? () => send({ t: 'stepBackOne' }) : undefined} />}
      {!myPending && me && view.phase === 'passion' && view.active.includes(me.id) && <PassionPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'gathering' && view.active.includes(me.id) && <GatheringPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'ambush' && view.active.includes(me.id) && <AmbushPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'hiding' && view.active.includes(me.id) && <HidingPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'setupCache' && view.active.includes(me.id) && (
        <CacheModal view={view} me={me} title="Тайник перед началом" note="Соперники пока не видят ваших стартовых книг. Что спрячете сейчас, то они так и не увидят; остальное ляжет на Склад открыто."
          done={(hidden) => act({ type: 'hiding', hidden })} />
      )}
      {view.phase === 'end' && view.result && showResult && <Results view={view} seatIndex={seatIndex} close={() => setShowResult(false)} />}
      {why && (
        <Modal title="Сейчас нельзя" onClose={() => setWhy(null)}>
          <p>{withGenreChips(addressIcons(why), false)}</p>
          <div className="modal-foot"><button className="primary" onClick={() => setWhy(null)}>Понятно</button></div>
        </Modal>
      )}
    </div>
    </Explain.Provider>
    </ModalCollapse.Provider>
  );
}

// ---------- Адреса ----------

// Порядок обычных адресов на поле (после Клуба, Конторы и Ростков); явочные — следом.
const BOARD_ORDER: AddressId[] = ['redCorner', 'glavlit', 'makulatura', 'gostorg', 'baraholka', 'tolkuchka', 'razval', 'zavoz', 'tamizdat', 'samizdat'];

type AddressProps = { id: AddressId; view: PlayerView; seatIndex: (id: string) => number; me: VPlayer | null; enabled: boolean; onOpen: (pick?: string) => void; onPatron?: (id: PatronId) => void; onBlocked?: (id: PatronId) => void; blocked?: string | null; why?: string | null };

// Каким книгам можно вернуть смыслы.
const restorable = (kind: string) => ['genre', 'loadReturnable', 'loadEvidence', ...(RULES.exposePropaganda ? ['propaganda', 'loadPropaganda'] : [])].includes(kind);

// Цена действия Группы (или бонуса Ростка) для игрока: со Скупщиком и Столяром. Пусто — бесплатно.
function groupPrice(view: PlayerView, p: VPlayer | null, id: string): string {
  let cost = groupCost(id);
  if (p && id === 'expandCache' && hasPatron(view, p.id, 'carpenter')) cost = 0;
  if (p) cost = priceFor(view, p, cost);
  return cost ? `${cost}🎫` : '';
}
const withPrice = (view: PlayerView, p: VPlayer | null, id: string) => {
  const price = groupPrice(view, p, id);
  const icon = GROUP_ICONS[id as GroupActionId] ?? BONUS_ICONS[id as SproutBonusId];
  return `${price ? `${price} ` : ''}${icon ? icon + ICON_JOIN : ''}${SPROUT_BONUS_NAMES[id as SproutBonusId]}`;
};

// Цена покупок одного действия — как в движке (purchases): Скупщик на первую, Ветеран — минус 1 Талон на всё действие.
function buyCost(view: PlayerView, me: VPlayer, costs: number[]): number {
  let veteran = hasPatron(view, me.id, 'veteran');
  return costs.reduce((sum, c, i) => {
    let x = i === 0 ? priceFor(view, me, c) : c;
    if (veteran && x > 0) { x--; veteran = false; }
    return sum + x;
  }, 0);
}

// Подпись цены или дохода на кнопке: «(2🎫)» — заплатить, «(+2🎫, +1★)» — получить, «(даром)».
function costTag(talons: number, points = 0): string {
  const parts = [...(talons > 0 ? [`${talons}🎫`] : talons < 0 ? [`+${-talons}🎫`] : []), ...(points ? [`+${points}★`] : [])];
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// Цена с учётом Скупщика (на 1 Талон дешевле, минимум 1).
function priceFor(view: PlayerView, me: VPlayer, cost: number): number {
  return cost > 0 && hasPatron(view, me.id, 'buyer') ? Math.max(1, cost - 1) : cost;
}

// Можно ли закрыть ближайшую ступень Ростка книгами со склада (есть место в эту Пятилетку, с учётом Лаборанта).
function sproutOpen(view: PlayerView, me: VPlayer, sp: PlayerView['sprouts'][number]): boolean {
  const info = SPROUTS.find((s) => s.id === sp.id)!;
  const next = info.steps[sp.progress];
  const mine = me.warehouse.map((s) => s.card!).filter(Boolean);
  return !!next && freeSproutSlots(view, sp.id).length > 0
    && coversStep(view, mine, info.main, next.main, next.support, { wildScifi: view.mode === 'full', labtech: hasPatron(view, me.id, 'labtech') });
}

// Название места Ростка: его бонус (или «без бонуса», если бонуса в этом режиме нет).
const slotLabel = (view: PlayerView, me: VPlayer | null, b: SproutBonusId | null) => (b ? withPrice(view, me, b) : 'без бонуса');

// Почему этот Росток (или его место с бонусом slot) сейчас не покормить (null — можно).
function sproutWhy(view: PlayerView, me: VPlayer, sp: PlayerView['sprouts'][number], slot?: number): string | null {
  const info = SPROUTS.find((s) => s.id === sp.id)!;
  const next = info.steps[sp.progress];
  if (!next) return `Росток «${info.name}» уже дорощен до конца.`;
  if (!freeSproutSlots(view, sp.id).length) {
    return `На Ростке «${info.name}» в эту Пятилетку оба бонуса уже взяты — места заняты до следующей Пятилетки.`;
  }
  if (slot !== undefined && !freeSproutSlots(view, sp.id).includes(slot)) {
    return `Бонус «${slotLabel(view, me, sproutSlotBonuses(view, info)[slot])}» Ростка «${info.name}» в эту Пятилетку уже взят. Каждый бонус Ростка — одно место на Пятилетку.`;
  }
  if (sproutOpen(view, me, sp)) return null;
  const need = `${Array.from({ length: next.main }, () => `[${GENRE_SHORT[info.main]}]`).join(' ')}${next.support ? ` и значок поддержки [${GENRE_SHORT[next.support]}]` : ''}`;
  return `Для ступени ${roman(sp.progress + 1)} Ростка «${info.name}» нужно: ${need}. Таких книг у вас на складе не хватает${view.mode === 'full' && info.main !== 'scifi' && next.support !== 'scifi' ? ` ([${GENRE_SHORT.scifi}]\u00a0Фантастика может заменить недостающий значок)` : ''}.`;
}

// Можно ли издать книгу через Самиздат / Тамиздат.
function publishable(view: PlayerView, c: string, tamizdat: boolean): boolean {
  return isExposed(view, c) || !['propaganda', 'loadPropaganda'].includes(view.cards[c].kind)
    && (isGenreBook(view, c) && !isEvidence(view, c) || (tamizdat && isEvidence(view, c)));
}

// Почему поручение на адрес сейчас невозможно — не хватает Талонов, книг, места (null — можно).
function addressBlocker(view: PlayerView, me: VPlayer, id: AddressId): string | null {
  const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
  const books = me.warehouse.map((s) => s.card!).filter(Boolean);
  const talons = (cost: number) => (me.talons >= priceFor(view, me, cost) ? null : `Нужно ${priceFor(view, me, cost)}т, у вас ${me.talons}.`);
  const room = free > 0 ? null : 'На складе нет места.';
  // Склад полон, но заученного сборника нет: сборник поэзии можно купить — он сразу заучивается.
  const roomFor = (shelf: (string | null)[]) => (free > 0 || shelf.some((c) => c && canMemorizeOnBuy(view, me, c)) ? null
    : 'На складе нет места (купить без места можно только сборник поэзии, если заученного у вас ещё нет).');
  const sellable = books.filter((c) => isGenreBook(view, c) && !['evidence', 'loadEvidence', 'propaganda', 'loadPropaganda'].includes(view.cards[c].kind));
  switch (id) {
    case 'gostorg':
      return free < 2 ? 'Нужно 2 свободных места на складе.' : null;
    case 'tolkuchka': {
      const canBuy = view.tolkuchka.length > 0 && !roomFor(view.tolkuchka) && me.talons >= priceFor(view, me, RULES.tolkuchkaBuy);
      return canBuy || sellable.length ? null : 'Нечего продать и не на что (или некуда) купить.';
    }
    case 'razval': {
      const prices = view.razval.flatMap((c, i) => (c ? [priceFor(view, me, RULES.razvalPrices[i])] : []));
      if (!prices.length) return 'Развал пуст.';
      return roomFor(view.razval) ?? (me.talons >= Math.min(...prices) ? null : `Не хватает Талонов: самая дешёвая книга — ${Math.min(...prices)}т.`);
    }
    case 'baraholka':
      if (!view.baraholka.some(Boolean)) return 'На Барахолке не осталось книг.';
      // Без места можно найти и сразу заучить сборник поэзии.
      return (view.mode === 'full' && !me.warehouse.some((s) => s.memorized) ? null : room) ?? talons(RULES.baraholkaPrice);
    case 'podpiska':
      return talons(1);
    case 'sprouts':
      return view.sprouts.some((sp) => sproutOpen(view, me, sp)) ? null : 'Книг не хватает ни на одну ступень (или места Ростков заняты).';
    case 'samizdat':
    case 'tamizdat':
      return books.some((c) => publishable(view, c, id === 'tamizdat')) ? null : 'Нет книги, которую можно издать.';
    case 'glavlit':
      return books.length ? null : 'Сдавать нечего: склад пуст.';
    case 'makulatura':
      // Платить можно Талоном или любой книгой со склада.
      return books.length || me.talons >= RULES.makulaturaPrice ? null : 'Нечем платить: нужен Талон или книга на складе.';
    case 'knigoobmen':
      if (!view.knigoobmen.length) return 'Витрина пуста.';
      return books.some((c) => isGenreBook(view, c)) ? null : 'Нет жанровой книги для обмена.';
    case 'kvartirnik':
      if (!books.length) return 'Нечего предложить.';
      return view.players.some((o) => o.id !== me.id && o.warehouse.some((s) => s.card && !s.hidden)) ? null : 'Ни у кого нет книг на виду.';
    case 'raspredelitel':
      if (!view.raspredelitel.length) return 'Распределитель пуст.';
      return roomFor(view.raspredelitel) ?? talons(RULES.raspredelitelPrice);
    case 'agitpunkt':
      if (!(view.agitpunkt ?? []).length) return 'Витрина пуста.';
      return room;
    case 'nasledniki':
      if (!view.discardCount) return 'Сброс Непечатных пуст.';
      return room ?? talons(RULES.safehousePrice);
    case 'posrednichestvo':
      return room ?? talons(RULES.posrednichestvoPrice);
    case 'spisanie':
      return room ?? talons(RULES.spisaniePrice);
    case 'kontora':
      return kontoraTargets(view, me.id).length || view.players.some((p) => p.held > 0) ? null
        : 'Пришить дело не на что: ни у кого из соперников нет открыто лежащей книги опального жанра. И вызволять некого: Контора никого не удерживает.';
    default:
      return null;
  }
}

function addressFull(id: AddressId, view: PlayerView, me: VPlayer | null) {
  const here = view.occupancy[id] ?? [];
  const freeClub = id === 'club' && RULES.clubFreeGift; // Клуб — свободное действие, мест нет
  return !freeClub && (here.length >= limitFor(id, view.players.length) || (id === 'redCorner' && !!me && here.includes(me.id)));
}

function AddressCard(props: AddressProps) {
  const { id, view, seatIndex, me, enabled } = props;
  const info = ADDRESSES[id];
  const full = addressFull(id, view, me);
  const inlineHint = id === 'club'; // у Клуба описание — в строке заголовка, справа
  // Поручение можно дать нажатием на любое место адреса, не только на кнопку «сюда».
  const open = enabled && !full ? () => props.onOpen() : undefined;
  const explain = useContext(Explain);
  const why = props.why;
  // Нажатие на книгу на адресе — окно покупки с уже выбранной книгой.
  const onPick = open ? (key: string) => props.onOpen(key) : undefined;
  // На адресе — краткое описание; полное — подсказкой (наведение мышью или удержание пальцем).
  const tip = iconize(info.hint) + (props.blocked && !open ? `\nСейчас нельзя: ${props.blocked}` : '');
  // Порядок на телефоне: явочные — выше обычных (новые — первыми), обычные — в обратном порядке.
  const sIdx = props.view.safehouses.indexOf(id);
  const bIdx = BOARD_ORDER.indexOf(id);
  const mo = sIdx >= 0 ? 100 + props.view.safehouses.length - sIdx : bIdx >= 0 ? 200 + BOARD_ORDER.length - bIdx : 0;
  return (
    <div className={`address addr-${id} ${info.safehouse ? 'safehouse' : ''} ${open ? 'can' : ''}`} onClick={open ?? (why ? () => explain(why) : undefined)}
      role={open ? 'button' : undefined} title={tip} data-tip={tip} style={{ '--mo': mo } as React.CSSProperties}>
      <AddressHead {...props} inlineHint={inlineHint} />
      {!inlineHint && <div className="hint">{iconize(info.short)}</div>}
      <AddressContents id={id} view={view} seatIndex={seatIndex} me={me} onPatron={props.onPatron} onBlocked={props.onBlocked} onPick={onPick} />
    </div>
  );
}

// Заголовок адреса: название, жетоны Единомышленников и места (поручение — нажатием на сам адрес).
function AddressHead({ id, view, seatIndex, me, enabled, onOpen, inlineHint, rightHint }: AddressProps & { inlineHint?: boolean; rightHint?: string }) {
  const info = ADDRESSES[id];
  const here = view.occupancy[id] ?? [];
  const limit = limitFor(id, view.players.length);
  const freeClub = id === 'club' && RULES.clubFreeGift;
  // Красный уголок: кружки действий — в его списке очереди, а не в заголовке.
  const noDots = freeClub || id === 'redCorner';
  return (
      <div className="addr-head">
        <b>{ADDRESS_ICONS[id]}{ICON_JOIN}{info.name}</b>
        {inlineHint && <span className="hint inline">{iconize(info.short)}{freeClub && ' (1 раз за поручение, 👤 не нужен)'}</span>}
        <span className="workers">
          {rightHint && <span className="hint inline right" title={iconize(rightHint)} data-tip={iconize(rightHint)}>{iconize(info.short)}</span>}
          {!rightHint && !noDots && here.map((pid, i) => {
            // Номер на жетоне — каким по счёту в Пятилетке было это действие игрока.
            const k = here.slice(0, i).filter((x) => x === pid).length;
            const n = view.players.find((x) => x.id === pid)?.actions?.filter((a) => a.target === id)[k]?.n;
            return <span key={i} className="dot num" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} title={n ? `${n}-е действие игрока` : undefined}>{n ?? ''}</span>;
          })}
          {!noDots && !rightHint && (limit === Infinity
            ? <span className="muted small">∞</span>
            : Array.from({ length: Math.max(0, limit - here.length) }, (_, i) => <span key={`free${i}`} className="dot num slot-free" title="Свободное место" />))}
        </span>
      </div>
  );
}

function AddressContents({ id, view, seatIndex, me, onPatron, onBlocked, onPick }: { id: AddressId; view: PlayerView; seatIndex: (id: string) => number; me?: VPlayer | null; onPatron?: (id: PatronId) => void; onBlocked?: (id: PatronId) => void; onPick?: (key: string) => void }) {
  const pickBy = (key: string) => (onPick ? (e: { stopPropagation: () => void }) => { e.stopPropagation(); onPick(key); } : undefined);
  switch (id) {
    case 'club':
      return <ClubContents view={view} seatIndex={seatIndex} me={me} onPatron={onPatron} onBlocked={onBlocked} />;
    case 'kontora':
      return <KontoraContents view={view} seatIndex={seatIndex} />;
    case 'glavlit': {
      // Подсказка: сколько книг Спецхрана неизвестны этому игроку, затем — известные, по строке на книгу.
      const known = view.spetskhranKnown;
      const tip = [`Неизвестных книг: ${view.spetskhranCount - known.length}`, ...known.map((c) => bookTitle(view, c))].join('\n');
      return <div className="small spets" title={tip} data-tip={tip}>🗄️ Спецхран: <b>{view.spetskhranCount}</b> книг(и)</div>;
    }
    case 'redCorner': {
      // Кружок игрока с номером действия, которым он пришёл в Красный уголок.
      const dot = (pid: string) => {
        const n = view.players.find((x) => x.id === pid)?.actions?.find((a) => a.target === 'redCorner')?.n;
        return <span className="dot num" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} title={n ? `${n}-е действие игрока` : undefined}>{n ?? ''}</span>;
      };
      // Последняя Пятилетка: очередь не важна — кружки в ряд и пустые под тех, кто ещё не пришёл.
      if (view.round >= RULES.rounds) {
        return (
          <div className="workers">
            {view.nextOrder.map((pid) => <span key={pid}>{dot(pid)}</span>)}
            {Array.from({ length: Math.max(0, view.players.length - view.nextOrder.length) }, (_, i) => <span key={`f${i}`} className="dot num slot-free" />)}
          </div>
        );
      }
      // Новый порядок: сперва посетившие Красный уголок, затем остальные в прежнем порядке.
      const rest = view.order.filter((pid) => !view.nextOrder.includes(pid));
      const name = (pid: string) => view.players.find((p) => p.id === pid)?.name ?? '?';
      return (
        <div className="queue">
          <div className="muted small">Порядок хода в следующей Пятилетке:</div>
          <ol>
            {view.nextOrder.map((pid) => (
              <li key={pid}>{dot(pid)} {name(pid)}</li>
            ))}
            {rest.map((pid) => (
              <li key={pid} className="pending" title="Ещё не был(а) в Красном уголке: встанет после всех, кто был">
                <span className="dot num slot-free" style={{ borderColor: PLAYER_COLORS[seatIndex(pid)] }} /> {name(pid)} <span className="muted small">— ждём</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case 'tolkuchka':
      return <div className="shelf wrap">{view.tolkuchka.map((c) => <Book key={c} v={view} id={c} small price={RULES.tolkuchkaBuy} onClick={pickBy(c)} />)}{emptySlots(RULES.displaySize - view.tolkuchka.length)}</div>;
    case 'razval':
      return <div className="shelf wrap">{view.razval.map((c, i) => c ? <Book key={i} v={view} id={c} small price={RULES.razvalPrices[i]} onClick={pickBy(String(i))} /> : <div key={i} className="book empty small" />)}</div>;
    case 'baraholka':
      return <div className="shelf wrap">{view.baraholka.map((has, i) => has ? <Book key={i} v={view} id={view.baraholkaKnown?.[i] ?? null} small note={view.baraholkaKnown?.[i] ? 'вы видели' : undefined} onClick={pickBy(String(i))} /> : <div key={i} className="book empty small" />)}</div>;
    case 'knigoobmen':
      return <div className="shelf wrap">{view.knigoobmen.map((c) => <Book key={c} v={view} id={c} small onClick={pickBy(c)} />)}{emptySlots(RULES.displaySize - view.knigoobmen.length)}</div>;
    case 'agitpunkt':
      return <div className="shelf wrap">{(view.agitpunkt ?? []).map((c) => <Book key={c} v={view} id={c} small note="даром" onClick={pickBy(c)} />)}{emptySlots(RULES.agitpunktSize - (view.agitpunkt ?? []).length)}</div>;
    case 'raspredelitel':
      return <div className="shelf wrap">{view.raspredelitel.map((c) => <Book key={c} v={view} id={c} small price={RULES.raspredelitelPrice} onClick={pickBy(c)} />)}{emptySlots(RULES.raspredelitelSize - view.raspredelitel.length)}</div>;
    default:
      return null;
  }
}

function AddressPanel({ id, sprout, slot, pick, view, me, close, place }: { id: AddressId; sprout?: string; slot?: number; pick?: string; view: PlayerView; me: VPlayer; close: () => void; place: (p: PlaceAction) => void }) {
  const info = ADDRESSES[id];
  const mine = me.warehouse.map((s) => s.card!).filter(Boolean);
  const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
  const veteran = hasPatron(view, me.id, 'veteran');
  // Книга, на которую нажали на адресе, — сразу выбрана (на Книгообмене — та, что берёте с витрины).
  const [sel, setSel] = useState<string[]>(pick && id !== 'knigoobmen' ? [pick] : []);
  const [sel2, setSel2] = useState<string[]>(pick && id === 'knigoobmen' ? [pick] : []);
  const [num, setNum] = useState(1);
  const [genre, setGenre] = useState<Genre>('prose');
  const [loadN, setLoadN] = useState(1);
  // Свой заголовок окна (Ростки: второй шаг — «Бонус Ростка …»).
  const [title, setTitle] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(view.players.find((p) => p.id !== me.id)?.id ?? '');
  // Рядом с кнопкой — всегда, сколько у игрока Талонов (и предупреждение, если есть).
  const explain = useContext(Explain);
  const confirmBtn = (label: string, action: PlaceAction | null, extra?: string) => (
    <div className="modal-foot">
      <span className="muted">{extra ? `${extra} · ` : ''}у вас {me.talons}🎫</span>
      <button className={`primary ${action ? '' : 'off'}`} aria-disabled={!action}
        onClick={() => (action ? place(action) : explain(extra ?? 'Сначала выберите в этом окне, что сделать: книги, количество или жанр.'))}>{label}</button>
    </div>
  );
  const pickList = (books: string[], chosen: string[], set: (x: string[]) => void, opts?: { max?: number; note?: (c: string) => string; filter?: (c: string) => boolean }) => (
    <div className="shelf wrap">
      {books.length === 0 && <span className="muted">Нет подходящих книг</span>}
      {books.map((c) => {
        const ok = opts?.filter ? opts.filter(c) : true;
        return (
          <Book key={c} v={view} id={c} selected={chosen.includes(c)} note={opts?.note?.(c)}
            hidden={me.warehouse.find((s) => s.card === c)?.hidden}
            onClick={ok ? () => set(opts?.max === 1 ? (chosen.includes(c) ? [] : [c]) : toggle(chosen, c)) : undefined} />
        );
      })}
    </div>
  );

  let body;
  switch (id) {
    case 'gostorg': {
      const zavmag = hasPatron(view, me.id, 'zavmag');
      const loads = Math.min(loadN, 2);
      body = (
        <>
          <p>Бесплатно: 1 книга Нагрузки и 1 книга Непечатных вслепую. Свободных мест: {free}.</p>
          {zavmag && (
            <label>Завмаг: из 2 книг Нагрузки — <input type="number" min={0} max={2} value={loads} onChange={(e) => setLoadN(Number(e.target.value))} />, остальные — Непечатные</label>
          )}
          {confirmBtn('Взять даром', free >= 2
            ? { address: 'gostorg', pairs: 1, ...(zavmag ? { mix: [0, 1].map((i) => (i < loads ? 'load' as const : 'unprinted' as const)) } : {}) }
            : null, 'Нужно 2 свободных места')}
        </>
      );
      break;
    }
    case 'tolkuchka': {
      const sellable = mine.filter((c) => isGenreBook(view, c) && !['evidence', 'loadEvidence', 'propaganda', 'loadPropaganda'].includes(view.cards[c].kind));
      const price = (c: string) => (genresOf(view, c).some((g) => view.banned.includes(g)) || hasPatron(view, me.id, 'fartsovshchik') ? RULES.tolkuchkaSellBanned : RULES.tolkuchkaSellFree);
      const gain = sel2.reduce((s, c) => s + price(c), 0);
      const cost = buyCost(view, me, sel.map(() => RULES.tolkuchkaBuy));
      const ops = [...sel2.map((card) => ({ op: 'sell' as const, card })), ...sel.map((card) => ({ op: 'buy' as const, card }))];
      body = (
        <>
          <h4>{veteran ? `Купить (−${RULES.tolkuchkaBuy}т за книгу; Ветеран: сколько угодно, в сумме на 1 Талон дешевле)` : `Купить 1 книгу (−${RULES.tolkuchkaBuy}т)`}</h4>
          {pickList(view.tolkuchka, sel, setSel, { note: () => `${RULES.tolkuchkaBuy}т`, ...(veteran ? {} : { max: 1 }) })}
          <h4>{veteran ? 'Продать (Ветеран: сколько угодно)' : 'Продать 1 книгу'} (+{RULES.tolkuchkaSellBanned}т за книгу опального жанра, +{RULES.tolkuchkaSellFree}т за прочие)</h4>
          {pickList(sellable, sel2, setSel2, { note: (c) => `+${price(c)}т`, ...(veteran ? {} : { max: 1 }) })}
          {confirmBtn(`Совершить сделки${ops.length ? costTag(cost - gain) || ' (0🎫)' : ''}`, ops.length ? { address: 'tolkuchka', ops } : null)}
        </>
      );
      break;
    }
    case 'redCorner': {
      // Обязательная Нагрузка: нет места — отдать книгу Непечатных; склад весь в Нагрузке — не брать.
      const loadOnly = mine.every((c) => fromLoadDeck(view, c));
      const mustDrop = free <= 0 && !loadOnly;
      const droppable = mine.filter((c) => !fromLoadDeck(view, c));
      const drop = sel.find((c) => droppable.includes(c));
      body = (
        <>
          <p>Вы встанете в очередь хода следующей Пятилетки и обязательно возьмёте 1 книгу Нагрузки вслепую.</p>
          {free > 0 && <p className="muted">Место на складе есть — Нагрузка ляжет на свободное место.</p>}
          {free <= 0 && loadOnly && <p className="muted">Склад весь в Нагрузке — новую не берёте.</p>}
          {mustDrop && (
            <>
              <p className="warn-text">Для Нагрузки нет места: выберите книгу Непечатных, которую отдадите.</p>
              {pickList(droppable, sel, setSel, { max: 1 })}
            </>
          )}
          {confirmBtn('Пойти в Красный уголок', mustDrop ? (drop ? { address: 'redCorner', drop } : null) : { address: 'redCorner' },
            mustDrop && !drop ? 'Выберите книгу, которую отдать' : undefined)}
        </>
      );
      break;
    }
    case 'razval':
      body = (
        <>
          <p>{veteran ? 'Ветеран: купите сколько угодно книг, в сумме на 1 Талон дешевле.' : 'Купите 1 книгу.'} Цена зависит от свежести.</p>
          <div className="shelf wrap">
            {view.razval.map((c, i) => c && (
              <Book key={i} v={view} id={c} price={RULES.razvalPrices[i]} selected={sel.includes(String(i))}
                onClick={() => setSel(veteran ? toggle(sel, String(i)) : [String(i)])} />
            ))}
          </div>
          {confirmBtn(`Купить${costTag(buyCost(view, me, sel.map((i) => RULES.razvalPrices[Number(i)])))}`, sel.length && roomToBuy(view, me, sel.map((i) => view.razval[Number(i)]!)) ? { address: 'razval', slot: Number(sel[0]), ...(sel.length > 1 ? { slots: sel.map(Number) } : {}) } : null,
            !sel.length || roomToBuy(view, me, sel.map((i) => view.razval[Number(i)]!)) ? undefined : 'Нет места на складе')}
          {free <= 0 && sel.some((i) => canMemorizeOnBuy(view, me, view.razval[Number(i)]!)) && <p className="muted small">Места на складе нет — сборник поэзии сразу станет заученным.</p>}
        </>
      );
      break;
    case 'zavoz':
      body = <><p>Получите {RULES.zavozIncome} Талона. Всё, что лежит на Развале, уйдёт в сброс, и Развал заполнится новыми книгами.</p>{confirmBtn(`Подработать${costTag(-RULES.zavozIncome)}`, { address: 'zavoz' })}</>;
      break;
    case 'baraholka': {
      const need = Math.min(RULES.baraholkaLook, view.baraholka.filter(Boolean).length);
      // Выбор по кругу: новая книга вытесняет самую раннюю из выбранных.
      const pick = (i: string) => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].slice(-need));
      body = (
        <>
          <p>Выберите {need === 1 ? 'закрытую книгу' : `${need} закрытые книги`}. Вы тайно посмотрите их и сможете купить одну за {RULES.baraholkaPrice}т.
            {view.baraholkaKnown?.some(Boolean) && ' Открытые — те, что вы уже видели.'}</p>
          <div className="shelf grid2">
            {view.baraholka.map((has, i) => has && (view.baraholkaKnown?.[i]
              ? <Book key={i} v={view} id={view.baraholkaKnown[i]} selected={sel.includes(String(i))} onClick={() => pick(String(i))} note="вы видели" />
              : <button key={i} className={`book back ${sel.includes(String(i)) ? 'selected' : ''} clickable`} onClick={() => pick(String(i))}><span>{i + 1}</span></button>
            ))}
          </div>
          {confirmBtn('Посмотреть', sel.length === need ? { address: 'baraholka', slots: sel.map(Number) } : null)}
        </>
      );
      break;
    }
    case 'podpiska': {
      const maxRounds = RULES.rounds - view.round + 1;
      body = (
        <>
          <p>Закажите жанр: книга этого жанра будет приходить вам в конце фазы поручений — столько Пятилеток, сколько Талонов заплачено (начиная с этой).</p>
          <div className="genres">{GENRES.map((g) => <button key={g} className={genre === g ? 'selected' : ''} onClick={() => setGenre(g)}><GenreChip g={g} /> {GENRE_NAMES[g]}</button>)}</div>
          <label>Пятилеток: <input type="number" min={1} max={maxRounds} value={num} onChange={(e) => setNum(Number(e.target.value))} /></label>
          {confirmBtn(`Подписаться${costTag(priceFor(view, me, num))}`, num >= 1 && num <= maxRounds && num <= me.talons ? { address: 'podpiska', genre, talons: num } : null)}
        </>
      );
      break;
    }
    case 'sprouts':
      body = <SproutFeeder view={view} me={me} place={place} initial={sprout} initialSlot={slot} setTitle={setTitle} />;
      break;
    case 'samizdat':
    case 'tamizdat': {
      const ok = (c: string) => isExposed(view, c) || !['propaganda', 'loadPropaganda'].includes(view.cards[c].kind) && (isGenreBook(view, c) && !isEvidence(view, c) || (id === 'tamizdat' && isEvidence(view, c)));
      const n = sel[0] ? iconCount(view, sel[0]) + (isExposed(view, sel[0]) ? 1 : 0) : 0;
      body = (
        <>
          <p>Издайте одну книгу: она навсегда спасена, место на складе освобождается, а в подсчёте по Пристрастию книга участвует. {id === 'tamizdat' ? `+${RULES.tamizdatTalons}т и +${RULES.tamizdatPoints} очка за значок.` : `+${RULES.samizdatPoints} очка за значок.`}</p>
          {pickList(mine.filter(ok), sel, setSel, { max: 1 })}
          {confirmBtn(`Издать${sel.length ? costTag(-n * (id === 'tamizdat' ? RULES.tamizdatTalons : 0), n * (id === 'tamizdat' ? RULES.tamizdatPoints : RULES.samizdatPoints)) : ''}`, sel.length ? { address: id, card: sel[0] } : null)}
        </>
      );
      break;
    }
    case 'glavlit': {
      const komsorg = hasPatron(view, me.id, 'komsorg');
      const editor = hasPatron(view, me.id, 'editor');
      const unprinted = sel.filter((c) => !fromLoadDeck(view, c)).length;
      const load = sel.filter((c) => fromLoadDeck(view, c)).length;
      const pts = (komsorg ? sel.length * RULES.komsorgPoints : 0) + (editor ? sel.reduce((s, c) => s + iconCount(view, c), 0) : 0);
      body = (
        <>
          <p>Сдайте до 1 Непечатной книги (+{RULES.glavlitUnprinted}т) и до 1 книги Нагрузки (+{RULES.glavlitLoad}т). {withKindChips('ЧНЛ можно сбыть только здесь.')}</p>
          {komsorg && <p className="muted small">Комсорг: можно сдать любое число книг, за каждую — +{RULES.komsorgPoints} очко Гласности.</p>}
          {editor && <p className="muted small">Главред: +1 очко Гласности за каждый значок сданных книг.</p>}
          {pickList(mine, sel, setSel)}
          {confirmBtn(`Сдать в Главлит${costTag(-(unprinted * RULES.glavlitUnprinted + load * RULES.glavlitLoad), pts)}`,
            sel.length && ((unprinted <= 1 && load <= 1) || komsorg) ? { address: 'glavlit', recycle: sel } : null,
            !komsorg && (unprinted > 1 || load > 1) ? 'Слишком много книг' : !sel.length ? 'Выберите книги' : undefined)}
        </>
      );
      break;
    }
    case 'knigoobmen':
      body = (
        <>
          <h4>Отдайте жанровую книгу</h4>
          {pickList(mine.filter((c) => isGenreBook(view, c)), sel, setSel, { max: 1 })}
          <h4>Возьмите книгу с витрины</h4>
          {pickList(view.knigoobmen, sel2, setSel2, { max: 1 })}
          {confirmBtn('Обменять', sel.length && sel2.length ? { address: 'knigoobmen', give: sel[0], take: sel2[0] } : null)}
        </>
      );
      break;
    case 'kvartirnik': {
      const other = view.players.find((p) => p.id === target);
      body = (
        <>
          <p>Предложите обмен другому игроку. Он может согласиться или отказаться.</p>
          <label>С кем: <Dropdown value={target} ariaLabel="С кем обмен" onChange={(t) => { setTarget(t); setSel2([]); }}
            options={view.players.filter((p) => p.id !== me.id).map((p) => ({ value: p.id, label: p.name }))} /></label>
          <h4>Что вы просите</h4>
          {pickList((other?.warehouse ?? []).filter((s) => !s.hidden && s.card).map((s) => s.card!), sel2, setSel2, { max: 1 })}
          <h4>Что вы отдаёте</h4>
          {pickList(mine, sel, setSel, { max: 1 })}
          {confirmBtn('Предложить', sel.length && sel2.length ? { address: 'kvartirnik', to: target, give: sel[0], want: sel2[0] } : null)}
        </>
      );
      break;
    }
    case 'raspredelitel':
      body = (
        <>
          {veteran && <p className="muted small">Ветеран: купите сколько угодно книг, в сумме на 1 Талон дешевле.</p>}
          {pickList(view.raspredelitel, sel, setSel, veteran ? {} : { max: 1 })}
          {confirmBtn(`Купить${costTag(buyCost(view, me, (sel.length ? sel : ['']).map(() => RULES.raspredelitelPrice)))}`, sel.length && roomToBuy(view, me, sel)
            ? { address: 'raspredelitel', card: sel[0], ...(sel.length > 1 ? { cards: sel } : {}) } : null)}
          {free <= 0 && sel.some((c) => canMemorizeOnBuy(view, me, c)) && <p className="muted small">Места на складе нет — сборник поэзии сразу станет заученным.</p>}
        </>
      );
      break;
    case 'agitpunkt':
      body = (
        <>
          <p>{info.hint}.{veteran && ' Ветеран: можно взять сколько угодно книг.'}</p>
          {pickList(view.agitpunkt ?? [], sel, setSel, veteran ? {} : { max: 1 })}
          {confirmBtn('Взять (даром)', sel.length && free >= sel.length
            ? { address: 'agitpunkt', card: sel[0], ...(sel.length > 1 ? { cards: sel } : {}) } : null, free < Math.max(1, sel.length) ? 'Нет места на складе' : undefined)}
        </>
      );
      break;
    case 'club':
      body = <ClubPanel view={view} me={me} place={place} />;
      break;
    case 'kontora':
      body = <KontoraPanel view={view} place={place} />;
      break;
    case 'makulatura':
      body = <><p>{info.hint}.</p>{confirmBtn(`Пойти в Макулатуру (${priceFor(view, me, RULES.makulaturaPrice)}🎫 или книга за каждую)`, me.talons >= RULES.makulaturaPrice || mine.length ? { address: 'makulatura' } : null,
        'Нечем платить: нужен Талон или книга на складе')}</>;
      break;
    case 'nasledniki':
    case 'posrednichestvo':
    case 'spisanie':
      body = <><p>{info.hint}</p>{confirmBtn(`Пойти${costTag(priceFor(view, me, safehouseCost(id)))}`, me.talons >= safehouseCost(id) && free > 0 ? { address: id } : null,
        free <= 0 ? 'Нет места на складе' : me.talons < safehouseCost(id) ? `Не хватает Талонов: нужно ${safehouseCost(id)}, у вас ${me.talons}` : undefined)}</>;
      break;
  }
  return <Modal title={title ?? addressLabel(id)} onClose={close} wide>{body}</Modal>;
}

// ---------- Ростки ----------

function stepText(main: Genre, step: { main: number; support?: Genre }) {
  return (
    <>
      {Array.from({ length: step.main }, (_, i) => <GenreChip key={i} g={main} />)}
      {step.support && <>+<GenreChip g={step.support} /></>}
    </>
  );
}

// Ростки Гласности вместе с их действием («сюда →» — закрыть ступени).
// onOpen — поручение на Ростки: нажатие на конкретный Росток — сразу к его ступени (на панель — общий выбор).
// Полное описание Ростков — подсказкой со всей их зоны.
const SPROUTS_TIP = `${ADDRESSES.sprouts.hint}. Гласность: ${RULES.glasnostAllSprouts ? 'все Ростки' : 'хотя бы один Росток'} до ступени ${roman(RULES.glasnostStep)}.`;

// why — почему Ростки недоступны целиком; turnWhy — то же без причин самих Ростков (тогда объясняем про конкретный Росток).
function Sprouts({ view, me, beside, seatIndex, head, onOpen, why, turnWhy }: { view: PlayerView; me: VPlayer | null; beside: boolean; seatIndex: (id: string) => number; head: ReactNode; onOpen?: (sprout?: string, slot?: number) => void; why?: string | null; turnWhy?: string | null }) {
  const explain = useContext(Explain);
  return (
    <div className={`sprouts-panel address addr-sprouts ${beside ? 'beside' : ''} ${onOpen ? 'can' : ''}`} onClick={onOpen ? () => onOpen() : why ? () => explain(why) : undefined}
      role={onOpen ? 'button' : undefined} title={iconize(SPROUTS_TIP)} data-tip={iconize(SPROUTS_TIP)}>
      {head}
      <div className="sprouts">
      {view.sprouts.map((sp) => {
        const info = SPROUTS.find((s) => s.id === sp.id)!;
        // Росток доступен: не дорощен до конца, есть место в эту Пятилетку и книг хватает на ближайшую ступень (с Лаборантом — со скидкой).
        const open = !!onOpen && !!me && sproutOpen(view, me, sp);
        return (
          <div key={sp.id} className={`sprout ${sp.progress >= RULES.glasnostStep ? 'grown' : ''} ${open ? 'can' : ''} ${sp.progress >= 4 ? 'off' : ''}`}
            role={open ? 'button' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (open) { onOpen!(sp.id); return; }
              const w = turnWhy ?? (me ? sproutWhy(view, me, sp) : null) ?? why;
              if (w) explain(w);
            }}>
            <div className="addr-head"><b>{info.name}</b></div>
            <ol className="steps">
              {info.steps.map((st, i) => (
                <li key={i} className={i < sp.progress ? 'done' : i === sp.progress ? 'next' : ''}>
                  {stepText(info.main, st)}
                  <span className="muted small"> {[STEP_REWARDS[i].talons ? `+${STEP_REWARDS[i].talons}т` : '', STEP_REWARDS[i].points ? `+${STEP_REWARDS[i].points}★` : ''].filter(Boolean).join(' ')}</span>
                </li>
              ))}
            </ol>
            {/* Места Ростка: у каждого бонуса — своё место на Пятилетку; нажатие на свободное — питать ступень с этим бонусом. */}
            <div className="bonus-slots" title="Бонус за питание ступени: у каждого бонуса — одно место на Пятилетку">
              {sproutSlotBonuses(view, info).map((b, i) => {
                const k = (view.sproutRoundSlot?.[sp.id] ?? []).indexOf(i);
                const pid = k >= 0 ? view.sproutRound?.[sp.id]?.[k] : undefined;
                const n = k >= 0 ? view.sproutRoundN?.[sp.id]?.[k] : undefined;
                const can = open && k < 0;
                return (
                  <div key={i} className={`bonus-slot ${can ? 'can' : ''}`} role={can ? 'button' : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (can) { onOpen!(sp.id, i); return; }
                      const w = turnWhy ?? (me ? sproutWhy(view, me, sp, i) : null) ?? why;
                      if (w) explain(w);
                    }}>
                    {/* Как действия Группы на планшете игрока: значок и название, справа цена и кружок места. */}
                    <span className="muted bonus">
                      {GROUP_ICONS[b as GroupActionId] ?? BONUS_ICONS[b as SproutBonusId]}{ICON_JOIN}{SPROUT_BONUS_NAMES[b]}
                      {groupPrice(view, me, b) && <span className="gprice"> {groupPrice(view, me, b)}</span>}
                      {pid
                        ? <span className="dot num inline" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} title={n ? `${n}-е действие игрока` : undefined}>{n ?? ''}</span>
                        : <span className="dot num inline slot-free" />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function SproutFeeder({ view, me, place, initial, initialSlot, setTitle }: { view: PlayerView; me: VPlayer; place: (p: PlaceAction) => void; initial?: string; initialSlot?: number; setTitle: (t: string | null) => void }) {
  const [feeds, setFeeds] = useState<{ sprout: string; books: string[]; slot?: number; labtech?: boolean }[]>([]);
  const progressOf = (id: string, fs = feeds) => view.sprouts.find((s) => s.id === id)!.progress + fs.filter((f) => f.sprout === id).length;
  const wildScifi = view.mode === 'full';
  // Сразу отмечаем лучшие книги для ступени: меньше всего значков суммарно.
  const suggest = (id: string, fs = feeds): string[] => {
    const inf = SPROUTS.find((s) => s.id === id);
    const st = inf?.steps[progressOf(id, fs)];
    if (!inf || !st) return [];
    const taken = fs.flatMap((f) => f.books);
    const pool = me.warehouse.map((s) => s.card!).filter((c) => c && !taken.includes(c));
    const labtech = hasPatron(view, me.id, 'labtech') && !fs.some((f) => f.labtech);
    return bestFeedBooks(view, pool, inf.main, st.main, st.support, { wildScifi, labtech })?.books ?? [];
  };
  const [sprout, setSprout] = useState<string>(initial ?? '');
  const [books, setBooks] = useState<string[]>(() => (initial ? suggest(initial) : []));
  // Место (бонус) Ростка: свободное, по умолчанию — то, на которое нажали, иначе первое свободное.
  const freeSlots = (id: string) => freeSproutSlots(view, id).filter((i) => !feeds.some((f) => f.sprout === id && f.slot === i));
  // Нажали на кружок бонуса — бонус уже выбран; иначе он выбирается в следующем окне («Бонус Ростка …»).
  const [slot, setSlot] = useState<number | undefined>(() => (initial ? initialSlot : undefined));
  const [choosing, setChoosing] = useState(false);
  const used = feeds.flatMap((f) => f.books);
  const mine = me.warehouse.map((s) => s.card!).filter((c) => c && !used.includes(c));
  const info = SPROUTS.find((s) => s.id === sprout);
  const step = info && info.steps[progressOf(sprout)];
  const plain = !!info && !!step && coversStep(view, books, info.main, step.main, step.support, { wildScifi });
  // Лаборант: скидка в 1 значок — один раз за поручение.
  const discount = !plain && !!info && !!step && hasPatron(view, me.id, 'labtech') && !feeds.some((f) => f.labtech)
    && coversStep(view, books, info.main, step.main, step.support, { wildScifi, labtech: true });
  const ok = plain || discount;
  // Отдать ступень с выбранным бонусом: последняя ступень поручения — сразу поручение, иначе — к следующей ступени.
  const commit = (sl: number) => {
    setChoosing(false); setTitle(null);
    if (feeds.length + 1 >= RULES.sproutFeedsPerAction) {
      place({ address: 'sprouts', feeds: [...feeds.map(({ labtech: _, ...f }) => f), { sprout, books, slot: sl }] });
      return;
    }
    const fs = [...feeds, { sprout, books, slot: sl, labtech: discount }];
    setFeeds(fs); setBooks(suggest(sprout, fs)); setSlot(undefined);
  };
  // Дальше: бонус уже известен (нажали на его кружок) или свободен только один — сразу; иначе — окно выбора бонуса.
  const next = () => {
    const free = freeSlots(sprout);
    if (slot !== undefined && free.includes(slot)) commit(slot);
    else if (free.length === 1) commit(free[0]);
    else { setChoosing(true); setTitle(`Бонус Ростка «${info!.name}»`); }
  };
  if (choosing && info) {
    return (
      <>
        <p>Ступень {roman(progressOf(sprout) + 1)} Ростка «{info.name}» питается книгами: {books.map((b) => view.cards[b].title).join(', ')}. Выберите бонус — у каждого бонуса одно место на Пятилетку.</p>
        <div className="genres">
          {sproutSlotBonuses(view, info).map((b, i) => (
            <button key={i} disabled={!freeSlots(sprout).includes(i)} onClick={() => commit(i)}
              title={freeSlots(sprout).includes(i) ? undefined : 'Этот бонус в эту Пятилетку уже взят'}>{slotLabel(view, me, b)}</button>
          ))}
        </div>
        <div className="modal-foot"><button onClick={() => { setChoosing(false); setTitle(null); }}>← К выбору книг</button></div>
      </>
    );
  }
  const only = info ? freeSlots(sprout) : [];
  const fixed = slot !== undefined && only.includes(slot) ? slot : only.length === 1 ? only[0] : undefined;
  const fixedNote = info && fixed !== undefined ? ` — бонус: ${slotLabel(view, me, sproutSlotBonuses(view, info)[fixed])}` : '';
  return (
    <>
      <p>Питайте ступень: отдайте книги, на которых есть все значки ступени. Лучшие книги (меньше всего значков) уже отмечены — их можно заменить. Бонус Ростка — в следующем окне. {RULES.sproutFeedsPerAction === 1 ? 'За одно поручение — только 1 ступень одного Ростка.' : `За одно поручение — до ${RULES.sproutFeedsPerAction} ступеней у разных Ростков.`}</p>
      <div className="genres">
        {view.sprouts.map((sp) => {
          const inf = SPROUTS.find((s) => s.id === sp.id)!;
          const pr = progressOf(sp.id);
          return (
            <button key={sp.id} disabled={pr >= 4 || !freeSlots(sp.id).length} className={sprout === sp.id ? 'selected' : ''} onClick={() => { setSprout(sp.id); setBooks(suggest(sp.id)); setSlot(undefined); }}>
              {inf.name} · ступень {roman(pr + 1)}: {pr < 4 ? stepText(inf.main, inf.steps[pr]) : '—'}
            </button>
          );
        })}
      </div>
      {info && step && (
        <>
          <h4>Книги для ступени {roman(progressOf(sprout) + 1)}</h4>
          <div className="shelf wrap">
            {mine.map((c) => <Book key={c} v={view} id={c} selected={books.includes(c)} onClick={() => setBooks(toggle(books, c))} />)}
          </div>
          <div className="modal-foot">
            <button className={feeds.length + 1 >= RULES.sproutFeedsPerAction ? 'primary' : ''} disabled={!ok} onClick={next}>
              {fixed !== undefined
                ? `${feeds.length + 1 >= RULES.sproutFeedsPerAction ? 'Питать ступень' : 'Добавить ступень'}${discount ? ' (скидка Лаборанта)' : ''}${fixedNote}`
                : `Дальше: бонус Ростка${discount ? ' (скидка Лаборанта)' : ''}`}
            </button>
          </div>
        </>
      )}
      {feeds.length > 0 && (
        <ul>{feeds.map((f, i) => <li key={i}>{SPROUTS.find((s) => s.id === f.sprout)!.name}: {f.books.map((b) => view.cards[b].title).join(', ')}</li>)}</ul>
      )}
      {RULES.sproutFeedsPerAction > 1 && (
        <div className="modal-foot">
          <button className="primary" disabled={!feeds.length} onClick={() => place({ address: 'sprouts', feeds: feeds.map(({ labtech: _, ...f }) => f) })}>Питать ступени ({feeds.length})</button>
        </div>
      )}
    </>
  );
}

// ---------- Инициативная группа ----------

// Почему действие Группы сейчас невозможно (null — возможно).
function groupBlocker(view: PlayerView, me: VPlayer, id: GroupActionId): string | null {
  const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
  switch (id) {
    case 'hire':
      if (me.workers >= RULES.maxWorkers) return `У вас уже максимум 👤 (${RULES.maxWorkers}).`;
      if (me.talons < priceFor(view, me, RULES.hireCost)) return `Нужно ${priceFor(view, me, RULES.hireCost)} Талонов, у вас ${me.talons} — не хватает ${priceFor(view, me, RULES.hireCost) - me.talons}.`;
      return null;
    case 'expandWarehouse':
      if (me.capacity >= RULES.maxCapacity) return `Склад уже максимального размера (${RULES.maxCapacity}).`;
      return me.talons < RULES.expandWarehouseCost ? `Нужно ${RULES.expandWarehouseCost} Талон, у вас ${me.talons}.` : null;
    case 'expandCache':
      if (me.cache >= RULES.maxCache) return `Тайник уже максимального размера (${RULES.maxCache}).`;
      return me.talons < RULES.expandCacheCost && !hasPatron(view, me.id, 'carpenter') ? `Нужно ${RULES.expandCacheCost} Талон, у вас ${me.talons}.` : null;
    case 'copyText': {
      if (free < 1) return 'На складе нет свободного места.';
      return copySources(view, me).length ? null : 'Нет открытых книг там, где стоит ваш 👤 (Развал, Толкучка, Распределитель, Книгообмен, Агитпункт).';
    }
    case 'spetskhran':
      if (!view.spetskhranCount) return 'Спецхран пуст.';
      if (me.talons < priceFor(view, me, RULES.spetskhranCost)) return `Нужно ${priceFor(view, me, RULES.spetskhranCost)}т, у вас ${me.talons}.`;
      return free < 1 ? 'На складе нет свободного места.' : null;
    case 'restore':
      if (me.talons < RULES.restoreCost) return `Нужно ${RULES.restoreCost}т, у вас ${me.talons}.`;
      return me.warehouse.some((s) => s.card && !view.restored[s.card] && restorable(view.cards[s.card].kind))
        ? null : 'На складе нет книги, о которой можно написать монографию.';
    default:
      return null;
  }
}

function GroupPanel({ id, view, me, close, done, title }: { id: GroupActionId; view: PlayerView; me: VPlayer; close?: () => void; done: (g: GroupAction) => void; title?: string }) {
  const info = GROUP_ACTIONS[id];
  const [sel, setSel] = useState<string>('');
  const blocker = groupBlocker(view, me, id);
  let body;
  if (blocker) {
    body = (
      <>
        <p>{withKindChips(info.hint)}</p>
        <p className="warn-text">Сейчас нельзя. {blocker}</p>
        <div className="modal-foot">{close && <button onClick={close}>Понятно</button>}<button className="primary" disabled>Выполнить</button></div>
      </>
    );
  } else if (id === 'copyText') {
    body = <CopyTextPanel view={view} me={me} done={done} />;
  } else if (id === 'restore') {
    const cands = me.warehouse.map((s) => s.card!).filter((c) => c && !view.restored[c] && restorable(view.cards[c].kind));
    body = (
      <>
        <p>Жанровая книга получает +1 значок своего жанра; у двужанровой книги жанр этого значка выбирается всякий раз, когда это важно. Нагрузка проглоченного автора становится возвращённым произведением с 3 значками.{RULES.exposePropaganda && withKindChips(` ЧНЛ становится Разоблачением: +${RULES.exposePoints} очка в конце, его можно издать как книгу с 1 значком.`)}</p>
        <div className="shelf wrap">{cands.map((c) => <Book key={c} v={view} id={c} selected={sel === c} onClick={() => setSel(c)} />)}</div>
        <div className="modal-foot"><span className="muted">у вас {me.talons}🎫</span><button className="primary" disabled={!sel} onClick={() => done({ action: 'restore', card: sel })}>Написать Монографию{groupPrice(view, me, 'restore') ? ` (${groupPrice(view, me, 'restore')})` : ''}</button></div>
      </>
    );
  } else {
    body = (
      <>
        <p>{withKindChips(info.hint)}</p>
        <div className="modal-foot"><span className="muted">у вас {me.talons}🎫</span><button className="primary" onClick={() => done({ action: id } as GroupAction)}>Выполнить{groupPrice(view, me, id) ? ` (${groupPrice(view, me, id)})` : ''}</button></div>
      </>
    );
  }
  return <Modal title={title ?? info.name} onClose={close}>{body}</Modal>;
}

// Откуда можно тиражировать: адреса с открытыми книгами, где уже стоит свой 👤 (Машинистке — любые).
function copySources(view: PlayerView, me: VPlayer): { address: CopyTextAddress; cards: string[] }[] {
  const typist = hasPatron(view, me.id, 'typist');
  return COPY_TEXT_ADDRESSES
    .filter((a) => addressInGame(view, a) || view.safehouses.includes(a))
    .filter((a) => typist || (view.occupancy[a] ?? []).includes(me.id))
    .map((address) => ({ address, cards: (address === 'razval' ? view.razval : view[address] ?? []).filter((c): c is string => !!c) }))
    .filter((x) => x.cards.length > 0);
}

// Тиражировать Текст: бесплатно взять открытую книгу с адреса, где уже стоит ваш 👤.
function CopyTextPanel({ view, me, done }: { view: PlayerView; me: VPlayer; done: (g: GroupAction) => void }) {
  const [pick, setPick] = useState<{ address: CopyTextAddress; card: string } | null>(null);
  const typist = hasPatron(view, me.id, 'typist');
  return (
    <>
      <p>{withKindChips(GROUP_ACTIONS.copyText.hint)}.{typist ? ` Машинистка: с любого адреса, +${RULES.typistTalons}т.` : ''}</p>
      {copySources(view, me).map(({ address, cards }) => (
        <div key={address}>
          <h4>{addressLabel(address)}</h4>
          <div className="shelf wrap">
            {cards.map((c) => <Book key={c} v={view} id={c} selected={pick?.card === c} onClick={() => setPick({ address, card: c })} />)}
          </div>
        </div>
      ))}
      <div className="modal-foot"><button className="primary" disabled={!pick} onClick={() => pick && done({ action: 'copyText', ...pick })}>Тиражировать</button></div>
    </>
  );
}

// ---------- Решения ----------

// cancel — отменить последний шаг (решение, вызванное своим же действием, — например, подарком Главлитовцу).
function PendingPrompt({ view, me, act, nameOf, cancel }: { view: PlayerView; me: VPlayer; act: (a: Action) => void; nameOf: (id: string) => string; cancel?: () => void }) {
  const p = view.pending[0];
  const [sel, setSel] = useState<string[]>([]);
  const [groupFor, setGroupFor] = useState<SproutBonusId | 'posred' | null>(null);
  // Бонус Ростка уже выбран в окне питания (место Ростка = один бонус) — не спрашиваем второй раз: сразу выполняем,
  // а если бонусу нужны подробности (с кем знакомиться, что тиражировать…) — сразу открываем их окно.
  const autoBonus = useRef<string | null>(null);
  const bonusKey = !('secret' in p) && p.kind === 'sproutBonus' && p.options.length === 1 ? `${view.log.length}:${p.sprout}:${p.options[0]}` : null;
  useEffect(() => {
    if (!bonusKey || autoBonus.current === bonusKey || 'secret' in p || p.kind !== 'sproutBonus') return;
    autoBonus.current = bonusKey;
    const o = p.options[0];
    const send = (a: Action) => { setHold(bonusKey); setTimeout(() => setHold(null), 3000); act(a); };
    if (o === 'sideJob' || o === 'underCounter') send({ type: 'sproutBonus', bonus: o });
    else if (o === 'acquaintance' || o === 'copyText' || o === 'restore' || groupBlocker(view, me, o as GroupActionId)) setGroupFor(o);
    else send({ type: 'sproutBonus', bonus: o, group: { action: o } as GroupAction });
  }, [bonusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Пока бонус уходит на сервер — окно не показываем (иначе оно мелькнёт); не дошёл за 3 с — окно вернётся.
  const [hold, setHold] = useState<string | null>(null);
  if ('secret' in p) return null;
  if (bonusKey && (autoBonus.current !== bonusKey || hold === bonusKey)) return null;
  switch (p.kind) {
    case 'kontoraWarning':
      return <KontoraWarningPrompt view={view} me={me} from={p.from} act={act} />;
    case 'kontoraDecide':
      return <KontoraDecidePrompt view={view} me={me} act={act} />;
    case 'kontoraHandout':
      return <HandoutPrompt view={view} cards={p.cards} act={act} group={p.group} />;
    case 'freeConnection':
      return <FreeConnectionPrompt view={view} me={me} act={act} />;
    case 'catalogPick': {
      // Каталогизатор: верхний или нижний набор книг стопки.
      const deck = p.deck === 'load' ? 'стопка Нагрузки' : p.deck === 'discard' ? 'сброс Непечатных (Библиотекарь)' : 'стопка Непечатных';
      return (
        <Modal title={`Каталогизатор: ${deck}`} wide>
          <p>Выберите, какие книги взять: сверху или снизу. Невыбранные останутся на своём месте.</p>
          <h4>Сверху</h4>
          <div className="shelf wrap">{p.top.map((c) => <Book key={c} v={view} id={c} />)}</div>
          <h4>Снизу</h4>
          <div className="shelf wrap">{p.bottom.map((c) => <Book key={c} v={view} id={c} />)}</div>
          <div className="modal-foot">
            <button className="primary" onClick={() => act({ type: 'catalogPick', from: 'top' })}>Взять сверху</button>
            <button className="primary" onClick={() => act({ type: 'catalogPick', from: 'bottom' })}>Взять снизу</button>
          </div>
        </Modal>
      );
    }
    case 'blatnoyBuy': {
      // Блатной: ещё одна книга в другом месте — по обычной цене.
      const opts = blatnoyOptions(view as never, me as never, p.from);
      const where = { razval: 'Развал', tolkuchka: 'Толкучка', raspredelitel: 'Распределитель' } as const;
      return (
        <Modal title="Блатной: ещё одна книга" wide>
          <p>За то же действие можно купить ещё одну книгу в другом месте — по обычной цене. У вас {me.talons}🎫.</p>
          {(['razval', 'tolkuchka', 'raspredelitel'] as const).filter((a) => opts.some((o) => o.address === a)).map((a) => (
            <div key={a}>
              <h4>{addressIcons(where[a])}</h4>
              <div className="shelf wrap">
                {opts.filter((o) => o.address === a).map((o) => <Book key={o.card} v={view} id={o.card} price={o.cost} onClick={() => act({ type: 'blatnoyBuy', address: a, card: o.card })} />)}
              </div>
            </div>
          ))}
          <div className="modal-foot"><button onClick={() => act({ type: 'pass' })}>Не покупать</button></div>
        </Modal>
      );
    }
    case 'makulatura': {
      // Вытянутые книги и свои книги со склада не пересекаются: выбранная вытянутая — оставить, своя — отдать в уплату.
      const own = me.warehouse.map((s) => s.card!).filter(Boolean);
      const keep = sel.find((c) => p.cards.includes(c));
      const pay = sel.find((c) => own.includes(c));
      const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
      const can = !!pay || me.talons >= RULES.makulaturaPrice;
      const cost = pay ? `отдать «${view.cards[pay].title}»` : `−${RULES.makulaturaPrice}т`;
      const pick = (c: string, mineCard: boolean) => setSel([...sel.filter((x) => (mineCard ? !own.includes(x) : own.includes(x))), ...(sel.includes(c) ? [] : [c])]);
      return (
        <Modal title="Макулатура" wide>
          <p>Тяните книги из любой стопки — сколько хотите, за каждую {RULES.makulaturaPrice}т или любая книга со склада (уйдёт в сброс). Потом оставьте себе одну, остальные уйдут в сброс. Талонов: {me.talons}.</p>
          <h4>Вытянуто</h4>
          <div className="shelf wrap">
            {p.cards.length === 0 && <span className="muted">Пока ничего не вытянуто</span>}
            {p.cards.map((c) => <Book key={c} v={view} id={c} selected={keep === c} onClick={() => pick(c, false)} />)}
          </div>
          <h4>Заплатить книгой вместо Талона (необязательно)</h4>
          <div className="shelf wrap">
            {own.map((c) => <Book key={c} v={view} id={c} selected={pay === c} onClick={() => pick(c, true)} />)}
          </div>
          {keep && free <= 0 && <p className="warn-text">На складе нет места: чтобы оставить книгу, отдайте свою, вытягивая следующую.</p>}
          <div className="modal-foot">
            <button disabled={!can} onClick={() => act({ type: 'makulaturaDraw', deck: 'unprinted', ...(pay ? { pay } : {}) })}>Из Непечатных ({cost})</button>
            <button disabled={!can} onClick={() => act({ type: 'makulaturaDraw', deck: 'load', ...(pay ? { pay } : {}) })}>Из Нагрузки ({cost})</button>
            <button className="primary" disabled={!keep || free <= 0} onClick={() => keep && act({ type: 'makulaturaKeep', card: keep })}>Оставить выбранную</button>
          </div>
        </Modal>
      );
    }
    case 'baraholkaLook': {
      const veteran = hasPatron(view, me.id, 'veteran');
      const more = veteran ? view.baraholka.map((has, i) => (has && !p.seen.some((x) => x.slot === i) ? i : -1)).filter((i) => i >= 0) : [];
      const bought = p.bought ?? 0;
      const cost = veteran && bought === 1 ? 0 : RULES.baraholkaPrice;
      return (
        <Modal title="Барахолка">
          <p>Вы тайно смотрите {p.seen.length === 1 ? 'книгу' : 'книги'}{veteran ? '' : ' и можете купить одну из них'}:</p>
          <div className="shelf">
            {p.seen.map((x) => (
              <div key={x.slot} className="col">
                <Book v={view} id={x.card} />
                <button className="primary small" disabled={me.talons < cost || !roomToBuy(view, me, [x.card])} title={roomToBuy(view, me, [x.card]) ? undefined : 'Нет места на складе'} onClick={() => act({ type: 'baraholkaBuy', slot: x.slot })}>Купить{costTag(cost) || ' (даром)'}</button>
              </div>
            ))}
          </div>
          {veteran && <p className="muted small">Ветеран: можно смотреть и покупать сколько угодно книг; в сумме на 1 Талон дешевле (вторая книга бесплатно). Куплено: {bought}.</p>}
          <div className="modal-foot">
            <span className="muted">у вас {me.talons}🎫</span>
            <button onClick={() => act({ type: 'baraholkaBuy' })}>{bought ? 'Закончить' : 'Ничего не брать'}</button>
          </div>
          {more.length > 0 && (
            <div className="modal-foot">
              <span className="muted small">Посмотреть ещё:</span>
              {more.map((i) => (
                <button key={i} className="small" onClick={() => act({ type: 'baraholkaBuy', next: i })}>№{i + 1}</button>
              ))}
            </div>
          )}
        </Modal>
      );
    }
    case 'glavlitSwap':
      // Связь с Главлитовцем только что завязана — нажатие снаружи окна отменяет подарок (в начале Пятилетки — нет).
      return <GlavlitPrompt view={view} act={act} onClose={!p.roundStart ? cancel : undefined} />;
    case 'lieutenantPick': {
      const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
      return (
        <Modal title="Лейтенант" wide>
          <p>Возьмите себе одну из книг, изъятых облавой с адресов.{free <= 0 && ' На Складе нет места.'}</p>
          <div className="shelf wrap">{p.cards.map((c) => <Book key={c} v={view} id={c} onClick={free > 0 ? () => act({ type: 'lieutenantPick', card: c }) : undefined} />)}</div>
          <div className="modal-foot"><button onClick={() => act({ type: 'lieutenantPick', card: null })}>Ничего не брать</button></div>
        </Modal>
      );
    }
    case 'discardExcess':
      return (
        <Modal title="Склад уменьшился" wide>
          <p>Связь с Управдомом потеряна: выберите книги, которые придётся отдать ({p.count}).</p>
          <div className="shelf wrap">{me.warehouse.filter((s) => !s.memorized).map((s) => s.card!).map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}</div>
          <div className="modal-foot"><button className="primary" disabled={sel.length !== p.count} onClick={() => act({ type: 'discardExcess', cards: sel })}>Отдать ({sel.length}/{p.count})</button></div>
        </Modal>
      );
    case 'kvartirnikReply':
      return (
        <Modal title="Квартирник">
          <p>{nameOf(p.from)} предлагает обмен: вы отдаёте</p>
          <div className="shelf"><Book v={view} id={p.want} /></div>
          <p>и получаете</p>
          <div className="shelf"><Book v={view} id={p.give} /></div>
          <div className="modal-foot">
            <button onClick={() => act({ type: 'kvartirnikReply', accept: false })}>Отказаться</button>
            <button className="primary" onClick={() => act({ type: 'kvartirnikReply', accept: true })}>Согласиться</button>
          </div>
        </Modal>
      );
    case 'naslednikiPick':
    case 'posrednichestvoKeep':
    case 'spisanieKeep': {
      const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
      const posredNeed = Math.min(RULES.posrednichestvoKeep, p.cards.length);
      const title = p.kind === 'naslednikiPick' ? 'Наследники: сброс Непечатных' : p.kind === 'posrednichestvoKeep' ? 'Посредничество авторам' : 'Библиотечное списание';
      const text = p.kind === 'naslednikiPick' ? 'Тайно возьмите 1–2 книги из сброса.'
        : p.kind === 'posrednichestvoKeep' ? `Оставьте себе книг: ${posredNeed}, остальные уйдут в сброс.`
          : 'Оставьте себе сколько захотите, остальные уйдут в сброс.';
      const ok = p.kind === 'naslednikiPick' ? sel.length >= 1 && sel.length <= 2
        : p.kind === 'posrednichestvoKeep' ? sel.length === posredNeed : true;
      const action: Action = p.kind === 'naslednikiPick' ? { type: 'naslednikiPick', cards: sel }
        : p.kind === 'posrednichestvoKeep' ? { type: 'posrednichestvoKeep', keep: sel } : { type: 'spisanieKeep', keep: sel };
      return (
        <Modal title={title} wide>
          <p>{text} Свободных мест: {free}.</p>
          <div className="shelf wrap">{p.cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}</div>
          <div className="modal-foot">
            <button className="primary" disabled={!ok || sel.length > free} onClick={() => act(action)}>
              {sel.length ? `Взять (${sel.length})` : 'Ничего не брать'}
            </button>
          </div>
        </Modal>
      );
    }
    case 'posrednichestvoGroup':
    case 'extraGroup':
    case 'sproutBonus': {
      const options: (GroupActionId | SproutBonusId)[] = p.kind === 'sproutBonus'
        ? p.options
        : (Object.keys(GROUP_ACTIONS) as GroupActionId[])
          .filter((g) => groupInGame(view, g))
          .filter((g) => p.kind !== 'extraGroup' || me.groupUsed.includes(g)); // Подмастерье повторяет уже сделанное
      const sendGroup = (g: GroupAction) => act(p.kind === 'sproutBonus' ? { type: 'sproutBonus', bonus: g.action, group: g } : { type: 'group', group: g });
      if (groupFor === 'acquaintance') {
        return <BefriendPicker view={view} me={me} close={() => setGroupFor(null)} onPick={(patron) => act({ type: 'sproutBonus', bonus: 'acquaintance', patron })} />;
      }
      if (groupFor && groupFor !== 'posred' && groupFor in GROUP_ACTIONS) {
        return <GroupPanel id={groupFor as GroupActionId} view={view} me={me} close={() => setGroupFor(null)} done={sendGroup} />;
      }
      return (
        <Modal title={p.kind === 'sproutBonus' ? `Бонус Ростка «${SPROUTS.find((s) => s.id === p.sprout)!.name}»` : p.kind === 'extraGroup' ? 'Подмастерье: действие Группы' : 'Действие Инициативной группы'}>
          <p>{p.kind === 'sproutBonus' ? workerIcon('Бонус занятого вами места Ростка. Он не требует 👤; собственную цену действия платите как обычно. Можно отказаться.')
            : p.kind === 'extraGroup' ? 'Повторите одно из действий Группы, уже сделанных в эту Пятилетку.' : 'Выполните одно действие Группы.'}</p>
          <div className="genres">
            {options.map((o) => (
              <button key={o} onClick={() => {
                if (o === 'sideJob' || o === 'underCounter') act({ type: 'sproutBonus', bonus: o });
                else if (o === 'acquaintance') setGroupFor(o);
                else if (o === 'copyText' || o === 'restore' || groupBlocker(view, me, o as GroupActionId)) setGroupFor(o);
                else sendGroup({ action: o } as GroupAction);
              }}>{withPrice(view, me, o)}</button>
            ))}
          </div>
          <div className="modal-foot"><button onClick={() => act({ type: 'pass' })}>Отказаться</button></div>
        </Modal>
      );
    }
  }
}

// Наводчик: в свой ход — верхние книги стопок и Спецхран (книги Барахолки открыты на её карточке).
function SpotterButton({ view }: { view: PlayerView }) {
  const [open, setOpen] = useState(false);
  const sp = view.spotter!;
  const shelf = (cards: string[]) => (cards.length
    ? <div className="shelf wrap">{cards.map((c) => <Book key={c} v={view} id={c} small />)}</div>
    : <p className="muted">Пусто</p>);
  return (
    <>
      {' · '}<button className="small" onClick={() => setOpen(true)} title="Наводчик: верх стопок и Спецхран">👁 Наводчик</button>
      {open && (
        <Modal title="Наводчик" wide onClose={() => setOpen(false)}>
          <h4>Верх стопки Непечатных</h4>
          {shelf(sp.deckTop ? [sp.deckTop] : [])}
          <h4>Верх стопки Нагрузки</h4>
          {shelf(sp.loadTop ? [sp.loadTop] : [])}
          <h4>Спецхран ({view.spetskhranKnown.length})</h4>
          {shelf(view.spetskhranKnown)}
        </Modal>
      )}
    </>
  );
}

// Значки жанров в журнале: «[ПР ФА]» → цветные значки, как в Клубе. Прочие пометки («[Нагрузка]») — как есть.
const SHORT_TO_GENRE = new Map(GENRES.map((g) => [GENRE_SHORT[g], g] as const));
function withGenreChips(raw: string, icons = true): ReactNode {
  // Слово «ЧНЛ» в тексте журнала (правила Несистемного, итоги Куратора) — тоже значком.
  const text = (icons ? iconize(raw) : raw).replace(/(?<![[А-ЯЁа-яё])ЧНЛ(?![\]А-ЯЁа-яё])/g, '[ЧНЛ]');
  const parts = text.split(/(\[[^\]]+\])/);
  const nodes = parts.map((part, i): ReactNode => {
    // «[ПО] Поэзия» — достаточно значка: название жанра сразу после него не повторяем.
    const prev = /^\[(.+)\]$/.exec(parts[i - 1] ?? '')?.[1];
    const g = prev && SHORT_TO_GENRE.get(prev);
    if (g && part.startsWith(` ${GENRE_NAMES[g]}`)) part = part.slice(GENRE_NAMES[g].length + 1);
    if (part === '[Любой жанр]' || part === '[Любой жанр ×2]') return <span key={i} className="log-genres">{(part.includes('×2') ? [0, 1] : [0]).map((j) => <span key={j} className="chip wild">ЛЮБОЙ</span>)}</span>;
    const tokens = /^\[(.+)\]$/.exec(part)?.[1].split(' ');
    // ЧНЛ и Улики; «[Пропаганда]», «[Улика]» — строки партий, начатых до переименования.
    if (['[ЧНЛ]', '[Пропаганда]', '[УЛ]', '[Улика]'].includes(part)) {
      return <span key={i} className="log-genres"><KindChip k={part === '[ЧНЛ]' || part === '[Пропаганда]' ? 'chnl' : 'ul'} /></span>;
    }
    if (!tokens || !tokens.every((t) => SHORT_TO_GENRE.has(t))) return part;
    return <span key={i} className="log-genres">{tokens.map((t, j) => <GenreChip key={j} g={SHORT_TO_GENRE.get(t)!} />)}</span>;
  });
  // Значки не разрываем при переносе строки: соседние группы через пробел или «+» и значок 💡 перед ними — одним куском.
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => { if (run.length) out.push(<span key={`run${out.length}`} className="chip-run">{run}</span>); run = []; };
  nodes.forEach((node, i) => {
    if (typeof node !== 'string') { run.push(node); return; }
    const chipNext = i + 1 < nodes.length && typeof nodes[i + 1] !== 'string';
    if (run.length && chipNext && /^[ +]?$/.test(node)) { run.push(node); return; }
    flush();
    const glue = chipNext ? /💡$/.exec(node)?.[0] ?? '' : '';
    if (node.length > glue.length) out.push(node.slice(0, node.length - glue.length));
    if (glue) run.push(glue);
  });
  flush();
  return out;
}

function PassionPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  return (
    <Modal title="Тайное Пристрастие" wide>
      <BannedLine view={view} />
      <h4>Ваши стартовые книги</h4>
      {/* Нагрузка — отдельной строкой под остальными книгами. */}
      {[me.warehouse.filter((s) => !fromLoadDeck(view, s.card!)), me.warehouse.filter((s) => fromLoadDeck(view, s.card!))]
        .filter((row) => row.length)
        .map((row, r) => <div key={r} className="shelf wrap" style={r ? { marginTop: 8 } : undefined}>{row.map((s, i) => <Book key={i} v={view} id={s.card} small />)}</div>)}
      <p>Выберите одно из двух Пристрастий. Второе уйдёт в коробку, никто его не увидит.</p>
      <div className="passions">
        {me.passionOptions.map((id) => (
          <button key={id} className="passion" onClick={() => act({ type: 'choosePassion', passion: id })}>
            {/* Заголовок: название и жанры — значками; описание — словами, очки — значком ★. */}
            <b>{PASSIONS[id].genres
              ? <>{PASSIONS[id].name}<span className="passion-chips">{PASSIONS[id].genres!.map((g) => <GenreChip key={g} g={g} favored />)}</span></>
              : passionLabel(id)}</b>
            <span>{withKindChips(PASSIONS[id].hint.replace(/(\d+) очк(?:о|а|ов)(?![а-яё])/g, '$1★'))}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// После Посиделок все отвечают по очереди «дальше» — так не видно, кто Куратор; Куратор может устроить Засаду.
function AmbushPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const shown = Object.entries(view.shownAtGathering ?? {}).filter(([id, list]) => id !== me.id && list.length);
  const curator = me.passion === 'curator';
  // Куратор сам выбирает, какую из показанных книг изъять у каждого.
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(shown.map(([id, list]) => [id, list[0]])));
  return (
    <Modal title={curator ? 'Засада?' : 'Посиделки окончены'} wide>
      {curator ? (
        <>
          <p>Можно раскрыться и устроить Засаду: на каждого, кто показал опальное, — Контора (Сигнал: удержать 👤,
            Изъятие: выбранная вами показанная книга уходит в Спецхран). После этого все будут знать, что вы Куратор.</p>
          {shown.length === 0 && <p className="muted">Опальное показали только вы.</p>}
          {shown.map(([id, list]) => (
            <div key={id}><b>{view.players.find((p) => p.id === id)?.name}</b> — изъять: <span className="shelf wrap">{list.map((c) => <Book key={c} v={view} id={c} small selected={picks[id] === c} onClick={() => setPicks({ ...picks, [id]: c })} />)}</span></div>
          ))}
        </>
      ) : (
        <p>Кто-то показал опальное. Если среди вас Куратор, он может сейчас раскрыться и устроить Засаду.</p>
      )}
      <div className="modal-foot">
        <button className={curator ? '' : 'primary'} onClick={() => act({ type: 'ambush', go: false })}>{curator ? 'Не сейчас' : 'Дальше'}</button>
        {curator && <button className="primary" disabled={!shown.length} onClick={() => act({ type: 'ambush', go: true, picks })}>Засада!</button>}
      </div>
    </Modal>
  );
}

function GatheringPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const full = view.mode === 'full';
  const cands = me.warehouse.map((s) => s.card!).filter((c) => c && (isGenreBook(view, c) || isEvidence(view, c) || isExposed(view, c)) && isBanned(view, c));
  // По умолчанию к показу выбрано всё, что приносит очки: опальные книги, Улики и Разоблачения.
  const [sel, setSel] = useState<string[]>(() => cands);
  const per = RULES.gatheringPoints;
  const pts = sel.length * per;
  const geo = hasPatron(view, me.id, 'geologist');
  return (
    <Modal title="Посиделки" wide>
      <p>Покажите опальные жанровые книги, Улики и Разоблачения: +{per}★ за каждую{geo ? ' и ещё +1🎫 от Геолога' : ''}.
        {full && !view.reserve && view.curatorPossible && !view.curatorRevealed && ' Осторожно: Куратор может раскрыться и устроить Засаду — показавшим опальное грозит Контора (показанная книга не считается спрятанной).'} Показанные книги остаются на складе — не забудьте укрыть их перед облавой.</p>
      <div className="shelf wrap">
        {cands.length === 0 && <span className="muted">Опальных жанровых книг нет</span>}
        {cands.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot"><button className="primary" onClick={() => act({ type: 'gathering', show: sel })}>{sel.length ? `Показать (+${pts}★${geo ? `, +${sel.length}🎫` : ''})` : 'Ничего не показывать'}</button></div>
    </Modal>
  );
}

// Пересобрать Тайник в свой ход: свободно, ход не заканчивается.
// Жанры в опале — подсказка в окнах Тайника.
function BannedLine({ view }: { view: PlayerView }) {
  return (
    <p className="banned-line">
      <span className="muted small">В опале:</span>{' '}
      {view.banned.length ? view.banned.map((g) => <GenreChip key={g} g={g} banned />) : <span className="muted small">ничего</span>}
    </p>
  );
}

function CacheModal({ view, me, close, done, title, note }: {
  view: PlayerView; me: VPlayer; close?: () => void; done: (hidden: string[]) => void; title?: string; note?: string;
}) {
  const explain = useContext(Explain);
  const cards = me.warehouse.filter((s) => s.card && !s.memorized).map((s) => s.card!);
  const [sel, setSel] = useState<string[]>(() => me.warehouse.filter((s) => s.hidden && !isLoad(view, s.card!)).map((s) => s.card!));
  const limit = me.cache + loadCover(view, me.warehouse);
  return (
    <Modal title={title ?? 'Тайник'} wide onClose={close}>
      <BannedLine view={view} />
      <p>Отметьте книги, которые лежат в Тайнике: их не видят соперники и не трогает облава. Мест: {limit} (из них за Нагрузку: {loadCover(view, me.warehouse)}). Отмечено: {sel.length}.</p>
      <p className="muted small">{note ?? 'Это не тратит действие. Книга, которую уже видели соперники, от того, что её спрятали, не станет для них тайной — но облава её не тронет.'}</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)}
          note={isLoad(view, c) ? 'не прячется' : undefined} onClick={isLoad(view, c) ? () => explain('Нагрузку в Тайник не прячут.') : () => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot">
        {close && <button onClick={close}>Отмена</button>}
        <button className="primary" disabled={sel.length > limit} onClick={() => done(sel)}>{sel.length > limit ? `Мест только ${limit}` : 'Сохранить'}</button>
      </div>
    </Modal>
  );
}

// Что сразу спрятать к облаве: сначала опальное, самое ценное вперёд (Куратору — ЧНЛ, затем Улики, затем книги
// с большим числом значков), потом то, что уже лежит в Тайнике (иначе соперники его увидят).
// Честному свою ЧНЛ прятать незачем, если всё опальное не помещается: Единомышленника всё равно удержат.
function bestHiding(view: PlayerView, me: VPlayer, limit: number): string[] {
  const curator = me.passion === 'curator';
  const free = me.warehouse.filter((s) => s.card && !s.memorized);
  const banned = free.map((s) => s.card!).filter((c) => isBanned(view, c));
  const value = (c: string) => (isPropaganda(view, c) ? (curator ? 1000 : -1) : isEvidence(view, c) ? 100 : 10 + iconCount(view, c));
  const fits = banned.length <= limit;
  const order = banned.filter((c) => fits || value(c) > 0).sort((x, y) => value(y) - value(x));
  const kept = free.filter((s) => s.hidden && !order.includes(s.card!) && !isLoad(view, s.card!)).map((s) => s.card!);
  return [...order, ...kept].slice(0, limit);
}

function HidingPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const explain = useContext(Explain);
  const cards = me.warehouse.map((s) => s.card!).filter(Boolean);
  const [sel, setSel] = useState<string[]>(() => bestHiding(view, me, me.cache + loadCover(view, me.warehouse)));
  const [memo, setMemo] = useState<string | null>(() => me.warehouse.find((s) => s.memorized)?.card ?? null);
  const [fill, setFill] = useState(false);
  const full = view.mode === 'full';
  const partorg = hasPatron(view, me.id, 'partorg');
  const poetry = cards.filter((c) => iconsOf(view, c).includes('poetry'));
  const cover = loadCover(view, me.warehouse);
  const limit = me.cache + cover;
  const hiddenNow = sel.filter((c) => c !== memo);
  const exposed = cards.filter((c) => !sel.includes(c) && c !== memo && isBanned(view, c));
  return (
    <Modal title="Укрытие" wide>
      <BannedLine view={view} />
      <p>Отметьте книги, которые прячете в Тайник. Мест в Тайнике: {me.cache}, ещё {cover} — за Нагрузку на складе (каждые 2 Нагрузки дают +1 место). Сейчас спрятано {sel.length} из {limit}.</p>
      <p className="muted small">Самое ценное опальное уже отмечено — выбор можно поменять.</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)}
          note={isLoad(view, c) ? 'не прячется' : undefined} onClick={isLoad(view, c) ? () => explain('Нагрузку в Тайник не прячут.') : () => setSel(toggle(sel, c))} />)}
      </div>
      {full && poetry.length > 0 && (
        <>
          <h4>«Заучить»: один сборник поэзии сверх склада и Тайника (виден всем, облава не трогает)</h4>
          <div className="shelf wrap">
            {poetry.map((c) => <Book key={c} v={view} id={c} small selected={memo === c} onClick={() => setMemo(memo === c ? null : c)} note={memo === c ? 'заучено' : undefined} />)}
          </div>
        </>
      )}
      {partorg && <label className="row"><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Парторг: заполнить пустые места склада Нагрузкой (бесплатно, до укрытия)</label>}
      {exposed.length > 0 && <p className="warn-text">При облаве будут изъяты: {exposed.map((c) => `«${view.cards[c].title}»`).join(', ')}</p>}
      <div className="modal-foot"><button className="primary" disabled={hiddenNow.length > limit && !fill}
        onClick={() => act({ type: 'hiding', hidden: hiddenNow, ...(full ? { memorize: memo } : {}), ...(fill ? { fillLoad: true } : {}) })}>Готово к облаве</button></div>
    </Modal>
  );
}

// Источники очков «по ходу», возможные в этом режиме.
const BEGINNER_SOURCES: PointSource[] = ['sprouts', 'gathering', 'tamizdat', 'samizdat'];

// Источники очков «по ходу» для итоговой таблицы: очки Завсегдатая — только если он был в Клубе, Вызволение — где есть Контора.
function scoreSources(view: PlayerView): PointSource[] {
  if (view.mode !== 'full') return BEGINNER_SOURCES;
  return (Object.keys(POINT_SOURCES) as PointSource[]).filter((k) => {
    if (k in PATRONS) return view.patrons.some((pt) => pt.id === k);
    return k !== 'rescue' || !view.reserve;
  });
}

// Итоговый подсчёт очков для скачиваемого журнала.
function resultText(view: PlayerView): string {
  const r = view.result;
  if (!r) return '';
  const full = view.mode === 'full';
  const sources = scoreSources(view);
  const lines = r.scores.map((s) => {
    const p = view.players.find((x) => x.id === s.player)!;
    const by = sources.map((k) => `${POINT_SOURCES[k]} ${s.duringBy?.[k] ?? 0}`).join(', ');
    const parts = [`по ходу ${s.during}${by ? ` (${by})` : ''}`, ...(full ? [`связи ${s.connections ?? 0}`] : []),
      `Пристрастие ${s.passion}`, `Улики ${s.evidence}`, `Талоны ${s.talonPoints ?? 0}`, `ЧНЛ ${s.propaganda}`];
    return `• ${p.name}${r.winners.includes(s.player) ? ' (победа)' : ''}, ${p.passion ? passionLabel(p.passion) : '—'}: итого ${s.total} — ${parts.join('; ')}.`;
  });
  return `\n\nИтоговый подсчёт очков. ${r.note}\n${lines.join('\n')}`;
}

function Results({ view, seatIndex, close }: { view: PlayerView; seatIndex: (id: string) => number; close: () => void }) {
  const full = view.mode === 'full';
  const sources = scoreSources(view);
  const r = view.result!;
  const name = (id: string) => view.players.find((p) => p.id === id)!.name;
  return (
    <Modal title="Конец Застоя" onClose={close} wide>
      <p><b>{r.note}</b></p>
      <div className="scores-wrap"><table className="scores">
        <thead><tr><th>Игрок</th><th>По ходу</th>{full && <th title="Связи в Клубе книголюбов">🤝</th>}<th>Пристрастие</th><th title="Улики"><KindChip k="ul" /></th><th title={`Талоны: 1 очко за каждые ${RULES.talonsPerPoint}`}>🎫/{RULES.talonsPerPoint}</th><th><KindChip k="chnl" /></th><th>Итого</th></tr></thead>
        <tbody>
          {r.scores.map((s) => {
            const p = view.players.find((x) => x.id === s.player)!;
            const by = sources.map((k) => [k, s.duringBy?.[k] ?? 0] as [PointSource, number]);
            return (
              <Fragment key={s.player}>
                <tr className={r.winners.includes(s.player) ? 'winner' : ''}>
                  <td><span className="dot" style={{ background: PLAYER_COLORS[seatIndex(s.player)] }} /> {name(s.player)}</td>
                  <td>{s.during}</td>{full && <td>{s.connections ?? 0}</td>}<td>{p.passion
                    ? <span className="score-passion" title={passionLabel(p.passion)}>{s.passion} — {PASSIONS[p.passion].name} {passionMarks(p.passion)}</span>
                    : <>{s.passion} — —</>}</td><td>{s.evidence}</td><td>{s.talonPoints ?? 0}</td><td>{s.propaganda}</td><td><b>{s.total}</b></td>
                </tr>
                {by.length > 0 && (
                  <tr className="score-detail">
                    <td colSpan={full ? 8 : 7}>
                      По ходу игры: {by.map(([k, n]) => <span key={k} className="src">{POINT_SOURCES[k]} <b>{n}</b></span>)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table></div>
    </Modal>
  );
}

// ---------- Игроки ----------

// Пустые места полки: ряд не схлопывается, когда книги уходят.
function emptySlots(n: number) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => <div key={`empty${i}`} className="book empty small" title="Свободное место" />);
}

// Свободные места Склада (заученный сборник места не занимает).
function freeShelf(p: VPlayer): number {
  return p.capacity - p.warehouse.filter((s) => !s.memorized).length;
}

// Эрудит: все жанры; погашены те, что уже есть — на складе или в изданном.
function EruditePanel({ view, me }: { view: PlayerView; me: VPlayer }) {
  const cards = [...me.warehouse.map((s) => s.card!).filter(Boolean), ...me.published];
  // «Чукоккала» (любой жанр) засчитывается за один жанр — в конце подсчёта за любой ещё не закрытый: звёздочка в конце строки.
  const have = new Set(cards.filter((c) => !view.cards[c].wild).flatMap((c) => genresOf(view, c)));
  // С монографией — два значка, они закроют два разных жанра.
  const wild = cards.filter((c) => view.cards[c].wild).reduce((n, c) => n + (view.restored[c] ? 2 : 1), 0);
  return (
    <div className="erudite" title="Эрудит: жанры, которые уже есть (на складе или в изданном), — погашены; * — книга любого жанра закроет ещё один жанр в конце партии">
      {GENRES.map((g) => <span key={g} className={have.has(g) ? 'got' : ''}><GenreChip g={g} /></span>)}
      {wild > 0 && <span className="erudite-wild" title={wild > 1 ? `Чукоккала: в конце засчитается за ${wild} разных незакрытых жанра` : 'Чукоккала: в конце засчитается за один из незакрытых жанров'}>{'*'.repeat(wild)}</span>}
    </div>
  );
}

// Что ценит Пристрастие — коротко, значками (для плашки на телефоне).
// Сердечко Пристрастия; у Куратора — коричневое.
const passionIcon = (id: PassionId) => (id === 'curator' ? '🤎' : PASSION_ICON);

function passionMarks(id: PassionId): ReactNode {
  const ps = PASSIONS[id];
  if (ps.genres) return ps.genres.map((g) => <GenreChip key={g} g={g} favored />);
  if (id === 'curator') return <KindChip k="chnl" />;
  if (id === 'historian') return <><KindChip k="ul" /><span className="chip mb-load">РАЗ</span></>;
  if (id === 'erudite') return <span className="muted small">все</span>;
  if (id === 'monogamist') return <span className="muted small">лучший</span>;
  if (id === 'innovator') return <span className="muted small">двужанровые</span>;
  return <span className="muted small">{ps.name}</span>;
}

// Телефон: закреплённая сверху плашка — опала, свои показатели и книги склада (только значки; в Тайнике — пунктиром).
function MobileBar({ view, me }: { view: PlayerView; me: VPlayer }) {
  const marks = (c: string) => {
    if (isPropaganda(view, c)) return isLoad(view, c) ? <><KindChip k="chnl" /><span className="chip mb-load" title="Нагрузка">Н</span></> : <KindChip k="chnl" />;
    if (isEvidence(view, c)) return <KindChip k="ul" />;
    if (isExposed(view, c)) return <span className="chip mb-load" title="Разоблачение">РАЗ</span>;
    if (view.cards[c].wild) return <span className={`chip wild ${view.banned.length ? 'banned' : ''}`} title="Любой жанр">ЛЮБОЙ</span>;
    const icons = iconsOf(view, c);
    if (!icons.length) return <span className="chip mb-load" title="Нагрузка">Н</span>;
    return icons.map((g, i) => <GenreChip key={i} g={g} banned={view.banned.includes(g)} />);
  };
  // Плашка закреплена у верхнего края: её высоту знает вся страница — под неё сдвигаются поле и окна.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--mb-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    document.body.classList.add('has-mb');
    return () => { ro.disconnect(); document.body.classList.remove('has-mb'); root.style.removeProperty('--mb-h'); };
  }, []);
  return (
    <div className="mobile-bar" ref={bar}>
      <div className="mb-row"><span className="mb-round" title="Пятилетка">{ROUND_ICON}<b>{view.round}</b>/{RULES.rounds}</span><span className="mb-censor" title="Цензура: жанры в опале">{CENSOR_ICON}</span>{view.banned.length ? view.banned.map((g) => <GenreChip key={g} g={g} banned />) : <span className="muted small">нет</span>}
        {me.passion && <span className="mb-passion" title={`Пристрастие: ${PASSIONS[me.passion].name} — ${PASSIONS[me.passion].hint}`}><span>{passionIcon(me.passion)}</span>{passionMarks(me.passion)}</span>}
      </div>
      <Stats p={me} view={view} />
      <div className="mb-row mb-books">
        {me.warehouse.map((s, i) => s.card && (
          <span key={i} className={`mb-book ${s.hidden ? 'cached' : ''} ${s.memorized ? 'memo' : ''}`}
            title={`${view.cards[s.card].title}${s.hidden ? ' — в Тайнике' : s.memorized ? ' — заучено' : ''}`}>{marks(s.card)}</span>
        ))}
        {!me.warehouse.length && <span className="muted small">склад пуст</span>}
      </div>
    </div>
  );
}

function Stats({ p, view }: { p: VPlayer; view: PlayerView }) {
  const cover = loadCover(view, p.warehouse);
  return (
    <div className="stats">
      <span title="Единомышленники: свободны / всего"><i>👤</i>{p.available}/{p.workers}</span>
      <span title="Талоны"><i>🎫</i>{p.talons}</span>
      <span title="Склад: занято / мест (заученный сборник поэзии — сверх склада)"><i>📚</i>{p.warehouse.filter((s) => !s.memorized).length}/{p.capacity}</span>
      <span title={`Тайник: занято / мест (${p.cache}${cover ? ` + ${cover} за Нагрузку на складе` : ''})`}><i>🔒</i>{p.warehouse.filter((s) => s.hidden).length}/{p.cache + cover}{cover ? '*' : ''}</span>
      {view.mode === 'full' && <span title="Связи в Клубе книголюбов"><i>🤝</i>{view.patrons.filter((x) => !x.removed && x.connections.includes(p.id)).length}</span>}
      {!view.reserve && <span title="Единомышленников удерживает Контора"><i>👁️</i>{p.held}</span>}
      <span title="Очки Гласности, набранные по ходу игры"><i>★</i>{p.points}</span>
    </div>
  );
}

function MyPanel({ view, me, color, groupWhy, onGroup, onMemorize, onCache }: {
  view: PlayerView; me: VPlayer; color: string; groupWhy: (g: GroupActionId) => string | null; onGroup: (id: GroupActionId) => void; onMemorize: ((card: string | null) => void) | null;
  onCache: (() => void) | null;
}) {
  const explain = useContext(Explain);
  const memorized = me.warehouse.find((s) => s.memorized)?.card ?? null;
  const poetry = me.warehouse.map((s) => s.card!).filter((c) => c && c !== memorized && iconsOf(view, c).includes('poetry'));
  return (
    <div className="player me" style={{ borderColor: color }}>
      <div className="addr-head"><b style={{ color }}><span className="dot" style={{ background: color }} /> {me.name} (вы)</b></div>
      <Stats p={me} view={view} />
      {me.passion && (
        <div className="passion-line" title={`Пристрастие: ${PASSIONS[me.passion].name} — ${PASSIONS[me.passion].hint}`}>
          <span>{passionIcon(me.passion)}</span>{me.passion === 'erudite' ? <EruditePanel view={view} me={me} /> : passionMarks(me.passion)}
        </div>
      )}
      <div className="shelf wrap">{me.warehouse.map((s, i) => <Book key={i} v={view} id={s.card} hidden={s.hidden} small note={s.memorized ? 'заучено' : undefined} />)}{emptySlots(freeShelf(me))}</div>
      {onCache && (
        <div className="group-actions">
          <button className="small" onClick={onCache} title="Убрать книги из Тайника или спрятать туда другие — не тратит действие">Пересобрать Тайник</button>
        </div>
      )}
      {onMemorize && (poetry.length > 0 || memorized) && (
        <div className="group-actions">
          <span className="muted small">«Заучить» (сборник поэзии сверх Склада и Тайника, не тратит действие):</span>
          {poetry.map((c) => <button key={c} className="small" onClick={() => onMemorize(c)}>Заучить «{view.cards[c].title}»</button>)}
          {memorized && <button className="small" onClick={() => onMemorize(null)}>Вернуть «{view.cards[memorized].title}» на Склад</button>}
        </div>
      )}
      <Published view={view} p={me} />
      {me.subscriptions.length > 0 && (
        <div className="muted small subs">Подписка: {me.subscriptions.map((s, i) => (
          <span key={i} title={`${GENRE_NAMES[s.genre]}: ещё Пятилеток — ${s.rounds}`}><GenreChip g={s.genre} />×{s.rounds}</span>
        ))}</div>
      )}
      <div className="group">
        <div className="muted small">Инициативная группа (каждое действие — раз в Пятилетку):</div>
        <div className="group-actions">
          {(Object.keys(GROUP_ACTIONS) as GroupActionId[]).filter((g) => groupInGame(view, g)).map((g) => (
            // Недоступное действие не выключено: нажатие объясняет, почему сейчас нельзя.
            <button key={g} className={`small ${groupBlocker(view, me, g) ? 'short' : ''} ${groupWhy(g) ? 'off' : ''}`}
              title={me.groupUsed.includes(g) ? 'Уже сделано в эту Пятилетку' : groupBlocker(view, me, g) ?? GROUP_ACTIONS[g].hint}
              aria-disabled={!!groupWhy(g)} onClick={() => { const w = groupWhy(g); if (w) explain(w); else onGroup(g); }}>
              {GROUP_ICONS[g]}{ICON_JOIN}{GROUP_ACTIONS[g].name}{groupPrice(view, me, g) && <span className="gprice"> {groupPrice(view, me, g)}</span>}<GroupSlot p={me} g={g} color={color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function OtherPlayer({ view, p, color, active, rev }: { view: PlayerView; p: VPlayer; color: string; active: boolean; rev: number }) {
  return (
    <div className={`player ${active ? 'active' : ''}`} style={{ borderColor: color, '--rev': rev } as React.CSSProperties}>
      <div className="addr-head"><b style={{ color }}><span className="dot" style={{ background: color }} /> {p.name}</b>
        {/* Зрителю видно всё — и Пристрастия. */}
        {view.me === null && p.passion && <span className="passion-line" title={`Пристрастие: ${PASSIONS[p.passion].name} — ${PASSIONS[p.passion].hint}`}><span>{passionIcon(p.passion)}</span>{passionMarks(p.passion)}</span>}
      </div>
      <Stats p={p} view={view} />
      <div className="shelf wrap">{p.warehouse.map((s, i) => <Book key={i} v={view} id={s.card} hidden={s.hidden} small note={s.memorized ? 'заучено' : undefined} />)}{emptySlots(freeShelf(p))}</div>
      <Published view={view} p={p} />
      <div className="group-actions readonly" title="Действия Инициативной группы в эту Пятилетку">
        {(Object.keys(GROUP_ACTIONS) as GroupActionId[]).filter((g) => groupInGame(view, g)).map((g) => (
          <span key={g} className={`gact ${p.groupUsed.includes(g) ? 'used' : ''}`} title={GROUP_ACTIONS[g].hint}>
            {GROUP_ICONS[g]}{ICON_JOIN}{GROUP_ACTIONS[g].name}{groupPrice(view, p, g) && <span className="gprice"> {groupPrice(view, p, g)}</span>}<GroupSlot p={p} g={g} color={color} />
          </span>
        ))}
      </div>
    </div>
  );
}

// Место действия Группы: пустой кружок, пока не сделано; потом — цвет игрока и номер действия.
function GroupSlot({ p, g, color }: { p: VPlayer; g: GroupActionId; color: string }) {
  const n = groupN(p, g);
  if (!n && !p.groupUsed.includes(g)) return <span className="dot num inline slot-free" title="Свободно в эту Пятилетку" />;
  return <span className="dot num inline" style={{ background: color }}>{n ?? ''}</span>;
}

// Номер действия Группы в эту Пятилетку (если делалось Единомышленником).
function groupN(p: VPlayer, g: GroupActionId): number | undefined {
  return p.actions?.find((a) => a.target === `group:${g}`)?.n;
}

function Log({ view, seatIndex }: { view: PlayerView; seatIndex: (id: string) => number }) {
  const entries = useMemo(() => [...view.log].reverse(), [view.log]);
  // Новые записи появляются сверху. Если журнал прокручен вниз от верха — держим ту же позицию:
  // сдвигаем прокрутку на высоту добавленного. Наверху — новые записи видны сразу.
  const box = useRef<HTMLDivElement>(null);
  const last = useRef({ top: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (last.current.top > 2) el.scrollTop = last.current.top + (el.scrollHeight - last.current.height);
    last.current = { top: el.scrollTop, height: el.scrollHeight };
  }, [entries]);
  const download = () => {
    const text = view.log.map((l) => `[Пятилетка ${l.round}] ${l.strong ? `**${l.text}**` : l.em ? `_${l.text}_` : l.text}`).join('\n') + resultText(view);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `журнал-партии.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="log" ref={box} onScroll={(e) => { last.current = { top: e.currentTarget.scrollTop, height: e.currentTarget.scrollHeight }; }}>
      <div className="addr-head"><h3>Журнал</h3><button className="small" onClick={download}>Скачать .txt</button></div>
      {entries.map((l, i) => (
        <div key={entries.length - i} className={`${l.only ? 'secret' : ''} ${l.act ? 'act' : ''}`} style={{ whiteSpace: 'pre-line', ...(l.strong ? { fontWeight: 700 } : {}), ...(l.em ? { fontStyle: 'italic' } : {}) }}>
          {l.act && <span className="dot num" style={{ background: PLAYER_COLORS[seatIndex(l.act.player)] }} title={`${l.act.n}-е действие игрока в Пятилетке`}>{l.act.n}</span>}
          {l.who && !l.act && <span className="dot" style={{ background: PLAYER_COLORS[seatIndex(l.who)] }} />}
          {l.club && <span className="dot num wide" style={{ background: PLAYER_COLORS[seatIndex(l.club.player)] }} title={`Связь с ${l.club.round}-й Пятилетки`}>П{l.club.round}</span>}
          {/* На экране журнал идёт снизу вверх: следствие стоит над своим действием — стрелка ведёт снизу вправо. */}
          {l.order || l.winners
            ? (() => {
                // «Порядок хода: …» и «Победа: …» — перед каждым именем кружок игрока.
                const ids = (l.order ?? l.winners)!;
                const names = ids.map((id) => view.players.find((x) => x.id === id)?.name ?? '?');
                const head = l.order ? 'Порядок хода: ' : 'Победа: ';
                const tail = l.text.slice(head.length + names.join(', ').length);
                return <>{head}{ids.map((id, k) => <Fragment key={id}>{k ? ', ' : ''}<span className="dot tight" style={{ background: PLAYER_COLORS[seatIndex(id)] }} />{names[k]}</Fragment>)}{withGenreChips(tail)}</>;
              })()
            : withGenreChips(l.text.replace(/^↳/, '↱'))}
        </div>
      ))}
    </div>
  );
}

function GlavlitPrompt({ view, act, onClose }: { view: PlayerView; act: (a: Action) => void; onClose?: () => void }) {
  const [from, setFrom] = useState<Genre | null>(null);
  const [to, setTo] = useState<Genre | null>(null);
  return (
    <Modal title="Главлитовец" onClose={onClose}>
      {onClose && <p className="muted small">Закройте окно, чтобы передумать и не дарить книгу.</p>}
      <p>Снимите опалу с одного жанра и наложите её на другой.</p>
      <h4>Снять опалу с жанра</h4>
      <div className="genres">{view.banned.map((g) => <button key={g} className={from === g ? 'selected' : ''} onClick={() => setFrom(g)}><GenreChip g={g} banned /> {GENRE_NAMES[g]}</button>)}</div>
      <h4>Наложить опалу на жанр</h4>
      <div className="genres">{GENRES.filter((g) => !view.banned.includes(g)).map((g) => <button key={g} className={to === g ? 'selected' : ''} onClick={() => setTo(g)}><GenreChip g={g} /> {GENRE_NAMES[g]}</button>)}</div>
      <div className="modal-foot"><button className="primary" disabled={!from || !to} onClick={() => from && to && act({ type: 'glavlitSwap', from, to })}>Перенести опалу</button></div>
    </Modal>
  );
}

// Изданные книги — только значки: Тамиздат и Самиздат отдельно.
function Published({ view, p }: { view: PlayerView; p: VPlayer }) {
  const tam = p.published.filter((c) => p.tamizdat.includes(c));
  const sam = p.published.filter((c) => !p.tamizdat.includes(c));
  const row = (label: string, list: string[]) => (
    <div className="pub-row">
      <span className="muted small">{label}:</span>
      {!list.length && <span className="muted small">—</span>}
      {list.map((c) => {
        const icons = iconsOf(view, c);
        return (
          <span key={c} className="pub-book" title={view.cards[c].title}>
            {view.cards[c].wild
              // «Чукоккала»: значок любого жанра (с монографией — два).
              ? Array.from({ length: Math.max(1, iconCount(view, c)) }, (_, i) => <span key={i} className="chip wild">ЛЮБОЙ</span>)
              : icons.length ? icons.map((g, i) => <GenreChip key={i} g={g} />)
              : isEvidence(view, c) ? <KindChip k="ul" />
              : isExposed(view, c) ? <span className="chip mb-load" title="Разоблачение">РАЗ</span>
              : <span className="kind">—</span>}
          </span>
        );
      })}
    </div>
  );
  return <div className="published">{row('Тамиздат', tam)}{row('Самиздат', sam)}</div>;
}
