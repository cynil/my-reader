import {
  deriveKey,
  decryptBytes,
  decryptJson,
  exportKeyRaw,
  importKeyRaw,
  keyFingerprint,
  bytesToBase64,
  base64ToBytes,
} from './crypto.js';
import { KEYS, storage } from './storage.js';

const BASE = import.meta.env.BASE_URL || './';
const asset = (path) => new URL(`${BASE}${path}`, document.baseURI).toString();

// 清单里存的是相对 data/ 的路径（books/x.bin、covers/y.bin），
// 这里统一补上数据根目录，避免清单里出现部署结构。
const dataFile = (path) => {
  const p = String(path || '').replace(/^\.?\//, '');
  return p.startsWith('data/') ? p : `data/${p}`;
};

export class BadKeyError extends Error {
  constructor(message = '口令不正确') {
    super(message);
    this.name = 'BadKeyError';
  }
}

let paramsCache = null;

export async function loadKeyParams() {
  if (paramsCache) return paramsCache;
  const res = await fetch(asset('data/key.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`读取密钥参数失败（HTTP ${res.status}）`);
  const params = await res.json();
  if (!params || !params.salt) throw new Error('密钥参数格式不正确');
  paramsCache = params;
  return params;
}

async function fetchBytes(path) {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`读取 ${path} 失败（HTTP ${res.status}）`);
  return new Uint8Array(await res.arrayBuffer());
}

/** 解密书目清单；清单本身也是密文，解不开即口令错误 */
export async function loadManifest(key) {
  const raw = await fetchBytes('data/library.enc');
  try {
    return await decryptJson(key, raw, 'library');
  } catch (err) {
    throw new BadKeyError();
  }
}

/** 用口令解锁：返回密钥 + 清单 */
export async function unlock(passphrase) {
  const params = await loadKeyParams();
  const key = await deriveKey(passphrase, params.salt, params.iterations);
  const library = await loadManifest(key);
  return { key, library, params };
}

/** 记住这台设备：存的是派生出的密钥本身，不是口令 */
export async function rememberKey(key, params, days = 7) {
  try {
    const raw = await exportKeyRaw(key);
    const fp = await keyFingerprint(key);
    storage.set(KEYS.unlock, {
      fp,
      salt: params.salt,
      exp: Date.now() + days * 86400000,
      key: bytesToBase64(raw),
    });
  } catch (err) { /* 忽略 */ }
}

export function forgetKey() {
  storage.remove(KEYS.unlock);
}

/** 取出记住的密钥；盐变了（换口令）就作废 */
export async function recallKey(params) {
  const saved = storage.get(KEYS.unlock, null);
  if (!saved || !saved.key || !saved.exp || saved.exp <= Date.now()) return null;
  if (saved.salt !== params.salt) return null;
  try {
    const key = await importKeyRaw(base64ToBytes(saved.key));
    const fp = await keyFingerprint(key);
    if (fp !== saved.fp) return null;
    return key;
  } catch (err) {
    return null;
  }
}

/** 取一本书并解密成 ArrayBuffer，直接交给 epub.js */
export async function fetchBookBuffer(key, book) {
  const raw = await fetchBytes(dataFile(book.file));
  try {
    return await decryptBytes(key, raw, `book:${book.id}`);
  } catch (err) {
    throw new BadKeyError('这本书解密失败，密钥可能已更换');
  }
}

const coverCache = new Map();

/** 封面同样是密文，解密后转成 blob URL */
export async function fetchCoverUrl(key, book) {
  if (!book.cover) return null;
  if (coverCache.has(book.id)) return coverCache.get(book.id);
  try {
    const raw = await fetchBytes(dataFile(book.cover));
    const plain = await decryptBytes(key, raw, `cover:${book.id}`);
    const url = URL.createObjectURL(new Blob([plain]));
    coverCache.set(book.id, url);
    return url;
  } catch (err) {
    return null;
  }
}

export function resetCaches() {
  coverCache.forEach((url) => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } });
  coverCache.clear();
  paramsCache = null;
}
