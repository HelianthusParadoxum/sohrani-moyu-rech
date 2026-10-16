// Подключение к серверу с автоматическим переподключением.
import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, RoomInfo, ServerMessage } from '../shared/protocol';
import type { PlayerView } from '../engine/view';

export interface NetState {
  connected: boolean;
  room: RoomInfo | null;
  you: string | null;
  isHost: boolean;
  view: PlayerView | null;
  error: string | null;
  gone: boolean; // комнаты больше нет на сервере
  canStepBack: boolean; // можно нажать «Назад» в своём ходу
}

export const tokenKey = (code: string) => `smr:token:${code}`;

function readToken(code: string): string | null {
  try { return localStorage.getItem(tokenKey(code)); } catch { return null; }
}
function writeToken(code: string, token: string) {
  try { localStorage.setItem(tokenKey(code), token); } catch { /* приватный режим */ }
}

export function useServer(code: string | null) {
  const [state, setState] = useState<NetState>({ connected: false, room: null, you: null, isHost: false, view: null, error: null, gone: false, canStepBack: false });
  const ws = useRef<WebSocket | null>(null);
  const queue = useRef<ClientMessage[]>([]);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    setState((s) => ({ ...s, room: null, view: null, gone: false }));
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        setState((s) => ({ ...s, connected: true }));
        if (code) sock.send(JSON.stringify({ t: 'hello', code, token: readToken(code) } satisfies ClientMessage));
        for (const m of queue.current.splice(0)) sock.send(JSON.stringify(m));
      };
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.t === 'joined') {
          writeToken(msg.code, msg.token);
          if (location.hash !== `#/r/${msg.code}`) location.hash = `#/r/${msg.code}`;
        } else if (msg.t === 'room') {
          setState((s) => ({ ...s, room: msg.room, you: msg.you, isHost: msg.isHost, view: msg.view, error: null, canStepBack: !!msg.canStepBack }));
        } else if (msg.t === 'gone') {
          setState((s) => ({ ...s, gone: true }));
        } else if (msg.t === 'error') {
          setState((s) => ({ ...s, error: msg.message }));
        }
      };
      sock.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.current?.close(); };
  }, [code]);

  const send = (m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
    else queue.current.push(m);
  };
  const clearError = () => setState((s) => ({ ...s, error: null }));
  return { ...state, send, clearError };
}
