#!/usr/bin/env node
/**
 * 把 sources/ 里的明文 EPUB 加密成 public/data/ 下的密文。
 *
 *   node scripts/encrypt-books.mjs "口令"
 *   '口令' | node scripts/encrypt-books.mjs -     # 口令不进 shell 历史
 *   node scripts/encrypt-books.mjs --verify "口令"  # 只校验能否解开现有数据
 *   node scripts/encrypt-books.mjs "新口令" --rotate  # 换口令并全部重新加密
 *
 * 产物（可以安全地提交到公开仓库）：
 *   public/data/key.json          KDF 参数 + 盐（明文，必须公开）
 *   public/data/library.enc       加密后的书目清单
 *   public/data/books/<id>.bin    加密后的 EPUB
 *   public/data/covers/<id>.bin   加密后的封面
 *
 * 明文书籍只留在 sources/，该目录已被 .gitignore 忽略。
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, basename, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEpubMeta } from './lib/epub.mjs';
import {
  deriveKey,
  encryptBytes,
  encryptJson,
  decryptJson,
  randomSalt,
  DEFAULT_ITERATIONS,
  FORMAT_VERSION,
} from '../src/lib/crypto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'sources');
const DATA_DIR = join(ROOT, 'public', 'data');
const BOOKS_OUT = join(DATA_DIR, 'books');
const COVERS_OUT = join(DATA_DIR, 'covers');
const KEY_FILE = join(DATA_DIR, 'key.json');
const LIB_FILE = join(DATA_DIR, 'library.enc');

const AAD_LIBRARY = 'library';
const AAD_BOOK = (id) => `book:${id}`;
const AAD_COVER = (id) => `cover:${id}`;

/* ---------------- 参数 ---------------- */
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

function readStdin() {
  return new Promise((done) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => done(data.replace(/[\r\n]+$/, '')));
  });
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.epub') acc.push(full);
  }
  return acc;
}

const toPosix = (p) => p.split('\\').join('/');

/* ---------------- 主流程 ---------------- */
async function main() {
  let passphrase = positional[0];
  if (passphrase === '-') passphrase = await readStdin();

  if (!passphrase) {
    console.error('用法：node scripts/encrypt-books.mjs "口令"');
    console.error('     \'口令\' | node scripts/encrypt-books.mjs -');
    console.error('     node scripts/encrypt-books.mjs --verify "口令"');
    process.exitCode = 1;
    return;
  }
  if (String(passphrase).length < 8) {
    console.error('✗ 口令至少 8 位（它同时是解密密钥，短了不安全）');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(BOOKS_OUT)) mkdirSync(BOOKS_OUT, { recursive: true });
  if (!existsSync(COVERS_OUT)) mkdirSync(COVERS_OUT, { recursive: true });

  /* --- KDF 参数：优先沿用已有盐，避免每次都换 --- */
  let salt = randomSalt();
  let iterations = DEFAULT_ITERATIONS;

  if (existsSync(KEY_FILE)) {
    try {
      const prev = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
      if (prev && prev.salt) salt = prev.salt;
      if (prev && prev.iterations) iterations = prev.iterations;
    } catch (err) { /* 损坏就重新生成 */ }
  }
  if (flags.has('--rotate')) salt = randomSalt();

  process.stdout.write(`派生密钥（PBKDF2-SHA256，${iterations} 轮）…`);
  const key = await deriveKey(passphrase, salt, iterations);
  console.log(' ok');

  /* --- 解密旧清单，用于保留 added 与增量跳过 --- */
  let previous = null;
  if (existsSync(LIB_FILE)) {
    try {
      previous = await decryptJson(key, readFileSync(LIB_FILE), AAD_LIBRARY);
    } catch (err) {
      if (flags.has('--verify')) {
        console.error('✗ 口令不正确（或数据已损坏）');
        process.exitCode = 1;
        return;
      }
      console.warn('⚠️  旧清单无法用这个口令解开，将重新加密全部书籍');
    }
  }

  if (flags.has('--verify')) {
    if (!previous) {
      console.error('✗ 没有可校验的数据（public/data/library.enc 不存在）');
      process.exitCode = 1;
      return;
    }
    console.log(`✓ 口令正确，清单里共 ${previous.books.length} 本`);
    previous.books.slice(0, 20).forEach((b) => console.log(`   · ${b.title}`));
    return;
  }

  const prevByPath = new Map(((previous && previous.books) || []).map((b) => [b.path, b]));

  if (!existsSync(SOURCE_DIR)) mkdirSync(SOURCE_DIR, { recursive: true });
  const files = walk(SOURCE_DIR).sort();
  console.log(`\n📚 sources/ 里找到 ${files.length} 个 EPUB\n`);

  const books = [];
  const usedBooks = new Set();
  const usedCovers = new Set();
  const now = new Date().toISOString();

  for (const file of files) {
    const relPath = toPosix(join('sources', file.slice(SOURCE_DIR.length + 1)));
    const raw = readFileSync(file);
    const srcHash = sha256(raw);
    const id = sha256(relPath).slice(0, 16);
    const prev = prevByPath.get(relPath);

    const bookOut = join(BOOKS_OUT, `${id}.bin`);
    const coverOut = join(COVERS_OUT, `${id}.bin`);
    const canReuse = prev && prev.srcHash === srcHash && existsSync(bookOut) &&
      (!prev.cover || existsSync(coverOut));

    let entry;

    if (canReuse) {
      entry = { ...prev, size: raw.length };
      console.log(`⏭  ${prev.title}（未变化）`);
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

      const flag = warning ? '⚠️ ' : coverPath ? '🔒 ' : '🔒 ';
      console.log(`${flag}${entry.title}${entry.author ? ' — ' + entry.author : ''}` +
        `${coverPath ? '' : '  [无封面]'}${warning ? '  (' + warning + ')' : ''}`);
    }

    usedBooks.add(`${id}.bin`);
    if (entry.cover) usedCovers.add(`${id}.bin`);
    books.push(entry);
  }

  books.sort((a, b) =>
    String(b.added).localeCompare(String(a.added)) || a.title.localeCompare(b.title, 'zh-Hans-CN'));

  /* --- 清理孤儿文件 --- */
  for (const [dir, keep] of [[BOOKS_OUT, usedBooks], [COVERS_OUT, usedCovers]]) {
    for (const name of readdirSync(dir)) {
      if (!keep.has(name)) rmSync(join(dir, name), { force: true });
    }
  }

  /* --- 写清单与 KDF 参数 --- */
  const payload = { v: FORMAT_VERSION, generatedAt: now, count: books.length, books };
  const encrypted = await encryptJson(key, payload, AAD_LIBRARY);
  writeFileSync(LIB_FILE, Buffer.from(encrypted));
  writeFileSync(KEY_FILE, `${JSON.stringify({
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    iterations,
    salt,
  }, null, 2)}\n`, 'utf8');

  const total = books.reduce((n, b) => n + (b.bytes || 0), 0);
  console.log(`\n✅ 已加密 ${books.length} 本，密文合计 ${(total / 1048576).toFixed(2)} MB`);
  console.log(`   ${LIB_FILE}`);
  console.log(`   ${KEY_FILE}`);
  console.log('\n   下一步：npm run build → git add public/data && git commit && git push');
  console.log('   提示：sources/ 是明文，已在 .gitignore 里，不要提交。');
}

main().catch((err) => {
  console.error('\n✗ 失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
