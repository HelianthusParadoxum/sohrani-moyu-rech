// Временная подмена чисел баланса для A/B-замера, без правки кода: RULES_SET="gostorgExpand=0,hireCost=7" npm run …
import { RULES } from '../src/engine/content';

for (const kv of (process.env.RULES_SET ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in RULES)) throw new Error(`Нет такого числа в RULES: ${k}`);
  (RULES as Record<string, unknown>)[k] = Number(v);
}
