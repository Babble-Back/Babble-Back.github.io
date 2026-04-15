import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from './supabase';

export interface AppProfile {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

interface SignInCredentials {
  identifier: string;
  password: string;
}

interface SignUpCredentials {
  email: string;
  username: string;
  password: string;
}

interface SignUpResult {
  session: Session | null;
  requiresEmailConfirmation: boolean;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildEmailRedirectUrl() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

export async function getSession() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new Error(`Unable to read the current session: ${error.message}`);
  }

  return data.session;
}

export function subscribeToAuthChanges(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  const client = requireSupabase();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange(callback);

  return subscription;
}

export async function signUpWithEmail(
  credentials: SignUpCredentials,
): Promise<SignUpResult> {
  const client = requireSupabase();
  const { data, error } = await client.auth.signUp({
    email: normalizeEmail(credentials.email),
    password: credentials.password,
    options: {
      emailRedirectTo: buildEmailRedirectUrl(),
      data: {
        username: normalizeUsername(credentials.username),
      },
    },
  });

  if (error) {
    throw new Error(`Unable to create the account: ${error.message}`);
  }

  return {
    session: data.session,
    requiresEmailConfirmation: Boolean(data.user) && !data.session,
  };
}

async function resolveSignInEmail(identifier: string) {
  const normalizedIdentifier = identifier.trim().toLowerCase();

  if (!normalizedIdentifier) {
    return null;
  }

  if (normalizedIdentifier.includes('@')) {
    return normalizeEmail(normalizedIdentifier);
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('resolve_login_email', {
    login_input: normalizedIdentifier,
  });

  if (error) {
    throw new Error(`Unable to look up that username: ${error.message}`);
  }

  return typeof data === 'string' && data ? data : null;
}

export async function signInWithIdentifier(credentials: SignInCredentials) {
  const client = requireSupabase();
  const resolvedEmail = await resolveSignInEmail(credentials.identifier);

  if (!resolvedEmail) {
    throw new Error('Unable to log in with that username or email.');
  }

  const { error } = await client.auth.signInWithPassword({
    email: resolvedEmail,
    password: credentials.password,
  });

  if (error) {
    throw new Error(`Unable to log in: ${error.message}`);
  }
}

export async function signOut() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();

  if (error) {
    throw new Error(`Unable to sign out: ${error.message}`);
  }
}

export async function getMyProfile(): Promise<AppProfile> {
  const client = requireSupabase();
  const loadProfile = async () =>
    client
      .from('profiles')
      .select('id, email, username, created_at')
      .single();

  let { data, error } = await loadProfile();

  if (!data) {
    const { error: repairError } = await client.rpc('ensure_current_profile');

    if (repairError) {
      throw new Error(
        `Unable to load your profile: ${error?.message || repairError.message || 'Unknown error.'}`,
      );
    }

    ({ data, error } = await loadProfile());
  }

  if (error || !data) {
    throw new Error(`Unable to load your profile: ${error?.message || 'Unknown error.'}`);
  }

  return {
    id: data.id,
    email: data.email,
    username: data.username,
    createdAt: data.created_at,
  };
}
