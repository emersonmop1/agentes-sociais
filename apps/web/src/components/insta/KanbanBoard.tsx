import type { KanbanBuckets, PostSummary } from "../../hooks/useInstaPosts";
import { Glass } from "../ui/Glass";

const COLUMNS: { key: keyof KanbanBuckets; label: string; color: string }[] = [
  { key: "draft",          label: "Rascunho",       color: "var(--text-muted)" },
  { key: "copy_review",    label: "Revisar copy",   color: "#f59e0b" },
  { key: "design_review",  label: "Revisar design", color: "#8b5cf6" },
  { key: "caption_review", label: "Revisar caption",color: "#3b82f6" },
  { key: "final_review",   label: "Revisão final",  color: "#22c55e" },
  { key: "ready",          label: "Pronto / Agendado", color: "#16a34a" },
  { key: "publishing",     label: "Publicando",     color: "#0ea5e9" },
  { key: "published",      label: "Publicado",      color: "#15803d" },
  { key: "failed",          label: "Falhou",         color: "var(--error)" },
];

export interface KanbanBoardProps {
  buckets: KanbanBuckets;
  onSelectPost: (postId: string) => void;
}

export function KanbanBoard({ buckets, onSelectPost }: KanbanBoardProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        overflowX: "auto",
        padding: "8px 4px 24px",
        minHeight: 420,
      }}
    >
      {COLUMNS.map((col) => {
        const items = buckets[col.key] ?? [];
        return (
          <div
            key={col.key}
            style={{
              flex: "0 0 240px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 4px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: col.color,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-strong)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {col.label}
                </span>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                {items.length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.length === 0 ? (
                <div
                  style={{
                    padding: 12,
                    fontSize: 12,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}
                >
                  vazio
                </div>
              ) : (
                items.map((p) => (
                  <PostCard key={p.id} post={p} onClick={() => onSelectPost(p.id)} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PostCard({ post, onClick }: { post: PostSummary; onClick: () => void }) {
  return (
    <Glass
      onClick={onClick}
      style={{
        padding: 10,
        cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "var(--surface-glass-shadow)";
      }}
    >
      {post.cover_image_url && (
        <div
          style={{
            width: "100%",
            aspectRatio: "4 / 5",
            borderRadius: 8,
            overflow: "hidden",
            background: "rgba(0,0,0,0.05)",
            marginBottom: 8,
          }}
        >
          <img
            src={post.cover_image_url}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      )}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-strong)",
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {post.title}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "var(--text-muted)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{post.slides_count} slides</span>
        <span>{visualStyleLabel(post.visual_style)}</span>
      </div>
    </Glass>
  );
}

function visualStyleLabel(slug: PostSummary["visual_style"]): string {
  switch (slug) {
    case "tweet_thread": return "Tweet";
    case "dark":         return "Dark";
    case "acid_text":    return "Ácido";
    case "tweet_single": return "Único";
  }
}
