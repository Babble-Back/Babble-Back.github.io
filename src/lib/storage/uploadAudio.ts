import { supabase, supabaseConfigError } from '../supabase';

const AUDIO_BUCKET = 'audio';
const DEFAULT_PREFIX = 'rounds';
const missingAudioPaths = new Set<string>();

interface UploadAudioOptions {
  ownerId: string;
  roundId?: string;
  label?: string;
}

export interface UploadedAudioAsset {
  path: string;
}

function isMissingStorageObjectError(message: string) {
  return /not found|does not exist|no such key|not exist/i.test(message);
}

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function buildAudioPath({ ownerId, roundId, label }: UploadAudioOptions) {
  const safePrefix = sanitizePathSegment(DEFAULT_PREFIX) || DEFAULT_PREFIX;
  const safeOwnerId = sanitizePathSegment(ownerId) || 'owner';
  const safeRoundId = sanitizePathSegment(roundId || 'draft') || 'draft';
  const safeLabel = sanitizePathSegment(label || 'audio') || 'audio';
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${safePrefix}/${safeOwnerId}/${safeRoundId}/${safeLabel}-${Date.now()}-${randomPart}.wav`;
}

export async function createSignedAudioUrl(path: string | null | undefined) {
  if (!path || !supabase) {
    return null;
  }

  if (missingAudioPaths.has(path)) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) {
    if (isMissingStorageObjectError(error.message)) {
      missingAudioPaths.add(path);
      console.warn(`Audio object missing for path "${path}". Falling back to no remote URL.`);
      return null;
    }

    throw new Error(`Unable to create an audio URL: ${error.message}`);
  }

  return data.signedUrl || null;
}

export async function uploadAudio(
  blob: Blob,
  options: UploadAudioOptions,
): Promise<UploadedAudioAsset> {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  const path = buildAudioPath(options);
  const contentType = blob.type || 'audio/wav';
  const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, blob, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return { path };
}
