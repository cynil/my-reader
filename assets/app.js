/* ============================================================
   EPUB Reader — 前端逻辑
   依赖：assets/vendor/jszip.min.js + assets/vendor/epub.min.js
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 小工具 ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function formatSize(bytes) {
    if (!bytes || bytes < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }

  function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ---------------- 存储 ---------------- */
  const SETTINGS_KEY = 'epub-reader:settings';
  const PROGRESS_KEY = 'epub-reader:progress';

  const store = {
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

  /* epub.js 的 locations 可能有几百 KB，放 IndexedDB 更稳妥 */
  const kv = (() => {
    let dbPromise = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
        const req = indexedDB.open('epub-reader', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch(() => null);
      return dbPromise;
    }

    return {
      async get(key) {
        const db = await open();
        if (!db) return store.get(key, undefined);
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('kv', 'readonly');
            const req = tx.objectStore('kv').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          } catch (err) { resolve(undefined); }
        });
      },
      async set(key, value) {
        const db = await open();
        if (!db) { store.set(key, value); return; }
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch (err) { resolve(); }
        });
      },
    };
  })();

  /* ---------------- 设置 ---------------- */
  const DEFAULT_SETTINGS = {
    theme: 'paper',      // paper | sepia | night
    fontScale: 100,      // 80 - 200 (%)
    lineHeight: 1.75,    // 1.5 | 1.75 | 2
    fontFamily: 'serif', // serif | sans
    flow: 'paginated',   // paginated | scrolled
    site: 'auto',        // auto | light | dark
  };

  function loadSettings() {
    const saved = store.get(SETTINGS_KEY, {});
    return Object.assign({}, DEFAULT_SETTINGS, saved && typeof saved === 'object' ? saved : {});
  }

  let settings = loadSettings();

  function saveSettings() {
    store.set(SETTINGS_KEY, settings);
  }

  /* ---------------- 阅读主题 ---------------- */
  const READER_THEMES = {
    paper: { bg: '#faf8f4', fg: '#201f1c', link: '#b4552f', dim: '#7a736b', ui: '#faf8f4' },
    sepia: { bg: '#f2e8d5', fg: '#43372a', link: '#a4552f', dim: '#7b6852', ui: '#f2e8d5' },
    night: { bg: '#14161a', fg: '#c3c0b9', link: '#e08b63', dim: '#8a877f', ui: '#14161a' },
  };

  const FONT_STACKS = {
    serif: '"Songti SC","Noto Serif SC","Source Han Serif SC","SimSun",Georgia,"Times New Roman",serif',
    sans: '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif',
  };

  function buildThemeRules(s) {
    const t = READER_THEMES[s.theme] || READER_THEMES.paper;
    const family = FONT_STACKS[s.fontFamily] || FONT_STACKS.serif;
    const lh = String(s.lineHeight);
    const scale = String(s.fontScale);

    const rules = {
      html: {
        background: `${t.bg} !important`,
        'font-size': `${scale}% !important`,
      },
      body: {
        background: `${t.bg} !important`,
        color: `${t.fg} !important`,
        'font-family': `${family} !important`,
        'line-height': `${lh} !important`,
        margin: '0 !important',
        padding: '0 !important',
        'text-align': 'justify',
        'word-break': 'normal',
        'overflow-wrap': 'break-word',
        '-webkit-font-smoothing': 'antialiased',
      },
      'p, div, li, dd, dt, td, th, blockquote': {
        'line-height': `${lh} !important`,
      },
      'a, a:visited': {
        color: `${t.link} !important`,
        'text-decoration-color': `${t.link}`,
      },
      'img, svg, video': {
        'max-width': '100% !important',
        height: 'auto !important',
      },
      'pre, code, kbd, samp': {
        'white-space': 'pre-wrap',
        'word-break': 'break-word',
      },
      hr: { 'border-color': `${t.dim} !important` },
      'h1, h2, h3, h4, h5, h6': {
        color: `${t.fg} !important`,
        'line-height': '1.45 !important',
      },
      '::selection': {
        background: 'rgba(180,85,47,.22) !important',
      },
    };

    if (s.theme === 'night') {
      rules['body, div, p, span, li, td, th, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, strong, em, b, i, small'] = {
        'background-color': 'transparent !important',
        color: `${t.fg} !important`,
      };
      rules['img, svg'] = {
        'max-width': '100% !important',
        height: 'auto !important',
        filter: 'brightness(.86) contrast(.96)',
      };
    }

    return rules;
  }

  function rulesToCss(rules) {
    return Object.keys(rules)
      .map((sel) => `${sel}{${Object.keys(rules[sel]).map((k) => `${k}:${rules[sel][k]};`).join('')}}`)
      .join('\n');
  }

  function injectCss(contents, css) {
    try {
      const doc = contents && contents.document;
      if (!doc) return;
      let el = doc.getElementById('__reader_theme__');
      if (!el) {
        el = doc.createElement('style');
        el.id = '__reader_theme__';
        (doc.head || doc.documentElement).appendChild(el);
      }
      el.textContent = css;
    } catch (err) { /* 跨域内容忽略 */ }
  }

  /* ---------------- 书架状态 ---------------- */
  const state = {
    books: [],
    generatedAt: '',
    query: '',
    sort: 'added',
    ready: false,
    loadError: '',
    pushedRoute: false,
    reading: null,   // { item, book, rendition, lastLoc, lastCfi, tocHrefs }
  };

  const grid = $('#grid');
  const empty = $('#empty');
  const emptyTitle = $('#emptyTitle');
  const emptyText = $('#emptyText');
  const libraryMeta = $('#libraryMeta');
  const siteFoot = $('#siteFoot');
  const searchInput = $('#searchInput');
  const sortSelect = $('#sortSelect');

  function getProgressMap() {
    const map = store.get(PROGRESS_KEY, {});
    return map && typeof map === 'object' ? map : {};
  }

  function getProgress(id) {
    const p = getProgressMap()[id];
    return p && typeof p === 'object' ? p : null;
  }

  function setProgress(id, cfi, pct) {
    const map = getProgressMap();
    const prev = map[id] || {};
    map[id] = {
      cfi: cfi || prev.cfi || null,
      pct: typeof pct === 'number' && pct >= 0 ? pct : (prev.pct || 0),
      at: Date.now(),
    };
    store.set(PROGRESS_KEY, map);
  }

  /* ---------------- 书架加载 ---------------- */
  async function loadLibrary(opts = {}) {
    const silent = opts.silent === true;
    if (!silent) libraryMeta.textContent = '正在载入…';

    try {
      const res = await fetch('./books.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data.books) ? data.books : [];
      state.books = list.map((b) => ({
        id: String(b.id || b.path || b.href || ''),
        title: b.title || '未命名',
        author: b.author || '',
        path: b.path || b.href || '',
        cover: b.cover || '',
        size: Number(b.size) || 0,
        added: b.added || '',
      })).filter((b) => b.path && b.id);
      state.generatedAt = Array.isArray(data) ? '' : (data.generatedAt || '');
      state.loadError = '';
    } catch (err) {
      state.books = [];
      state.generatedAt = '';
      state.loadError = err && err.message ? err.message : '未知错误';
      console.warn('[reader] 读取 books.json 失败：', err);
    }

    state.ready = true;
    renderLibrary();
    renderFooter();

    if (silent) {
      toast(state.loadError ? `刷新失败：${state.loadError}` : `书架已更新，共 ${state.books.length} 本`);
    }
  }

  function renderFooter() {
    const bits = [`共 ${state.books.length} 本书`];
    if (state.generatedAt) bits.push(`清单更新于 ${formatDate(state.generatedAt)}`);
    siteFoot.textContent = bits.join(' · ');
  }

  function filteredBooks() {
    const q = state.query.trim().toLowerCase();
    let list = state.books.slice();

    if (q) {
      list = list.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        b.path.toLowerCase().includes(q)
      );
    }

    const progress = getProgressMap();

    switch (state.sort) {
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { numeric: true }));
        break;
      case 'author':
        list.sort((a, b) => (a.author || '～').localeCompare(b.author || '～', 'zh-Hans-CN') ||
          a.title.localeCompare(b.title, 'zh-Hans-CN'));
        break;
      case 'progress':
        list.sort((a, b) => {
          const pa = progress[a.id] ? (progress[a.id].pct || 0) : -1;
          const pb = progress[b.id] ? (progress[b.id].pct || 0) : -1;
          return pb - pa;
        });
        break;
      default:
        list.sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')) ||
          a.title.localeCompare(b.title, 'zh-Hans-CN'));
    }

    return list;
  }

  function cardHTML(book, index) {
    const p = getProgress(book.id);
    const pct = p && typeof p.pct === 'number' ? clamp(p.pct, 0, 100) : 0;
    const done = pct >= 99.5;
    const cover = book.cover
      ? `<img src="${esc(encodeURI(book.cover))}" alt="" loading="lazy" decoding="async" />`
      : '';

    return `
      <article class="card" role="button" tabindex="0" data-id="${esc(book.id)}"
               style="animation-delay:${Math.min(index, 14) * 18}ms"
               aria-label="打开《${esc(book.title)}》">
        <div class="card-cover">
          <div class="cover-fallback"><span>${esc(book.title)}</span></div>
          ${cover}
          ${done ? '<span class="card-done">已读完</span>' : ''}
          ${pct > 0 ? `<div class="card-progress"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
        </div>
        <div class="card-meta">
          <h3>${esc(book.title)}</h3>
          <p>${esc(book.author || formatSize(book.size) || '未知作者')}</p>
        </div>
      </article>`;
  }

  function renderLibrary() {
    const list = filteredBooks();

    if (!state.books.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      empty.hidden = false;
      if (state.loadError) {
        emptyTitle.textContent = '读不到书架清单';
        emptyText.innerHTML = `加载 <code>books.json</code> 失败（${esc(state.loadError)}）。` +
          '如果是直接双击打开的本地文件，请改用本地服务器预览：<code>node scripts/serve.mjs</code>';
        libraryMeta.textContent = '书架清单缺失';
      } else {
        emptyTitle.textContent = '书架还是空的';
        emptyText.innerHTML = '把 <code>.epub</code> 文件放进仓库的 <code>books/</code> 目录，push 之后书架会自动更新。';
        libraryMeta.textContent = '等待第一本书…';
      }
      return;
    }

    if (!list.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      empty.hidden = false;
      emptyTitle.textContent = '没有找到匹配的书';
      emptyText.textContent = '换个关键词试试，或者清空搜索框。';
      libraryMeta.textContent = `共 ${state.books.length} 本 · 筛选结果 0 本`;
      return;
    }

    empty.hidden = true;
    grid.hidden = false;
    grid.innerHTML = list.map(cardHTML).join('');

    $$('img', grid).forEach((img) => {
      img.addEventListener('error', () => img.remove(), { once: true });
    });

    const readCount = state.books.filter((b) => {
      const p = getProgress(b.id);
      return p && p.pct > 0;
    }).length;

    const bits = [`共 ${state.books.length} 本`];
    if (state.query.trim()) bits.push(`筛选出 ${list.length} 本`);
    if (readCount) bits.push(`在读 ${readCount} 本`);
    libraryMeta.textContent = bits.join(' · ');
  }

  function openFromGrid(id) {
    const item = state.books.find((b) => b.id === id);
    if (item) openBook(item);
  }

  /* ---------------- 阅读器 DOM ---------------- */
  const readerEl = $('#reader');
  const viewer = $('#viewer');
  const loadingEl = $('#loading');
  const loadingText = $('#loadingText');
  const readerTitle = $('#readerTitle');
  const readerAuthor = $('#readerAuthor');
  const progressSlider = $('#progressSlider');
  const progressLabel = $('#progressLabel');
  const pageLabel = $('#pageLabel');
  const tocDrawer = $('#tocDrawer');
  const tocList = $('#tocList');
  const settingsDrawer = $('#settingsDrawer');
  const scrim = $('#scrim');
  const toastEl = $('#toast');

  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 260);
    }, 2200);
  }

  function showLoading(text) {
    loadingText.textContent = text || '正在打开…';
    loadingEl.hidden = false;
  }

  function hideLoading() {
    loadingEl.hidden = true;
  }

  /* ---------------- 打开 / 关闭 ---------------- */
  async function openBook(item, opts = {}) {
    if (state.reading) await closeBook({ fromPop: true, keepRoute: true });

    if (!opts.fromRoute) {
      state.pushedRoute = pushRoute(item.id);
    }

    readerEl.hidden = false;
    document.body.classList.add('no-scroll');
    readerEl.dataset.rt = settings.theme;
    readerTitle.textContent = item.title;
    readerAuthor.textContent = item.author || '';
    viewer.innerHTML = '';
    progressSlider.value = 0;
    progressSlider.disabled = true;
    progressLabel.textContent = '0%';
    pageLabel.textContent = '—';
    showLoading('正在打开…');

    let rendition = null;
    let book = null;

    try {
      if (typeof window.ePub !== 'function') throw new Error('阅读器内核未加载');

      book = window.ePub(item.path);
      rendition = book.renderTo(viewer, {
        width: '100%',
        height: '100%',
        flow: settings.flow,
        spread: 'auto',
        allowScriptedContent: true,
      });

      const reading = {
        item,
        book,
        rendition,
        lastLoc: null,
        lastCfi: null,
        tocHrefs: [],
        locationsReady: false,
      };
      state.reading = reading;

      rendition.on('relocated', (loc) => {
        if (!loc || !loc.start) return;
        reading.lastLoc = loc;
        reading.lastCfi = loc.start.cfi;
        updateProgressUI();
        highlightToc(loc.start.href);
        scheduleSave();
      });

      rendition.on('rendered', () => {
        hideLoading();
      });

      attachContentHooks(rendition);

      await book.opened;

      const meta = (book.packaging && book.packaging.metadata) || {};
      if (meta.title) {
        item.title = meta.title;
        readerTitle.textContent = meta.title;
      }
      if (meta.creator) {
        item.author = String(meta.creator);
        readerAuthor.textContent = item.author;
      }

      const nav = await book.loaded.navigation.catch(() => ({ toc: [] }));
      renderToc((nav && nav.toc) || []);

      applyReaderTheme();

      const saved = getProgress(item.id);
      const startTarget = opts.startHref || (saved && saved.cfi) || null;

      let displayed = false;
      if (startTarget) {
        try {
          await rendition.display(startTarget);
          displayed = true;
        } catch (err) {
          console.warn('[reader] 恢复阅读位置失败，从头开始', err);
        }
      }
      if (!displayed) await rendition.display();

      hideLoading();
      syncSettingsUI();

      // 后台生成定位表，用于百分比进度与拖动跳转
      generateLocations(reading).catch(() => {});
    } catch (err) {
      console.error('[reader] 打开失败', err);
      const message = err && err.message ? err.message : '未知错误';
      loadingText.textContent = `这本书打不开：${message}`;
      loadingEl.hidden = false;
      setTimeout(() => {
        hideLoading();
        closeBook();
      }, 2800);
    }
  }

  function attachContentHooks(rendition) {
    rendition.hooks.content.register((contents) => {
      injectCss(contents, rulesToCss(buildThemeRules(settings)));

      const doc = contents.document;
      const win = contents.window;
      if (!doc || !win) return;

      let startX = 0;
      let startY = 0;
      let startT = 0;
      let moved = false;

      doc.addEventListener('touchstart', (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
        moved = false;
      }, { passive: true });

      doc.addEventListener('touchmove', (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) moved = true;
      }, { passive: true });

      doc.addEventListener('touchend', (e) => {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Date.now() - startT > 800) return;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          if (dx < 0) goNext(); else goPrev();
        }
      }, { passive: true });

      doc.addEventListener('click', (e) => {
        if (moved) { moved = false; return; }
        const target = e.target;
        if (target && target.closest && target.closest('a, area, button, input, textarea, select, label, [role="link"]')) return;
        const selection = win.getSelection ? String(win.getSelection() || '') : '';
        if (selection.trim()) return;

        const width = win.innerWidth || 0;
        if (!width) return;
        if (e.clientX < width * 0.25) goPrev();
        else if (e.clientX > width * 0.75) goNext();
        else toggleChrome();
      });

      doc.addEventListener('keydown', onReaderKey);
    });
  }

  async function closeBook(opts = {}) {
    const reading = state.reading;
    state.reading = null;

    if (reading) {
      saveProgressNow(reading);
      try { reading.rendition.destroy(); } catch (err) { /* noop */ }
      try { reading.book.destroy(); } catch (err) { /* noop */ }
    }

    viewer.innerHTML = '';
    readerEl.hidden = true;
    document.body.classList.remove('no-scroll');
    closeDrawers();
    hideLoading();

    if (!opts.keepRoute) {
      if (opts.fromPop) {
        // 浏览器后退已经改过地址栏，不再动历史
      } else {
        history.replaceState(null, '', location.pathname + location.search);
      }
      state.pushedRoute = false;
    }

    renderLibrary();
  }

  /* ---------------- 主题 / 设置应用 ---------------- */
  function applyReaderTheme() {
    readerEl.dataset.rt = settings.theme;
    if (!state.reading) return;
    const css = rulesToCss(buildThemeRules(settings));
    const contents = state.reading.rendition.getContents ? state.reading.rendition.getContents() : [];
    contents.forEach((c) => injectCss(c, css));
  }

  function applySiteTheme() {
    document.documentElement.dataset.site = settings.site;
    const dark = settings.site === 'dark' ||
      (settings.site === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#141311' : '#f4f2ee');
  }

  function syncSettingsUI() {
    $$('#themeSwatches .swatch').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.theme === settings.theme));
    });
    $('#fontValue').textContent = `${settings.fontScale}%`;
    $$('#lineHeightGroup button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.lh) === Number(settings.lineHeight)));
    });
    $$('#fontFamilyGroup button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.ff === settings.fontFamily));
    });
    $$('#flowGroup button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.flow === settings.flow));
    });
  }

  function updateSettings(patch, opts = {}) {
    const before = settings.flow;
    settings = Object.assign({}, settings, patch);
    saveSettings();
    syncSettingsUI();

    if (patch.site) applySiteTheme();

    if (!state.reading) return;

    if (patch.theme) {
      // 同时把界面与正文切到同一主题
      readerEl.dataset.rt = settings.theme;
    }
    applyReaderTheme();

    if (settings.flow !== before && opts.allowFlow !== false) {
      // rendition.flow() 内部会在重排后自动回到当前 cfi，无需再 display
      try { state.reading.rendition.flow(settings.flow); } catch (err) { /* noop */ }
    }
  }

  /* ---------------- 目录 ---------------- */
  function renderToc(toc) {
    if (!toc || !toc.length) {
      tocList.innerHTML = '<p class="toc-empty">这本书没有目录信息</p>';
      return;
    }

    const hrefs = [];

    const walk = (items, depth) => items.map((item) => {
      const href = item.href || '';
      if (href) hrefs.push(href);
      const label = String(item.label || '').trim() || '未命名章节';
      const children = item.subitems && item.subitems.length ? walk(item.subitems, depth + 1) : '';
      return `<button class="toc-item" data-href="${esc(href)}" style="--d:${depth}">${esc(label)}</button>${children}`;
    }).join('');

    tocList.innerHTML = walk(toc, 0);
    if (state.reading) state.reading.tocHrefs = hrefs;
  }

  function normalizeHref(href) {
    if (!href) return '';
    const clean = String(href).split('#')[0];
    try { return decodeURI(clean); } catch (err) { return clean; }
  }

  function highlightToc(href) {
    if (!href) return;
    const current = normalizeHref(href);
    const items = $$('.toc-item', tocList);
    let matched = null;
    items.forEach((el) => {
      el.classList.remove('active');
      const target = normalizeHref(el.dataset.href);
      if (!target) return;
      if (target === current || current.endsWith('/' + target) || target.endsWith('/' + current)) {
        matched = el;
      }
    });
    if (matched) {
      matched.classList.add('active');
      if (!tocDrawer.hidden) matched.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------------- 进度 ---------------- */
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProgressNow, 900);
  }

  function saveProgressNow(reading) {
    const r = reading || state.reading;
    if (!r || !r.lastCfi) return;
    const pct = currentPercent(r);
    setProgress(r.item.id, r.lastCfi, pct == null ? undefined : pct);
  }

  function currentPercent(reading) {
    const r = reading || state.reading;
    if (!r || !r.lastLoc || !r.lastLoc.start) return null;
    const cfi = r.lastLoc.start.cfi;
    try {
      if (r.book.locations && r.book.locations.length && r.book.locations.length() > 0 && cfi) {
        const p = r.book.locations.percentageFromCfi(cfi);
        if (typeof p === 'number' && p >= 0 && p <= 1) return p * 100;
      }
    } catch (err) { /* noop */ }
    const p2 = r.lastLoc.start.percentage;
    if (typeof p2 === 'number' && p2 >= 0 && p2 <= 1) return p2 * 100;
    return null;
  }

  function updateProgressUI() {
    const r = state.reading;
    if (!r || !r.lastLoc) return;

    const pct = currentPercent(r);
    const spine = r.book && r.book.spine ? r.book.spine : null;
    const total = spine && spine.length ? spine.length : 0;
    const idx = typeof r.lastLoc.start.index === 'number' ? r.lastLoc.start.index + 1 : 0;

    if (pct == null) {
      progressLabel.textContent = '—';
      progressSlider.disabled = true;
    } else {
      progressLabel.textContent = `${pct.toFixed(1)}%`;
      progressSlider.value = Math.round(pct * 10);
      progressSlider.disabled = !r.locationsReady;
    }

    if (total) pageLabel.textContent = `第 ${idx} / ${total} 章`;
    else pageLabel.textContent = '—';
  }

  async function generateLocations(reading) {
    const { book } = reading;
    if (!book.locations) return;

    const cacheKey = `loc:${reading.item.id}`;
    const cached = await kv.get(cacheKey);

    if (cached && typeof cached === 'string') {
      try {
        book.locations.load(cached);
      } catch (err) { /* 缓存损坏则重新生成 */ }
    }

    if (!book.locations.length || book.locations.length() === 0) {
      await book.locations.generate(1600);
      const saved = book.locations.save ? book.locations.save() : null;
      if (saved) kv.set(cacheKey, saved);
    }

    if (state.reading !== reading) return;
    reading.locationsReady = true;
    updateProgressUI();
  }

  /* ---------------- 翻页 ---------------- */
  function goNext() {
    const r = state.reading;
    if (!r) return;
    Promise.resolve(r.rendition.next()).catch(() => {});
  }

  function goPrev() {
    const r = state.reading;
    if (!r) return;
    Promise.resolve(r.rendition.prev()).catch(() => {});
  }

  function toggleChrome() {
    readerEl.classList.toggle('chrome-hidden');
  }

  function onReaderKey(e) {
    if (!state.reading) return;
    const key = e.key;

    if (key === 'Escape') {
      e.preventDefault();
      if (!tocDrawer.hidden || !settingsDrawer.hidden) { closeDrawers(); return; }
      if (readerEl.classList.contains('chrome-hidden')) { readerEl.classList.remove('chrome-hidden'); return; }
      closeBook();
      return;
    }
    if (!tocDrawer.hidden || !settingsDrawer.hidden) return;

    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') {
      e.preventDefault();
      goNext();
    } else if (key === 'ArrowLeft' || key === 'PageUp') {
      e.preventDefault();
      goPrev();
    } else if (key === 'f' || key === 'F') {
      e.preventDefault();
      toggleChrome();
    }
  }

  /* ---------------- 抽屉 ---------------- */
  function openDrawer(drawer) {
    closeDrawers();
    drawer.hidden = false;
    scrim.hidden = false;
    readerEl.classList.remove('chrome-hidden');
  }

  function closeDrawers() {
    tocDrawer.hidden = true;
    settingsDrawer.hidden = true;
    scrim.hidden = true;
  }

  /* ---------------- 路由 ---------------- */
  function parseRoute() {
    const hash = location.hash || '';
    const m = hash.match(/^#\/read\/(.+)$/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (err) { return ''; }
  }

  function pushRoute(id) {
    try {
      history.pushState({ id }, '', `#/read/${encodeURIComponent(id)}`);
      return true;
    } catch (err) {
      return false;
    }
  }

  function syncRoute() {
    const id = parseRoute();
    if (id) {
      if (state.reading && state.reading.item.id === id) return;
      const item = state.books.find((b) => b.id === id);
      if (item) openBook(item, { fromRoute: true });
      return;
    }
    if (state.reading) closeBook({ fromPop: true });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 书架
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) openFromGrid(card.dataset.id);
    });

    grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.card');
      if (!card) return;
      e.preventDefault();
      openFromGrid(card.dataset.id);
    });

    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      renderLibrary();
    });

    sortSelect.addEventListener('change', () => {
      state.sort = sortSelect.value;
      renderLibrary();
    });

    $('#refreshBtn').addEventListener('click', () => loadLibrary({ silent: true }));

    $('#siteThemeBtn').addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(settings.site) + 1) % order.length];
      updateSettings({ site: next });
      toast({ auto: '外观：跟随系统', light: '外观：浅色', dark: '外观：深色' }[next]);
    });

    document.addEventListener('keydown', (e) => {
      if (state.reading) { onReaderKey(e); return; }
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
    });

    // 阅读器
    $('#backBtn').addEventListener('click', () => {
      if (state.pushedRoute) history.back();
      else closeBook();
    });
    $('#tocBtn').addEventListener('click', () => {
      if (tocDrawer.hidden) openDrawer(tocDrawer); else closeDrawers();
    });
    $('#settingsBtn').addEventListener('click', () => {
      if (settingsDrawer.hidden) openDrawer(settingsDrawer); else closeDrawers();
    });
    $('#tocClose').addEventListener('click', closeDrawers);
    $('#settingsClose').addEventListener('click', closeDrawers);
    scrim.addEventListener('click', closeDrawers);

    $('#prevBtn').addEventListener('click', goPrev);
    $('#nextBtn').addEventListener('click', goNext);

    tocList.addEventListener('click', (e) => {
      const btn = e.target.closest('.toc-item');
      if (!btn || !state.reading) return;
      const href = btn.dataset.href;
      if (href) {
        Promise.resolve(state.reading.rendition.display(href)).catch(() => {});
      }
      closeDrawers();
    });

    progressSlider.addEventListener('input', () => {
      const r = state.reading;
      if (!r || !r.locationsReady) return;
      progressLabel.textContent = `${(progressSlider.value / 10).toFixed(1)}%`;
    });

    progressSlider.addEventListener('change', () => {
      const r = state.reading;
      if (!r || !r.locationsReady) return;
      const ratio = clamp(Number(progressSlider.value) / 1000, 0, 1);
      try {
        const cfi = r.book.locations.cfiFromPercentage(ratio);
        if (cfi) Promise.resolve(r.rendition.display(cfi)).catch(() => {});
      } catch (err) { /* noop */ }
    });

    // 设置项
    $('#themeSwatches').addEventListener('click', (e) => {
      const btn = e.target.closest('.swatch');
      if (btn) updateSettings({ theme: btn.dataset.theme });
    });

    $('#fontDown').addEventListener('click', () => {
      updateSettings({ fontScale: clamp(settings.fontScale - 10, 80, 200) });
    });
    $('#fontUp').addEventListener('click', () => {
      updateSettings({ fontScale: clamp(settings.fontScale + 10, 80, 200) });
    });

    $('#lineHeightGroup').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-lh]');
      if (btn) updateSettings({ lineHeight: Number(btn.dataset.lh) });
    });

    $('#fontFamilyGroup').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-ff]');
      if (btn) updateSettings({ fontFamily: btn.dataset.ff });
    });

    $('#flowGroup').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-flow]');
      if (btn) updateSettings({ flow: btn.dataset.flow });
    });

    $('#resetSettings').addEventListener('click', () => {
      settings = Object.assign({}, DEFAULT_SETTINGS, { site: settings.site });
      saveSettings();
      syncSettingsUI();
      readerEl.dataset.rt = settings.theme;
      applyReaderTheme();
      if (state.reading) {
        try { state.reading.rendition.flow(settings.flow); } catch (err) { /* noop */ }
      }
      toast('已恢复默认设置');
    });

    // 路由
    window.addEventListener('popstate', syncRoute);

    // 退出前保存
    window.addEventListener('pagehide', () => saveProgressNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveProgressNow();
    });

    // 外观跟随系统变化
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (settings.site === 'auto') applySiteTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    applySiteTheme();
    syncSettingsUI();
    bindEvents();
    await loadLibrary();

    const routed = parseRoute();
    if (routed) {
      const item = state.books.find((b) => b.id === routed);
      if (item) openBook(item, { fromRoute: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
