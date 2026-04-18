import { useEffect, useState } from 'react';
import { reverseAudioBlob } from '../utils/reverseAudioBlob';

interface UseReversedAudioOptions {
  blob?: Blob | null;
  enabled?: boolean;
  remoteUrl?: string | null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to prepare reversed audio.';
}

export function useReversedAudio({
  blob,
  enabled = true,
  remoteUrl,
}: UseReversedAudioOptions) {
  const [reversedBlob, setReversedBlob] = useState<Blob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || (!blob && !remoteUrl)) {
      setReversedBlob(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadReversedAudio = async () => {
      setIsLoading(true);
      setError(null);

      try {
        let sourceBlob: Blob;

        if (blob) {
          sourceBlob = blob;
        } else {
          const response = await fetch(remoteUrl as string);

          if (!response.ok) {
            throw new Error(`Unable to load the audio file (${response.status}).`);
          }

          sourceBlob = await response.blob();
        }

        if (cancelled) {
          return;
        }

        const nextReversedBlob = await reverseAudioBlob(sourceBlob);

        if (cancelled) {
          return;
        }

        setReversedBlob(nextReversedBlob);
      } catch (caughtError) {
        if (!cancelled) {
          setReversedBlob(null);
          setError(getErrorMessage(caughtError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadReversedAudio();

    return () => {
      cancelled = true;
    };
  }, [blob, enabled, remoteUrl]);

  return {
    error,
    isLoading,
    reversedBlob,
  };
}
