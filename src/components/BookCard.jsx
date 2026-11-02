import { useEffect, useMemo, useState } from 'react';
import { fetchCoverUrl } from '../lib/library.js';
import { getProgress } from '../lib/storage.js';

export default function BookCard({ book, cryptoKey, onOpen, index }) {
  const [coverUrl, setCoverUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!book.cover) return undefined;
    fetchCoverUrl(cryptoKey, book).then((url) => {
      if (alive && url) setCoverUrl(url);
    });
    return () => { alive = false; };
  }, [book.id, book.cover, cryptoKey]);

  const progress = useMemo(() => getProgress(book.id), [book.id]);
  const pct = progress && typeof progress.pct === 'number' ? Math.min(100, Math.max(0, progress.pct)) : 0;

  return (
    <article
      className="card"
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${Math.min(index, 14) * 18}ms` }}
      onClick={() => onOpen(book.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(book.id);
        }
      }}
      aria-label={`打开《${book.title}》`}
    >
      <div className="card-cover">
        <div className="cover-fallback"><span>{book.title}</span></div>
        {coverUrl && !failed && (
          <img src={coverUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        )}
        {pct >= 99.5 && <span className="card-done">已读完</span>}
        {pct > 0 && <div className="card-progress"><i style={{ width: `${pct.toFixed(1)}%` }} /></div>}
      </div>
      <div className="card-meta">
        <h3>{book.title}</h3>
        <p>{book.author || '未知作者'}</p>
      </div>
    </article>
  );
}
