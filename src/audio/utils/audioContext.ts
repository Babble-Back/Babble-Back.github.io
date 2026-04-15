type AudioContextConstructor = typeof AudioContext;

let sharedAudioContext: AudioContext | null = null;

export function getAudioContextConstructor(): AudioContextConstructor {
  const Context =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext;

  if (!Context) {
    throw new Error('Web Audio is not available in this browser.');
  }

  return Context;
}

export async function getSharedAudioContext() {
  if (typeof window === 'undefined') {
    throw new Error('Web Audio is not available outside the browser.');
  }

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioContextClass = getAudioContextConstructor();
    sharedAudioContext = new AudioContextClass();
  }

  if (sharedAudioContext.state === 'suspended') {
    try {
      await sharedAudioContext.resume();
    } catch {
      // Ignore resume failures. Decoding can still proceed on some browsers.
    }
  }

  return sharedAudioContext;
}
