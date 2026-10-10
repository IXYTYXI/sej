"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Flag, RotateCcw, Sparkles, X } from "lucide-react";
import { api, type Exam, type ExamResult, type Stage } from "./types";
import { ErrorNotice, Loading, Modal, ProgressBar } from "./ui";

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
    {loading ? <Loading text="正在准备阶段测验" /> : result ? <div className="exam-results"><span className={`finish-symbol ${result.passed ? "" : "coral"}`}>{result.passed ? <Sparkles size={37} /> : <Flag size={37} />}</span><span className="eyebrow">{result.passed ? "A NEW CHAPTER BEGINS" : "KEEP GROWING"}</span><h2>{result.passed ? "这一阶，稳稳走过。" : "再巩固一下，就更稳了。"}</h2><div className="exam-score">{result.score}<span> / {result.total}</span></div><p>{result.passed ? result.unlockedStageIds.length ? `测验通过！已开启 ${result.unlockedStageIds.length} 个新阶段。` : "测验通过，阶段完成记录已保存。" : "这次未通过。已经积累的掌握进度会保留，再复习后可以重新挑战。"}</p><button className="button primary" onClick={onClose}>回到学习路径 <ArrowRight size={16} /></button><div className="answer-review"><h3>回看这次作答</h3>{result.results.map((item, position) => <div className="answer-review-row" key={`${item.prompt}-${position}`}><span className={item.correct ? "answer-correct" : "answer-incorrect"}>{item.correct ? <Check size={16} /> : <X size={16} />}</span><div><strong>{item.prompt}</strong><p>正确答案：{item.answer}</p>{!item.correct && <span>你的选择：{item.chosen || "未作答"}</span>}</div></div>)}</div></div> : exam && question ? <div className="exam-content"><div className="session-topline"><span>{stage.title}</span><span>{index + 1} / {exam.questions.length}</span></div><ProgressBar value={index / exam.questions.length * 100} label="测验进度" /><div className="exam-instruction"><Flag size={14} />选择最符合词义的一项</div><h2 className="exam-prompt">{question.prompt}</h2><div className="exam-choices">{question.choices.map((choice, position) => <button key={choice.id} className={`exam-choice ${selected === choice.id ? "selected" : ""}`} disabled={saving} onClick={() => setSelected(choice.id)} aria-pressed={selected === choice.id}><span>{String.fromCharCode(65 + position)}</span><strong>{choice.text}</strong>{selected === choice.id && <Check size={19} />}</button>)}</div><ErrorNotice error={error} /><button className="button primary exam-next" disabled={!selected || saving} onClick={() => void next()}>{saving ? "正在核对作答…" : index === exam.questions.length - 1 ? "提交测验" : "下一题"}<ArrowRight size={17} /></button><p className="exam-note">测验检验掌握程度，不会替代日常复习记录。</p></div> : <div className="modal-inner"><ErrorNotice error={error || new Error("暂时无法生成测验，请稍后再试。")} retry={() => void start()} /><button className="button ghost" onClick={onClose}><RotateCcw size={15} />返回词库</button></div>}
  </Modal>;
}
