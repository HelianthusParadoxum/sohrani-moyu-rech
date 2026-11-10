// Интерфейс полного режима: Клуб книголюбов, Контора.
import { useState, type ReactNode } from 'react';
import { CLUB_ORDER, GENRE_NAMES, GENRE_SHORT, PATRONS, RULES } from '../engine/content';
import type { Action, ClubGift, Genre, GroupAction, KontoraChoice, PatronId, PlaceAction } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { cacheLimit, genresOf } from '../engine/util';
import { kontoraTargets } from '../engine/full';
import { Book, Dropdown, GenreChip, Modal, PLAYER_COLORS, iconize, iconsOf, isBanned, isLoad, toggle, withKindChips } from './ui';

type VPlayer = PlayerView['players'][number];

// Порядок жанровых слотов Клуба — как на планшете: верхний ряд, затем нижний.
const byClubOrder = <T extends { genre: Genre }>(list: T[]) => [...list].sort((a, b) => CLUB_ORDER.indexOf(a.genre) - CLUB_ORDER.indexOf(b.genre));

// Книги игрока, которые подходят Завсегдатаю: его жанра или Альбом (Альбом подходит любому).
export function fittingBooks(view: PlayerView, me: VPlayer, genre: Genre): string[] {
  return me.warehouse.map((s) => s.card!).filter((c) => c && (genresOf(view, c).includes(genre) || genresOf(view, c).includes('album')));
}

// Можно ли сейчас завязать связь с Завсегдатаем: свободен, связи ещё нет и есть подходящая книга.
export function patronOpen(view: PlayerView, me: VPlayer, pt: PlayerView['patrons'][number]): boolean {
  return !pt.removed && !pt.turned && !pt.connections.includes(me.id) && fittingBooks(view, me, pt.genre).length > 0;
}

// Почему с этим Завсегдатаем сейчас не завязать связь (null — можно).
export function patronWhy(view: PlayerView, me: VPlayer, pt: PlayerView['patrons'][number]): string | null {
  const name = PATRONS[pt.id].name;
  if (pt.removed) return `${name} больше не ходит в Клуб.`;
  if (pt.connections.includes(me.id)) return `Связь с Завсегдатаем «${name}» у вас уже есть.`;
  if (pt.turned) return `${name} занят на эту Пятилетку: с ним уже завязали связь.`;
  // Значок Альбома и слово рядом (неразрывный пробел: после значка журнал не убирает название жанра).
  const album = `[${GENRE_SHORT.album}]\u00a0Альбом`;
  if (!fittingBooks(view, me, pt.genre).length) {
    return pt.genre === 'album'
      ? `${name} ждёт ${album} — таких книг у вас на складе нет.`
      : `${name} ждёт книгу жанра [${GENRE_SHORT[pt.genre]}] или ${album} — таких книг у вас на складе нет.`;
  }
  return null;
}

// onPatron — нажатие на Завсегдатая (когда можно дарить): сразу к дарению именно ему.
// onBlocked — нажатие на того, кому сейчас книгу не дать: объяснить почему.
export function ClubContents({ view, seatIndex, me, onPatron, onBlocked }: { view: PlayerView; seatIndex: (id: string) => number; me?: VPlayer | null; onPatron?: (id: PatronId) => void; onBlocked?: (id: PatronId) => void }) {
  return (
    <ul className="patrons">
      {byClubOrder(view.patrons).map((pt) => {
        const can = !!onPatron && !!me && patronOpen(view, me, pt);
        // Своя связь — подложка в бледный цвет игрока.
        const mine = !!me && !pt.removed && pt.connections.includes(me.id);
        const tint = mine ? PLAYER_COLORS[seatIndex(me!.id)] : null;
        return (
        <li key={pt.id} className={`${pt.removed ? 'removed' : ''} ${pt.turned ? 'turned' : ''} ${can ? 'can' : ''} ${onPatron && !can ? 'off' : ''} ${mine ? 'mine' : ''}`}
          style={tint ? { background: `color-mix(in srgb, ${tint} 16%, var(--card))`, borderColor: tint } : undefined}
          title={iconize(PATRONS[pt.id].hint)} role={can ? 'button' : undefined}
          onClick={can ? (e) => { e.stopPropagation(); onPatron!(pt.id); } : onBlocked ? (e) => { e.stopPropagation(); onBlocked(pt.id); } : onPatron ? (e) => e.stopPropagation() : undefined}>
          <div className="patron-head"><b>{PATRONS[pt.id].name}</b><GenreChip g={pt.genre} /></div>
          <div className="muted small">{withKindChips(iconize(PATRONS[pt.id].hint))}</div>
          {/* Связи — нижним рядом: жетоны игроков (число — Пятилетка, с которой связь), свободные места — пунктиром. */}
          <div className="patron-links">
            {pt.connections.map((pid) => (
              <span key={pid} className="dot num wide" style={{ background: PLAYER_COLORS[seatIndex(pid)] }}
                title={`${view.players.find((x) => x.id === pid)?.name ?? ''}${pt.since?.[pid] ? `: связь с ${pt.since[pid]}-й Пятилетки` : ''}`}>{pt.since?.[pid] ? `П${pt.since[pid]}` : ''}</span>
            ))}
            {Array.from({ length: Math.max(0, view.players.length - pt.connections.length) }, (_, i) => (
              <span key={`free${i}`} className="dot num wide slot-free" title="Свободное место для связи" />
            ))}
          </div>
        </li>
        );
      })}
    </ul>
  );
}

// Человечек — удержанный Конторой Единомышленник (пустой — свободное место из 7).
function Figure({ color, title }: { color?: string; title?: string }) {
  return (
    <svg className={`figure${color ? '' : ' free'}`} viewBox="0 0 12 18" width="12" height="18" aria-label={title}>
      {title && <title>{title}</title>}
      <circle cx="6" cy="4" r="3" fill={color ?? 'none'} />
      <path d="M1.5 17 V12 a4.5 4.5 0 0 1 9 0 V17 Z" fill={color ?? 'none'} />
    </svg>
  );
}

export function KontoraContents({ view, seatIndex }: { view: PlayerView; seatIndex: (id: string) => number }) {
  const held = view.players.flatMap((p) => Array.from({ length: p.held }, () => p));
  const total = held.length;
  return (
    <div className="small">
      <div className="held-figures" title={`Удержано Конторой: ${total}`}>
        {held.map((p, i) => <Figure key={i} color={PLAYER_COLORS[seatIndex(p.id)]} title={p.name} />)}
        {!total && <span className="muted">Никто не удержан</span>}
      </div>
    </div>
  );
}

// Подарки Завсегдатаям: каждому — книга жанра его слота (Альбом подходит любому).
export function GiftPicker({ view, me, single, onDone, initialPatron }: { view: PlayerView; me: VPlayer; single?: boolean; onDone: (gifts: ClubGift[]) => void; initialPatron?: PatronId }) {
  const [gifts, setGifts] = useState<ClubGift[]>([]);
  const [patron, setPatron] = useState<PatronId | null>(initialPatron ?? null);
  const used = gifts.map((g) => g.card);
  const open = byClubOrder(view.patrons).filter((pt) => !pt.removed && !pt.turned && !pt.connections.includes(me.id) && !gifts.some((g) => g.patron === pt.id));
  const pt = view.patrons.find((x) => x.id === patron);
  const fitsFor = (genre: Genre) => (c: string) => genresOf(view, c).includes(genre) || genresOf(view, c).includes('album');
  const fits = (c: string) => !!pt && fitsFor(pt.genre)(c);
  const books = me.warehouse.map((s) => s.card!).filter((c) => c && !used.includes(c));
  const give = (id: PatronId, card: string) => {
    const next = [...gifts, { patron: id, card }];
    setPatron(null);
    if (single) onDone(next); else setGifts(next);
  };
  // Подходящая книга одна — отдаём её сразу, без выбора.
  const choosePatron = (id: PatronId, genre: Genre) => {
    const only = books.filter(fitsFor(genre));
    if (only.length === 1) give(id, only[0]); else setPatron(id);
  };
  return (
    <>
      <p>Выберите Завсегдатая и отдайте ему книгу жанра его слота (Альбом подходит любому). {single ? 'Одна связь.' : 'За один приход можно завязать несколько связей.'}</p>
      <div className="genres">
        {open.length === 0 && <span className="muted">Свободных Завсегдатаев нет</span>}
        {open.map((x) => (
          <button key={x.id} className={patron === x.id ? 'selected' : ''} onClick={() => choosePatron(x.id, x.genre)} title={iconize(PATRONS[x.id].hint)}>
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
              <Book key={c} v={view} id={c} onClick={() => give(pt.id, c)} />
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
export function ClubGiftModal({ view, me, act, close, patron }: { view: PlayerView; me: VPlayer; act: (a: Action) => void; close: () => void; patron?: PatronId }) {
  return (
    <Modal title="Клуб книголюбов" wide onClose={close}>
      <p className="muted small">Свободное действие: 👤 не нужен, ход не заканчивается. Одна книга за ход.</p>
      <GiftPicker view={view} me={me} single initialPatron={patron} onDone={(g) => { act({ type: 'clubGift', gift: g[0] }); close(); }} />
    </Modal>
  );
}

// Бонус Ростка «Завязать знакомство»: связь с любым Завсегдатаем без книги (и с занятым на эту Пятилетку).
export function BefriendPicker({ view, me, onPick, close, title = 'Завязать знакомство', footer }: { view: PlayerView; me: VPlayer; onPick: (id: PatronId) => void; close?: () => void; title?: string; footer?: ReactNode }) {
  const open = byClubOrder(view.patrons).filter((pt) => !pt.removed && !pt.connections.includes(me.id));
  return (
    <Modal title={title} wide onClose={close}>
      <p className="muted small">Связь с любым Завсегдатаем — без книги, даже если он занят на эту Пятилетку.</p>
      <ul className="patrons">
        {open.map((pt) => (
          <li key={pt.id} className="can" role="button" onClick={() => onPick(pt.id)} title={iconize(PATRONS[pt.id].hint)}>
            <div className="patron-head"><b>{PATRONS[pt.id].name}</b><GenreChip g={pt.genre} /></div>
            <div className="muted small">{withKindChips(iconize(PATRONS[pt.id].hint))}</div>
          </li>
        ))}
      </ul>
      {footer}
    </Modal>
  );
}

export function KontoraPanel({ view, place }: { view: PlayerView; place: (p: PlaceAction) => void }) {
  const targets = kontoraTargets(view, view.me);
  const held = view.players.some((p) => p.held > 0);
  return (
    <>
      <p>В Конторе — одно на выбор: <b>Пришить дело</b> или <b>Вызволить из бед</b>.</p>
      <h3>Вызволить из бед</h3>
      <p>Вернуть из Конторы до {RULES.rescueMax} удерживаемых 👤 (своих или чужих): +{RULES.rescuePoints} очка за каждого. Донос не нужен.</p>
      {!held && <p className="warn-text">Сейчас Контора никого не удерживает.</p>}
      <h3>Пришить дело</h3>
      <h4>Цена похода — донос: указать на открыто лежащую на Складе соперника опальную книгу (опального жанра, ЧНЛ или Улику). В конце похода — обязательно: Сигнал (Контора удерживает 👤 того, на кого донос) и Изъятие этой книги в Спецхран</h4>
      {targets.length === 0
        ? <p className="warn-text">Сейчас дело не пришить: ни у кого на Складе нет открытой опальной книги — доносить не на что.</p>
        : <TargetShelf view={view} targets={targets} />}
      <p>Соперники уже не успеют перепрятать книги. Дальше вы укажете книгу для доноса и, по желанию, до 3 пунктов (можно ни одного):</p>
      <ul>
        <li><b>Ходатайство</b> — вернуть из Конторы {RULES.petitionMax === 1 ? 'одного удержанного 👤' : `до ${RULES.petitionMax} удержанных 👤`} любого игрока.</li>
        <li><b>Выдача на руки</b> — посмотреть Спецхран и взять оттуда одну книгу.</li>
        <li><b>Профилактика</b> — удалить Завсегдатая Клуба, с которым связан тот, на кого вы донесли.</li>
      </ul>
      <div className="modal-foot"><button className="primary" disabled={!targets.length && !held} onClick={() => place({ address: 'kontora' })}>Дальше</button></div>
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
      <p>{name} собирается в Контору. Можно перепрятать книги — в Тайнике помещается {limit}. На открытую опальную книгу могут донести, а затем изъять её в Спецхран.</p>
      <div className="shelf wrap">
        {cards.map((c) => <Book key={c} v={view} id={c} selected={sel.includes(c)} hidden={sel.includes(c)}
          note={isLoad(view, c) ? 'не прячется' : undefined} onClick={isLoad(view, c) ? undefined : () => setSel(toggle(sel, c))} />)}
      </div>
      <div className="modal-foot"><button className="primary" disabled={sel.length > limit} onClick={() => act({ type: 'kontoraHide', hidden: sel })}>Готово ({sel.length}/{limit})</button></div>
    </Modal>
  );
}

export function KontoraDecidePrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  const [petition, setPetition] = useState<string[]>([]);
  const [handout, setHandout] = useState(false);
  const [prophylaxis, setProphylaxis] = useState<PatronId | ''>('');
  const [denounce, setDenounce] = useState<{ player: string; card: string } | null>(null);
  const held = view.players.filter((p) => p.held > 0);
  const targets = kontoraTargets(view, view.me);
  const [mode, setMode] = useState<'case' | 'rescue'>(targets.length ? 'case' : 'rescue');
  const count = [petition.length > 0, handout, !!prophylaxis].filter(Boolean).length;
  const target = denounce ? view.players.find((p) => p.id === denounce.player) : null;
  const prophOk = !prophylaxis || !denounce || view.patrons.some((x) => x.id === prophylaxis && x.connections.includes(denounce.player));
  const pickDenounce = (t: { player: string; card: string }) => {
    const next = denounce?.card === t.card ? null : t;
    setDenounce(next);
    if (!next || !view.patrons.some((x) => x.id === prophylaxis && x.connections.includes(next.player))) setProphylaxis('');
  };
  const choice: KontoraChoice = {
    ...(petition.length ? { petition } : {}), ...(handout ? { handout } : {}),
    ...(prophylaxis ? { prophylaxis } : {}), ...(denounce ? { denounce } : {}),
  };
  return (
    <Modal title="Контора" wide>
      <div className="genres">
        <button className={mode === 'case' ? 'selected' : ''} disabled={!targets.length} onClick={() => setMode('case')}>Пришить дело</button>
        <button className={mode === 'rescue' ? 'selected' : ''} disabled={!held.length} onClick={() => setMode('rescue')}>Вызволить из бед</button>
      </div>
      {mode === 'rescue' ? (
        <>
          <RescuePanel view={view} onDone={(rescue) => act({ type: 'kontoraDecide', go: true, choice: { rescue } })} />
          <div className="modal-foot"><button onClick={() => act({ type: 'kontoraDecide', go: false })}>Передумать</button></div>
        </>
      ) : (<>
      <p>Цена похода — донос: укажите открытую опальную книгу соперника; в конце похода, после выбранных пунктов, — обязательно Сигнал на этого игрока и Изъятие книги в Спецхран.</p>
      <h4>Донос (обязательно): укажите открытую опальную книгу</h4>
      {targets.length === 0
        ? <p className="warn-text">Доносить не на что — в Контору сейчас не пойти. 👤 остаётся у вас.</p>
        : <TargetShelf view={view} targets={targets} selected={denounce?.card} onPick={pickDenounce} />}
      {target && <p className="muted small">В конце похода: Сигнал — Контора удержит 👤 игрока {target.name}; его книга уйдёт в Спецхран.</p>}
      <p>Пункты по желанию — от 0 до 3, без повторов (можно ограничиться доносом):</p>
      <h4>Ходатайство ({RULES.petitionMax === 1 ? '1 👤' : `до ${RULES.petitionMax} 👤`})</h4>
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
      {/* Профилактика — только Завсегдатаю, связанному с тем, на кого донос: пока книга для доноса не выбрана, выбирать не из кого. */}
      <label>Профилактика — удалить Завсегдатая, с которым связан тот, на кого донос{denounce ? '' : ' (сначала укажите книгу для доноса)'}:
        <Dropdown value={prophylaxis as string} ariaLabel="Профилактика" disabled={!denounce} onChange={(v) => setProphylaxis(v as PatronId)}
          options={[{ value: '', label: '— нет —' }, ...view.patrons.filter((x) => !x.removed && (!denounce || x.connections.includes(denounce.player))).map((x) => ({ value: x.id as string, label: PATRONS[x.id].name }))]} />
      </label>
      <div className="modal-foot">
        <button onClick={() => act({ type: 'kontoraDecide', go: false })}>Передумать</button>
        <button className="primary" disabled={!denounce || !prophOk} title={!denounce ? 'Укажите книгу для доноса' : !prophOk ? 'Этот Завсегдатай не связан с тем, на кого донос' : ''}
          onClick={() => act({ type: 'kontoraDecide', go: true, choice })}>Пойти в Контору ({count})</button>
      </div>
      </>)}
    </Modal>
  );
}

export function HandoutPrompt({ view, cards, act, group }: { view: PlayerView; cards: string[]; act: (a: Action) => void; group?: boolean }) {
  // Книги, которые кто-то успел забрать раньше, не показываем.
  const left = cards.filter((c) => view.spetskhranKnown.includes(c));
  return (
    <Modal title={group ? 'Выудить из Спецхрана' : 'Выдача на руки: Спецхран'} wide>
      <p>{left.length ? 'Возьмите одну книгу.' : 'Книг уже не осталось — их забрали раньше вас.'}</p>
      <div className="shelf wrap">
        {left.map((c) => <Book key={c} v={view} id={c} onClick={() => act({ type: 'kontoraHandout', card: c })} />)}
      </div>
      {(group || !left.length) && <div className="modal-foot"><button onClick={() => act({ type: 'pass' })}>{left.length ? 'Отказаться' : 'Понятно'}</button></div>}
    </Modal>
  );
}

export function FreeConnectionPrompt({ view, me, act }: { view: PlayerView; me: VPlayer; act: (a: Action) => void }) {
  return (
    <BefriendPicker view={view} me={me} title="Председатель: бесплатная связь" onPick={(patron) => act({ type: 'befriend', patron })}
      footer={<div className="modal-foot"><button onClick={() => act({ type: 'pass' })}>Отказаться</button></div>} />
  );
}

// Вызволить из бед в Конторе: кого вернуть.
export function RescuePanel({ view, onDone }: { view: PlayerView; onDone: (returns: Record<string, number>) => void }) {
  const [returns, setReturns] = useState<Record<string, number>>({});
  const held = view.players.filter((p) => p.held > 0);
  const total = Object.values(returns).reduce((s, n) => s + n, 0);
  return (
    <>
      <p>Верните до {RULES.rescueMax} удерживаемых Конторой 👤 — себе и другим игрокам: +{RULES.rescuePoints} очка за каждого.</p>
      {held.map((p) => {
        const room = RULES.rescueMax - total + (returns[p.id] ?? 0);
        return (
          <label key={p.id} className="row">{p.name}: <input type="number" min={0} max={Math.min(p.held, room)} value={returns[p.id] ?? 0}
            onChange={(e) => setReturns({ ...returns, [p.id]: Math.max(0, Math.min(p.held, room, Number(e.target.value))) })} /> из {p.held}</label>
        );
      })}
      <div className="modal-foot"><button className="primary" disabled={!total} onClick={() => onDone(returns)}>Вызволить ({total})</button></div>
    </>
  );
}
