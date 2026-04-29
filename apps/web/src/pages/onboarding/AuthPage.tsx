import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { CTA } from "../../components/ui/CTA";
import { Glass } from "../../components/ui/Glass";
import { Logo } from "../../components/ui/Logo";
import { GoogleIcon } from "../../components/icons";

export function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();

  // After Supabase confirms the new session, leave the auth page. OnboardingGate
  // routes the user to /onboarding/chat or /dashboard depending on state.
  useEffect(() => {
    if (!session) return;
    const returnTo = searchParams.get("returnTo");
    navigate(returnTo && returnTo.startsWith("/") ? returnTo : "/dashboard", {
      replace: true,
    });
  }, [session, navigate, searchParams]);
  const [isSignup, setIsSignup] = useState(true);
  const [showEmail, setShowEmail] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError((err as Error).message ?? "Erro ao conectar com Google");
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isSignup) {
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err) {
      setError((err as Error).message ?? "Erro inesperado");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "13px 16px",
    minHeight: 44,
    borderRadius: 12,
    border: "1.5px solid rgba(0,0,0,0.08)",
    fontSize: 16,
    color: "var(--text-strong)",
    background: "rgba(255,255,255,0.6)",
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.2s",
  };

  const canSubmit = email && password && (isSignup ? name : true) && !loading;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        padding: 16,
        position: "relative",
        zIndex: 1,
        animation: "viewFadeIn 0.5s var(--easing-soft) both",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Logo size={44} showTag />
          <h2
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text-strong)",
              letterSpacing: "-0.02em",
              marginTop: 24,
              marginBottom: 6,
            }}
          >
            {isSignup ? "Criar conta" : "Entrar"}
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-subtle)" }}>
            Hub de agentes IA pra suas redes sociais
          </p>
        </div>

        <Glass style={{ padding: "28px 28px 24px" }}>
          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            style={{
              width: "100%",
              padding: "14px 24px",
              borderRadius: 50,
              border: "1.5px solid rgba(0,0,0,0.1)",
              background: "#fff",
              color: "#374151",
              fontSize: 15,
              fontWeight: 600,
              cursor: googleLoading ? "default" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              minHeight: 48,
            }}
          >
            <GoogleIcon size={18} />
            {googleLoading ? "Conectando..." : "Continuar com Google"}
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "20px 0",
            }}
          >
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
              ou
            </span>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
          </div>

          {!showEmail ? (
            <button
              onClick={() => setShowEmail(true)}
              style={{
                width: "100%",
                padding: "12px 24px",
                borderRadius: 50,
                border: "1.5px solid var(--border)",
                background: "transparent",
                color: "var(--text-strong)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Continuar com email
            </button>
          ) : (
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              {isSignup && (
                <input
                  type="text"
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  style={inputStyle}
                />
              )}
              <input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Senha (mín. 8 caracteres)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                required
                style={inputStyle}
              />
              <CTA type="submit" disabled={!canSubmit} style={{ marginTop: 4 }}>
                {loading ? "Aguarde..." : isSignup ? "Criar conta" : "Entrar"}
              </CTA>
            </form>
          )}

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10,
                fontSize: 13,
                color: "var(--error)",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button
              onClick={() => setIsSignup((v) => !v)}
              style={{
                background: "transparent",
                color: "var(--text-subtle)",
                fontSize: 13,
              }}
            >
              {isSignup ? "Já tem conta? Entrar" : "Não tem conta? Criar"}
            </button>
          </div>
        </Glass>
      </div>
    </div>
  );
}
