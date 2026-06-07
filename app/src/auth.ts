import { supabase, fetchMyRole } from './db';
import { LOCAL_MODE, LOCAL_SESSION } from './local-mode';
import type { Session } from './types';

export async function getCurrentSession(): Promise<Session | null> {
  if (LOCAL_MODE) return LOCAL_SESSION;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const role = await fetchMyRole();
  return { email: user.email, role };
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (LOCAL_MODE) return;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (LOCAL_MODE) return;
  await supabase.auth.signOut();
}

// Subscribes to auth state changes. The callback fires on every sign-in,
// sign-out, and token refresh, with the new session (or null).
export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  if (LOCAL_MODE) {
    callback(LOCAL_SESSION);
    return () => {};
  }
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
