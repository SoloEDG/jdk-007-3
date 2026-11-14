import type { AudioClip } from "@/shared/types";
import {
  alignToBoundaries,
  toAudioBuffer,
  type CapturedChunk,
} from "../lib/boundary";
import {
  grantAndList,
  listInputDevices,
  queryPermission,
  startCapture,
  type MicDevice,
  type MicPermission,
  type MicSession,
} from "../lib/micCapture";
import { encodeWav, extractPeaks } from "../lib/wav";

export type VocalStatus = "idle" | "waiting" | "recording";

export type FinishedTake = {
  trackId: string;
  clip: AudioClip;
  buffer: AudioBuffer;
  wav: Blob;
  driftSec: number;
};

export function createVocalRecorder() {
  let status: VocalStatus = "idle";
  let trackId: string | null = null;
  let start = 0;
  let length = 16;
  let startSec = 0;
  let endSec = 0;
  let session: MicSession | null = null;
  let permission: MicPermission = "unknown";
  let devices: MicDevice[] = [];
  let selectedDevice = "";
  let monitor = false;
  let abortedByRemoval = false;

  const snapshot = () => ({
    status,
    trackId,
    start,
    length,
    permission,
    devices: structuredClone(devices),
    selectedDevice,
    monitor,
  });

  const reset = () => {
    status = "idle";
    trackId = null;
    session = null;
    startSec = endSec = 0;
    abortedByRemoval = false;
  };
  return {
    snapshot,

    async refreshDevices() {
      const result = await listInputDevices();
      permission = result.permission;
      devices = result.devices;
      if (!devices.some((d) => d.deviceId === selectedDevice))
        selectedDevice = devices[0]?.deviceId ?? "";
      return snapshot();
    },

    async requestPermissionAndList() {
      try {
        devices = await grantAndList();
        permission = "granted";
      } catch (error) {
        permission = "denied";
        throw error instanceof Error
          ? new Error("麦克风权限被拒绝，可在浏览器地址栏的权限设置中开启")
          : new Error("无法访问麦克风");
      }
      if (!devices.some((d) => d.deviceId === selectedDevice))
        selectedDevice = devices[0]?.deviceId ?? "";
      return snapshot();
    },

    selectDevice(deviceId: string) {
      if (status === "idle" && devices.some((d) => d.deviceId === deviceId))
        selectedDevice = deviceId;
    },

    setMonitor(value: boolean) {
      monitor = value;
    },

    // 在拍钟循环边界上开始采集。调用方在拿到麦克风后重新读取拍钟，
    // 避免授权弹窗耗时让边界计算失效。
    async begin(
      ctx: AudioContext,
      id: string,
      boundary: number,
      beats: number,
      bpm: number,
      absoluteNow: number,
    ) {
      if (status !== "idle") throw new Error("已有录音在进行");
      let mic: MicSession;
      try {
        const result = await startCapture(
          ctx,
          selectedDevice,
          () => {
            abortedByRemoval = true;
          },
        );
        mic = result.session;
        permission = result.permission;
      } catch (error) {
        // 授权失败 / 设备拔出：startCapture 已自行释放流，这里确保状态回到 idle。
        status = "idle";
        trackId = null;
        session = null;
        throw error;
      }
      session = mic;
      trackId = id;
      start = boundary;
      length = beats;
      const secPerBeat = 60 / bpm;
      // 以"当前音频时钟 + 到边界的拍数"换算，拍钟本身保持连续，不受 await 影响。
      startSec = ctx.currentTime + (boundary - absoluteNow) * secPerBeat;
      endSec = startSec + beats * secPerBeat;
      status = "waiting";
      return { boundary, startSec, endSec };
    },

    // 由主循环拍钟驱动；到达边界切换状态，到达终点时产出对齐后的片段。
    advance(ctx: AudioContext, absolute: number, bpm: number): FinishedTake | null {
      if (status === "waiting" && absolute >= start) {
        status = "recording";
        return null;
      }
      if (status !== "recording" || absolute < start + length) return null;

      const mic = session;
      const id = trackId;
      const chunks: CapturedChunk[] = mic ? [...mic.chunks] : [];
      mic?.stop();
      const removed = abortedByRemoval;
      reset();
      if (removed) throw new Error("输入设备在录音中拔出，已保留原来的片段");
      if (!id || !chunks.length)
        throw new Error("没有采集到声音，已保留原来的片段");

      const aligned = alignToBoundaries(
        chunks,
        startSec,
        endSec,
        ctx.sampleRate,
      );
      const buffer = toAudioBuffer(ctx, aligned);
      const wav = encodeWav(buffer);
      const clip: AudioClip = {
        id: crypto.randomUUID(),
        blobId: crypto.randomUUID(),
        bpm,
        beats: length,
        sampleRate: aligned.sampleRate,
        durationSec: buffer.duration,
        peaks: extractPeaks(buffer),
      };
      return { trackId: id, clip, buffer, wav, driftSec: aligned.driftSec };
    },

    cancel() {
      session?.stop();
      reset();
    },

    isActive() {
      return status !== "idle";
    },

    get stream(): MediaStream | null {
      return session?.stream ?? null;
    },

    async permissionState() {
      permission = await queryPermission();
      return permission;
    },
  };
}

export type VocalRecorder = ReturnType<typeof createVocalRecorder>;
