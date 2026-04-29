import { useState } from "react";
import { usePickHook, type ReelDetail } from "../../hooks/useReels";
import { CTA } from "../ui/CTA";
import { Glass } from "../ui/Glass";

export function HookPicker({ reel }: { reel: ReelDetail }) {
  const pick = usePickHook();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [customHook, setCustomHook] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const handleConfirm = async () => {
    if (showCustom && customHook.trim()) {
      await pick.mutateAsync({ reelId: reel.id, customHook: customHook.trim() });
    } else if (activeIdx !== null) {
      await pick.mutateAsync({ reelId: reel.id, hookIndex: activeIdx });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Escolha um gancho ({reel.hook_options.length} opções)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {reel.hook_options.map((h, i) => {
          const active = activeIdx === i && !showCustom;
          return (
            <Glass
              key={i}
              onClick={() => {
                setActiveIdx(i);
                setShowCustom(false);
              }}
              style={{
                padding: 12,
                cursor: "pointer",
                border: active ? "2px solid var(--green)" : "1px solid var(--surface-glass-border)",
                background: active ? "var(--green-light)" : undefined,
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--green-700)",
                    background: "var(--green-light)",
                    border: "1px solid var(--green-border)",
                    padding: "2px 8px",
                    borderRadius: 100,
                    flexShrink: 0,
                    textTransform: "lowercase",
                  }}
                >
                  {h.angle}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.4 }}>
                  {h.hook}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 6, paddingLeft: 4 }}>
                {h.why}
              </div>
            </Glass>
          );
        })}
      </div>

      <Glass
        onClick={() => {
          setShowCustom(true);
          setActiveIdx(null);
        }}
        style={{
          padding: 12,
          cursor: "pointer",
          border: showCustom ? "2px solid var(--green)" : "1.5px dashed var(--border)",
          background: showCustom ? "var(--green-light)" : "transparent",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", marginBottom: showCustom ? 8 : 0 }}>
          ✏️ Escrever meu próprio gancho
        </div>
        {showCustom && (
          <textarea
            value={customHook}
            onChange={(e) => setCustomHook(e.target.value)}
            rows={2}
            placeholder="Sua frase de hook"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "inherit",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              outline: "none",
              resize: "vertical",
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </Glass>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <CTA
          onClick={handleConfirm}
          disabled={
            pick.isPending ||
            (showCustom ? !customHook.trim() : activeIdx === null)
          }
        >
          {pick.isPending ? "Confirmando…" : "Continuar pro roteiro →"}
        </CTA>
      </div>
    </div>
  );
}
