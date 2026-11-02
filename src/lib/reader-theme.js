/** 阅读器正文主题：注入到 epub.js 的 iframe 里 */

export const READER_THEMES = {
  paper: { bg: '#faf8f4', fg: '#201f1c', link: '#b4552f', dim: '#7a736b' },
  sepia: { bg: '#f2e8d5', fg: '#43372a', link: '#a4552f', dim: '#7b6852' },
  night: { bg: '#14161a', fg: '#c3c0b9', link: '#e08b63', dim: '#8a877f' },
};

const FONT_STACKS = {
  serif: '"Songti SC","Noto Serif SC","Source Han Serif SC","SimSun",Georgia,"Times New Roman",serif',
  sans: '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif',
};

export function buildThemeRules(settings) {
  const t = READER_THEMES[settings.theme] || READER_THEMES.paper;
  const family = FONT_STACKS[settings.fontFamily] || FONT_STACKS.serif;
  const lh = String(settings.lineHeight);

  const rules = {
    html: {
      background: `${t.bg} !important`,
      'font-size': `${settings.fontScale}% !important`,
    },
    body: {
      background: `${t.bg} !important`,
      color: `${t.fg} !important`,
      'font-family': `${family} !important`,
      'line-height': `${lh} !important`,
      margin: '0 !important',
      padding: '0 !important',
      'text-align': 'justify',
      'overflow-wrap': 'break-word',
      '-webkit-font-smoothing': 'antialiased',
    },
    'p, div, li, dd, dt, td, th, blockquote': { 'line-height': `${lh} !important` },
    'a, a:visited': { color: `${t.link} !important`, 'text-decoration-color': `${t.link}` },
    'img, svg, video': { 'max-width': '100% !important', height: 'auto !important' },
    'pre, code, kbd, samp': { 'white-space': 'pre-wrap', 'word-break': 'break-word' },
    hr: { 'border-color': `${t.dim} !important` },
    'h1, h2, h3, h4, h5, h6': { color: `${t.fg} !important`, 'line-height': '1.45 !important' },
    '::selection': { background: 'rgba(180,85,47,.22) !important' },
  };

  if (settings.theme === 'night') {
    rules['body, div, p, span, li, td, th, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, strong, em, b, i, small'] = {
      'background-color': 'transparent !important',
      color: `${t.fg} !important`,
    };
    rules['img, svg'] = {
      'max-width': '100% !important',
      height: 'auto !important',
      filter: 'brightness(.86) contrast(.96)',
    };
  }

  return rules;
}

export function rulesToCss(rules) {
  return Object.keys(rules)
    .map((sel) => `${sel}{${Object.keys(rules[sel]).map((k) => `${k}:${rules[sel][k]};`).join('')}}`)
    .join('\n');
}

export function themeCss(settings) {
  return rulesToCss(buildThemeRules(settings));
}

export function injectCss(contents, css) {
  try {
    const doc = contents && contents.document;
    if (!doc) return;
    let el = doc.getElementById('__reader_theme__');
    if (!el) {
      el = doc.createElement('style');
      el.id = '__reader_theme__';
      (doc.head || doc.documentElement).appendChild(el);
    }
    el.textContent = css;
  } catch (err) { /* 跨域内容忽略 */ }
}
