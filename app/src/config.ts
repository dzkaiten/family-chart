// Application configuration. Most values are pulled from Vite env vars;
// the language list and snapshot retention are kept here as constants so
// they're easy to change without touching the schema.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const TREE_ID = import.meta.env.VITE_TREE_ID as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TREE_ID) {
  console.error('Missing required environment variables. Check .env.example.');
}

export type LanguageCode = 'en' | 'zh-Hant' | 'zh-Hans';

export interface LanguageOption {
  code: LanguageCode;
  label: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-Hant', label: '中文 (繁體)' },
  { code: 'zh-Hans', label: '中文 (简体)' }
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
export const SIGNED_URL_REFRESH_SECONDS = 50 * 60; // refresh slightly before expiry

export const AVATAR_BUCKET = 'avatars';
