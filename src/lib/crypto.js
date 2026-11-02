/**
 * 加密层：浏览器与 Node 共用（两边都提供 globalThis.crypto.subtle）。
 *
 * 约定
 *   - 口令 → PBKDF2-SHA256 → AES-256-GCM 密钥
 *   - 每个密文：12 字节随机 IV + 密文 + 16 字节 GCM tag
 *   - AAD 把密文和用途绑死，挪用到别处会解密失败
 *   - 密钥错误或密文被改，GCM 校验失败会抛错 —— 这同时就是口令验证
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const FORMAT_VERSION = 1;
export const DEFAULT_ITERATIONS = 310000;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

function cryptoApi() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('当前环境不支持 WebCrypto，请用 HTTPS 或 localhost 打开');
  }
  return c;
}

function subtle() {
  return cryptoApi().subtle;
}

export function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomSalt() {
  return toHex(cryptoApi().getRandomValues(new Uint8Array(16)));
}

/** 口令 → AES-GCM 密钥（extractable，便于"记住这台设备"） */
export async function deriveKey(passphrase, saltHex, iterations = DEFAULT_ITERATIONS) {
  const s = subtle();
  const material = await s.importKey(
    'raw',
    encoder.encode(String(passphrase).normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return s.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromHex(saltHex),
      iterations: Math.max(10000, Number(iterations) || DEFAULT_ITERATIONS),
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

function aadBytes(aad) {
  return aad == null ? undefined : encoder.encode(String(aad));
}

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('只支持 ArrayBuffer / Uint8Array');
}

export async function encryptBytes(key, data, aad) {
  const s = subtle();
  const iv = cryptoApi().getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await s.encrypt({ name: 'AES-GCM', iv, additionalData: aadBytes(aad) }, key, asBytes(data));
  const out = new Uint8Array(IV_BYTES + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), IV_BYTES);
  return out;
}

export async function decryptBytes(key, payload, aad) {
  const s = subtle();
  const bytes = asBytes(payload);
  if (bytes.byteLength < IV_BYTES + TAG_BYTES) throw new Error('密文长度异常');
  const iv = bytes.subarray(0, IV_BYTES);
  const body = bytes.subarray(IV_BYTES);
  return s.decrypt({ name: 'AES-GCM', iv, additionalData: aadBytes(aad) }, key, body);
}

export async function encryptJson(key, value, aad) {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)), aad);
}

export async function decryptJson(key, payload, aad) {
  const buf = await decryptBytes(key, payload, aad);
  return JSON.parse(decoder.decode(buf));
}

/** 导出原始密钥（32 字节），用于 localStorage 记住解锁状态 */
export async function exportKeyRaw(key) {
  return new Uint8Array(await subtle().exportKey('raw', key));
}

export async function importKeyRaw(raw) {
  const s = subtle();
  return s.importKey('raw', asBytes(raw), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** 给验证器做指纹用：密钥变了，记住的解锁记录就失效 */
export async function keyFingerprint(key) {
  const raw = await exportKeyRaw(key);
  const digest = await subtle().digest('SHA-256', raw);
  return toHex(new Uint8Array(digest)).slice(0, 16);
}

export function bytesToBase64(bytes) {
  const b = asBytes(bytes);
  if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    binary += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(text), 'base64'));
  const binary = atob(String(text));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export { encoder as textEncoder, decoder as textDecoder };
