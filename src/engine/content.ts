// Справочные данные правил: адреса, Ростки, Пристрастия. Меняйте здесь, когда меняются правила.
import type { AddressId, Genre, GroupActionId, Mode, PassionId, PatronId, PointSource, SproutBonusId } from './types';
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

// Короткие обозначения значков жанров (на книгах в интерфейсе и в журнале).
export const GENRE_SHORT: Record<Genre, string> = {
  prose: 'ПР', scifi: 'ФА', poetry: 'ПО', foreign: 'ИН', testimony: 'СВ', drama: 'ДР', album: 'АЛ', irony: 'ИР',
};

// Настраиваемые числа правил — всё, что может поменяться при балансировке.
export const RULES = {
  rounds: 5,
  startTalons: 5,
  startWorkers: 5,
  safehouseExtraFive: 1, // впятером у каждого явочного адреса +1 место
  maxWorkers: 7,
  startCapacity: 5,
  maxCapacity: 10,
  maxCache: 5,
  startCensorship: 3,
  censorshipTokens: [3, 4, 5, 6, 7],
  displaySize: 4,
  raspredelitelSize: 4,
  agitpunktSize: 4, // Агитпункт: сколько книг Нагрузки лежит на витрине
  hireCost: 6,
  expandWarehouseCost: 1, // Увеличение склада: цена в Талонах
  expandCacheCost: 1, // Закладка Тайника: цена в Талонах
  professorTalons: 1, // Профессор: за каждую закрытую ступень Ростка — Талонов
  professorPoints: 1, // ...и очков Гласности
  restoreCost: 0, // Возвращение смыслов: цена в Талонах (0 — бесплатно)
  tolkuchkaBuy: 2, // за книгу
  tolkuchkaSellBanned: 2, // книга с опальным жанром
  tolkuchkaSellFree: 1, // книга без опального жанра
  razvalPrices: [2, 2, 1, 1],
  zavozIncome: 2,
  baraholkaPrice: 1,
  baraholkaLook: 2, // Барахолка: сколько книг тайно посмотреть (купить можно одну из них)
  safehousePrice: 3, // Наследники
  posrednichestvoPrice: 2, // Посредничество авторам
  raspredelitelPrice: 2, // книга Распределителя
  spisaniePrice: 1, // Библиотечное списание
  makulaturaPrice: 1, // Макулатура: Талонов за каждую вытянутую книгу
  spisanieDraw: 3, // Библиотечное списание: сколько книг тайно взять сверху стопки (оставить — сколько угодно)
  posrednichestvoDraw: 3, // Посредничество авторам: сколько книг тайно вытянуть
  posrednichestvoKeep: 1, // ...и сколько из них оставить (остальные — в сброс)
  samizdatTalons: 2, // Самиздат: Талонов за значок
  tamizdatTalons: 1, // Тамиздат: Талонов за значок
  tamizdatPoints: 2, // Тамиздат: очков Гласности за значок
  redCornerUnprinted: 1, // Красный уголок: Талонов за сданную Непечатную книгу
  redCornerLoad: 1, // Красный уголок: Талонов за сданную книгу Нагрузки
  sideJobIncome: 3,
  passionKeeper: 2, // Хранитель: очков за значок своих двух жанров
  passionErudite: 1, // Эрудит: очков за значок (по 1 книге на жанр); было 2 без бонуса за жанры
  eruditePerGenre: 1, // Эрудит: ещё очков за каждый жанр, в котором засчитана книга
  eruditeMaxGenres: 8, // Эрудит: сколько жанров засчитывается (8 — все)
  passionMonogamist: 2, // Вольная душа: очков за значок лучшего жанра
  monogamistSecond: 1, // Вольная душа: очков за значок второго по силе жанра
  passionInnovator: 2, // Новатор: очков за значок на двужанровых книгах
  innovatorSingle: -1, // Новатор: очков за каждую книгу с одним жанром (на складе и в изданном)
  gatheringPoints: 1, // Посиделки: очков за показанную опальную книгу или Улику (Райцентр, Заповедник)
  gatheringPointsFull: 2, // ...в полном режиме с Конторой — показывать опаснее (Засада Куратора)
  propagandaPoints: -5,
  // «Разоблачение»: Возвращение смыслов превращает Пропаганду в книгу на +5 очков (уже не Пропаганда и не опальна;
  // в сброс уходит без жетона смыслов — снова Пропаганда);
  // её можно издать как книгу с 1 значком без жанра. false — Пропаганде смыслы не возвращают.
  exposePropaganda: true,
  exposePoints: 5, // как Улика
  evidencePoints: 5,
  talonsPerPoint: 3, // в конце: 1 очко Гласности за каждые столько Талонов
  // Клуб книголюбов: true — свободное действие (за свой ход можно отдать 1 книгу 1 Завсегдатаю, Единомышленник не нужен);
  // false — адрес, куда ставят Единомышленника, и можно завязать несколько связей за приход.
  clubFreeGift: true,
  glavlitTalons: 1, // Главлит: Талонов за каждую отданную подцензурную книгу
  rescuePoints: 2, // Вызволение из бед: очков Гласности за каждого вызволенного Единомышленника
  correspondentTalons: 1, // Корреспондент: Талонов за каждое издание через Самиздат или Тамиздат
  correspondentPoints: 1, // ...и очков Гласности за каждое издание
  carpenterCache: 2, // Столяр: на сколько мест растёт Тайник от Закладки Тайника
  brokerTalons: 2, // Маклер: Талонов за каждую новую связь
  typistTalons: 2, // Машинистка: Талонов за каждое Тиражирование
  tsekhovikBonus: 1, // Цеховик: на сколько Талонов больше за любое действие, приносящее Талоны (раз за действие)
  komsorgPoints: 1, // Комсорг: очков Гласности за каждую сданную в Красном уголке книгу
  testimonyPoints: 3, // Свидетельства «Придать огласке»: очков за издание через Тамиздат (полный режим)
  foreignPoints: 3, // Иностранная «Перевести»: очков за издание через Самиздат (полный режим)
  extraSprouts: { beginner: 0, full: 0, reserve: 1 }, // Ростков на партию: число игроков + это число (reserve — «Заповедник»)
  glasnostStep: 3, // до какой ступени должны дорасти Ростки
  // Смена опалы каждую Пятилетку: 'inertia' — из опалы выходит самый старый жанр, взамен — новые (не только что освобождённый);
  // 'ossified' — «окостенение»: выходит самый свежий, опала добирается из всех свободных жанров (он может и вернуться).
  censorshipShift: 'ossified' as 'inertia' | 'ossified',
  petitionMax: 1, // Контора, Ходатайство: скольких удержанных Единомышленников можно вернуть
  spetskhranStart: 5, // полный режим: столько Непечатных лежит в Спецхране Конторы с начала партии
  proseBonusMax: 1, // Проза «Вдохновиться»: не больше стольких очков за действие, сколько бы прозы ни было
  sproutSlotsPerRound: 2, // сколько ступеней одного Ростка можно закрыть за Пятилетку (всеми игроками вместе)
  sproutFeedsPerAction: 1, // сколько ступеней (у разных Ростков) можно закрыть одним поручением «Ростки Гласности»
  // «Несистемный» — одиночная игра.
  soloSprouts: { beginner: 2, full: 3 }, // Ростков на партию
  soloEndCards: { beginner: 10, full: 30 }, // в конце вскрываются столько верхних Непечатных; каждая Пропаганда срезает ступень у самого развитого Ростка
  glasnostAllSprouts: true, // все выложенные Ростки (true) или хотя бы один (false)
};

// Лимиты Единомышленников на адресе для 2 / 3 / 4 игроков (впятером — как вчетвером, у явочных +1). Infinity — без лимита.
type Limits = [number, number, number];
const INF = Infinity;

export interface AddressInfo {
  id: AddressId;
  name: string;
  limits: Limits;
  safehouse?: boolean;
  fullOnly?: boolean;
  perPlayer?: boolean; // не больше 1 Единомышленника от игрока
  hint: string;
}

export const ADDRESSES: Record<AddressId, AddressInfo> = {
  gostorg: { id: 'gostorg', name: 'Госкниготорг', limits: [2, 3, 4], hint: '−1т за пару: Нагрузка + Непечатное, любое число пар' },
  tolkuchka: { id: 'tolkuchka', name: 'Толкучка', limits: [2, 3, 4], hint: 'Купить 1 книгу: −2т. Продать: +2т за книгу опального жанра, +1т за прочие' },
  redCorner: { id: 'redCorner', name: 'Красный уголок', limits: [INF, INF, INF], perPlayer: true, hint: `Очередь хода на следующую Пятилетку; сдать до 1 Непечатной (+${RULES.redCornerUnprinted}т) и до 1 Нагрузки (+${RULES.redCornerLoad}т)` },
  razval: { id: 'razval', name: 'Развал', limits: [2, 3, 4], hint: 'Купить 1 книгу: −2/−2/−1/−1т по свежести' },
  zavoz: { id: 'zavoz', name: 'Завоз', limits: [1, 1, 2], hint: '+2т, Развал полностью обновляется' },
  baraholka: { id: 'baraholka', name: 'Барахолка', limits: [4, 4, 4], hint: 'Тайно посмотреть 2 из 4 закрытых книг и купить одну из них за 1т' },
  podpiska: { id: 'podpiska', name: 'Подписка', limits: [1, 1, 1], safehouse: true, hint: 'Заказать жанр: −1т за каждую Пятилетку доставки' },
  sprouts: { id: 'sprouts', name: 'Ростки Гласности', limits: [INF, INF, INF], hint: (RULES.sproutFeedsPerAction === 1 ? 'Закрыть 1 ступень одного Ростка' : `Закрыть до ${RULES.sproutFeedsPerAction} ступеней Ростков`) + `; у каждого Ростка — не больше ${RULES.sproutSlotsPerRound} ступеней за Пятилетку` },
  samizdat: { id: 'samizdat', name: 'Самиздат', limits: [2, 2, 3], hint: `Издать книгу: +${RULES.samizdatTalons}т/значок` },
  tamizdat: { id: 'tamizdat', name: 'Тамиздат', limits: [1, 1, 2], hint: `Издать книгу: +${RULES.tamizdatTalons}т и +${RULES.tamizdatPoints} очка/значок` },
  glavlit: { id: 'glavlit', name: 'Главлит', limits: [1, 1, 2], hint: `Отдать любое число подцензурных книг (+${RULES.glavlitTalons}т за каждую) и взять столько же из стопок Непечатных и Нагрузки на выбор` },
  makulatura: { id: 'makulatura', name: 'Макулатура', limits: [1, 1, 2], hint: `По ${RULES.makulaturaPrice}т за книгу: тяните тайно сколько угодно книг из стопок Непечатных и Нагрузки (из любой), затем оставьте себе одну, остальные — в сброс` },
  knigoobmen: { id: 'knigoobmen', name: 'Книгообмен', limits: [1, 1, 1], safehouse: true, hint: 'Отдать 1 жанровую книгу — взять 1 с витрины; когда свои Единомышленники кончатся — ещё 1 действие Инициативной группы' },
  kvartirnik: { id: 'kvartirnik', name: 'Квартирник', limits: [1, 1, 1], safehouse: true, hint: 'Обмен книгами с другим игроком по согласию; когда свои Единомышленники кончатся — ещё 1 действие Инициативной группы' },
  raspredelitel: { id: 'raspredelitel', name: 'Распределитель', limits: [1, 1, 1], safehouse: true, hint: `Купить 1 выдающуюся книгу за ${RULES.raspredelitelPrice}т` },
  agitpunkt: { id: 'agitpunkt', name: 'Агитпункт', limits: [1, 1, 1], safehouse: true, hint: 'Свой человек в агитпункте: взять 1 книгу Нагрузки с витрины бесплатно; когда свои Единомышленники кончатся — ещё 1 действие Инициативной группы' },
  nasledniki: { id: 'nasledniki', name: 'Наследники', limits: [1, 1, 1], safehouse: true, hint: `−${RULES.safehousePrice}т: тайно взять 1–2 книги из сброса Непечатных; остаток сброса замешивается в стопку` },
  posrednichestvo: { id: 'posrednichestvo', name: 'Посредничество авторам', limits: [1, 1, 1], safehouse: true, hint: `−${RULES.posrednichestvoPrice}т: тайно вытянуть ${RULES.posrednichestvoDraw}, оставить ${RULES.posrednichestvoKeep}, затем 1 любое действие Группы (даже уже сделанное)` },
  spisanie: { id: 'spisanie', name: 'Библиотечное списание', limits: [1, 1, 1], safehouse: true, hint: `−${RULES.spisaniePrice}т: тайно взять ${RULES.spisanieDraw} книги сверху стопки Непечатных, оставить сколько угодно, остальные — в сброс` },
  club: { id: 'club', name: 'Клуб книголюбов', limits: [2, 3, 4], fullOnly: true, hint: RULES.clubFreeGift
    ? 'Без Единомышленника: за свой ход отдайте 1 книгу 1 Завсегдатаю (его жанра или Альбом) — завяжите связь'
    : 'Отдайте Завсегдатаям книги их жанров — завяжите связи' },
  kontora: { id: 'kontora', name: 'Контора', limits: [INF, INF, INF], fullOnly: true, perPlayer: true, hint: 'Цена — донос на открытую опальную книгу соперника; Ходатайство, Выдача на руки, Профилактика; в конце — обязательно Сигнал на него и Изъятие книги' },
};

// Тиражирование текста: адреса, где книги покупают в открытую.
export const COPY_TEXT_ADDRESSES = ['razval', 'tolkuchka', 'raspredelitel', 'knigoobmen'] as const;

// Цена явочного адреса с платным входом.
export function safehouseCost(id: AddressId): number {
  if (id === 'raspredelitel') return RULES.raspredelitelPrice;
  if (id === 'spisanie') return RULES.spisaniePrice;
  if (id === 'posrednichestvo') return RULES.posrednichestvoPrice;
  return RULES.safehousePrice;
}

export const PERMANENT_ADDRESSES: AddressId[] = [
  'gostorg', 'tolkuchka', 'redCorner', 'razval', 'zavoz', 'baraholka', 'sprouts', 'samizdat', 'tamizdat', 'glavlit', 'makulatura',
  'club', 'kontora',
];
export const SAFEHOUSES: AddressId[] = ['knigoobmen', 'kvartirnik', 'raspredelitel', 'nasledniki', 'posrednichestvo', 'spisanie', 'podpiska', 'agitpunkt'];
// Адреса, которые начинают партию заполненными (если выложены).
export const STARTS_FILLED: AddressId[] = ['knigoobmen', 'raspredelitel', 'agitpunkt'];

export function limitFor(address: AddressId, playerCount: number): number {
  const l = ADDRESSES[address].limits;
  // Впятером — места как вчетвером, а у явочных адресов на одно больше.
  const extra = playerCount >= 5 && ADDRESSES[address].safehouse ? RULES.safehouseExtraFive : 0;
  return l[Math.min(Math.max(playerCount, 2), 4) - 2] + extra;
}

// Есть ли адрес / действие Группы в этой партии. «Заповедник» (reserve) — полный режим без Конторы и Куратора.
type GameKind = { mode: Mode; reserve?: boolean };
export function addressInGame(g: GameKind, id: AddressId): boolean {
  if (ADDRESSES[id].fullOnly && g.mode !== 'full') return false;
  return !(g.reserve && id === 'kontora');
}
export function groupInGame(g: GameKind, id: GroupActionId): boolean {
  if (GROUP_ACTIONS[id].fullOnly && g.mode !== 'full') return false;
  return !(g.reserve && id === 'rescue'); // вызволять некого: Конторы нет
}
// Завсегдатаи, чьё свойство без Конторы ни на что не влияет.
export const KONTORA_PATRONS: PatronId[] = ['psychiatrist'];

export const GROUP_ACTIONS: Record<GroupActionId, { name: string; hint: string; fullOnly?: boolean }> = {
  expandWarehouse: { name: 'Увеличение склада', hint: `−${RULES.expandWarehouseCost}т: +1 место на складе (до 10)` },
  expandCache: { name: 'Закладка Тайника', hint: `−${RULES.expandCacheCost}т: 1 место склада становится потайным (до 5)` },
  copyText: { name: 'Тиражирование текста', hint: 'Покупая книгу на Развале, Толкучке, в Распределителе (или меняясь на Книгообмене), поставьте ещё одного Единомышленника на Тиражирование — и возьмите с этого адреса ещё одну жанровую книгу бесплатно (не Улику и не Пропаганду)' },
  rescue: { name: 'Вызволение из бед', hint: `Вернуть Единомышленников из Конторы: +${RULES.rescuePoints} очка за каждого`, fullOnly: true },
  restore: { name: 'Возвращение смыслов', hint: `${RULES.restoreCost ? `${RULES.restoreCost}т: ` : ''}+1 значок жанровой книге или 3 значка возвращаемой Нагрузке` },
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
  { talons: 0, points: 8 },
];
export const FIRST_FEED_POINTS = 2;

export interface PassionInfo { id: PassionId; name: string; hint: string; genres?: [Genre, Genre]; special?: boolean }

export const PASSIONS: Record<PassionId, PassionInfo> = {
  keeper_golden: { id: 'keeper_golden', name: 'Золотая полка', genres: ['prose', 'poetry'], hint: `${RULES.passionKeeper} очка за значок Прозы и Поэзии` },
  keeper_silver: { id: 'keeper_silver', name: 'Серебряный век', genres: ['poetry', 'album'], hint: `${RULES.passionKeeper} очка за значок Поэзии и Альбома` },
  keeper_antiquary: { id: 'keeper_antiquary', name: 'Антиквар', genres: ['album', 'testimony'], hint: `${RULES.passionKeeper} очка за значок Альбома и Свидетельств` },
  keeper_memoirist: { id: 'keeper_memoirist', name: 'Правозащитник', genres: ['testimony', 'foreign'], hint: `${RULES.passionKeeper} очка за значок Свидетельств и Иностранной` },
  keeper_polyglot: { id: 'keeper_polyglot', name: 'Полиглот', genres: ['foreign', 'scifi'], hint: `${RULES.passionKeeper} очка за значок Иностранной и Фантастики` },
  keeper_dreamer: { id: 'keeper_dreamer', name: 'Мечтатель', genres: ['scifi', 'irony'], hint: `${RULES.passionKeeper} очка за значок Фантастики и Иронии` },
  keeper_skit: { id: 'keeper_skit', name: 'Капустник', genres: ['irony', 'drama'], hint: `${RULES.passionKeeper} очка за значок Иронии и Драматургии` },
  keeper_theatre: { id: 'keeper_theatre', name: 'Театрал', genres: ['drama', 'prose'], hint: `${RULES.passionKeeper} очка за значок Драматургии и Прозы` },
  erudite: { id: 'erudite', name: 'Эрудит', special: true, hint: `${RULES.passionErudite} очко за значок и ${RULES.eruditePerGenre} за каждый жанр; в каждом жанре засчитывается 1 книга${RULES.eruditeMaxGenres < 8 ? `, не больше ${RULES.eruditeMaxGenres} жанров` : ''}` },
  monogamist: { id: 'monogamist', name: 'Вольная душа', special: true, hint: `${RULES.passionMonogamist} очка за значок лучшего жанра${RULES.monogamistSecond ? ` и ${RULES.monogamistSecond} за значок второго по силе` : ''} (на момент подсчёта)` },
  innovator: { id: 'innovator', name: 'Новатор', special: true, hint: `${RULES.passionInnovator} очка за значок на двужанровых книгах${RULES.innovatorSingle ? `, ${RULES.innovatorSingle} очко за каждую книгу с одним жанром` : ''}` },
  curator: { id: 'curator', name: 'Куратор', special: true, hint: 'Агент госбезопасности: побеждает, если Гласность не наступит' },
  // Раздаётся только в партиях, где может быть Куратор (см. createGame).
  historian: { id: 'historian', name: 'Историк', special: true, hint: `Ещё по ${RULES.evidencePoints} очков за каждую Улику и по ${RULES.exposePoints} за каждое Разоблачение (монографию о Пропаганде) — вдвое больше; за жанровые книги — ничего` },
};

export const KEEPERS = Object.values(PASSIONS).filter((p) => !p.special).map((p) => p.id);
export const SPECIALS: PassionId[] = ['erudite', 'monogamist', 'innovator', 'curator'];

// ---------- Завсегдатаи Клуба книголюбов ----------

export interface PatronInfo { id: PatronId; name: string; hint: string; implemented: boolean }

const P = (id: PatronId, name: string, hint: string, implemented = true): PatronInfo => ({ id, name, hint, implemented });

// implemented: false — эффект ещё не запрограммирован, такой Завсегдатай не попадает в партию.
export const PATRONS: Record<PatronId, PatronInfo> = Object.fromEntries([
  P('binder', 'Переплётчик', 'В одно место склада помещаются 2 книги с общим жанром', false),
  P('carpenter', 'Столяр', `Закладка Тайника увеличивает Тайник на ${RULES.carpenterCache} (до 5)`),
  P('correspondent', 'Корреспондент', `Самиздат и Тамиздат: ещё +${RULES.correspondentTalons} Талон и +${RULES.correspondentPoints} очко Гласности за каждое издание`),
  P('postgrad', 'Архивист', 'Возвращение смыслов: +2 очка Гласности'),
  P('professor', 'Профессор', `Каждая закрытая ступень Ростка: +${RULES.professorTalons} Талон и +${RULES.professorPoints} очко Гласности`),
  P('housekeeper', 'Управдом', '+2 места на складе (до 10)'),
  P('spotter', 'Наводчик', 'Можно смотреть закрытые книги, сбросы и верх стопок', false),
  P('veteran', 'Ветеран', 'На адресах — сколько угодно книг за одно действие, в сумме на 1 Талон дешевле (минимум 1)'),
  P('buyer', 'Скупщик', 'Каждое действие с ценой в Талонах — на 1 Талон дешевле (минимум 1)'),
  P('fartsovshchik', 'Фарцовщик', 'На Толкучке все ваши книги продаются как опальные'),
  P('librarian', 'Библиотекарь', 'После облавы: до 2 книг из перетасованного сброса Непечатных'),
  P('tsekhovik', 'Цеховик', `За любое действие, приносящее вам Талоны, — на ${RULES.tsekhovikBonus} Талон больше`),
  P('partorg', 'Парторг', 'Перед облавой можно бесплатно заполнить пустые места Нагрузкой'),
  P('zavmag', 'Завмаг', 'Госкниготорг: каждую книгу свободно выбираете — Непечатное или Нагрузка, и не платите Талонов'),
  P('apprentice', 'Подмастерье', 'После поручений — ещё раз одно из действий Группы, уже сделанных в эту Пятилетку'),
  P('druzhinnik', 'Дружинник', 'Особый Единомышленник, ходит первым', false),
  P('chairman', 'Председатель', 'После поручений — одна связь в Клубе бесплатно'),
  P('zavkhoz', 'Завхоз', 'Красный уголок: +1 Талон за каждую сданную книгу'),
  P('buzoter', 'Бузотёр', 'Раз в Пятилетку можно встать на занятый до предела адрес'),
  P('broker', 'Маклер', `Каждая новая связь в Клубе (и эта): +${RULES.brokerTalons} Талона`),
  P('blatnoy', 'Блатной', 'Покупая книгу, можно за то же действие купить ещё одну в другом месте', false),
  P('glavlit', 'Главлитовец', 'При заведении связи и после каждой Обстановки: снять опалу с одного жанра и наложить на другой'),
  P('lieutenant', 'Лейтенант', 'После облавы — 1 любая изъятая с адресов книга'),
  P('cataloguer', 'Каталогизатор', 'Может смотреть книги и с низа стопки', false),
  P('doctor', 'Врач', 'Можно не ходить в Красный уголок'),
  P('komsorg', 'Комсорг', `Красный уголок: сдавать любое число книг, за каждую — +${RULES.komsorgPoints} очко Гласности`),
  P('typist', 'Машинистка', `Тиражирование: +${RULES.typistTalons} Талона; можно без покупки — взять любую жанровую книгу с поля, не отправляя Единомышленника на адрес`),
  P('editor', 'Главред', 'За каждую сданную в Главлит книгу — +1 очко Гласности за значок'),
  P('labtech', 'Лаборант', 'Питая Ростки, сдаёте на 1 значок меньше (минимум 1) — один раз за поручение'),
  P('psychiatrist', 'Психиатр', 'Контора не может удерживать ваших Единомышленников'),
  P('nesun', 'Несун', 'В конце Пятилетки +1 Талон за каждое пустое место Тайника'),
  P('geologist', 'Геолог', 'Посиделки: +1 Талон за каждую показанную опальную книгу'),
].map((p) => [p.id, p])) as Record<PatronId, PatronInfo>;

export const CLUB_SIZE = 8;
export const KONTORA_LOSS = 7; // столько удержанных Единомышленников — и все, кроме Куратора, проигрывают

// Названия источников очков для финальной таблицы.
// Порядок — как в разбивке итоговой таблицы: Ростки, Посиделки, Тамиздат, жанры (в порядке Клуба книголюбов),
// Завсегдатаи, Вызволение из бед.
export const POINT_SOURCES: Record<PointSource, string> = {
  sprouts: 'Ступени Ростков',
  firstFeed: 'Первое питание Ростков',
  gathering: 'Посиделки',
  tamizdat: 'Тамиздат',
  prose: 'Проза «Вдохновиться»',
  drama: 'Драматургия «Разыграть»',
  testimony: 'Свидетельства «Придать огласке»',
  foreign: 'Иностранная «Перевести»',
  editor: 'Главред',
  postgrad: 'Архивист',
  correspondent: 'Корреспондент',
  professor: 'Профессор',
  komsorg: 'Комсорг',
  rescue: 'Вызволение из бед',
};

// Название Пристрастия с жанрами, за которые оно награждает: «Золотая полка (Проза, Поэзия)».
export function passionLabel(id: PassionId): string {
  const p = PASSIONS[id];
  if (p.genres) return `${p.name} (${p.genres.map((g) => GENRE_NAMES[g]).join(', ')})`;
  const extra: Partial<Record<PassionId, string>> = {
    erudite: 'любые жанры, по 1 книге на жанр',
    monogamist: 'один жанр на выбор',
    innovator: 'двужанровые книги',
    historian: 'Улики и Разоблачения вдвое',
  };
  return extra[id] ? `${p.name} (${extra[id]})` : p.name;
}
