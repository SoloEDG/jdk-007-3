import { decodeWav } from "../lib/wav";

// 人声片段的循环播放器。缓冲位置 0 对应录制时的循环边界，
// 启动时按拍钟锚点计算相位偏移，保证与鼓组/琴键的循环边界严格重合。
// beats/bpm 始终取拍钟当前值，调整速度或圈长后依然对齐，不累积错位。
type Playing = {
  source: AudioBufferSourceNode;
  buffer: AudioBuffer;
  bus: AudioNode;
  bpm: number;
  beats: number;
};

export function createLoopPlayer() {
  const playing = new Map<string, Playing>();

  const stopOne = (id: string) => {
    const p = playing.get(id);
    if (!p) return;
    try {
      p.source.stop();
    } catch {
      // 已自然停止
    }
    p.source.disconnect();
    playing.delete(id);
  };

  return {
    // anchorBeat：拍钟在 anchorTime 这一刻对应的绝对拍（一般是循环起点 0、16、32…）。
    async start(
      id: string,
      ctx: AudioContext,
      blob: Blob,
      bus: AudioNode,
      anchorTime: number,
      anchorBeat: number,
      bpm: number,
      beats: number,
    ) {
      stopOne(id);
      const buffer = await decodeWav(ctx, blob);
      if (playing.has(id)) return; // 期间被停止/替换
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      // 速率补偿：让缓冲的一圈时长始终等于拍钟的一圈，杜绝累积错位。
      const targetLoopSec = (beats * 60) / bpm;
      const rate = buffer.duration / targetLoopSec;
      source.playbackRate.value = rate;

      const beginAt = Math.max(ctx.currentTime + 0.03, anchorTime);
      // beginAt 时刻拍钟所处的绝对拍。
      const beatAtBegin =
        anchorBeat + ((beginAt - anchorTime) * bpm) / 60;
      // 折算到缓冲内的相位（取模一圈），使边界与拍钟重合。
      const phaseBeats = ((beatAtBegin % beats) + beats) % beats;
      const offset = ((phaseBeats * 60) / bpm) * rate;
      source.connect(bus);
      source.start(beginAt, offset % buffer.duration);
      playing.set(id, { source, buffer, bus, bpm, beats });
    },
    setBus(id: string, bus: AudioNode) {
      const p = playing.get(id);
      if (!p) return;
      p.source.disconnect();
      p.source.connect(bus);
      p.bus = bus;
    },
    setTempo(bpm: number) {
      for (const p of playing.values()) {
        const targetLoopSec = (p.beats * 60) / bpm;
        p.source.playbackRate.value = p.buffer.duration / targetLoopSec;
        p.bpm = bpm;
      }
    },
    stop(id: string) {
      stopOne(id);
    },
    stopAll() {
      for (const id of [...playing.keys()]) stopOne(id);
    },
    isPlaying(id: string) {
      return playing.has(id);
    },
    dispose() {
      this.stopAll();
    },
  };
}

export type LoopPlayer = ReturnType<typeof createLoopPlayer>;
