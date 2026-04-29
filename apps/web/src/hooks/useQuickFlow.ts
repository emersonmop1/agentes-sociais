/**
 * Quick Flow hook — drives the Insta Creator batch SSE endpoint.
 *
 * Streams events:
 *   planned   — { topics: [{ title, angle }, ...] }
 *   post      — { index, total, post: PostSummary }
 *   skipped   — { index, total, reason, topic_title, error? }
 *   done      — { generated, skipped }
 *   error     — { message }
 *
 * The hook surfaces a state object the UI can render directly: phase
 * (idle/planning/running/done/error), the planned topics, generated posts,
 * skipped entries, and the running counts.
 */

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { env } from "../lib/env";
import type { VisualStyleSlug } from "./useInstaPosts";

export type QuickFlowPhase = "idle" | "planning" | "running" | "done" | "error";

export interface QuickFlowTopic {
  title: string;
  angle: string;
}

export interface QuickFlowPostResult {
  index: number;
  topic_title: string;
  post: {
    id: string;
    title: string;
    status: string;
    visual_style: string;
    slides_count: number;
  };
}

export interface QuickFlowSkipped {
  index: number;
  topic_title: string;
  reason: "quota_exceeded" | "agent_no_copy" | "agent_failed";
  error?: string;
}

export interface QuickFlowState {
  phase: QuickFlowPhase;
  topics: QuickFlowTopic[];
  posts: QuickFlowPostResult[];
  skipped: QuickFlowSkipped[];
  errorMessage: string | null;
  total: number;
}

const initial: QuickFlowState = {
  phase: "idle",
  topics: [],
  posts: [],
  skipped: [],
  errorMessage: null,
  total: 0,
};

export function useQuickFlow() {
  const [state, setState] = useState<QuickFlowState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  const start = useCallback(
    async (args: { count: number; visual_style?: VisualStyleSlug; seed?: string }) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setState({ ...initial, phase: "error", errorMessage: "not_authenticated" });
        return;
      }

      setState({ ...initial, phase: "planning", total: args.count });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${env.API_URL}/api/insta-creator/quick-flow`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
        });

        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          setState((s) => ({
            ...s,
            phase: "error",
            errorMessage:
              body.message ?? "Quota insuficiente para gerar essa quantidade.",
          }));
          return;
        }
        if (!res.ok || !res.body) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl;
          while ((nl = buffer.indexOf("\n\n")) >= 0) {
            const rawEvent = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);

            let eventType = "message";
            let dataLine: string | null = null;
            for (const l of rawEvent.split("\n")) {
              if (l.startsWith("event: ")) eventType = l.slice(7);
              else if (l.startsWith("data: ")) dataLine = l.slice(6);
            }
            if (!dataLine) continue;
            if (eventType === "heartbeat") continue;

            let parsed: unknown;
            try {
              parsed = JSON.parse(dataLine);
            } catch {
              continue;
            }

            if (eventType === "planned") {
              const p = parsed as { topics: QuickFlowTopic[] };
              setState((s) => ({
                ...s,
                phase: "running",
                topics: p.topics,
                total: p.topics.length,
              }));
            } else if (eventType === "post") {
              const p = parsed as {
                index: number;
                total: number;
                post: QuickFlowPostResult["post"];
              };
              const topicTitle = state.topics[p.index]?.title ?? p.post.title;
              setState((s) => ({
                ...s,
                posts: [
                  ...s.posts,
                  { index: p.index, topic_title: topicTitle, post: p.post },
                ],
              }));
            } else if (eventType === "skipped") {
              const p = parsed as QuickFlowSkipped & { total: number };
              setState((s) => ({
                ...s,
                skipped: [
                  ...s.skipped,
                  {
                    index: p.index,
                    topic_title: p.topic_title,
                    reason: p.reason,
                    error: p.error,
                  },
                ],
              }));
            } else if (eventType === "done") {
              setState((s) => ({ ...s, phase: "done" }));
            } else if (eventType === "error") {
              const p = parsed as { message: string };
              setState((s) => ({
                ...s,
                phase: "error",
                errorMessage: p.message,
              }));
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((s) => ({
          ...s,
          phase: "error",
          errorMessage: (err as Error).message,
        }));
      } finally {
        abortRef.current = null;
        // Refresh kanban + quota badges
        qc.invalidateQueries({ queryKey: ["insta"] });
        qc.invalidateQueries({ queryKey: ["company", "me"] });
      }
    },
    [qc, state.topics],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initial);
  }, []);

  return { state, start, cancel, reset };
}
