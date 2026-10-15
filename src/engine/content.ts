// Справочные данные правил: адреса, Ростки, Пристрастия. Меняйте здесь, когда меняются правила.
import type { AddressId, Genre, GroupActionId, PassionId, SproutBonusId } from './types';
import cardsJson from '../data/cards.json';
import type { Card } from './types';

export const CARDS = cardsJson as Card[];

export const GENRE_NAMES: Record<Genre, string> = {
  prose: 'Проза',
  scifi: 'Фантастика',
  poetry: 'Поэзия',
  foreign: 'Иностранная',
  testimony: 'Свидетельства',
  drama: 'Драматургия',
  album: 'Альбом',
  irony: 'Ирония',
};

// Настраиваемые числа правил — всё, что может поменяться при балансировке.
export const RULES = {
  rounds: 5,
  startTalons: 5,
  startWorkers: 5,
  maxWorkers: 7,
  startCapacity: 5,
  maxCapacity: 10,
  maxCache: 5,
  startCensorship: 3,
  censorshipTokens: [3, 4, 5, 6, 7],
  displaySize: 4,
  raspredelitelSize: 2,
  hireCost: 6,
  restoreCost: 0, // в таблице действий Группы — «бесплатно» (см. docs/questions.md)
  tolkuchkaBuy: 2, // за книгу
  tolkuchkaSellBanned: 2, // книга с опальным жанром
  tolkuchkaSellFree: 1, // книга без опального жанра
  razvalPrices: [2, 2, 1, 1],
  zavozIncome: 2,
  baraholkaPrice: 1,
  safehousePrice: 3,
  sideJobIncome: 3,
  propagandaPoints: -5,
  evidencePoints: 5,
  glasnostStep: 3, // до какой ступени должны дорасти Ростки
  glasnostAllSprouts: true, // все выложенные Ростки (true) или хотя бы один (false)
};

// Лимиты Единомышленников на адресе для 2 / 3 / 4 игроков. Infinity — без лимита.
type Limits = [number, number, number];
const INF = Infinity;

export interface AddressInfo {
  id: AddressId;
  name: string;
  limits: Limits;
  safehouse?: boolean;
  hint: string;
}

export const ADDRESSES: Record<AddressId, AddressInfo> = {
  gostorg: { id: 'gostorg', name: 'Госкниготорг', limits: [2, 3, 4], hint: '−1т за пару: Нагрузка + Непечатное, любое число пар' },
  tolkuchka: { id: 'tolkuchka', name: 'Толкучка', limits: [2, 3, 4], hint: 'Купить: −2т за книгу. Продать: +2т за книгу опального жанра, +1т за прочие' },
  redCorner: { id: 'redCorner', name: 'Красный уголок', limits: [INF, INF, INF], hint: 'Очередь хода на следующую Пятилетку; сдать до 1 Непечатной и до 1 Нагрузки, +1т за книгу' },
  razval: { id: 'razval', name: 'Развал', limits: [2, 3, 4], hint: 'Купить 1 книгу: −2/−2/−1/−1т по свежести' },
  zavoz: { id: 'zavoz', name: 'Завоз', limits: [1, 1, 2], hint: '+2т, Развал полностью обновляется' },
  baraholka: { id: 'baraholka', name: 'Барахолка', limits: [4, 4, 4], hint: 'Тайно посмотреть 1 из 4 закрытых книг и купить за 1т' },
  podpiska: { id: 'podpiska', name: 'Подписка', limits: [1, 1, 2], hint: 'Заказать жанр: −1т за каждую Пятилетку доставки' },
  sprouts: { id: 'sprouts', name: 'Ростки Гласности', limits: [3, 4, 5], hint: 'Закрыть любое число ступеней Ростков' },
  samizdat: { id: 'samizdat', name: 'Самиздат', limits: [2, 2, 3], hint: 'Издать книгу: +1т/значок' },
  tamizdat: { id: 'tamizdat', name: 'Тамиздат', limits: [1, 1, 2], hint: 'Издать книгу: +1т и +1 очко/значок' },
  knigoobmen: { id: 'knigoobmen', name: 'Книгообмен', limits: [1, 1, 1], safehouse: true, hint: 'Отдать 1 жанровую книгу — взять 1 с витрины' },
  kvartirnik: { id: 'kvartirnik', name: 'Квартирник', limits: [1, 1, 1], safehouse: true, hint: 'Обмен книгами с другим игроком по согласию' },
  raspredelitel: { id: 'raspredelitel', name: 'Распределитель', limits: [1, 1, 1], safehouse: true, hint: 'Купить 1 выдающуюся книгу за 3т' },
  nasledniki: { id: 'nasledniki', name: 'Наследники', limits: [1, 1, 1], safehouse: true, hint: '−3т: тайно взять 2 книги из сброса Непечатных' },
  posrednichestvo: { id: 'posrednichestvo', name: 'Посредничество авторам', limits: [1, 1, 1], safehouse: true, hint: '−3т: тайно вытянуть 3, оставить 1–2, затем 1 действие Группы' },
  spisanie: { id: 'spisanie', name: 'Библиотечное списание', limits: [1, 1, 1], safehouse: true, hint: '−3т: взять 3 книги сверху стопки Непечатных' },
};

export const PERMANENT_ADDRESSES: AddressId[] = [
  'gostorg', 'tolkuchka', 'redCorner', 'razval', 'zavoz', 'baraholka', 'podpiska', 'sprouts', 'samizdat', 'tamizdat',
];
export const SAFEHOUSES: AddressId[] = ['knigoobmen', 'kvartirnik', 'raspredelitel', 'nasledniki', 'posrednichestvo', 'spisanie'];
// Адреса, которые начинают партию заполненными (если выложены).
export const STARTS_FILLED: AddressId[] = ['knigoobmen', 'raspredelitel'];

export function limitFor(address: AddressId, playerCount: number): number {
  const l = ADDRESSES[address].limits;
  return l[Math.min(Math.max(playerCount, 2), 4) - 2];
}

export const GROUP_ACTIONS: Record<GroupActionId, { name: string; hint: string; fullOnly?: boolean }> = {
  expandWarehouse: { name: 'Увеличение склада', hint: '+1 место на складе (до 10)' },
  expandCache: { name: 'Закладка Тайника', hint: '1 место склада становится потайным (до 5)' },
  copyText: { name: 'Тиражирование текста', hint: 'Взять любую открытую книгу с адреса или верхнюю из стопки Непечатных' },
  rescue: { name: 'Вызволение из бед', hint: 'Вернуть Единомышленников из Конторы', fullOnly: true },
  restore: { name: 'Возвращение смыслов', hint: '+1 значок жанровой книге или 3 значка возвращаемой Нагрузке' },
  hire: { name: 'Расширение сети', hint: '6т: +1 Единомышленник, сразу доступен (до 7)' },
};

export const SPROUT_BONUS_NAMES: Record<SproutBonusId, string> = {
  ...Object.fromEntries(Object.entries(GROUP_ACTIONS).map(([k, v]) => [k, v.name])),
  sideJob: 'Приработок (+3т)',
  underCounter: 'Из-под полы',
} as Record<SproutBonusId, string>;

// Ступень Ростка: сколько значков основного жанра и какой жанр поддержки.
export interface SproutStep { main: number; support?: Genre }
export interface SproutInfo { id: string; name: string; main: Genre; steps: SproutStep[]; bonuses: [SproutBonusId, SproutBonusId] }

const s = (id: string, name: string, main: Genre, sup: [Genre, Genre, Genre], bonuses: [SproutBonusId, SproutBonusId]): SproutInfo => ({
  id, name, main, bonuses,
  steps: [{ main: 1 }, { main: 1, support: sup[0] }, { main: 1, support: sup[1] }, { main: 2, support: sup[2] }],
});

export const SPROUTS: SproutInfo[] = [
  s('ksp', 'Клуб Самодеятельной Песни', 'poetry', ['testimony', 'scifi', 'irony'], ['copyText', 'hire']),
  s('memorial', 'Мемориал', 'testimony', ['album', 'prose', 'foreign'], ['restore', 'rescue']),
  s('slovesniki', 'Словесники', 'prose', ['drama', 'poetry', 'testimony'], ['restore', 'expandWarehouse']),
  s('translators', 'Семинары переводчиков', 'foreign', ['scifi', 'irony', 'prose'], ['rescue', 'underCounter']),
  s('klf', 'Клуб Любителей Фантастики', 'scifi', ['irony', 'foreign', 'album'], ['copyText', 'underCounter']),
  s('kvn', 'Клуб Весёлых и Находчивых', 'irony', ['poetry', 'drama', 'scifi'], ['hire', 'sideJob']),
  s('restorers', 'Реставраторы', 'album', ['prose', 'testimony', 'drama'], ['expandWarehouse', 'expandCache']),
  s('studios', 'Театры-студии', 'drama', ['foreign', 'album', 'poetry'], ['expandCache', 'sideJob']),
];

// Награды за закрытие ступеней 1..4.
export const STEP_REWARDS = [
  { talons: 2, points: 0 },
  { talons: 0, points: 2 },
  { talons: 0, points: 4 },
  { talons: 0, points: 6 },
];
export const FIRST_FEED_POINTS = 2;

export interface PassionInfo { id: PassionId; name: string; hint: string; genres?: [Genre, Genre]; special?: boolean }

export const PASSIONS: Record<PassionId, PassionInfo> = {
  keeper_golden: { id: 'keeper_golden', name: 'Золотая полка', genres: ['prose', 'poetry'], hint: '2 очка за значок Прозы и Поэзии' },
  keeper_silver: { id: 'keeper_silver', name: 'Серебряный век', genres: ['poetry', 'album'], hint: '2 очка за значок Поэзии и Альбома' },
  keeper_antiquary: { id: 'keeper_antiquary', name: 'Антиквар', genres: ['album', 'testimony'], hint: '2 очка за значок Альбома и Свидетельств' },
  keeper_memoirist: { id: 'keeper_memoirist', name: 'Мемуарист', genres: ['testimony', 'foreign'], hint: '2 очка за значок Свидетельств и Иностранной' },
  keeper_polyglot: { id: 'keeper_polyglot', name: 'Полиглот', genres: ['foreign', 'scifi'], hint: '2 очка за значок Иностранной и Фантастики' },
  keeper_dreamer: { id: 'keeper_dreamer', name: 'Мечтатель', genres: ['scifi', 'irony'], hint: '2 очка за значок Фантастики и Иронии' },
  keeper_skit: { id: 'keeper_skit', name: 'Капустник', genres: ['irony', 'drama'], hint: '2 очка за значок Иронии и Драматургии' },
  keeper_theatre: { id: 'keeper_theatre', name: 'Театрал', genres: ['drama', 'prose'], hint: '2 очка за значок Драматургии и Прозы' },
  erudite: { id: 'erudite', name: 'Эрудит', special: true, hint: '2 очка за значок, но в каждом жанре максимум 1 книга' },
  monogamist: { id: 'monogamist', name: 'Однолюб', special: true, hint: '2 очка за значок одного жанра (лучшего на момент подсчёта)' },
  innovator: { id: 'innovator', name: 'Новатор', special: true, hint: '2 очка за значок на двужанровых книгах' },
  curator: { id: 'curator', name: 'Куратор', special: true, hint: 'Агент госбезопасности: побеждает, если Гласность не наступит' },
};

export const KEEPERS = Object.values(PASSIONS).filter((p) => !p.special).map((p) => p.id);
export const SPECIALS: PassionId[] = ['erudite', 'monogamist', 'innovator', 'curator'];
