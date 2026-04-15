import { encodeAudioBufferToWav } from './encodeWav';
import { getSharedAudioContext } from './audioContext';

const TARGET_PEAK = 0.98;
const MAX_NORMALIZATION_GAIN = 4;

function getPeakAmplitude(audioBuffer: AudioBuffer) {
  let peak = 0;

  for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex);

    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
    }
  }

  return peak;
}

export async function reverseAudioBlob(blob: Blob): Promise<Blob> {
  const audioContext = await getSharedAudioContext();

  try {
    const sourceBuffer = await blob.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(sourceBuffer.slice(0));
    const peak = getPeakAmplitude(decodedBuffer);
    const normalizationGain =
      peak > 0 ? Math.min(MAX_NORMALIZATION_GAIN, TARGET_PEAK / peak) : 1;
    const reversedBuffer = audioContext.createBuffer(
      decodedBuffer.numberOfChannels,
      decodedBuffer.length,
      decodedBuffer.sampleRate,
    );

    for (
      let channelIndex = 0;
      channelIndex < decodedBuffer.numberOfChannels;
      channelIndex += 1
    ) {
      const sourceChannel = decodedBuffer.getChannelData(channelIndex);
      const targetChannel = reversedBuffer.getChannelData(channelIndex);

      for (let sampleIndex = 0; sampleIndex < sourceChannel.length; sampleIndex += 1) {
        targetChannel[sampleIndex] =
          (sourceChannel[sourceChannel.length - sampleIndex - 1] ?? 0) * normalizationGain;
      }
    }

    return new Blob([encodeAudioBufferToWav(reversedBuffer)], {
      type: 'audio/wav',
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Unable to reverse this audio file: ${error.message}`
        : 'Unable to reverse this audio file.',
    );
  }
}
