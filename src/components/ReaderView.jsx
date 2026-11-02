import { useCallback, useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import { fetchBookBuffer } from '../lib/library.js';
import { injectCss, themeCss } from '../lib/reader-theme.js';
import { getProgress, setProgress } from '../lib/storage.js';
import { useSettings } from '../lib/settings.jsx';
import TocPanel from './TocPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import { ArrowLeft, ChevronLeft, ChevronRight } from './Icons.jsx';

// 同一次会话里复用定位表，避免每次打开都重新计算
const locationsCache = new Map();

export default function ReaderView({ book, cryptoKey, onClose }) {
  const { settings, update, reset } = useSettings();

  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const lastCfiRef = useRef(null);
  const settingsRef = useRef(settings);
  const flowRef = useRef(settings.flow);
  const saveTimerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toc, setToc] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [pct, setPct] = useState(null);
  const [draft, setDraft] = useState(null);
  const [chapter, setChapter] = useState({ index: 0, total: 0 });
  const [locationsReady, setLocationsReady] = useState(false);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author || '');
  const [activeHref, setActiveHref] = useState('');

  settingsRef.current = settings;

  const measure = useCallback((loc) => {
    const epubBook = bookRef.current;
    if (!loc || !loc.start || !epubBook) return;

    let value = null;
    try {
      if (epubBook.locations && epubBook.locations.length() > 0 && loc.start.cfi) {
        const p = epubBook.locations.percentageFromCfi(loc.start.cfi);
        if (typeof p === 'number' && p >= 0 && p <= 1) value = p * 100;
      }
    } catch (err) { /* noop */ }
    if (value == null && typeof loc.start.percentage === 'number') {
      value = loc.start.percentage * 100;
    }
    setPct(value);
    setChapter({
      index: (loc.start.index || 0) + 1,
      total: epubBook.spine ? epubBook.spine.length : 0,
    });
  }, []);

  const persist = useCallback(() => {
    const epubBook = bookRef.current;
    const cfi = lastCfiRef.current;
    if (!epubBook || !cfi) return;
    let value;
    try {
      if (epubBook.locations && epubBook.locations.length() > 0) {
        const p = epubBook.locations.percentageFromCfi(cfi);
        if (typeof p === 'number' && p >= 0 && p <= 1) value = p * 100;
      }
    } catch (err) { /* noop */ }
    setProgress(book.id, cfi, value);
  }, [book.id]);

  const goNext = useCallback(() => {
    const r = renditionRef.current;
    if (r) Promise.resolve(r.next()).catch(() => {});
  }, []);

  const goPrev = useCallback(() => {
    const r = renditionRef.current;
    if (r) Promise.resolve(r.prev()).catch(() => {});
  }, []);

  /* ---------------- 初始化：解密 → 渲染 ---------------- */
  useEffect(() => {
    let cancelled = false;
    const host = viewerRef.current;
    if (!host) return undefined;

    (async () => {
      try {
        const buffer = await fetchBookBuffer(cryptoKey, book);
        if (cancelled) return;

        const epubBook = ePub(buffer);
        bookRef.current = epubBook;

        const rendition = epubBook.renderTo(host, {
          width: '100%',
          height: '100%',
          flow: settingsRef.current.flow,
          spread: 'auto',
          allowScriptedContent: true,
        });
        renditionRef.current = rendition;

        rendition.hooks.content.register((contents) => {
          injectCss(contents, themeCss(settingsRef.current));

          const doc = contents.document;
          const win = contents.window;
          if (!doc || !win) return;

          let sx = 0;
          let sy = 0;
          let st = 0;
          let moved = false;

          doc.addEventListener('touchstart', (e) => {
            const t = e.changedTouches && e.changedTouches[0];
            if (!t) return;
            sx = t.clientX; sy = t.clientY; st = Date.now(); moved = false;
          }, { passive: true });

          doc.addEventListener('touchmove', (e) => {
            const t = e.changedTouches && e.changedTouches[0];
            if (!t) return;
            if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) moved = true;
          }, { passive: true });

          doc.addEventListener('touchend', (e) => {
            const t = e.changedTouches && e.changedTouches[0];
            if (!t) return;
            const dx = t.clientX - sx;
            const dy = t.clientY - sy;
            if (Date.now() - st > 800) return;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
              if (dx < 0) goNext(); else goPrev();
            }
          }, { passive: true });

          doc.addEventListener('click', (e) => {
            if (moved) { moved = false; return; }
            const target = e.target;
            if (target && target.closest && target.closest('a, area, button, input, textarea, select, label')) return;
            const selection = win.getSelection ? String(win.getSelection() || '') : '';
            if (selection.trim()) return;

            const width = win.innerWidth || 0;
            if (!width) return;
            if (e.clientX < width * 0.25) goPrev();
            else if (e.clientX > width * 0.75) goNext();
            else setChromeHidden((v) => !v);
          });

          // 鼠标滚轮翻页。只在左右翻页模式接管；上下滚动模式交还给浏览器。
          let wheelAcc = 0;
          let wheelLockUntil = 0;

          doc.addEventListener('wheel', (e) => {
            if (settingsRef.current.flow !== 'paginated') return;
            if (e.ctrlKey || e.metaKey) return; // 保留浏览器缩放

            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
            const dy = e.deltaY * unit;
            if (!dy) return;

            const now = Date.now();
            if (now < wheelLockUntil) {
              e.preventDefault();
              return;
            }

            wheelAcc += dy;
            if (Math.abs(wheelAcc) < 60) {
              e.preventDefault();
              return;
            }

            const forward = wheelAcc > 0;
            wheelAcc = 0;
            wheelLockUntil = now + 420;
            e.preventDefault();
            if (forward) goNext(); else goPrev();
          }, { passive: false });
        });

        rendition.on('relocated', (loc) => {
          if (!loc || !loc.start) return;
          lastCfiRef.current = loc.start.cfi;
          setActiveHref(loc.start.href || '');
          measure(loc);
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(persist, 900);
        });

        await epubBook.opened;
        if (cancelled) return;

        const meta = (epubBook.packaging && epubBook.packaging.metadata) || {};
        if (meta.title) setTitle(meta.title);
        if (meta.creator) setAuthor(String(meta.creator));

        const nav = await epubBook.loaded.navigation.catch(() => ({ toc: [] }));
        if (!cancelled) setToc((nav && nav.toc) || []);

        const saved = getProgress(book.id);
        let shown = false;
        if (saved && saved.cfi) {
          try {
            await rendition.display(saved.cfi);
            shown = true;
          } catch (err) { shown = false; }
        }
        if (!shown) await rendition.display();

        if (cancelled) return;
        setLoading(false);

        // 后台生成定位表，用于百分比与拖动跳转
        const cached = locationsCache.get(book.id);
        if (cached) {
          try { epubBook.locations.load(cached); } catch (err) { /* noop */ }
        }
        if (epubBook.locations.length() === 0) {
          await epubBook.locations.generate(1600);
          try { locationsCache.set(book.id, epubBook.locations.save()); } catch (err) { /* noop */ }
        }
        if (cancelled) return;
        setLocationsReady(true);
        try {
          const loc = rendition.currentLocation ? rendition.currentLocation() : null;
          if (loc && loc.start) measure(loc);
        } catch (err) { /* noop */ }
      } catch (err) {
        if (!cancelled) {
          setError(err && err.message ? err.message : '打开失败');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(saveTimerRef.current);
      persist();
      try { renditionRef.current?.destroy(); } catch (err) { /* noop */ }
      try { bookRef.current?.destroy(); } catch (err) { /* noop */ }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 设置生效 ---------------- */
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const css = themeCss(settings);
    const contents = rendition.getContents ? rendition.getContents() : [];
    contents.forEach((c) => injectCss(c, css));
  }, [settings]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || flowRef.current === settings.flow) return;
    flowRef.current = settings.flow;
    try { rendition.flow(settings.flow); } catch (err) { /* noop */ }
  }, [settings.flow]);

  /* ---------------- 键盘 ---------------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (drawer) { setDrawer(null); return; }
        if (chromeHidden) { setChromeHidden(false); return; }
        onClose();
        return;
      }
      if (drawer) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, chromeHidden, onClose, goNext, goPrev]);

  const jumpTo = (href) => {
    setDrawer(null);
    const rendition = renditionRef.current;
    if (rendition && href) Promise.resolve(rendition.display(href)).catch(() => {});
  };

  const commitSlider = (value) => {
    const rendition = renditionRef.current;
    const epubBook = bookRef.current;
    const target = typeof value === 'number' ? value : draft;
    if (!rendition || !epubBook || target == null) return;
    try {
      const cfi = epubBook.locations.cfiFromPercentage(Math.min(1, Math.max(0, target / 100)));
      if (cfi) Promise.resolve(rendition.display(cfi)).catch(() => {});
    } catch (err) { /* noop */ }
  };

  const sliderValue = Math.round((draft != null ? draft : (pct || 0)) * 10);

  return (
    <section className={`reader${chromeHidden ? ' chrome-hidden' : ''}`} data-rt={settings.theme}>
      <div className="reader-bar">
        <button type="button" className="icon-btn" onClick={onClose} title="返回书架 (Esc)" aria-label="返回书架">
          <ArrowLeft />
        </button>
        <div className="reader-heading">
          <strong>{title}</strong>
          <span>{author}</span>
        </div>
        <div className="reader-actions">
          <button type="button" className="text-btn" onClick={() => setDrawer((d) => (d === 'toc' ? null : 'toc'))}>
            目录
          </button>
          <button type="button" className="text-btn" onClick={() => setDrawer((d) => (d === 'settings' ? null : 'settings'))}>
            Aa
          </button>
        </div>
      </div>

      <div className="viewer" ref={viewerRef} />

      <div className="reader-foot">
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={sliderValue}
          disabled={!locationsReady}
          aria-label="阅读进度"
          onChange={(e) => setDraft(Number(e.target.value) / 10)}
          onPointerUp={(e) => commitSlider(Number(e.target.value) / 10)}
          onTouchEnd={(e) => commitSlider(Number(e.target.value) / 10)}
          onKeyUp={(e) => commitSlider(Number(e.target.value) / 10)}
        />
        <div className="foot-meta">
          <span>{draft != null ? `${(draft).toFixed(1)}%` : (pct == null ? '—' : `${pct.toFixed(1)}%`)}</span>
          <span className="foot-dot">·</span>
          <span>{chapter.total ? `第 ${chapter.index} / ${chapter.total} 章` : '—'}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn small" onClick={goPrev} title="上一页 (←)" aria-label="上一页">
            <ChevronLeft />
          </button>
          <button type="button" className="icon-btn small" onClick={goNext} title="下一页 (→)" aria-label="下一页">
            <ChevronRight />
          </button>
        </div>
      </div>

      {drawer && <div className="scrim" onClick={() => setDrawer(null)} />}

      {drawer === 'toc' && (
        <TocPanel toc={toc} activeHref={activeHref} onSelect={jumpTo} onClose={() => setDrawer(null)} />
      )}

      {drawer === 'settings' && (
        <SettingsPanel
          settings={settings}
          onUpdate={update}
          onReset={reset}
          onClose={() => setDrawer(null)}
        />
      )}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>正在解密并打开…</p>
        </div>
      )}

      {error && (
        <div className="loading">
          <p>这本书打不开：{error}</p>
          <button type="button" className="ghost-btn" onClick={onClose}>返回书架</button>
        </div>
      )}
    </section>
  );
}
