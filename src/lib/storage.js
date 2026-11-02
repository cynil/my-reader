export const KEYS = {
  settings: 'my-reader:settings',
  progress: 'my-reader:progress',
  unlock: 'my-reader:unlock',
};

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* 忽略配额错误 */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (err) { /* noop */ }
  },
};

/* ---------------- 阅读进度 ---------------- */
export function getProgressMap() {
  const map = storage.get(KEYS.progress, {});
  return map && typeof map === 'object' ? map : {};
}

export function getProgress(id) {
  const p = getProgressMap()[id];
  return p && typeof p === 'object' ? p : null;
}

export function setProgress(id, cfi, pct) {
  const map = getProgressMap();
  const prev = map[id] || {};
  map[id] = {
    cfi: cfi || prev.cfi || null,
    pct: typeof pct === 'number' && pct >= 0 ? pct : (prev.pct || 0),
    at: Date.now(),
  };
  storage.set(KEYS.progress, map);
}
