# 私人书架 · 加密的网页 EPUB 阅读器

Vite + React 写的单页 EPUB 阅读器。仓库是公开的，但**书是密文**——没有口令的人下载到的只是一堆乱码。口令只在你脑子里，仓库里不存口令，也不存口令的哈希。

```
sources/*.epub        明文，只在本地，已被 .gitignore 忽略
      │  npm run encrypt -- "口令"
      ▼
public/data/          密文：书目清单 + 每本书 + 每个封面
      │  git push
      ▼
GitHub Actions        npm ci → npm run build → 部署 dist/ 到 Pages
      ▼
浏览器                 输入口令 → 派生密钥 → 解开清单 → 书架 → 点哪本才解密哪本
```

## 加密怎么做的

| 项目 | 取值 |
|---|---|
| 密钥派生 | PBKDF2-SHA256，**310,000 轮**，16 字节随机盐 |
| 加密 | AES-256-GCM（认证加密，篡改会失败） |
| 每条密文 | 12 字节随机 IV + 密文 + 16 字节 tag |
| 附加数据（AAD） | `book:<id>` / `cover:<id>` / `library`，把密文绑死在用途上，挪到别的文件用会解密失败 |

仓库里 `public/data/key.json` 只有盐和轮数——这些本来就必须公开，否则浏览器没法派生同一把密钥。

**口令不落盘**：没有存口令，也没有存口令的哈希。验证口令的方式就是「试着解开清单」：GCM 校验不过就是错了。

### 三条必须知道的事

1. **忘记口令 = 数据永久报废。** 没有后门、没有找回、没有客服。请立刻把口令存进密码管理器。
2. **口令强度就是全部的安全。** 攻击者拿到你的公开仓库，可以离线不限次地猜。310,000 轮只是让每次尝试慢一点（约 0.1 秒/次），挡不住 `12345678`。用随机长口令（≥16 字符，或 5 个随机词）。
3. **解密发生在浏览器内存里。** 输入口令之后，任何能操作你这台电脑的人都能从开发者工具里看到明文。端到端解密的网页天然如此。

## 目录结构

```
.
├── index.html                  Vite 入口
├── vite.config.js              base: './' —— 部署到 /<repo>/ 子路径也能用
├── src/
│   ├── main.jsx                React 挂载点
│   ├── App.jsx                 启动 → 解锁 → 书架 / 阅读器
│   ├── lib/
│   │   ├── crypto.js           加密层（浏览器和 Node 脚本共用同一份）
│   │   ├── library.js          拉数据、解密清单、解密单本、封面 blob URL
│   │   ├── reader-theme.js     把设置注入 epub.js 的 iframe
│   │   ├── settings.jsx        全局设置 Context（localStorage）
│   │   ├── storage.js          设置 / 进度 / 解锁令牌
│   │   └── useHashRoute.js     #/read/<id> 路由
│   ├── components/             LockScreen / LibraryView / BookCard / ReaderView / TocPanel / SettingsPanel
│   └── styles/app.css
├── scripts/
│   ├── add-book.mjs            ★ 一条命令加书：复制 → 加密 → git add
│   ├── encrypt-books.mjs       重新加密整个 sources/（也支持 --verify / --rotate）
│   └── lib/
│       ├── vault.mjs           加密核心逻辑（两个脚本共用）
│       └── epub.mjs            ZIP 中央目录 + OPF 解析（读取书名/作者/封面）
├── public/
│   ├── icon.svg
│   └── data/                   ← 加密后的数据，可以公开
│       ├── key.json            盐 + 轮数
│       ├── library.enc         加密的书目清单
│       ├── books/<id>.bin
│       └── covers/<id>.bin
├── sources/                    ← 明文书，只在本地（.gitignore）
└── .github/workflows/pages.yml
```

## 加一本书

两种用法，效果一样：

```powershell
npm run add -- "D:\Downloads\新书.epub"    # 复制进来 + 加密
npm run add                                 # 直接加密 sources/ 里已有的书
```

不带参数时，它会把 `sources/` 目录里所有还没加密（或改动过）的书一起处理——所以你手动把 EPUB 拖进 `sources/` 之后，跑一句 `npm run add` 就够了。

口令是交互输入的（不回显、不进 shell 历史）。带路径时它会依次做完：

1. 复制进 `sources/`（同名同内容自动识别为重复，不会产生副本）
2. 加密新增/变化的书，写出 `public/data`
3. `git add public/data`

然后你只需要：

```powershell
git commit -m "data: 加书"
git push
```

一次加多本：

```powershell
npm run add -- 一本.epub 另一本.epub
```

### 只重新加密（不加新书）

```powershell
npm run encrypt -- "你的口令"
```

脚本按内容哈希判断，没改过的书直接跳过；删掉 `sources/` 里的书再跑一次，对应密文会被清掉。

### 口令记错了会怎样

`npm run add` 会先拿你的口令去解现有的 `library.enc`：解不开就**直接中止，`public/data` 一个字节都不动**，并提示你确认口令。不会出现「口令打错、整个书库被新密钥重加密」这种灾难。

确实要换口令（旧数据会全部重新加密）：

```powershell
npm run encrypt -- "新口令" --rotate
```

### 其他命令

```powershell
node scripts/encrypt-books.mjs --verify "口令"   # 只校验，不改文件
'口令' | node scripts/encrypt-books.mjs -        # 口令走管道，不进 shell 历史
```

## 阅读器操作

| 操作 | 行为 |
|---|---|
| 鼠标滚轮 | 向下翻下一页，向上翻上一页（仅「左右翻页」模式） |
| `←` `→` / `PageUp` `PageDown` / 空格 | 翻页 |
| 点击屏幕左 1/4 / 右 1/4 | 上一页 / 下一页 |
| 触屏左右滑动 | 翻页 |
| 点击屏幕中间 | 隐藏 / 显示工具栏 |
| `Esc` | 依次：关抽屉 → 显示工具栏 → 回书架 |
| 目录 / Aa | 章节跳转 / 阅读设置（主题、字号、行距、字体、翻页方式） |
| 底部进度条 | 拖动跳转（需要定位表生成完成，首次打开大书会等一两秒） |

滚轮用了「累积 60px + 420ms 冷却」，所以一次滚轮手势只翻一页，不会连翻三页；触控板的惯性尾巴也会被冷却挡住。切到「上下滚动」模式时滚轮交还给浏览器，正常滚动。

阅读位置和设置都存在浏览器本地，下次打开回到原处。

## 本地开发

```bash
npm install
npm run encrypt -- "口令"   # 第一次必须先跑，否则打开只有「书库未配置」
npm run dev                 # http://localhost:5173
```

`npm run build` 产出 `dist/`，`npm run preview` 可以本地看构建结果。

> 必须用 `http://localhost` 或 HTTPS 打开：`crypto.subtle` 在非安全上下文里不存在。

## 部署

推到 GitHub 后，`Settings → Pages → Source` 选 **GitHub Actions**。工作流里已带 `enablement: true`，仓库还没开 Pages 时它会自己建。

站点在 `https://<用户名>.github.io/<仓库名>/`。

## 和上一版的区别

| | 上一版（手写） | 这一版 |
|---|---|---|
| 界面 | 原生 JS + 字符串模板 | React 19 + Vite |
| 清单 | CI 每次 push 生成并提交 | **本地**加密生成，CI 不写仓库 |
| 书 | 明文 `.epub`，谁都能下 | AES-256-GCM 密文 |
| 门禁 | 前端哈希校验（能绕过） | 口令即密钥（绕不过，没有密钥就没有明文） |
| 冲突 | CI 和本地都改 `books.json`，会冲突 | 只有一个写入方，不会再冲突 |

## 已知限制

- 大书首次打开要「下载 → 解密 → 解压 → 排版」，几十 MB 的书在手机上会等一两秒。
- 换口令要重加密全部书（一条命令，但书多时慢）。
- 书目清单也加密了，所以**解锁前连"有几本书"都看不到**——这是刻意的。
- 固定版式 EPUB（画册、漫画）支持有限，这是 epub.js 的边界。
- 单文件上限 100 MB（Pages 限制），仓库建议 ≤ 1 GB。

## 排错

**页面显示「打不开书库」**：`public/data/key.json` 或 `library.enc` 不存在。跑一次 `npm run encrypt -- "口令"`。

**「口令不正确」但你觉得没输错**：多半是 `public/data` 是用另一个口令生成的。用 `node scripts/encrypt-books.mjs --verify "口令"` 确认，或直接重跑加密覆盖。

**改了 `sources/` 里的书但网页没变**：忘了 `git add public/data` 并 push；加密脚本按内容哈希判断是否重加密，改了内容就会重新生成。

**本地 `npm run dev` 起不来**：先 `npm install`；端口被占用就 `npm run dev -- --port 5174`。
