/**
 * 从 EPUB 里读元数据和封面。
 * 自己解析 ZIP 中央目录（不引依赖），再走 container.xml → OPF。
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { extname, posix } from 'node:path';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']);

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('不是有效的 ZIP / EPUB 文件（未找到中央目录）');
}

export function openZip(buf) {
  const eocd = findEOCD(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: () => [...entries.keys()],
    find(name) {
      if (entries.has(name)) return name;
      const lower = name.toLowerCase();
      return [...entries.keys()].find((n) => n.toLowerCase() === lower) || null;
    },
    read(name) {
      const key = this.find(name);
      if (!key) return null;
      const entry = entries.get(key);
      const lo = entry.localOffset;
      if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOCAL) return null;
      const nameLen = buf.readUInt16LE(lo + 26);
      const extraLen = buf.readUInt16LE(lo + 28);
      const start = lo + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + entry.compSize);
      if (entry.method === 0) return Buffer.from(raw);
      if (entry.method === 8) return inflateRawSync(raw);
      return null;
    },
  };
}

/* ---------------- XML 小工具 ---------------- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch (err) { return whole; }
      }
      return whole;
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

function stripTags(text) {
  return String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '');
}

function textOf(xml, ...tags) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = xml.match(re);
    if (m) {
      const value = decodeEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
  }
  return '';
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(source))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] != null ? m[2] : m[3]);
  }
  return attrs;
}

function manifestItems(opf) {
  const items = [];
  const re = /<item\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(opf))) {
    const attrs = parseAttrs(m[1]);
    if (attrs.href) items.push(attrs);
  }
  return items;
}

function resolveHref(baseFile, href) {
  let clean = String(href).split('#')[0];
  try { clean = decodeURIComponent(clean); } catch (err) { /* 保留原样 */ }
  const baseDir = posix.dirname(baseFile);
  const joined = posix.normalize(posix.join(baseDir === '.' ? '' : baseDir, clean));
  return joined.replace(/^\.?\//, '');
}

function findCoverHref(opf, opfPath, zip) {
  const items = manifestItems(opf);
  const isImage = (item) =>
    /^image\//i.test(item['media-type'] || '') || IMAGE_EXT.has(extname(item.href || '').toLowerCase());

  let item = items.find((i) => (i.properties || '').split(/\s+/).includes('cover-image') && isImage(i)) || null;

  if (!item) {
    const re = /<meta\b([^>]*?)\/?>/gi;
    let m;
    while ((m = re.exec(opf))) {
      const attrs = parseAttrs(m[1]);
      if ((attrs.name || '').toLowerCase() === 'cover' && attrs.content) {
        const found = items.find((i) => i.id === attrs.content);
        if (found) { item = found; break; }
      }
    }
  }

  if (!item) item = items.find((i) => /cover/i.test(i.id || '') && isImage(i)) || null;
  if (!item) item = items.find((i) => /cover/i.test(i.href || '') && isImage(i)) || null;
  if (!item) return null;

  const target = resolveHref(opfPath, item.href);
  return zip.find(target) ? target : null;
}

/**
 * @param {string} filePath
 * @returns {{title:string, creator:string, language:string, cover:Buffer|null, coverName:string|null}}
 */
export function readEpubMeta(filePath) {
  const buf = readFileSync(filePath);
  const zip = openZip(buf);

  let opfPath = null;
  const containerName = zip.find('META-INF/container.xml');
  if (containerName) {
    const container = zip.read(containerName);
    if (container) {
      const m = container.toString('utf8').match(/<rootfile\b([^>]*?)\/?>/i);
      if (m) {
        const attrs = parseAttrs(m[1]);
        if (attrs['full-path']) opfPath = attrs['full-path'];
      }
    }
  }
  if (!opfPath) opfPath = zip.names().find((n) => n.toLowerCase().endsWith('.opf')) || null;
  if (!opfPath) throw new Error('找不到 OPF 文件');

  const opfBuf = zip.read(opfPath);
  if (!opfBuf) throw new Error(`OPF 文件缺失：${opfPath}`);
  const opf = opfBuf.toString('utf8');

  let cover = null;
  let coverName = null;
  try {
    const href = findCoverHref(opf, opfPath, zip);
    if (href) {
      const data = zip.read(href);
      if (data && data.length) {
        cover = data;
        coverName = href;
      }
    }
  } catch (err) { /* 封面失败不影响入库 */ }

  return {
    title: textOf(opf, 'dc:title', 'title'),
    creator: textOf(opf, 'dc:creator', 'creator'),
    language: textOf(opf, 'dc:language', 'language'),
    cover,
    coverName,
  };
}

export { IMAGE_EXT };
