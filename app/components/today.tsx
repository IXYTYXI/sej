"use client";

import { ArrowRight, BookOpen, Check, CircleCheck, Clock3, Layers3, LockKeyhole, MoveUpRight, Sparkles } from "lucide-react";
import { type AppState, type Stage, formatNumber, languageName } from "./types";
import { ProgressBar } from "./ui";

export function Today({ state, start, openLibrary, openExam, openQuota }: { state: AppState; start: (stage?: Stage) => void; openLibrary: () => void; openExam: (stage: Stage) => void; openQuota: () => void }) {
  const { stats, quota, stages, language } = state;
  const current = stages.find(stage => stage.unlocked && !stage.passed) || stages.find(stage => stage.unlocked);
  const remaining = quota.needsDecision ? 0 : Math.max(0, quota.limit - stats.todayNew);
  const todayReviewCount = Math.max(0, stats.todayReviews - stats.todayNew);
  const isReady = stages.some(stage => stage.unlocked && stage.total > 0);
  const statsList = [
    { label: "等待复习", value: stats.due, icon: Clock3, note: "让记忆再深一点", className: "coral" },
    { label: "今日新词", value: stats.todayNew, icon: Sparkles, note: quota.needsDecision ? "请选择今天保留或重置额度" : `今日额度 ${quota.limit} 词`, className: "green" },
    { label: "已经掌握", value: stats.mastered, icon: CircleCheck, note: "经过时间检验的记忆", className: "green" },
    { label: "已解锁阶段", value: stats.unlockedStages, icon: Layers3, note: `共 ${stats.totalStages} 个学习阶段`, className: "gold" },
  ];
  return <div className="page-stack">
    <div className="today-grid"><section className="study-hero"><div className="hero-content"><div className="hero-badge"><span />{languageName(language)} · 今日计划</div><h2>温故，<br />然后知新。</h2><p>{stats.due > 0 ? `有 ${formatNumber(stats.due)} 个词，等着和你再次见面。` : stats.todayReviews > 0 ? "今天的到期复习已完成，给记忆一点时间。" : "从一个词开始，积累属于你的语言世界。"}</p><div className="hero-plan"><span><strong>{formatNumber(stats.due)}</strong> 个待复习</span><span className="hero-plan-divider" /><span><strong>{remaining}</strong> 个新词额度</span></div><button className="hero-button" onClick={() => stats.due > 0 || remaining > 0 ? start() : openQuota()} disabled={!isReady}>{isReady ? stats.due > 0 ? "开始今日复习" : quota.needsDecision ? "选择今日额度" : remaining > 0 ? "开始学习" : "调整今日新词额度" : "词库准备中"}<ArrowRight size={18} /></button></div><div className="stair-art" aria-hidden="true"><div className="art-orbit" /><span className="art-star star-one">✳</span><span className="art-star star-two">✳</span><span className="art-word word-a">{language === "en" ? "grow" : "育つ"}</span><span className="art-word word-b">{language === "en" ? "remember" : "覚える"}</span><div className="stair stair-one" /><div className="stair stair-two" /><div className="stair stair-three" /><div className="stair stair-four" /><div className="art-sprout"><i /><i /><span /></div><span className="art-caption">ONE STEP AT A TIME</span></div></section>
      <section className="daily-note"><div className="section-eyebrow"><span className="tiny-square" />今日节奏</div><h3>每天一点，<br />比偶尔很多更好。</h3><div className="daily-goal"><div className="goal-number">{stats.todayNew}<span> / {quota.limit}</span></div><p>{quota.needsDecision ? "额度待确认 · 已学记录保留" : "今日已学新词"}</p><ProgressBar value={stats.todayNew / Math.max(1, quota.limit) * 100} label="今日新词目标" /></div><div className="daily-completed"><span><Check size={14} />今日已复习</span><strong>{formatNumber(todayReviewCount)} <small>次</small></strong></div><p className="daily-footnote">到期复习优先，<br />新词按照你的每日额度安排。</p></section>
    </div>
    <section className="stats-strip" aria-label="学习概览">{statsList.map(({ label, value, icon: Icon, note, className }) => <div className="stat-item" key={label}><div className="stat-label"><span className={`stat-icon ${className}`}><Icon size={17} /></span>{label}</div><strong>{formatNumber(value)}</strong><span>{note}</span></div>)}</section>
    <section><div className="section-heading"><div><span className="section-eyebrow">YOUR LEARNING PATH</span><h2>沿着自己的节奏，继续向上</h2></div><button className="text-button" onClick={openLibrary}>全部词库 <ArrowRight size={16} /></button></div>
      {current ? <div className="current-stage"><div className="current-stage-main"><div className="stage-book"><BookOpen size={27} strokeWidth={1.6} /><span>{language === "en" ? "Aa" : "あ"}</span></div><div><span className="pill green-pill">{current.passed ? "已通过阶段" : "正在学习"}</span><h3>{current.title}</h3><p>{state.courses.find(course => course.id === current.courseId)?.title} · {formatNumber(current.total)} 个词</p></div></div><div className="current-stage-progress"><div><span>已掌握 <strong>{current.mastered}</strong> / {current.total}</span><strong>{Math.round(current.percent)}%</strong></div><ProgressBar value={current.percent} label={`${current.title}掌握进度`} /><p><LockKeyhole size={12} />掌握 80% 并通过测验，开启下一阶</p></div><button className="button outline" onClick={() => current.canTest ? openExam(current) : start(current)}>{current.canTest ? "挑战阶段测验" : "继续学习"}<MoveUpRight size={15} /></button></div> : <div className="empty-state compact"><BookOpen size={28} /><h3>第一阶即将开启</h3><p>暂时还没有可学习的词库，请稍后刷新。</p></div>}
    </section>
    <div className="memory-note"><span className="memory-note-icon"><Sparkles size={19} /></span><div><strong>遗忘很正常，再次想起就是进步。</strong><p>词阶会根据每次回忆的难度，安排下一次见面的时间。按真实感受作答就好。</p></div><span className="memory-note-label">给记忆留一点时间</span></div>
  </div>;
}
