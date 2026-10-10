import { appPath } from "../../lib/paths";

export type Language = "en" | "ja";
export type Tab = "today" | "library" | "progress" | "ai" | "settings";
export type Course = { id: string; title: string; language: Language; description: string; sourceUrl: string };
export type Stage = {
  id: string; courseId: string; language: Language; title: string; index: number;
  prerequisiteId: string | null; total: number; mastered: number; learned: number;
  percent: number; unlocked: boolean; passed: boolean; canTest: boolean;
};
export type AppState = {
  user: { name: string }; language: Language; settings: { dailyNewLimit: number };
  stats: { mastered: number; learning: number; due: number; totalWords: number; todayReviews: number;
    todayNew: number; unlockedStages: number; totalStages: number };
  courses: Course[]; stages: Stage[];
  history: { date: string; reviews: number; newWords: number }[];
  sources: { id: string; name: string; url: string; license: string; licenseUrl: string; note: string }[];
};
export type StudyCard = {
  id: string; language: Language; word: string; reading: string; meaning: string;
  example?: string; exampleMeaning?: string; tags: string[]; source: string;
  version: number; isNew: boolean;
};
export type StudyResponse = { cards: StudyCard[]; newRemaining: number; dueCount: number };
export type Exam = { id: string; questions: { id: string; prompt: string; choices: { id: string; text: string }[] }[]; expiresAt: string };
export type ExamResult = { score: number; total: number; passed: boolean; unlockedStageIds: string[];
  results: { prompt: string; correct: boolean; answer: string; chosen: string }[] };
export type AIProviderId = "anthropic" | "openai";
export type AIProvider = { id: AIProviderId; label: string; model: string; enabled: boolean };
export type AIStatus = { providers: AIProvider[]; defaultProvider: AIProviderId | null; dailyLimit: number; usedToday: number };
export type AIMessage = { role: "user" | "assistant"; content: string };
export type AIRequest = { action: "report" | "hint" | "chat"; language: Language; provider: AIProviderId;
  wordId?: string; messages?: AIMessage[]; requestId: string };
export type AIResponse = { text: string; provider: AIProviderId; model: string; cached: boolean };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(appPath(url), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "暂时无法完成请求，请再试一次。";
  if (!response.ok) throw new ApiError(message, response.status);
  if (!data) throw new ApiError("服务暂时没有返回数据，请再试一次。", response.status);
  return data as T;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : "网络连接中断，请再试一次。";
export const formatNumber = (value: number) => value.toLocaleString("zh-CN");
export const languageName = (language: Language) => language === "en" ? "英语" : "日语";
