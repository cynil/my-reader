/**
 * EPUB 注释/脚注的识别与提取。
 *
 * 不同书里注释的写法差异很大：
 *   - EPUB3 规范：<a epub:type="noteref" href="#n1">，目标 <aside epub:type="footnote" id="n1">
 *   - EPUB2/Calibre：<a href="#fn1">1</a>，目标 <p id="fn1"> 或 <div class="footnote">
 *   - 也有的把注释集中放在 notes.xhtml，链接是跨文件的
 * 这里用「链接特征 + 目标 id 命名」做启发式判断，宁可作为注释处理。
 */

// 目标 id 的常见写法：fn1 / _ftn1 / ftn-2 / foot-87 / note3 / endnote4 / 注5 …
const NOTE_ID = /^[-_]?(fn|ftn|foot|footnote|endnote|note|noteref|zhu|n|注)([-_.]?\d+)?$/i;
// 只要 id 里含这些词并且带数字，也当作注释（如 foot-87、note_2、EndNote12）
const NOTE_WORD = /(foot|note|endnote|noteref)/i;
const EXTERNAL = /^(https?:|mailto:|tel:|data:|javascript:)/i;

const safeDecode = (value) => {
  try { return decodeURIComponent(value); } catch (err) { return value; }
};

/** 目标元素本身（含最近几层祖先）像不像一段注释 */
function elementLooksLikeNote(el) {
  if (!el) return false;

  let node = el;
  let depth = 0;
  while (node && depth < 4) {
    const type = (node.getAttribute ? node.getAttribute('epub:type') : '') || '';
    if (type.toLowerCase().includes('note')) return true;

    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'aside') return true;

    const className = typeof node.className === 'string'
      ? node.className
      : (node.getAttribute ? node.getAttribute('class') : '') || '';
    const id = node.id || '';
    // 注释的语义常常写在父级上：<p class="ft"><a id="id1a">[1]</a> 正文…</p>
    if (NOTE_WORD.test(className) || NOTE_WORD.test(id) || /\bft\b/i.test(className)) return true;

    node = node.parentElement;
    depth += 1;
  }

  if (el.closest && el.closest('aside')) return true;
  return false;
}

/**
 * 这个链接是不是指向注释。
 * 优先看目标元素本身（同文件时能直接取到），取不到再退回 id 命名规则。
 */
export function isNoteLink(anchor, href, doc) {
  if (!href || !href.includes('#')) return false;
  if (EXTERNAL.test(href)) return false;

  const type = (anchor.getAttribute('epub:type') || anchor.getAttribute('type') || '').toLowerCase();
  if (type.includes('noteref')) return true;

  const fragment = safeDecode(href.split('#')[1] || '');
  if (!fragment) return false;

  // 1) 目标就在当前文档里：直接看它长得像不像注释
  if (doc) {
    const target = doc.getElementById(fragment);
    if (target && elementLooksLikeNote(target)) return true;
  }

  // 2) 目标在别的文件里，或取不到：退回命名规则
  if (NOTE_ID.test(fragment)) return true;
  if (NOTE_WORD.test(fragment) && /\d/.test(fragment)) return true;

  // 3) 链接自身的 class
  const className = typeof anchor.className === 'string' ? anchor.className : '';
  if (NOTE_WORD.test(className)) return true;

  // 4) 链接文字就是个短数字（「87」「[3]」这种），且指向文档内锚点 —— 最常见的脚注标记
  const text = (anchor.textContent || '').trim();
  if (/^[[(（【]?\d{1,4}[\])）】]?$/.test(text)) return true;

  return false;
}

/** 把相对路径解析成与 spine 一致的 posix 路径 */
export function resolveHrefPath(baseHref, path) {
  try {
    const base = baseHref || '';
    const url = new URL(path, `https://epub.local/${base}`);
    return url.pathname.replace(/^\//, '');
  } catch (err) {
    return null;
  }
}

function findByName(doc, name) {
  const nodes = doc.querySelectorAll('[name]');
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].getAttribute('name') === name) return nodes[i];
  }
  return null;
}

const BLOCK_TAGS = new Set(['P', 'LI', 'DIV', 'ASIDE', 'DD', 'DT', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'TD']);

/**
 * 取出真正承载注释正文的元素。
 *
 * 注释的 id 往往挂在行内锚点上，正文却在它所在的段落里：
 *   <p class="notecontent"><a id="zhu1" href="...#zw1">[1]</a> 注释正文…</p>
 * 所以行内目标要往上找到块级祖先，否则只能抓到「[1]」两个字。
 */
function pickContent(el) {
  const tag = (el.tagName || '').toUpperCase();
  if (BLOCK_TAGS.has(tag)) return el;

  let node = el.parentElement;
  while (node) {
    const name = (node.tagName || '').toUpperCase();
    if (name === 'BODY' || name === 'HTML') break;
    if (BLOCK_TAGS.has(name)) return node;
    node = node.parentElement;
  }

  // 没有块级祖先（锚点直接挂在 body 下）：有文字就用它自己，
  // 否则向上找一个有文字的元素，但不许越过 body
  if ((el.textContent || '').trim()) return el;
  node = el.parentElement;
  while (node && !(node.textContent || '').trim()) node = node.parentElement;
  if (!node) return el;
  const last = (node.tagName || '').toUpperCase();
  return (last === 'BODY' || last === 'HTML') ? el : node;
}

const normalizePath = (value) => String(value || '').replace(/^\.?\//, '').replace(/\\/g, '/');

/** 两个路径是否指向同一个文件（容忍目录前缀与 ./ 写法差异） */
function sameFile(a, b) {
  const left = normalizePath(a);
  const right = normalizePath(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const baseOf = (p) => p.split('/').pop();
  return baseOf(left) === baseOf(right) && (left.endsWith(`/${right}`) || right.endsWith(`/${left}`));
}

/**
 * 找到注释内容所在的元素。
 * loadSection(path) 由调用方提供，用来加载跨文件的注释页。
 */
export async function resolveNoteElement({ href, doc, baseHref, loadSection }) {
  const [rawPath, rawFragment] = href.split('#');
  const fragment = safeDecode(rawFragment || '');
  if (!fragment) return null;

  // 调用方可能给回 Document，也可能给回 documentElement
  const asDocument = (candidate) => {
    if (!candidate) return null;
    if (typeof candidate.getElementById === 'function') return candidate;
    return candidate.ownerDocument || null;
  };

  let targetDoc = asDocument(doc);

  // 链接常常写成「本章文件名#锚点」，实际就在当前文档里。
  // 这种情况必须直接用当前文档，否则要白白走一次加载，失败就变成"点了没反应"。
  if (rawPath) {
    const resolved = resolveHrefPath(baseHref, rawPath);
    if (resolved && !sameFile(resolved, baseHref)) {
      const loaded = asDocument(await loadSection(resolved));
      if (loaded) targetDoc = loaded;
    }
  }

  if (!targetDoc) return null;
  const el = targetDoc.getElementById(fragment) || findByName(targetDoc, fragment);
  return el ? pickContent(el) : null;
}

/** 去掉脚本、事件属性和危险 URL，其余保留 */
export function sanitizeFragment(node) {
  node.querySelectorAll('script, style, link, iframe, object, embed, form, input, button, textarea')
    .forEach((n) => n.remove());

  node.querySelectorAll('*').forEach((n) => {
    Array.prototype.slice.call(n.attributes || []).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        n.removeAttribute(attr.name);
        return;
      }
      if (name === 'href' || name === 'src' || name === 'xlink:href') {
        if (EXTERNAL.test((attr.value || '').trim())) n.removeAttribute(attr.name);
      }
    });
  });
  return node;
}

/** 提取一段可直接渲染的 HTML */
export function extractNoteHtml(el) {
  const clone = el.cloneNode(true);

  // 去掉「返回正文」的回跳链接
  clone.querySelectorAll('a[href^="#"]').forEach((a) => {
    const text = (a.textContent || '').trim();
    if (!text || /^[↩⤴↑^⌃]|返回|back|return/i.test(text)) a.remove();
  });

  sanitizeFragment(clone);
  return clone.innerHTML.trim();
}
