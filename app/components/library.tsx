"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, Flag, LockKeyhole } from "lucide-react";
import { type AppState, type Stage, formatNumber } from "./types";
import { ProgressBar } from "./ui";

export function Library({ state, start, openExam }: { state: AppState; start: (stage?: Stage) => void; openExam: (stage: Stage) => void }) {
  const [selected, setSelected] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const courses = selected === "all" ? state.courses : state.courses.filter(course => course.id === selected);
  return <div className="page-stack">
    <div className="library-summary"><div><BookOpen size={21} /><span>收录 <strong>{formatNumber(state.stats.totalWords)}</strong> 个独立词条</span></div><span>同一语言的重复词，只累计一次掌握量</span></div>
    <div className="course-filters" aria-label="筛选词库"><button onClick={() => setSelected("all")} className={selected === "all" ? "selected" : ""}>全部词库</button>{state.courses.map(course => <button key={course.id} onClick={() => setSelected(course.id)} className={selected === course.id ? "selected" : ""}>{course.title}</button>)}</div>
    {!courses.length && <div className="empty-state"><BookOpen size={32} /><h2>词库正在准备中</h2><p>词库就绪后，所有等级与真实学习进度会显示在这里。</p></div>}
    {courses.map(course => { const stages = state.stages.filter(stage => stage.courseId === course.id).sort((a, b) => a.index - b.index); return <section className="course-section" key={course.id}>
      <div className="course-heading"><div><div className="section-eyebrow">{course.language === "en" ? "ENGLISH" : "JAPANESE"} COLLECTION</div><h2>{course.title}</h2><p>{course.description}</p></div><span className="pill neutral-pill">{stages.filter(stage => stage.passed).length} / {stages.length} 阶段已通过</span></div>
      <div className="stage-path">{(expanded[course.id] ? stages : stages.slice(0, Math.max(4, stages.findIndex(stage => stage.unlocked && !stage.passed) + 2))).map((stage, position) => { const prerequisite = state.stages.find(item => item.id === stage.prerequisiteId); return <article className={`path-stage ${stage.unlocked ? "available" : "locked"} ${stage.passed ? "passed" : ""}`} key={stage.id}>
        <div className="path-node">{stage.passed ? <Check size={18} /> : stage.unlocked ? String(position + 1).padStart(2, "0") : <LockKeyhole size={16} />}</div>
        <div className="path-stage-content"><div className="path-stage-title"><h3>{stage.title}</h3><span className={`pill ${stage.passed ? "green-pill" : stage.unlocked ? "coral-pill" : "neutral-pill"}`}>{stage.passed ? "已通过" : stage.unlocked ? "已开启" : "待解锁"}</span></div><p>{formatNumber(stage.total)} 个词{stage.unlocked && ` · 已学习 ${formatNumber(stage.learned)} 个`}</p>
          {stage.unlocked ? <div className="stage-mastery"><ProgressBar value={stage.percent} label={`${stage.title}掌握进度`} /><span>掌握 {Math.round(stage.percent)}% <small>（{stage.mastered}/{stage.total}）</small></span></div> : <p className="unlock-condition"><LockKeyhole size={12} />{prerequisite ? `${prerequisite.title}掌握 80% + 通过测验` : "完成前置阶段后解锁"}</p>}
        </div>
        <div className="path-stage-actions">{stage.unlocked ? <>{stage.canTest && <button className="button coral-button" onClick={() => openExam(stage)}><Flag size={15} />阶段测验</button>}<button className={`button ${stage.canTest ? "ghost" : "outline"}`} onClick={() => start(stage)}>{stage.passed ? "复习词汇" : "开始学习"}<ArrowRight size={15} /></button></> : <span className="locked-label">前方，还有新的风景</span>}</div>
      </article>; })}</div>{stages.length > Math.max(4, stages.findIndex(stage => stage.unlocked && !stage.passed) + 2) && <button className="expand-stages" onClick={() => setExpanded(value => ({ ...value, [course.id]: !value[course.id] }))}>{expanded[course.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{expanded[course.id] ? "收起阶段" : `查看全部 ${stages.length} 个阶段`}</button>}
    </section>; })}
    <div className="rule-banner"><LockKeyhole size={20} /><p><strong>解锁是一次里程碑。</strong>已经解锁的阶段会一直保留。忘记的词会回到复习队列，不会让你失去已走过的路。</p></div>
  </div>;
}
