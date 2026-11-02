import { useEffect, useRef, useState } from 'react';
import { LockIcon } from './Icons.jsx';

const MAX_TRIES = 5;
const COOLDOWN_MS = 10000;

export default function LockScreen({ onUnlock }) {
  const [passphrase, setPassphrase] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);
  const triesRef = useRef(0);
  const cooldownRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const now = Date.now();
    if (now < cooldownRef.current) {
      setMessage(`尝试次数过多，请 ${Math.ceil((cooldownRef.current - now) / 1000)} 秒后再试`);
      return;
    }
    if (!passphrase) {
      setMessage('请输入口令');
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    setMessage('');
    const error = await onUnlock(passphrase, remember);
    setBusy(false);
    if (!error) return;

    setPassphrase('');
    inputRef.current?.focus();
    setShake(false);
    requestAnimationFrame(() => setShake(true));

    triesRef.current += 1;
    if (triesRef.current >= MAX_TRIES) {
      triesRef.current = 0;
      cooldownRef.current = Date.now() + COOLDOWN_MS;
      setMessage(`错误次数过多，请 ${COOLDOWN_MS / 1000} 秒后再试`);
    } else {
      setMessage(`${error}，还可以试 ${MAX_TRIES - triesRef.current} 次`);
    }
  };

  return (
    <div className="lock">
      <form
        className={`lock-card${shake ? ' is-error' : ''}`}
        onSubmit={handleSubmit}
        onAnimationEnd={() => setShake(false)}
        noValidate
      >
        <div className="lock-icon" aria-hidden="true">
          <LockIcon />
        </div>
        <h2>私人书架</h2>
        <p className="lock-sub">书库是加密的，请输入口令</p>

        <input
          ref={inputRef}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="访问口令"
          aria-label="访问口令"
          autoComplete="current-password"
          spellCheck="false"
          autoCapitalize="off"
          autoCorrect="off"
          disabled={busy}
        />

        <label className="lock-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>记住这台设备 7 天</span>
        </label>

        <button type="submit" className="lock-submit" disabled={busy}>
          {busy ? '解密中…' : '进入书架'}
        </button>

        <p className="lock-msg" role="status" aria-live="polite">{message}</p>
      </form>
    </div>
  );
}
