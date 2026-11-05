import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { KEYS, storage } from '../lib/storage.js';

export const DEFAULT_SETTINGS = {
  theme: 'paper',      // paper | sepia | night
  fontScale: 100,      // 80 - 200
  lineHeight: 1.75,    // 1.5 | 1.75 | 2
  fontFamily: 'serif', // serif | sans
  flow: 'paginated',   // paginated | scrolled
  site: 'auto',        // auto | light | dark
  noteMode: 'popup',   // popup | jump —— 注释弹层显示，或直接跳到原文
};

const SettingsContext = createContext(null);

function applySiteTheme(site) {
  const root = document.documentElement;
  root.dataset.site = site;
  const dark = site === 'dark' || (site === 'auto' && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#141311' : '#f4f2ee');
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => ({
    ...DEFAULT_SETTINGS,
    ...(storage.get(KEYS.settings, {}) || {}),
  }));

  useEffect(() => {
    storage.set(KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    applySiteTheme(settings.site);
    if (!window.matchMedia || settings.site !== 'auto') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applySiteTheme('auto');
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange);
    };
  }, [settings.site]);

  const update = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setSettings((prev) => ({ ...DEFAULT_SETTINGS, site: prev.site }));
  }, []);

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return ctx;
}
