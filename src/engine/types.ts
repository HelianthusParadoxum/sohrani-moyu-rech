// Типы состояния игры. Состояние — простой JSON: его можно сохранять, пересылать и воспроизводить.

export const GENRES = ['prose', 'scifi', 'poetry', 'foreign', 'testimony', 'drama', 'album', 'irony'] as const;
export type Genre = (typeof GENRES)[number];

export type CardKind =
  | 'genre' // жанровая книга, 1–2 значка
  | 'propaganda' // Пропаганда (ЧНЛ): всегда опальна, −5 очков
  | 'evidence' // Улика в стопке Непечатных: всегда опальна, +5 очков
  | 'load' // Нагрузка, 0 значков
  | 'loadReturnable' // Нагрузка проглоченного автора: после Возвращения смыслов — 3 значка жанра
  | 'loadEvidence'; // Улика в стопке Нагрузки

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  author: string;
  icons: Genre[];
  genre?: Genre; // для loadReturnable
  returned?: string; // название возвращённого произведения
}

export type Mode = 'beginner' | 'full';

export type AddressId =
  | 'gostorg' // Госкниготорг
  | 'tolkuchka' // Толкучка
  | 'redCorner' // Красный уголок
  | 'razval' // Развал
  | 'zavoz' // Завоз
  | 'baraholka' // Барахолка
  | 'podpiska' // Подписка
  | 'sprouts' // Ростки Гласности
  | 'samizdat' // Самиздат
  | 'tamizdat' // Тамиздат
  // Явочные адреса
  | 'knigoobmen'
  | 'kvartirnik'
  | 'raspredelitel'
  | 'nasledniki'
  | 'posrednichestvo'
  | 'spisanie';

export type GroupActionId =
  | 'expandWarehouse' // Увеличение склада
  | 'expandCache' // Закладка Тайника
  | 'copyText' // Тиражирование текста
  | 'rescue' // Вызволение из бед (Контора — только полный режим)
  | 'restore' // Возвращение смыслов
  | 'hire'; // Расширение сети

export type SproutBonusId = GroupActionId | 'sideJob' | 'underCounter';

export type PassionId =
  | 'keeper_golden' | 'keeper_silver' | 'keeper_antiquary' | 'keeper_memoirist'
  | 'keeper_polyglot' | 'keeper_dreamer' | 'keeper_skit' | 'keeper_theatre'
  | 'erudite' | 'monogamist' | 'innovator' | 'curator';

export interface WarehouseSlot {
  card: string;
  hidden: boolean; // лежит в Тайнике (не видна другим, облава не трогает)
}

export interface PlayerState {
  id: string;
  name: string;
  workers: number; // всего Единомышленников (5..7)
  available: number; // ещё не действовали в эту Пятилетку
  bonusGroupTurns: number; // доп. действия Группы с явочных адресов (Книгообмен, Квартирник)
  talons: number;
  points: number; // очки Гласности, набранные по ходу игры
  capacity: number; // мест на складе (5..10)
  cache: number; // потайных мест (0..5)
  warehouse: WarehouseSlot[];
  published: string[]; // изданное (Самиздат, Тамиздат) — учитывается в Пристрастии
  tamizdat: string[]; // подмножество published, изданное через Тамиздат
  spetskhran: string[]; // изъятое облавой
  passion: PassionId | null;
  passionOptions: PassionId[]; // две карты на выбор в начале партии
  groupUsed: GroupActionId[]; // действия Группы, сделанные в эту Пятилетку
  visitedRedCorner: boolean;
  sproutsFed: string[]; // id Ростков, у которых игрок закрыл хоть одну ступень
  subscriptions: { genre: Genre; rounds: number }[];
}

export interface Sprout {
  id: string;
  progress: number; // закрыто ступеней: 0..4
}

export type Pending =
  | { kind: 'baraholkaLook'; player: string; slot: number; card: string }
  | { kind: 'kvartirnikReply'; player: string; from: string; give: string; want: string }
  | { kind: 'naslednikiPick'; player: string; cards: string[] }
  | { kind: 'posrednichestvoKeep'; player: string; cards: string[] }
  | { kind: 'posrednichestvoGroup'; player: string }
  | { kind: 'sproutBonus'; player: string; sprout: string; options: SproutBonusId[] };

export type Phase = 'passion' | 'orders' | 'gathering' | 'hiding' | 'end';

export interface LogEntry {
  round: number;
  text: string;
  // Если задано — запись видят только эти игроки (тайная информация).
  only?: string[];
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  mode: Mode;
  cards: Record<string, Card>;
  restored: Record<string, true>; // карты с накладкой Возвращения смыслов
  round: number; // 1..5
  phase: Phase;
  censorship: number; // сколько жанров в опале
  censorshipPool: number[]; // жетоны цензуры в запасе
  banned: Genre[]; // опальные жанры этой Пятилетки
  order: string[]; // порядок хода
  turn: number; // индекс в order
  nextOrder: string[]; // очередь Красного уголка на следующую Пятилетку
  players: PlayerState[];
  deck: string[]; // стопка Непечатных (верх — конец массива)
  discard: string[]; // сброс Непечатных
  loadDeck: string[];
  loadDiscard: string[];
  tolkuchka: string[]; // [0] — самая давняя
  razval: (string | null)[]; // [0] — самая свежая
  baraholka: (string | null)[];
  knigoobmen: string[];
  raspredelitel: string[];
  safehouses: AddressId[]; // выложенные явочные адреса
  safehouseDeck: AddressId[];
  occupancy: Partial<Record<AddressId, string[]>>;
  sprouts: Sprout[];
  pending: Pending[];
  ready: string[]; // кто подтвердил одновременную фазу
  result?: GameResult;
  log: LogEntry[];
}

export interface ScoreLine {
  player: string;
  during: number;
  passion: number;
  sprouts: number;
  propaganda: number;
  evidence: number;
  total: number;
  icons: number;
}

export interface GameResult {
  glasnost: boolean;
  winners: string[];
  scores: ScoreLine[];
  note: string;
}

// ---------- Действия игроков ----------

export type TolkuchkaOp = { op: 'buy'; card: string } | { op: 'sell'; card: string };

export type PlaceAction =
  | { address: 'gostorg'; pairs: number }
  | { address: 'tolkuchka'; ops: TolkuchkaOp[] }
  | { address: 'redCorner'; recycle: string[] }
  | { address: 'razval'; slot: number }
  | { address: 'zavoz' }
  | { address: 'baraholka'; slot: number }
  | { address: 'podpiska'; genre: Genre; talons: number }
  | { address: 'sprouts'; feeds: { sprout: string; books: string[] }[] }
  | { address: 'samizdat'; card: string }
  | { address: 'tamizdat'; card: string }
  | { address: 'knigoobmen'; give: string; take: string }
  | { address: 'kvartirnik'; to: string; give: string; want: string }
  | { address: 'raspredelitel'; card: string }
  | { address: 'nasledniki' }
  | { address: 'posrednichestvo' }
  | { address: 'spisanie' };

export type GroupAction =
  | { action: 'expandWarehouse' }
  | { action: 'expandCache' }
  | { action: 'copyText'; card: string | 'deck' }
  | { action: 'rescue' }
  | { action: 'restore'; card: string }
  | { action: 'hire' };

export type Action =
  | { type: 'choosePassion'; passion: PassionId }
  | { type: 'place'; place: PlaceAction }
  | { type: 'group'; group: GroupAction }
  | { type: 'pass' } // отказаться от бонусного действия Группы
  | { type: 'baraholkaBuy'; buy: boolean }
  | { type: 'kvartirnikReply'; accept: boolean }
  | { type: 'naslednikiPick'; cards: string[] }
  | { type: 'posrednichestvoKeep'; keep: string[] }
  | { type: 'sproutBonus'; bonus: SproutBonusId; group?: GroupAction }
  | { type: 'gathering'; show: string[] }
  | { type: 'hiding'; hidden: string[] };
