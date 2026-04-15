function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeAudioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const sampleCount = audioBuffer.length;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataByteLength = sampleCount * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(wavBuffer);
  const channelData = Array.from({ length: channelCount }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = channelData[channelIndex][sampleIndex] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      const pcmValue =
        clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);

      view.setInt16(offset, pcmValue, true);
      offset += bytesPerSample;
    }
  }

  return wavBuffer;
}
