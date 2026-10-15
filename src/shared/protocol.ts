// Сообщения между клиентом и сервером.
import type { Action, Mode } from '../engine/types';
import type { PlayerView } from '../engine/view';

export interface RoomInfo {
  code: string;
  host: string;
  mode: Mode;
  started: boolean;
  seats: { id: string; name: string; bot: boolean; online: boolean; preset: string }[]; // preset — пресет бота
  canUndo: boolean;
  hostBot: boolean; // за хоста играет бот, хост смотрит со стороны
  botDelay: number; // пауза между ходами ботов, мс
}

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'hello'; code: string; token: string | null }
  | { t: 'addBot' }
  | { t: 'removeSeat'; seat: string }
  | { t: 'setMode'; mode: Mode }
  | { t: 'start' }
  | { t: 'action'; action: Action }
  | { t: 'undo' }
  | { t: 'restart' }
  | { t: 'hostBot'; on: boolean }
  | { t: 'botDelay'; ms: number }
  | { t: 'botPreset'; seat: string; preset: string };

export type ServerMessage =
  | { t: 'joined'; code: string; token: string }
  | { t: 'room'; room: RoomInfo; you: string | null; isHost: boolean; view: PlayerView | null }
  | { t: 'error'; message: string };
