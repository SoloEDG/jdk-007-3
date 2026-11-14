// WAV (PCM16) 编解码与波形峰值提取：人声片段以 WAV blob 形式持久化在 IndexedDB。

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  // 统一混成单声道，麦克风录音本就是单声道，存档体积更小。
  const mono = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) mono[i] += data[i] / channels;
  }
  const bytesPerSample = 2;
  const dataSize = frames * bytesPerSample;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out], { type: "audio/wav" });
}

export async function decodeWav(
  ctx: BaseAudioContext,
  blob: Blob,
): Promise<AudioBuffer> {
  // decodeAudioData 会 detach 传入的 ArrayBuffer，这里每次都取新拷贝。
  const bytes = (await blob.arrayBuffer()).slice(0);
  return ctx.decodeAudioData(bytes);
}

// 抽取固定数量的峰值（0..1），供编排区绘制波形。
export function extractPeaks(buffer: AudioBuffer, buckets = 96): number[] {
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  const peaks = new Array<number>(buckets).fill(0);
  const size = Math.max(1, Math.floor(frames / buckets));
  for (let b = 0; b < buckets; b++) {
    const end = Math.min(frames, (b + 1) * size);
    let peak = 0;
    for (let i = b * size; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += Math.abs(data[c][i]);
      const v = sum / channels;
      if (v > peak) peak = v;
    }
    peaks[b] = Math.min(1, peak);
  }
  return peaks;
}
