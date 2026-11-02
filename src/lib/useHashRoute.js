import { useCallback, useEffect, useState } from 'react';

/**
 * 极简 hash 路由：#/read/<id>
 * 只有两个视图，用不着路由库；用 hash 也让 GitHub Pages 的子路径部署省心。
 */
export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '');

  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const match = /^#\/read\/(.+)$/.exec(hash);
  let bookId = null;
  if (match) {
    try { bookId = decodeURIComponent(match[1]); } catch (err) { bookId = null; }
  }

  const openBook = useCallback((id) => {
    window.location.hash = `#/read/${encodeURIComponent(id)}`;
  }, []);

  const closeBook = useCallback(() => {
    // 用 pushState 而不是 location.hash=''，避免地址栏留下孤零零的 #
    window.history.pushState(null, '', window.location.pathname + window.location.search);
    setHash('');
  }, []);

  return { hash, bookId, openBook, closeBook };
}
