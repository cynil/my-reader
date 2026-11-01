# 网页 EPUB 阅读器 · 书架随 git 更新

一个纯静态的 EPUB 阅读器，托管在 GitHub Pages 上。把 `.epub` 文件丢进 `books/` 目录，`git push`，书架自动更新——不需要改代码、不需要重新构建、不需要手动维护书目清单。

```
你 push 一本书  →  Action 扫描 books/  →  生成 books.json + 封面  →  Pages 部署  →  打开网页就能看
```

## 先说结论：可行，但有一个前提

**GitHub Pages 是纯静态托管，没有目录列表接口**，浏览器无法"列出 `books/` 里有哪些文件"。这是所有"静态站自动读目录"方案的共同瓶颈，跟用不用框架无关。

所以真正的机制是**一份构建期生成的清单**：

1. 仓库里放一个 `scripts/build-library.mjs`，扫描 `books/`，读出每本书的书名、作者、封面，写成 `books.json`；
2. GitHub Actions 在每次 push 时自动跑这个脚本，把 `books.json` 和封面提交回仓库，然后部署；
3. 前端只做一件事：`fetch('./books.json')`，然后渲染书架。

这样"新书自动出现"的体验是完整的，而你不用碰清单文件一个字。

> 另一种做法是前端运行时调 `https://api.github.com/repos/<你>/<仓库>/contents/books` 自己列目录。能用，但有三个硬伤：未登录每小时只有 60 次请求、每次打开页面都依赖 GitHub API 可用、私有仓库还要往页面里塞 token。所以这里选了构建期生成清单。

## 目录结构

```
.
├── index.html                    # 书架 + 阅读器（单页，约 7 KB）
├── assets/
│   ├── app.css                   # 样式（含浅色/深色、纸白/护眼/夜间）
│   ├── app.js                    # 全部界面逻辑（无框架、无构建）
│   ├── auth.js                   # 访问密钥验证器（null = 不启用门禁）
│   ├── icon.svg
│   └── vendor/
│       ├── epub.min.js           # epub.js 0.3.93（已本地化，不走 CDN）
│       └── jszip.min.js          # epub.js 的解压依赖
├── books/                        # ← 你的书放这里（支持子目录）
├── covers/                       # ← 自动生成的封面缩略图
├── books.json                    # ← 自动生成的书目清单
├── scripts/
│   ├── build-library.mjs         # 扫描书籍 + 解析 OPF + 提取封面（零依赖）
│   ├── make-key.mjs              # 生成访问密钥验证器
│   └── serve.mjs                 # 本地预览服务器（零依赖）
└── .github/workflows/pages.yml   # 自动生成清单 + 部署 Pages
```

整个项目**没有 `package.json`、没有 `node_modules`**。`epub.js` 和 `jszip` 是直接提交进仓库的静态文件，脚本只用 Node 内置模块（ZIP 解析是我手写的，约 150 行），所以 CI 里不需要 `npm install`，构建一秒完成。

## 部署（三步）

**1. 建仓库并推上去**

```bash
git init
git add .
git commit -m "init: epub reader"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

**2. 打开 Pages**

仓库 → `Settings` → `Pages` → `Build and deployment` → **Source 选 `GitHub Actions`**（不要选 "Deploy from a branch"）。

**3. 等第一次 Action 跑完**

`Actions` 标签页里能看到 `构建书架并部署到 GitHub Pages`。跑完后访问：

```
https://<你的用户名>.github.io/<仓库名>/
```

> 首次部署前书架是空的，页面会显示引导提示，这是正常的。

## 加书

```bash
cp ~/Downloads/某本书.epub books/
git add books
git commit -m "add: 某本书"
git push
```

推送后 Action 自动完成：扫描 → 提取标题/作者/封面 → 更新 `books.json` → 部署。大约 1 分钟后刷新页面即可看到新书。

也可以放进子目录，比如 `books/小说/`、`books/技术/`，脚本会递归扫描。

**想在本地先生成清单再提交**（比如没有 Actions 时的手动模式）：

```bash
node scripts/build-library.mjs
git add books.json covers
git commit -m "chore: 更新书架"
git push
```

这种情况下把 Pages 的 Source 改回 `Deploy from a branch → main / (root)` 也能用。

## 本地预览

```bash
node scripts/serve.mjs
```

打开 http://localhost:5173 。

**不能直接双击 `index.html`**：`fetch('books.json')` 在 `file://` 协议下会被 CORS 拦掉。用上面的本地服务器，或者 `python -m http.server`、`npx serve` 都行。

## 访问密钥（门禁）

> ⚠️ **先说清楚它能做什么**：这只是**遮住界面**，不是加密。
> `books/` 里的 `.epub` 仍然能被直链下载（`.../books/xxx.epub`）。
> 它能挡住随手点进来的人、被转发的链接和搜索引擎；
> 挡不住任何一个会按 F12 看网络请求的人。要真正保护文件，见下面「想要真保护」。

### 生成密钥

```bash
node scripts/make-key.mjs "你的一句话密钥"
git add assets/auth.js
git commit -m "feat: 启用访问密钥"
git push
```

- **明文密钥不进仓库**：`assets/auth.js` 里只有 `salt` 和 `PBKDF2-SHA256`（21 万轮）的哈希，反推不出密钥
- 不想让密钥留在 shell 历史里：`echo "密钥" | node scripts/make-key.mjs -`
- 只校验不写文件：`node scripts/make-key.mjs --verify "密钥"`
- 关闭门禁：`node scripts/make-key.mjs --remove`
- 更换密钥：重新生成一次即可，旧的「已解锁」记录会自动失效

### 行为

- 未解锁时**不加载 `books.json`**，书架是空的，路由也被挡住
- 勾选「记住这台设备 7 天」存 `localStorage`；不勾则存 `sessionStorage`，关标签页即失效
- 右上角锁形按钮可随时锁定（清掉本地解锁记录并刷新）
- 连续输错 5 次锁定 10 秒
- 启用后会注入 `noindex, nofollow`，避免被搜索引擎收录

### 注意

- `crypto.subtle` 只在 **HTTPS 或 localhost** 下可用。用 `http://192.168.x.x` 打开会提示"无法校验密钥"
- 密钥是前端校验的，把 `assets/auth.js` 改回 `null` 再部署就能绕过——**它防的是"误闯"，不是"攻击"**
- 用弱口令（`123456`）的话，哈希是可以被离线暴力破解的，请用 12 位以上的随机短语

### 想要真保护？

得把书本身加密，让服务器上只有密文：

1. 构建时用 AES-GCM 加密每个 `books/*.epub`（密钥由口令经 PBKDF2 派生）
2. 浏览器输入口令 → 解密成 `ArrayBuffer` → 直接交给 `ePub(arrayBuffer)`（epub.js 支持传二进制）
3. 顺带把 `books.json` 里的书名、作者、封面也加密或移除

代价是：书目信息要么公开、要么也加密（那书架就得先解密才知道有什么）；大书的解密要多花几百毫秒；而且密钥一旦换了，全部文件都要重新加密。需要的话可以在这个骨架上加，`books.json` 的契约不用动。

## 阅读器功能

- **书架**：封面墙、书名/作者搜索、按"最近添加 / 书名 / 作者 / 阅读进度"排序、已读标记与进度条
- **阅读**：目录跳转、进度条拖拽跳转、左右翻页/上下滚动切换、键盘 `←` `→` `Esc`、触屏左右滑动、点击屏幕左/右 1/4 翻页、点中间隐藏工具栏
- **排版**：纸白/护眼/夜间三种正文主题，字号 80%–200%，三档行距，宋体/黑体
- **记忆**：每本书的阅读位置（CFI）和百分比存在本地，下次打开自动回到原处；进度表缓存在 IndexedDB，第二次打开不用重新计算
- **其他**：深浅色界面、URL 直达某本书（`#/read/<id>`，可加书签）、移动端适配、iPhone 安全区

进度数据只存在**当前浏览器**（`localStorage` + `IndexedDB`），换设备不会同步——静态站没有后端，这是刻意的取舍。

## 自定义

| 想改什么 | 改哪里 |
|---|---|
| 网站标题「我的书架」 | `index.html` 里的 `.brand-text h1` 和 `<title>` |
| 配色 | `assets/app.css` 顶部的 CSS 变量（`--accent` 是主色） |
| 书籍目录名 | `scripts/build-library.mjs` 顶部的 `BOOKS_DIR` |
| 默认阅读主题/字号 | `assets/app.js` 里的 `DEFAULT_SETTINGS` |
| 排序方式 | `index.html` 的 `#sortSelect` + `assets/app.js` 的 `filteredBooks()` |

## 限制与注意事项

- **书是公开的。** 免费版 Pages 要求仓库公开，任何人拿到 URL 就能下载 `books/` 里的书。请只放你有权公开的内容。
- **单文件上限 100 MB**（GitHub Pages 限制），仓库建议不超过 1 GB。扫描版 PDF 转的 EPUB 常常超限，超了会在 Action 里报错。
- **EPUB 兼容性**：基于 epub.js，支持 EPUB 2/3 重排本，绝大多数书没问题。固定版式（fixed-layout，常见于画册、漫画）和带脚本的交互书支持有限。
- **首次打开较慢**：整本 EPUB 要先下载完才能渲染，几十 MB 的书在手机上需要等一下；第二次有浏览器缓存会快很多。
- **`books.json` 是由脚本生成的**，手动改会在下次 push 时被覆盖。
- **仓库改名/迁移**：所有路径都是相对路径，换仓库名不用改代码。

## 实现要点（给以后要改代码的你）

- `scripts/build-library.mjs` 自己实现了 ZIP 中央目录解析 + `zlib.inflateRawSync` 解压，然后读 `META-INF/container.xml` → OPF → `dc:title` / `dc:creator` / 封面（依次尝试 EPUB3 的 `properties="cover-image"`、EPUB2 的 `<meta name="cover">`、文件名含 cover 的图片）。解析失败的书仍会入库，只是没有封面并带一个 `warning` 字段，不会让整个构建挂掉。
- 书籍 ID 是**相对路径的 sha1**，所以文件改名会被当成一本新书（阅读进度丢失）；只移动目录同理。
- `books.json` 里的 `added` 字段会在重新生成时被保留，用来排序"最近添加"。
- 封面会被裁剪成 `covers/<id>.<ext>`，原书删除后对应封面也会被清理。
- 前端不打包、不转译，直接是浏览器能跑的 ES2017 + IIFE，改完刷新就生效。

## 常见问题

**`Get Pages site failed ... Error: Not Found`**

仓库还没有开启 Pages。两种解法：

1. 网页上开启：`Settings` → `Pages` → Source 选 **GitHub Actions**，然后回到 Action 点 `Re-run all jobs`；
2. 什么都不做，用新版本工作流再 push 一次——里面的 `configure-pages` 带了 `enablement: true`，会自己把 Pages 站点建出来。

两种都不行，通常是仓库是**私有**的（免费版 Pages 只支持公开仓库），或者所在组织禁用了 Pages。

**Action 成功但页面 404**

等 1～2 分钟，Pages 首次发布有延迟；确认 `Source` 选的是 GitHub Actions 而不是某个分支；确认地址是 `https://<用户名>.github.io/<仓库名>/`，别漏了仓库名。

**页面能打开，但书架一直空**

看看 `books.json` 是不是 `count: 0`——那就是 `books/` 里没有 `.epub`。放了书还是空的话，去 `Actions` 里看"扫描 books/"那一步的输出，文件可能超过 100 MB 被跳过了。

**点开书一直转圈**

打开浏览器控制台看报错。常见原因是 EPUB 本身损坏，或者用了固定版式（fixed-layout），换一本重排本试试。

