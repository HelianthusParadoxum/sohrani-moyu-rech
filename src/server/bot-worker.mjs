// Запуск потока ботов: подключаем tsx (чтобы поток понимал TypeScript) и загружаем сам поток.
import { register } from 'tsx/esm/api';
register();
await import('./bot-worker.ts');
