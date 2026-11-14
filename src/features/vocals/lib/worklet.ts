// 采集 Worklet：在音频渲染线程按块打时间戳（audioContext 时钟），
// 避免主线程定时器抖动导致的逐圈漂移。不支持 worklet 的环境由采集器回退。
const workletSource = `
class TimestampedCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      // 拷贝一份，避免复用底层缓冲区；currentTime 对应当前块起始时刻。
      const mono = input.length > 1
        ? new Float32Array(input[0].length)
        : input[0].slice();
      if (input.length > 1) {
        for (let i = 0; i < mono.length; i++) {
          let sum = 0;
          for (let c = 0; c < input.length; c++) sum += input[c][i];
          mono[i] = sum / input.length;
        }
      }
      this.port.postMessage(
        { samples: mono, time: currentTime, sampleRate: sampleRate },
      );
    }
    return true;
  }
}
registerProcessor("timestamped-capture", TimestampedCapture);
`;

let cachedUrl: string | null = null;

export function captureWorkletUrl(): string {
  cachedUrl ??= URL.createObjectURL(
    new Blob([workletSource], { type: "application/javascript" }),
  );
  return cachedUrl;
}
