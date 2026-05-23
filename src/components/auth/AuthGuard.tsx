import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // Get the current session on mount
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    // Keep in sync with Supabase auth state changes (magic-link callback, sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // undefined = still loading; null = confirmed no session
    if (session === null) {
      navigate('/login', { replace: true, state: { from: location } });
    }
  }, [session, navigate, location]);

  // Loading — render nothing until we know auth state to avoid flash
  if (session === undefined) return null;

  // Unauthenticated — redirect handled above, render nothing in the meantime
  if (session === null) return null;

  return <>{children}</>;
}
