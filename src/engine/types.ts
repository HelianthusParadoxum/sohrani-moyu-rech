// Типы состояния игры. Состояние — простой JSON: его можно сохранять, пересылать и воспроизводить.

export const GENRES = ['prose', 'scifi', 'poetry', 'foreign', 'testimony', 'drama', 'album', 'irony'] as const;
export type Genre = (typeof GENRES)[number];

export type CardKind =
  | 'genre' // жанровая книга, 1–2 значка
  | 'propaganda' // Пропаганда (ЧНЛ): всегда опальна, −5 очков
  | 'evidence' // Улика в стопке Непечатных: всегда опальна, +5 очков
  | 'load' // Нагрузка, 0 значков
  | 'loadReturnable' // Нагрузка проглоченного автора: после Возвращения смыслов — 3 значка жанра
  | 'loadEvidence' // Улика в стопке Нагрузки
  | 'loadPropaganda'; // Нагрузка-пропаганда (ПСС Ленина): у книжников — Нагрузка, у Куратора — Пропаганда (срез в конце)

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
  | 'glavlit' // Главлит
  // Явочные адреса
  | 'knigoobmen'
  | 'kvartirnik'
  | 'raspredelitel'
  | 'nasledniki'
  | 'posrednichestvo'
  | 'spisanie'
  | 'agitpunkt'
  // Полный режим
  | 'club' // Клуб книголюбов
  | 'kontora'; // Контора

export type GroupActionId =
  | 'expandWarehouse' // Увеличение склада
  | 'expandCache' // Закладка Тайника
  | 'copyText' // Тиражирование текста
  | 'rescue' // Вызволение из бед (Контора — только полный режим)
  | 'restore' // Возвращение смыслов
  | 'hire'; // Расширение сети

export type PatronId =
  | 'binder' | 'carpenter' | 'correspondent' | 'postgrad' | 'professor' | 'housekeeper' | 'spotter' | 'veteran'
  | 'buyer' | 'fartsovshchik' | 'librarian' | 'tsekhovik' | 'partorg' | 'zavmag' | 'apprentice' | 'druzhinnik'
  | 'chairman' | 'zavkhoz' | 'buzoter' | 'broker' | 'blatnoy' | 'glavlit' | 'lieutenant' | 'cataloguer'
  | 'doctor' | 'komsorg' | 'typist' | 'editor' | 'labtech' | 'psychiatrist' | 'nesun' | 'geologist';

export interface PatronState {
  id: PatronId;
  genre: Genre; // жанровый слот Клуба
  connections: string[]; // игроки, у которых есть связь с Завсегдатаем
  turned: boolean; // занят на Пятилетку: связь в эту Пятилетку уже завязана
  since?: Record<string, number>; // в какую Пятилетку игрок завязал связь
  removed: boolean; // удалён Профилактикой Конторы
}

export type PointSource =
  | 'gathering' | 'drama' | 'sprouts' | 'firstFeed' | 'tamizdat' | 'testimony' | 'foreign' | 'editor' | 'postgrad' | 'prose' | 'komsorg' | 'rescue';

export type SproutBonusId = GroupActionId | 'sideJob' | 'underCounter';

export type PassionId =
  | 'keeper_golden' | 'keeper_silver' | 'keeper_antiquary' | 'keeper_memoirist'
  | 'keeper_polyglot' | 'keeper_dreamer' | 'keeper_skit' | 'keeper_theatre'
  | 'erudite' | 'monogamist' | 'innovator' | 'curator' | 'historian';

export interface WarehouseSlot {
  card: string;
  hidden: boolean; // лежит в Тайнике (не видна другим, облава не трогает)
  memorized?: boolean; // «Заучить»: сборник поэзии сверх склада и Тайника, виден всем
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
  passion: PassionId | null;
  passionOptions: PassionId[]; // две карты на выбор в начале партии
  groupUsed: GroupActionId[]; // действия Группы, сделанные в эту Пятилетку
  visitedRedCorner: boolean;
  sproutsFed: string[]; // id Ростков, у которых игрок закрыл хоть одну ступень
  subscriptions: { genre: Genre; rounds: number }[];
  held: number; // Единомышленников удерживает Контора
  buzoterUsed: boolean;
  actions: { target: string; n: number }[]; // действия Единомышленников в эту Пятилетку: адрес или «group:…», порядковый номер
  pointsBy: Partial<Record<PointSource, number>>; // откуда взялись очки, набранные по ходу игры
  patronBonus: { capacity: number; cache: number }; // прибавки от Управдома и Столяра
  // Что все видели (для подозрений ботов): сколько Пропаганды игрок открыто взял со стола и сколько сдал в Красный уголок.
  propagandaTaken?: number;
  propagandaExposed?: number; // сколько Пропаганды разоблачил (Возвращение смыслов)
  denounces?: number; // сколько раз ходил в Контору с доносом (видно всем)
  propagandaDumped?: number;
  fedSteps?: number[]; // какие ступени Ростков игрок закрывал (номер ступени после питания)
  redEager?: number; // сколько раз рано (1–2-м действием) и первым в очереди пришёл в Красный уголок — не в последней Пятилетке
  redEmpty?: number; // ...из них — ничего не сдав, хотя было что
  cacheUnshown?: number; // сколько раз книги из Тайника не показаны на Посиделках (видно всем: число книг в Тайнике и показанные)
}

export interface Sprout {
  id: string;
  progress: number; // закрыто ступеней: 0..4
}

export type Pending =
  | { kind: 'baraholkaLook'; player: string; seen: { slot: number; card: string }[]; bought?: number } // seen — просмотренные и ещё не купленные
  | { kind: 'kvartirnikReply'; player: string; from: string; give: string; want: string }
  | { kind: 'naslednikiPick'; player: string; cards: string[] }
  | { kind: 'posrednichestvoKeep'; player: string; cards: string[] }
  | { kind: 'spisanieKeep'; player: string; cards: string[] } // Библиотечное списание: что оставить
  | { kind: 'posrednichestvoGroup'; player: string }
  | { kind: 'sproutBonus'; player: string; sprout: string; options: SproutBonusId[] }
  | { kind: 'kontoraWarning'; player: string; from: string }
  | { kind: 'kontoraDecide'; player: string }
  | { kind: 'kontoraHandout'; player: string; cards: string[]; seize?: { player: string; card: string; by?: string } } // seize — Сигнал и Изъятие после выбора книги
  | { kind: 'extraGroup'; player: string } // Подмастерье
  | { kind: 'freeConnection'; player: string } // Председатель
  | { kind: 'lieutenantPick'; player: string; cards: string[] } // Лейтенант: книги, изъятые облавой с адресов
  | { kind: 'discardExcess'; player: string; count: number }
  | { kind: 'glavlitSwap'; player: string; roundStart?: boolean }; // Главлитовец переносит опалу с жанра на жанр // склад уменьшился — игрок выбирает, что отдать

// setupCache — перед первым действием партии все раскладывают стартовые книги по Тайникам (чужие стартовые книги до этого не видны).
export type Phase = 'passion' | 'setupCache' | 'orders' | 'gathering' | 'ambush' | 'hiding' | 'end';

export interface LogEntry {
  round: number;
  text: string;
  // Если задано — запись видят только эти игроки (тайная информация).
  only?: string[];
  act?: { player: string; n: number }; // запись о поручении игрока: его номер в Пятилетке (кружок в журнале)
  who?: string; // чья это запись (кружок цвета игрока в журнале)
  after?: boolean; // следствие: в журнале — после строки самого действия (служебное, снимается сразу)
  em?: boolean; // пояснение — курсивом
  strong?: boolean; // выделить жирным (начало Пятилетки, Пристрастие Куратора)
  club?: { player: string; round: number }; // связь в Клубе: жетон «П<Пятилетка>», как у Завсегдатая
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
  baraholkaSeen?: Record<string, number[]>; // какие ячейки Барахолки игрок уже посмотрел (тайно; пока там та же книга)
  knigoobmen: string[];
  raspredelitel: string[];
  agitpunkt?: string[]; // Агитпункт: открытая витрина Нагрузки
  safehouses: AddressId[]; // выложенные явочные адреса
  safehouseDeck: AddressId[];
  occupancy: Partial<Record<AddressId, string[]>>;
  sprouts: Sprout[];
  patrons: PatronState[];
  spetskhran: string[]; // Спецхран Конторы — общий, лежит взакрытую
  spetskhranSeen?: Record<string, string[]>; // какие книги Спецхрана игрок знает (изъятые при всех или виденные при Выдаче на руки)
  solo?: boolean; // «Несистемный»: одиночная игра
  reserve?: boolean; // «Заповедник»: полный режим без Конторы и Куратора
  sproutRound?: Record<string, string[]>; // кто в эту Пятилетку закрывал ступени каждого Ростка (места Ростка)
  sproutRoundN?: Record<string, number[]>; // ...и каким по счёту поручением игрока (номер на кружке)
  ironyDue?: Record<string, number>; // Ирония «пущена в народ»: сколько Талонов начислить в конце действия
  shownAtGathering?: Record<string, string[]>; // что каждый показал на Посиделках этой Пятилетки (опальное и Улики)
  curatorRevealed?: string; // Куратор раскрылся (Засада) — все знают, кто он
  forcedCurator?: string; // для тестов: этот игрок — Куратор
  curatorStyleOverride?: 'open' | 'ambush' | 'boa'; // для тестов: стратегия Куратора-бота
  curatorPossible?: boolean; // Куратор есть в колоде Пристрастий (это знают все)
  // Куратор-бот («Удав», «Хищник») сбросил маску: Пятилетка, его ход в ней и причина (для журнала в конце партии).
  curatorUnmask?: { round: number; act: number; why: 'propaganda' | 'exposed' | 'round' | 'ambush' };
  holdTurn?: boolean; // действие не завершило ход (отказ от Конторы)
  clubGiftBy?: string; // кто уже отдал книгу в Клуб в этот ход (Клуб как свободное действие)
  // Последняя покупка в этом ходу на адресе, где можно тиражировать: после неё можно «дотиражировать» книгу оттуда же.
  lastBuy?: { player: string; address: CopyTextAddress; exclude: string[] };
  turnDone?: string; // игрок сделал действие и может только свободные действия, пока сам не закончит ход
  freeHold?: boolean; // идёт свободное действие: когда его решения закончатся, ход не передаётся
  pending: Pending[];
  ready: string[]; // кто подтвердил одновременную фазу
  result?: GameResult;
  log: LogEntry[];
}

export interface ScoreLine {
  player: string;
  during: number;
  passion: number;
  propaganda: number;
  evidence: number;
  connections: number;
  talonPoints: number; // очки за оставшиеся Талоны
  duringBy: Partial<Record<PointSource, number>>;
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
  | { address: 'gostorg'; pairs: number; mix?: ('load' | 'unprinted')[] } // mix — Завмаг
  | { address: 'tolkuchka'; ops: TolkuchkaOp[] }
  | { address: 'redCorner'; recycle: string[] }
  | { address: 'razval'; slot: number; slots?: number[] } // slots — Ветеран покупает несколько
  | { address: 'zavoz' }
  | { address: 'baraholka'; slots: number[] } // какие закрытые книги посмотреть
  | { address: 'podpiska'; genre: Genre; talons: number }
  | { address: 'sprouts'; feeds: { sprout: string; books: string[] }[] }
  | { address: 'samizdat'; card: string }
  | { address: 'tamizdat'; card: string }
  | { address: 'glavlit'; cards: string[]; draws: ('unprinted' | 'load')[] } // draws — из какой стопки брать взамен каждой
  | { address: 'knigoobmen'; give: string; take: string }
  | { address: 'kvartirnik'; to: string; give: string; want: string }
  | { address: 'raspredelitel'; card: string; cards?: string[] } // cards — Ветеран покупает несколько
  | { address: 'agitpunkt'; card: string; cards?: string[] } // cards — Ветеран берёт несколько
  | { address: 'nasledniki' }
  | { address: 'posrednichestvo' }
  | { address: 'spisanie' }
  | { address: 'club'; gifts: ClubGift[] }
  | { address: 'kontora' };

// Покупка в рамках Тиражирования текста.
export type CopyTextAddress = 'razval' | 'tolkuchka' | 'raspredelitel' | 'knigoobmen';
export type CopyTextBuy = Extract<PlaceAction, { address: CopyTextAddress }>;

export interface ClubGift { patron: PatronId; card: string }

export interface KontoraChoice {
  petition?: string[]; // Ходатайство: чьих Единомышленников вернуть (до 2)
  handout?: boolean; // Выдача на руки
  prophylaxis?: PatronId; // Профилактика: какого Завсегдатая удалить
  denounce?: { player: string; card: string }; // цена похода — донос на открытую опальную книгу; в конце похода её изымают в Спецхран
}

export type GroupAction =
  | { action: 'expandWarehouse' }
  | { action: 'expandCache' }
  | { action: 'copyText'; address: CopyTextAddress; buy?: CopyTextBuy | null; card?: string | null } // покупка по желанию + card бесплатно оттуда же
  | { action: 'rescue'; returns: Record<string, number> }
  | { action: 'restore'; card: string }
  | { action: 'hire' };

export type Action =
  | { type: 'choosePassion'; passion: PassionId }
  | { type: 'place'; place: PlaceAction }
  | { type: 'group'; group: GroupAction }
  | { type: 'pass' } // отказаться от бонусного действия Группы
  | { type: 'endTurn' } // закончить ход после действия (до этого можно пересобрать Тайник, заучить, отдать книгу в Клуб)
  | { type: 'baraholkaBuy'; slot?: number; next?: number } // slot — какую из просмотренных купить (нет — не покупать); next — Ветеран смотрит ещё книгу
  | { type: 'kvartirnikReply'; accept: boolean }
  | { type: 'naslednikiPick'; cards: string[] }
  | { type: 'posrednichestvoKeep'; keep: string[] }
  | { type: 'spisanieKeep'; keep: string[] }
  | { type: 'sproutBonus'; bonus: SproutBonusId; group?: GroupAction }
  | { type: 'gathering'; show: string[] }
  | { type: 'ambush'; go: boolean; picks?: Record<string, string> } // picks — какую из показанных книг изъять у каждого; после Посиделок: Куратор раскрывается и устраивает Засаду (остальные — «дальше»)
  | { type: 'hiding'; hidden: string[]; memorize?: string | null; fillLoad?: boolean }
  | { type: 'kontoraHide'; hidden: string[] }
  | { type: 'kontoraDecide'; go: boolean; choice?: KontoraChoice }
  | { type: 'kontoraHandout'; card: string }
  | { type: 'clubGift'; gift: ClubGift | null }
  | { type: 'memorize'; card: string | null }
  | { type: 'lieutenantPick'; card: string | null }
  | { type: 'discardExcess'; cards: string[] }
  | { type: 'glavlitSwap'; from: Genre; to: Genre }; // Поэзия «Заучить» — в любой момент своего хода
