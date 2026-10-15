"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, Leaf, LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { api, ApiError, type DailyQuota, type Language, type QuotaRequest, languageName } from "./types";
import { ErrorNotice } from "./ui";
import "./daily-quota.css";

export function DailyQuotaPanel({ quota, language, todayNew, hidden = false, onChanged, onRefresh }: {
  quota: DailyQuota; language: Language; todayNew: number; hidden?: boolean;
  onChanged: (quota: DailyQuota) => Promise<void>; onRefresh: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef<QuotaRequest | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const inputId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const first = quota.boostsUsed === 0;
  const increment = first ? 10 : Number(amount);
  const valid = first || (/^[0-9]+$/.test(amount) && Number.isInteger(increment) && increment >= 1 && increment <= 100);
  const blocked = busy || uncertain || refreshError != null;
  const remaining = quota.needsDecision ? 0 : Math.max(0, quota.limit - todayNew);

  async function refresh() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try { await onRefresh(); if (mounted.current) setRefreshError(null); }
    catch (cause) { if (mounted.current) setRefreshError(cause); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  async function submit(action: QuotaRequest["action"], retry = false) {
    if (submitting.current || (!retry && (blocked || (action === "boost" && (!valid || quota.needsDecision || quota.boostsRemaining < 1))))) return;
    const request = retry && pending.current ? pending.current : {
      language, action, ...(action === "boost" ? { amount: increment } : {}),
      day: quota.day, version: quota.version, requestId: crypto.randomUUID(),
    };
    pending.current = request; submitting.current = true;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api<{ quota: DailyQuota }>("/api/quota", request);
      pending.current = null;
      if (!mounted.current) return;
      setUncertain(false); setAmount("10"); setRefreshError(null);
      setNotice(result.quota.day !== quota.day ? "已确认上一次操作，正在同步今天的最新额度。"
        : request.action === "boost" ? `已增加 ${request.amount} 个新词额度，此次操作已保存。`
        : request.action === "keep" ? `已保留 ${result.quota.limit} 个新词额度，今天有 3 次新的增加机会。`
          : `已重置为基础额度 ${result.quota.baseLimit} 个。历史学习记录完整保留。`);
      // Saving succeeded. A later read failure must never turn the next click
      // into another quota mutation: retry only the state refresh in that case.
      try { await onChanged(result.quota); }
      catch (cause) { if (mounted.current) setRefreshError(cause); }
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.status === 409) {
        pending.current = null; setUncertain(false);
        setNotice(`${cause.message} 请根据刷新后的额度重新选择。`);
        try { await onRefresh(); }
        catch (refreshCause) { if (mounted.current) setRefreshError(refreshCause); }
      } else {
        const unknownOutcome = !(cause instanceof ApiError) || cause.status >= 500 || cause.status < 400;
        if (!unknownOutcome) pending.current = null;
        setUncertain(unknownOutcome); setError(cause);
      }
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }

  return <section id="daily-quota" className={`daily-quota-panel${quota.needsDecision ? " decision" : ""}`} hidden={hidden && !busy && !uncertain && !notice && !refreshError && !error} aria-labelledby="daily-quota-title" aria-busy={busy} tabIndex={-1}>
    <div className="quota-heading"><span className="quota-symbol">{quota.needsDecision ? <Clock3 size={23} strokeWidth={1.5} /> : <Leaf size={23} strokeWidth={1.5} />}</span><div className="quota-heading-copy"><span className="section-eyebrow">{languageName(language)} · {quota.day}</span><h2 id="daily-quota-title">{quota.needsDecision ? "新的一天，额度由你决定。" : "今天，还想多认识几个词？"}</h2></div><div className="quota-chances"><span>{quota.needsDecision ? "确认后可用" : "今日剩余增加机会"}</span><div><strong>{quota.boostsRemaining}</strong><span> / 3 次</span><span className="quota-chance-marks" aria-hidden="true">{[0, 1, 2].map(position => <i key={position} className={position < quota.boostsRemaining ? "available" : "used"} />)}</span></div></div></div>
    {quota.needsDecision ? <>
      <p className="quota-description">{quota.previousDay ? `${quota.previousDay} 的额度曾提升至 ${quota.previousLimit ?? quota.limit} 个。` : "上一天曾增加新词额度。"}今天可以保留提升后的额度，也可以回到基础设置。</p>
      <div className="quota-decision-actions"><button className="button primary" disabled={blocked} onClick={() => void submit("keep")}>{busy ? <LoaderCircle className="spin" size={19} /> : <Check size={19} />}<span><strong>保留 {quota.limit} 个 / 天</strong><small>延续提升后的学习额度</small></span><ArrowRight size={17} /></button><button className="button outline" disabled={blocked} onClick={() => void submit("reset")}><RotateCcw size={19} /><span><strong>重置到基础 {quota.baseLimit} 个 / 天</strong><small>回到基础设置，学习记录保留</small></span></button></div>
      <p className="quota-note">两个选项都不会清空已学单词、掌握记录或复习安排。今天都会重新获得 3 次增加机会；选择前可继续复习，暂不安排新词。</p>
    </> : <>
      <dl className="quota-summary"><div><dt>今日新词上限</dt><dd>{quota.limit}<span>个</span></dd></div><div><dt>今日已学新词</dt><dd>{todayNew}<span>个</span></dd></div><div className="quota-remaining"><dt>今天还可学</dt><dd>{remaining}<span>个</span></dd></div></dl>
      {quota.boostsRemaining > 0 ? <div className="quota-adjust-row"><div className="quota-amount">
        {first ? <span className="quota-fixed"><Plus size={18} />第一次固定增加 <strong>10</strong> 个</span> : <><label htmlFor={inputId}>第 {quota.boostsUsed + 1} 次增加</label><input id={inputId} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={amount} disabled={blocked} aria-invalid={!valid} aria-describedby={`${inputId}-help`} onChange={event => { setAmount(event.target.value); setError(null); pending.current = null; }} /><span>个新词</span></>}
        <span className="quota-preview" id={`${inputId}-help`}>{valid ? <>增加后：<strong>{quota.limit + increment}</strong> 个 / 今天</> : "请输入 1–100 之间的正整数"}</span>
      </div><button className="button primary" type="button" disabled={blocked || !valid} onClick={() => void submit("boost")}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}增加 {valid ? increment : "新词"} 个额度<ArrowRight size={14} /></button></div>
        : <p className="quota-exhausted"><Check size={16} />今天的 3 次增加机会已用完。明天会重新获得 3 次机会。</p>}
      <div className="quota-details"><span>基础额度 {quota.baseLimit} 个 / 天</span>{quota.boosts.length > 0 && <p className="quota-boost-history">今日已增加：{quota.boosts.map(value => `+${value}`).join("、")} 个</p>}</div>
      <p className="quota-note">每天可增加 3 次：第一次固定 +10，后两次各增加 1–100 个。英语和日语分别计算；跨天可选择保留额度或重置，学习记录始终保留。</p>
    </>}
    {busy && <p className="quota-busy" role="status"><LoaderCircle className="spin" size={16} />正在同步额度，请稍候…</p>}
    {notice && <p className="quota-notice" role="status"><Check size={18} /><span>{notice}</span>{hidden && !busy && !refreshError && !uncertain && <button className="text-button quota-dismiss" onClick={() => { setNotice(""); setError(null); }}>收起</button>}</p>}
    {uncertain && <p className="quota-uncertain">上一次操作的结果尚未确认。请先重试确认，再修改数量；重试不会重复占用增加机会。</p>}
    <ErrorNotice error={error} retry={uncertain && !busy ? () => { if (pending.current) void submit(pending.current.action, true); } : undefined} />
    {refreshError != null && <div className="quota-refresh-error" role="alert"><p>{notice.startsWith("已") ? "额度已保存，但学习概览未能刷新。" : "未能读取最新额度。"}请先刷新确认，刷新不会再次增加额度。</p><button className="text-button" disabled={busy} onClick={() => void refresh()}><RotateCcw size={14} />{busy ? "正在刷新…" : "仅刷新学习状态"}</button></div>}
  </section>;
}
