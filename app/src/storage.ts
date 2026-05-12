import { supabase } from './db';
import {
  AVATAR_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  SIGNED_URL_REFRESH_SECONDS,
  TREE_ID
} from './config';
import type { DisplayPerson, StoredPerson } from './types';

// In-memory cache of signed URLs keyed by storage path. Each entry remembers
// when it was generated so we can refresh before expiry.
interface CacheEntry { url: string; generatedAt: number; }
const signedUrlCache = new Map<string, CacheEntry>();

function isStoragePath(value: string): boolean {
  // Anything starting with our tree id (a UUID-ish path) is treated as a
  // private storage path. Absolute URLs (http/https) pass through unchanged.
  if (!value) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  return true;
}

async function getSignedUrl(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path);
  const now = Date.now();
  if (cached && now - cached.generatedAt < SIGNED_URL_REFRESH_SECONDS * 1000) {
    return cached.url;
  }
  const { data, error } = await supabase
    .storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.warn('Failed to sign avatar URL', path, error);
    return null;
  }
  signedUrlCache.set(path, { url: data.signedUrl, generatedAt: now });
  return data.signedUrl;
}

// Walk a list of display people and replace storage-path avatars with signed
// URLs. Returns a new array; does not mutate the input.
export async function resolveAvatarUrls(people: DisplayPerson[]): Promise<DisplayPerson[]> {
  const out: DisplayPerson[] = [];
  for (const p of people) {
    const avatar = p.data.avatar;
    if (typeof avatar === 'string' && isStoragePath(avatar)) {
      const signed = await getSignedUrl(avatar);
      out.push({
        ...p,
        data: { ...p.data, avatar: signed ?? undefined }
      });
    } else {
      out.push(p);
    }
  }
  return out;
}

export async function uploadAvatar(personId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const filename = `${Date.now()}.${ext || 'jpg'}`;
  const path = `${TREE_ID}/${personId}/${filename}`;
  const { error } = await supabase
    .storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}

export async function deleteAvatar(path: string): Promise<void> {
  if (!path || !isStoragePath(path)) return;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) console.warn('Failed to delete avatar', path, error);
  signedUrlCache.delete(path);
}

// Walk before/after lists of people and remove any avatar files that are
// no longer referenced. Called after a successful save.
export async function pruneOrphanedAvatars(
  before: StoredPerson[],
  after: StoredPerson[]
): Promise<void> {
  const afterPaths = new Set<string>();
  for (const p of after) {
    const a = p.data.avatar;
    if (typeof a === 'string' && isStoragePath(a)) afterPaths.add(a);
  }
  const toDelete: string[] = [];
  for (const p of before) {
    const a = p.data.avatar;
    if (typeof a === 'string' && isStoragePath(a) && !afterPaths.has(a)) {
      toDelete.push(a);
    }
  }
  if (toDelete.length === 0) return;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove(toDelete);
  if (error) console.warn('Failed to prune orphaned avatars', error);
  toDelete.forEach(p => signedUrlCache.delete(p));
}
