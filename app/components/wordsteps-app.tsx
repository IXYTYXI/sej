"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, ChevronRight, Leaf, LogOut, Settings2, Sparkles, Sun } from "lucide-react";
import { api, type AppState, type Language, type Stage, type Tab, languageName } from "./types";
import { ErrorNotice, Loading } from "./ui";
import { Today } from "./today";
import { Library } from "./library";
import { Progress } from "./progress";
import { Settings } from "./settings";
import { StudySession } from "./study-session";
import { ExamSession } from "./exam-session";
import { AILearning } from "./ai-learning";
import { appPath } from "../../lib/paths";

const tabs = [
  { id: "today" as const, label: "今日学习", short: "今日", icon: Sun },
  { id: "library" as const, label: "我的词库", short: "词库", icon: BookOpen },
  { id: "progress" as const, label: "成长足迹", short: "进度", icon: ChartNoAxesCombined },
  { id: "ai" as const, label: "AI 学习", short: "AI 学习", icon: Sparkles },
  { id: "settings" as const, label: "规则与设置", short: "设置", icon: Settings2 },
];

export default function WordstepsApp({ initialName }: { initialName: string }) {
  const [tab, setTab] = useState<Tab>("today");
  const [language, setLanguage] = useState<Language>("en");
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [study, setStudy] = useState<{ stageId?: string; title?: string } | null>(null);
  const [exam, setExam] = useState<Stage | null>(null);
  const requestNumber = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setError(null);
    try {
      const result = await api<AppState>(`/api/state?language=${language}`);
      if (request === requestNumber.current) setState(result);
    } catch (cause) { if (request === requestNumber.current) setError(cause); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }, [language]);
  useEffect(() => { setLoading(true); setState(null); void load(); return () => { requestNumber.current++; }; }, [load]);
  const changeLanguage = (next: Language) => { if (next !== language) { setState(null); setLoading(true); setLanguage(next); } };
  const nav = (id: Tab) => { setTab(id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const start = (stage?: Stage) => { if (!stage || stage.unlocked) setStudy({ stageId: stage?.id, title: stage?.title }); };
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" }).format(new Date());
  const name = state?.user.name || initialName;
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true); setLogoutError(null);
    try { await api("/api/auth/logout", {}); window.location.assign(appPath("/login")); }
    catch (cause) { setLogoutError(cause); setLoggingOut(false); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href={appPath("/")} aria-label="词阶首页"><span className="brand-icon"><i /><i /><i /></span><span>词阶<small>WORDSTEPS</small></span></a>
      <div className="sidebar-caption">每天，向上一步。</div>
      <nav className="desktop-nav" aria-label="主导航">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "nav-item active" : "nav-item"} onClick={() => nav(id)} aria-current={tab === id ? "page" : undefined}><Icon size={20} strokeWidth={1.7} /><span>{label}</span>{tab === id && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Leaf size={25} strokeWidth={1.4} /><p>学习的节奏，<br />由你的记忆决定。</p><span>SPACED REPETITION</span></div>
        <div className="user-block"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><div><strong title={name}>{name}</strong><small>你的专属学习空间</small></div><button className="logout-button" type="button" onClick={() => void logout()} disabled={loggingOut} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button></div>
      </div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><span className="mobile-wordmark">词阶</span><span className="desktop-crumb">学习空间</span><ChevronRight size={14} /><strong>{tabs.find(item => item.id === tab)?.label}</strong></div><div className="topbar-right"><span className="save-status"><span />进度随账号保存</span><div className="language-switch" aria-label="切换学习语言">{(["en", "ja"] as Language[]).map(lang => <button key={lang} className={language === lang ? "selected" : ""} aria-pressed={language === lang} onClick={() => changeLanguage(lang)}><span>{lang === "en" ? "A" : "あ"}</span>{languageName(lang)}</button>)}</div><button className="logout-button mobile-logout" type="button" onClick={() => void logout()} disabled={loggingOut} aria-label="退出登录" title="退出登录"><LogOut size={16} /></button></div></header>
      <main className="main-content" id="main-content">
        <div className="page-heading"><div><div className="eyebrow">{tab === "today" ? "A LITTLE EVERY DAY" : tab === "library" ? "YOUR NEXT CHAPTER" : tab === "progress" ? "SMALL STEPS, REAL PROGRESS" : tab === "ai" ? "A LITTLE GUIDANCE, A LITTLE FURTHER" : "MAKE IT YOUR OWN"}</div><h1>{tab === "today" ? "把今天的新知，变成明天的熟悉。" : tab === "library" ? "一步一阶，打开更大的世界。" : tab === "progress" ? "你走过的每一步，都算数。" : tab === "ai" ? "让学过的词，慢慢成为自己的表达。" : "找到适合自己的学习节奏。"}</h1><p>{tab === "today" ? "先温习，再认识新词。今天也不必贪多。" : tab === "library" ? "掌握当前阶段的 80%，通过测验，即可开启下一阶段。" : tab === "progress" ? `${languageName(language)}的学习记录独立统计，进步来自一次次真实的回忆。` : tab === "ai" ? "一份学习建议，一段真实对话，一点新的记忆线索。" : "让计划轻一点，让记忆留得久一点。"}</p></div>{tab === "today" && <span className="today-date"><Sun size={16} />{date}</span>}</div>
        <ErrorNotice error={logoutError} retry={() => void logout()} />
        <ErrorNotice error={error} retry={() => { setLoading(true); void load(); }} />
        {loading && !state ? <Loading /> : state ? <>
          {tab === "today" && <Today state={state} start={start} openLibrary={() => nav("library")} openExam={setExam} />}
          {tab === "library" && <Library state={state} start={start} openExam={setExam} />}
          {tab === "progress" && <Progress state={state} />}
          {tab === "ai" && <AILearning key={language} state={state} />}
          {tab === "settings" && <Settings key={language} state={state} onSaved={load} />}
        </> : !error && <div className="empty-state"><Sparkles size={30} /><h2>你的学习空间正在准备</h2><p>词库就绪后，就能从第一阶开始。</p><button className="button primary" onClick={() => void load()}>刷新词库</button></div>}
        <footer className="page-footer"><span className="mini-mark">词阶</span><span>不赶路，记得住。</span><button onClick={() => nav("settings")}>学习规则与数据来源 <ArrowUpRight size={13} /></button></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="移动端主导航">{tabs.map(({ id, short, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => nav(id)} aria-current={tab === id ? "page" : undefined}><Icon size={21} strokeWidth={1.7} /><span>{short}</span></button>)}</nav>
    {study && <StudySession language={language} stageId={study.stageId} title={study.title} onClose={() => { setStudy(null); void load(); }} onChange={load} />}
    {exam && <ExamSession stage={exam} onClose={() => { setExam(null); void load(); }} onChange={load} />}
  </div>;
}
