// Игровой стол.
import { useEffect, useMemo, useState } from 'react';
import {
  ADDRESSES, GENRE_NAMES, GROUP_ACTIONS, PASSIONS, PERMANENT_ADDRESSES, RULES, SPROUTS, SPROUT_BONUS_NAMES, STEP_REWARDS, limitFor,
} from '../engine/content';
import type { Action, AddressId, Genre, GroupAction, GroupActionId, PlaceAction, SproutBonusId } from '../engine/types';
import { GENRES } from '../engine/types';
import type { PlayerView } from '../engine/view';
import type { ClientMessage, RoomInfo } from '../shared/protocol';
import { Book, GenreChip, Modal, PLAYER_COLORS, fromLoadDeck, iconsOf, isBanned, isLoad, toggle } from './ui';

type Send = (m: ClientMessage) => void;
type VPlayer = PlayerView['players'][number];
type Panel = { kind: 'address'; id: AddressId } | { kind: 'group'; id: GroupActionId } | null;

const PHASE_NAMES: Record<string, string> = {
  passion: 'Выбор Пристрастий', orders: 'Поручения', gathering: 'Посиделки', hiding: 'Укрытие', end: 'Конец Застоя',
};

export function Game({ view, room, you, send }: { view: PlayerView; room: RoomInfo; you: string | null; send: Send }) {
  const me = view.players.find((p) => p.id === you) ?? null;
  const act = (action: Action) => send({ t: 'action', action });
  const [panel, setPanel] = useState<Panel>(null);
  const [showResult, setShowResult] = useState(true);
  const seatIndex = (id: string) => room.seats.findIndex((s) => s.id === id);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const myTurn = !!you && view.active.includes(you);
  const head = view.pending[0];
  const myPending = head && head.player === you && !('secret' in head) ? head : null;
  const canPlace = myTurn && view.phase === 'orders' && !myPending && !!me && me.available > 0;
  const bonusTurn = myTurn && view.phase === 'orders' && !myPending && !!me && me.available === 0 && me.bonusGroupTurns > 0;
  const mustRed = !!me && me.available === 1 && !me.visitedRedCorner;

  useEffect(() => { if (!canPlace && !bonusTurn) setPanel(null); }, [canPlace, bonusTurn]);

  let status: string;
  if (view.phase === 'end') status = view.result?.note ?? 'Партия окончена';
  else if (head && head.player !== you) status = `${nameOf(head.player)} принимает решение…`;
  else if (myPending) status = 'Примите решение';
  else if (view.phase === 'orders') {
    if (canPlace) status = mustRed ? 'Ваш ход: последнего Единомышленника — в Красный уголок' : 'Ваш ход: отправьте Единомышленника по адресу или в Инициативную группу';
    else if (bonusTurn) status = 'Ваш ход: дополнительное действие Группы с явочного адреса — или откажитесь';
    else status = `Ходит ${view.active.map(nameOf).join(', ')}`;
  } else if (you && view.active.includes(you)) status = 'Ваше решение';
  else status = `Ждём: ${view.active.map(nameOf).join(', ')}`;

  const addresses = [...PERMANENT_ADDRESSES, ...view.safehouses];

  return (
    <div className="game">
      <header className="topbar">
        <div className="title">Сохрани мою речь</div>
        <div>Пятилетка <b>{view.round}</b>/{RULES.rounds} · {PHASE_NAMES[view.phase]}</div>
        <div className="banned">Цензура {view.censorship}: {view.banned.map((g) => <GenreChip key={g} g={g} banned />)}</div>
        <div className="muted small">Непечатные: {view.deckCount} (сброс {view.discardCount}) · Нагрузка: {view.loadDeckCount}</div>
        {room.host === you && (
          <div className="host-tools">
            <button className="small" disabled={!room.canUndo} onClick={() => send({ t: 'undo' })} title="Отменить последнее действие (для плейтеста)">↶ Отмена</button>
            <button className="small" onClick={() => confirm('Вернуть комнату в лобби? Текущая партия будет потеряна.') && send({ t: 'restart' })}>В лобби</button>
          </div>
        )}
      </header>
      <div className={`status ${myTurn ? 'mine' : ''}`}>
        {status}
        {bonusTurn && <button className="small" onClick={() => act({ type: 'pass' })}>Отказаться</button>}
        {canPlace && !mustRed && <button className="small" onClick={() => confirm('Единомышленник пропустит ход. Точно?') && act({ type: 'pass' })}>Пропустить</button>}
      </div>

      <main className="layout">
        <section className="board">
          <div className="addresses">
            {addresses.map((id) => (
              <AddressCard key={id} id={id} view={view} seatIndex={seatIndex} me={me}
                enabled={canPlace && (!mustRed || id === 'redCorner')} onOpen={() => setPanel({ kind: 'address', id })} />
            ))}
          </div>
          <h2>Ростки Гласности</h2>
          <Sprouts view={view} />
        </section>
        <aside className="side">
          {me && (
            <MyPanel view={view} me={me} color={PLAYER_COLORS[seatIndex(me.id)]}
              groupEnabled={(canPlace && !mustRed) || bonusTurn} onGroup={(id) => setPanel({ kind: 'group', id })} />
          )}
          {view.players.filter((p) => p.id !== you).map((p) => (
            <OtherPlayer key={p.id} view={view} p={p} color={PLAYER_COLORS[seatIndex(p.id)]} active={view.active.includes(p.id)} first={view.order[0] === p.id} />
          ))}
          <Log view={view} />
        </aside>
      </main>

      {panel?.kind === 'address' && me && (
        <AddressPanel id={panel.id} view={view} me={me} close={() => setPanel(null)} place={(place) => { act({ type: 'place', place }); setPanel(null); }} />
      )}
      {panel?.kind === 'group' && me && (
        <GroupPanel id={panel.id} view={view} me={me} close={() => setPanel(null)} done={(group) => { act({ type: 'group', group }); setPanel(null); }} />
      )}
      {myPending && me && <PendingPrompt view={view} me={me} act={act} nameOf={nameOf} />}
      {!myPending && me && view.phase === 'passion' && view.active.includes(me.id) && <PassionPrompt me={me} act={act} />}
      {!myPending && me && view.phase === 'gathering' && view.active.includes(me.id) && <GatheringPrompt view={view} me={me} act={act} />}
      {!myPending && me && view.phase === 'hiding' && view.active.includes(me.id) && <HidingPrompt view={view} me={me} act={act} />}
      {view.phase === 'end' && view.result && showResult && <Results view={view} close={() => setShowResult(false)} />}
    </div>
  );
}

// ---------- Адреса ----------

function AddressCard({ id, view, seatIndex, me, enabled, onOpen }: {
  id: AddressId; view: PlayerView; seatIndex: (id: string) => number; me: VPlayer | null; enabled: boolean; onOpen: () => void;
}) {
  const info = ADDRESSES[id];
  const here = view.occupancy[id] ?? [];
  const limit = limitFor(id, view.players.length);
  const full = here.length >= limit || (id === 'redCorner' && !!me && here.includes(me.id));
  return (
    <div className={`address ${info.safehouse ? 'safehouse' : ''} ${enabled && !full ? 'can' : ''}`}>
      <div className="addr-head">
        <b>{info.name}</b>
        <span className="workers">
          {here.map((pid, i) => <span key={i} className="dot" style={{ background: PLAYER_COLORS[seatIndex(pid)] }} />)}
          <span className="muted small">{limit === Infinity ? '∞' : `${here.length}/${limit}`}</span>
        </span>
      </div>
      <div className="hint">{info.hint}</div>
      <AddressContents id={id} view={view} />
      {enabled && <button className="go" disabled={full} onClick={onOpen}>{full ? 'Мест нет' : 'Отправить сюда'}</button>}
    </div>
  );
}

function AddressContents({ id, view }: { id: AddressId; view: PlayerView }) {
  switch (id) {
    case 'tolkuchka':
      return <div className="shelf wrap">{view.tolkuchka.map((c) => <Book key={c} v={view} id={c} small note={`${2 * iconsOf(view, c).length}т`} />)}</div>;
    case 'razval':
      return <div className="shelf wrap">{view.razval.map((c, i) => c ? <Book key={i} v={view} id={c} small note={`${RULES.razvalPrices[i]}т`} /> : <div key={i} className="book empty small" />)}</div>;
    case 'baraholka':
      return <div className="shelf wrap">{view.baraholka.map((has, i) => has ? <Book key={i} v={view} id={null} small /> : <div key={i} className="book empty small" />)}</div>;
    case 'knigoobmen':
      return <div className="shelf wrap">{view.knigoobmen.map((c) => <Book key={c} v={view} id={c} small />)}</div>;
    case 'raspredelitel':
      return <div className="shelf wrap">{view.raspredelitel.map((c) => <Book key={c} v={view} id={c} small note="3т" />)}</div>;
    default:
      return null;
  }
}

function AddressPanel({ id, view, me, close, place }: { id: AddressId; view: PlayerView; me: VPlayer; close: () => void; place: (p: PlaceAction) => void }) {
  const info = ADDRESSES[id];
  const mine = me.warehouse.map((s) => s.card!).filter(Boolean);
  const free = me.capacity - me.warehouse.length;
  const [sel, setSel] = useState<string[]>([]);
  const [sel2, setSel2] = useState<string[]>([]);
  const [num, setNum] = useState(1);
  const [genre, setGenre] = useState<Genre>('prose');
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
      const max = Math.min(Math.floor(free / 2), me.talons);
      body = (
        <>
          <p>Каждая пара — 1 Нагрузка и 1 Непечатная книга вслепую, за 1 Талон. Свободных мест: {free}.</p>
          <label>Пар: <input type="number" min={1} max={max} value={num} onChange={(e) => setNum(Number(e.target.value))} /></label>
          {confirmBtn(`Купить за ${num}т`, max >= 1 && num >= 1 && num <= max ? { address: 'gostorg', pairs: num } : null, max < 1 ? 'Нужно 2 свободных места и 1 Талон' : undefined)}
        </>
      );
      break;
    }
    case 'tolkuchka': {
      const sellable = mine.filter((c) => iconsOf(view, c).length > 0 && !['evidence', 'loadEvidence'].includes(view.cards[c].kind));
      const gain = sel2.reduce((s, c) => s + iconsOf(view, c).reduce((a, g) => a + (view.banned.includes(g) ? 2 : 1), 0), 0);
      const cost = sel.reduce((s, c) => s + 2 * iconsOf(view, c).length, 0);
      const ops = [...sel2.map((card) => ({ op: 'sell' as const, card })), ...sel.map((card) => ({ op: 'buy' as const, card }))];
      body = (
        <>
          <h4>Купить (−2т за значок)</h4>
          {pickList(view.tolkuchka, sel, setSel, { note: (c) => `${2 * iconsOf(view, c).length}т` })}
          <h4>Продать (+2т за значок опального жанра, +1т за прочие)</h4>
          {pickList(sellable, sel2, setSel2, { note: (c) => `+${iconsOf(view, c).reduce((a, g) => a + (view.banned.includes(g) ? 2 : 1), 0)}т` })}
          {confirmBtn('Совершить сделки', ops.length ? { address: 'tolkuchka', ops } : null, `Итого: ${gain - cost >= 0 ? '+' : ''}${gain - cost}т (у вас ${me.talons}т)`)}
        </>
      );
      break;
    }
    case 'redCorner': {
      const unprinted = sel.filter((c) => !fromLoadDeck(view, c)).length;
      const load = sel.filter((c) => fromLoadDeck(view, c)).length;
      body = (
        <>
          <p>Вы встанете в очередь хода следующей Пятилетки. Можно сдать в макулатуру до 1 Непечатной книги и до 1 книги Нагрузки — по 1 Талону за каждую. Пропаганду можно сбыть только здесь.</p>
          {pickList(mine, sel, setSel)}
          {confirmBtn('Пойти в Красный уголок', unprinted <= 1 && load <= 1 ? { address: 'redCorner', recycle: sel } : null, unprinted > 1 || load > 1 ? 'Слишком много книг' : `+${sel.length}т`)}
        </>
      );
      break;
    }
    case 'razval':
      body = (
        <>
          <p>Купите 1 книгу. Цена зависит от свежести.</p>
          <div className="shelf wrap">
            {view.razval.map((c, i) => c && (
              <Book key={i} v={view} id={c} note={`${RULES.razvalPrices[i]}т`} selected={sel[0] === String(i)} onClick={() => setSel([String(i)])} />
            ))}
          </div>
          {confirmBtn('Купить', sel.length && free > 0 ? { address: 'razval', slot: Number(sel[0]) } : null, free > 0 ? undefined : 'Нет места на складе')}
        </>
      );
      break;
    case 'zavoz':
      body = <><p>Получите {RULES.zavozIncome} Талона. Всё, что лежит на Развале, уйдёт в сброс, и Развал заполнится новыми книгами.</p>{confirmBtn('Подработать', { address: 'zavoz' })}</>;
      break;
    case 'baraholka':
      body = (
        <>
          <p>Выберите закрытую книгу. Вы тайно посмотрите её и решите, покупать ли за {RULES.baraholkaPrice}т.</p>
          <div className="shelf">
            {view.baraholka.map((has, i) => has && (
              <button key={i} className={`book back ${sel[0] === String(i) ? 'selected' : ''} clickable`} onClick={() => setSel([String(i)])}><span>{i + 1}</span></button>
            ))}
          </div>
          {confirmBtn('Посмотреть', sel.length ? { address: 'baraholka', slot: Number(sel[0]) } : null)}
        </>
      );
      break;
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
      const ok = (c: string) => view.cards[c].kind !== 'propaganda' && (iconsOf(view, c).length > 0 && !['evidence', 'loadEvidence'].includes(view.cards[c].kind) || (id === 'tamizdat' && ['evidence', 'loadEvidence'].includes(view.cards[c].kind)));
      const n = sel[0] ? iconsOf(view, sel[0]).length : 0;
      body = (
        <>
          <p>Издайте одну книгу: она навсегда спасена, место на складе освобождается, а в подсчёте по Пристрастию книга участвует. {id === 'tamizdat' ? '+1 Талон и +1 очко за значок.' : '+1 Талон за значок.'}</p>
          {pickList(mine.filter(ok), sel, setSel, { max: 1 })}
          {confirmBtn('Издать', sel.length ? { address: id, card: sel[0] } : null, sel.length ? `+${n}т${id === 'tamizdat' ? `, +${n} оч.` : ''}` : undefined)}
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
          {pickList(view.raspredelitel, sel, setSel, { max: 1 })}
          {confirmBtn(`Купить за ${RULES.safehousePrice}т`, sel.length && free > 0 ? { address: 'raspredelitel', card: sel[0] } : null)}
        </>
      );
      break;
    case 'nasledniki':
    case 'posrednichestvo':
    case 'spisanie':
      body = <><p>{info.hint}</p>{confirmBtn(`Заплатить ${RULES.safehousePrice}т`, me.talons >= RULES.safehousePrice && free > 0 ? { address: id } : null, free > 0 ? undefined : 'Нет места на складе')}</>;
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

function Sprouts({ view }: { view: PlayerView }) {
  return (
    <div className="sprouts">
      {view.sprouts.map((sp) => {
        const info = SPROUTS.find((s) => s.id === sp.id)!;
        return (
          <div key={sp.id} className={`sprout ${sp.progress >= RULES.glasnostStep ? 'grown' : ''}`}>
            <div className="addr-head"><b>{info.name}</b><span>{sp.progress}/4</span></div>
            <ol className="steps">
              {info.steps.map((st, i) => (
                <li key={i} className={i < sp.progress ? 'done' : i === sp.progress ? 'next' : ''}>
                  {stepText(info.main, st)}
                  <span className="muted small"> → {STEP_REWARDS[i].talons ? `+${STEP_REWARDS[i].talons}т` : `+${STEP_REWARDS[i].points} оч.`}</span>
                </li>
              ))}
            </ol>
            <div className="muted small">Бонус: {info.bonuses.map((b) => SPROUT_BONUS_NAMES[b]).join(' / ')}</div>
          </div>
        );
      })}
      <p className="muted small">Гласность наступит, если к концу партии {RULES.glasnostAllSprouts ? 'все Ростки' : 'хотя бы один Росток'} дорастут до {RULES.glasnostStep}-й ступени.</p>
    </div>
  );
}

function SproutFeeder({ view, me, place }: { view: PlayerView; me: VPlayer; place: (p: PlaceAction) => void }) {
  const [feeds, setFeeds] = useState<{ sprout: string; books: string[] }[]>([]);
  const [sprout, setSprout] = useState<string>('');
  const [books, setBooks] = useState<string[]>([]);
  const used = feeds.flatMap((f) => f.books);
  const mine = me.warehouse.map((s) => s.card!).filter((c) => c && !used.includes(c));
  const progressOf = (id: string) => view.sprouts.find((s) => s.id === id)!.progress + feeds.filter((f) => f.sprout === id).length;
  const info = SPROUTS.find((s) => s.id === sprout);
  const step = info && info.steps[progressOf(sprout)];
  const icons = books.flatMap((b) => iconsOf(view, b));
  const ok = !!info && !!step && icons.filter((g) => g === info.main).length >= step.main && (!step.support || icons.includes(step.support));
  return (
    <>
      <p>Закройте ступени: одним действием отдайте книги, на которых есть все значки ступени. Можно закрыть несколько ступеней у разных Ростков.</p>
      <div className="genres">
        {view.sprouts.map((sp) => {
          const inf = SPROUTS.find((s) => s.id === sp.id)!;
          const pr = progressOf(sp.id);
          return (
            <button key={sp.id} disabled={pr >= 4} className={sprout === sp.id ? 'selected' : ''} onClick={() => { setSprout(sp.id); setBooks([]); }}>
              {inf.name} · ступень {pr + 1}: {pr < 4 ? stepText(inf.main, inf.steps[pr]) : '—'}
            </button>
          );
        })}
      </div>
      {info && step && (
        <>
          <h4>Книги для ступени {progressOf(sprout) + 1}</h4>
          <div className="shelf wrap">
            {mine.map((c) => <Book key={c} v={view} id={c} selected={books.includes(c)} onClick={() => setBooks(toggle(books, c))} />)}
          </div>
          <button disabled={!ok} onClick={() => { setFeeds([...feeds, { sprout, books }]); setBooks([]); }}>Добавить ступень</button>
        </>
      )}
      {feeds.length > 0 && (
        <ul>{feeds.map((f, i) => <li key={i}>{SPROUTS.find((s) => s.id === f.sprout)!.name}: {f.books.map((b) => view.cards[b].title).join(', ')}</li>)}</ul>
      )}
      <div className="modal-foot">
        <button className="primary" disabled={!feeds.length} onClick={() => place({ address: 'sprouts', feeds })}>Закрыть ступени ({feeds.length})</button>
      </div>
    </>
  );
}

// ---------- Инициативная группа ----------

function GroupPanel({ id, view, me, close, done, title }: { id: GroupActionId; view: PlayerView; me: VPlayer; close?: () => void; done: (g: GroupAction) => void; title?: string }) {
  const info = GROUP_ACTIONS[id];
  const [sel, setSel] = useState<string>('');
  const [genre, setGenre] = useState<Genre | ''>('');
  let body;
  if (id === 'copyText') {
    const singles = [...view.tolkuchka, ...view.knigoobmen, ...view.razval.filter((c): c is string => !!c)]
      .filter((c) => view.cards[c].kind === 'genre' && iconsOf(view, c).length === 1);
    body = (
      <>
        <p>Возьмите открытую одиночную книгу с любого адреса или верхнюю книгу стопки Непечатных.</p>
        <div className="shelf wrap">
          <button className={`book back clickable ${sel === 'deck' ? 'selected' : ''}`} onClick={() => setSel('deck')}><span>Из стопки</span></button>
          {singles.map((c) => <Book key={c} v={view} id={c} selected={sel === c} onClick={() => setSel(c)} />)}
        </div>
        <div className="modal-foot"><button className="primary" disabled={!sel} onClick={() => done({ action: 'copyText', card: sel })}>Тиражировать</button></div>
      </>
    );
  } else if (id === 'restore') {
    const cands = me.warehouse.map((s) => s.card!).filter((c) => c && !view.restored[c] && ['genre', 'loadReturnable'].includes(view.cards[c].kind));
    const card = sel ? view.cards[sel] : null;
    const dual = card && card.kind === 'genre' && new Set(card.icons).size > 1;
    body = (
      <>
        <p>Жанровая книга получает +1 значок своего жанра. Нагрузка проглоченного автора становится возвращённым произведением с 3 значками.</p>
        <div className="shelf wrap">{cands.map((c) => <Book key={c} v={view} id={c} selected={sel === c} onClick={() => { setSel(c); setGenre(''); }} />)}</div>
        {dual && <div className="genres">Значок какого жанра: {[...new Set(card!.icons)].map((g) => <button key={g} className={genre === g ? 'selected' : ''} onClick={() => setGenre(g)}><GenreChip g={g} /> {GENRE_NAMES[g]}</button>)}</div>}
        <div className="modal-foot"><button className="primary" disabled={!sel || (!!dual && !genre)} onClick={() => done({ action: 'restore', card: sel, ...(genre ? { genre } : {}) })}>Вернуть смыслы</button></div>
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

// ---------- Решения ----------

function PendingPrompt({ view, me, act, nameOf }: { view: PlayerView; me: VPlayer; act: (a: Action) => void; nameOf: (id: string) => string }) {
  const p = view.pending[0];
  const [sel, setSel] = useState<string[]>([]);
  const [groupFor, setGroupFor] = useState<SproutBonusId | 'posred' | null>(null);
  if ('secret' in p) return null;
  switch (p.kind) {
    case 'baraholkaLook':
      return (
        <Modal title="Барахолка">
          <p>Вы тайно смотрите книгу:</p>
          <div className="shelf"><Book v={view} id={p.card} /></div>
          <div className="modal-foot">
            <button onClick={() => act({ type: 'baraholkaBuy', buy: false })}>Не брать</button>
            <button className="primary" disabled={me.talons < RULES.baraholkaPrice} onClick={() => act({ type: 'baraholkaBuy', buy: true })}>Купить за {RULES.baraholkaPrice}т</button>
          </div>
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
    case 'posrednichestvoKeep': {
      const free = me.capacity - me.warehouse.length;
      const isN = p.kind === 'naslednikiPick';
      return (
        <Modal title={isN ? 'Наследники: сброс Непечатных' : 'Посредничество авторам'} wide>
          <p>{isN ? 'Тайно возьмите 1–2 книги из сброса.' : 'Оставьте себе 1–2 книги, остальные уйдут в сброс.'} Свободных мест: {free}.</p>
          <div className="shelf wrap">{p.cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}</div>
          <div className="modal-foot">
            <button className="primary" disabled={sel.length < 1 || sel.length > 2 || sel.length > free}
              onClick={() => act(isN ? { type: 'naslednikiPick', cards: sel } : { type: 'posrednichestvoKeep', keep: sel })}>Взять ({sel.length})</button>
          </div>
        </Modal>
      );
    }
    case 'posrednichestvoGroup':
    case 'sproutBonus': {
      const options: (GroupActionId | SproutBonusId)[] = p.kind === 'sproutBonus'
        ? p.options
        : (Object.keys(GROUP_ACTIONS) as GroupActionId[]).filter((g) => !GROUP_ACTIONS[g].fullOnly || view.mode === 'full');
      const sendGroup = (g: GroupAction) => act(p.kind === 'sproutBonus' ? { type: 'sproutBonus', bonus: g.action, group: g } : { type: 'group', group: g });
      if (groupFor && groupFor !== 'posred' && groupFor in GROUP_ACTIONS) {
        return <GroupPanel id={groupFor as GroupActionId} view={view} me={me} close={() => setGroupFor(null)} done={sendGroup} />;
      }
      return (
        <Modal title={p.kind === 'sproutBonus' ? `Бонус Ростка «${SPROUTS.find((s) => s.id === p.sprout)!.name}»` : 'Действие Инициативной группы'}>
          <p>{p.kind === 'sproutBonus' ? 'Выберите одно действие. Оно не требует Единомышленника; собственную цену действия платите как обычно.' : 'Выполните одно действие Группы.'}</p>
          <div className="genres">
            {options.map((o) => (
              <button key={o} onClick={() => {
                if (o === 'sideJob' || o === 'underCounter') act({ type: 'sproutBonus', bonus: o });
                else if (o === 'copyText' || o === 'restore') setGroupFor(o);
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

function PassionPrompt({ me, act }: { me: VPlayer; act: (a: Action) => void }) {
  return (
    <Modal title="Тайное Пристрастие">
      <p>Выберите одно из двух. Второе уйдёт в коробку, никто его не увидит.</p>
      <div className="passions">
        {me.passionOptions.map((id) => (
          <button key={id} className="passion" onClick={() => act({ type: 'choosePassion', passion: id })}>
            <b>{PASSIONS[id].name}</b><span>{PASSIONS[id].hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function GatheringPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const cands = me.warehouse.map((s) => s.card!).filter((c) => c && iconsOf(view, c).length > 0 && isBanned(view, c));
  const pts = sel.reduce((s, c) => s + iconsOf(view, c).filter((g) => view.banned.includes(g)).length, 0);
  return (
    <Modal title="Посиделки" wide>
      <p>Покажите опальные жанровые книги: +1 очко за каждый значок опального жанра. Показанные книги остаются на складе — не забудьте укрыть их перед облавой.</p>
      <div className="shelf wrap">
        {cands.length === 0 && <span className="muted">Опальных жанровых книг нет</span>}
        {cands.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot"><button className="primary" onClick={() => act({ type: 'gathering', show: sel })}>{sel.length ? `Показать (+${pts} оч.)` : 'Ничего не показывать'}</button></div>
    </Modal>
  );
}

function HidingPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const cards = me.warehouse.map((s) => s.card!).filter(Boolean);
  const [sel, setSel] = useState<string[]>(() => me.warehouse.filter((s) => s.hidden).map((s) => s.card!));
  const openLoad = cards.filter((c) => !sel.includes(c) && isLoad(view, c)).length;
  const limit = me.cache + Math.floor(openLoad / 2);
  const exposed = cards.filter((c) => !sel.includes(c) && isBanned(view, c));
  return (
    <Modal title="Укрытие" wide>
      <p>Отметьте книги, которые прячете в Тайник. Мест в Тайнике: {me.cache}, ещё {Math.floor(openLoad / 2)} — за открытую Нагрузку (2 Нагрузки укрывают 1 книгу). Сейчас спрятано {sel.length} из {limit}.</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
      </div>
      {exposed.length > 0 && <p className="warn-text">При облаве будут изъяты: {exposed.map((c) => `«${view.cards[c].title}»`).join(', ')}</p>}
      <div className="modal-foot"><button className="primary" disabled={sel.length > limit} onClick={() => act({ type: 'hiding', hidden: sel })}>Готово к облаве</button></div>
    </Modal>
  );
}

function Results({ view, close }: { view: PlayerView; close: () => void }) {
  const r = view.result!;
  const name = (id: string) => view.players.find((p) => p.id === id)!.name;
  return (
    <Modal title="Конец Застоя" onClose={close} wide>
      <p><b>{r.note}</b></p>
      <table className="scores">
        <thead><tr><th>Игрок</th><th>Пристрастие</th><th>По ходу</th><th>Пристрастие</th><th>Ростки</th><th>Пропаганда</th><th>Улики</th><th>Итого</th></tr></thead>
        <tbody>
          {r.scores.map((s) => {
            const p = view.players.find((x) => x.id === s.player)!;
            return (
              <tr key={s.player} className={r.winners.includes(s.player) ? 'winner' : ''}>
                <td>{name(s.player)}</td><td>{p.passion ? PASSIONS[p.passion].name : '—'}</td>
                <td>{s.during}</td><td>{s.passion}</td><td>{s.sprouts}</td><td>{s.propaganda}</td><td>{s.evidence}</td><td><b>{s.total}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------- Игроки ----------

function Stats({ p }: { p: VPlayer }) {
  return (
    <div className="stats">
      <span title="Талоны">🎫 {p.talons}</span>
      <span title="Очки Гласности, набранные по ходу игры">★ {p.points}</span>
      <span title="Единомышленники: свободны / всего">👤 {p.available}/{p.workers}</span>
      <span title="Склад: занято / мест">📚 {p.warehouse.length}/{p.capacity}</span>
      <span title="Мест в Тайнике">🔒 {p.cache}</span>
      {p.spetskhranCount > 0 && <span title="Изъято в Спецхран">⛔ {p.spetskhranCount}</span>}
    </div>
  );
}

function MyPanel({ view, me, color, groupEnabled, onGroup }: { view: PlayerView; me: VPlayer; color: string; groupEnabled: boolean; onGroup: (id: GroupActionId) => void }) {
  return (
    <div className="player me" style={{ borderColor: color }}>
      <div className="addr-head"><b style={{ color }}>{me.name} (вы)</b>{me.passion && <span className="passion-tag" title={PASSIONS[me.passion].hint}>{PASSIONS[me.passion].name}</span>}</div>
      <Stats p={me} />
      <div className="shelf wrap">{me.warehouse.map((s, i) => <Book key={i} v={view} id={s.card} hidden={s.hidden} small />)}</div>
      {me.published.length > 0 && <div className="published"><span className="muted small">Издано:</span><div className="shelf wrap">{me.published.map((c) => <Book key={c} v={view} id={c} small />)}</div></div>}
      {me.subscriptions.length > 0 && <div className="muted small">Подписка: {me.subscriptions.map((s) => `${GENRE_NAMES[s.genre]} (${s.rounds})`).join(', ')}</div>}
      <div className="group">
        <div className="muted small">Инициативная группа (каждое действие — раз в Пятилетку):</div>
        <div className="group-actions">
          {(Object.keys(GROUP_ACTIONS) as GroupActionId[]).filter((g) => !GROUP_ACTIONS[g].fullOnly || view.mode === 'full').map((g) => (
            <button key={g} className="small" title={GROUP_ACTIONS[g].hint} disabled={!groupEnabled || me.groupUsed.includes(g)} onClick={() => onGroup(g)}>
              {GROUP_ACTIONS[g].name}
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
      <div className="addr-head"><b style={{ color }}>{p.name}</b>{first && <span className="muted small">ходит первым</span>}</div>
      <Stats p={p} />
      <div className="shelf wrap">{p.warehouse.map((s, i) => <Book key={i} v={view} id={s.card} hidden={s.hidden} small />)}</div>
      {p.published.length > 0 && <div className="muted small">Издано: {p.published.length}</div>}
    </div>
  );
}

function Log({ view }: { view: PlayerView }) {
  const entries = useMemo(() => [...view.log].reverse().slice(0, 80), [view.log]);
  return (
    <div className="log">
      <h3>Журнал</h3>
      {entries.map((l, i) => <div key={i} className={l.only ? 'secret' : ''}>{l.text}</div>)}
    </div>
  );
}
