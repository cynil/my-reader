import { useMemo, useRef, useState } from 'react';
import BookCard from './BookCard.jsx';
import { BookIcon, ChevronDown, LockIcon, MoonIcon, OpenFileIcon, RefreshIcon, SearchIcon } from './Icons.jsx';
import { getProgressMap } from '../lib/storage.js';
import { useSettings } from '../lib/settings.jsx';

const SORTS = [
  { value: 'added', label: '最近添加' },
  { value: 'title', label: '书名' },
  { value: 'author', label: '作者' },
  { value: 'progress', label: '阅读进度' },
];

const SITE_LABELS = { auto: '外观：跟随系统', light: '外观：浅色', dark: '外观：深色' };

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function LibraryView({ library, cryptoKey, onOpen, onLock, onRefresh, refreshing, onOpenLocal, notice }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('added');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const { settings, update } = useSettings();

  const handleFile = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = ''; // 允许重复选择同一个文件
    if (file) onOpenLocal(file);
  };

  const handleDragOver = (event) => {
    if (!event.dataTransfer) return;
    const types = event.dataTransfer.types;
    if (types && Array.prototype.indexOf.call(types, 'Files') === -1) return;
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) onOpenLocal(file);
  };

  const allBooks = library.books || [];

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = allBooks.slice();

    if (q) {
      list = list.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q));
    }

    const progress = getProgressMap();

    switch (sort) {
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { numeric: true }));
        break;
      case 'author':
        list.sort((a, b) => (a.author || '～').localeCompare(b.author || '～', 'zh-Hans-CN')
          || a.title.localeCompare(b.title, 'zh-Hans-CN'));
        break;
      case 'progress':
        list.sort((a, b) => {
          const pa = progress[a.id] ? (progress[a.id].pct || 0) : -1;
          const pb = progress[b.id] ? (progress[b.id].pct || 0) : -1;
          return pb - pa;
        });
        break;
      default:
        list.sort((a, b) => String(b.added || '').localeCompare(String(a.added || ''))
          || a.title.localeCompare(b.title, 'zh-Hans-CN'));
    }

    return list;
  }, [allBooks, query, sort]);

  const readCount = useMemo(() => {
    const progress = getProgressMap();
    return allBooks.filter((b) => progress[b.id] && progress[b.id].pct > 0).length;
  }, [allBooks]);

  const cycleSite = () => {
    const order = ['auto', 'light', 'dark'];
    update({ site: order[(order.indexOf(settings.site) + 1) % order.length] });
  };

  const metaBits = [`共 ${allBooks.length} 本`];
  if (query.trim()) metaBits.push(`筛出 ${books.length} 本`);
  if (readCount) metaBits.push(`在读 ${readCount} 本`);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><BookIcon /></span>
          <div className="brand-text">
            <h1>我的书架</h1>
            <p>{metaBits.join(' · ')}</p>
          </div>
        </div>

        <div className="topbar-tools">
          <label className="search" htmlFor="searchInput">
            <SearchIcon />
            <input
              id="searchInput"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名 / 作者"
              autoComplete="off"
              spellCheck="false"
              aria-label="搜索书名或作者"
            />
          </label>

          <div className="select-wrap">
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序方式">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <ChevronDown />
          </div>

          <button
            type="button"
            className="icon-btn"
            onClick={cycleSite}
            title={SITE_LABELS[settings.site]}
            aria-label={SITE_LABELS[settings.site]}
          >
            <MoonIcon />
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            title="打开本地 EPUB"
            aria-label="打开本地 EPUB"
          >
            <OpenFileIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,application/epub+zip"
            className="visually-hidden"
            onChange={handleFile}
          />

          <button
            type="button"
            className={`icon-btn${refreshing ? ' spinning' : ''}`}
            onClick={onRefresh}
            disabled={refreshing}
            title="重新载入书架"
            aria-label="重新载入书架"
          >
            <RefreshIcon />
          </button>

          <button type="button" className="icon-btn" onClick={onLock} title="锁定书架" aria-label="锁定书架">
            <LockIcon />
          </button>
        </div>
      </header>

      <main
        className={`library${dragging ? ' is-dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragging && (
          <div className="drop-hint">
            <OpenFileIcon />
            <span>松开以打开本地 EPUB</span>
          </div>
        )}
        {books.length > 0 ? (
          <div className="grid">
            {books.map((book, i) => (
              <BookCard key={book.id} book={book} cryptoKey={cryptoKey} onOpen={onOpen} index={i} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <BookIcon />
            {allBooks.length === 0 ? (
              <>
                <h2>书库还是空的</h2>
                <p>把 EPUB 放进 <code>sources/</code>，然后运行加密脚本：</p>
                <pre><code>npm run encrypt -- "你的口令"</code></pre>
              </>
            ) : (
              <>
                <h2>没有找到匹配的书</h2>
                <p>换个关键词试试，或者清空搜索框。</p>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="sitefoot">
        共 {allBooks.length} 本书{library.generatedAt ? ` · 书库更新于 ${formatDate(library.generatedAt)}` : ''} · 全部内容以密文存放
        {notice ? <div className="toast show">{notice}</div> : null}
      </footer>
    </div>
  );
}
