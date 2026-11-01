#!/usr/bin/env node
/**
 * 生成/更换访问密钥的验证器（assets/auth.js）。
 *
 *   node scripts/make-key.mjs "我的密钥"        # 生成或更换
 *   echo "我的密钥" | node scripts/make-key.mjs -   # 同上，但密钥不进 shell 历史
 *   node scripts/make-key.mjs --verify "我的密钥"   # 只校验，不写文件
 *   node scripts/make-key.mjs --remove          # 关闭门禁
 *
 * 原理：仓库里只放 salt + PBKDF2-SHA256(密钥, salt, 210000 轮) 的哈希。
 * 哈希不能反推出密钥，但**弱口令可以被暴力猜到**，请用长一点的随机短语。
 */

import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_FILE = join(ROOT, 'assets', 'auth.js');
const DEFAULT_ITERATIONS = 210000;

/* ---------------- 参数 ---------------- */
const args = process.argv.slice(2);
const opts = {};
const positional = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--remove') {
    opts.remove = true;
  } else if (arg === '--verify') {
    opts.verify = args[i + 1];
    i += 1;
  } else if (arg === '--iterations') {
    opts.iterations = Number(args[i + 1]);
    i += 1;
  } else {
    positional.push(arg);
  }
}

function readStdin() {
  return new Promise((done) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => done(data.replace(/[\r\n]+$/, '')));
  });
}

function derive(passphrase, saltHex, iterations) {
  return pbkdf2Sync(
    passphrase.normalize('NFKC'),
    Buffer.from(saltHex, 'hex'),
    iterations,
    32,
    'sha256'
  ).toString('hex');
}

function loadExisting() {
  try {
    const src = readFileSync(AUTH_FILE, 'utf8');
    const m = src.match(/window\.READER_AUTH\s*=\s*(\{[\s\S]*?\});?\s*$/);
    if (!m) return null;
    return JSON.parse(m[1]);
  } catch (err) {
    return null;
  }
}

function writeAuth(config) {
  const header = `/* 访问密钥验证器 —— 由 scripts/make-key.mjs 自动生成
 * 这里只有 salt 和 PBKDF2 哈希，不含明文密钥。
 * 换钥：node scripts/make-key.mjs "新密钥"
 * 关闭：node scripts/make-key.mjs --remove
 */
`;
  const body = config
    ? `window.READER_AUTH = ${JSON.stringify(config, null, 2)};\n`
    : 'window.READER_AUTH = null;\n';
  writeFileSync(AUTH_FILE, header + body, 'utf8');
}

/* ---------------- 主流程 ---------------- */
async function main() {
  if (opts.verify) {
    const existing = loadExisting();
    if (!existing) {
      console.error('✗ 当前没有启用门禁（assets/auth.js 里是 null）');
      process.exitCode = 1;
      return;
    }
    const candidate = derive(opts.verify, existing.salt, existing.iterations || DEFAULT_ITERATIONS);
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(existing.hash, 'hex');
    const ok = a.length === b.length && timingSafeEqual(a, b);
    console.log(ok ? '✓ 密钥正确' : '✗ 密钥不匹配');
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (opts.remove) {
    writeAuth(null);
    console.log('✓ 已关闭门禁，assets/auth.js 重置为 null');
    console.log('  记得提交：git add assets/auth.js && git commit -m "chore: 关闭门禁"');
    return;
  }

  let passphrase = positional[0];

  if (passphrase === '-') {
    passphrase = await readStdin();
  }

  if (!passphrase) {
    console.error('用法：node scripts/make-key.mjs "你的密钥"');
    console.error('     echo "你的密钥" | node scripts/make-key.mjs -');
    console.error('     node scripts/make-key.mjs --remove');
    process.exitCode = 1;
    return;
  }

  const pass = String(passphrase);
  if (pass.length < 6) {
    console.error('✗ 密钥太短了，至少 6 位；建议 12 位以上的一句话或随机串');
    process.exitCode = 1;
    return;
  }

  const iterations = Number.isFinite(opts.iterations) && opts.iterations > 0
    ? Math.max(10000, Math.floor(opts.iterations))
    : DEFAULT_ITERATIONS;
  const salt = randomBytes(16).toString('hex');
  const hash = derive(pass, salt, iterations);

  writeAuth({ salt, hash, iterations });

  const strength = pass.length >= 16 ? '强' : pass.length >= 10 ? '中' : '偏弱';
  console.log('✓ 门禁已启用');
  console.log(`  文件      ${AUTH_FILE}`);
  console.log(`  盐值      ${salt}`);
  console.log(`  轮数      ${iterations}`);
  console.log(`  密钥长度  ${pass.length} 位（${strength}）`);
  console.log('');
  console.log('  下一步：');
  console.log('    git add assets/auth.js');
  console.log('    git commit -m "feat: 启用访问密钥"');
  console.log('    git push');
  console.log('');
  console.log('  提示：明文密钥只在你本地，仓库里只有哈希；');
  console.log('        但请不要把密钥写进 README、提交信息或任何文件。');
}

main();
