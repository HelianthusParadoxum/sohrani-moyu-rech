// Общие элементы интерфейса: карты книг, окна, жанры.
import type React from 'react';
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ADDRESS_ICONS, BONUS_ICONS, GENRE_NAMES, GROUP_ICONS, ICON_JOIN, GENRE_SHORT, PASSIONS } from '../engine/content';
import { AUTO_PRESET, SOLO_PRESET, selectablePresets } from '../engine/bot-presets';
import type { AddressId, Genre, GroupActionId, SproutBonusId } from '../engine/types';
import type { PlayerView } from '../engine/view';
import type { ClientMessage, RoomInfo } from '../shared/protocol';
import { flexGenres, iconsOf, isBanned as isBannedBook } from '../engine/util';

export { GENRE_SHORT } from '../engine/content';

// Значки вместо слов — те же, что на планшетах игроков: 🎫 Талоны, ★ очки, 📚 склад, 🔒 Тайник, 🤝 связи, 👤 Единомышленники;
// книги: 📃 Непечатные (самиздат), 📕 Нагрузка. Для журнала, адресов, Завсегдатаев и подсказок.
const ICONS: [RegExp, string][] = [
  [/\[Нагрузка\] /g, '📕 '],
  [/(\d+) Талон(?:а|ов)?/g, '$1🎫'],
  [/(\d)т(?![а-яё])/g, '$1🎫'],
  [/Талон(?:ами|ах|ам|ы|ов|а)?(?![а-яё])/g, '🎫'],
  [/(\d+) очк(?:ов|о|а)?(?: Гласности)?/g, '$1★'],
  [/склад увеличен до/g, '📚 увеличен до'],
  [/Тайник увеличен до/g, '🔒 увеличен до'],
  [/заводит связь в Клубе:/g, '🤝'],
  [/(?<!Увеличени[а-яё]* )склад(?:а|е|у)?(?![а-яё])/g, '📚'], // «Увеличение склада» — старое название действия Группы
  [/(?<!(?:Закладк[а-яё]*|Заложить) )Тайник[а-яё]*/g, '🔒'], // «Заложить Тайник» — название действия Группы
  [/[Сс]вяз(?:ь|и|ей)(?: в Клубе)?(?![а-яё])/g, '🤝'],
  [/[Ее]диномышленник[а-яё]*/g, '👤'],
  [/Нагрузк[а-яё]*/g, '📕'],
  [/[Нн]епечатн[а-яё]* текст[а-яё]*/g, '📃'], // «непечатный текст» (книга из стопки Непечатных)
  [/Непечатн[а-яё]*/g, '📃'],
];
// Только Единомышленники — значком 👤 (подсказки-инструкции, где прочие слова оставляем словами).
export const workerIcon = (text: string) => text.replace(/[Ее]диномышленник[а-яё]*/g, '👤');

// Упоминания адресов (во всех падежах) — со значком адреса перед названием. Названия Ростков в кавычках
// («Клуб Самодеятельной Песни») не трогаем — и без кавычек: Ростки-клубы (КСП, КВН, КЛФ) — не Клуб книголюбов;
// уже стоящий значок не повторяем.
const ADDRESS_WORDS: [AddressId, string][] = [
  ['club', 'Клуб(?:а|е|у|ом)?(?: книголюбов)?(?![а-яё])(?! (?:Самодеятельн|Весёл|Любител))'], ['kontora', 'Контор[а-яё]*'], ['sprouts', 'Росток|Ростк[а-яё]*'],
  ['redCorner', 'Красн[а-яё]* уголк[а-яё]*|Красный уголок'], ['glavlit', 'Главлит(?:а|е|у|ом)?(?![а-яё])'],
  ['makulatura', 'Макулатур[а-яё]*'], ['gostorg', 'Госкниготорг[а-яё]*'], ['baraholka', 'Барахолк[а-яё]*'],
  ['tolkuchka', 'Толкучк[а-яё]*'], ['razval', 'Развал(?:а|е|у|ом)?(?![а-яё])'], ['zavoz', 'Развоз(?:а|е|у|ом)?(?![а-яё])'],
  ['tamizdat', 'Тамиздат[а-яё]*'], ['samizdat', 'Самиздат[а-яё]*'], ['knigoobmen', 'Книгообмен[а-яё]*'],
  ['raspredelitel', 'Распределител[а-яё]*'], ['agitpunkt', 'Агитпункт[а-яё]*'], ['podpiska', 'Подписк[а-яё]*'],
  ['nasledniki', 'Наследник[а-яё]*'], ['posrednichestvo', 'Посредничеств[а-яё]*(?: авторам)?'],
  ['spisanie', 'Библиотечн[а-яё]* списани[а-яё]*'], ['kvartirnik', 'Квартирник[а-яё]*'],
];
// Действия Инициативной группы — тоже со значком перед названием.
const GROUP_WORDS: [GroupActionId, string][] = [
  ['expandWarehouse', 'Увеличить Склад'], ['expandCache', 'Заложить Тайник'],
  ['copyText', 'Тиражировать Текст'], ['spetskhran', 'Выудить из Спецхрана'],
  ['restore', 'Написать Монографию'], ['hire', 'Расширить Сеть'],
];
// Уникальные бонусы Ростков.
const BONUS_WORDS: [string, string][] = [['sideJob', 'Приработ[а-яё]*'], ['underCounter', 'Из-под полы'], ['acquaintance', 'Завязать знакомство']];
const NAME_RES: [RegExp, string][] = [
  ...ADDRESS_WORDS.map(([id, w]) => [w, ADDRESS_ICONS[id]] as const),
  ...GROUP_WORDS.map(([id, w]) => [w, GROUP_ICONS[id]] as const),
  ...BONUS_WORDS.map(([id, w]) => [w, BONUS_ICONS[id as SproutBonusId]!] as const),
].map(([w, icon]) => [new RegExp(`(?<!\\p{Extended_Pictographic}\\uFE0F?[\\s\\u2060]?)(?<![«А-Яа-яЁё])(${w})`, 'gu'), `${icon}${ICON_JOIN}$1`]);
// Адреса и действия Группы — со значками (заголовки окон, пояснения).
export function addressIcons(text: string): string {
  return NAME_RES.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function iconize(text: string): string {
  return addressIcons(ICONS.reduce((t, [re, to]) => t.replace(re, to), text));
}

// Цвета игроков — из оттенков, которых нет у жанров (бирюзовый, малиновый, голубой, салатовый, сиреневый).
export const PLAYER_COLORS = ['#12897b', '#d63c78', '#2b9fd9', '#6f9a14', '#a63fbf'];

export { iconsOf, isLoad } from '../engine/util';

// Книга Нагрузки по правилам (Главлит, Красный уголок). ПСС Ленина лежит в стопке Нагрузки, но это обычная ЧНЛ.
export function fromLoadDeck(v: PlayerView, id: string) {
  return ['load', 'loadReturnable', 'loadEvidence'].includes(v.cards[id].kind);
}

export function isBanned(v: PlayerView, id: string) {
  return isBannedBook(v, id);
}

// Жанры, за которые награждает моё Пристрастие (у Хранителей — два жанра).
export function favoredGenres(v: PlayerView): Genre[] {
  const passion = v.players.find((p) => p.id === v.me)?.passion;
  return (passion && PASSIONS[passion].genres) || [];
}

// Текст, где слово «ЧНЛ» — значком (подсказки, правила в окнах).
export function withKindChips(text: string): ReactNode {
  if (!text.includes('ЧНЛ')) return text;
  return text.split(/(ЧНЛ)/).map((part, i) => (part === 'ЧНЛ' ? <KindChip key={i} k="chnl" /> : part));
}

// Значки ЧНЛ (человеконенавистническая литература) и Улик (УЛ).
export function KindChip({ k, banned }: { k: 'chnl' | 'ul'; banned?: boolean }) {
  return (
    <span className={`chip k-${k} ${banned ? 'banned' : ''}`}
      title={k === 'chnl' ? 'ЧНЛ — человеконенавистническая литература' : 'УЛ — Улика'}>
      {k === 'chnl' ? 'ЧНЛ' : 'УЛ'}
    </span>
  );
}

export function GenreChip({ g, banned, favored }: { g: Genre; banned?: boolean; favored?: boolean }) {
  return (
    <span className={`chip g-${g} ${banned ? 'banned' : ''} ${favored ? 'favored' : ''}`}
      title={GENRE_NAMES[g] + (banned ? ' — в опале' : '') + (favored ? ' — по вашему Пристрастию' : '')}>
      {GENRE_SHORT[g]}
    </span>
  );
}

const KIND_LABEL: Record<string, string> = {
  load: 'Нагрузка', loadReturnable: 'Нагрузка', loadEvidence: 'Нагрузка',
};

export function Book({ v, id, selected, onClick, hidden, small, note, price }: {
  v: PlayerView; id: string | null; selected?: boolean; onClick?: (e: React.MouseEvent) => void; hidden?: boolean; small?: boolean; note?: string; price?: number;
}) {
  if (!id) {
    return <div className={`book back ${small ? 'small' : ''} ${onClick ? 'clickable' : ''}`} title="Книга взакрытую" onClick={onClick}><span>✦</span></div>;
  }
  const c = v.cards[id];
  const icons = iconsOf(v, id);
  const banned = isBanned(v, id);
  const restored = !!v.restored[id];
  const flex = c.wild ? null : flexGenres(v, id); // «Чукоккала» — значок «ЛЮБОЙ», без перечня всех жанров
  const label = c.kind === 'loadReturnable' && restored ? null : c.kind === 'loadEvidence' && restored ? null : (c.kind === 'propaganda' || c.kind === 'loadPropaganda') && restored ? 'Разоблачение' : c.legal ? 'Нагрузка' : KIND_LABEL[c.kind];
  // Значки вида: ЧНЛ (и у ПСС Ленина), УЛ — у Улик (и Нагрузки-улики после Возвращения смыслов).
  const kindChip = (c.kind === 'propaganda' || c.kind === 'loadPropaganda') && !restored ? 'chnl' as const
    : c.kind === 'evidence' || (c.kind === 'loadEvidence' && restored) ? 'ul' as const : null;
  const t = c.kind === 'loadReturnable' && restored ? c.returned! : c.title;
  return (
    <button
      type="button"
      className={`book k-${c.kind === 'loadEvidence' && !restored ? 'load' : (c.kind === 'propaganda' || c.kind === 'loadPropaganda') && restored ? 'exposed' : c.kind} ${banned ? 'is-banned' : ''} ${selected ? 'selected' : ''} ${hidden ? 'in-cache' : ''} ${small ? 'small' : ''} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={`${t} — ${c.author}${c.kind === 'loadPropaganda' && !restored ? (c.legal
        ? '. Легальная ЧНЛ: она же Нагрузка (прикрывает Тайник в паре с другой Нагрузкой, в Тайник не прячется). Не опальна — Контора её не изымает и Сигнала на неё не подать; в конце −5★ и Срез Куратора. Обезвредить — Возвращением смыслов'
        : '. ЧНЛ из стопки Нагрузки: свойств Нагрузки у неё нет — обычная ЧНЛ') : ''}`}
    >
      <div className="book-icons">
        {(flex ? icons.slice(0, -1) : icons).map((g, i) => <GenreChip key={i} g={g} banned={v.banned.includes(g)} favored={favoredGenres(v).includes(g)} />)}
        {c.wild && restored && <span className={`chip wild ${v.banned.length ? 'banned' : ''}`} title="Второй значок любого жанра (Написать Монографию)">ЛЮБОЙ</span>}
        {c.wild && <span className={`chip wild ${v.banned.length ? 'banned' : ''}`} title="Значок любого жанра: в каждом подсчёте — того, что выгоднее (Ростки, Пристрастия, Клуб). Жанровых свойств нет; опальна, если в опале хоть один жанр">ЛЮБОЙ</span>}
        {flex && (
          <span className="chip flex" title={`Значок возвращения: ${flex.map((g) => GENRE_NAMES[g]).join(' или ')}`}>
            {flex.map((g) => GENRE_SHORT[g]).join('/')}
          </span>
        )}
        {c.kind === 'loadEvidence' && !restored && (
          <span className="ghost" title="После Монографии станет Уликой: опальная, +5 очков в конце">→ улика</span>
        )}
        {c.kind === 'loadReturnable' && !restored && c.genre && (
          <span className="ghost" title={`После Монографии: «${c.returned}», 3 значка ${GENRE_NAMES[c.genre]}`}>
            {[0, 1, 2].map((i) => <GenreChip key={i} g={c.genre!} />)}
          </span>
        )}
        {kindChip && <KindChip k={kindChip} banned={banned} />}
        {label && <span className="kind">{label}</span>}
        {restored && <span className="restored" title="Смыслы возвращены">↺</span>}
        {price !== undefined && <span className="book-price" title="Цена в Талонах">{price}т</span>}
      </div>
      <div className="book-title">{t}</div>
      {!small && <div className="book-author">{c.author}</div>}
      {hidden && <div className="stamp cache">в тайнике</div>}
      {banned && !hidden && <div className="stamp">опальная</div>}
      {note && <div className="book-note">{note}</div>}
    </button>
  );
}

// Свёрнутое окно (по заголовку): в партии окно можно свернуть, чтобы посмотреть на поле, — «Развернуть» внизу экрана.
export const ModalCollapse = createContext<{ collapsed: string | null; set: Dispatch<SetStateAction<string | null>> } | null>(null);

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  const collapse = useContext(ModalCollapse);
  const hidden = collapse?.collapsed === title;
  const set = collapse?.set;
  // Окно закрылось само (ход сменился) — свёрнутым оно больше не числится.
  useEffect(() => () => set?.((c) => (c === title ? null : c)), [set, title]);
  return (
    // Свёрнутое окно не размонтируем: выбор в нём сохраняется.
    <div className="modal-bg" onClick={onClose} style={hidden ? { display: 'none' } : undefined}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{addressIcons(title)}</h3>
          <span className="modal-head-buttons">
            {set && <button className="small" onClick={() => set(title)} title="Посмотреть на поле; вернуться к окну — кнопкой «Развернуть» внизу">Свернуть</button>}
            {onClose && <button className="close" onClick={onClose} aria-label="Закрыть">×</button>}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function toggle<T>(list: T[], x: T): T[] {
  return list.includes(x) ? list.filter((y) => y !== x) : [...list, x];
}

// Умелость ботов (лобби): «Стандарт» — как раньше, «Вдумчивые» — все боты смотрят на 3 своих хода вперёд.
export function SkillSelect({ room, send }: { room: RoomInfo; send: (m: ClientMessage) => void }) {
  return (
    <label><span className="cap">Умелость ботов</span>
      <Dropdown value={room.botSkill ?? 'standard'} onChange={(skill) => send({ t: 'botSkill', skill })} ariaLabel="Умелость ботов"
        options={[{ value: 'standard', label: 'Стандарт', title: 'Оценивают каждый ход по отдельности — быстро.' },
          { value: 'thoughtful', label: 'Вдумчивые', title: 'Думают на 3 своих хода вперёд — заметно сильнее, но дольше.' }]} />
    </label>
  );
}

export function SpeedSelect({ room, send }: { room: RoomInfo; send: (m: ClientMessage) => void }) {
  return (
    <label className="row">Скорость ботов:
      <Dropdown value={room.botDelay} onChange={(ms) => send({ t: 'botDelay', ms })} ariaLabel="Скорость ботов"
        options={[{ value: 1500, label: 'медленно' }, { value: 700, label: 'обычно' }, { value: 200, label: 'быстро' }, { value: 30, label: 'мгновенно' }]} />
    </label>
  );
}


// Пресет бота: хост выбирает, остальные видят название. Под строкой — описание (подсказки при наведении на телефоне не видны).
export function PresetSelect({ seat, host, send, solo }: { seat: RoomInfo['seats'][number]; host: boolean; send: (m: ClientMessage) => void; solo: boolean }) {
  // «Наугад» — первым и по умолчанию; «Случайного» нет (он для внутренних тестов), «Одиночка» — только в одиночной игре.
  const auto = { id: AUTO_PRESET, name: 'Тайная стратегия', description: 'Стратегия выпадет случайно и останется скрытой до конца партии.' };
  const options = [auto, ...selectablePresets(solo)];
  // По умолчанию — «Наугад», а в одиночной игре — «Одиночка».
  const current = options.find((p) => p.id === (seat.preset ?? (solo ? SOLO_PRESET : AUTO_PRESET))) ?? auto;
  return (
    <>
      {host ? (
        <Dropdown value={current.id} ariaLabel="Пресет бота" onChange={(preset) => send({ t: 'botPreset', seat: seat.id, preset })}
          options={options.map((p) => ({ value: p.id, label: p.name, title: p.description }))} />
      ) : <span className="small preset-name" title={current.description} data-tip={current.description}>{current.name}</span>}
    </>
  );
}

// Выпадающий список: раскрывается прямо под полем (а не системным окном, как <select> на телефоне).
export function Dropdown<T extends string | number>({ value, options, onChange, ariaLabel }: {
  value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <span className={`dropdown ${open ? 'open' : ''}`} ref={box}>
      <button type="button" className="dropdown-btn" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen(!open); }}>{current?.label}</button>
      {open && (
        <ul className="dropdown-list" role="listbox">
          {options.map((o) => (
            <li key={String(o.value)} role="option" aria-selected={o.value === value} className={o.value === value ? 'selected' : ''} title={o.title} data-tip={o.title}
              onClick={(e) => { e.preventDefault(); setOpen(false); if (o.value !== value) onChange(o.value); }}>{o.label}</li>
          ))}
        </ul>
      )}
    </span>
  );
}
