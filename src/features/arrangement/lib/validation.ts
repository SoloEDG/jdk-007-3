import type { Session, Track, Note, AudioClip } from "@/shared/types";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;

function validateClip(raw: unknown, beats: number): AudioClip | null {
  if (!object(raw)) return null;
  const c = raw as unknown as AudioClip;
  const peaksOk =
    Array.isArray(c.peaks) &&
    c.peaks.length >= 16 &&
    c.peaks.length <= 512 &&
    c.peaks.every((p) => finite(p, 0, 1));
  if (
    typeof c.id !== "string" ||
    !c.id ||
    typeof c.blobId !== "string" ||
    !c.blobId ||
    !finite(c.bpm, 40, 220) ||
    ![4, 8, 16, 32].includes(c.beats) ||
    !finite(c.sampleRate, 4000, 384000) ||
    !finite(c.durationSec, 0.05, 600) ||
    !peaksOk
  )
    return null;
  return {
    id: c.id,
    blobId: c.blobId,
    bpm: c.bpm,
    beats: c.beats,
    sampleRate: c.sampleRate,
    durationSec: c.durationSec,
    peaks: c.peaks.slice(),
    missing: c.missing === true,
  };
}

export function validateSession(raw: unknown): Session {
  if (
    !object(raw) ||
    raw.version !== 1 ||
    typeof raw.title !== "string" ||
    raw.title.length > 80 ||
    !finite(raw.bpm, 40, 220) ||
    ![4, 8, 16, 32].includes(raw.beats as number) ||
    !Array.isArray(raw.tracks) ||
    raw.tracks.length > 8 ||
    !object(raw.channels) ||
    !finite(raw.master, 0, 1)
  )
    throw new Error("存档格式或版本不受支持");
  const beats = raw.beats as number;
  const ids = new Set<string>();
  const noteIds = new Set<string>();
  const tracks: Track[] = [];
  const missingClips: string[] = [];
  for (const value of raw.tracks) {
    if (!object(value)) throw new Error("轨道损坏");
    const t = value as unknown as Track;
    if (
      typeof t.id !== "string" ||
      ids.has(t.id) ||
      !t.id ||
      typeof t.name !== "string" ||
      t.name.length > 32 ||
      !["drums", "keys", "vocals"].includes(t.instrument) ||
      !/^#[0-9a-f]{6}$/i.test(t.color) ||
      !Array.isArray(t.notes) ||
      t.notes.length > 2048
    )
      throw new Error("轨道数据无效");
    ids.add(t.id);
    for (const n of t.notes as Note[]) {
      if (
        !object(n) ||
        typeof n.id !== "string" ||
        noteIds.has(n.id) ||
        !finite(
          n.pitch,
          t.instrument === "drums" ? 0 : 24,
          t.instrument === "drums" ? 3 : 108,
        ) ||
        !Number.isInteger(n.pitch) ||
        !finite(n.beat, 0, beats - 0.000001) ||
        !finite(n.duration, 0.01, beats) ||
        !finite(n.velocity, 0.01, 1)
      )
        throw new Error("音符数据无效");
      noteIds.add(n.id);
    }
    const c = raw.channels[t.id];
    if (!object(c) || !finite(c.volume, 0, 1) || typeof c.muted !== "boolean")
      throw new Error("混音数据无效");

    const track: Track = {
      id: t.id,
      name: t.name,
      instrument: t.instrument,
      color: t.color,
      notes: structuredClone(t.notes),
    };
    if (t.instrument === "vocals" && t.clip !== undefined) {
      const clip = validateClip(t.clip, beats);
      if (!clip) throw new Error(`人声音轨「${t.name}」的片段数据无效`);
      track.clip = clip;
      if (clip.missing) missingClips.push(t.name);
    }
    tracks.push(track);
  }
  return {
    version: 1,
    title: raw.title as string,
    bpm: raw.bpm as number,
    beats,
    tracks,
    channels: structuredClone(raw.channels),
    master: raw.master as number,
    ...(missingClips.length ? { missingClips } : {}),
  } as Session;
}
