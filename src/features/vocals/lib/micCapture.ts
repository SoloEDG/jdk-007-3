import type { CapturedChunk } from "./boundary";
import { captureWorkletUrl } from "./worklet";

export type MicPermission =
  | "unknown" // 尚未询问
  | "prompt" // 浏览器会弹授权
  | "granted"
  | "denied";

export type MicDevice = {
  deviceId: string;
  label: string;
};

export type MicSession = {
  stream: MediaStream;
  chunks: CapturedChunk[];
  stop: () => void;
};

const normalize = (devices: MediaDeviceInfo[]): MicDevice[] =>
  devices
    .filter((d) => d.kind === "audioinput" && d.deviceId)
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `麦克风 ${i + 1}`,
    }));

export async function queryPermission(): Promise<MicPermission> {
  if (!navigator.mediaDevices?.getUserMedia) return "denied";
  if (!navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state as MicPermission;
  } catch {
    return "unknown";
  }
}

export async function listInputDevices(): Promise<{
  permission: MicPermission;
  devices: MicDevice[];
}> {
  if (!navigator.mediaDevices?.enumerateDevices)
    return { permission: "denied", devices: [] };
  const permission = await queryPermission();
  try {
    const devices = normalize(await navigator.mediaDevices.enumerateDevices());
    return { permission, devices };
  } catch {
    return { permission, devices: [] };
  }
}

// 授权后再次枚举，此时才能拿到设备名称。
export async function grantAndList(): Promise<MicDevice[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
  probe.getTracks().forEach((t) => t.stop());
  const devices = normalize(await navigator.mediaDevices.enumerateDevices());
  return devices;
}

export async function startCapture(
  ctx: AudioContext,
  deviceId: string,
  onEnded: () => void,
): Promise<{ session: MicSession; permission: MicPermission }> {
  let stream: MediaStream;
  let permission: MicPermission = "granted";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: false }
        : { echoCancellation: false },
    });
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "SecurityError")
        permission = "denied";
      if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
        throw new Error("选择的输入设备已拔出或不可用");
    }
    throw permission === "denied"
      ? new Error("麦克风权限被拒绝，可在浏览器地址栏的权限设置中开启")
      : error;
  }
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("输入设备没有可用的音轨");
  }
  track.addEventListener("ended", onEnded, { once: true });

  const chunks: CapturedChunk[] = [];
  const source = ctx.createMediaStreamSource(stream);
  let monitor: GainNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let fallback: ScriptProcessorNode | null = null;

  const push = (samples: Float32Array, time: number) =>
    chunks.push({ samples, time, sampleRate: ctx.sampleRate });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    track.removeEventListener("ended", onEnded);
    workletNode?.port.close();
    workletNode?.disconnect();
    fallback?.disconnect();
    source.disconnect();
    monitor?.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };

  const useWorklet = () => {
    const node = new AudioWorkletNode(ctx, "timestamped-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    node.port.onmessage = (e: MessageEvent<CapturedChunk>) =>
      push(e.data.samples, e.data.time);
    source.connect(node);
    workletNode = node;
  };

  const useFallback = () => {
    // 老浏览器没有 AudioWorklet：用 ScriptProcessor 兜底，时间戳仍取音频时钟。
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      if (data.some((v) => v !== 0))
        push(data.slice(), ctx.currentTime - data.length / ctx.sampleRate);
    };
    // ScriptProcessor 需要接到目的地才会拉数据；监听默认关闭，故接到静音增益。
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    node.connect(sink);
    source.connect(node);
    fallback = node;
    monitor = sink;
  };

  try {
    await ctx.audioWorklet.addModule(captureWorkletUrl());
    useWorklet();
  } catch {
    try {
      useFallback();
    } catch (fallbackError) {
      // 两条采集路径都不可用：释放麦克风流，避免占用指示灯常亮。
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      throw fallbackError instanceof Error
        ? fallbackError
        : new Error("音频采集初始化失败");
    }
  }

  return {
    session: { stream, chunks, stop },
    permission,
  };
}

// 监听开关：默认关闭以避免啸叫；开启时把输入直通到输出，仅建议戴耳机使用。
export function setMonitor(
  ctx: AudioContext,
  stream: MediaStream,
  enabled: boolean,
  existing: GainNode | null,
): GainNode | null {
  existing?.disconnect();
  if (!enabled) return null;
  const source = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  source.connect(gain);
  gain.connect(ctx.destination);
  return gain;
}
