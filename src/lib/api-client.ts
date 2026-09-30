"use client";

import { useRef, useState } from "react";

import { errorMessage, issueMessages } from "./labels";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; messages: string[]; details?: unknown };

/** Calls the FinTrack REST API with the cookie session. Never throws. */
export async function apiRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; ifMatch?: string | number; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.ifMatch !== undefined) headers["if-match"] = `"${options.ifMatch}"`;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as { data?: T; error?: { code: string; details?: unknown } }) : {};
    if (response.ok) return { ok: true, status: response.status, data: json.data as T };
    const code = json.error?.code ?? "INTERNAL_ERROR";
    const detailMessages = issueMessages(json.error?.details);
    return { ok: false, status: response.status, code, details: json.error?.details, messages: detailMessages.length ? detailMessages : [errorMessage[code] ?? "Belum tersimpan."] };
  } catch {
    return { ok: false, status: 0, code: "NETWORK", messages: [errorMessage.NETWORK] };
  }
}

/**
 * Financial mutation with server acknowledgement (PRD): prevents duplicate
 * submission, keeps the same Idempotency-Key for a retry of the same body,
 * and surfaces the cutover-day question when the server asks for it.
 */
export function useMutation<TBody, TResult = unknown>(path: string | (() => string), method = "POST") {
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [needsCutoverAnswer, setNeedsCutoverAnswer] = useState(false);

  async function submit(body: TBody, options: { ifMatch?: string | number } = {}): Promise<ApiResult<TResult>> {
    if (pending) return { ok: false, status: 0, code: "PENDING", messages: [] };
    const serialized = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== serialized) attempt.current = { key: crypto.randomUUID(), body: serialized };
    setPending(true);
    setError(null);
    const result = await apiRequest<TResult>(typeof path === "function" ? path() : path, {
      method,
      body,
      ifMatch: options.ifMatch,
      idempotencyKey: method === "POST" || method === "PUT" ? attempt.current.key : undefined,
    });
    setPending(false);
    if (result.ok) {
      attempt.current = null;
      setNeedsCutoverAnswer(false);
    } else if (result.code === "CUTOVER_DAY_CONFIRMATION_REQUIRED") {
      setNeedsCutoverAnswer(true);
    } else {
      setError(result.messages);
    }
    return result;
  }

  return { submit, pending, error, setError, needsCutoverAnswer, setNeedsCutoverAnswer };
}

export const todayInJakarta = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
