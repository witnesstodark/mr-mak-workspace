export const workerEfforts = ['medium', 'high', 'xhigh', 'max'];
export const defaultWorkerEffort = 'xhigh';

export function explicitMax(text = '') {
  const value = String(text).toLowerCase();
  const requested = /\bmax(?:imum)?[\s-]+(?:effort|reasoning)\b|\b(?:effort|reasoning)\s*(?:[:=]|to|на)?\s*max\b|(?:режим(?:е|ом)?|усили(?:ем|ями|я)|используй|use)\s+max\b|максимальн[а-я]*\s+(?:effort|эффорт|усили|reasoning|рассужден)/giu;
  for (const match of value.matchAll(requested)) {
    const before = value.slice(Math.max(0, match.index - 45), match.index);
    if (!/(?:\b(?:not|never|without|no)\b|(?:^|\s)(?:не|без))[^.!?;]{0,40}$/iu.test(before)) return true;
  }
  return false;
}

export function taskEffort(request = '', preferred) {
  if (explicitMax(request)) return 'max';
  if (preferred === 'max') return 'xhigh';
  if (['medium', 'high', 'xhigh'].includes(preferred)) return preferred;
  if (/research|исследова|рес[её]рч|ресерч|глубок(?:ий|ое)|архитектур|сложн/iu.test(request)) return 'xhigh';
  if (/implement|реализ|разработ|интеграц|debug|отлад|рефактор/iu.test(request)) return 'high';
  return 'medium';
}
