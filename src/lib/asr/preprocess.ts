import { getSharedAudioContext } from '../../audio/utils/audioContext';

export const TARGET_SAMPLE_RATE = 16_000;

const MIN_AUDIO_MS = 250;
const SILENCE_TRIM_FLOOR = 0.003;
const SILENCE_TRIM_RATIO = 0.08;
const SILENCE_TRIM_PADDING_MS = 120;

function minimumAudioFrames(sampleRate: number) {
  return Math.round((sampleRate * MIN_AUDIO_MS) / 1000);
}

export function getPeakLevel(samples: Float32Array) {
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }

  return peak;
}

export function isSilentAudio(samples: Float32Array, threshold = SILENCE_TRIM_FLOOR) {
  return getPeakLevel(samples) < threshold;
}

export function isAudioTooShort(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE) {
  return samples.length < minimumAudioFrames(sampleRate);
}

export function normalizeAudio(float32: Float32Array): Float32Array {
  let max = 0;

  for (let index = 0; index < float32.length; index += 1) {
    max = Math.max(max, Math.abs(float32[index] ?? 0));
  }

  const out = new Float32Array(float32.length);

  if (max === 0) {
    out.set(float32);
    return out;
  }

  for (let index = 0; index < float32.length; index += 1) {
    out[index] = float32[index] / max;
  }

  return out;
}

function trimSilentEdges(samples: Float32Array, sampleRate: number) {
  const peak = getPeakLevel(samples);

  if (peak <= 0) {
    return samples;
  }

  const threshold = Math.max(SILENCE_TRIM_FLOOR, peak * SILENCE_TRIM_RATIO);
  let startFrame = 0;
  let endFrame = samples.length - 1;

  while (startFrame < samples.length && Math.abs(samples[startFrame] ?? 0) < threshold) {
    startFrame += 1;
  }

  while (endFrame >= startFrame && Math.abs(samples[endFrame] ?? 0) < threshold) {
    endFrame -= 1;
  }

  if (startFrame === 0 && endFrame === samples.length - 1) {
    return samples;
  }

  const paddingFrames = Math.round((sampleRate * SILENCE_TRIM_PADDING_MS) / 1000);
  const paddedStartFrame = Math.max(0, startFrame - paddingFrames);
  const paddedEndFrame = Math.min(samples.length, endFrame + paddingFrames + 1);
  const trimmed = samples.slice(paddedStartFrame, paddedEndFrame);

  if (trimmed.length < minimumAudioFrames(sampleRate)) {
    return samples;
  }

  return trimmed;
}

function mixToMono(audioBuffer: AudioBuffer) {
  const { numberOfChannels, length } = audioBuffer;

  if (numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const mono = new Float32Array(length);

  for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);

    for (let frameIndex = 0; frameIndex < length; frameIndex += 1) {
      mono[frameIndex] += channelData[frameIndex] ?? 0;
    }
  }

  const scale = 1 / numberOfChannels;
  for (let frameIndex = 0; frameIndex < length; frameIndex += 1) {
    mono[frameIndex] *= scale;
  }

  return mono;
}

function resampleFloat32Linear(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
) {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const sourceIndex = index * ratio;
    const sourceFloor = Math.floor(sourceIndex);
    const sourceCeil = Math.min(sourceFloor + 1, samples.length - 1);
    const interpolation = sourceIndex - sourceFloor;

    output[index] =
      (samples[sourceFloor] ?? 0) * (1 - interpolation) +
      (samples[sourceCeil] ?? 0) * interpolation;
  }

  return output;
}

async function decodeAudioBlob(blob: Blob) {
  if (!blob.size) {
    return null;
  }

  try {
    const audioContext = await getSharedAudioContext();
    const sourceBuffer = await blob.arrayBuffer();

    return await audioContext.decodeAudioData(sourceBuffer.slice(0));
  } catch {
    return null;
  }
}

export async function preprocessAudioBlob(blob: Blob): Promise<Float32Array> {
  const decoded = await decodeAudioBlob(blob);

  if (!decoded) {
    return new Float32Array(0);
  }

  const mono = mixToMono(decoded);
  const trimmed = trimSilentEdges(mono, decoded.sampleRate);
  const resampled = resampleFloat32Linear(trimmed, decoded.sampleRate, TARGET_SAMPLE_RATE);

  if (isSilentAudio(resampled) || isAudioTooShort(resampled)) {
    return new Float32Array(0);
  }

  return normalizeAudio(resampled);
}
