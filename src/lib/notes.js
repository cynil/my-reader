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

/** 目标元素本身像不像一段注释 */
function elementLooksLikeNote(el) {
  if (!el) return false;
  const type = (el.getAttribute('epub:type') || '').toLowerCase();
  if (type.includes('note')) return true;

  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'aside') return true;
  if (el.closest && el.closest('aside')) return true;

  const className = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
  return NOTE_WORD.test(className);
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

/** 目标常常是个空锚点，往上找第一个有文字的元素 */
function nearestContent(el) {
  if ((el.textContent || '').trim()) return el;
  let node = el.parentElement;
  while (node && !(node.textContent || '').trim()) node = node.parentElement;
  return node || el;
}

/**
 * 找到注释内容所在的元素。
 * loadSection(path) 由调用方提供，用来加载跨文件的注释页。
 */
export async function resolveNoteElement({ href, doc, baseHref, loadSection }) {
  const [rawPath, rawFragment] = href.split('#');
  const fragment = safeDecode(rawFragment || '');
  if (!fragment) return null;

  let targetDoc = doc;
  if (rawPath) {
    const resolved = resolveHrefPath(baseHref, rawPath);
    if (!resolved) return null;
    targetDoc = await loadSection(resolved);
    if (!targetDoc) return null;
  }

  const el = targetDoc.getElementById(fragment) || findByName(targetDoc, fragment);
  return el ? nearestContent(el) : null;
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
