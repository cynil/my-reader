import { CloseIcon } from './Icons.jsx';

const THEMES = [
  { value: 'paper', label: '纸白', className: 'swatch-paper' },
  { value: 'sepia', label: '护眼', className: 'swatch-sepia' },
  { value: 'night', label: '夜间', className: 'swatch-night' },
];

const LINE_HEIGHTS = [
  { value: 1.5, label: '紧凑' },
  { value: 1.75, label: '标准' },
  { value: 2, label: '宽松' },
];

const FONTS = [
  { value: 'serif', label: '宋体' },
  { value: 'sans', label: '黑体' },
];

const FLOWS = [
  { value: 'paginated', label: '左右翻页' },
  { value: 'scrolled', label: '上下滚动' },
];

export default function SettingsPanel({ settings, onUpdate, onReset, onClose }) {
  return (
    <aside className="drawer drawer-right" aria-label="阅读设置">
      <div className="drawer-head">
        <h2>阅读设置</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭设置">
          <CloseIcon />
        </button>
      </div>

      <div className="setting">
        <span className="setting-label">主题</span>
        <div className="swatches">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`swatch ${t.className}`}
              aria-pressed={settings.theme === t.value}
              onClick={() => onUpdate({ theme: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <span className="setting-label">字号</span>
        <div className="stepper">
          <button type="button" onClick={() => onUpdate({ fontScale: Math.max(80, settings.fontScale - 10) })}>A−</button>
          <span>{settings.fontScale}%</span>
          <button type="button" onClick={() => onUpdate({ fontScale: Math.min(200, settings.fontScale + 10) })}>A+</button>
        </div>
      </div>

      <div className="setting">
        <span className="setting-label">行距</span>
        <div className="segmented">
          {LINE_HEIGHTS.map((lh) => (
            <button
              key={lh.value}
              type="button"
              aria-pressed={Number(settings.lineHeight) === lh.value}
              onClick={() => onUpdate({ lineHeight: lh.value })}
            >
              {lh.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <span className="setting-label">字体</span>
        <div className="segmented">
          {FONTS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={settings.fontFamily === f.value}
              onClick={() => onUpdate({ fontFamily: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <span className="setting-label">翻页</span>
        <div className="segmented">
          {FLOWS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={settings.flow === f.value}
              onClick={() => onUpdate({ flow: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="ghost-btn" onClick={onReset}>恢复默认设置</button>
    </aside>
  );
}
