import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useOnboardingState } from "../hooks/useOnboarding";
import { Spinner } from "./ui/Spinner";

/**
 * Wrap any "post-onboarding" route. If onboarding is incomplete, redirect to
 * /onboarding/chat. While loading, render a spinner.
 *
 * Sibling of ProtectedRoute (auth gate). The two compose:
 *   <ProtectedRoute><OnboardingGate>...</OnboardingGate></ProtectedRoute>
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { data, isLoading } = useOnboardingState();
  const location = useLocation();

  if (authLoading) return <Centered><Spinner /></Centered>;
  if (!session) return <Navigate to="/login" replace />;
  if (isLoading || !data) return <Centered><Spinner /></Centered>;

  if (!data.onboarding_completed) {
    // Already inside onboarding flow? Let it render.
    if (location.pathname.startsWith("/onboarding")) return <>{children}</>;
    return <Navigate to="/onboarding/chat" replace />;
  }

  // Onboarding done — if user is on an onboarding URL, kick to dashboard.
  if (location.pathname.startsWith("/onboarding")) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
      }}
    >
      {children}
    </div>
  );
}
