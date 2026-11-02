#!/usr/bin/env node
/**
 * 加书：复制 → 加密 → git add。
 *
 *   npm run add                                # 加密 sources/ 里已有的书
 *   npm run add -- "D:\Downloads\新书.epub"     # 复制进来再加密
 *   npm run add -- 一本.epub 另一本.epub
 *
 * 口令交互输入（不回显、不进 shell 历史）。
 * 自动化场景可以用环境变量：BOOK_PASSPHRASE=xxx npm run add
 */

import { existsSync, statSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { basename, extname, join, resolve, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { encryptLibrary, PATHS, sha256, walkEpubs, MIN_PASSPHRASE } from './lib/vault.mjs';

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function askHidden(prompt) {
  return new Promise((resolvePromise) => {
    const isTTY = Boolean(process.stdin.isTTY);
    process.stdout.write(prompt);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTTY,
    });
    if (isTTY) rl._writeToOutput = () => {};

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { rl.close(); } catch (err) { /* noop */ }
      if (isTTY) process.stdout.write('\n');
      resolvePromise(value);
    };

    rl.on('SIGINT', () => { finish(''); process.exit(130); });
    rl.on('close', () => finish(''));
    rl.question('', (answer) => finish(answer));
  });
}

async function getPassphrase() {
  const fromEnv = process.env.BOOK_PASSPHRASE;
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    console.error(C.red('✗ 当前不是交互终端，读不到口令'));
    console.error('  改用：BOOK_PASSPHRASE=口令 npm run add -- "书.epub"');
    console.error('  或者：npm run encrypt -- "口令"');
    process.exit(1);
  }

  const first = await askHidden(`请输入口令（≥${MIN_PASSPHRASE} 位，输入不回显）：`);
  if (!first) {
    console.error(C.red('\n✗ 口令不能为空'));
    process.exit(1);
  }
  if (first.length < MIN_PASSPHRASE) {
    console.error(C.red(`\n✗ 口令至少 ${MIN_PASSPHRASE} 位`));
    process.exit(1);
  }
  return first;
}

/** 目标文件名：同内容视为重复，不同内容自动加序号 */
function resolveDestination(srcPath) {
  const srcHash = sha256(readFileSync(srcPath));
  const ext = extname(srcPath).toLowerCase();
  const base = basename(srcPath, extname(srcPath));
  let index = 1;
  let candidate = join(PATHS.sources, basename(srcPath));

  while (existsSync(candidate)) {
    if (sha256(readFileSync(candidate)) === srcHash) {
      return { dest: candidate, duplicate: true };
    }
    index += 1;
    candidate = join(PATHS.sources, `${base} (${index})${ext}`);
  }
  return { dest: candidate, duplicate: false };
}

function stageData() {
  const probe = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: PATHS.root, stdio: 'ignore' });
  if (probe.status !== 0) {
    console.log(C.dim('（不在 git 仓库里，跳过 git add）'));
    return false;
  }
  const res = spawnSync('git', ['add', 'public/data'], { cwd: PATHS.root, stdio: 'inherit' });
  return res.status === 0;
}

async function main() {
  const inputs = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  if (!existsSync(PATHS.sources)) mkdirSync(PATHS.sources, { recursive: true });

  const prepared = [];

  if (!inputs.length) {
    // 不带参数：把 sources/ 里已有的书全部加密一遍
    const pending = walkEpubs(PATHS.sources);
    if (!pending.length) {
      console.error(C.red('✗ sources/ 里没有 EPUB'));
      console.error('  放书进去： npm run add -- "D:\\Downloads\\新书.epub"');
      console.error('  或手动复制到 sources/ 再跑一次 npm run add');
      process.exitCode = 1;
      return;
    }
    console.log(C.dim(`sources/ 里已有 ${pending.length} 本书，直接加密`));
  } else {
    for (const input of inputs) {
      const src = isAbsolute(input) ? input : resolve(process.cwd(), input);
      if (!existsSync(src) || !statSync(src).isFile()) {
        console.error(C.red(`✗ 找不到文件：${input}`));
        process.exitCode = 1;
        return;
      }
      if (extname(src).toLowerCase() !== '.epub') {
        console.error(C.red(`✗ 不是 .epub 文件：${input}`));
        process.exitCode = 1;
        return;
      }

      const { dest, duplicate } = resolveDestination(src);
      if (duplicate) {
        console.log(C.dim(`= ${basename(dest)} 已在 sources/ 里（内容相同），跳过复制`));
      } else {
        copyFileSync(src, dest);
        console.log(`${C.green('+')} 已复制到 sources/${basename(dest)}`);
      }
      prepared.push(basename(dest));
    }
  }

  const passphrase = await getPassphrase();

  console.log('');
  let result;
  try {
    result = await encryptLibrary(passphrase, { log: (m) => console.log(C.dim(m)) });
  } catch (err) {
    console.error(C.red(`\n✗ ${err && err.message ? err.message : err}`));
    console.error(C.dim(prepared.length
      ? '  书已放进 sources/，确认口令后重跑即可（不会重复复制）。'
      : '  确认口令后重跑即可。'));
    process.exitCode = 1;
    return;
  }

  const staged = stageData();

  console.log('');
  console.log(C.bold(`✅ 书库共 ${result.count} 本，密文 ${(result.totalBytes / 1048576).toFixed(2)} MB`));
  if (result.added.length) console.log(`   新增：${result.added.join('、')}`);
  if (result.removed.length) console.log(`   移除：${result.removed.join('、')}`);
  if (prepared.length) console.log(`   本次加入：${prepared.join('、')}`);
  console.log('');
  console.log(`   ${staged ? 'public/data 已加入暂存区' : C.red('未能自动 git add，请手动执行')}`);
  console.log(C.dim(`   git commit -m "data: 加书" && git push`));
}

main().catch((err) => {
  console.error(C.red(`\n✗ ${err && err.message ? err.message : err}`));
  process.exitCode = 1;
});
