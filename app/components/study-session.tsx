"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleCheck, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { api, ApiError, type Language, type StudyResponse, languageName } from "./types";
import { ErrorNotice, Loading, Modal, ProgressBar } from "./ui";
import { AIHint } from "./ai-learning";

const ratings = [{ value: 1, label: "忘了", hint: "没能想起来" }, { value: 2, label: "有点难", hint: "费力才想起" }, { value: 3, label: "记得", hint: "正常想起来" }, { value: 4, label: "很熟", hint: "轻松又确定" }];
const tagLabels: Record<string, string> = {
  zk: "中考词汇", gk: "高考词汇", cet4: "大学英语四级", cet6: "大学英语六级", ky: "考研英语",
  ielts: "雅思词汇", toefl: "托福词汇", gre: "GRE 词汇",
  n1: "日语 N1", n2: "日语 N2", n3: "日语 N3", n4: "日语 N4", n5: "日语 N5",
  高频: "高频词", 中频: "中频词", 低频: "低频词", 名: "名词", 副: "副词",
  イ形: "い形容词", ナ形: "な形容词", 連語: "固定搭配", 接: "接续词", 代: "代词", 感: "感叹词",
};
const sourceLabels: Record<string, string> = { ecdict: "ECDICT 英汉词典", "eggrolls-jlpt": "egg rolls 日语能力考词库" };

export function StudySession({ language, stageId, title, onClose, onChange }: { language: Language; stageId?: string; title?: string; onClose: () => void; onChange: () => Promise<void> }) {
  const [data, setData] = useState<StudyResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [audioNote, setAudioNote] = useState("");
  const [completed, setCompleted] = useState(0);
  const submitting = useRef(false);
  const submission = useRef<{ wordId: string; rating: number; version: number; requestId: string } | null>(null);
  const mounted = useRef(true);
  const card = data?.cards[index];
  const displayTags = Array.from(new Set((card?.tags || []).map(tag => tagLabels[tag.toLowerCase()]).filter(Boolean))).slice(0, 2);
  const load = useCallback(async () => {
    setLoading(true); setError(null); setRevealed(false); setAudioNote("");
    try { const result = await api<StudyResponse>(`/api/study?language=${language}${stageId ? `&stageId=${encodeURIComponent(stageId)}` : ""}`); if (mounted.current) { setData(result); setIndex(0); } }
    catch (cause) { if (mounted.current) setError(cause); }
    finally { if (mounted.current) setLoading(false); }
  }, [language, stageId]);
  useEffect(() => { mounted.current = true; void load(); if ("speechSynthesis" in window) window.speechSynthesis.getVoices(); return () => { mounted.current = false; if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }; }, [load]);
  async function rate(rating: number) {
    if (!card || !revealed || submitting.current || hintBusy) return;
    submitting.current = true; setSaving(true); setError(null);
    const previous = submission.current;
    const body = previous?.wordId === card.id && previous.rating === rating && previous.version === card.version
      ? previous : { wordId: card.id, rating, version: card.version, requestId: crypto.randomUUID() };
    submission.current = body;
    try {
      const result = await api<{ nextDue: string; isMastered: boolean }>("/api/review", body);
      if (!mounted.current) return;
      const due = new Date(result.nextDue);
      setNotice(Number.isNaN(due.getTime()) ? "已保存这次回忆" : `已记录，下次复习：${due.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })}`);
      submission.current = null; setCompleted(value => value + 1); setIndex(value => value + 1); setRevealed(false); setAudioNote("");
      void onChange();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) { setNotice("其他设备已更新这张卡，已重新载入最新进度。"); submission.current = null; await load(); }
      else setError(cause);
    } finally { submitting.current = false; if (mounted.current) setSaving(false); }
  }
  function speak() {
    setAudioNote("");
    if (!card || !("speechSynthesis" in window)) { setAudioNote("当前浏览器不支持发音。可以换用支持系统语音的浏览器。"); return; }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voice = voices.find(item => item.lang.toLowerCase().startsWith(language));
    if (!voice) { setAudioNote(`暂未找到${languageName(language)}语音。请在设备系统设置中添加对应语音，再点击播放。`); return; }
    synth.cancel(); const utterance = new SpeechSynthesisUtterance(card.word); utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.85;
    utterance.onerror = () => { if (mounted.current) setAudioNote("发音暂时不可用，请检查设备语音设置后再试。"); };
    synth.speak(utterance);
  }
  return <Modal title={title || `${languageName(language)} · 今日学习`} onClose={onClose} busy={saving || hintBusy}>
    {loading ? <Loading text="正在安排本次学习" /> : error && !data ? <div className="modal-inner"><ErrorNotice error={error} retry={() => void load()} /></div> : card ? <div className="study-content">
      <div className="session-topline"><span>{title || `${languageName(language)} · 今日练习`}</span><span>{index + 1} / {data!.cards.length}</span></div><ProgressBar value={index / data!.cards.length * 100} label="本组学习进度" />
      <div className="word-card"><div className="word-card-tags"><span className={`pill ${card.isNew ? "coral-pill" : "green-pill"}`}>{card.isNew ? <Sparkles size={12} /> : <RotateCcw size={12} />}{card.isNew ? "新朋友" : "再见一面"}</span>{displayTags.map(tag => <span key={tag} className="word-tag">{tag}</span>)}</div>
        <div className="word-prompt"><h2 lang={language} className={card.word.length > 16 ? "long-word" : ""}>{card.word}</h2><button className="pronounce-button" onClick={speak} aria-label={`播放${card.word}的发音`} title="播放发音"><Volume2 size={22} /></button></div>
        {card.reading && <p className="word-reading" lang={language}>{card.reading}</p>}
        {audioNote && <p className="audio-note" role="status">{audioNote}</p>}
        {revealed ? <div className="word-answer" aria-live="polite"><div className="answer-divider"><span>释义</span></div><p className="word-meaning">{card.meaning}</p>{card.example && <blockquote><p lang={language}>{card.example}</p>{card.exampleMeaning && <span>{card.exampleMeaning}</span>}</blockquote>}<span className="word-source">来源：{sourceLabels[card.source] || "详见「规则与设置」"}</span></div> : <div className="recall-prompt"><span className="recall-dot" /><p>先在心里回忆一下，<br />这个词是什么意思？</p></div>}
      </div>
      <ErrorNotice error={error} />
      {revealed ? <><div className="rating-section"><p>{saving ? "正在保存这次回忆…" : hintBusy ? "正在生成记忆提示，请稍候…" : "这次，你想起来了吗？"}</p><div className="rating-buttons">{ratings.map(rating => <button className={`rating-button rating-${rating.value}`} key={rating.value} disabled={saving || hintBusy} onClick={() => void rate(rating.value)}><strong>{rating.label}</strong><span>{rating.hint}</span></button>)}</div><span className="rating-note">按查看提示前的回忆情况选择，复习安排才会更适合你。</span></div><AIHint key={card.id} card={card} onBusyChange={setHintBusy} disabled={saving} /></> : <button className="button primary reveal-button" onClick={() => setRevealed(true)}>查看释义 <ArrowRight size={18} /></button>}
      {notice && <div className="session-notice" role="status"><Check size={13} />{notice}</div>}
    </div> : <div className="session-finish"><span className="finish-symbol"><CircleCheck size={42} strokeWidth={1.4} /></span><span className="eyebrow">ONE STEP FURTHER</span><h2>{completed > 0 ? "又向前走了一小步。" : "这一刻，可以歇一歇。"}</h2><p>{completed > 0 ? `本次已完成 ${completed} 次练习，进度已经保存。` : "目前没有可学习的卡片。到期复习或新的每日额度开放后，再来继续。"}</p>{data && <p className="subtle">今日剩余新词额度 {data.newRemaining} 个 · 系统会优先安排到期复习</p>}<div className="finish-actions"><button className="button primary" onClick={onClose}>回到学习空间 <ArrowRight size={16} /></button><button className="button ghost" onClick={() => { setNotice(""); void load(); }}><RotateCcw size={15} />检查下一组</button></div><ErrorNotice error={error} /></div>}
  </Modal>;
}
