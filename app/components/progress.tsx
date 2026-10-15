"use client";

import { BookOpen, CircleCheck, Leaf, TrendingUp } from "lucide-react";
import { type AppState, formatNumber, languageName } from "./types";
import { ProgressBar } from "./ui";
import "./page-polish.css";

export function Progress({ state }: { state: AppState }) {
  const { stats, history, stages } = state;
  const todayString = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(`${todayString}T12:00:00+08:00`); date.setUTCDate(date.getUTCDate() - 13 + index);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const entry = history.find(item => item.date.slice(0, 10) === key);
    return { date: key, reviews: Math.max(0, (entry?.reviews || 0) - (entry?.newWords || 0)), newWords: entry?.newWords || 0 };
  });
  const max = Math.max(1, ...days.map(day => day.reviews + day.newWords));
  const activeDays = days.filter(day => day.reviews + day.newWords > 0).length;
  const reviewTotal = days.reduce((total, day) => total + day.reviews, 0);
  const newTotal = days.reduce((total, day) => total + day.newWords, 0);
  const unlockedStages = stages.filter(stage => stage.unlocked);

  return <div className="page-stack progress-page">
    <section className="progress-overview" aria-label="成长概览"><div className="growth-intro"><span className="section-eyebrow">{languageName(state.language)} · 长期积累</span><h2>让熟悉，<br />成为一种习惯。</h2><Leaf size={48} strokeWidth={1.2} aria-hidden="true" /></div><div className="growth-metric"><CircleCheck size={22} /><strong>{formatNumber(stats.mastered)}</strong><span>已掌握词汇</span><p>经过多次到期复习与时间检验</p></div><div className="growth-metric"><BookOpen size={22} /><strong>{formatNumber(stats.learning)}</strong><span>正在巩固</span><p>还在熟悉路上，继续就好</p></div><div className="growth-metric"><TrendingUp size={22} /><strong>{activeDays}<small> / 14</small></strong><span>最近两周学习天数</span><p>有学习或复习记录的日子</p></div></section>
    <section className="panel history-panel"><div className="section-heading"><div><span className="section-eyebrow">SHOWING UP MATTERS</span><h2>最近 14 天的学习足迹</h2></div><div className="chart-legend"><span><i className="review-color" />复习次数</span><span><i className="new-color" />新词数</span></div></div>
      {activeDays > 0 ? <>
        <div className="history-summary"><span>累计复习 <strong>{formatNumber(reviewTotal)}</strong> 次</span><span>学习新词 <strong>{formatNumber(newTotal)}</strong> 个</span><span>按北京时间记录</span></div>
        <div className="chart-scale" aria-hidden="true"><span>每日学习量</span><span>单日最高 {formatNumber(max)}</span></div>
        <div className="activity-chart" role="img" aria-label={`最近十四天新词与复习记录柱状图，共学习 ${activeDays} 天，复习 ${reviewTotal} 次，新词 ${newTotal} 个。详细数据见下方每日记录。`}>{days.map((day, index) => <div className={`chart-column ${index === days.length - 1 ? "is-today" : ""}`} key={day.date}><div className="chart-bar-space"><div className="chart-bar" style={{ height: `${(day.reviews + day.newWords) / max * 100}%` }} title={`${day.date}：复习 ${day.reviews} 次，新词 ${day.newWords} 个`}><span className="review-color" style={{ flex: day.reviews }} /><span className="new-color" style={{ flex: day.newWords }} /></div></div><span className={index % 2 === 1 && index !== days.length - 1 ? "chart-date alternate-date" : "chart-date"}>{index === days.length - 1 ? "今天" : `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8))}`}</span></div>)}</div>
        <details className="chart-data"><summary>查看每日记录<span>14 天明细</span></summary><div className="data-table-wrap"><table><caption className="sr-only">最近 14 天的每日学习记录，按北京时间统计</caption><thead><tr><th scope="col">日期</th><th scope="col">复习次数</th><th scope="col">新词数</th></tr></thead><tbody>{days.map(day => <tr className={day.date === todayString ? "today-record" : ""} key={day.date}><th scope="row">{day.date}{day.date === todayString && <span>今天</span>}</th><td>{formatNumber(day.reviews)}</td><td>{formatNumber(day.newWords)}</td></tr>)}</tbody></table></div></details>
      </> : <div className="empty-state compact"><span className="empty-leaf"><Leaf size={30} /></span><h3>最近 14 天，还没有学习记录</h3><p>完成一次学习或复习后，这里就会留下足迹。更早积累的掌握量仍会保留在成长概览中。</p></div>}
    </section>
    <section className="panel"><div className="section-heading"><div><span className="section-eyebrow">BUILDING YOUR VOCABULARY</span><h2>每一阶的积累</h2></div><span className="subtle">掌握量按词条去重</span></div><div className="progress-stage-list">{unlockedStages.map(stage => <div className="progress-stage-row" key={stage.id}><div><strong>{stage.title}</strong><span>{state.courses.find(course => course.id === stage.courseId)?.title} · {formatNumber(stage.mastered)} / {formatNumber(stage.total)} 已掌握</span></div><ProgressBar value={stage.percent} label={`${stage.title}掌握进度`} /><strong>{Math.round(stage.percent)}%</strong></div>)}{!unlockedStages.length && <div className="empty-state compact"><BookOpen size={28} /><h3>从第一阶开始积累</h3><p>词库准备好后，已解锁阶段与掌握进度会出现在这里。</p></div>}</div></section>
  </div>;
}
