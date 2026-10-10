"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { ApiError } from "./types";
import { appPath } from "../../lib/paths";

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  const unauthorized = error instanceof ApiError && error.status === 401;
  return <div className="error-notice" role="alert"><AlertCircle size={19} /><div>
    <p>{unauthorized ? "登录已过期，请重新登录后继续学习。" : error instanceof Error ? error.message : String(error)}</p>
    {unauthorized ? <a href={appPath("/login")} target="_top">重新登录 <ArrowUpRight size={14} /></a>
      : retry && <button type="button" onClick={retry}>再试一次</button>}
  </div></div>;
}

export function Loading({ text = "正在整理你的学习进度" }: { text?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={27} /><p>{text}</p><span>每一步，都为记得更久。</span></div>;
}

export function Modal({ children, title, onClose, busy = false }: {
  children: React.ReactNode; title: string; onClose: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { close.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) close.current();
      if (event.key !== "Tab") return;
      const buttons = dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div className="focus-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialog}>
    <div className="modal-heading"><span className="eyebrow">WORDSTEPS / {title}</span><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭学习窗口"><X size={22} /></button></div>
    {children}
  </div></div>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>;
}
