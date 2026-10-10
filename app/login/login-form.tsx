'use client';

import { useState, type FormEvent } from 'react';
import { appPath } from '../../lib/paths';

const inputStyle = { width: '100%', border: '1px solid #dce0d5', borderRadius: 10, padding: '12px 14px', background: '#fff', color: '#293323', marginTop: 7, fontSize: 15 };
export default function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(appPath('/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
      const result = await response.json() as { error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '登录失败，请稍后重试');
      window.location.assign(appPath('/'));
    } catch (error) { setError(error instanceof Error ? error.message : '暂时无法连接，请稍后重试'); setBusy(false); }
  }
  return <form onSubmit={login} style={{ display: 'grid', gap: 20 }}>
    <label style={{ fontSize: 14, color: '#59634e' }}>账号<input name="username" autoComplete="username" required maxLength={128} style={inputStyle} disabled={busy} /></label>
    <label style={{ fontSize: 14, color: '#59634e' }}>密码<input name="password" type="password" autoComplete="current-password" required maxLength={1024} style={inputStyle} disabled={busy} /></label>
    {error && <p role="alert" style={{ color: '#b34032', fontSize: 14, lineHeight: 1.6 }}>{error}</p>}
    <button type="submit" disabled={busy} style={{ background: '#526f3c', color: '#fff', border: 0, borderRadius: 10, padding: '13px 18px', fontWeight: 600, fontSize: 15, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1 }}>{busy ? '正在登录…' : '进入学习空间'}</button>
  </form>;
}
