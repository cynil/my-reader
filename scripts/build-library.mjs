#!/usr/bin/env node
/**
 * 扫描 books/ 目录，生成 books.json（含书名、作者、封面、大小）。
 *
 * 零依赖：只用 Node 内置模块，自带 ZIP 解析 + OPF 元数据提取。
 * 用法：node scripts/build-library.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, extname, basename, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BOOKS_DIR = join(ROOT, 'books');
const COVERS_DIR = join(ROOT, 'covers');
const OUT_FILE = join(ROOT, 'books.json');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']);
const MAX_COVER_BYTES = 3 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* ZIP 读取（只读中央目录，按需解压）                                    */
/* ------------------------------------------------------------------ */
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('不是有效的 ZIP / EPUB 文件（未找到中央目录）');
}

function openZip(buf) {
  const eocd = findEOCD(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    size: (name) => (entries.get(name) || {}).uncompSize || 0,
    /** 找名字（不区分大小写） */
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

/* ------------------------------------------------------------------ */
/* XML / OPF 解析（正则，够用且不引入依赖）                              */
/* ------------------------------------------------------------------ */
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
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '');
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
  const isImage = (item) => /^image\//i.test(item['media-type'] || '') || IMAGE_EXT.has(extname(item.href || '').toLowerCase());
  let item = null;

  // EPUB3: properties="cover-image"
  item = items.find((i) => (i.properties || '').split(/\s+/).includes('cover-image') && isImage(i)) || null;

  // EPUB2: <meta name="cover" content="item-id"/>
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

  // 兜底：id 或文件名里带 cover 的图片
  if (!item) item = items.find((i) => /cover/i.test(i.id || '') && isImage(i)) || null;
  if (!item) item = items.find((i) => /cover/i.test(i.href || '') && isImage(i)) || null;
  if (!item) return null;

  const target = resolveHref(opfPath, item.href);
  return zip.find(target) ? target : null;
}

/* ------------------------------------------------------------------ */
/* 单本书解析                                                          */
/* ------------------------------------------------------------------ */
function readEpub(filePath) {
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

  if (!opfPath) {
    // 兜底：随便找个 .opf
    opfPath = zip.names().find((n) => n.toLowerCase().endsWith('.opf')) || null;
  }

  if (!opfPath) throw new Error('找不到 OPF 文件');

  const opfBuf = zip.read(opfPath);
  if (!opfBuf) throw new Error(`OPF 文件缺失：${opfPath}`);
  const opf = opfBuf.toString('utf8');

  const title = textOf(opf, 'dc:title', 'title');
  const creator = textOf(opf, 'dc:creator', 'creator');
  const language = textOf(opf, 'dc:language', 'language');

  let cover = null;
  let coverName = null;
  try {
    const href = findCoverHref(opf, opfPath, zip);
    if (href) {
      const data = zip.read(href);
      if (data && data.length && data.length <= MAX_COVER_BYTES) {
        cover = data;
        coverName = href;
      }
    }
  } catch (err) {
    // 封面失败不影响入库
  }

  return { title, creator, language, cover, coverName };
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
function walk(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, acc);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.epub') {
      acc.push(full);
    }
  }
  return acc;
}

function toPosix(p) {
  return p.split('\\').join('/');
}

function makeId(relPath) {
  return createHash('sha1').update(relPath).digest('hex').slice(0, 16);
}

function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
function main() {
  console.log('📚 扫描书籍目录:', BOOKS_DIR);

  if (!existsSync(BOOKS_DIR)) {
    mkdirSync(BOOKS_DIR, { recursive: true });
    console.log('   已创建 books/ 目录（把 .epub 放进去）');
  }
  if (!existsSync(COVERS_DIR)) mkdirSync(COVERS_DIR, { recursive: true });

  const previous = (() => {
    try {
      const data = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
      return Array.isArray(data) ? { books: data } : data;
    } catch (err) {
      return null;
    }
  })();

  const prevByPath = new Map(
    ((previous && previous.books) || []).map((b) => [b.path, b])
  );

  const files = walk(BOOKS_DIR).sort();
  console.log(`   找到 ${files.length} 个 .epub 文件\n`);

  const books = [];
  const usedCovers = new Set();
  const now = new Date().toISOString();

  for (const file of files) {
    const relPath = toPosix(join('books', file.slice(BOOKS_DIR.length + 1)));
    const size = statSync(file).size;
    const id = makeId(relPath);
    const fallbackTitle = basename(file, extname(file));

    let info = { title: '', creator: '', language: '', cover: null, coverName: null };
    let warning = '';

    try {
      info = { ...info, ...readEpub(file) };
    } catch (err) {
      warning = err.message;
    }

    let coverPath = '';
    if (info.cover) {
      const ext = (extname(info.coverName || '') || '.jpg').toLowerCase();
      const coverFile = `${id}${IMAGE_EXT.has(ext) ? ext : '.jpg'}`;
      writeFileSync(join(COVERS_DIR, coverFile), info.cover);
      coverPath = `covers/${coverFile}`;
      usedCovers.add(coverFile);
    }

    const prev = prevByPath.get(relPath);

    books.push({
      id,
      title: info.title || fallbackTitle,
      author: info.creator || '',
      path: relPath,
      cover: coverPath,
      size,
      language: info.language || '',
      added: (prev && prev.added) || now,
      ...(warning ? { warning } : {}),
    });

    const flag = warning ? '⚠️ ' : info.cover ? '✅ ' : '⚪️ ';
    const extra = warning ? `  (${warning})` : info.cover ? '  [有封面]' : '  [无封面]';
    console.log(`${flag}${info.title || fallbackTitle}${info.creator ? ' — ' + info.creator : ''}${extra}`);
  }

  // 按添加时间倒序（新书在最前）
  books.sort((a, b) => String(b.added).localeCompare(String(a.added)) ||
    a.title.localeCompare(b.title, 'zh-Hans-CN'));

  // 清理不再使用的封面
  if (existsSync(COVERS_DIR)) {
    for (const name of readdirSync(COVERS_DIR)) {
      if (name === '.gitkeep') continue;
      if (!usedCovers.has(name)) {
        try { rmSync(join(COVERS_DIR, name), { force: true }); } catch (err) { /* noop */ }
      }
    }
  }

  const unchanged = previous && JSON.stringify(previous.books || []) === JSON.stringify(books);
  const generatedAt = unchanged && previous.generatedAt ? previous.generatedAt : now;

  const payload = {
    generatedAt,
    count: books.length,
    books,
  };

  writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`\n✨ 已生成 books.json（${books.length} 本，${unchanged ? '内容无变化' : '已更新'}）`);
  console.log(`   ${OUT_FILE}`);
}

main();
