import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Supabase-backed rounds are disabled until those env vars are set.'
    : null;

export const supabase: SupabaseClient | null =
  supabaseConfigError === null
    ? createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

interface SupabaseLikeError {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

export function formatSupabaseError(error: unknown, fallbackMessage: string) {
  if (!error || typeof error !== 'object') {
    return fallbackMessage;
  }

  const nextError = error as SupabaseLikeError;
  const parts = [
    nextError.message?.trim(),
    nextError.details?.trim(),
    nextError.hint?.trim(),
    nextError.code ? `code: ${nextError.code}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' | ') : fallbackMessage;
}
