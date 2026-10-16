import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useServer } from './net';
import { Game } from './game';
import { PLAYER_COLORS, PresetSelect, SpeedSelect } from './ui';
import './style.css';

function useHashCode(): string | null {
  const read = () => decodeURIComponent(location.hash).match(/^#\/r\/(.+)$/)?.[1] ?? null;
  const [code, setCode] = useState(read);
  useEffect(() => {
    const on = () => setCode(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return code;
}

function savedName() {
  try { return localStorage.getItem('smr:name') ?? ''; } catch { return ''; }
}
function storeName(n: string) {
  try { localStorage.setItem('smr:name', n); } catch { /* ignore */ }
}

function App() {
  const code = useHashCode();
  const net = useServer(code);
  const [name, setName] = useState(savedName);

  const join = (msg: { t: 'create' } | { t: 'join'; code: string }) => {
    storeName(name);
    net.send(msg.t === 'create' ? { t: 'create', name } : { t: 'join', code: msg.code, name });
  };

  let body;
  if (!code) {
    body = <Home name={name} setName={setName} onCreate={() => join({ t: 'create' })} />;
  } else if (!net.room) {
    body = <p className="center muted">{net.connected ? 'Загрузка комнаты…' : 'Подключение к серверу…'}</p>;
  } else if (net.room.started && net.view) {
    body = <Game view={net.view} room={net.room} you={net.you} isHost={net.isHost} send={net.send} />;
  } else {
    body = <Lobby net={net} name={name} setName={setName} onJoin={() => join({ t: 'join', code })} />;
  }

  return (
    <>
      {body}
      {!net.connected && net.room && <div className="toast warn">Связь потеряна, переподключаемся…</div>}
      {net.error && <div className="toast" onClick={net.clearError}>{net.error} <b>×</b></div>}
    </>
  );
}

function Home({ name, setName, onCreate }: { name: string; setName: (s: string) => void; onCreate: () => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="home">
      <h1>Сохрани мою речь</h1>
      <p className="subtitle">книжное подполье СССР</p>
      <label>Ваше имя<input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Как вас называть" /></label>
      <button className="primary" disabled={!name.trim()} onClick={onCreate}>Создать комнату</button>
      <div className="or">или войдите по коду</div>
      <div className="row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Код комнаты" />
        <button disabled={!code.trim()} onClick={() => (location.hash = `#/r/${code.trim()}`)}>Войти</button>
      </div>
    </div>
  );
}

function Lobby({ net, name, setName, onJoin }: { net: ReturnType<typeof useServer>; name: string; setName: (s: string) => void; onJoin: () => void }) {
  const room = net.room!;
  const seated = !!net.you || net.isHost;
  const host = net.isHost;
  const link = location.href;
  return (
    <div className="home lobby">
      <h1>Комната {room.code}</h1>
      <p className="muted">Отправьте ссылку тестировщикам: <a href={link}>{link}</a>{' '}
        <button className="small" onClick={() => navigator.clipboard?.writeText(link)}>Копировать</button>
      </p>
      <ul className="seats">
        {room.seats.map((s, i) => (
          <li key={s.id}>
            <span className="dot" style={{ background: PLAYER_COLORS[i] }} />
            {s.name}{s.id === room.host && ' (хост)'}{s.bot && ' 🤖'}
            {!s.bot && <span className={s.online ? 'online' : 'offline'}>{s.online ? ' в сети' : ' не в сети'}</span>}
            {s.bot && <PresetSelect seat={s} host={host} send={net.send} />}
            {host && s.id !== room.host && <button className="small" onClick={() => net.send({ t: 'removeSeat', seat: s.id })}>убрать</button>}
          </li>
        ))}
      </ul>
      {!seated && !room.started && (
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" maxLength={24} />
          <button className="primary" disabled={!name.trim() || room.seats.length >= 4} onClick={onJoin}>Сесть за стол</button>
        </div>
      )}
      {host && (
        <>
          <label>Режим
            <select value={room.mode} onChange={(e) => net.send({ t: 'setMode', mode: e.target.value as 'beginner' })}>
              <option value="beginner">Райцентр (для начинающих)</option>
              <option value="full">Полные правила</option>
            </select>
          </label>
          {room.mode === 'full' && room.seats.length > 1 && (
            <label className="row">
              <input type="checkbox" checked={room.curator} onChange={(e) => net.send({ t: 'setCurator', on: e.target.checked })} />
              Куратор в игре (агент госбезопасности среди Пристрастий)
            </label>
          )}
          <label className="row">
            <input type="checkbox" checked={room.hostBot} onChange={(e) => net.send({ t: 'hostBot', on: e.target.checked })} />
            За меня играет бот — я смотрю партию со стороны и вижу всё
          </label>
          <SpeedSelect room={room} send={net.send} />
          <div className="row">
            <button disabled={room.seats.length >= 4} onClick={() => net.send({ t: 'addBot' })}>Добавить бота</button>
            <button className="primary" disabled={room.seats.length < 1} onClick={() => net.send({ t: 'start' })}>
              {room.seats.length === 1 ? 'Начать одиночную партию' : 'Начать партию'}
            </button>
          </div>
          {room.seats.length === 1 && (
            <p className="muted small">
              Один игрок — режим «Несистемный»: 3 Ростка, Куратора нет, Цензура растёт на 1 каждую Пятилетку
              {room.mode === 'full' ? ', со 2-й Пятилетки лишний жетон жанра бьёт по Клубу (Профилактика или Контора)' : ''}.
              В конце вскрываются 30 Непечатных: каждая Пропаганда срезает ступень у самого развитого Ростка. Победа — если все Ростки устояли на III ступени.
            </p>
          )}
        </>
      )}
      {seated && !host && <p className="muted">Ждём, пока хост начнёт партию…</p>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
