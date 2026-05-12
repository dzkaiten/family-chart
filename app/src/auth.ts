import { supabase, fetchMyRole } from './db';
import type { Session } from './types';

export async function getCurrentSession(): Promise<Session | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const role = await fetchMyRole();
  return { email: user.email, role };
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      shouldCreateUser: true
    }
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Subscribes to auth state changes. The callback fires on every sign-in,
// sign-out, and token refresh, with the new session (or null).
export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const { data: subscription } = supabase.auth.onAuthStateChange(async (event, _session) => {
    if (event === 'SIGNED_OUT') {
      callback(null);
      return;
    }
    const session = await getCurrentSession();
    callback(session);
  });
  return () => subscription.subscription.unsubscribe();
}
