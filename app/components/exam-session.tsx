"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Flag, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { api, type Exam, type ExamResult, type Stage } from "./types";
import { ErrorNotice, Loading, Modal, ProgressBar } from "./ui";
import "./session-polish.css";

export function ExamSession({ stage, onClose, onChange }: { stage: Stage; onClose: () => void; onChange: () => Promise<void> }) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  async function start() {
    setLoading(true); setError(null);
    try { const data = await api<Exam>("/api/exam", { stageId: stage.id }); if (active.current) { setExam(data); setIndex(0); setAnswers({}); setSelected(null); setResult(null); } }
    catch (cause) { if (active.current) setError(cause); }
    finally { if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; void start(); return () => { active.current = false; }; }, []); // The dialog is mounted for one stage.
  const question = exam?.questions[index];
  async function next() {
    if (!exam || !question || !selected || inFlight.current) return;
    const updated = { ...answers, [question.id]: selected }; setAnswers(updated); setError(null);
    if (index < exam.questions.length - 1) { setIndex(value => value + 1); setSelected(null); return; }
    inFlight.current = true; setSaving(true);
    try { const response = await api<ExamResult>("/api/exam/submit", { id: exam.id, answers: updated }); if (active.current) { setResult(response); void onChange(); } }
    catch (cause) { if (active.current) setError(cause); }
    finally { inFlight.current = false; if (active.current) setSaving(false); }
  }
  return <Modal title="阶段测验" onClose={onClose} busy={saving}>
    {loading ? <Loading text="正在准备阶段测验" /> : result ? <div className="exam-results session-results">
      <span className={`finish-symbol ${result.passed ? "" : "coral"}`}>{result.passed ? <Sparkles size={37} /> : <Flag size={37} />}</span>
      <span className={`session-state-label ${result.passed ? "passed" : "retry"}`}>{result.passed ? "阶段测验已通过" : "继续巩固，再来挑战"}</span>
      <h2>{result.passed ? "这一阶，稳稳走过。" : "再巩固一下，就更稳了。"}</h2>
      <div className="exam-score-card"><span className="exam-score-label">本次答对</span><div className="exam-score">{result.score}<span> / {result.total} 题</span></div></div>
      <p>{result.passed ? result.unlockedStageIds.length ? `测验通过！已开启 ${result.unlockedStageIds.length} 个新阶段。` : "测验通过，阶段完成记录已保存。" : "这次未通过。已经积累的掌握进度会保留，再复习后可以重新挑战。"}</p>
      <button className="button primary" onClick={onClose}>回到学习路径 <ArrowRight size={16} /></button>
      <div className="answer-review"><div className="answer-review-heading"><h3>回看这次作答</h3><span>共 {result.total} 题</span></div>{result.results.map((item, position) => <div className={`answer-review-row ${item.correct ? "correct" : "incorrect"}`} key={`${item.prompt}-${position}`}>
        <span className={`answer-review-symbol ${item.correct ? "answer-correct" : "answer-incorrect"}`} aria-hidden="true">{item.correct ? <Check size={17} /> : <X size={17} />}</span>
        <div className="answer-review-copy"><div className="answer-review-meta"><span>第 {position + 1} 题</span><span>{item.correct ? "回答正确" : "需要巩固"}</span></div><strong>{item.prompt}</strong><p><span>正确答案</span>{item.answer}</p>{!item.correct && <p className="answer-chosen"><span>你的选择</span>{item.chosen || "未作答"}</p>}</div>
      </div>)}</div>
    </div> : exam && question ? <div className="exam-content" aria-busy={saving}>
      <div className="session-progress"><div className="session-topline"><span>{stage.title}</span><span className="session-count">第 <strong>{index + 1}</strong> / {exam.questions.length} 题</span></div><ProgressBar value={index / exam.questions.length * 100} label="测验进度" /><p className="session-progress-caption">已完成 {index} 题 · 全部作答后查看结果</p></div>
      <div className="exam-question"><div className="exam-instruction"><Flag size={16} />选择最符合词义的一项</div><h2 className="exam-prompt">{question.prompt}</h2></div>
      <div className="exam-choices" role="group" aria-label="选择一个答案">{question.choices.map((choice, position) => <button key={choice.id} className={`exam-choice ${selected === choice.id ? "selected" : ""}`} disabled={saving} onClick={() => setSelected(choice.id)} aria-pressed={selected === choice.id}><span className="exam-choice-letter">{String.fromCharCode(65 + position)}</span><strong>{choice.text}</strong><span className="exam-choice-indicator" aria-hidden="true">{selected === choice.id && <Check size={18} />}</span></button>)}</div>
      <ErrorNotice error={error} />
      <div className="exam-submit"><p className="exam-selection-status" role="status">{saving ? "正在提交并核对本次作答，请稍候。" : selected ? `已选择 ${String.fromCharCode(65 + question.choices.findIndex(choice => choice.id === selected))}，${index === exam.questions.length - 1 ? "可以提交测验了。" : "确认后继续下一题。"}` : "请选择一个答案后继续。"}</p><button className="button primary exam-next" disabled={!selected || saving} onClick={() => void next()}>{saving ? <LoaderCircle className="spin" size={17} /> : null}{saving ? "正在核对作答…" : index === exam.questions.length - 1 ? "提交测验" : "下一题"}{!saving && <ArrowRight size={17} />}</button></div>
      <p className="exam-note">测验检验掌握程度，不会替代日常复习记录。</p>
    </div> : <div className="modal-inner"><ErrorNotice error={error || new Error("暂时无法生成测验，请稍后再试。")} retry={() => void start()} /><button className="button ghost" onClick={onClose}><RotateCcw size={15} />返回词库</button></div>}
  </Modal>;
}
