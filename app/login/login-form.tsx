'use client';

import { useState, type FormEvent } from 'react';
import { appPath } from '../../lib/paths';

const inputStyle = { width: '100%', border: '1px solid #dce0d5', borderRadius: 10, padding: '12px 14px', background: '#fff', color: '#293323', marginTop: 7, fontSize: 15 };
export default function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const registering = mode === 'register';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    const body = registering
      ? { username: data.get('username'), password: data.get('password'), inviteCode: data.get('inviteCode') }
      : { username: data.get('username'), password: data.get('password') };
    try {
      const response = await fetch(appPath(registering ? '/api/auth/register' : '/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '没有完成，请稍后重试');
      window.location.assign(appPath('/'));
    } catch (error) { setError(error instanceof Error ? error.message : '暂时无法连接，请稍后重试'); setBusy(false); }
  }
  return <form onSubmit={submit} style={{ display: 'grid', gap: 20 }}>
    <label style={{ fontSize: 14, color: '#59634e' }}>账号<input name="username" autoComplete="username" required minLength={registering ? 2 : 1} maxLength={registering ? 32 : 128} pattern={registering ? '[A-Za-z0-9_\\-]+' : undefined} style={inputStyle} disabled={busy} /></label>
    <label style={{ fontSize: 14, color: '#59634e' }}>密码<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 12 : 1} maxLength={1024} style={inputStyle} disabled={busy} /></label>
    {registering && <label style={{ fontSize: 14, color: '#59634e' }}>邀请码<input name="inviteCode" autoComplete="off" required maxLength={128} style={inputStyle} disabled={busy} /></label>}
    {error && <p role="alert" style={{ color: '#b34032', fontSize: 14, lineHeight: 1.6 }}>{error}</p>}
    <button type="submit" disabled={busy} style={{ background: '#526f3c', color: '#fff', border: 0, borderRadius: 10, padding: '13px 18px', fontWeight: 600, fontSize: 15, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1 }}>{busy ? '请稍候…' : registering ? '注册并进入' : '进入学习空间'}</button>
    <button type="button" onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }} disabled={busy} style={{ background: 'transparent', color: '#526f3c', border: 0, padding: 0, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>{registering ? '已有账号，去登录' : '没有账号？使用邀请码注册'}</button>
  </form>;
}
