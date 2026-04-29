import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { OnboardingGate } from "./components/OnboardingGate";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { NetworkBg } from "./components/ui/NetworkBg";
import { AuthProvider } from "./contexts/AuthContext";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { AgentPage } from "./pages/AgentPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuthPage } from "./pages/onboarding/AuthPage";
import { BrandBotChatPage } from "./pages/onboarding/BrandBotChatPage";
import { BrandRevealPage } from "./pages/onboarding/BrandRevealPage";
import { FirstTaskPage } from "./pages/onboarding/FirstTaskPage";
import { WelcomePage } from "./pages/onboarding/WelcomePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <NetworkBg />
          <Routes>
            {/* Public marketing + auth */}
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Onboarding (auth required, but onboarding NOT required) */}
            <Route
              path="/onboarding/chat"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <BrandBotChatPage />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />
            <Route
              path="/onboarding/reveal"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <BrandRevealPage />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />
            <Route
              path="/onboarding/first-task"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <FirstTaskPage />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />

            {/* Post-onboarding app */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <DashboardPage />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />
            <Route
              path="/agents/:slug"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <AgentPage />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <OnboardingGate>
                    <SettingsPage />
                  </OnboardingGate>
                </ProtectedRoute>
              }
            />

            {/* Invite acceptance — page itself handles signed-in vs not.
                We don't gate it through ProtectedRoute because the not-signed-in
                state IS the relevant UX (login CTA with returnTo=/invite/...). */}
            <Route path="/invite/:token" element={<AcceptInvitePage />} />

            {/* Roots & 404 */}
            <Route path="/" element={<Navigate to="/welcome" replace />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
