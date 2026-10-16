"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, CircleCheck, Clock3, RotateCcw } from "lucide-react";
import { api, type Language, type StudyMode, type StudyResponse } from "./types";
import { ErrorNotice } from "./ui";

export function StudyFinish({ initial, language, stageId, day, completed, practice, onReload, onClose, onManageQuota, onExam, onLibrary }: {
  initial: StudyResponse; language: Language; stageId?: string; day: string; completed: number; practice: boolean;
  onReload: (mode: StudyMode) => void; onClose: () => void; onManageQuota: () => void;
  onExam: (stageId: string) => void; onLibrary: () => void;
}) {
  const [summary, setSummary] = useState(initial);
  const [refreshing, setRefreshing] = useState(completed > 0 || practice);
  const [error, setError] = useState<unknown>(null);
  const requests = useRef({ sequence: 0 });
  const refresh = useCallback(() => {
    const request = ++requests.current.sequence;
    return api<StudyResponse>(`/api/study?language=${language}${stageId ? `&stageId=${encodeURIComponent(stageId)}` : ""}`)
      .then(result => { if (request === requests.current.sequence) { setSummary(result); setError(null); } })
      .catch(cause => { if (request === requests.current.sequence) setError(cause); })
      .finally(() => { if (request === requests.current.sequence) setRefreshing(false); });
  }, [language, stageId]);
  const retry = useCallback(() => { setRefreshing(true); void refresh(); }, [refresh]);
  useEffect(() => {
    const current = requests.current;
    if (completed > 0 || practice || initial.quota.day !== day) void refresh();
    return () => { current.sequence++; };
  }, [refresh, completed, practice, initial.quota.day, day]);
  useEffect(() => {
    // An empty window can stay open overnight or while its next review becomes due.
    // Refresh its explanation and actions without discarding an active flashcard.
    const resume = () => { if (document.visibilityState === "visible") retry(); };
    const nextDue = summary.availability.nextReviewAt;
    const timer = nextDue && summary.dueCount === 0
      ? window.setTimeout(resume, Math.min(2147483647, Math.max(1000, Date.parse(nextDue) - Date.now()))) : undefined;
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [retry, summary]);

  const { availability, quota, newRemaining, dueCount } = summary;
  const ready = dueCount > 0 || (!quota.needsDecision && newRemaining > 0 && availability.unseenCount > 0);
  const nextDue = availability.nextReviewAt && new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai",
  }).format(new Date(availability.nextReviewAt));
  const title = practice ? "熟悉的词，又见了一面。" : ready ? "还有词，等着和你见面。"
    : availability.unseenCount === 0 ? "已解锁的新词，都已经见过了。"
      : quota.needsDecision ? "新的一天，先选择新词额度。" : "今天的新词目标已完成。";
  const explanation = ready ? `还有 ${dueCount} 个到期词、${availability.unseenCount} 个已解锁新词，继续按记忆节奏学习。`
    : availability.unseenCount === 0 ? "已解锁范围内没有未学新词。每日额度是学习上限，新的一天不会自动解锁下一阶段。"
      : quota.needsDecision ? "选择保留或重置之前增加的额度后，就能继续学习新词。学习记录会保留。"
        : "已解锁词库里还有新词。你可以调整今日额度，也可以先练习已经学过的词。";
  return <div className="session-finish study-finish">
    <span className="finish-symbol"><CircleCheck size={42} strokeWidth={1.4} /></span>
    <span className="session-state-label">{practice ? "自主练习完成" : completed > 0 ? "本组学习已保存" : "当前学习安排"}</span>
    <h2>{title}</h2>
    {completed > 0 && <p>{practice ? `本次练习了 ${completed} 个已学词。练习仅在本次窗口内计数，不写入学习记录。` : `本组已完成 ${completed} 次学习，进度已经保存。`}</p>}
    <p>{explanation}</p>
    <div className="queue-availability" aria-label="可学习内容">
      <div><span>今日剩余新词额度</span><strong>{quota.needsDecision ? "待确认" : `${newRemaining} 个`}</strong></div>
      <div><span>已解锁的未学新词</span><strong>{availability.unseenCount} 个</strong></div>
      <div><span>可以自主练习</span><strong>{availability.learnedCount} 个</strong></div>
    </div>
    <div className="finish-actions queue-primary-actions">
      {ready && <button className="button primary" disabled={refreshing} onClick={() => onReload("scheduled")}>继续计划学习<ArrowRight size={16} /></button>}
      {!ready && availability.challengeStage && <button className="button primary" disabled={refreshing} onClick={() => onExam(availability.challengeStage!.id)}>参加过关测试<ArrowRight size={16} /></button>}
      {availability.learnedCount > 0 && <button className={`button ${ready || availability.challengeStage ? "outline" : "primary"}`} disabled={refreshing} onClick={() => onReload("practice")}><BookOpen size={16} />{practice ? "再练这一组" : "自主练习已学词"}</button>}
    </div>
    {nextDue && dueCount === 0 && <p className="next-review-time"><Clock3 size={16} /><span>下次计划复习：<strong>{nextDue}</strong><small>北京时间 · 根据你的回忆评分安排</small></span></p>}
    {!ready && availability.unseenCount === 0 && <p className="quota-next-note">{availability.challengeStage ? `「${availability.challengeStage.title}」已达到掌握门槛，可以参加过关测试。` : "可以到阶段列表查看测验与解锁进度。新阶段需掌握前一阶段的 80% 并通过测试；自主练习不改变掌握率或复习时间。"}</p>}
    <p className="queue-refresh-status" role="status">{refreshing ? "正在检查最新学习安排…" : error ? "学习安排暂未同步，请重试。" : "按记忆节奏复习，也可以随时自主练习。"}</p>
    <div className="finish-actions">
      {quota.needsDecision || (availability.unseenCount > 0 && newRemaining === 0) ? <button className="button outline" onClick={onManageQuota}>{quota.needsDecision ? "选择今日额度" : "调整今日新词额度"}<ArrowRight size={15} /></button> : null}
      {!ready && availability.unseenCount === 0 && <button className="button outline" onClick={onLibrary}>查看阶段与解锁进度<ArrowRight size={15} /></button>}
      <button className="button ghost" disabled={refreshing} onClick={retry}><RotateCcw size={15} />重新检查学习安排</button>
      <button className="text-button" onClick={onClose}>回到学习空间<ArrowRight size={15} /></button>
    </div>
    <ErrorNotice error={error} retry={refreshing ? undefined : retry} />
  </div>;
}
