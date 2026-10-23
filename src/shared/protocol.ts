// Сообщения между клиентом и сервером.
import type { Action, Mode } from '../engine/types';
import type { PlayerView } from '../engine/view';

export interface RoomInfo {
  code: string;
  host: string;
  mode: Mode;
  reserve?: boolean; // «Заповедник»: полный режим без Конторы и Куратора
  started: boolean;
  seats: { id: string; name: string; bot: boolean; online: boolean; preset: string }[]; // preset — пресет бота
  canUndo: boolean;
  hostBot: boolean; // за хоста играет бот, хост смотрит со стороны
  botDelay: number; // пауза между ходами ботов, мс
  paused?: boolean; // ходы ботов остановлены (кнопка «Пауза» у хоста)
  curator: boolean; // Куратор в колоде Пристрастий (полный режим)
  forceCurator?: boolean; // для тестов: первый игрок — Куратор
  curatorStyle?: '' | 'open' | 'ambush' | 'boa'; // для тестов: стратегия Куратора-бота ('' — случайная)
  outdated?: boolean; // партию сбросили: игра обновилась, старую партию продолжить нельзя
}

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'hello'; code: string; token: string | null }
  | { t: 'addBot' }
  | { t: 'removeSeat'; seat: string }
  | { t: 'setMode'; mode: Mode | 'reserve' }
  | { t: 'setCurator'; on: boolean }
  | { t: 'setForceCurator'; on: boolean; style: '' | 'open' | 'ambush' | 'boa' }
  | { t: 'start' }
  | { t: 'action'; action: Action }
  | { t: 'undo' }
  | { t: 'stepBack' } // «Назад»: отменить свои действия в этом ходу (до момента, когда узнал новое)
  | { t: 'stepBackOne' } // отменить только последний шаг своего хода (закрыть окно решения, вызванного подарком)
  | { t: 'restart' }
  | { t: 'hostBot'; on: boolean }
  | { t: 'botDelay'; ms: number }
  | { t: 'botPause'; on: boolean }
  | { t: 'botPreset'; seat: string; preset: string };

export type ServerMessage =
  | { t: 'joined'; code: string; token: string }
  | { t: 'room'; room: RoomInfo; you: string | null; isHost: boolean; view: PlayerView | null; canStepBack?: boolean; build?: string }
  | { t: 'error'; message: string }
  | { t: 'gone'; code: string }; // комнаты нет (например, сервер обновили и сохранения пропали)
