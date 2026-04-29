import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initSentry, SentryErrorBoundary } from "./lib/sentry";
import "./index.css";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<RootErrorFallback />}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>,
);

function RootErrorFallback() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        background: "#f8fafb",
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          Algo deu errado
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
          A aplicação travou
        </h1>
        <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.55, marginBottom: 20 }}>
          O erro foi reportado. Tente recarregar — se persistir, abra o console
          do navegador pra ver detalhes.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 24px",
            borderRadius: 100,
            background: "linear-gradient(135deg, #22c55e, #16a34a)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
          }}
        >
          Recarregar
        </button>
      </div>
    </div>
  );
}
