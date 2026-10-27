// Общие элементы интерфейса: карты книг, окна, жанры.
import type React from 'react';
import { createContext, useContext, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ADDRESS_ICONS, GENRE_NAMES, GROUP_ICONS, GENRE_SHORT, PASSIONS } from '../engine/content';
import { BOT_PRESETS, presetById } from '../engine/bot-presets';
import type { AddressId, Genre, GroupActionId } from '../engine/types';
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
  [/(?<!Увеличени[а-яё]* )склад(?:а|е|у)?(?![а-яё])/g, '📚'], // «Увеличение склада» — название действия Группы
  [/(?<!Закладк[а-яё]* )Тайник[а-яё]*/g, '🔒'], // «Закладка Тайника» — название действия Группы
  [/[Сс]вяз(?:ь|и|ей)(?: в Клубе)?(?![а-яё])/g, '🤝'],
  [/[Ее]диномышленник[а-яё]*/g, '👤'],
  [/Нагрузк[а-яё]*/g, '📕'],
  [/Непечатн[а-яё]*/g, '📃'],
];
// Только Единомышленники — значком 👤 (подсказки-инструкции, где прочие слова оставляем словами).
export const workerIcon = (text: string) => text.replace(/[Ее]диномышленник[а-яё]*/g, '👤');

// Упоминания адресов (во всех падежах) — со значком адреса перед названием. Названия Ростков в кавычках
// («Клуб Самодеятельной Песни») не трогаем; уже стоящий значок не повторяем.
const ADDRESS_WORDS: [AddressId, string][] = [
  ['club', 'Клуб(?:а|е|у|ом)?(?: книголюбов)?(?![а-яё])'], ['kontora', 'Контор[а-яё]*'], ['sprouts', 'Росток|Ростк[а-яё]*'],
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
  ['expandWarehouse', 'Увеличени[а-яё]* склада'], ['expandCache', 'Закладк[а-яё]* Тайника'],
  ['copyText', 'Тиражировани[а-яё]*(?: текста)?'], ['rescue', 'Вызволени[а-яё]*(?: из бед)?'],
  ['restore', 'Возвращени[а-яё]* смыслов'], ['hire', 'Расширени[а-яё]* сети'],
];
const NAME_RES: [RegExp, string][] = [
  ...ADDRESS_WORDS.map(([id, w]) => [w, ADDRESS_ICONS[id]] as const),
  ...GROUP_WORDS.map(([id, w]) => [w, GROUP_ICONS[id]] as const),
].map(([w, icon]) => [new RegExp(`(?<!\\p{Extended_Pictographic}\\uFE0F?\\s)(?<![«А-Яа-яЁё])(${w})`, 'gu'), `${icon} $1`]);
// Адреса и действия Группы — со значками (заголовки окон, пояснения).
export function addressIcons(text: string): string {
  return NAME_RES.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function iconize(text: string): string {
  return addressIcons(ICONS.reduce((t, [re, to]) => t.replace(re, to), text));
}

export const PLAYER_COLORS = ['#b03a2e', '#1f618d', '#1e8449', '#7d3c98', '#b9770e'];

export { iconsOf, isLoad } from '../engine/util';

export function fromLoadDeck(v: PlayerView, id: string) {
  return ['load', 'loadReturnable', 'loadEvidence', 'loadPropaganda'].includes(v.cards[id].kind);
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
  load: 'Нагрузка', loadReturnable: 'Нагрузка', loadEvidence: 'Нагрузка', loadPropaganda: 'Нагрузка',
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
  const flex = flexGenres(v, id);
  const label = c.kind === 'loadReturnable' && restored ? null : c.kind === 'loadEvidence' && restored ? null : (c.kind === 'propaganda' || c.kind === 'loadPropaganda') && restored ? 'Разоблачение' : KIND_LABEL[c.kind];
  // Значки вида: ЧНЛ (и у Нагрузки-ЧНЛ), УЛ — у Улик (и Нагрузки-улики после Возвращения смыслов).
  const kindChip = (c.kind === 'propaganda' || c.kind === 'loadPropaganda') && !restored ? 'chnl' as const
    : c.kind === 'evidence' || (c.kind === 'loadEvidence' && restored) ? 'ul' as const : null;
  const t = c.kind === 'loadReturnable' && restored ? c.returned! : c.title;
  return (
    <button
      type="button"
      className={`book k-${c.kind === 'loadEvidence' && !restored ? 'load' : (c.kind === 'propaganda' || c.kind === 'loadPropaganda') && restored ? 'exposed' : c.kind} ${banned ? 'is-banned' : ''} ${selected ? 'selected' : ''} ${hidden ? 'in-cache' : ''} ${small ? 'small' : ''} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={`${t} — ${c.author}${c.kind === 'loadPropaganda' && !restored ? '. Нагрузка-ЧНЛ: это ЧНЛ (опальна, −5 очков, у Куратора срезает Ростки), но сдаётся в Красный уголок как Нагрузка (+2т); Тайник не прикрывает' : ''}`}
    >
      <div className="book-icons">
        {(flex ? icons.slice(0, -1) : icons).map((g, i) => <GenreChip key={i} g={g} banned={v.banned.includes(g)} favored={favoredGenres(v).includes(g)} />)}
        {c.wild && restored && <span className={`chip wild ${v.banned.length ? 'banned' : ''}`} title="Второй значок любого жанра (Возвращение смыслов)">ЛЮБОЙ</span>}
        {c.wild && <span className={`chip wild ${v.banned.length ? 'banned' : ''}`} title="Значок любого жанра: в каждом подсчёте — того, что выгоднее (Ростки, Пристрастия, Клуб). Жанровых свойств нет; опальна, если в опале хоть один жанр">ЛЮБОЙ</span>}
        {flex && (
          <span className="chip flex" title={`Значок возвращения: ${flex.map((g) => GENRE_NAMES[g]).join(' или ')}`}>
            {flex.map((g) => GENRE_SHORT[g]).join('/')}
          </span>
        )}
        {c.kind === 'loadEvidence' && !restored && (
          <span className="ghost" title="После Возвращения смыслов станет Уликой: опальная, +5 очков в конце">→ улика</span>
        )}
        {c.kind === 'loadReturnable' && !restored && c.genre && (
          <span className="ghost" title={`После Возвращения смыслов: «${c.returned}», 3 значка ${GENRE_NAMES[c.genre]}`}>
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

export function SpeedSelect({ room, send }: { room: RoomInfo; send: (m: ClientMessage) => void }) {
  return (
    <label className="row">Скорость ботов:
      <select value={room.botDelay} onChange={(e) => send({ t: 'botDelay', ms: Number(e.target.value) })}>
        <option value={1500}>медленно</option>
        <option value={700}>обычно</option>
        <option value={200}>быстро</option>
        <option value={30}>мгновенно</option>
      </select>
    </label>
  );
}


// Пресет бота: хост выбирает, остальные видят название. Под строкой — описание (подсказки при наведении на телефоне не видны).
export function PresetSelect({ seat, host, send }: { seat: RoomInfo['seats'][number]; host: boolean; send: (m: ClientMessage) => void }) {
  const current = presetById(seat.preset);
  return (
    <>
      {host ? (
        <select value={current.id} aria-label="Пресет бота" onChange={(e) => send({ t: 'botPreset', seat: seat.id, preset: e.target.value })}>
          {BOT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : <span className="small">{current.name}</span>}
      <span className="preset-desc muted small">{current.description}</span>
    </>
  );
}
