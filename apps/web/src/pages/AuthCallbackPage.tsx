import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Spinner } from "../components/ui/Spinner";

/**
 * Supabase PKCE flow lands here after Google OAuth.
 * supabase-js picks up the code from URL automatically (detectSessionInUrl
 * is true), so we just wait for the session to populate. The OnboardingGate
 * on /dashboard handles the next redirect (chat vs first-task vs dashboard).
 */
export function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate(session ? "/dashboard" : "/login", { replace: true });
  }, [session, loading, navigate]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
      }}
    >
      <Spinner />
    </div>
  );
}
