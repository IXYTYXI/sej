"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, Check, LoaderCircle, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { api, ApiError, type DailyQuota, type Language, type StudyResponse, type StudyMode, languageName } from "./types";
import { ErrorNotice, Loading, Modal, ProgressBar } from "./ui";
import { AIHint } from "./ai-learning";
import { StudyFinish } from "./study-finish";
import "./session-polish.css";

const ratings = [{ value: 1, label: "忘了", hint: "没能想起来" }, { value: 2, label: "有点难", hint: "费力才想起" }, { value: 3, label: "记得", hint: "正常想起来" }, { value: 4, label: "很熟", hint: "轻松又确定" }];
const tagLabels: Record<string, string> = {
  zk: "中考词汇", gk: "高考词汇", cet4: "大学英语四级", cet6: "大学英语六级", ky: "考研英语",
  ielts: "雅思词汇", toefl: "托福词汇", gre: "GRE 词汇",
  n1: "日语 N1", n2: "日语 N2", n3: "日语 N3", n4: "日语 N4", n5: "日语 N5",
  高频: "高频词", 中频: "中频词", 低频: "低频词", 名: "名词", 副: "副词",
  イ形: "い形容词", ナ形: "な形容词", 連語: "固定搭配", 接: "接续词", 代: "代词", 感: "感叹词",
};
const sourceLabels: Record<string, string> = { ecdict: "ECDICT 英汉词典", "eggrolls-jlpt": "egg rolls 日语能力考词库" };

type SessionProps = {
  language: Language; stageId?: string; title?: string; quota: DailyQuota; todayNew: number;
  onManageQuota: () => void; onClose: () => void; onChange: () => Promise<void>;
  onExam: (stageId: string) => void; onLibrary: () => void;
};

export function StudySession(props: SessionProps) {
  const [session, setSession] = useState({ mode: "scheduled" as StudyMode, sequence: 0 });
  const returnFocus = useRef<HTMLElement | null>(null);
  const captureFocus = (element: HTMLElement | null) => {
    if (!returnFocus.current?.isConnected) returnFocus.current = element;
  };
  return <StudyRound key={session.sequence} {...props} mode={session.mode}
    returnFocus={returnFocus} captureFocus={captureFocus}
    onReload={mode => setSession(current => ({ mode, sequence: current.sequence + 1 }))} />;
}

function StudyRound({ language, stageId, title, quota, onManageQuota, onClose, onChange, onExam, onLibrary, mode, onReload, returnFocus, captureFocus }: SessionProps & {
  mode: StudyMode; onReload: (mode: StudyMode) => void; returnFocus: RefObject<HTMLElement | null>;
  captureFocus: (element: HTMLElement | null) => void;
}) {
  const practice = mode === "practice";
  const [data, setData] = useState<StudyResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [audioNote, setAudioNote] = useState("");
  const [completed, setCompleted] = useState(0);
  const submitting = useRef(false);
  const submission = useRef<{ wordId: string; rating: number; version: number; requestId: string } | null>(null);
  const mounted = useRef(true);
  const requests = useRef({ sequence: 0 });
  const card = data?.cards[index];
  const displayTags = Array.from(new Set((card?.tags || []).map(tag => tagLabels[tag.toLowerCase()]).filter(Boolean))).slice(0, 2);
  const refreshState = useCallback(async () => {
    setRefreshing(true);
    try { await onChange(); if (mounted.current) setRefreshError(null); }
    catch (cause) { if (mounted.current) setRefreshError(cause); }
    finally { if (mounted.current) setRefreshing(false); }
  }, [onChange]);
  const fetchCards = useCallback(() => {
    const request = ++requests.current.sequence;
    const isCurrent = () => mounted.current && request === requests.current.sequence;
    return api<StudyResponse>(`/api/study?language=${language}&mode=${mode}${stageId ? `&stageId=${encodeURIComponent(stageId)}` : ""}`)
      .then(async result => {
        if (!isCurrent()) return;
        setData(result); setIndex(0); setError(null);
        await refreshState();
      })
      .catch(cause => { if (isCurrent()) setError(cause); })
      .finally(() => { if (isCurrent()) setLoading(false); });
  }, [language, stageId, refreshState, mode]);
  function load() {
    setLoading(true); setError(null); setRevealed(false); setAudioNote("");
    return fetchCards();
  }
  useEffect(() => {
    const currentRequests = requests.current;
    mounted.current = true;
    void fetchCards();
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    return () => { mounted.current = false; currentRequests.sequence++; if ("speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, [fetchCards]);
  async function rate(rating: number) {
    if (practice || !card || !revealed || submitting.current || hintBusy || (card.isNew && quota.needsDecision)) return;
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
      await refreshState();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.status === 409) { setNotice(`${cause.message} 已重新读取学习进度与今日额度。`); submission.current = null; await load(); }
      else setError(cause);
    } finally { submitting.current = false; if (mounted.current) setSaving(false); }
  }
  function finishPractice() {
    if (!practice || !card || !revealed || hintBusy) return;
    // Deliberately local: voluntary practice never submits a scheduled review.
    setCompleted(value => value + 1); setIndex(value => value + 1);
    setRevealed(false); setAudioNote(""); setNotice("");
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
  return <Modal title={practice ? `${languageName(language)} · 自主练习` : title || `${languageName(language)} · 今日学习`} onClose={onClose} busy={saving || hintBusy} restoreFocusRef={returnFocus} onCaptureFocus={captureFocus}>
    {loading ? <Loading text={practice ? "正在准备已学词练习" : "正在安排本次学习"} /> : error && !data ? <div className="modal-inner"><ErrorNotice error={error} retry={() => void load()} /></div> : !practice && card?.isNew && quota.needsDecision ? <div className="quota-study-decision"><span className="session-state-label">今日新词额度待确认</span><h2>新的一天，先选择新词额度。</h2><p>可以保留 {quota.limit} 个，也可以重置到基础 {quota.baseLimit} 个。已有学习记录不会清空，到期复习仍可继续。</p><div className="finish-actions"><button className="button primary" onClick={onManageQuota}>选择今日额度<ArrowRight size={16} /></button><button className="button ghost" onClick={() => void load()}><RotateCcw size={15} />只安排到期复习</button></div>{notice && <p className="session-notice" role="status">{notice}</p>}</div> : card ? <div className="study-content" aria-busy={saving}>
      {practice && <div className="practice-session-note"><strong>自主练习 · 随时温习</strong><p>只练习已学词，不消耗新词额度，不计入正式复习，也不改变掌握率和下次复习时间。</p><button className="text-button" disabled={hintBusy} onClick={() => onReload("scheduled")}>返回计划学习<ArrowRight size={14} /></button></div>}
      {!practice && quota.needsDecision && <div className="quota-study-notice"><p>今天的新词额度尚待选择。你可以继续复习；保留或重置额度都不会清空学习记录。</p><button className="text-button" disabled={saving || hintBusy} onClick={onManageQuota}>返回选择今日额度<ArrowRight size={14} /></button></div>}
      <div className="session-progress"><div className="session-topline"><span>{practice ? `${languageName(language)} · 已学词温习` : title || `${languageName(language)} · 今日练习`}</span><span className="session-count">第 <strong>{index + 1}</strong> / {data!.cards.length} 个</span></div><ProgressBar value={index / data!.cards.length * 100} label="本组学习进度" /><p className="session-progress-caption">本组已完成 {index} 个，按自己的节奏来。</p></div>
      <div className="word-card"><div className="word-card-tags"><span className={`pill ${card.isNew ? "coral-pill" : "green-pill"}`}>{card.isNew ? <Sparkles size={12} /> : <RotateCcw size={12} />}{practice ? "自主练习" : card.isNew ? "新朋友" : "再见一面"}</span>{displayTags.map(tag => <span key={tag} className="word-tag">{tag}</span>)}</div>
        <div className="word-prompt"><h2 lang={language} className={card.word.length > 16 ? "long-word" : ""}>{card.word}</h2><button className="pronounce-button" onClick={speak} aria-label={`播放${card.word}的发音`} title="播放发音"><Volume2 size={22} /></button></div>
        {card.reading && <p className="word-reading" lang={language}>{card.reading}</p>}
        {audioNote && <p className="audio-note" role="status">{audioNote}</p>}
        {revealed ? <div className="word-answer" aria-live="polite"><div className="answer-divider"><span>释义</span></div><p className="word-meaning">{card.meaning}</p>{card.example && <blockquote><p lang={language}>{card.example}</p>{card.exampleMeaning && <span>{card.exampleMeaning}</span>}</blockquote>}<span className="word-source">来源：{sourceLabels[card.source] || "详见「规则与设置」"}</span></div> : <div className="recall-prompt"><span className="recall-dot" /><p>先在心里回忆一下，<br />这个词是什么意思？</p><span className="recall-help">{practice ? "想好后，查看释义，再继续下一个词。" : "想好后，查看释义并选择熟悉程度。"}</span></div>}
      </div>
      <ErrorNotice error={error} />
      <ErrorNotice error={refreshError} retry={refreshing ? undefined : () => void refreshState()} />
      {revealed ? <>{practice ? <div className="practice-advance"><button className="button primary reveal-button" disabled={hintBusy} onClick={finishPractice}>{index + 1 === data!.cards.length ? "完成这组练习" : "继续下一个词"}<ArrowRight size={18} /></button><p>按自己的节奏回忆，本次练习仅在当前窗口内计数。</p></div> : <div className="rating-section"><p role="status">{(saving || hintBusy) && <LoaderCircle className="spin" size={16} />}{saving ? "正在保存这次回忆…" : hintBusy ? "正在生成记忆提示，请稍候…" : "这次，你想起来了吗？"}</p><div className="rating-buttons" role="group" aria-label="选择本次回忆的熟悉程度">{ratings.map(rating => <button className={`rating-button rating-${rating.value}`} key={rating.value} disabled={saving || hintBusy} onClick={() => void rate(rating.value)}><strong>{rating.label}</strong><span>{rating.hint}</span></button>)}</div><span className="rating-note">按查看提示前的回忆情况选择，复习安排才会更适合你。</span></div>}<AIHint key={card.id} card={card} onBusyChange={setHintBusy} disabled={saving} /></> : <button className="button primary reveal-button" onClick={() => setRevealed(true)}>查看释义 <ArrowRight size={18} /></button>}
      {notice && <div className="session-notice" role="status"><Check size={13} />{notice}</div>}
    </div> : data && <StudyFinish initial={data} language={language} stageId={stageId} day={quota.day}
      completed={completed} practice={practice} onReload={onReload} onClose={onClose}
      onManageQuota={onManageQuota} onExam={onExam} onLibrary={onLibrary} />}
  </Modal>;
}
