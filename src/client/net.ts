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
  probe: { code: string; exists: boolean } | null; // ответ на вопрос «есть ли комната с таким кодом»
}

// Переход на страницу комнаты (code) или на главную (null) без перезагрузки страницы.
export const NAVIGATE = 'smr:navigate';
export function navigate(code: string | null) {
  const path = code ? `/${encodeURIComponent(code)}` : '/';
  if (location.pathname + location.hash === path) return;
  history.pushState(null, '', path);
  dispatchEvent(new Event(NAVIGATE));
}

export const tokenKey = (code: string) => `smr:token:${code}`;

function readToken(code: string): string | null {
  try { return localStorage.getItem(tokenKey(code)); } catch { return null; }
}
function writeToken(code: string, token: string) {
  try { localStorage.setItem(tokenKey(code), token); } catch { /* приватный режим */ }
}

export function useServer(code: string | null) {
  const [state, setState] = useState<NetState>({ connected: false, room: null, you: null, isHost: false, view: null, error: null, gone: false, canStepBack: false, probe: null });
  const ws = useRef<WebSocket | null>(null);
  const queue = useRef<ClientMessage[]>([]);
  // Комната, к которой привязано соединение. Соединение одно на всю страницу: при создании комнаты сервер сразу
  // привязывает к ней это же соединение, поэтому смена адреса на «#/r/КОД» не требует переподключения
  // (раньше страница переподключалась и снова показывала загрузку).
  const codeRef = useRef(code);
  const bound = useRef<string | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        setState((s) => ({ ...s, connected: true }));
        const c = codeRef.current;
        bound.current = c;
        if (c) sock.send(JSON.stringify({ t: 'hello', code: c, token: readToken(c) } satisfies ClientMessage));
        for (const m of queue.current.splice(0)) sock.send(JSON.stringify(m));
      };
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.t === 'joined') {
          writeToken(msg.code, msg.token);
          bound.current = msg.code;
          navigate(msg.code);
        } else if (msg.t === 'room') {
          // Сведения о комнате, которую страница уже не показывает (ушли на главную), не нужны.
          if (msg.room.code !== bound.current) return;
          // Сервер обновился, а в браузере старая страница — перезагрузить (один раз на версию, без зацикливания).
          if (msg.build && msg.build !== __CLIENT_BUILD__) {
            let tried: string | null = null;
            try { tried = sessionStorage.getItem('smr:reloaded'); sessionStorage.setItem('smr:reloaded', msg.build); } catch { /* ignore */ }
            if (tried !== msg.build) { location.reload(); return; }
          }
          setState((s) => ({ ...s, room: msg.room, you: msg.you, isHost: msg.isHost, view: msg.view, error: null, canStepBack: !!msg.canStepBack }));
        } else if (msg.t === 'probe') {
          setState((s) => ({ ...s, probe: { code: msg.code, exists: msg.exists } }));
        } else if (msg.t === 'gone') {
          if (msg.code === codeRef.current) setState((s) => ({ ...s, gone: true }));
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
  }, []);

  // Другая комната (вход по коду, переход по ссылке, возврат на главную) — показать загрузку и попросить её у сервера.
  // Комнату, к которой соединение уже привязано (только что созданную), заново не запрашиваем.
  useEffect(() => {
    codeRef.current = code;
    if (code === bound.current) return;
    bound.current = code;
    setState((s) => ({ ...s, room: null, view: null, you: null, isHost: false, gone: false }));
    if (code && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ t: 'hello', code, token: readToken(code) } satisfies ClientMessage));
    }
  }, [code]);

  const send = (m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
    else queue.current.push(m);
  };
  const clearError = () => setState((s) => ({ ...s, error: null }));
  return { ...state, send, clearError };
}
