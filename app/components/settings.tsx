"use client";

import { useState } from "react";
import { ArrowUpRight, Check, CircleCheck, Clock3, GraduationCap, Layers3, Save } from "lucide-react";
import { type AppState, api } from "./types";
import { ErrorNotice } from "./ui";

const rules = [
  { icon: Clock3, title: "记忆有自己的节奏", text: "根据「忘了、有点难、记得、很熟」四种反馈，用 FSRS 间隔重复安排下次复习。到期词优先学习，错过一天也可以从今天继续。" },
  { icon: CircleCheck, title: "经过时间，才算掌握", text: "学习跨度至少 7 天，在至少 3 个不同日期成功完成到期复习；最新复习间隔达到 7 天，并且最近一次选择「记得」或「很熟」，才计为掌握。" },
  { icon: GraduationCap, title: "掌握 80%，再挑战下一阶", text: "当前阶段至少 80% 的词已掌握后，可参加阶段测验。通过后开启后续阶段，解锁资格永久保留；遗忘的词只需继续复习。" },
  { icon: Layers3, title: "两种语言，两条成长路径", text: "英语和日语的词汇量、等级与复习计划分别计算。同一语言多个词库中的重复词共享记忆进度，不会重复累计掌握量。" },
];

export function Settings({ state, onSaved }: { state: AppState; onSaved: () => Promise<void> }) {
  const [limit, setLimit] = useState(state.settings.dailyNewLimit);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try { await api("/api/settings", { dailyNewLimit: limit }); setSaved(true); await onSaved(); }
    catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  return <div className="page-stack">
    <section className="panel settings-plan"><div><span className="section-eyebrow">A PACE YOU CAN KEEP</span><h2>每天，认识多少新词？</h2><p>默认 10 个。复习量不受新词额度限制，<br className="desktop-only" />忙碌的时候，少学一点也很好。</p></div><div className="daily-limit-control"><div className="limit-value"><strong>{limit}</strong><span>个 / 天</span></div><label className="sr-only" htmlFor="daily-new-limit">每日新词数量</label><input id="daily-new-limit" type="range" disabled={saving} min={5} max={50} step={1} value={limit} onChange={event => { setLimit(Number(event.target.value)); setSaved(false); }} /><div className="range-labels"><span>5 个 · 轻松起步</span><span>50 个 · 多一点挑战</span></div><button className="button primary" disabled={saving} onClick={() => void save()}>{saved ? <Check size={16} /> : <Save size={16} />}{saving ? "正在保存…" : saved ? "已保存" : "保存每日目标"}</button><span className="settings-scope">此目标适用于英语和日语，各自计算每日额度。</span><ErrorNotice error={error} /></div></section>
    <section><div className="section-heading"><div><span className="section-eyebrow">HOW WORDSTEPS WORKS</span><h2>简单规则，长久记忆</h2></div></div><div className="rules-grid">{rules.map(({ icon: Icon, title, text }, index) => <article className="rule-card" key={title}><div className="rule-card-heading"><Icon size={23} strokeWidth={1.5} /><span>0{index + 1}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="panel sources-panel"><div className="section-heading"><div><span className="section-eyebrow">OPEN KNOWLEDGE, CLEAR SOURCES</span><h2>词库从哪里来</h2></div></div><p className="source-intro">词条内容、等级与释义遵循下列来源。日语能力考分级为学习参考，不代表官方公布的考试词表。</p><div className="sources-list">{state.sources.map(source => <article key={source.id}><div><a href={source.url} target="_blank" rel="noreferrer">{source.name}<ArrowUpRight size={15} /></a><p>{source.note}</p></div><a className="source-license" href={source.licenseUrl || source.url} target="_blank" rel="noreferrer">{source.license}<ArrowUpRight size={12} /></a></article>)}{!state.sources.length && <p className="subtle">词库导入后，会在这里显示来源与许可信息。</p>}</div></section>
  </div>;
}
