export function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function includesAny(text, words) {
  const safe = normalizeText(text);
  return words.some((w) => w && safe.includes(w));
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomPick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function compact(arr) {
  return (Array.isArray(arr) ? arr : []).filter(Boolean);
}
