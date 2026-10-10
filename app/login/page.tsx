import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUserForHeaders } from '../../lib/auth';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';
export default async function Login() {
  if (await getUserForHeaders(await headers())) redirect('/');
  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 20px', background: '#f6f7f2' }}>
    <section style={{ width: '100%', maxWidth: 430, background: '#fff', padding: '42px 32px', borderRadius: 24, border: '1px solid #e7e9df', boxShadow: '0 18px 60px #2933190a' }}>
      <p style={{ color: '#5d7844', fontSize: 13, letterSpacing: '0.15em', fontWeight: 700 }}>WORDSTEPS · 词阶</p>
      <h1 style={{ fontSize: 30, fontWeight: 650, margin: '14px 0 10px', color: '#293323' }}>每天向上一步</h1>
      <p style={{ color: '#777f71', lineHeight: 1.8, fontSize: 14, marginBottom: 28 }}>登录你的学习空间，继续英语与日语的每日复习。</p>
      <LoginForm />
    </section>
  </main>;
}
