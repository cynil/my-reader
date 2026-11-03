import { useCallback, useEffect, useRef, useState } from 'react';
import LockScreen from './components/LockScreen.jsx';
import LibraryView from './components/LibraryView.jsx';
import ReaderView from './components/ReaderView.jsx';
import {
  BadKeyError, fetchBookBuffer, forgetKey, loadKeyParams, loadManifest,
  recallKey, rememberKey, resetCaches, unlock,
} from './lib/library.js';
import { useHashRoute } from './lib/useHashRoute.js';

const FOCUS_REFRESH_MS = 30000;

const toHex = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
};

export default function App() {
  const [phase, setPhase] = useState('booting'); // booting | locked | ready | error
  const [cryptoKey, setCryptoKey] = useState(null);
  const [library, setLibrary] = useState(null);
  const [bootError, setBootError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [localBook, setLocalBook] = useState(null); // { book, buffer }
  const { bookId, openBook, closeBook } = useHashRoute();

  const noticeTimer = useRef(null);
  const showNotice = useCallback((message) => {
    setNotice(message || '');
    clearTimeout(noticeTimer.current);
    if (message) noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const params = await loadKeyParams();
        const savedKey = await recallKey(params);

        if (savedKey) {
          try {
            const manifest = await loadManifest(savedKey);
            if (cancelled) return;
            setCryptoKey(savedKey);
            setLibrary(manifest);
            setPhase('ready');
            return;
          } catch (err) {
            // 记住的密钥失效（换过口令 / 数据重新生成过）
            forgetKey();
          }
        }
        if (!cancelled) setPhase('locked');
      } catch (err) {
        if (!cancelled) {
          setBootError(err && err.message ? err.message : '加载失败');
          setPhase('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /**
   * 重新拉取清单。默认走 fresh，绕过 HTTP 缓存——
   * GitHub Pages 对所有文件发 max-age=600，不这么做书架会停在 10 分钟前的状态。
   */
  const refreshLibrary = useCallback(async () => {
    if (!cryptoKey) return false;
    setRefreshing(true);
    try {
      const manifest = await loadManifest(cryptoKey, { fresh: true });
      setLibrary(manifest);
      showNotice('');
      return true;
    } catch (err) {
      showNotice(err instanceof BadKeyError ? '口令已失效，请重新解锁' : (err && err.message) || '刷新失败');
      return false;
    } finally {
      setRefreshing(false);
    }
  }, [cryptoKey, showNotice]);

  // 切回标签页时自动检查一次（节流）
  const lastFocusRefresh = useRef(0);
  useEffect(() => {
    if (phase !== 'ready') return undefined;

    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < FOCUS_REFRESH_MS) return;
      lastFocusRefresh.current = now;
      refreshLibrary();
    };
    const onVisibility = () => { if (!document.hidden) maybeRefresh(); };

    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, refreshLibrary]);

  /** 打开本地 EPUB：直接读文件，不经过书库、不需要口令 */
  const openLocalFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.epub$/i.test(file.name)) {
      showNotice('只支持 .epub 文件');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const hex = toHex(await crypto.subtle.digest('SHA-256', buffer)).slice(0, 12);
      showNotice('');
      setLocalBook({
        book: {
          id: `local-${hex}`,
          title: file.name.replace(/\.epub$/i, ''),
          author: '',
          srcHash: hex,
          local: true,
        },
        buffer,
      });
    } catch (err) {
      showNotice(err && err.message ? `读取失败：${err.message}` : '读取失败');
    }
  }, [showNotice]);

  const handleUnlock = async (passphrase, remember) => {
    try {
      const { key, library: manifest, params } = await unlock(passphrase);
      if (remember) await rememberKey(key, params);
      setCryptoKey(key);
      setLibrary(manifest);
      setPhase('ready');
      return null;
    } catch (err) {
      if (err instanceof BadKeyError) return '口令不正确';
      return err && err.message ? err.message : '解锁失败';
    }
  };

  const handleLock = () => {
    forgetKey();
    resetCaches();
    setCryptoKey(null);
    setLibrary(null);
    setPhase('locked');
    closeBook();
  };

  const activeBook = library && bookId ? library.books.find((b) => b.id === bookId) : null;
  const getRemoteBuffer = useCallback(
    () => fetchBookBuffer(cryptoKey, activeBook),
    [cryptoKey, activeBook]
  );

  if (localBook) {
    return (
      <ReaderView
        key={localBook.book.id}
        book={localBook.book}
        getBuffer={() => Promise.resolve(localBook.buffer)}
        onClose={() => setLocalBook(null)}
      />
    );
  }

  if (phase === 'booting') {
    return (
      <div className="boot">
        <div className="spinner" />
        <p>正在载入…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="boot">
        <h2>打不开书库</h2>
        <p className="boot-msg">{bootError}</p>
        <p className="boot-hint">
          确认 <code>public/data/</code> 里有 <code>key.json</code> 和 <code>library.enc</code>；
          本地预览请用 <code>npm run dev</code>（不能用 file:// 打开）。
        </p>
      </div>
    );
  }

  if (phase === 'locked') {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  if (activeBook) {
    return (
      <ReaderView
        key={activeBook.id}
        book={activeBook}
        getBuffer={getRemoteBuffer}
        onClose={closeBook}
      />
    );
  }

  return (
    <LibraryView
      library={library}
      cryptoKey={cryptoKey}
      onOpen={openBook}
      onLock={handleLock}
      onRefresh={refreshLibrary}
      refreshing={refreshing}
      onOpenLocal={openLocalFile}
      notice={notice}
    />
  );
}
