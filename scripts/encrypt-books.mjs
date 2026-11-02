#!/usr/bin/env node
/**
 * 加密 sources/ 里的全部明文 EPUB 到 public/data/。
 *
 *   node scripts/encrypt-books.mjs "口令"
 *   '口令' | node scripts/encrypt-books.mjs -      # 口令不进 shell 历史
 *   node scripts/encrypt-books.mjs --verify "口令"  # 只校验，不改任何文件
 *   node scripts/encrypt-books.mjs "新口令" --rotate  # 换口令并重加密全部
 */

import { readFileSync, existsSync } from 'node:fs';
import { decryptJson } from '../src/lib/crypto.js';
import { deriveKey } from '../src/lib/crypto.js';
import { encryptLibrary, PATHS } from './lib/vault.mjs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const rotate = flags.includes('--rotate');
const verify = flags.includes('--verify');

function readStdin() {
  return new Promise((done) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => done(data.replace(/[\r\n]+$/, '')));
  });
}

async function main() {
  let passphrase = positional[0];
  if (passphrase === '-') passphrase = await readStdin();

  if (!passphrase) {
    console.error('用法：node scripts/encrypt-books.mjs "口令"');
    console.error('     \'口令\' | node scripts/encrypt-books.mjs -');
    console.error('     node scripts/encrypt-books.mjs --verify "口令"');
    console.error('     node scripts/encrypt-books.mjs "新口令" --rotate');
    process.exitCode = 1;
    return;
  }

  if (verify) {
    if (!existsSync(PATHS.library)) {
      console.error('✗ 没有可校验的数据（public/data/library.enc 不存在）');
      process.exitCode = 1;
      return;
    }
    const params = JSON.parse(readFileSync(PATHS.key, 'utf8'));
    const key = await deriveKey(passphrase, params.salt, params.iterations);
    try {
      const lib = await decryptJson(key, readFileSync(PATHS.library), 'library');
      console.log(`✓ 口令正确，清单里共 ${lib.count} 本`);
      lib.books.slice(0, 20).forEach((b) => console.log(`   · ${b.title}`));
    } catch (err) {
      console.error('✗ 口令不正确（或数据已损坏）');
      process.exitCode = 1;
    }
    return;
  }

  const result = await encryptLibrary(passphrase, {
    rotate,
    log: (msg) => console.log(msg),
  });

  console.log(`\n✅ 书库共 ${result.count} 本，密文合计 ${(result.totalBytes / 1048576).toFixed(2)} MB`);
  if (result.added.length) console.log(`   新增：${result.added.join('、')}`);
  if (result.removed.length) console.log(`   移除：${result.removed.join('、')}`);
  console.log('\n   下一步：git add public/data && git commit -m "data: 更新书库" && git push');
}

main().catch((err) => {
  console.error(`\n✗ ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
