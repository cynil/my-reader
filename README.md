# my-reader

加密书库的网页 EPUB 阅读器。书籍以 AES-256-GCM 密文存放在公开仓库，浏览器端输入口令后解密阅读。纯静态，部署在 GitHub Pages，无后端。

[![Deploy](https://github.com/cynil/my-reader/actions/workflows/pages.yml/badge.svg)](https://github.com/cynil/my-reader/actions/workflows/pages.yml)

## 特性

- 书籍正文、封面、书目清单全部加密，仓库公开不等于内容公开
- 口令经 PBKDF2-SHA256（310,000 轮）派生 AES-256-GCM 密钥，每条密文独立 IV，AAD 绑定用途
- 从 EPUB 的 OPF 自动读取书名、作者，抽取封面
- 目录跳转、进度条拖拽、滚轮 / 键盘 / 触屏翻页，纸白 / 护眼 / 夜间三套主题，字号、行距、字体可调
- 可直接打开本地 EPUB（选择文件或拖入书架），不经过书库，不需要口令
- 脚注 / 尾注链接原地弹层显示，不跳出正文
- 阅读位置与设置保存在浏览器本地
- 构建产物为纯静态文件

## 快速开始

需要 Node 20.19+ 或 22.12+。

```bash
git clone https://github.com/cynil/my-reader.git
cd my-reader
npm install
```

### 添加书籍

```bash
npm run add -- ./path/to/book.epub   # 复制进 sources/ 并加密
npm run add                          # 或：加密 sources/ 下已有的书
```

口令为交互输入，不回显。脚本写入 `public/data/` 并执行 `git add`，之后提交推送即可：

```bash
git commit -m "data: add book"
git push
```

加密必须在本地完成。CI 没有口令，也无法冷启动加密流程。

### 打开本地书籍

书架右上角的文件夹图标选择 `.epub`，或直接把文件拖进书架区域。

文件只在浏览器内存里解析：不上传、不写入服务器、也不需要口令。阅读进度按文件内容的 SHA-256 记录，同一个文件再次打开会回到上次位置。

### 本地预览

```bash
npm run dev      # http://localhost:5173
```

首次克隆后 `public/data/` 为空，页面会提示先执行 `npm run add`。

### 部署

推送到 `main` 后，GitHub Actions 发布 `dist/` 到 Pages。

工作流按代码指纹缓存构建产物：只改 `public/data/`（加书）时跳过 `npm ci` 和 `vite build`，复用上次产物并注入新数据；改动 `src/`、`index.html`、依赖或构建配置时才重新构建。只修改 Markdown 不会触发工作流。

仓库 Settings → Pages → Source 需选择 **GitHub Actions**。

## 工作方式

```
sources/*.epub              明文，仅本地，由 .gitignore 排除
      │ npm run add
public/data/                密文，随仓库发布
      │ git push
GitHub Actions              npm ci → npm run build → Pages
      │
浏览器                       口令 → 密钥 → 解密清单 → 书架 → 按需解密单本
```

`public/data/` 的构成：

| 文件 | 内容 |
| --- | --- |
| `key.json` | KDF 参数与盐，明文，必须公开 |
| `library.enc` | 书目清单，密文 |
| `books/<id>.bin` | EPUB 正文，密文 |
| `covers/<id>.bin` | 封面图片，密文 |

每条密文为 12 字节 IV + 密文 + 16 字节 GCM tag。解密清单时的校验失败即视为口令错误，因此不存在单独的口令哈希。

## 命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | 构建到 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run add [-- 路径...]` | 复制并加密书籍 |
| `npm run encrypt -- "口令"` | 重新加密 `sources/` 全部书籍 |
| `npm run encrypt -- "口令" --rotate` | 更换口令并重新加密 |
| `npm run encrypt -- --verify "口令"` | 仅校验口令，不写文件 |

加密按内容哈希增量执行，未变动的书不会重复处理；删除 `sources/` 中的书后重新执行，对应密文会被清理。

## 安全说明

- 口令无备份，遗失即无法恢复。
- 防护强度完全取决于口令。仓库公开，攻击者可离线爆破，31 万轮 PBKDF2 把单次尝试拖到约 0.1 秒，弱口令仍可被穷举。
- 解密发生在浏览器内存中，口令持有者的设备上可以看到明文。
- 若 git 历史中曾提交过明文书籍，加密不会覆盖历史，需重写历史或重建仓库。

## 已知限制

- 单文件 100 MB、仓库 1 GB（GitHub Pages 限制）
- 固定版式 EPUB（画册、漫画）支持有限，受 epub.js 能力约束
- 大文件首次打开需下载、解密、解压、排版，通常一到两秒
- 更换口令需重新加密整个书库

## License

未提供许可证，仅供个人使用。
