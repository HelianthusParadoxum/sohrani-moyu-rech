// Интерфейс полного режима: Клуб книголюбов, Контора.
import { useState } from 'react';
import { GENRE_NAMES, PATRONS, RULES } from '../engine/content';
import type { Action, ClubGift, Genre, GroupAction, KontoraChoice, PatronId, PlaceAction } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { cacheLimit } from '../engine/util';
import { kontoraTargets, signalable } from '../engine/full';
import { Book, GenreChip, Modal, PLAYER_COLORS, iconsOf, isBanned, toggle } from './ui';

type VPlayer = PlayerView['players'][number];

// Порядок жанровых слотов Клуба — как на планшете: верхний ряд, затем нижний.
const CLUB_ORDER: Genre[] = ['prose', 'irony', 'drama', 'poetry', 'testimony', 'foreign', 'scifi', 'album'];
const byClubOrder = <T extends { genre: Genre }>(list: T[]) => [...list].sort((a, b) => CLUB_ORDER.indexOf(a.genre) - CLUB_ORDER.indexOf(b.genre));

export function ClubContents({ view, seatIndex }: { view: PlayerView; seatIndex: (id: string) => number }) {
  return (
    <ul className="patrons">
      {byClubOrder(view.patrons).map((pt) => (
        <li key={pt.id} className={`${pt.removed ? 'removed' : ''} ${pt.turned ? 'turned' : ''}`} title={PATRONS[pt.id].hint}>
          <GenreChip g={pt.genre} /> <b>{PATRONS[pt.id].name}</b>
          {pt.connections.map((pid) => (
            // Число на жетоне — Пятилетка, в которую завязана связь.
            <span key={pid} className="dot num wide" style={{ background: PLAYER_COLORS[seatIndex(pid)] }}
              title={pt.since?.[pid] ? `Связь с ${pt.since[pid]}-й Пятилетки` : undefined}>{pt.since?.[pid] ? `П${pt.since[pid]}` : ''}</span>
          ))}
          {pt.removed && <span className="muted small"> — профилактика</span>}
          {!pt.removed && pt.turned && <span className="muted small"> — Занят на Пятилетку</span>}
          <div className="muted small">{PATRONS[pt.id].hint}</div>
        </li>
      ))}
    </ul>
  );
}

export function KontoraContents({ view }: { view: PlayerView }) {
  const held = view.players.filter((p) => p.held > 0);
  const total = view.players.reduce((s, p) => s + p.held, 0);
  return (
    <div className="small">
      Удержано: <b>{total}</b> из 7{held.length > 0 && ` (${held.map((p) => `${p.name}: ${p.held}`).join(', ')})`}
      <div>В Спецхране: <b>{view.spetskhranCount}</b> книг(и)</div>
      {total >= 5 && <div className="warn-text">При 7 удержанных подполье проигрывает!</div>}
    </div>
  );
}

// Подарки Завсегдатаям: каждому — книга жанра его слота (Альбом подходит любому).
export function GiftPicker({ view, me, single, onDone }: { view: PlayerView; me: VPlayer; single?: boolean; onDone: (gifts: ClubGift[]) => void }) {
  const [gifts, setGifts] = useState<ClubGift[]>([]);
  const [patron, setPatron] = useState<PatronId | null>(null);
  const used = gifts.map((g) => g.card);
  const open = byClubOrder(view.patrons).filter((pt) => !pt.removed && !pt.turned && !pt.connections.includes(me.id) && !gifts.some((g) => g.patron === pt.id));
  const pt = view.patrons.find((x) => x.id === patron);
  const fits = (c: string) => !!pt && (iconsOf(view, c).includes(pt.genre) || iconsOf(view, c).includes('album'));
  const books = me.warehouse.map((s) => s.card!).filter((c) => c && !used.includes(c));
  return (
    <>
      <p>Выберите Завсегдатая и отдайте ему книгу жанра его слота (Альбом подходит любому). {single ? 'Одна связь.' : 'За один приход можно завязать несколько связей.'}</p>
      <div className="genres">
        {open.length === 0 && <span className="muted">Свободных Завсегдатаев нет</span>}
        {open.map((x) => (
          <button key={x.id} className={patron === x.id ? 'selected' : ''} onClick={() => setPatron(x.id)} title={PATRONS[x.id].hint}>
            <GenreChip g={x.genre} /> {PATRONS[x.id].name}
          </button>
        ))}
      </div>
      {pt && (
        <>
          <h4>Книга для Завсегдатая «{PATRONS[pt.id].name}» ({GENRE_NAMES[pt.genre]})</h4>
          <div className="shelf wrap">
            {books.filter(fits).length === 0 && <span className="muted">Подходящих книг нет</span>}
            {books.filter(fits).map((c) => (
              <Book key={c} v={view} id={c} onClick={() => {
                const next = [...gifts, { patron: pt.id, card: c }];
                setPatron(null);
                if (single) onDone(next); else setGifts(next);
              }} />
            ))}
          </div>
        </>
      )}
      {!single && gifts.length > 0 && (
        <ul>{gifts.map((g, i) => <li key={i}>{PATRONS[g.patron].name} ← «{view.cards[g.card].title}»</li>)}</ul>
      )}
      {!single && (
        <div className="modal-foot"><button className="primary" disabled={!gifts.length} onClick={() => onDone(gifts)}>Завязать связи ({gifts.length})</button></div>
      )}
    </>
  );
}

export function ClubPanel({ view, me, place }: { view: PlayerView; me: VPlayer; place: (p: PlaceAction) => void }) {
  return <GiftPicker view={view} me={me} onDone={(gifts) => place({ address: 'club', gifts })} />;
}

// Клуб как свободное действие: одна книга одному Завсегдатаю за ход, Единомышленник не нужен.
export function ClubGiftModal({ view, me, act, close }: { view: PlayerView; me: VPlayer; act: (a: Action) => void; close: () => void }) {
  return (
    <Modal title="Клуб книголюбов" wide onClose={close}>
      <p className="muted small">Свободное действие: Единомышленник не нужен, ход не заканчивается. Одна книга за ход.</p>
      <GiftPicker view={view} me={me} single onDone={(g) => { act({ type: 'clubGift', gift: g[0] }); close(); }} />
    </Modal>
  );
}

export function KontoraPanel({ view, place }: { view: PlayerView; place: (p: PlaceAction) => void }) {
  const targets = kontoraTargets(view);
  return (
    <>
      <h4>Цена похода: одна открыто лежащая на чьём-то Складе книга опального жанра уйдёт в Спецхран</h4>
      {targets.length === 0
        ? <p className="warn-text">Сейчас в Контору не пойти: ни у кого на Складе нет открытой опальной книги — нечем заплатить.</p>
        : <TargetShelf view={view} targets={targets} />}
      <p>Соперники уже не успеют перепрятать книги. Дальше вы выберете от 1 до 4 пунктов и книгу для Спецхрана:</p>
      <ul>
        <li><b>Ходатайство</b> — вернуть из Конторы {RULES.petitionMax === 1 ? 'одного удержанного Единомышленника' : `до ${RULES.petitionMax} удержанных Единомышленников`} любого игрока.</li>
        <li><b>Выдача на руки</b> — посмотреть Спецхран и взять оттуда одну книгу.</li>
        <li><b>Сигнал</b> — удержать в Конторе Единомышленника любого игрока.</li>
        <li><b>Профилактика</b> — удалить одного Завсегдатая Клуба.</li>
      </ul>
      <div className="modal-foot"><button className="primary" disabled={!targets.length} onClick={() => place({ address: 'kontora' })}>Дальше</button></div>
    </>
  );
}

function TargetShelf({ view, targets, selected, onPick }: {
  view: PlayerView; targets: { player: string; card: string }[]; selected?: string; onPick?: (t: { player: string; card: string }) => void;
}) {
  return (
    <div className="shelf wrap targets">
      {targets.map((t) => (
        <Book key={t.card} v={view} id={t.card} note={view.players.find((p) => p.id === t.player)!.name}
          selected={selected === t.card} onClick={onPick ? () => onPick(t) : undefined} />
      ))}
    </div>
  );
}

export function KontoraWarningPrompt({ view, me, from, act }: { view: PlayerView; me: VPlayer; from: string; act: (a: Action) => void }) {
  const cards = me.warehouse.map((s) => s.card!).filter(Boolean);
  const [sel, setSel] = useState<string[]>(() => me.warehouse.filter((s) => s.hidden).map((s) => s.card!));
  const limit = cacheLimit(view, me);
  const name = view.players.find((p) => p.id === from)?.name;
  return (
    <Modal title="Предупреждение: Контора" wide>
      <p>{name} собирается в Контору. Можно перепрятать книги — в Тайнике помещается {limit}. Открытая опальная книга может уйти в Спецхран.</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)} onClick={() => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot"><button className="primary" disabled={sel.length > limit} onClick={() => act({ type: 'kontoraHide', hidden: sel })}>Готово ({sel.length}/{limit})</button></div>
    </Modal>
  );
}

export function KontoraDecidePrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const [petition, setPetition] = useState<string[]>([]);
  const [handout, setHandout] = useState(false);
  const [signal, setSignal] = useState('');
  const [prophylaxis, setProphylaxis] = useState<PatronId | ''>('');
  const [seize, setSeize] = useState<{ player: string; card: string } | null>(null);
  const held = view.players.filter((p) => p.held > 0);
  const targets = kontoraTargets(view);
  const count = [petition.length > 0, handout, !!signal, !!prophylaxis].filter(Boolean).length;
  // Повод для Сигнала проверяется после уплаты цены: выбранная для Спецхрана книга уже не лежит у игрока.
  const afterPrice = seize
    ? { ...view, players: view.players.map((p) => (p.id === seize.player ? { ...p, warehouse: p.warehouse.filter((w) => w.card !== seize.card) } : p)) }
    : view;
  const signalOk = !signal || signalable(afterPrice, signal);
  const choice: KontoraChoice = {
    ...(petition.length ? { petition } : {}), ...(handout ? { handout } : {}), ...(signal ? { signal } : {}),
    ...(prophylaxis ? { prophylaxis } : {}), ...(seize ? { seize } : {}),
  };
  return (
    <Modal title="Контора" wide>
      <p>Выберите от 1 до 4 пунктов (без повторов).</p>
      <h4>Ходатайство ({RULES.petitionMax === 1 ? '1 Единомышленник' : `до ${RULES.petitionMax} Единомышленников`})</h4>
      <div className="genres">
        {held.length === 0 && <span className="muted">Никто не удержан</span>}
        {held.map((p) => (
          <span key={p.id}>
            {p.name} ({p.held}):{' '}
            <button className="small" disabled={petition.length >= RULES.petitionMax || petition.filter((x) => x === p.id).length >= p.held} onClick={() => setPetition([...petition, p.id])}>+1</button>
          </span>
        ))}
        {petition.length > 0 && <button className="small" onClick={() => setPetition([])}>сбросить ({petition.length})</button>}
      </div>
      <label className="row"><input type="checkbox" checked={handout} onChange={(e) => setHandout(e.target.checked)} /> Выдача на руки — взять книгу из Спецхрана</label>
      <label>Сигнал — удержать Единомышленника игрока:
        <select value={signal} onChange={(e) => setSignal(e.target.value)}>
          <option value="">— нет —</option>
          {view.players.filter((p) => signalable(afterPrice, p.id) || p.id === signal).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="muted small"> (только на тех, у кого после изъятия книги-цены открыто лежит опальная книга или Пропаганда)</span>
        {!signalOk && <div className="small" style={{ color: 'var(--red)' }}>После изъятия выбранной книги у этого игрока не останется повода для Сигнала.</div>}
      </label>
      <label>Профилактика — удалить Завсегдатая:
        <select value={prophylaxis} onChange={(e) => setProphylaxis(e.target.value as PatronId)}>
          <option value="">— нет —</option>
          {view.patrons.filter((x) => !x.removed).map((x) => <option key={x.id} value={x.id}>{PATRONS[x.id].name}</option>)}
        </select>
      </label>
      <h4>Цена похода (обязательно): выберите открытую опальную книгу — она уйдёт в Спецхран</h4>
      {targets.length === 0
        ? <p className="warn-text">Заплатить нечем — в Контору сейчас не пойти. Единомышленник остаётся у вас.</p>
        : <TargetShelf view={view} targets={targets} selected={seize?.card} onPick={(t) => setSeize(seize?.card === t.card ? null : t)} />}
      <div className="modal-foot">
        <button onClick={() => act({ type: 'kontoraDecide', go: false })}>Передумать</button>
        <button className="primary" disabled={count < 1 || !seize || !signalOk} title={!seize ? 'Выберите книгу для Спецхрана' : count < 1 ? 'Выберите хотя бы один пункт' : !signalOk ? 'Сигналу нет повода' : ''}
          onClick={() => act({ type: 'kontoraDecide', go: true, choice })}>Пойти в Контору ({count})</button>
      </div>
    </Modal>
  );
}

export function HandoutPrompt({ view, cards, act }: { view: PlayerView; cards: string[]; act: (a: Action) => void }) {
  return (
    <Modal title="Выдача на руки: Спецхран" wide>
      <p>Возьмите одну книгу.</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} onClick={() => act({ type: 'kontoraHandout', card: c })} />)}
      </div>
    </Modal>
  );
}

export function FreeConnectionPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  return (
    <Modal title="Председатель: бесплатная связь" wide>
      <GiftPicker view={view} me={me} single onDone={(g) => act({ type: 'clubGift', gift: g[0] })} />
      <div className="modal-foot"><button onClick={() => act({ type: 'pass' })}>Отказаться</button></div>
    </Modal>
  );
}

export function RescuePanel({ view, done }: { view: PlayerView; done: (g: GroupAction) => void }) {
  const [returns, setReturns] = useState<Record<string, number>>({});
  const held = view.players.filter((p) => p.held > 0);
  const total = Object.values(returns).reduce((s, n) => s + n, 0);
  return (
    <>
      <p>Верните любое число удерживаемых Конторой Единомышленников себе и другим игрокам.</p>
      {held.map((p) => (
        <label key={p.id} className="row">{p.name}: <input type="number" min={0} max={p.held} value={returns[p.id] ?? 0}
          onChange={(e) => setReturns({ ...returns, [p.id]: Math.max(0, Math.min(p.held, Number(e.target.value))) })} /> из {p.held}</label>
      ))}
      <div className="modal-foot"><button className="primary" disabled={!total} onClick={() => done({ action: 'rescue', returns })}>Вызволить ({total})</button></div>
    </>
  );
}
