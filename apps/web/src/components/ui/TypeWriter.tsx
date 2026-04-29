/**
 * TypeWriter — types out a string char-by-char, then calls `onDone`.
 *
 * Used on the last assistant message in BrandBot chat so the reply feels
 * "alive" without us doing real LLM streaming on the onboarding endpoint.
 *
 * Behavior:
 *   • Resets to empty whenever `text` changes (new message arrives).
 *   • Honours `prefers-reduced-motion`: snaps straight to the full text and
 *     fires `onDone` on next tick. No blinking caret either, since that's
 *     an "infinite" animation that the reduced-motion override neutralizes
 *     anyway.
 *   • `speed` is ms-per-char (default 16, matching Masi).
 */

import { useEffect, useRef, useState } from "react";

export interface TypeWriterProps {
  text: string;
  speed?: number;
  onDone?: () => void;
  /** When true, render the full text immediately and skip animation. */
  instant?: boolean;
}

export function TypeWriter({ text, speed = 16, onDone, instant = false }: TypeWriterProps) {
  const [shown, setShown] = useState(instant ? text : "");
  const [done, setDone] = useState(instant);
  const idxRef = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (instant || reduced) {
      setShown(text);
      setDone(true);
      onDoneRef.current?.();
      return;
    }

    idxRef.current = 0;
    setShown("");
    setDone(false);
    const interval = setInterval(() => {
      idxRef.current += 1;
      setShown(text.slice(0, idxRef.current));
      if (idxRef.current >= text.length) {
        clearInterval(interval);
        setDone(true);
        onDoneRef.current?.();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed, instant]);

  return (
    <span>
      {shown}
      {!done && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: "0.5ch",
            marginLeft: 1,
            opacity: 0.4,
            animation: "blink 1s step-end infinite",
          }}
        >
          ▍
        </span>
      )}
    </span>
  );
}
