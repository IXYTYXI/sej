"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChartNoAxesCombined, Check, ChevronDown, ChevronUp, Leaf, Lightbulb, LoaderCircle, MessageCircle, Pencil, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { Select, Tabs } from "radix-ui";
import { api, ApiError, type AIMessage, type AIProviderId, type AIRequest, type AIResponse, type AIStatus, type AppState, type StudyCard, formatNumber, languageName } from "./types";
import { ErrorNotice } from "./ui";
import "./ai-learning.css";

const providerLabel = (provider: AIProviderId) => provider === "anthropic" ? "Anthropic" : "OpenAI";
// A network failure or in-flight 409 has an uncertain outcome: reuse its ID.
// An explicit HTTP failure is saved by the server; another user click is a new
// attempt and needs a fresh ID. Nothing here retries a paid call automatically.
function retryRequest(request: AIRequest, error: unknown): AIRequest {
  return error instanceof ApiError && error.status >= 400 && error.status !== 409
    ? { ...request, requestId: crypto.randomUUID() } : request;
}

function useAIService() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [provider, setProvider] = useState<AIProviderId | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  const refresh = useCallback(() => api<AIStatus>("/api/ai/status")
    .then(next => {
      if (!mounted.current) return;
      setError(null);
      setStatus(next);
      setProvider(current => next.providers.some(item => item.id === current && item.enabled) ? current
        : next.providers.find(item => item.id === next.defaultProvider && item.enabled)?.id
          || next.providers.find(item => item.enabled)?.id || "");
    })
    .catch(cause => { if (mounted.current) setError(cause); })
    .finally(() => { if (mounted.current) setLoading(false); }), []);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);
  return { status, provider, setProvider, loading, error, refresh, mounted,
    exhausted: Boolean(status && status.dailyLimit !== null && status.usedToday >= status.dailyLimit) };
}

function ProviderControls({ service, busy, compact = false }: {
  service: ReturnType<typeof useAIService>; busy: boolean; compact?: boolean;
}) {
  const selectId = useId();
  const { status, provider, setProvider, loading, error, refresh, exhausted } = service;
  const selected = status?.providers.find(item => item.id === provider);
  const placeholder = loading ? "正在检查可用服务…" : error && !status ? "暂时无法读取服务状态" : "暂无可用 AI 服务";
  return <div className={`ai-provider-controls${compact ? " compact" : ""}`}>
    <div className="ai-provider-row"><div className="ai-provider-field"><label htmlFor={selectId}>AI 服务与模型</label>
      <Select.Root value={provider} disabled={busy || loading || !status?.providers.some(item => item.enabled)} onValueChange={value => setProvider(value as AIProviderId)}>
        <Select.Trigger id={selectId} className="ai-model-trigger" title={selected ? `${selected.label} · ${selected.model}` : placeholder}>
          <Select.Value placeholder={placeholder} className="ai-model-value">{selected && <span className="ai-model-value"><strong>{selected.label}</strong><span aria-hidden="true">·</span><span className="ai-model-name">{selected.model}</span></span>}</Select.Value>
          <Select.Icon asChild>{loading ? <LoaderCircle className="spin" size={17} /> : <ChevronDown size={17} />}</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="ai-model-menu" position="popper" align="start" sideOffset={6} collisionPadding={12}>
            <Select.ScrollUpButton className="ai-model-scroll"><ChevronUp size={17} /></Select.ScrollUpButton>
            <Select.Viewport className="ai-model-viewport">
              <Select.Group><Select.Label className="ai-model-menu-label">选择本次使用的 AI 服务</Select.Label>
                {status?.providers.map(item => <Select.Item key={item.id} value={item.id} disabled={!item.enabled} textValue={`${item.label} ${item.model}`} className="ai-model-option">
                  <Select.ItemText><span className="ai-model-option-copy"><strong>{item.label}</strong><span>{item.enabled ? item.model : "尚未配置，暂不可用"}</span></span></Select.ItemText>
                  <Select.ItemIndicator className="ai-model-check"><Check size={17} /></Select.ItemIndicator>
                </Select.Item>)}
              </Select.Group>
            </Select.Viewport>
            <Select.ScrollDownButton className="ai-model-scroll"><ChevronDown size={17} /></Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      </div>
      <button className="icon-button ai-service-refresh" type="button" aria-label="刷新 AI 服务状态" title="刷新服务状态，不会调用模型" onClick={() => void refresh()} disabled={busy || loading}><RefreshCw size={17} /></button>
    </div>
    {status && <div className="ai-service-status" aria-live="polite"><div className="ai-provider-badges">{status.providers.map(item => <span key={item.id} className={item.enabled ? "available" : "unavailable"}><i aria-hidden="true" />{item.label} · {item.enabled ? "可用" : "未配置"}</span>)}</div><span className={exhausted ? "ai-quota exhausted" : "ai-quota"}>{status.dailyLimit === null ? <>今日已用 <strong>{status.usedToday}</strong> 次 · 不限额</> : <>今日已用 <strong>{status.usedToday} / {status.dailyLimit}</strong> 次 · 剩余 {Math.max(0, status.dailyLimit - status.usedToday)} 次</>}</span></div>}
    {!loading && status && !provider && <p className="ai-config-note">AI 服务尚未启用。管理员配置好服务后即可使用，你可以照常学习和复习。</p>}
    {exhausted && <p className="ai-config-note">今日 AI 额度已用完，明天再继续。英语、日语及不同 AI 服务共用此额度。</p>}
    <ErrorNotice error={error} retry={() => void refresh()} />
  </div>;
}

function ResponseMeta({ response }: { response: AIResponse }) {
  return <div className="ai-response-meta"><Sparkles size={14} aria-hidden="true" /><span>{providerLabel(response.provider)} · {response.model}</span>{response.cached && <span className="ai-cached-result"><Check size={13} aria-hidden="true" />已保存的结果</span>}</div>;
}

function Pending({ text }: { text: string }) {
  return <div className="ai-pending" role="status"><LoaderCircle className="spin" size={19} aria-hidden="true" /><div><strong>{text}</strong><p>正在认真组织内容，请稍等片刻。</p></div></div>;
}

function chatContext(messages: AIMessage[]): AIMessage[] {
  // Stay below both the character limit and the 32 KiB JSON request limit. Keep complete
  // user/assistant turns when trimming and always end with the new user message.
  const context = messages.slice(-10).map(message => ({ ...message, content: message.content.slice(0, 4000) }));
  while (context.at(0)?.role === "assistant") context.shift();
  while (context.length > 1 && (context.reduce((sum, message) => sum + message.content.length, 0) > 12000 || new TextEncoder().encode(JSON.stringify(context)).byteLength > 30000)) {
    context.shift();
    while (context.at(0)?.role === "assistant") context.shift();
  }
  return context;
}

export function AILearning({ state }: { state: AppState }) {
  const service = useAIService();
  const [section, setSection] = useState<"report" | "chat">("report");
  const [report, setReport] = useState<AIResponse | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<unknown>(null);
  const reportRequest = useRef<AIRequest | null>(null);
  const [messages, setMessages] = useState<(AIMessage & { response?: AIResponse })[]>([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<unknown>(null);
  const chatRequest = useRef<AIRequest | null>(null);
  const inFlight = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const language = state.language;
  const busy = reportBusy || chatBusy;
  const canGenerate = Boolean(service.provider && !service.loading && !service.exhausted && !busy);
  useEffect(() => { if (section === "chat") chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages, chatBusy, section]);

  async function generateReport(retry = false) {
    if (!service.provider || inFlight.current || (!retry && service.exhausted)) return;
    const request = retry && reportRequest.current ? retryRequest(reportRequest.current, reportError) : {
      action: "report" as const, language, provider: service.provider, requestId: crypto.randomUUID(),
    };
    reportRequest.current = request;
    inFlight.current = true; setReportBusy(true); setReportError(null);
    try {
      const response = await api<AIResponse>("/api/ai", request);
      if (service.mounted.current) { setReport(response); reportRequest.current = null; }
    } catch (cause) { if (service.mounted.current) setReportError(cause); }
    finally {
      inFlight.current = false;
      if (service.mounted.current) { setReportBusy(false); void service.refresh(); }
    }
  }

  async function sendChat(retry = false) {
    if (!service.provider || inFlight.current || (!retry && (service.exhausted || !draft.trim() || chatRequest.current))) return;
    let request = retry && chatRequest.current ? retryRequest(chatRequest.current, chatError) : null;
    if (!request) {
      const next = [...messages, { role: "user" as const, content: draft.trim() }];
      request = { action: "chat", language, provider: service.provider, messages: chatContext(next), requestId: crypto.randomUUID() };
      setMessages(next); setDraft("");
    }
    chatRequest.current = request;
    inFlight.current = true; setChatBusy(true); setChatError(null);
    try {
      const response = await api<AIResponse>("/api/ai", request);
      if (service.mounted.current) { setMessages(current => [...current, { role: "assistant", content: response.text, response }]); chatRequest.current = null; }
    } catch (cause) { if (service.mounted.current) setChatError(cause); }
    finally {
      inFlight.current = false;
      if (service.mounted.current) { setChatBusy(false); void service.refresh(); }
    }
  }

  function editPending() {
    if (busy) return;
    const last = messages.at(-1);
    if (last?.role === "user") { setDraft(last.content); setMessages(current => current.slice(0, -1)); }
    chatRequest.current = null; setChatError(null); composer.current?.focus();
  }

  const prompts = language === "en"
    ? ["和我练习在咖啡店点单，一次只问一个问题。", "用简单英语聊聊周末计划，并帮我纠正表达。", "陪我练习工作中的自我介绍，给我中文提示。"]
    : ["和我练习在餐厅点餐，一次只问一个问题。", "用简单日语聊聊今天的生活，为汉字标注读音。", "陪我练习旅行中问路，并用中文解释表达。"];

  return <div className={`page-stack ai-learning${section === "chat" ? " ai-chat-mode" : ""}`}>
    <section className="ai-intro panel"><div className="ai-intro-copy"><span className="section-eyebrow">A THOUGHTFUL STUDY PARTNER</span><h2>让每一次练习，更有方向。</h2><p>看见薄弱处，找到记忆线索，再把学过的词用起来。</p></div><span className="ai-intro-symbol" aria-hidden="true"><Sparkles size={36} strokeWidth={1.25} /><Leaf size={19} /></span></section>
    <Tabs.Root className="panel ai-workspace" value={section} onValueChange={value => setSection(value as "report" | "chat")}>
      <div className="ai-workspace-top"><Tabs.List className="ai-tabs" aria-label="AI 学习方式">
        <Tabs.Trigger value="report" className={section === "report" ? "active" : ""}><ChartNoAxesCombined size={18} aria-hidden="true" />学习报告</Tabs.Trigger>
        <Tabs.Trigger value="chat" className={section === "chat" ? "active" : ""}><MessageCircle size={18} aria-hidden="true" />语言对话</Tabs.Trigger>
      </Tabs.List><span className="ai-language-label">{languageName(language)}学习助手</span></div>
      <ProviderControls service={service} busy={busy} />
      <p className="ai-disclosure"><Leaf size={14} /><span>AI 仅辅助学习，内容可能有误。只有点击生成或发送，才会将相关学习记录或对话发送给所选 AI 服务；不会自动调用。</span></p>
      {section === "report" ? <Tabs.Content value="report" className="ai-report">
        <div className="ai-report-heading"><div><h3>从学习记录，找到下一步。</h3><p>结合已学词汇与近期复习，分析薄弱词和记忆趋势，给出可执行的练习建议。</p></div><span className="ai-report-symbol" aria-hidden="true"><ChartNoAxesCombined size={25} strokeWidth={1.5} /></span></div>
        <div className="ai-learning-snapshot"><div><span>已掌握</span><strong>{formatNumber(state.stats.mastered)}<small>词</small></strong></div><div><span>正在学习</span><strong>{formatNumber(state.stats.learning)}<small>词</small></strong></div><div><span>到期复习</span><strong>{formatNumber(state.stats.due)}<small>词</small></strong></div></div>
        {state.stats.mastered + state.stats.learning === 0 && <p className="ai-empty-history"><Lightbulb size={18} aria-hidden="true" /><span>你还没有{languageName(language)}学习记录。可以先生成一份入门建议，学过一些词后再来分析薄弱处。</span></p>}
        <div className="ai-report-actions"><button type="button" className="button primary" onClick={() => void generateReport()} disabled={!canGenerate}>{reportBusy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{reportBusy ? "正在分析…" : report ? "重新分析学习记录" : "生成学习报告"}</button><span>新生成计入用量，缓存结果不重复计次。</span></div>
        <ErrorNotice error={reportError} retry={busy ? undefined : () => void generateReport(true)} />
        {reportBusy ? <Pending text="正在梳理你的学习与薄弱词" /> : report && <article className="ai-result" aria-label="AI 学习报告"><div className="ai-result-heading"><h4>你的学习报告</h4><ResponseMeta response={report} /></div><div className="ai-output">{report.text}</div><p className="ai-result-note">这份建议不会改变掌握率、复习安排或解锁条件。</p></article>}
      </Tabs.Content> : <Tabs.Content value="chat" className="ai-chat">
        <div className="ai-chat-heading"><div><h3>把认识的词，说进生活里。</h3><p>用{languageName(language)}练习，也可以随时请助手用中文解释。</p></div>{messages.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={() => { setMessages([]); setDraft(""); setChatError(null); chatRequest.current = null; }}><Trash2 size={16} />清空对话</button>}</div>
        {messages.length === 0 ? <div className="ai-chat-empty"><div className="ai-chat-empty-heading"><span className="ai-chat-symbol" aria-hidden="true"><MessageCircle size={24} strokeWidth={1.4} /></span><div><h4>从一个小场景开始</h4><p>选择话题，编辑后点击发送。</p></div></div><div className="ai-prompts">{prompts.map((prompt, index) => <button key={prompt} type="button" disabled={busy} onClick={() => { setDraft(prompt); composer.current?.focus(); }}><span className="ai-prompt-index" aria-hidden="true">0{index + 1}</span><span>{prompt}</span><ArrowRight size={16} aria-hidden="true" /></button>)}</div></div>
          : <div className="ai-conversation" role="log" aria-label="语言练习对话" aria-live="polite" aria-busy={chatBusy}>{messages.map((message, index) => <article key={index} className={`ai-message ${message.role}`}><span className="ai-message-label">{message.role === "user" ? "你" : <><Sparkles size={13} aria-hidden="true" />学习助手</>}</span><div className="ai-output" lang={message.role === "user" ? undefined : language}>{message.content}</div>{message.response && <ResponseMeta response={message.response} />}</article>)}{chatBusy && <Pending text="学习助手正在回复" />}<div ref={chatEnd} /></div>}
        <ErrorNotice error={chatError} retry={busy ? undefined : () => void sendChat(true)} />
        {chatError != null && <div className="ai-chat-recovery"><span>这条消息尚未收到回复。可重试或编辑后发送；重试会沿用上次内容及 AI 服务。</span><button type="button" className="text-button" onClick={editPending} disabled={busy}><Pencil size={15} />编辑这条消息</button></div>}
        <form className="ai-composer" onSubmit={event => { event.preventDefault(); void sendChat(); }}>
          <label htmlFor="ai-chat-message">给学习助手的消息</label><textarea ref={composer} id="ai-chat-message" aria-describedby="ai-chat-input-help" placeholder={`输入想练习的内容，中文或${languageName(language)}都可以…`} value={draft} maxLength={1500} rows={3} disabled={chatBusy || chatError != null} onChange={event => setDraft(event.target.value)} />
          <div className="ai-composer-actions"><div id="ai-chat-input-help" className="ai-composer-help"><span>Enter 换行，点击发送</span><span className={draft.length >= 1400 ? "ai-character-count near-limit" : "ai-character-count"}>{draft.length} / 1500</span></div><button className="button primary" type="submit" disabled={!canGenerate || !draft.trim() || chatError != null}>{chatBusy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{chatBusy ? "正在回复…" : "发送"}</button></div>
        </form><p className="ai-chat-note">对话只保留在当前页面。每次发送会附带最近最多 10 条消息；离开页面或切换语言会清空。</p>
      </Tabs.Content>}
    </Tabs.Root>
  </div>;
}

export function AIHint({ card, onBusyChange, disabled = false }: { card: StudyCard; onBusyChange: (busy: boolean) => void; disabled?: boolean }) {
  const service = useAIService();
  const [response, setResponse] = useState<AIResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<AIRequest | null>(null);
  const inFlight = useRef(false);
  async function generate(retry = false) {
    if (disabled || !service.provider || inFlight.current || (!retry && service.exhausted)) return;
    const request = retry && pending.current ? retryRequest(pending.current, error) : {
      action: "hint" as const, language: card.language, provider: service.provider, wordId: card.id, requestId: crypto.randomUUID(),
    };
    pending.current = request; inFlight.current = true;
    setBusy(true); onBusyChange(true); setError(null);
    try {
      const result = await api<AIResponse>("/api/ai", request);
      if (service.mounted.current) { setResponse(result); pending.current = null; }
    } catch (cause) { if (service.mounted.current) setError(cause); }
    finally {
      inFlight.current = false;
      if (service.mounted.current) { setBusy(false); onBusyChange(false); void service.refresh(); }
    }
  }
  return <section className="ai-hint" aria-label="AI 记忆提示">
    <div className="ai-hint-heading"><span className="ai-hint-symbol" aria-hidden="true"><Lightbulb size={21} strokeWidth={1.6} /></span><div><h3>给记忆，多一条线索。</h3><p>生成记忆提示、原创例句与中文译文。</p></div></div>
    <ProviderControls service={service} busy={busy || disabled} compact />
    <button type="button" className="button ghost ai-hint-button" disabled={busy || disabled || service.loading || !service.provider || service.exhausted} onClick={() => void generate()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{busy ? "正在整理记忆线索…" : response ? "再生成一份提示" : "生成记忆提示与例句"}</button>
    <p className="ai-hint-note">AI 仅辅助学习。点击后才会把这个词的资料发送给所选服务；缓存结果不重复计次。</p>
    <ErrorNotice error={error} retry={busy || disabled ? undefined : () => void generate(true)} />
    {busy && <Pending text="正在为这个词整理记忆提示" />}
    {response && !busy && <div className="ai-hint-result"><ResponseMeta response={response} /><div className="ai-output">{response.text}</div><span className="ai-result-note">AI 例句与提示可能有误，请结合原词典释义理解。</span></div>}
  </section>;
}
