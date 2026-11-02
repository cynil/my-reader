/**
 * 加密书库的核心逻辑（被 encrypt-books.mjs 和 add-book.mjs 共用）。
 * 只做一件事：把 sources/ 里的明文 EPUB 加密进 public/data/。
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEpubMeta } from './epub.mjs';
import {
  deriveKey,
  encryptBytes,
  encryptJson,
  decryptJson,
  randomSalt,
  DEFAULT_ITERATIONS,
  FORMAT_VERSION,
} from '../../src/lib/crypto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const PATHS = {
  root: ROOT,
  sources: join(ROOT, 'sources'),
  data: join(ROOT, 'public', 'data'),
  books: join(ROOT, 'public', 'data', 'books'),
  covers: join(ROOT, 'public', 'data', 'covers'),
  key: join(ROOT, 'public', 'data', 'key.json'),
  library: join(ROOT, 'public', 'data', 'library.enc'),
};

const AAD_LIBRARY = 'library';
const AAD_BOOK = (id) => `book:${id}`;
const AAD_COVER = (id) => `cover:${id}`;

export const MIN_PASSPHRASE = 8;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function walkEpubs(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkEpubs(full, acc);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.epub') acc.push(full);
  }
  return acc;
}

const toPosix = (p) => p.split('\\').join('/');

function ensureDirs() {
  for (const dir of [PATHS.sources, PATHS.data, PATHS.books, PATHS.covers]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** 读取现有 KDF 参数；没有就生成一份 */
function readParams(rotate) {
  let salt = randomSalt();
  let iterations = DEFAULT_ITERATIONS;
  if (!rotate && existsSync(PATHS.key)) {
    try {
      const prev = JSON.parse(readFileSync(PATHS.key, 'utf8'));
      if (prev && prev.salt) salt = prev.salt;
      if (prev && prev.iterations) iterations = prev.iterations;
    } catch (err) { /* 损坏就重新生成 */ }
  }
  return { salt, iterations };
}

/**
 * @param {string} passphrase
 * @param {{ rotate?: boolean, log?: (msg: string) => void }} options
 * @returns {Promise<{count:number, added:string[], removed:string[], totalBytes:number}>}
 */
export async function encryptLibrary(passphrase, options = {}) {
  const { rotate = false, log = () => {} } = options;

  if (!passphrase || String(passphrase).length < MIN_PASSPHRASE) {
    throw new Error(`口令至少 ${MIN_PASSPHRASE} 位（它同时是解密密钥）`);
  }

  ensureDirs();

  const { salt, iterations } = readParams(rotate);

  log(`派生密钥（PBKDF2-SHA256，${iterations} 轮）…`);
  const key = await deriveKey(passphrase, salt, iterations);

  // 已有书库必须先验口令：口令打错却继续跑，会把整个书库用错的密钥重加密
  let previous = null;
  if (existsSync(PATHS.library)) {
    try {
      previous = await decryptJson(key, readFileSync(PATHS.library), AAD_LIBRARY);
    } catch (err) {
      if (!rotate) {
        throw new Error(
          '口令与现有书库不一致，已中止（public/data 没有任何改动）。\n' +
          '  确认口令后重试；如果确实要换新口令，加 --rotate 重新加密全部书籍。'
        );
      }
      log('⚠️  已指定 --rotate，将用新口令重新加密全部书籍');
    }
  }

  const prevByPath = new Map(((previous && previous.books) || []).map((b) => [b.path, b]));
  const files = walkEpubs(PATHS.sources).sort();
  log(`sources/ 里找到 ${files.length} 个 EPUB`);

  const books = [];
  const usedBooks = new Set();
  const usedCovers = new Set();
  const now = new Date().toISOString();
  const added = [];

  for (const file of files) {
    const relPath = toPosix(join('sources', file.slice(PATHS.sources.length + 1)));
    const raw = readFileSync(file);
    const srcHash = sha256(raw);
    const id = sha256(relPath).slice(0, 16);
    const prev = prevByPath.get(relPath);

    const bookOut = join(PATHS.books, `${id}.bin`);
    const coverOut = join(PATHS.covers, `${id}.bin`);
    const canReuse = prev && prev.srcHash === srcHash && existsSync(bookOut)
      && (!prev.cover || existsSync(coverOut));

    let entry;

    if (canReuse) {
      entry = { ...prev, size: raw.length };
      log(`⏭  ${prev.title}（未变化）`);
    } else {
      let meta = { title: '', creator: '', language: '', cover: null };
      let warning = '';
      try {
        meta = { ...meta, ...readEpubMeta(file) };
      } catch (err) {
        warning = err.message;
      }

      const cipher = await encryptBytes(key, raw, AAD_BOOK(id));
      writeFileSync(bookOut, Buffer.from(cipher));

      let coverPath = null;
      if (meta.cover && meta.cover.length) {
        const coverCipher = await encryptBytes(key, meta.cover, AAD_COVER(id));
        writeFileSync(coverOut, Buffer.from(coverCipher));
        coverPath = `covers/${id}.bin`;
        usedCovers.add(`${id}.bin`);
      } else if (existsSync(coverOut)) {
        rmSync(coverOut, { force: true });
      }

      entry = {
        id,
        title: meta.title || basename(file, extname(file)),
        author: meta.creator || '',
        language: meta.language || '',
        path: relPath,
        file: `books/${id}.bin`,
        cover: coverPath,
        size: raw.length,
        bytes: cipher.byteLength,
        srcHash,
        added: (prev && prev.added) || now,
        ...(warning ? { warning } : {}),
      };

      if (!prev) added.push(entry.title);
      log(`🔒 ${entry.title}${entry.author ? ` — ${entry.author}` : ''}` +
        `${coverPath ? '' : '  [无封面]'}${warning ? `  (${warning})` : ''}`);
    }

    usedBooks.add(`${id}.bin`);
    if (entry.cover) usedCovers.add(`${id}.bin`);
    books.push(entry);
  }

  books.sort((a, b) =>
    String(b.added).localeCompare(String(a.added)) || a.title.localeCompare(b.title, 'zh-Hans-CN'));

  // 清理孤儿密文（书被删掉时）
  const removed = [];
  const prevPaths = new Set(((previous && previous.books) || []).map((b) => b.path));
  const nextPaths = new Set(books.map((b) => b.path));
  prevPaths.forEach((p) => { if (!nextPaths.has(p)) removed.push(basename(p, extname(p))); });

  for (const [dir, keep] of [[PATHS.books, usedBooks], [PATHS.covers, usedCovers]]) {
    for (const name of readdirSync(dir)) {
      if (!keep.has(name)) rmSync(join(dir, name), { force: true });
    }
  }

  const payload = { v: FORMAT_VERSION, generatedAt: now, count: books.length, books };
  writeFileSync(PATHS.library, Buffer.from(await encryptJson(key, payload, AAD_LIBRARY)));
  writeFileSync(PATHS.key, `${JSON.stringify({
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    iterations,
    salt,
  }, null, 2)}\n`, 'utf8');

  return {
    count: books.length,
    added,
    removed,
    totalBytes: books.reduce((n, b) => n + (b.bytes || 0), 0),
    books,
  };
}
