import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, TREE_ID } from './config';
import type {
  AllowedEmail,
  StoredPerson,
  TreeDataRow,
  TreeMeta
} from './types';
import {
  LOCAL_MODE,
  LOCAL_TREE_META,
  StaleVersionError,
  localGetTreeData,
  localSaveTreeData
} from './local-mode';

export { StaleVersionError } from './local-mode';

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  }
);

// ---------------------------------------------------------------------------
// Tree metadata
// ---------------------------------------------------------------------------

export async function fetchTreeMeta(): Promise<TreeMeta | null> {
  if (LOCAL_MODE) return LOCAL_TREE_META;
  const { data, error } = await supabase
    .from('trees')
    .select('id, name, default_language')
    .eq('id', TREE_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Allowed emails (owner-only reads under RLS)
// ---------------------------------------------------------------------------

export async function fetchAllowedEmails(): Promise<AllowedEmail[]> {
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('*')
    .eq('tree_id', TREE_ID)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Returns the current user's role on this tree, or null if not allowlisted.
export async function fetchMyRole(): Promise<'owner' | 'editor' | null> {
  const { data: userResp } = await supabase.auth.getUser();
  const email = userResp?.user?.email;
  if (!email) return null;

  // Owners can read allowed_emails; editors get an empty result due to RLS.
  // So we attempt to read our own row first.
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('role')
    .eq('tree_id', TREE_ID)
    .ilike('email', email)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    // PGRST116 = "row not found" on maybeSingle; everything else is real
    throw error;
  }
  if (data?.role === 'owner' || data?.role === 'editor') return data.role;

  // Non-owners can't read allowed_emails. Probe tree_data — if select
  // returns a row, the user is allowlisted as at least an editor.
  const probe = await supabase
    .from('tree_data')
    .select('id')
    .eq('tree_id', TREE_ID)
    .maybeSingle();
  if (probe.data) return 'editor';
  return null;
}

// ---------------------------------------------------------------------------
// Tree data (with optimistic concurrency control)
// ---------------------------------------------------------------------------

export async function fetchTreeData(): Promise<TreeDataRow | null> {
  if (LOCAL_MODE) return localGetTreeData();
  const { data, error } = await supabase
    .from('tree_data')
    .select('*')
    .eq('tree_id', TREE_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveTreeData(
  people: StoredPerson[],
  expectedVersion: number
): Promise<TreeDataRow> {
  if (LOCAL_MODE) return localSaveTreeData(people, expectedVersion);
  const { data: userResp } = await supabase.auth.getUser();
  const userId = userResp?.user?.id ?? null;

  const { data, error } = await supabase
    .from('tree_data')
    .update({
      data: people,
      version: expectedVersion + 1,
      updated_by: userId
    })
    .eq('tree_id', TREE_ID)
    .eq('version', expectedVersion)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new StaleVersionError();
  return data;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function logAudit(action: string, target: unknown): Promise<void> {
  const { data: userResp } = await supabase.auth.getUser();
  const userId = userResp?.user?.id ?? null;
  await supabase.from('audit_log').insert({
    tree_id: TREE_ID,
    actor: userId,
    action,
    target
  });
  // Audit failures are non-fatal; swallow silently.
}
