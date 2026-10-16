"use client";

import { ArrowRight, BookOpen, Check, CircleCheck, Clock3, Flag, Layers3, LockKeyhole, MoveUpRight, Sparkles } from "lucide-react";
import { type AppState, type Stage, formatNumber, languageName } from "./types";
import { ProgressBar } from "./ui";
import "./page-polish.css";

export function TodayPlan({ state, start, openQuota, openExam }: { state: AppState; start: (stage?: Stage) => void; openQuota: () => void; openExam: (stage: Stage) => void }) {
  const { stats, quota, stages, language } = state;
  const challenge = stages.find(stage => stage.unlocked && !stage.passed && stage.canTest);
  const hasNextStage = challenge && stages.some(stage => stage.prerequisiteId === challenge.id);
  const remaining = quota.needsDecision ? 0 : Math.max(0, quota.limit - stats.todayNew);
  const todayReviewCount = Math.max(0, stats.todayReviews - stats.todayNew);
  const hasUnseen = stages.some(stage => stage.unlocked && stage.learned < stage.total);
  const hasLearned = stats.learning + stats.mastered > 0;
  const waitingForReview = stats.due === 0 && !hasUnseen && hasLearned;
  const isReady = stages.some(stage => stage.unlocked && stage.total > 0);
  const startPlan = () => stats.due > 0 || waitingForReview || remaining > 0 ? start() : openQuota();
  const planLabel = !isReady ? "词库准备中" : stats.due > 0 ? "开始今日复习" : waitingForReview ? "查看安排与自主练习" : quota.needsDecision ? "选择今日额度" : remaining > 0 ? "开始学习" : "调整今日新词额度";
  return <div className="page-stack today-page" style={{ marginBottom: 24 }}>
    <div className="today-grid"><section className="study-hero"><div className="hero-content"><div className="hero-badge"><span />{languageName(language)} · {challenge ? "阶段待测验" : "今日计划"}</div><h2>温故，<br />然后知新。</h2><p>{challenge ? `「${challenge.title}」全部词已学完。通过阶段测验，即可${hasNextStage ? "开启下一阶段" : "完成本阶段"}。` : stats.due > 0 ? `有 ${formatNumber(stats.due)} 个词，等着和你再次见面。` : waitingForReview ? "已解锁的新词都已学过，随时可以自主练习。" : stats.todayReviews > 0 ? "今天的到期复习已完成，给记忆一点时间。" : "从一个词开始，积累属于你的语言世界。"}</p><div className="hero-plan"><span><strong>{formatNumber(stats.due)}</strong> 个待复习</span><span className="hero-plan-divider" /><span><strong>{remaining}</strong> 个新词额度</span></div><div className="hero-actions"><button type="button" className="hero-button" onClick={() => challenge ? openExam(challenge) : startPlan()} disabled={!isReady} aria-label={challenge ? `${challenge.title}，参加阶段测验` : undefined}>{challenge ? "参加阶段测验" : planLabel}<ArrowRight size={18} aria-hidden="true" /></button>{challenge && <><span className="hero-exam-note">正确率达到 80% 即可通过 · 无需等待掌握</span><button type="button" className="hero-secondary-button" onClick={startPlan}>{planLabel}<ArrowRight size={16} aria-hidden="true" /></button></>}</div></div><div className="stair-art" aria-hidden="true"><div className="art-orbit" /><span className="art-star star-one">✳</span><span className="art-star star-two">✳</span><span className="art-word word-a">{language === "en" ? "grow" : "育つ"}</span><span className="art-word word-b">{language === "en" ? "remember" : "覚える"}</span><div className="stair stair-one" /><div className="stair stair-two" /><div className="stair stair-three" /><div className="stair stair-four" /><div className="art-sprout"><i /><i /><span /></div><span className="art-caption">ONE STEP AT A TIME</span></div></section>
      <section className="daily-note"><div className="section-eyebrow"><span className="tiny-square" />今日节奏</div><h3>每天一点，<br />比偶尔很多更好。</h3><div className="daily-goal"><div className="goal-number">{stats.todayNew}<span> / {quota.limit}</span></div><p>{quota.needsDecision ? "额度待确认 · 已学记录保留" : "今日已学新词"}</p><ProgressBar value={stats.todayNew / Math.max(1, quota.limit) * 100} label="今日新词目标" /></div><div className="daily-completed"><span><Check size={14} aria-hidden="true" />今日已复习</span><strong>{formatNumber(todayReviewCount)} <small>次</small></strong></div><p className="daily-footnote">到期复习优先，<br />新词按照你的每日额度安排。</p></section>
    </div>
  </div>;
}

export function Today({ state, start, openLibrary, openExam }: { state: AppState; start: (stage?: Stage) => void; openLibrary: () => void; openExam: (stage: Stage) => void }) {
  const { stats, quota, stages, language } = state;
  const current = stages.find(stage => stage.unlocked && !stage.passed && stage.canTest) || stages.find(stage => stage.unlocked && !stage.passed) || stages.find(stage => stage.unlocked);
  const hasNextStage = current && stages.some(stage => stage.prerequisiteId === current.id);
  const learnedPercent = current && current.total > 0 ? Math.floor(current.learned / current.total * 100) : 0;
  const canChallenge = Boolean(current && !current.passed && current.canTest);
  const statsList = [
    { label: "等待复习", value: stats.due, icon: Clock3, note: "让记忆再深一点", className: "coral" },
    { label: "今日新词", value: stats.todayNew, icon: Sparkles, note: quota.needsDecision ? "请选择今天保留或重置额度" : `今日额度 ${quota.limit} 词`, className: "green" },
    { label: "已经掌握", value: stats.mastered, icon: CircleCheck, note: "独立统计，不影响阶段解锁", className: "green" },
    { label: "已解锁阶段", value: stats.unlockedStages, icon: Layers3, note: `共 ${stats.totalStages} 个学习阶段`, className: "gold" },
  ];
  return <div className="page-stack today-page">
    <section className="stats-strip" aria-label="学习概览">{statsList.map(({ label, value, icon: Icon, note, className }) => <div className="stat-item" key={label}><div className="stat-label"><span className={`stat-icon ${className}`}><Icon size={17} aria-hidden="true" /></span>{label}</div><strong>{formatNumber(value)}</strong><span>{note}</span></div>)}</section>
    <section><div className="section-heading"><div><span className="section-eyebrow">YOUR LEARNING PATH</span><h2>沿着自己的节奏，继续向上</h2></div><button type="button" className="text-button" onClick={openLibrary}>全部词库 <ArrowRight size={16} aria-hidden="true" /></button></div>
      {current ? <div className="current-stage">
        <div className="current-stage-main"><div className="stage-book" aria-hidden="true"><BookOpen size={27} strokeWidth={1.6} aria-hidden="true" /><span>{language === "en" ? "Aa" : "あ"}</span></div><div><span className={`pill ${canChallenge ? "coral-pill" : "green-pill"}`}>{current.passed ? "阶段已通过" : canChallenge ? "学完待测验" : current.total === 0 ? "词条准备中" : current.learned > 0 ? "正在学习" : "待学习"}</span><h3>{current.title}</h3><p>{state.courses.find(course => course.id === current.courseId)?.title} · {formatNumber(current.total)} 个词</p></div></div>
        <div className="current-stage-progress">
          {current.total > 0 && <><div><span>已学 <strong>{formatNumber(current.learned)}</strong> / {formatNumber(current.total)} 词</span><strong>{learnedPercent}%</strong></div><ProgressBar value={learnedPercent} label={`${current.title}学习进度，已学 ${current.learned} / ${current.total} 词`} /><p className="stage-mastery-note">掌握 {Math.round(current.percent)}%（{formatNumber(current.mastered)} / {formatNumber(current.total)} 词）<span>独立统计，不影响测验与解锁</span></p></>}
          <p className="stage-next-step">{current.passed ? <CircleCheck size={14} aria-hidden="true" /> : canChallenge ? <Flag size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}<span>{current.passed ? "已通过的阶段与解锁资格永久保留" : current.total === 0 ? "词条就绪后即可开始学习" : canChallenge ? `全部词已学完，测验正确率达到 80% 后${hasNextStage ? "开启下一阶段" : "完成本阶段"}` : `再学 ${formatNumber(Math.max(0, current.total - current.learned))} 个词，即可参加阶段测验`}</span></p>
        </div>
        <button type="button" className={`button ${canChallenge ? "coral-button" : "outline"}`} disabled={current.total === 0} onClick={() => canChallenge ? openExam(current) : start(current)}>{current.total === 0 ? "词条准备中" : canChallenge ? "参加阶段测验" : current.passed ? "复习词汇" : current.learned > 0 ? "继续学习" : "开始学习"}<MoveUpRight size={15} aria-hidden="true" /></button>
      </div> : <div className="empty-state compact"><BookOpen size={28} aria-hidden="true" /><h3>第一阶即将开启</h3><p>暂时还没有可学习的词库，请稍后刷新。</p></div>}
    </section>
    <div className="memory-note"><span className="memory-note-icon"><Sparkles size={19} aria-hidden="true" /></span><div><strong>遗忘很正常，再次想起就是进步。</strong><p>词阶会根据每次回忆的难度，安排下一次见面的时间。按真实感受作答就好。</p></div><span className="memory-note-label">给记忆留一点时间</span></div>
  </div>;
}
