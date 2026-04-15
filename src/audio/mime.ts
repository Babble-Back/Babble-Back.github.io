const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

export function getPreferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined;
  }

  return PREFERRED_AUDIO_MIME_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}
