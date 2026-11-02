import { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons.jsx';

function flatten(items, depth = 0, out = []) {
  items.forEach((item) => {
    out.push({ href: item.href, label: (item.label || '').trim() || '未命名章节', depth });
    if (item.subitems && item.subitems.length) flatten(item.subitems, depth + 1, out);
  });
  return out;
}

const normalize = (href) => {
  if (!href) return '';
  const clean = String(href).split('#')[0];
  try { return decodeURI(clean); } catch (err) { return clean; }
};

export default function TocPanel({ toc, activeHref, onSelect, onClose }) {
  const listRef = useRef(null);
  const entries = flatten(toc || []);
  const current = normalize(activeHref);

  useEffect(() => {
    const active = listRef.current?.querySelector('.toc-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <aside className="drawer drawer-left" aria-label="目录">
      <div className="drawer-head">
        <h2>目录</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭目录">
          <CloseIcon />
        </button>
      </div>
      <nav className="toc" ref={listRef}>
        {entries.length === 0 && <p className="toc-empty">这本书没有目录信息</p>}
        {entries.map((item, i) => {
          const target = normalize(item.href);
          const active = target && current
            && (target === current || current.endsWith(`/${target}`) || target.endsWith(`/${current}`));
          return (
            <button
              key={`${item.href}-${i}`}
              type="button"
              className={`toc-item${active ? ' active' : ''}`}
              style={{ '--d': item.depth }}
              onClick={() => onSelect(item.href)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
