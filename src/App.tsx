import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import NotFound from "./pages/NotFound";
import { AuthPage } from "./components/auth/AuthPage";
import { AuthGuard } from "./components/auth/AuthGuard";
import ProjectSelector from "./pages/ProjectSelector";
import ProjectOverview from "./pages/ProjectOverview";
import ProjectSettings from "./pages/ProjectSettings";
import ImportView from "./pages/ImportView";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<AuthGuard><ProjectSelector /></AuthGuard>} />
          <Route path="/projects/:projectId" element={<AuthGuard><ProjectOverview /></AuthGuard>} />
          <Route path="/projects/:projectId/settings" element={<AuthGuard><ProjectSettings /></AuthGuard>} />
          <Route path="/projects/:projectId/imports/:importId" element={<AuthGuard><ImportView /></AuthGuard>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
