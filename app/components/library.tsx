"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, Flag, LockKeyhole } from "lucide-react";
import { type AppState, type Stage, formatNumber } from "./types";
import { ProgressBar } from "./ui";
import "./page-polish.css";

export function Library({ state, start, openExam }: { state: AppState; start: (stage?: Stage) => void; openExam: (stage: Stage) => void }) {
  const [selected, setSelected] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeFilter = state.courses.some(course => course.id === selected) ? selected : "all";
  const courses = activeFilter === "all" ? state.courses : state.courses.filter(course => course.id === activeFilter);

  return <div className="page-stack library-page">
    <div className="library-summary"><div><BookOpen size={23} /><span>收录 <strong>{formatNumber(state.stats.totalWords)}</strong> 个独立词条</span></div><span>同一语言的重复词，只累计一次掌握量</span></div>
    <div className="library-filter-section">
      <div className="course-filters" role="group" aria-label="筛选词库"><button type="button" aria-pressed={activeFilter === "all"} onClick={() => setSelected("all")} className={activeFilter === "all" ? "selected" : ""}>全部词库</button>{state.courses.map(course => <button type="button" key={course.id} aria-pressed={activeFilter === course.id} onClick={() => setSelected(course.id)} className={activeFilter === course.id ? "selected" : ""}>{course.title}</button>)}</div>
      <p className="filter-result" role="status">{activeFilter === "all" ? `全部 ${courses.length} 个词库` : `已筛选：${courses[0]?.title}`}<span>按阶段学习，逐步解锁</span></p>
    </div>
    {!courses.length && <div className="empty-state"><BookOpen size={32} /><h2>词库正在准备中</h2><p>词库就绪后，所有等级与真实学习进度会显示在这里。</p></div>}
    {courses.map(course => {
      const stages = state.stages.filter(stage => stage.courseId === course.id).sort((a, b) => a.index - b.index);
      const visibleCount = Math.max(4, stages.findIndex(stage => stage.unlocked && !stage.passed) + 2);
      const visibleStages = expanded[course.id] ? stages : stages.slice(0, visibleCount);
      return <section className="course-section" key={course.id} aria-labelledby={`course-heading-${course.id}`}>
        <div className="course-heading"><div><div className="section-eyebrow">{course.language === "en" ? "ENGLISH" : "JAPANESE"} COLLECTION</div><h2 id={`course-heading-${course.id}`}>{course.title}</h2><p>{course.description}</p></div><span className="pill neutral-pill">{stages.filter(stage => stage.passed).length} / {stages.length} 阶段已通过</span></div>
        <div className="stage-path" id={`stage-path-${course.id}`}>
          {visibleStages.map((stage, position) => {
            const prerequisite = state.stages.find(item => item.id === stage.prerequisiteId);
            const ready = stage.total > 0;
            return <article className={`path-stage ${stage.unlocked ? "available" : "locked"} ${stage.passed ? "passed" : ""}`} key={stage.id}>
              <div className="path-node" aria-hidden="true">{stage.passed ? <Check size={18} /> : stage.unlocked ? String(position + 1).padStart(2, "0") : <LockKeyhole size={16} />}</div>
              <div className="path-stage-content"><div className="path-stage-title"><h3>{stage.title}</h3><span className={`pill ${stage.passed ? "green-pill" : stage.unlocked ? "coral-pill" : "neutral-pill"}`}>{stage.passed ? "已通过" : stage.canTest ? "可测验" : stage.unlocked ? "已开启" : "待解锁"}</span></div><p>{formatNumber(stage.total)} 个词{stage.unlocked && ` · 已学习 ${formatNumber(stage.learned)} 个`}</p>
                {stage.unlocked ? <><div className="stage-mastery"><ProgressBar value={stage.percent} label={`${stage.title}掌握进度`} /><span>掌握 {Math.round(stage.percent)}% <small>（{formatNumber(stage.mastered)}/{formatNumber(stage.total)}）</small></span></div>{!stage.passed && <p className={`stage-next-step ${stage.canTest ? "test-ready" : ""}`}>{stage.canTest ? "已达到测验门槛，准备好就挑战一下。" : "掌握 80% 后，可挑战阶段测验。"}</p>}</> : <p className="unlock-condition"><LockKeyhole size={14} /><span>{prerequisite ? `${prerequisite.title}掌握 80% + 通过测验` : "完成前置阶段后解锁"}</span></p>}
              </div>
              <div className="path-stage-actions">{stage.unlocked ? <>{stage.canTest && <button type="button" className="button coral-button" aria-label={`${stage.title}，阶段测验`} onClick={() => openExam(stage)}><Flag size={16} />阶段测验</button>}<button type="button" className={`button ${stage.canTest ? "ghost" : "outline"}`} disabled={!ready} aria-label={`${stage.title}，${stage.passed ? "复习词汇" : stage.learned > 0 ? "继续学习" : "开始学习"}`} onClick={() => start(stage)}>{!ready ? "词条准备中" : stage.passed ? "复习词汇" : stage.learned > 0 ? "继续学习" : "开始学习"}<ArrowRight size={16} /></button></> : <span className="locked-label"><LockKeyhole size={14} />等待前一阶完成</span>}</div>
            </article>;
          })}
          {!stages.length && <div className="empty-state compact"><BookOpen size={28} /><h3>阶段正在准备中</h3><p>这个词库的学习阶段就绪后，会在这里展示。</p></div>}
        </div>
        {stages.length > visibleCount && <button type="button" className="expand-stages" aria-expanded={Boolean(expanded[course.id])} aria-controls={`stage-path-${course.id}`} onClick={() => setExpanded(value => ({ ...value, [course.id]: !value[course.id] }))}>{expanded[course.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{expanded[course.id] ? "收起阶段" : `查看全部 ${stages.length} 个阶段`}</button>}
      </section>;
    })}
    <div className="rule-banner"><LockKeyhole size={21} /><p><strong>解锁是一次里程碑。</strong>已经解锁的阶段会一直保留。忘记的词会回到复习队列，不会让你失去已走过的路。</p></div>
  </div>;
}
