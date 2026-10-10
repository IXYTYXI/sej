"use client";

import { BookOpen, CircleCheck, Leaf, TrendingUp } from "lucide-react";
import { type AppState, formatNumber, languageName } from "./types";
import { ProgressBar } from "./ui";

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
  return <div className="page-stack">
    <section className="progress-overview"><div className="growth-intro"><span className="section-eyebrow">{languageName(state.language)} · 长期积累</span><h2>让熟悉，<br />成为一种习惯。</h2><Leaf size={48} strokeWidth={1.2} /></div><div className="growth-metric"><CircleCheck size={22} /><strong>{formatNumber(stats.mastered)}</strong><span>已掌握词汇</span><p>经过多次到期复习与时间检验</p></div><div className="growth-metric"><BookOpen size={22} /><strong>{formatNumber(stats.learning)}</strong><span>正在巩固</span><p>还在熟悉路上，继续就好</p></div><div className="growth-metric"><TrendingUp size={22} /><strong>{activeDays}<small> / 14</small></strong><span>最近两周学习天数</span><p>有学习或复习记录的日子</p></div></section>
    <section className="panel history-panel"><div className="section-heading"><div><span className="section-eyebrow">SHOWING UP MATTERS</span><h2>最近 14 天的学习足迹</h2></div><div className="chart-legend"><span><i className="review-color" />复习次数</span><span><i className="new-color" />新词数</span></div></div>
      {activeDays > 0 ? <><div className="activity-chart" role="img" aria-label="最近十四天新词与复习记录柱状图">{days.map(day => <div className="chart-column" key={day.date}><div className="chart-bar-space"><div className="chart-bar" style={{ height: `${(day.reviews + day.newWords) / max * 100}%` }} title={`${day.date}：复习 ${day.reviews} 次，新词 ${day.newWords} 个`}><span className="review-color" style={{ flex: day.reviews }} /><span className="new-color" style={{ flex: day.newWords }} /></div></div><span>{Number(day.date.slice(5, 7))}/{Number(day.date.slice(8))}</span></div>)}</div><details className="chart-data"><summary>查看每日记录</summary><div className="data-table-wrap"><table><thead><tr><th>日期</th><th>复习次数</th><th>新词数</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.reviews}</td><td>{day.newWords}</td></tr>)}</tbody></table></div></details></> : <div className="empty-state compact"><span className="empty-leaf"><Leaf size={30} /></span><h3>第一笔记录，等你写下</h3><p>完成一次学习后，这里就会留下你的足迹。</p></div>}
    </section>
    <section className="panel"><div className="section-heading"><div><span className="section-eyebrow">BUILDING YOUR VOCABULARY</span><h2>每一阶的积累</h2></div><span className="subtle">掌握量按词条去重</span></div><div className="progress-stage-list">{stages.filter(stage => stage.unlocked).map(stage => <div className="progress-stage-row" key={stage.id}><div><strong>{stage.title}</strong><span>{stage.mastered} / {stage.total} 已掌握</span></div><ProgressBar value={stage.percent} label={`${stage.title}掌握进度`} /><strong>{Math.round(stage.percent)}%</strong></div>)}{!stages.some(stage => stage.unlocked) && <p className="subtle">词库准备好后，阶段进度会出现在这里。</p>}</div></section>
  </div>;
}
