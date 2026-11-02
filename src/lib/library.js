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

/** 从文件头猜图片类型：blob URL 带上正确的 MIME，Safari 之类才肯渲染 */
function sniffImageType(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 2 && b[0] === 0x3c) return 'image/svg+xml';
  return 'image/jpeg';
}

/** 封面同样是密文，解密后转成 blob URL */
export async function fetchCoverUrl(key, book) {
  if (!book.cover) return null;
  if (coverCache.has(book.id)) return coverCache.get(book.id);
  try {
    const raw = await fetchBytes(dataFile(book.cover));
    const plain = await decryptBytes(key, raw, `cover:${book.id}`);
    const bytes = new Uint8Array(plain);
    if (!bytes.length) throw new Error('解密结果为空');
    const url = URL.createObjectURL(new Blob([plain], { type: sniffImageType(bytes) }));
    coverCache.set(book.id, url);
    return url;
  } catch (err) {
    // 不要静默失败：封面是个独立的功能点，出错要能看见
    console.warn(`[cover] ${book.id} 封面加载失败：`, err && err.message ? err.message : err);
    return null;
  }
}

export function resetCaches() {
  coverCache.forEach((url) => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } });
  coverCache.clear();
  paramsCache = null;
}
