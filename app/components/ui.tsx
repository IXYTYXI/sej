"use client";

import { useRef, type RefObject } from "react";
import { AlertCircle, ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
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

export function Modal({ children, title, onClose, busy = false, restoreFocusRef, onCaptureFocus }: {
  children: React.ReactNode; title: string; onClose: () => void; busy?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onCaptureFocus?: (element: HTMLElement | null) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="modal-backdrop">
      <Dialog.Content className="focus-modal" ref={dialog} aria-describedby={undefined}
        onOpenAutoFocus={event => {
          event.preventDefault();
          const focused = document.activeElement as HTMLElement | null;
          if (!previous.current?.isConnected) previous.current = focused;
          onCaptureFocus?.(focused);
          dialog.current?.focus();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const returnFocus = restoreFocusRef ?? previous;
          // Keep an intentional destination focus (for example, the quota panel).
          if (document.activeElement === document.body || dialog.current?.contains(document.activeElement)) returnFocus.current?.focus();
        }}
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <div className="modal-heading"><Dialog.Title className="modal-title"><span>WORDSTEPS</span>{title}</Dialog.Title><Dialog.Close asChild><button type="button" className="icon-button" disabled={busy} aria-label={`关闭${title}窗口`}><X size={21} /></button></Dialog.Close></div>
        {children}
      </Dialog.Content>
    </Dialog.Overlay></Dialog.Portal>
  </Dialog.Root>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>;
}
