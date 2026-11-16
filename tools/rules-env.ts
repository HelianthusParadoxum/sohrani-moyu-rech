// Временная подмена чисел баланса для A/B-замера, без правки кода: RULES_SET="hireCost=7,extraSproutsByPlayers.5=0" npm run …
import { RULES } from '../src/engine/content';

for (const kv of (process.env.RULES_SET ?? '').split(',').filter(Boolean)) {
  // «ключ=число» или «ключ.подключ=число» (например extraSproutsByPlayers.5=0).
  const [path, v] = kv.split('=');
  const [k, sub] = path.split('.');
  if (!(k in RULES)) throw new Error(`Нет такого числа в RULES: ${k}`);
  if (sub !== undefined) ((RULES as unknown as Record<string, Record<string, unknown>>)[k])[sub] = Number(v);
  else (RULES as Record<string, unknown>)[k] = Number(v);
}
