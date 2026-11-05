import { useLayoutEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons.jsx';

const MARGIN = 12;
const GAP = 24;

/** 注释浮层：定位在点击位置附近，放不下就翻到上方 */
export default function NotePopup({ note, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    const left = Math.max(MARGIN, Math.min(note.x - 40, vw - width - MARGIN));
    let top = note.y + GAP;
    if (top + height > vh - MARGIN) top = Math.max(MARGIN, note.y - height - GAP);

    setPos({ left, top });
  }, [note]);

  useLayoutEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 注释里的链接不能就地跳转：改父页面 hash 会把读者踢出阅读器
  const handleBodyClick = (event) => {
    const anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') || '';
    if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      ref={ref}
      className="note-pop"
      role="dialog"
      aria-label="注释"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="note-pop-head">
        <span>注释</span>
        <button type="button" className="icon-btn small" onClick={onClose} aria-label="关闭注释">
          <CloseIcon />
        </button>
      </div>
      {/* 内容来自书籍本身，已在 extractNoteHtml 里去掉脚本与事件属性 */}
      <div
        className="note-pop-body"
        onClick={handleBodyClick}
        dangerouslySetInnerHTML={{ __html: note.html }}
      />
    </div>
  );
}
