// Игровой стол.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ADDRESSES, COPY_TEXT_ADDRESSES, GENRE_NAMES, GROUP_ACTIONS, safehouseCost, PASSIONS, POINT_SOURCES, passionLabel, RULES, SPROUTS, SPROUT_BONUS_NAMES, STEP_REWARDS, limitFor,
  groupInGame,
} from '../engine/content';
import type { Action, AddressId, CopyTextAddress, CopyTextBuy, Genre, GroupAction, GroupActionId, PlaceAction, PointSource, SproutBonusId } from '../engine/types';
import { GENRES } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { coversStep, hasPatron, isEvidence, isExposed, loadCover, roman } from '../engine/util';
import {
  ClubContents, ClubGiftModal, ClubPanel, FreeConnectionPrompt, HandoutPrompt, KontoraContents, KontoraDecidePrompt, KontoraPanel,
  KontoraWarningPrompt, RescuePanel,
} from './full-ui';
import type { ClientMessage, RoomInfo } from '../shared/protocol';
import { Book, GenreChip, SpeedSelect, Modal, PLAYER_COLORS, fromLoadDeck, iconsOf, isBanned, toggle } from './ui';

type Send = (m: ClientMessage) => void;
type VPlayer = PlayerView['players'][number];
type Panel = { kind: 'address'; id: AddressId } | { kind: 'group'; id: GroupActionId } | { kind: 'cache' } | null;

const PHASE_NAMES: Record<string, string> = {
  passion: 'Выбор Пристрастий', setupCache: 'Тайники перед началом', orders: 'Поручения', gathering: 'Посиделки', hiding: 'Укрытие', end: 'Конец Застоя',
};

export function Game({ view, room, you, isHost, send, canStepBack }: { view: PlayerView; room: RoomInfo; you: string | null; isHost: boolean; send: Send; canStepBack?: boolean }) {
  const me = view.players.find((p) => p.id === you) ?? null;
  const act = (action: Action) => send({ t: 'action', action });
  const [panel, setPanel] = useState<Panel>(null);
  const [showResult, setShowResult] = useState(true);
  const seatIndex = (id: string) => room.seats.findIndex((s) => s.id === id);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const myTurn = !!you && view.active.includes(you);
  const head = view.pending[0];
  const myPending = head && head.player === you && !('secret' in head) ? head : null;
  // Действие сделано — дальше только свободные действия и «Закончить ход».
  const afterAction = myTurn && view.phase === 'orders' && !myPending && !!me && view.turnDone === me.id;
  const canPlace = myTurn && view.phase === 'orders' && !myPending && !!me && me.available > 0 && !afterAction;
  // Только что купил на адресе Тиражирования — можно вдогонку взять оттуда же книгу даром.
  const copyFollow = afterAction && !!me && view.lastBuy?.player === me.id && !me.groupUsed.includes('copyText') && me.available > 0;
  const bonusTurn = myTurn && view.phase === 'orders' && !myPending && !!me && me.available === 0 && me.bonusGroupTurns > 0 && !afterAction;
  const canGift = myTurn && view.mode === 'full' && RULES.clubFreeGift && view.phase === 'orders' && !myPending && !!me && view.clubGiftBy !== me.id;
  const mustRed = !!me && me.available === 1 && !me.visitedRedCorner && !hasPatron(view, me.id, 'doctor');

  useEffect(() => { if (!canPlace && !bonusTurn && !canGift && !afterAction) setPanel(null); }, [canPlace, bonusTurn, canGift, afterAction]);

  let status: string;
  if (view.phase === 'end') status = view.result?.note ?? 'Партия окончена';
  else if (head && head.player !== you) status = `${nameOf(head.player)} принимает решение…`;
  else if (myPending) status = 'Примите решение';
  else if (view.phase === 'orders') {
    if (afterAction) status = 'Действие сделано. Можно ' + (copyFollow ? 'тиражировать книгу оттуда же (Инициативная группа), ' : '') + 'пересобрать Тайник' + (view.mode === 'full' ? ', заучить сборник поэзии, отдать книгу в Клуб' : '') + ' — или закончите ход';
    else if (canPlace) status = mustRed ? 'Ваш ход: последнего Единомышленника — в Красный уголок' : 'Ваш ход: отправьте Единомышленника по адресу или в Инициативную группу';
    else if (bonusTurn) status = 'Ваш ход: дополнительное действие Группы с явочного адреса — или откажитесь';
    else status = `Ходит ${view.active.map(nameOf).join(', ')}`;
  } else if (you && view.active.includes(you)) status = 'Ваше решение';
  else status = `Ждём: ${view.active.map(nameOf).join(', ')}`;

  // Порядок на столе: Клуб на всю ширину, под ним Контора и Ростки (вместе с их действием), затем адреса и явочные.
  const full = view.mode === 'full';
  const addresses: AddressId[] = [...BOARD_ORDER, ...view.safehouses];
  const enabledFor = (id: AddressId) => (id === 'club' && RULES.clubFreeGift ? canGift : canPlace && (!mustRed || id === 'redCorner'));
  const card = (id: AddressId) => (
    <AddressCard key={id} id={id} view={view} seatIndex={seatIndex} me={me} enabled={enabledFor(id)} onOpen={() => setPanel({ kind: 'address', id })} />
  );

  return (
    <div className="game">
      <header className="topbar">
        <div className="title">Сохрани мою речь</div>
        <div>{view.reserve && <>Заповедник · </>}{view.solo && <>Несистемный · </>}Пятилетка <b>{view.round}</b>/{RULES.rounds} · {PHASE_NAMES[view.phase]}</div>
        <div className="banned">Цензура {view.censorship}: {view.banned.map((g) => <GenreChip key={g} g={g} banned />)}</div>
        <div className="muted small">Непечатные: {view.deckCount} (сброс {view.discardCount}) · Нагрузка: {view.loadDeckCount}</div>
        {isHost && (
          <div className="host-tools">
            <label className="row small">
              <input type="checkbox" checked={room.hostBot} onChange={(e) => send({ t: 'hostBot', on: e.target.checked })} />
              за меня бот
            </label>
            <SpeedSelect room={room} send={send} />
            <button className="small" disabled={!room.canUndo} onClick={() => send({ t: 'undo' })} title="Отменить последнее действие (для плейтеста)">↶ Отмена</button>
            <button className="small" onClick={() => confirm('Вернуть комнату в лобби? Текущая партия будет потеряна.') && send({ t: 'restart' })}>В лобби</button>
          </div>
        )}
      </header>
      <div className={`status ${myTurn ? 'mine' : ''}`}>
        {status}
        {bonusTurn && <button className="small" onClick={() => act({ type: 'pass' })}>Отказаться</button>}
        {afterAction && <button className="primary small end-turn-inline" onClick={() => act({ type: 'endTurn' })}>Закончить ход</button>}
        {view.phase === 'end' && view.result && <button className="small" onClick={() => setShowResult(true)}>Таблица счёта</button>}
        {canPlace && me.visitedRedCorner && <button className="small" onClick={() => confirm('Спасовать до конца Пятилетки? Оставшиеся Единомышленники не будут действовать.') && act({ type: 'pass' })}>Спасовать</button>}
      </div>

      {/* На телефоне «Закончить ход» выезжает снизу экрана, чтобы не листать к строке статуса. */}
      <div className={`end-turn-sheet ${afterAction ? 'show' : ''}`} aria-hidden={!afterAction}>
        {canStepBack
          ? <button tabIndex={afterAction ? 0 : -1} onClick={() => send({ t: 'stepBack' })} title="Отменить действия этого хода — до момента, когда вы узнали что-то новое">← Назад</button>
          : <span className="muted small" title="Вы уже узнали новое (например, увидели закрытые книги) — отменить ход нельзя">Действие сделано</span>}
        <button className="primary" tabIndex={afterAction ? 0 : -1} onClick={() => act({ type: 'endTurn' })}>Закончить ход</button>
      </div>
      {view.phase === 'passion' && me ? (
        <p className="center muted">Стол откроется, когда все выберут Пристрастия.</p>
      ) : (
      <main className="layout">
        <section className="board">
          <div className="addresses">
            {full && card('club')}
            {full && !view.reserve && card('kontora')}
            <Sprouts view={view} beside={full && !view.reserve} seatIndex={seatIndex}
              head={<AddressHead id="sprouts" view={view} seatIndex={seatIndex} me={me} enabled={enabledFor('sprouts')} onOpen={() => setPanel({ kind: 'address', id: 'sprouts' })} />} />
            {addresses.map(card)}
          </div>
        </section>
        <aside className="side">
          {me && (
            <MyPanel view={view} me={me} color={PLAYER_COLORS[seatIndex(me.id)]}
              groupEnabled={canPlace || bonusTurn || copyFollow} onlyHire={canPlace && mustRed} onlyCopy={copyFollow} onGroup={(id) => setPanel({ kind: 'group', id })}
              onMemorize={view.mode === 'full' && (canPlace || bonusTurn || afterAction) ? (card) => act({ type: 'memorize', card }) : null}
              onCache={canPlace || bonusTurn || afterAction ? () => setPanel({ kind: 'cache' }) : null} />
          )}
          {view.players.filter((p) => p.id !== you).map((p) => (
            <OtherPlayer key={p.id} view={view} p={p} color={PLAYER_COLORS[seatIndex(p.id)]} active={view.active.includes(p.id)} first={view.order[0] === p.id} />
          ))}
          <Log view={view} seatIndex={seatIndex} />
        </aside>
      </main>
      )}

      {panel?.kind === 'address' && panel.id === 'club' && RULES.clubFreeGift && me && canGift && (
        <ClubGiftModal view={view} me={me} act={act} close={() => setPanel(null)} />
      )}
      {panel?.kind === 'address' && !(panel.id === 'club' && RULES.clubFreeGift) && me && (
        <AddressPanel id={panel.id} view={view} me={me} close={() => setPanel(null)} place={(place) => { act({ type: 'place', place }); setPanel(null); }} />
      )}
      {panel?.kind === 'cache' && me && (
        <CacheModal view={view} me={me} close={() => setPanel(null)} done={(hidden) => { act({ type: 'hiding', hidden }); setPanel(null); }} />
      )}
      {panel?.kind === 'group' && me && (
        <GroupPanel id={panel.id} view={view} me={me} close={() => setPanel(null)} done={(group) => { act({ type: 'group', group }); setPanel(null); }} />
      )}
      {myPending && me && <PendingPrompt view={view} me={me} act={act} nameOf={nameOf} />}
      {!myPending && me && view.phase === 'passion' && view.active.includes(me.id) && <PassionPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'gathering' && view.active.includes(me.id) && <GatheringPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'hiding' && view.active.includes(me.id) && <HidingPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'setupCache' && view.active.includes(me.id) && (
        <CacheModal view={view} me={me} title="Тайник перед началом" note="Соперники пока не видят ваших стартовых книг. Что спрячете сейчас, то они так и не увидят; остальное ляжет на Склад открыто."
          done={(hidden) => act({ type: 'hiding', hidden })} />
      )}
      {view.phase === 'end' && view.result && showResult && <Results view={view} seatIndex={seatIndex} close={() => setShowResult(false)} />}
    </div>
  );
}

// ---------- Адреса ----------

// Порядок обычных адресов на поле (после Клуба, Конторы и Ростков); явочные — следом.
const BOARD_ORDER: AddressId[] = ['redCorner', 'glavlit', 'gostorg', 'baraholka', 'tolkuchka', 'razval', 'zavoz', 'tamizdat', 'samizdat'];

type AddressProps = { id: AddressId; view: PlayerView; seatIndex: (id: string) => number; me: VPlayer | null; enabled: boolean; onOpen: () => void };

// Каким книгам можно вернуть смыслы.
const restorable = (kind: string) => ['genre', 'loadReturnable', 'loadEvidence', ...(RULES.exposePropaganda ? ['propaganda'] : [])].includes(kind);

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
  const open = enabled && !full ? props.onOpen : undefined;
  return (
    <div className={`address addr-${id} ${info.safehouse ? 'safehouse' : ''} ${open ? 'can' : ''}`} onClick={open}
      role={open ? 'button' : undefined} title={open ? 'Отправить Единомышленника сюда' : undefined}>
      <AddressHead {...props} inlineHint={inlineHint} />
      {!inlineHint && <div className="hint">{info.hint}</div>}
      <AddressContents id={id} view={view} seatIndex={seatIndex} />
    </div>
  );
}

// Заголовок адреса: название, жетоны Единомышленников, места и кнопка «сюда».
function AddressHead({ id, view, seatIndex, me, enabled, onOpen, inlineHint }: AddressProps & { inlineHint?: boolean }) {
  const info = ADDRESSES[id];
  const here = view.occupancy[id] ?? [];
  const limit = limitFor(id, view.players.length);
  const freeClub = id === 'club' && RULES.clubFreeGift;
  const full = addressFull(id, view, me);
  return (
      <div className="addr-head">
        <b>{info.name}</b>
        {inlineHint && <span className="hint inline">{info.hint}</span>}
        <span className="workers">
          {here.map((pid, i) => {
            // Номер на жетоне — каким по счёту в Пятилетке было это действие игрока.
            const k = here.slice(0, i).filter((x) => x === pid).length;
            const n = view.players.find((x) => x.id === pid)?.actions?.filter((a) => a.target === id)[k]?.n;
            return <span key={i} className="dot num" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} title={n ? `${n}-е действие игрока` : undefined}>{n ?? ''}</span>;
          })}
          {!freeClub && (limit === Infinity
            ? <span className="muted small">∞</span>
            : Array.from({ length: Math.max(0, limit - here.length) }, (_, i) => <span key={`free${i}`} className="dot num slot-free" title="Свободное место" />))}
          {enabled && freeClub && <button className="go small" onClick={(e) => { e.stopPropagation(); onOpen(); }} title="Свободное действие: Единомышленник не нужен">отдать книгу →</button>}
          {enabled && !freeClub && <button className="go small" disabled={full} onClick={(e) => { e.stopPropagation(); onOpen(); }} title={full ? 'Мест нет' : 'Отправить Единомышленника сюда'}>{full ? 'занято' : 'сюда →'}</button>}
        </span>
      </div>
  );
}

function AddressContents({ id, view, seatIndex }: { id: AddressId; view: PlayerView; seatIndex: (id: string) => number }) {
  switch (id) {
    case 'club':
      return <ClubContents view={view} seatIndex={seatIndex} />;
    case 'kontora':
      return <KontoraContents view={view} />;
    case 'redCorner': {
      if (view.round >= RULES.rounds) return <div className="muted small">Последняя Пятилетка — очередь уже не важна.</div>;
      // Новый порядок: сперва посетившие Красный уголок, затем остальные в прежнем порядке.
      const rest = view.order.filter((pid) => !view.nextOrder.includes(pid));
      const name = (pid: string) => view.players.find((p) => p.id === pid)?.name ?? '?';
      return (
        <div className="queue">
          <div className="muted small">Порядок хода в следующей Пятилетке:</div>
          <ol>
            {view.nextOrder.map((pid) => (
              <li key={pid}><span className="dot" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} /> {name(pid)}</li>
            ))}
            {rest.map((pid) => (
              <li key={pid} className="pending" title="Ещё не был(а) в Красном уголке: встанет после всех, кто был">
                <span className="dot" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} /> {name(pid)} <span className="muted small">— ждём</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    case 'tolkuchka':
      return <div className="shelf wrap">{view.tolkuchka.map((c) => <Book key={c} v={view} id={c} small price={RULES.tolkuchkaBuy} />)}{emptySlots(RULES.displaySize - view.tolkuchka.length)}</div>;
    case 'razval':
      return <div className="shelf wrap">{view.razval.map((c, i) => c ? <Book key={i} v={view} id={c} small price={RULES.razvalPrices[i]} /> : <div key={i} className="book empty small" />)}</div>;
    case 'baraholka':
      return <div className="shelf wrap">{view.baraholka.map((has, i) => has ? <Book key={i} v={view} id={view.baraholkaKnown?.[i] ?? null} small note={view.baraholkaKnown?.[i] ? 'вы видели' : undefined} /> : <div key={i} className="book empty small" />)}</div>;
    case 'knigoobmen':
      return <div className="shelf wrap">{view.knigoobmen.map((c) => <Book key={c} v={view} id={c} small />)}{emptySlots(RULES.displaySize - view.knigoobmen.length)}</div>;
    case 'raspredelitel':
      return <div className="shelf wrap">{view.raspredelitel.map((c) => <Book key={c} v={view} id={c} small price={RULES.raspredelitelPrice} />)}{emptySlots(RULES.raspredelitelSize - view.raspredelitel.length)}</div>;
    default:
      return null;
  }
}

function AddressPanel({ id, view, me, close, place }: { id: AddressId; view: PlayerView; me: VPlayer; close: () => void; place: (p: PlaceAction) => void }) {
  const info = ADDRESSES[id];
  const mine = me.warehouse.map((s) => s.card!).filter(Boolean);
  const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
  const veteran = hasPatron(view, me.id, 'veteran');
  const [sel, setSel] = useState<string[]>([]);
  const [sel2, setSel2] = useState<string[]>([]);
  const [num, setNum] = useState(1);
  const [genre, setGenre] = useState<Genre>('prose');
  const [loadN, setLoadN] = useState(1);
  const [target, setTarget] = useState<string>(view.players.find((p) => p.id !== me.id)?.id ?? '');
  const confirmBtn = (label: string, action: PlaceAction | null, extra?: string) => (
    <div className="modal-foot">
      {extra && <span className="muted">{extra}</span>}
      <button className="primary" disabled={!action} onClick={() => action && place(action)}>{label}</button>
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
      const max = Math.min(Math.floor(free / 2), zavmag ? Infinity : me.talons);
      body = (
        <>
          <p>Каждая пара — 1 Нагрузка и 1 Непечатная книга вслепую, за 1 Талон. Свободных мест: {free}.</p>
          <label>Пар: <input type="number" min={1} max={max} value={num} onChange={(e) => setNum(Number(e.target.value))} /></label>
          {zavmag && (
            <label>Завмаг: из {num * 2} книг Нагрузки — <input type="number" min={0} max={num * 2} value={Math.min(loadN, num * 2)} onChange={(e) => setLoadN(Number(e.target.value))} />, остальные — Непечатные</label>
          )}
          {confirmBtn(zavmag ? 'Взять бесплатно (Завмаг)' : `Купить за ${num}т`, max >= 1 && num >= 1 && num <= max
            ? { address: 'gostorg', pairs: num, ...(zavmag ? { mix: Array.from({ length: num * 2 }, (_, i) => (i < Math.min(loadN, num * 2) ? 'load' as const : 'unprinted' as const)) } : {}) }
            : null, max < 1 ? 'Нужно 2 свободных места и 1 Талон' : undefined)}
        </>
      );
      break;
    }
    case 'tolkuchka': {
      const sellable = mine.filter((c) => iconsOf(view, c).length > 0 && !['evidence', 'loadEvidence', 'propaganda'].includes(view.cards[c].kind));
      const price = (c: string) => (iconsOf(view, c).some((g) => view.banned.includes(g)) ? RULES.tolkuchkaSellBanned : RULES.tolkuchkaSellFree);
      const gain = sel2.reduce((s, c) => s + price(c), 0);
      const cost = sel.length * RULES.tolkuchkaBuy;
      const ops = [...sel2.map((card) => ({ op: 'sell' as const, card })), ...sel.map((card) => ({ op: 'buy' as const, card }))];
      body = (
        <>
          <h4>Купить (−{RULES.tolkuchkaBuy}т за книгу)</h4>
          {pickList(view.tolkuchka, sel, setSel, { note: () => `${RULES.tolkuchkaBuy}т` })}
          <h4>Продать (+{RULES.tolkuchkaSellBanned}т за книгу опального жанра, +{RULES.tolkuchkaSellFree}т за прочие)</h4>
          {pickList(sellable, sel2, setSel2, { note: (c) => `+${price(c)}т` })}
          {confirmBtn('Совершить сделки', ops.length ? { address: 'tolkuchka', ops } : null, `Итого: ${gain - cost >= 0 ? '+' : ''}${gain - cost}т (у вас ${me.talons}т)`)}
        </>
      );
      break;
    }
    case 'redCorner': {
      const komsorg = hasPatron(view, me.id, 'komsorg');
      const unprinted = sel.filter((c) => !fromLoadDeck(view, c)).length;
      const load = sel.filter((c) => fromLoadDeck(view, c)).length;
      body = (
        <>
          <p>Вы встанете в очередь хода следующей Пятилетки. Можно сдать в макулатуру до 1 Непечатной книги (+{RULES.redCornerUnprinted}т) и до 1 книги Нагрузки (+{RULES.redCornerLoad}т). Пропаганду можно сбыть только здесь.</p>
          {komsorg && <p className="muted small">Комсорг: можно сдать любое число книг, за каждую — +{RULES.komsorgPoints} очко Гласности.</p>}
          {pickList(mine, sel, setSel)}
          {confirmBtn('Пойти в Красный уголок', (unprinted <= 1 && load <= 1) || komsorg ? { address: 'redCorner', recycle: sel } : null,
            !komsorg && (unprinted > 1 || load > 1) ? 'Слишком много книг'
              : `+${unprinted * RULES.redCornerUnprinted + load * RULES.redCornerLoad}т${komsorg && sel.length ? `, +${sel.length * RULES.komsorgPoints} оч.` : ''}`)}
        </>
      );
      break;
    }
    case 'razval':
      body = (
        <>
          <p>{veteran ? 'Ветеран: купите сколько угодно книг, в сумме на 1 Талон дешевле (минимум 1).' : 'Купите 1 книгу.'} Цена зависит от свежести.</p>
          <div className="shelf wrap">
            {view.razval.map((c, i) => c && (
              <Book key={i} v={view} id={c} price={RULES.razvalPrices[i]} selected={sel.includes(String(i))}
                onClick={() => setSel(veteran ? toggle(sel, String(i)) : [String(i)])} />
            ))}
          </div>
          {confirmBtn('Купить', sel.length && free >= sel.length ? { address: 'razval', slot: Number(sel[0]), ...(sel.length > 1 ? { slots: sel.map(Number) } : {}) } : null,
            free >= Math.max(1, sel.length) ? undefined : 'Нет места на складе')}
        </>
      );
      break;
    case 'zavoz':
      body = <><p>Получите {RULES.zavozIncome} Талона. Всё, что лежит на Развале, уйдёт в сброс, и Развал заполнится новыми книгами.</p>{confirmBtn('Подработать', { address: 'zavoz' })}</>;
      break;
    case 'baraholka': {
      const need = Math.min(RULES.baraholkaLook, view.baraholka.filter(Boolean).length);
      // Выбор по кругу: новая книга вытесняет самую раннюю из выбранных.
      const pick = (i: string) => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].slice(-need));
      body = (
        <>
          <p>Выберите {need === 1 ? 'закрытую книгу' : `${need} закрытые книги`}. Вы тайно посмотрите их и сможете купить одну за {RULES.baraholkaPrice}т.
            {view.baraholkaKnown?.some(Boolean) && ' Открытые — те, что вы уже видели.'}</p>
          <div className="shelf">
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
          {confirmBtn(`Подписаться за ${num}т`, num >= 1 && num <= maxRounds && num <= me.talons ? { address: 'podpiska', genre, talons: num } : null)}
        </>
      );
      break;
    }
    case 'sprouts':
      body = <SproutFeeder view={view} me={me} place={place} />;
      break;
    case 'samizdat':
    case 'tamizdat': {
      const ok = (c: string) => isExposed(view, c) || view.cards[c].kind !== 'propaganda' && (iconsOf(view, c).length > 0 && !isEvidence(view, c) || (id === 'tamizdat' && isEvidence(view, c)));
      const n = sel[0] ? iconsOf(view, sel[0]).length + (isExposed(view, sel[0]) ? 1 : 0) : 0;
      body = (
        <>
          <p>Издайте одну книгу: она навсегда спасена, место на складе освобождается, а в подсчёте по Пристрастию книга участвует. {id === 'tamizdat' ? `+${RULES.tamizdatTalons}т и +${RULES.tamizdatPoints} очка за значок.` : `+${RULES.samizdatTalons}т за значок.`}</p>
          {pickList(mine.filter(ok), sel, setSel, { max: 1 })}
          {confirmBtn('Издать', sel.length ? { address: id, card: sel[0] } : null, sel.length ? `+${n * (id === 'tamizdat' ? RULES.tamizdatTalons : RULES.samizdatTalons)}т${id === 'tamizdat' ? `, +${n * RULES.tamizdatPoints} оч.` : ''}` : undefined)}
        </>
      );
      break;
    }
    case 'glavlit': {
      // Подцензурные книги: жанровые, хотя бы один жанр которых сейчас под цензурой.
      const ok = (c: string) => view.cards[c].kind === 'genre' && iconsOf(view, c).some((g) => view.banned.includes(g));
      const editor = hasPatron(view, me.id, 'editor');
      const pts = sel.reduce((s, c) => s + iconsOf(view, c).length, 0);
      const loads = Math.min(loadN, sel.length);
      const draws = sel.map((_, i) => (i < loads ? 'load' as const : 'unprinted' as const));
      body = (
        <>
          <p>Сдайте любое число подцензурных книг (+{RULES.glavlitTalons}т за каждую) и возьмите столько же книг вслепую — из Непечатных или Нагрузки, как решите.
            {editor ? ' Главред: +1 очко Гласности за каждый значок сданных книг.' : ''}</p>
          {mine.filter(ok).length === 0 && <p className="warn-text">Подцензурных книг у вас нет: нужна жанровая книга, жанр которой сейчас под цензурой.</p>}
          {pickList(mine.filter(ok), sel, setSel)}
          {sel.length > 0 && (
            <div className="row">Взамен взять — Нагрузки:
              <input type="number" style={{ width: 64 }} min={0} max={sel.length} value={loads} onChange={(e) => setLoadN(Number(e.target.value))} />
              Непечатных: <b>{sel.length - loads}</b></div>
          )}
          {confirmBtn('Сдать в Главлит', sel.length ? { address: 'glavlit', cards: sel, draws } : null,
            sel.length ? `+${sel.length * RULES.glavlitTalons}т${editor && pts ? `, +${pts} оч.` : ''}` : undefined)}
        </>
      );
      break;
    }
    case 'knigoobmen':
      body = (
        <>
          <h4>Отдайте жанровую книгу</h4>
          {pickList(mine.filter((c) => iconsOf(view, c).length > 0), sel, setSel, { max: 1 })}
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
          <label>С кем: <select value={target} onChange={(e) => { setTarget(e.target.value); setSel2([]); }}>
            {view.players.filter((p) => p.id !== me.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
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
          {veteran && <p className="muted small">Ветеран: купите сколько угодно книг, в сумме на 1 Талон дешевле (минимум 1).</p>}
          {pickList(view.raspredelitel, sel, setSel, veteran ? {} : { max: 1 })}
          {confirmBtn(veteran && sel.length > 1 ? 'Купить' : `Купить за ${RULES.raspredelitelPrice}т`, sel.length && free >= sel.length
            ? { address: 'raspredelitel', card: sel[0], ...(sel.length > 1 ? { cards: sel } : {}) } : null)}
        </>
      );
      break;
    case 'club':
      body = <ClubPanel view={view} me={me} place={place} />;
      break;
    case 'kontora':
      body = <KontoraPanel view={view} place={place} />;
      break;
    case 'nasledniki':
    case 'posrednichestvo':
    case 'spisanie':
      body = <><p>{info.hint}</p>{confirmBtn(`Заплатить ${safehouseCost(id)}т`, me.talons >= safehouseCost(id) && free > 0 ? { address: id } : null,
        free <= 0 ? 'Нет места на складе' : me.talons < safehouseCost(id) ? `Не хватает Талонов: нужно ${safehouseCost(id)}, у вас ${me.talons}` : undefined)}</>;
      break;
  }
  return <Modal title={info.name} onClose={close} wide>{body}<p className="muted small">Талонов: {me.talons} · Свободных мест: {free}</p></Modal>;
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
function Sprouts({ view, beside, seatIndex, head }: { view: PlayerView; beside: boolean; seatIndex: (id: string) => number; head: ReactNode }) {
  return (
    <div className={`sprouts-panel address addr-sprouts ${beside ? 'beside' : ''}`}>
      {head}
      <div className="hint">{ADDRESSES.sprouts.hint}. Гласность: {RULES.glasnostAllSprouts ? 'все Ростки' : 'хотя бы один Росток'} до ступени {roman(RULES.glasnostStep)}.</div>
      <div className="sprouts">
      {view.sprouts.map((sp) => {
        const info = SPROUTS.find((s) => s.id === sp.id)!;
        return (
          <div key={sp.id} className={`sprout ${sp.progress >= RULES.glasnostStep ? 'grown' : ''}`}>
            <div className="addr-head"><b>{info.name}</b>
              <span className="workers" title={`Места в эту Пятилетку: не больше ${RULES.sproutSlotsPerRound} ступеней`}>
                {Array.from({ length: RULES.sproutSlotsPerRound }, (_, i) => {
                  const pid = view.sproutRound?.[sp.id]?.[i];
                  return pid
                    ? <span key={i} className="dot num" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} />
                    : <span key={i} className="dot num slot-free" />;
                })}
              </span>
            </div>
            {/* Жетоны игроков, которые хоть раз питали этот Росток (+2 очка за первое питание) */}
            {view.players.some((p) => p.sproutsFed.includes(sp.id)) && (
              <div className="workers" title="Питали этот Росток (получили +2 очка за первое питание)">
                {view.players.filter((p) => p.sproutsFed.includes(sp.id)).map((p) => (
                  <span key={p.id} className="dot" style={{ background: PLAYER_COLORS[seatIndex(p.id)] }} title={p.name} />
                ))}
              </div>
            )}
            <ol className="steps">
              {info.steps.map((st, i) => (
                <li key={i} className={i < sp.progress ? 'done' : i === sp.progress ? 'next' : ''}>
                  {stepText(info.main, st)}
                  <span className="muted small"> {STEP_REWARDS[i].talons ? `+${STEP_REWARDS[i].talons}т` : `+${STEP_REWARDS[i].points}★`}</span>
                </li>
              ))}
            </ol>
            <div className="muted bonus" title="Бонус за закрытие ступени (одно на выбор)">Бонус: {info.bonuses.filter((b) => b !== 'rescue' || (view.mode === 'full' && !view.reserve)).map((b) => SPROUT_BONUS_NAMES[b]).join(' / ')}</div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function SproutFeeder({ view, me, place }: { view: PlayerView; me: VPlayer; place: (p: PlaceAction) => void }) {
  const [feeds, setFeeds] = useState<{ sprout: string; books: string[]; labtech?: boolean }[]>([]);
  const [sprout, setSprout] = useState<string>('');
  const [books, setBooks] = useState<string[]>([]);
  const used = feeds.flatMap((f) => f.books);
  const mine = me.warehouse.map((s) => s.card!).filter((c) => c && !used.includes(c));
  const progressOf = (id: string) => view.sprouts.find((s) => s.id === id)!.progress + feeds.filter((f) => f.sprout === id).length;
  const info = SPROUTS.find((s) => s.id === sprout);
  const step = info && info.steps[progressOf(sprout)];
  const wildScifi = view.mode === 'full';
  const plain = !!info && !!step && coversStep(view, books, info.main, step.main, step.support, { wildScifi });
  // Лаборант: скидка в 1 значок — один раз за поручение.
  const discount = !plain && !!info && !!step && hasPatron(view, me.id, 'labtech') && !feeds.some((f) => f.labtech)
    && coversStep(view, books, info.main, step.main, step.support, { wildScifi, labtech: true });
  const ok = plain || discount;
  return (
    <>
      <p>Закройте ступень: отдайте книги, на которых есть все значки ступени. {RULES.sproutFeedsPerAction === 1 ? 'За одно поручение — только 1 ступень одного Ростка.' : `За одно поручение — до ${RULES.sproutFeedsPerAction} ступеней у разных Ростков.`}</p>
      <div className="genres">
        {view.sprouts.map((sp) => {
          const inf = SPROUTS.find((s) => s.id === sp.id)!;
          const pr = progressOf(sp.id);
          return (
            <button key={sp.id} disabled={pr >= 4 || (view.sproutRound?.[sp.id]?.length ?? 0) >= RULES.sproutSlotsPerRound} className={sprout === sp.id ? 'selected' : ''} onClick={() => { setSprout(sp.id); setBooks([]); }}>
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
          {feeds.length + 1 >= RULES.sproutFeedsPerAction
            ? <button className="primary" disabled={!ok} onClick={() => place({ address: 'sprouts', feeds: [...feeds, { sprout, books }] })}>Закрыть ступень{discount ? ' (скидка Лаборанта)' : ''}</button>
            : <button disabled={!ok} onClick={() => { setFeeds([...feeds, { sprout, books, labtech: discount }]); setBooks([]); }}>Добавить ступень{discount ? ' (скидка Лаборанта)' : ''}</button>}
        </>
      )}
      {feeds.length > 0 && (
        <ul>{feeds.map((f, i) => <li key={i}>{SPROUTS.find((s) => s.id === f.sprout)!.name}: {f.books.map((b) => view.cards[b].title).join(', ')}</li>)}</ul>
      )}
      {RULES.sproutFeedsPerAction > 1 && (
        <div className="modal-foot">
          <button className="primary" disabled={!feeds.length} onClick={() => place({ address: 'sprouts', feeds })}>Закрыть ступени ({feeds.length})</button>
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
      if (me.workers >= RULES.maxWorkers) return `У вас уже максимум Единомышленников (${RULES.maxWorkers}).`;
      if (me.talons < RULES.hireCost) return `Нужно ${RULES.hireCost} Талонов, у вас ${me.talons} — не хватает ${RULES.hireCost - me.talons}.`;
      return null;
    case 'expandWarehouse':
      return me.capacity >= RULES.maxCapacity ? `Склад уже максимального размера (${RULES.maxCapacity}).` : null;
    case 'expandCache':
      return me.cache >= RULES.maxCache ? `Тайник уже максимального размера (${RULES.maxCache}).` : null;
    case 'copyText':
      // Купленная и бесплатная книги — 2 места; на Толкучке место можно освободить продажей.
      return free < 1 ? 'На складе нет свободного места.' : null;
    case 'rescue':
      return view.players.some((p) => p.held > 0) ? null : 'Контора никого не удерживает.';
    case 'restore':
      if (me.talons < RULES.restoreCost) return `Нужно ${RULES.restoreCost}т, у вас ${me.talons}.`;
      return me.warehouse.some((s) => s.card && !view.restored[s.card] && restorable(view.cards[s.card].kind))
        ? null : 'На складе нет книги, которой можно вернуть смыслы.';
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
        <p>{info.hint}</p>
        <p className="warn-text">Сейчас нельзя. {blocker}</p>
        <div className="modal-foot">{close && <button onClick={close}>Понятно</button>}<button className="primary" disabled>Выполнить</button></div>
      </>
    );
  } else if (id === 'rescue') {
    body = <RescuePanel view={view} done={done} />;
  } else if (id === 'copyText' && view.lastBuy?.player === me.id && view.turnDone === me.id) {
    body = <CopyFollowPanel view={view} done={done} />;
  } else if (id === 'copyText') {
    body = <CopyTextPanel view={view} me={me} done={done} />;
  } else if (id === 'restore') {
    const cands = me.warehouse.map((s) => s.card!).filter((c) => c && !view.restored[c] && restorable(view.cards[c].kind));
    body = (
      <>
        <p>Жанровая книга получает +1 значок своего жанра; у двужанровой книги жанр этого значка выбирается всякий раз, когда это важно. Нагрузка проглоченного автора становится возвращённым произведением с 3 значками.{RULES.exposePropaganda && ` Пропаганда становится Разоблачением: +${RULES.exposePoints} очка в конце, его можно издать как книгу с 1 значком.`}</p>
        <div className="shelf wrap">{cands.map((c) => <Book key={c} v={view} id={c} selected={sel === c} onClick={() => setSel(c)} />)}</div>
        <div className="modal-foot"><button className="primary" disabled={!sel} onClick={() => done({ action: 'restore', card: sel })}>Вернуть смыслы</button></div>
      </>
    );
  } else {
    body = (
      <>
        <p>{info.hint}</p>
        <div className="modal-foot"><button className="primary" onClick={() => done({ action: id } as GroupAction)}>Выполнить</button></div>
      </>
    );
  }
  return <Modal title={title ?? info.name} onClose={close}>{body}</Modal>;
}

// Тиражирование вдогонку: покупка уже сделана — выбрать книгу оттуда же, даром.
function CopyFollowPanel({ view, done }: { view: PlayerView; done: (g: GroupAction) => void }) {
  const last = view.lastBuy!;
  const [gift, setGift] = useState('');
  const shelf = (last.address === 'razval' ? view.razval : view[last.address]).filter((c): c is string => !!c && !last.exclude.includes(c));
  return (
    <>
      <p>Вы только что купили: {ADDRESSES[last.address].name}. Второй Единомышленник встаёт на Тиражирование — возьмите оттуда же одну жанровую книгу даром.</p>
      <div className="shelf wrap">
        {shelf.length === 0 && <span className="muted">Здесь больше нет книг</span>}
        {shelf.map((c) => {
          const genre = iconsOf(view, c).length > 0;
          return <Book key={c} v={view} id={c} note={genre ? 'даром' : 'нельзя: не жанровая'} selected={gift === c} onClick={genre ? () => setGift(gift === c ? '' : c) : undefined} />;
        })}
      </div>
      <div className="modal-foot"><button className="primary" disabled={!gift} onClick={() => done({ action: 'copyText', address: last.address, card: gift })}>Тиражировать</button></div>
    </>
  );
}

// Тиражирование текста: покупая на адресе, Единомышленник на Тиражировании позволяет взять оттуда же ещё 1 книгу даром.
function CopyTextPanel({ view, me, done }: { view: PlayerView; me: VPlayer; done: (g: GroupAction) => void }) {
  const addrs = COPY_TEXT_ADDRESSES.filter((a) => !ADDRESSES[a].safehouse || view.safehouses.includes(a));
  const [addr, setAddr] = useState<CopyTextAddress>('razval');
  const [buy, setBuy] = useState<string[]>([]); // на Развале — номера ячеек, иначе — книги
  const [gift, setGift] = useState('');
  const [sell, setSell] = useState<string[]>([]); // Толкучка: продать; Книгообмен: отдать (одну)
  const choose = (a: CopyTextAddress) => { setAddr(a); setBuy([]); setGift(''); setSell([]); };
  const free = me.capacity - me.warehouse.filter((s) => !s.memorized).length;
  const mine = me.warehouse.map((s) => s.card).filter((c): c is string => !!c);
  const genreBooks = mine.filter((c) => iconsOf(view, c).length > 0);
  const sellable = genreBooks.filter((c) => !['evidence', 'loadEvidence', 'propaganda'].includes(view.cards[c].kind));
  const sellPrice = (c: string) => (iconsOf(view, c).some((g) => view.banned.includes(g)) ? RULES.tolkuchkaSellBanned : RULES.tolkuchkaSellFree);
  const shelf: { key: string; card: string; price: number }[] =
    addr === 'razval' ? view.razval.flatMap((c, i) => (c ? [{ key: String(i), card: c, price: RULES.razvalPrices[i] }] : []))
      : addr === 'tolkuchka' ? view.tolkuchka.map((c) => ({ key: c, card: c, price: RULES.tolkuchkaBuy }))
        : addr === 'raspredelitel' ? view.raspredelitel.map((c) => ({ key: c, card: c, price: RULES.raspredelitelPrice }))
          : view.knigoobmen.map((c) => ({ key: c, card: c, price: 0 }));
  const bought = shelf.filter((x) => buy.includes(x.key));
  const swap = addr === 'knigoobmen';
  const income = addr === 'tolkuchka' ? sell.reduce((s, c) => s + sellPrice(c), 0) : 0;
  const cost = (swap ? 0 : bought.reduce((s, x) => s + x.price, 0)) - income;
  const gives = addr === 'tolkuchka' || swap ? sell.length : 0;
  const room = free + gives - bought.length - (gift ? 1 : 0);
  const purchase: CopyTextBuy | null =
    addr === 'razval' ? (bought.length ? { address: 'razval', slot: Number(buy[0]) } : null)
      : addr === 'tolkuchka' ? (bought.length || sell.length ? { address: 'tolkuchka', ops: [...sell.map((card) => ({ op: 'sell' as const, card })), ...bought.map((x) => ({ op: 'buy' as const, card: x.card }))] } : null)
        : addr === 'raspredelitel' ? (bought.length ? { address: 'raspredelitel', card: bought[0].card } : null)
          : (bought.length && sell.length ? { address: 'knigoobmen', give: sell[0], take: bought[0].card } : null);
  const halfSwap = swap && (bought.length > 0) !== (sell.length > 0);
  const busy = (a: AddressId) => (view.occupancy[a]?.length ?? 0) >= limitFor(a, view.players.length);
  const ok = purchase && gift && !halfSwap && cost <= me.talons && room >= 0;
  return (
    <>
      <p>{GROUP_ACTIONS.copyText.hint}. Покупатель занимает место на адресе, второй Единомышленник встаёт на Тиражирование (если Тиражирование — бонус, идёт только покупатель).</p>
      <div className="row">
        {addrs.map((a) => (
          <button key={a} className={addr === a ? 'selected' : ''} onClick={() => choose(a)}>{ADDRESSES[a].name}{busy(a) ? ' (занято)' : ''}</button>
        ))}
      </div>
      <h4>{swap ? 'Обменять: взять с витрины' : `Купить${addr === 'tolkuchka' ? ' (можно несколько)' : ''}`}</h4>
      <div className="shelf wrap">
        {shelf.length === 0 && <span className="muted">Здесь нет книг</span>}
        {shelf.map((x) => (
          <Book key={x.key} v={view} id={x.card} note={swap ? 'обмен' : undefined} price={swap ? undefined : x.price} selected={buy.includes(x.key)}
            onClick={() => { setBuy(addr === 'tolkuchka' ? toggle(buy, x.key) : buy.includes(x.key) ? [] : [x.key]); if (gift === x.card) setGift(''); }} />
        ))}
      </div>
      {(addr === 'tolkuchka' || swap) && (
        <>
          <h4>{swap ? '…отдав свою жанровую книгу' : 'Продать свои (освобождает место)'}</h4>
          <div className="shelf wrap">
            {(swap ? genreBooks : sellable).map((c) => (
              <Book key={c} v={view} id={c} note={swap ? 'отдать' : `+${sellPrice(c)}т`} selected={sell.includes(c)}
                onClick={() => setSell(swap ? (sell.includes(c) ? [] : [c]) : toggle(sell, c))} />
            ))}
          </div>
        </>
      )}
      <h4>Взять бесплатно</h4>
      <div className="shelf wrap">
        {shelf.filter((x) => !buy.includes(x.key)).map((x) => {
          // Тиражировать можно только жанровые книги — Улику и Пропаганду нельзя.
          const genre = iconsOf(view, x.card).length > 0;
          return (
            <Book key={x.key} v={view} id={x.card} note={genre ? 'даром' : 'нельзя: не жанровая'} selected={gift === x.card}
              onClick={genre ? () => setGift(gift === x.card ? '' : x.card) : undefined} />
          );
        })}
      </div>
      <div className="modal-foot">
        <span className={room < 0 || halfSwap ? 'warn-text' : 'muted'}>
          {cost >= 0 ? `−${cost}` : `+${-cost}`}т (у вас {me.talons}т){room < 0 ? ' · не хватает места на складе' : ''}{halfSwap ? ' · для обмена выберите обе книги' : ''}
        </span>
        <button className="primary" disabled={!ok} onClick={() => done({ action: 'copyText', address: addr, buy: purchase, card: gift || null })}>Тиражировать</button>
      </div>
    </>
  );
}

// ---------- Решения ----------

function PendingPrompt({ view, me, act, nameOf }: { view: PlayerView; me: VPlayer; act: (a: Action) => void; nameOf: (id: string) => string }) {
  const p = view.pending[0];
  const [sel, setSel] = useState<string[]>([]);
  const [groupFor, setGroupFor] = useState<SproutBonusId | 'posred' | null>(null);
  if ('secret' in p) return null;
  switch (p.kind) {
    case 'kontoraWarning':
      return <KontoraWarningPrompt view={view} me={me} from={p.from} act={act} />;
    case 'kontoraDecide':
      return <KontoraDecidePrompt view={view} me={me} act={act} />;
    case 'kontoraHandout':
      return <HandoutPrompt view={view} cards={p.cards} act={act} />;
    case 'freeConnection':
      return <FreeConnectionPrompt view={view} me={me} act={act} />;
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
                <button className="primary small" disabled={me.talons < cost} onClick={() => act({ type: 'baraholkaBuy', slot: x.slot })}>Купить за {cost}т</button>
              </div>
            ))}
          </div>
          {veteran && <p className="muted small">Ветеран: можно смотреть и покупать сколько угодно книг; в сумме на 1 Талон дешевле (вторая книга бесплатно). Куплено: {bought}.</p>}
          <div className="modal-foot">
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
      return <GlavlitPrompt view={view} act={act} />;
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
          <div className="shelf wrap">{me.warehouse.map((s) => s.card!).map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}</div>
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
      if (groupFor && groupFor !== 'posred' && groupFor in GROUP_ACTIONS) {
        return <GroupPanel id={groupFor as GroupActionId} view={view} me={me} close={() => setGroupFor(null)} done={sendGroup} />;
      }
      return (
        <Modal title={p.kind === 'sproutBonus' ? `Бонус Ростка «${SPROUTS.find((s) => s.id === p.sprout)!.name}»` : p.kind === 'extraGroup' ? 'Подмастерье: действие Группы' : 'Действие Инициативной группы'}>
          <p>{p.kind === 'sproutBonus' ? 'Выберите одно действие. Оно не требует Единомышленника; собственную цену действия платите как обычно.'
            : p.kind === 'extraGroup' ? 'Повторите одно из действий Группы, уже сделанных в эту Пятилетку.' : 'Выполните одно действие Группы.'}</p>
          <div className="genres">
            {options.map((o) => (
              <button key={o} onClick={() => {
                if (o === 'sideJob' || o === 'underCounter') act({ type: 'sproutBonus', bonus: o });
                else if (o === 'copyText' || o === 'restore' || o === 'rescue' || groupBlocker(view, me, o as GroupActionId)) setGroupFor(o);
                else sendGroup({ action: o } as GroupAction);
              }}>{SPROUT_BONUS_NAMES[o as SproutBonusId]}</button>
            ))}
          </div>
          <div className="modal-foot"><button onClick={() => act({ type: 'pass' })}>Отказаться</button></div>
        </Modal>
      );
    }
  }
}

function PassionPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  return (
    <Modal title="Тайное Пристрастие" wide>
      <BannedLine view={view} />
      <h4>Ваши стартовые книги</h4>
      <div className="shelf wrap">{me.warehouse.map((s, i) => <Book key={i} v={view} id={s.card} small />)}</div>
      <p>Выберите одно из двух Пристрастий. Второе уйдёт в коробку, никто его не увидит.</p>
      <div className="passions">
        {me.passionOptions.map((id) => (
          <button key={id} className="passion" onClick={() => act({ type: 'choosePassion', passion: id })}>
            <b>{passionLabel(id)}</b><span>{PASSIONS[id].hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function GatheringPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const full = view.mode === 'full';
  const isDrama = (c: string) => full && iconsOf(view, c).includes('drama');
  const cands = [
    ...me.warehouse.map((s) => s.card!).filter((c) => c && (iconsOf(view, c).length > 0 || isEvidence(view, c)) && (isBanned(view, c) || isDrama(c))),
    ...me.published.filter(isDrama),
  ];
  // По умолчанию к показу выбрано всё, что приносит очки: опальные книги, Улики и Драматургия (в том числе изданная).
  const [sel, setSel] = useState<string[]>(() => cands);
  const pts = sel.reduce((s, c) => s + (isBanned(view, c) && !me.published.includes(c) ? 1 : 0) + (isDrama(c) ? 1 : 0), 0);
  // Книги из Тайника, которые не показали, «дают почитать на ночь» — Талоны.
  const night = me.warehouse.filter((s) => s.hidden && !s.memorized && s.card && !sel.includes(s.card)).length * RULES.nightReadTalons;
  return (
    <Modal title="Посиделки" wide>
      <p>Покажите опальные жанровые книги и Улики: +1 очко за каждую. Показанные книги остаются на складе — не забудьте укрыть их перед облавой.
        {full && ' Драматургию можно показывать и неопальную, и из изданного: +1 очко за каждую («Разыграть»).'}
        {RULES.nightReadTalons > 0 && ` Книги из Тайника, которые вы не покажете, дают почитать на ночь своим: +${RULES.nightReadTalons}т за каждую.`}</p>
      <div className="shelf wrap">
        {cands.length === 0 && <span className="muted">Опальных жанровых книг нет</span>}
        {cands.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot"><button className="primary" onClick={() => act({ type: 'gathering', show: sel })}>{(sel.length ? `Показать (+${pts} оч.)` : 'Ничего не показывать') + (night ? `, на ночь +${night}т` : '')}</button></div>
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
  const cards = me.warehouse.filter((s) => s.card && !s.memorized).map((s) => s.card!);
  const [sel, setSel] = useState<string[]>(() => me.warehouse.filter((s) => s.hidden).map((s) => s.card!));
  const limit = me.cache + loadCover(view, me.warehouse);
  return (
    <Modal title={title ?? 'Тайник'} wide onClose={close}>
      <BannedLine view={view} />
      <p>Отметьте книги, которые лежат в Тайнике: их не видят соперники и не трогает облава. Мест: {limit} (из них за Нагрузку: {loadCover(view, me.warehouse)}). Отмечено: {sel.length}.</p>
      <p className="muted small">{note ?? 'Это не тратит действие. Книга, которую уже видели соперники, от того, что её спрятали, не станет для них тайной — но облава её не тронет.'}</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot">
        {close && <button onClick={close}>Отмена</button>}
        <button className="primary" disabled={sel.length > limit} onClick={() => done(sel)}>{sel.length > limit ? `Мест только ${limit}` : 'Сохранить'}</button>
      </div>
    </Modal>
  );
}

function HidingPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const cards = me.warehouse.map((s) => s.card!).filter(Boolean);
  const [sel, setSel] = useState<string[]>(() => me.warehouse.filter((s) => s.hidden).map((s) => s.card!));
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
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
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
const BEGINNER_SOURCES: PointSource[] = ['sprouts', 'firstFeed', 'gathering', 'tamizdat'];

function Results({ view, seatIndex, close }: { view: PlayerView; seatIndex: (id: string) => number; close: () => void }) {
  const full = view.mode === 'full';
  // Очки от Завсегдатаев показываем, только если этот Завсегдатай был в Клубе.
  const PATRON_SOURCES: Partial<Record<PointSource, string>> = { editor: 'editor', postgrad: 'postgrad', komsorg: 'komsorg' };
  const sources = view.mode === 'full'
    ? (Object.keys(POINT_SOURCES) as PointSource[]).filter((k) => !PATRON_SOURCES[k] || view.patrons.some((pt) => pt.id === PATRON_SOURCES[k]))
    : BEGINNER_SOURCES;
  const r = view.result!;
  const name = (id: string) => view.players.find((p) => p.id === id)!.name;
  return (
    <Modal title="Конец Застоя" onClose={close} wide>
      <p><b>{r.note}</b></p>
      <div className="scores-wrap"><table className="scores">
        <thead><tr><th>Игрок</th><th>Пристрастие</th><th>По ходу</th>{full && <th>Связи</th>}<th>За Пристрастие</th><th>Улики</th><th title={`1 очко за каждые ${RULES.talonsPerPoint} Талона`}>За Талоны</th><th>Пропаганда</th><th>Итого</th></tr></thead>
        <tbody>
          {r.scores.map((s) => {
            const p = view.players.find((x) => x.id === s.player)!;
            const by = sources.map((k) => [k, s.duringBy?.[k] ?? 0] as [PointSource, number]);
            return (
              <Fragment key={s.player}>
                <tr className={r.winners.includes(s.player) ? 'winner' : ''}>
                  <td><span className="dot" style={{ background: PLAYER_COLORS[seatIndex(s.player)] }} /> {name(s.player)}</td><td>{p.passion ? passionLabel(p.passion) : '—'}</td>
                  <td>{s.during}</td>{full && <td>{s.connections ?? 0}</td>}<td>{s.passion}</td><td>{s.evidence}</td><td>{s.talonPoints ?? 0}</td><td>{s.propaganda}</td><td><b>{s.total}</b></td>
                </tr>
                {by.length > 0 && (
                  <tr className="score-detail">
                    <td colSpan={full ? 9 : 8}>
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

function Stats({ p, view }: { p: VPlayer; view: PlayerView }) {
  const cover = loadCover(view, p.warehouse);
  return (
    <div className="stats">
      <span title="Талоны">🎫 {p.talons}</span>
      <span title="Очки Гласности, набранные по ходу игры">★ {p.points}</span>
      <span title="Единомышленники: свободны / всего">👤 {p.available}/{p.workers}</span>
      <span title="Склад: занято / мест">📚 {p.warehouse.length}/{p.capacity}</span>
      <span title={`Мест в Тайнике: ${p.cache}${cover ? ` + ${cover} за Нагрузку на складе` : ''}`}>🔒 {p.cache + cover}{cover ? '*' : ''}</span>
      {p.held > 0 && <span title="Единомышленников удерживает Контора">🏢 {p.held}</span>}
      {view.mode === 'full' && <span title="Связи в Клубе книголюбов">🤝 {view.patrons.filter((x) => !x.removed && x.connections.includes(p.id)).length}</span>}
    </div>
  );
}

function MyPanel({ view, me, color, groupEnabled, onlyHire, onlyCopy, onGroup, onMemorize, onCache }: {
  view: PlayerView; me: VPlayer; color: string; groupEnabled: boolean; onlyHire?: boolean; onlyCopy?: boolean; onGroup: (id: GroupActionId) => void; onMemorize: ((card: string | null) => void) | null;
  onCache: (() => void) | null;
}) {
  const memorized = me.warehouse.find((s) => s.memorized)?.card ?? null;
  const poetry = me.warehouse.map((s) => s.card!).filter((c) => c && c !== memorized && iconsOf(view, c).includes('poetry'));
  return (
    <div className="player me" style={{ borderColor: color }}>
      <div className="addr-head"><b style={{ color }}><span className="dot" style={{ background: color }} /> {me.name} (вы)</b></div>
      <Stats p={me} view={view} />
      {me.passion && (
        <div className="passion-line" title={PASSIONS[me.passion].hint}>
          <span className="muted small">Пристрастие:</span> <b>{PASSIONS[me.passion].name}</b>
          {PASSIONS[me.passion].genres
            ? <> — 2 очка за значок: {PASSIONS[me.passion].genres!.map((g) => <GenreChip key={g} g={g} favored />)}</>
            : <span className="muted small"> — {PASSIONS[me.passion].hint}</span>}
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
      {me.subscriptions.length > 0 && <div className="muted small">Подписка: {me.subscriptions.map((s) => `${GENRE_NAMES[s.genre]} (${s.rounds})`).join(', ')}</div>}
      <div className="group">
        <div className="muted small">Инициативная группа (каждое действие — раз в Пятилетку):</div>
        <div className="group-actions">
          {(Object.keys(GROUP_ACTIONS) as GroupActionId[]).filter((g) => groupInGame(view, g)).map((g) => (
            <button key={g} className={`small ${groupBlocker(view, me, g) ? 'short' : ''}`}
              title={me.groupUsed.includes(g) ? 'Уже сделано в эту Пятилетку' : groupBlocker(view, me, g) ?? GROUP_ACTIONS[g].hint}
              disabled={!groupEnabled || me.groupUsed.includes(g) || (onlyHire && g !== 'hire') || (onlyCopy && g !== 'copyText')} onClick={() => onGroup(g)}>
              {GROUP_ACTIONS[g].name}<GroupSlot p={me} g={g} color={color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function OtherPlayer({ view, p, color, active, first }: { view: PlayerView; p: VPlayer; color: string; active: boolean; first: boolean }) {
  return (
    <div className={`player ${active ? 'active' : ''}`} style={{ borderColor: color }}>
      <div className="addr-head"><b style={{ color }}><span className="dot" style={{ background: color }} /> {p.name}</b>{first && <span className="muted small">ходит первым</span>}</div>
      <Stats p={p} view={view} />
      <div className="shelf wrap">{p.warehouse.map((s, i) => <Book key={i} v={view} id={s.card} hidden={s.hidden} small note={s.memorized ? 'заучено' : undefined} />)}{emptySlots(freeShelf(p))}</div>
      <Published view={view} p={p} />
      <div className="group-actions readonly" title="Действия Инициативной группы в эту Пятилетку">
        {(Object.keys(GROUP_ACTIONS) as GroupActionId[]).filter((g) => groupInGame(view, g)).map((g) => (
          <span key={g} className={`gact ${p.groupUsed.includes(g) ? 'used' : ''}`} title={GROUP_ACTIONS[g].hint}>
            {GROUP_ACTIONS[g].name}<GroupSlot p={p} g={g} color={color} />
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
  const download = () => {
    const text = view.log.map((l) => `[Пятилетка ${l.round}] ${l.strong ? `**${l.text}**` : l.em ? `_${l.text}_` : l.text}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `журнал-партии.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="log">
      <div className="addr-head"><h3>Журнал</h3><button className="small" onClick={download}>Скачать .txt</button></div>
      {entries.map((l, i) => (
        <div key={i} className={`${l.only ? 'secret' : ''} ${l.act ? 'act' : ''}`} style={{ whiteSpace: 'pre-line', ...(l.strong ? { fontWeight: 700 } : {}), ...(l.em ? { fontStyle: 'italic' } : {}) }}>
          {l.act && <span className="dot num" style={{ background: PLAYER_COLORS[seatIndex(l.act.player)] }} title={`${l.act.n}-е действие игрока в Пятилетке`}>{l.act.n}</span>}
          {l.who && !l.act && <span className="dot" style={{ background: PLAYER_COLORS[seatIndex(l.who)] }} />}
          {l.club && <span className="dot num wide" style={{ background: PLAYER_COLORS[seatIndex(l.club.player)] }} title={`Связь с ${l.club.round}-й Пятилетки`}>П{l.club.round}</span>}
          {l.text}
        </div>
      ))}
    </div>
  );
}

function GlavlitPrompt({ view, act }: { view: PlayerView; act: (a: Action) => void }) {
  const [from, setFrom] = useState<Genre | null>(null);
  const [to, setTo] = useState<Genre | null>(null);
  return (
    <Modal title="Главлитовец">
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
            {icons.length ? icons.map((g, i) => <GenreChip key={i} g={g} />) : <span className="kind">{isEvidence(view, c) ? 'Улика' : '—'}</span>}
          </span>
        );
      })}
    </div>
  );
  return <div className="published">{row('Тамиздат', tam)}{row('Самиздат', sam)}</div>;
}
