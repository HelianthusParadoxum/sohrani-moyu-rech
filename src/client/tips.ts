// Подсказки. На ПК — обычный title при наведении. На телефоне — удержание пальцем на элементе с data-tip:
// всплывает окошко с текстом; нажатие, которым была вызвана подсказка, не срабатывает как клик.
const HOLD_MS = 450;
let timer: ReturnType<typeof setTimeout> | undefined;
let tip: HTMLDivElement | null = null;
let start: { x: number; y: number } | null = null;
let swallowClick = false;

function hide() {
  clearTimeout(timer);
  tip?.remove();
  tip = null;
}

function show(text: string, x: number, y: number) {
  hide();
  tip = document.createElement('div');
  tip.className = 'touch-tip';
  tip.textContent = text;
  document.body.appendChild(tip);
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
  tip.style.top = `${y - h - 16 > 8 ? y - h - 16 : y + 24}px`;
  timer = setTimeout(hide, 6000);
}

document.addEventListener('touchstart', (e) => {
  hide();
  swallowClick = false;
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
  if (!el?.dataset.tip) return;
  const t = e.touches[0];
  start = { x: t.clientX, y: t.clientY };
  const text = el.dataset.tip;
  timer = setTimeout(() => { show(text, start!.x, start!.y); swallowClick = true; }, HOLD_MS);
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10 && !tip) clearTimeout(timer);
}, { passive: true });

document.addEventListener('touchend', () => { if (!tip) clearTimeout(timer); start = null; }, { passive: true });

// Клик, завершающий долгое нажатие, — не действие.
document.addEventListener('click', (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.preventDefault();
  e.stopPropagation();
}, true);

// Долгое нажатие на Android вызывает контекстное меню — на элементах с подсказкой его не показываем.
document.addEventListener('contextmenu', (e) => {
  if ((e.target as Element | null)?.closest('[data-tip]')) e.preventDefault();
});
