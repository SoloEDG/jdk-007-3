// 边界对齐：采集设备的时钟与演奏拍点存在偏差时，以实际录到的音频时间戳为准，
// 把片段补齐 / 裁切成精确的整数圈采样数，保证每一圈都严格等长、不会逐渐错位。

export type CapturedChunk = {
  samples: Float32Array;
  // 块首样本在 AudioContext 时钟上的时间（秒）
  time: number;
  sampleRate: number;
};

export type AlignedResult = {
  channel: Float32Array;
  sampleRate: number;
  // 实际音频相对理想边界的偏差（秒），正数代表设备晚于拍钟启动
  driftSec: number;
};

export function alignToBoundaries(
  chunks: CapturedChunk[],
  startSec: number,
  endSec: number,
  fallbackRate: number,
): AlignedResult {
  if (!chunks.length) throw new Error("没有采集到任何音频");
  const sampleRate = chunks[0].sampleRate || fallbackRate;
  const driftSec = chunks[0].time - startSec;
  const targetFrames = Math.max(
    1,
    Math.round((endSec - startSec) * sampleRate),
  );
  // 缺口天然留零（静音补齐两端），超出 target 的部分直接裁掉。
  const out = new Float32Array(targetFrames);
  for (const chunk of chunks) {
    // 每块按自身时间戳定位：设备丢块留静音、重复块以后写为准，均不影响总长度。
    const pos = Math.round((chunk.time - startSec) * sampleRate);
    const first = Math.max(0, -pos);
    const last = Math.min(chunk.samples.length, targetFrames - pos);
    if (last > first)
      out.set(chunk.samples.subarray(first, last), Math.max(0, pos));
  }
  return { channel: out, sampleRate, driftSec };
}

export function toAudioBuffer(
  ctx: BaseAudioContext,
  result: AlignedResult,
): AudioBuffer {
  const buffer = ctx.createBuffer(1, result.channel.length, result.sampleRate);
  buffer.getChannelData(0).set(result.channel);
  return buffer;
}
