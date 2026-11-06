import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NAVIGATE, navigate, useServer } from './net';
import { Game } from './game';
import { Dropdown, Modal, PLAYER_COLORS, PresetSelect, SkillSelect } from './ui';
import './style.css';
import './tips';

// Комната — в адресе страницы: сайт/1428. Старые ссылки вида сайт/#/r/1428 переводим на новый вид.
function useRoomCode(): string | null {
  const read = () => {
    const legacy = decodeURIComponent(location.hash).match(/^#\/r\/(.+)$/)?.[1];
    if (legacy) history.replaceState(null, '', `/${encodeURIComponent(legacy)}`);
    return decodeURIComponent(location.pathname).match(/^\/([^/]+)$/)?.[1] ?? null;
  };
  const [code, setCode] = useState(read);
  useEffect(() => {
    const on = () => setCode(read());
    addEventListener('popstate', on);
    addEventListener(NAVIGATE, on);
    return () => { removeEventListener('popstate', on); removeEventListener(NAVIGATE, on); };
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
  const code = useRoomCode();
  const net = useServer(code);
  const [name, setName] = useState(savedName);
  const [seenOutdated, setSeenOutdated] = useState<string | null>(null);
  // Шрифты ещё грузятся — экран не показываем: иначе заголовки «прыгают», когда шрифт подменяется на глазах.
  // Шрифты сами начинают грузиться, только когда текст уже на экране, — поэтому просим их заранее (с кириллицей).
  const [fontsReady, setFontsReady] = useState(() => typeof document === 'undefined' || !document.fonts);
  useEffect(() => {
    if (fontsReady) return;
    const done = () => setFontsReady(true);
    const t = setTimeout(done, 2500); // шрифты не грузятся (нет сети до Google Fonts) — не ждём дольше
    const sample = 'Сохрани мою речь Комната 0123';
    Promise.all(['700 1em "PT Serif"', '400 1em "PT Serif"', '400 1em "PT Sans"', '700 1em "PT Sans"', '400 1em "PT Mono"']
      .map((f) => document.fonts.load(f, sample))).then(done, done);
    return () => clearTimeout(t);
  }, [fontsReady]);

  const join = (msg: { t: 'create' } | { t: 'join'; code: string }) => {
    storeName(name);
    net.send(msg.t === 'create' ? { t: 'create', name } : { t: 'join', code: msg.code, name });
  };

  let body;
  // Одна и та же надпись на всё время загрузки (шрифты, подключение, комната, перезагрузка после обновления игры) —
  // чтобы надписи не сменяли друг друга.
  const loading = <p className="loading muted">Загрузка…</p>;
  if (!fontsReady) {
    body = null; // надпись появится уже нужным шрифтом — без второй, «перерисованной» надписи
  } else if (code && net.gone) {
    // Комнаты нет: игру обновили или сервер перезапускался (бесплатный хостинг засыпает после простоя и теряет партии).
    body = (
      <Apology onOk={() => navigate(null)}>
        {net.gone === 'update'
          ? 'Эта партия не сохранилась: игру обновили, и продолжить её нельзя. Начните, пожалуйста, новую партию.'
          : 'Эта партия не сохранилась: сервер перезапускался (например, после долгого простоя или из-за сбоя), а на бесплатном хостинге сохранения при перезапуске пропадают. Начните, пожалуйста, новую партию.'}
      </Apology>
    );
  } else if (!code) {
    body = <Home name={name} setName={setName} onCreate={() => join({ t: 'create' })} net={net} />;
  } else if (!net.room) {
    body = loading;
  } else if (net.room.started && net.view) {
    body = <Game view={net.view} room={net.room} you={net.you} isHost={net.isHost} send={net.send} canStepBack={net.canStepBack} />;
  } else {
    body = <Lobby net={net} name={name} setName={setName} onJoin={() => join({ t: 'join', code })} />;
  }

  // Комната осталась, но партия из прежней версии игры сброшена: места за столом те же, настройки новой партии — в лобби.
  const outdated = !!code && !!net.room?.outdated && !net.room.started && seenOutdated !== code;
  return (
    <>
      {body}
      {outdated && (
        <Apology onOk={() => setSeenOutdated(code)}>
          Игру обновили, и начатую партию продолжить нельзя: правила или подсчёт могли измениться. Места за столом сохранились — можно начать новую партию.
        </Apology>
      )}
      {!net.connected && net.room && <div className="toast warn">Связь потеряна, переподключаемся…</div>}
      {net.error && <div className="toast" onClick={net.clearError}>{net.error} <b>×</b></div>}
    </>
  );
}

function Apology({ children, onOk }: { children: React.ReactNode; onOk: () => void }) {
  return (
    <Modal title="Извините!">
      <p>{children}</p>
      <div className="modal-foot"><button className="primary" autoFocus onClick={onOk}>ОК</button></div>
    </Modal>
  );
}

// Код комнаты — 4 цифры.
function codeChars(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4);
}

function Home({ name, setName, onCreate, net }: { name: string; setName: (s: string) => void; onCreate: () => void; net: ReturnType<typeof useServer> }) {
  const [code, setCode] = useState('');
  // Четвёртая цифра — спрашиваем сервер, есть ли такая комната; есть — сразу входим.
  useEffect(() => { if (code.length === 4) net.send({ t: 'probe', code }); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = net.probe?.code === code ? net.probe : null;
  useEffect(() => { if (answer?.exists) navigate(code); }, [answer, code]);
  return (
    <div className="home title-screen">
      <h1>Сохрани мою речь</h1>
      <p className="subtitle">Книжное подполье СССР</p>
      <label>Как вас называть<input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Имя" /></label>
      <div className="or">Присоединитесь к игре по коду</div>
      {/* Одно поле поверх четырёх ячеек: так работают и вставка, и стирание. */}
      <label className="code-cells" aria-label="Код комнаты">
        <input value={code} onChange={(e) => setCode(codeChars(e.target.value))} inputMode="numeric" pattern="[0-9]*" autoComplete="off" spellCheck={false} />
        {[0, 1, 2, 3].map((i) => <span key={i} className={`cell ${i === Math.min(code.length, 3) ? 'cur' : ''}`}>{code[i] ?? ''}</span>)}
      </label>
      {/* Строка под сообщение есть всегда — появляясь, оно ничего не сдвигает. */}
      <p className="code-miss" aria-live="polite">{answer && !answer.exists ? `Комнаты с кодом ${code} нет.` : ''}</p>
      <p className="credit muted small">Игра Дмитрия Трубицина</p>
      {/* На ПК — по центру под вводом кода; на телефоне — на плашке внизу экрана, во всю ширину. */}
      <div className="create-bar"><button className="primary" disabled={!name.trim()} onClick={onCreate}>Создать свою игру</button></div>
    </div>
  );
}

// Качество связи игрока: три палочки — хорошая (все три, зелёные), средняя (две, жёлтые), плохая (одна, красная);
// не в сети — перечёркнутый значок. Задержка до сервера: до 250 мс — хорошо, до 800 — средне, дольше — плохо.
function Signal({ rtt }: { rtt: number | null }) {
  const level = rtt === null ? 0 : rtt <= 250 ? 3 : rtt <= 800 ? 2 : 1;
  const color = ['', '#c0392b', '#d4a017', '#1e8449'][level];
  const label = rtt === null ? 'Не в сети' : `${['', 'Плохая', 'Средняя', 'Хорошая'][level]} связь${rtt ? ` (${rtt} мс)` : ''}`;
  return (
    <span className="signal" title={label} data-tip={label} aria-label={label}>
      <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={2 + i * 6} y={10 - i * 4} width="4" height={4 + i * 4} rx="1"
            fill={i < level ? color : 'none'} stroke={i < level ? color : 'rgba(0,0,0,.3)'} strokeWidth="1" />
        ))}
        {level === 0 && <path d="M1 15L19 1" stroke="#c0392b" strokeWidth="1.8" strokeLinecap="round" />}
      </svg>
    </span>
  );
}

// Скопировать текст в буфер; done — на секунду после успешного копирования.
function useCopy(text: string): [boolean, () => void] {
  const [done, setDone] = useState(false);
  const copy = () => {
    const ok = () => { setDone(true); setTimeout(() => setDone(false), 1200); };
    // Без доступа к буферу (старый браузер, не https) — через временное поле.
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { if (document.execCommand('copy')) ok(); } catch { /* ignore */ }
      t.remove();
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  };
  return [done, copy];
}

// Ссылка на комнату: и по нажатию на саму ссылку, и по кнопке-иконке — копируется (а не открывается).
// После копирования на секунду — галочка на кнопке.
function ShareLink({ link }: { link: string }) {
  const [done, copy] = useCopy(link);
  return (
    <div className="share">
      <p>Отправьте ссылку игрокам:<br />
        <a href={link} onClick={(e) => { e.preventDefault(); copy(); }} title={done ? 'Скопировано' : 'Нажмите, чтобы скопировать'}>{link.replace(/^https?:\/\//, '')}</a>
      </p>
      <CopyButton done={done} copy={copy} />
    </div>
  );
}

// Кнопка-иконка «скопировать ссылку»; после нажатия на секунду — галочка.
function CopyButton({ done, copy }: { done: boolean; copy: () => void }) {
  return (
    <button className="icon-btn" onClick={copy} aria-label="Скопировать ссылку" title={done ? 'Скопировано' : 'Скопировать ссылку'}>
      {done ? (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <rect x="6" y="6" width="9" height="9.5" rx="1.8" /><path d="M12 6V4.3A1.8 1.8 0 0 0 10.2 2.5H4.3A1.8 1.8 0 0 0 2.5 4.3v6A1.8 1.8 0 0 0 4.3 12H6" />
        </svg>
      )}
    </button>
  );
}

function Lobby({ net, name, setName, onJoin }: { net: ReturnType<typeof useServer>; name: string; setName: (s: string) => void; onJoin: () => void }) {
  const room = net.room!;
  const seated = !!net.you || net.isHost;
  const host = net.isHost;
  const link = `${location.origin}/${encodeURIComponent(room.code)}`;
  return (
    <div className="home lobby">
      <h1 className="room-title">
        <button className="back" aria-label="Назад, в начальное меню" title="В начальное меню" onClick={() => navigate(null)}>
          <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true"><path d="M9 2L3 9l6 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        Комната {room.code}
      </h1>
      <ShareLink link={link} />
      {host && (
        <>
          <label>Режим
            <Dropdown value={room.reserve ? 'reserve' : room.mode} ariaLabel="Режим" onChange={(mode) => net.send({ t: 'setMode', mode: mode as 'beginner' })}
              options={[
                { value: 'beginner', label: 'Периферия (для начинающих)', title: 'Для первой партии: без Клуба книголюбов, Конторы, Куратора и свойств жанров.' },
                { value: 'full', label: 'Полные правила', title: 'Все правила: Клуб книголюбов, Контора, свойства жанров; среди игроков может оказаться Куратор.' },
                { value: 'reserve', label: 'Заповедник (без Конторы и Куратора)', title: 'Полные правила без прямого конфликта: нет Конторы и Куратора.' }]} />
          </label>
          <label className="row">
            <input type="checkbox" checked={room.hostBot} onChange={(e) => net.send({ t: 'hostBot', on: e.target.checked })} />
            За меня играет бот — я смотрю партию со стороны
          </label>
          <SkillSelect room={room} send={net.send} />
        </>
      )}
      {/* Кто за столом — после всех настроек. */}
      <ul className="seats">
        {room.seats.map((s, i) => (
          <li key={s.id}>
            <span className="dot" style={{ background: PLAYER_COLORS[i] }} />
            {s.bot && '🤖 '}{s.name}{s.id === room.host && ' (хост)'}
            {!s.bot && <Signal rtt={s.online ? (net.rtt[s.id] === undefined ? 0 : net.rtt[s.id]) : null} />}
            {s.bot && <PresetSelect seat={s} host={host} send={net.send} solo={room.seats.length === 1} />}
            {host && s.id !== room.host && (
              <button className="icon-btn remove" title="Убрать из-за стола" aria-label="Убрать" onClick={() => net.send({ t: 'removeSeat', seat: s.id })}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            )}
          </li>
        ))}
        {/* Свободные места — сразу (до 5 за столом): строки одной высоты, панель снизу не сдвигается. */}
        {Array.from({ length: Math.max(0, 5 - room.seats.length) }, (_, i) => (
          <li key={`empty${i}`} className="empty"><span className="dot empty" /> Пусто</li>
        ))}
      </ul>
      {!seated && !room.started && (
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" maxLength={24} />
          <button className="primary" disabled={!name.trim() || room.seats.length >= 5} onClick={onJoin}>Сесть за стол</button>
        </div>
      )}
      {host && (
        <>
          {/* На телефоне — плашка внизу экрана, как «Закончить ход» в игре. */}
          <div className="row lobby-actions">
            <button disabled={room.seats.length >= 5} onClick={() => net.send({ t: 'addBot' })}>Добавить бота</button>
            <button className="primary" disabled={room.seats.length < 1} onClick={() => net.send({ t: 'start' })}>
              Начать
            </button>
          </div>
        </>
      )}
      {seated && !host && <p className="muted">Ждём, пока хост начнёт партию…</p>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
