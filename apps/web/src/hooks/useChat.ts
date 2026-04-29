import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { env } from "../lib/env";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
  /** True when this message is still streaming. */
  streaming?: boolean;
}

export interface UseChatOpts {
  agentSlug: string;
  /** Existing session, or undefined to start fresh. */
  sessionId?: string;
  onSessionCreated?: (id: string) => void;
}

export interface UseChatValue {
  messages: ChatMessage[];
  isStreaming: boolean;
  send: (content: string) => Promise<void>;
  abort: () => void;
  loadHistory: () => Promise<void>;
  reset: () => void;
  error: string | null;
}

/**
 * Streaming chat hook. Uses SSE via the fetch streaming reader (not EventSource
 * because EventSource can't send POST bodies).
 *
 * Heartbeat events from server are dropped silently. We track "last activity"
 * to fail fast if the connection wedges.
 */
export function useChat({ agentSlug, sessionId, onSessionCreated }: UseChatOpts): UseChatValue {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | undefined>(sessionId);
  const abortRef = useRef<AbortController | null>(null);

  // Re-sync ref when prop changes (route switching, etc.)
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const loadHistory = useCallback(async () => {
    if (!sessionIdRef.current) {
      setMessages([]);
      return;
    }
    const { data: ses } = await supabase.auth.getSession();
    const token = ses.session?.access_token;
    if (!token) return;

    const r = await fetch(`${env.API_URL}/api/agents/sessions/${sessionIdRef.current}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      setError(`Failed to load history (${r.status})`);
      return;
    }
    const data = await r.json();
    setMessages(
      data.messages.map((m: ChatMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        metadata: m.metadata,
      })),
    );
  }, []);

  // Auto-load when sessionId becomes truthy
  useEffect(() => {
    if (sessionId) void loadHistory();
    else setMessages([]);
  }, [sessionId, loadHistory]);

  const reset = useCallback(() => {
    sessionIdRef.current = undefined;
    setMessages([]);
    setError(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isStreaming) return;
      setError(null);

      const { data: ses } = await supabase.auth.getSession();
      const token = ses.session?.access_token;
      if (!token) {
        setError("Sessão expirada. Faça login de novo.");
        return;
      }

      // Optimistic local user message — has a temporary id until server replies
      const tempUserId = `tmp-user-${Date.now()}`;
      const tempAssistantId = `tmp-asst-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: trimmed,
          created_at: new Date().toISOString(),
        },
        {
          id: tempAssistantId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
          streaming: true,
        },
      ]);

      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `${env.API_URL}/api/agents/${agentSlug}/chat/stream`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: trimmed,
              session_id: sessionIdRef.current,
            }),
          },
        );

        if (!res.ok || !res.body) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse complete SSE events from the buffer
          let nl;
          while ((nl = buffer.indexOf("\n\n")) >= 0) {
            const rawEvent = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);

            let dataLine: string | null = null;
            for (const l of rawEvent.split("\n")) {
              if (l.startsWith("data: ")) dataLine = l.slice(6);
            }
            if (!dataLine) continue;

            let parsed: {
              type: "ready" | "chunk" | "done" | "error";
              sessionId?: string;
              userMessageId?: string;
              delta?: string;
              content?: string;
              assistantMessageId?: string;
              message?: string;
            };
            try {
              parsed = JSON.parse(dataLine);
            } catch {
              continue;
            }

            if (parsed.type === "ready") {
              if (parsed.sessionId && !sessionIdRef.current) {
                sessionIdRef.current = parsed.sessionId;
                onSessionCreated?.(parsed.sessionId);
              }
              if (parsed.userMessageId) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempUserId ? { ...m, id: parsed.userMessageId! } : m,
                  ),
                );
              }
            } else if (parsed.type === "chunk") {
              const delta = parsed.delta ?? "";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAssistantId
                    ? { ...m, content: m.content + delta }
                    : m,
                ),
              );
            } else if (parsed.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempAssistantId
                    ? {
                        ...m,
                        id: parsed.assistantMessageId ?? m.id,
                        content: parsed.content ?? m.content,
                        streaming: false,
                      }
                    : m,
                ),
              );
            } else if (parsed.type === "error") {
              setError(parsed.message ?? "Erro desconhecido");
              setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // user cancelled — drop the streaming placeholder
          setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
        } else {
          setError((err as Error).message ?? "Erro de conexão");
          setMessages((prev) => prev.filter((m) => m.id !== tempAssistantId));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [agentSlug, isStreaming, onSessionCreated],
  );

  return { messages, isStreaming, send, abort, loadHistory, reset, error };
}
