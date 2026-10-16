// Игровой сервер: раздаёт собранный клиент и ведёт партии через WebSocket.
// Сервер — единственный источник истины: клиенты присылают действия, сервер проверяет их движком
// и рассылает каждому игроку его собственный вид состояния.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { applyAction, createGame, activePlayers, migrate } from '../engine/engine';
import { botMove } from '../engine/bot';
import { BOT_PRESETS, DEFAULT_PRESET, curatorStyleNote, presetById } from '../engine/bot-presets';
import { viewFor } from '../engine/view';
import { RuleError } from '../engine/util';
import type { Action, GameState, Mode } from '../engine/types';
import type { ClientMessage, RoomInfo, ServerMessage } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve('dist');
const SAVE_DIR = resolve(process.env.SAVE_DIR ?? 'data/games');
mkdirSync(SAVE_DIR, { recursive: true });

interface Seat { id: string; name: string; token: string; bot: boolean; preset?: string }
interface Room {
  code: string; host: string; seats: Seat[]; mode: Mode; state: GameState | null; history: GameState[]; updated: number;
  botDelay?: number;
  noCurator?: boolean; // настройка: без Куратора в колоде Пристрастий
}

const rooms = new Map<string, Room>();
const sockets = new Map<WebSocket, { room: string; seat: string | null; host: boolean }>();

// ---------- Сохранение ----------

// Партия окончена, Куратор — бот: в конце журнала пишем, какой стратегии он держался (один раз).
function noteCuratorStyle(room: Room) {
  const s = room.state;
  if (!s || s.phase !== 'end') return;
  const cur = s.players.find((p) => p.passion === 'curator');
  if (!cur || !room.seats.find((x) => x.id === cur.id)?.bot) return;
  const text = curatorStyleNote(s, cur.id, cur.name);
  if (!s.log.some((l) => l.text === text)) s.log.push({ round: s.round, text });
}

function save(room: Room) {
  room.updated = Date.now();
  noteCuratorStyle(room);
  const { history, ...rest } = room;
  writeFileSync(join(SAVE_DIR, `${room.code}.json`), JSON.stringify({ ...rest, history: history.slice(-20) }));
}

for (const f of readdirSync(SAVE_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const r = JSON.parse(readFileSync(join(SAVE_DIR, f), 'utf8')) as Room;
    r.history ??= [];
    if (r.state) r.state = migrate(r.state);
    rooms.set(r.code, r);
  } catch {
    console.warn('Не удалось прочитать сохранение', f);
  }
}

// ---------- Комнаты ----------

const ALPHABET = 'АБВГДЕЖИКЛМНПРСТУФХЦЧШЭЮЯ';
function newCode(): string {
  for (;;) {
    const bytes = randomBytes(4);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (!rooms.has(code)) return code;
  }
}
const newId = () => randomBytes(6).toString('hex');

function roomInfo(room: Room): RoomInfo {
  return {
    code: room.code, host: room.host, mode: room.mode, started: !!room.state,
    seats: room.seats.map((s) => ({ id: s.id, name: s.name, bot: s.bot, online: isOnline(room, s.id), preset: s.preset ?? DEFAULT_PRESET })),
    canUndo: room.history.length > 0,
    hostBot: hostSeat(room)?.bot ?? false,
    botDelay: room.botDelay ?? 700,
    curator: !room.noCurator,
  };
}

function hostSeat(room: Room) {
  return room.seats.find((s) => s.id === room.host);
}

function isOnline(room: Room, seat: string) {
  for (const [, c] of sockets) if (c.room === room.code && c.seat === seat) return true;
  return room.seats.find((s) => s.id === seat)?.bot ?? false;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room) {
  const info = roomInfo(room);
  for (const [ws, c] of sockets) {
    if (c.room !== room.code) continue;
    // Хост, за которого играет бот, смотрит партию со стороны и видит всё.
    const omniscient = c.host && !c.seat;
    send(ws, { t: 'room', room: info, you: c.seat, isHost: c.host, view: room.state ? viewFor(room.state, c.seat, omniscient) : null });
  }
}

const botTimers = new Map<string, NodeJS.Timeout>();
function scheduleBots(room: Room) {
  if (!room.state || room.state.phase === 'end') return;
  const bots = new Set(room.seats.filter((s) => s.bot).map((s) => s.id));
  const who = activePlayers(room.state).find((id) => bots.has(id));
  if (!who) return;
  clearTimeout(botTimers.get(room.code));
  botTimers.set(room.code, setTimeout(() => {
    botTimers.delete(room.code);
    if (!room.state) return;
    try {
      room.state = botMove(room.state, who, Math.random, room.seats.find((s) => s.id === who)?.preset);
    } catch (e) {
      console.error('Ошибка бота', e);
      return;
    }
    save(room);
    broadcast(room);
    scheduleBots(room);
  }, room.botDelay ?? 700));
}

// Боты называются по пресету; номер — только если у нескольких ботов один пресет.
// Место хоста, отданное боту, сохраняет имя хоста.
function renameBots(room: Room) {
  const bots = room.seats.filter((s) => s.bot && s.id !== room.host);
  const count = new Map<string, number>();
  for (const s of bots) count.set(presetById(s.preset ?? DEFAULT_PRESET).name, (count.get(presetById(s.preset ?? DEFAULT_PRESET).name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const s of bots) {
    const base = presetById(s.preset ?? DEFAULT_PRESET).name;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    s.name = count.get(base)! > 1 ? `${base} ${k}` : base;
    const p = room.state?.players.find((x) => x.id === s.id);
    if (p) p.name = s.name;
  }
}

function handle(ws: WebSocket, msg: ClientMessage) {
  const conn = sockets.get(ws);
  switch (msg.t) {
    case 'create': {
      const code = newCode();
      const seat: Seat = { id: newId(), name: msg.name.trim().slice(0, 24) || 'Игрок', token: newId() + newId(), bot: false };
      const room: Room = { code, host: seat.id, seats: [seat], mode: 'beginner', state: null, history: [], updated: Date.now() };
      rooms.set(code, room);
      sockets.set(ws, { room: code, seat: seat.id, host: true });
      send(ws, { t: 'joined', code, token: seat.token });
      save(room);
      broadcast(room);
      return;
    }
    case 'hello': {
      const room = rooms.get(msg.code);
      if (!room) return send(ws, { t: 'error', message: 'Комната не найдена' });
      const seat = room.seats.find((s) => s.token === msg.token);
      const host = !!seat && seat.id === room.host;
      sockets.set(ws, { room: room.code, seat: seat && !seat.bot ? seat.id : null, host });
      broadcast(room);
      scheduleBots(room);
      return;
    }
    case 'join': {
      const room = rooms.get(msg.code);
      if (!room) return send(ws, { t: 'error', message: 'Комната не найдена' });
      if (room.state) return send(ws, { t: 'error', message: 'Партия уже началась — можно только смотреть' });
      if (room.seats.length >= 4) return send(ws, { t: 'error', message: 'За столом уже 4 игрока' });
      const seat: Seat = { id: newId(), name: msg.name.trim().slice(0, 24) || 'Игрок', token: newId() + newId(), bot: false };
      room.seats.push(seat);
      sockets.set(ws, { room: room.code, seat: seat.id, host: false });
      send(ws, { t: 'joined', code: room.code, token: seat.token });
      save(room);
      broadcast(room);
      return;
    }
  }

  if (!conn) return send(ws, { t: 'error', message: 'Сначала войдите в комнату' });
  const room = rooms.get(conn.room)!;
  const isHost = conn.host;

  switch (msg.t) {
    case 'addBot': {
      if (!isHost || room.state) return;
      if (room.seats.length >= 4) return send(ws, { t: 'error', message: 'За столом уже 4 игрока' });
      room.seats.push({ id: newId(), name: 'Бот', token: newId(), bot: true });
      break;
    }
    case 'removeSeat': {
      if (!isHost || room.state || msg.seat === room.host) return;
      room.seats = room.seats.filter((s) => s.id !== msg.seat);
      break;
    }
    case 'setCurator': {
      if (!isHost || room.state) return;
      room.noCurator = !msg.on;
      break;
    }
    case 'setMode': {
      if (!isHost || room.state) return;
      room.mode = msg.mode;
      break;
    }
    case 'start': {
      if (!isHost || room.state) return;
      if (room.seats.length < 1) return send(ws, { t: 'error', message: 'За столом никого нет' });
      room.state = createGame({ players: room.seats.map((s) => ({ id: s.id, name: s.name })), mode: room.mode, curator: !room.noCurator });
      room.history = [];
      break;
    }
    case 'action': {
      if (!room.state || !conn.seat) return;
      try {
        const next = applyAction(room.state, conn.seat, msg.action as Action);
        room.history.push(room.state);
        if (room.history.length > 50) room.history.shift();
        room.state = next;
      } catch (e) {
        if (e instanceof RuleError) return send(ws, { t: 'error', message: e.message });
        console.error(e);
        return send(ws, { t: 'error', message: 'Внутренняя ошибка сервера' });
      }
      break;
    }
    case 'undo': {
      // Отмена последнего действия — для плейтестов, доступна хосту.
      if (!isHost || !room.history.length) return;
      room.state = room.history.pop()!;
      break;
    }
    case 'hostBot': {
      // Хост отдаёт своё место боту (и смотрит со стороны) или забирает его обратно.
      const seat = hostSeat(room);
      if (!isHost || !seat) return;
      seat.bot = msg.on;
      for (const [, c] of sockets) if (c.room === room.code && c.host) c.seat = msg.on ? null : seat.id;
      break;
    }
    case 'botDelay': {
      if (!isHost) return;
      room.botDelay = Math.max(30, Math.min(3000, Math.round(msg.ms)));
      break;
    }
    case 'botPreset': {
      // Пресет бота можно менять и до, и во время партии.
      const seat = room.seats.find((s) => s.id === msg.seat);
      if (!isHost || !seat || !BOT_PRESETS.some((p) => p.id === msg.preset)) return;
      seat.preset = msg.preset;
      break;
    }
    case 'restart': {
      if (!isHost) return;
      room.state = null;
      room.history = [];
      break;
    }
  }
  renameBots(room);
  save(room);
  broadcast(room);
  scheduleBots(room);
}

// ---------- HTTP ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Клиент не собран: выполните npm run build');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      handle(ws, JSON.parse(String(data)) as ClientMessage);
    } catch (e) {
      console.error(e);
      send(ws, { t: 'error', message: 'Не удалось обработать сообщение' });
    }
  });
  ws.on('close', () => {
    const c = sockets.get(ws);
    sockets.delete(ws);
    const room = c && rooms.get(c.room);
    if (room) broadcast(room);
  });
});

server.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));
