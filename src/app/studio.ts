import { createEngine, bindPerformanceInput } from "@/features/instruments";
import { createTransport, scheduleWindow } from "@/features/transport";
import { createRecorder, captureBoundary } from "@/features/recorder";
import {
  createArrangement,
  demoSession,
  saveSession,
  loadSession,
  removeAudio,
} from "@/features/arrangement";
import { createMixer } from "@/features/mixer";
import {
  createVocalRecorder,
  createLoopPlayer,
  getAudioBlob,
  setMonitor as routeMonitor,
} from "@/features/vocals";
import type { NoteInput, Instrument, Session } from "@/shared/types";

export function createStudio(notify: () => void) {
  const engine = createEngine(),
    transport = createTransport(),
    recorder = createRecorder(),
    vocal = createVocalRecorder(),
    arrangement = createArrangement(),
    mixer = createMixer(),
    player = createLoopPlayer();
  const active = new Set<string>();
  // 内存中的音频：轨道 id -> WAV blob，保存时一并写入 IndexedDB。
  const audioBlobs = new Map<string, { blob: Blob }>();
  let monitorGain: GainNode | null = null;
  let message = "欢迎来到夜航。戴上耳机，试着敲下第一拍。",
    epoch = 0,
    disposed = false,
    vocalBusy = false;
  const now = () => engine.context?.currentTime ?? 0;
  const feedback = (text: string) => {
    message = text;
    notify();
  };
  const guard = (fn: () => void) => {
    try {
      fn();
      notify();
    } catch (error) {
      feedback(
        error instanceof Error ? error.message : "操作失败，现有作品已保留",
      );
    }
  };
  const syncMixer = () =>
    mixer.ensure(arrangement.snapshot().tracks.map((t) => t.id));
  const cancelVoices = () => {
    engine.cancel();
    active.clear();
  };
  const clearMonitor = () => {
    monitorGain?.disconnect();
    monitorGain = null;
  };
  const stopPlayback = (reason: string | null) => {
    epoch++;
    transport.stop();
    recorder.cancel();
    if (vocal.isActive()) vocal.cancel();
    player.stopAll();
    clearMonitor();
    cancelVoices();
    if (reason) feedback(reason);
    notify();
  };
  const stop = () => stopPlayback(null);
  const pause = () => {
    epoch++;
    transport.pause(now());
    recorder.cancel();
    if (vocal.isActive()) vocal.cancel();
    player.stopAll();
    clearMonitor();
    cancelVoices();
    feedback("播放已暂停；未完成录音已取消，原片段保留。");
  };
  const unlock = async () => {
    const context = await engine.unlock();
    if (disposed) return false;
    mixer.attach(context);
    syncMixer();
    engine.route(mixer.channel);
    return true;
  };

  // 为所有可用的人声片段启动循环播放（在播放开始的边界上对齐）。
  const startVocalLoops = (anchorTime: number, anchorBeat: number) => {
    const ctx = engine.context;
    if (!ctx) return;
    const view = transport.view(now());
    for (const track of arrangement.forPlayback()) {
      if (track.instrument !== "vocals" || !track.clip || track.clip.missing)
        continue;
      const entry = audioBlobs.get(track.id);
      if (!entry) {
        arrangement.markClipMissing(track.id);
        feedback(`「${track.name}」的音频缺失，已标记为不可用，其他轨道不受影响。`);
        continue;
      }
      const bus = mixer.channel(track.id);
      void player
        .start(
          track.id,
          ctx,
          entry.blob,
          bus,
          anchorTime,
          anchorBeat,
          view.bpm,
          view.beats,
        )
        .catch(() => {
          arrangement.markClipMissing(track.id);
          feedback(`「${track.name}」的音频无法解码，已标记为不可用。`);
        });
    }
  };

  const play = async () => {
    const token = ++epoch;
    try {
      if (!(await unlock()) || token !== epoch) return;
      const anchorTime = now() + 0.02;
      transport.start(anchorTime);
      startVocalLoops(anchorTime, transport.view(now()).absolute);
      tick();
      notify();
    } catch {
      feedback("声音启动失败，请再次点击播放");
    }
  };
  const tick = () => {
    const time = now(),
      view = transport.view(time);
    const take = recorder.advance(view.absolute);
    if (take)
      guard(() => {
        arrangement.commit(take.trackId, take.notes);
        message = `录制完成 · ${take.notes.length} 个音符`;
      });
    // 人声录音：到达边界开始、到达终点产出并替换。
    if (vocal.isActive() && engine.context) {
      try {
        const finished = vocal.advance(engine.context, view.absolute, view.bpm);
        if (finished) commitVocalTake(finished);
      } catch (error) {
        feedback(
          error instanceof Error ? error.message : "人声录音失败，原片段已保留",
        );
      }
    }
    const capture = recorder.snapshot();
    const ceiling =
      capture.status === "idle" ? Infinity : capture.start + capture.length;
    const window = transport.window(time, ceiling);
    if (window)
      scheduleWindow(
        arrangement.forPlayback(),
        window.from,
        window.to,
        view.beats,
        view.bpm,
        window.timeAt,
        (n) => engine.play(n),
      );
  };

  const commitVocalTake = (finished: Awaited<ReturnType<typeof vocal.advance>>) => {
    if (!finished) return;
    const targetId = finished.trackId;
    const previous = arrangement.snapshot().tracks.find((t) => t.id === targetId)?.clip;
    const previousBlob = previous ? audioBlobs.get(targetId) : null;
    // 先在内存里准备好新片段，全部成功后才替换旧片段。
    audioBlobs.set(targetId, { blob: finished.wav });
    arrangement.commitClip(targetId, finished.clip);
    if (previous?.blobId && previousBlob)
      void removeAudio(previous.blobId).catch(() => {});
    player.stop(targetId);
    if (transport.view(now()).running && engine.context) {
      const view = transport.view(now());
      // 以当前音频时刻和当前绝对拍为锚点，让新片段立刻对齐当前循环位置。
      void player
        .start(
          targetId,
          engine.context,
          finished.wav,
          mixer.channel(targetId),
          now(),
          view.absolute,
          view.bpm,
          view.beats,
        )
        .catch(() => {});
    }
    const drift = Math.abs(finished.driftSec * 1000).toFixed(0);
    message = `人声片段已替换 · 设备偏差 ${drift} ms 已按录音边界对齐`;
    notify();
  };

  const down = async (id: string, note: NoteInput) => {
    if (active.has(id)) return;
    active.add(id);
    notify();
    try {
      if (!(await unlock()) || !active.has(id)) return;
      const target = arrangement.selected();
      if (!target || target.instrument !== note.instrument) {
        active.delete(id);
        feedback("请先选择对应乐器的轨道");
        return;
      }
      const abs = transport.view(now()).absolute;
      const take = recorder.advance(abs);
      if (take) arrangement.commit(take.trackId, take.notes);
      recorder.down(id, note, abs);
      engine.play(
        {
          ...note,
          trackId: target.id,
          duration: note.instrument === "keys" ? 6 : 0.3,
          when: now(),
        },
        id,
      );
    } catch {
      active.delete(id);
      feedback("请点击播放以启用声音");
    }
  };
  const up = (id: string) => {
    if (!active.delete(id)) return;
    recorder.up(id, transport.view(now()).absolute);
    engine.release(id);
    notify();
  };
  const install = async (session: Session) => {
    stop();
    const valid = arrangement.restore(session);
    transport.configure(valid.bpm, valid.beats);
    mixer.restore(valid.channels, valid.master);
    // 重新载入音频 blob；缺失的只做标记，不清空任何轨道。
    audioBlobs.clear();
    const missing: string[] = [];
    await Promise.all(
      valid.tracks.map(async (track) => {
        if (track.instrument !== "vocals" || !track.clip) return;
        const blob = await getAudioBlob(track.clip.blobId);
        if (blob) {
          audioBlobs.set(track.id, { blob });
          track.clip.missing = false;
        } else {
          track.clip.missing = true;
          missing.push(track.name);
        }
      }),
    );
    if (missing.length)
      message = `作品已恢复，但 ${missing.length} 个人声片段不可用：${missing.join("、")}。其他轨道完好。`;
    else message = "本地作品已恢复";
    notify();
  };
  const timer = window.setInterval(() => {
    tick();
    notify();
  }, 20);
  const unbind = bindPerformanceInput((id, note) => void down(id, note), up);
  const shortcut = (e: KeyboardEvent) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      !/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)
    ) {
      e.preventDefault();
      if (transport.view(now()).running) pause();
      else void play();
    }
  };
  const blur = () => {
    for (const id of [...active]) up(id);
  };
  // 设备在系统层面变化（拔出 / 新插入）时刷新列表。
  const deviceChange = () => void vocal.refreshDevices().then(notify).catch(() => {});
  navigator.mediaDevices?.addEventListener?.("devicechange", deviceChange);
  window.addEventListener("keydown", shortcut);
  window.addEventListener("blur", blur);

  return {
    view() {
      return {
        transport: transport.view(now()),
        arrangement: arrangement.snapshot(),
        selected: arrangement.selected(),
        recorder: recorder.snapshot(),
        vocal: vocal.snapshot(),
        vocalBusy,
        mixer: mixer.snapshot(),
        active: new Set(active),
        message,
      };
    },
    play,
    pause,
    stop,
    down: (id: string, n: NoteInput) => void down(id, n),
    up,
    configure(bpm: number, beats: number) {
      stop();
      transport.configure(bpm, beats);
      arrangement.resizeLoop(transport.view(now()).beats);
      player.setTempo(transport.view(now()).bpm);
      feedback("速度或长度变更：播放回到起点；缩短时移除范围外音符。");
    },
    add(kind: Instrument) {
      guard(() => {
        arrangement.add(kind);
        syncMixer();
      });
    },
    select(id: string) {
      if (recorder.snapshot().status !== "idle" || vocal.isActive()) return;
      engine.releaseHeld();
      active.clear();
      arrangement.select(id);
      notify();
    },
    remove() {
      guard(() => {
        const selected = arrangement.selected();
        if (selected) {
          stop();
          const clip = selected.clip;
          arrangement.remove(selected.id);
          audioBlobs.delete(selected.id);
          syncMixer();
          player.stop(selected.id);
          if (clip) void removeAudio(clip.blobId).catch(() => {});
        }
      });
    },
    clear() {
      guard(() => {
        const t = arrangement.selected();
        if (!t) return;
        stop();
        if (t.instrument === "vocals") {
          const old = arrangement.clearClip(t.id);
          audioBlobs.delete(t.id);
          player.stop(t.id);
          if (old) void removeAudio(old.blobId).catch(() => {});
        } else {
          arrangement.clear(t.id);
        }
      });
    },
    async record() {
      const selected = arrangement.selected();
      if (!selected) return;
      const token = ++epoch;
      try {
        if (!(await unlock()) || token !== epoch) return;
        const state = transport.view(now());
        if (!state.running) transport.start(now() + 0.02);
        recorder.arm(
          selected.id,
          selected.instrument,
          transport.view(now()).absolute,
          state.beats,
        );
        tick();
        notify();
      } catch {
        feedback("录音启动失败，请重试");
      }
    },
    cancel() {
      recorder.cancel();
      feedback("本次录音已取消，之前的片段仍然保留。");
    },
    grid(n: number) {
      recorder.grid(n);
      notify();
    },
    // ---- 人声 ----
    async refreshMics() {
      vocalBusy = true;
      notify();
      try {
        await vocal.refreshDevices();
      } catch {
        feedback("输入设备扫描失败");
      } finally {
        vocalBusy = false;
        notify();
      }
    },
    async requestMic() {
      vocalBusy = true;
      notify();
      try {
        await vocal.requestPermissionAndList();
        message = "麦克风已授权，选择输入设备后即可录制人声。";
      } catch (error) {
        feedback(
          error instanceof Error ? error.message : "麦克风授权失败，现有片段保留",
        );
      } finally {
        vocalBusy = false;
        notify();
      }
    },
    selectMic(deviceId: string) {
      vocal.selectDevice(deviceId);
      notify();
    },
    toggleMonitor(on: boolean) {
      vocal.setMonitor(on);
      const ctx = engine.context;
      const stream = vocal.stream;
      if (ctx && stream) monitorGain = routeMonitor(ctx, stream, on, monitorGain);
      else if (!on) monitorGain = null;
      feedback(on ? "监听已开启，请确认佩戴耳机以免啸叫。" : "监听已关闭。");
    },
    async recordVocal() {
      const selected = arrangement.selected();
      if (!selected || selected.instrument !== "vocals") {
        feedback("请先选择一条人声音轨");
        return;
      }
      if (selected.clip?.missing) {
        feedback("该轨道当前片段不可用，新录音成功后会直接替换。");
      }
      const token = ++epoch;
      vocalBusy = true;
      notify();
      try {
        if (!(await unlock()) || token !== epoch) return;
        const state = transport.view(now());
        if (!state.running) {
          const anchorTime = now() + 0.02;
          transport.start(anchorTime);
          startVocalLoops(anchorTime, transport.view(now()).absolute);
        }
        // 边界在拿到麦克风之后按最新拍钟计算，规避授权弹窗耗时。
        const latest = transport.view(now()).absolute;
        const boundary = captureBoundary(latest, state.beats);
        await vocal.begin(
          engine.context!,
          selected.id,
          boundary,
          state.beats,
          state.bpm,
          latest,
        );
        message = "麦克风待命：从下一个循环边界开始录一整圈。";
        tick();
      } catch (error) {
        feedback(
          error instanceof Error ? error.message : "人声录音启动失败，原片段已保留",
        );
      } finally {
        vocalBusy = false;
        notify();
      }
    },
    cancelVocal() {
      vocal.cancel();
      clearMonitor();
      feedback("人声录音已取消，之前的片段完整保留。");
    },
    volume(id: string, n: number) {
      mixer.volume(id, n);
      notify();
    },
    mute(id: string) {
      mixer.mute(id);
      notify();
    },
    master(n: number) {
      mixer.master(n);
      notify();
    },
    demo() {
      guard(() => {
        stop();
        audioBlobs.clear();
        const session = demoSession();
        arrangement.restore(session);
        transport.configure(session.bpm, session.beats);
        mixer.restore(session.channels, session.master);
        message = "示范已载入 · 点击播放，听听凌晨两点。";
        notify();
      });
    },
    async save() {
      guard(() => {
        if (recorder.snapshot().status !== "idle" || vocal.isActive())
          throw new Error("请完成或取消录音后再保存");
      });
      const a = arrangement.snapshot(),
        t = transport.view(now()),
        m = mixer.snapshot();
      const blobs = new Map<string, Blob>();
      for (const track of a.tracks) {
        if (track.instrument === "vocals" && track.clip && !track.clip.missing) {
          const entry = audioBlobs.get(track.id);
          if (!entry) {
            track.clip.missing = true;
            continue;
          }
          blobs.set(track.clip.blobId, entry.blob);
        }
      }
      try {
        await saveSession(
          {
            version: 1,
            title: a.title,
            bpm: t.bpm,
            beats: t.beats,
            tracks: a.tracks,
            channels: m.channels,
            master: m.master,
          },
          blobs,
        );
        message = "作品已保存（含人声音频）到本机浏览器";
      } catch (error) {
        feedback(
          error instanceof Error ? error.message : "保存失败，当前作品未改动",
        );
      }
      notify();
    },
    async load() {
      vocalBusy = true;
      notify();
      try {
        const session = await loadSession();
        await install(session);
      } catch (error) {
        feedback(
          error instanceof Error ? error.message : "恢复失败，当前作品已保留",
        );
      } finally {
        vocalBusy = false;
        notify();
      }
    },
    dispose() {
      disposed = true;
      epoch++;
      clearInterval(timer);
      unbind();
      navigator.mediaDevices?.removeEventListener?.("devicechange", deviceChange);
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("blur", blur);
      vocal.cancel();
      player.dispose();
      clearMonitor();
      mixer.dispose();
      engine.dispose();
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
