export type Instrument = "drums" | "keys" | "vocals";
export type Note = {
  id: string;
  pitch: number;
  beat: number;
  duration: number;
  velocity: number;
};
export type AudioClip = {
  id: string;
  blobId: string;
  bpm: number;
  beats: number;
  sampleRate: number;
  durationSec: number;
  peaks: number[];
  missing?: boolean;
};
export type Track = {
  id: string;
  name: string;
  instrument: Instrument;
  color: string;
  notes: Note[];
  clip?: AudioClip;
};
export type Channel = { volume: number; muted: boolean };
export type Session = {
  version: 1;
  title: string;
  bpm: number;
  beats: number;
  tracks: Track[];
  channels: Record<string, Channel>;
  master: number;
  // 恢复时发现音频缺失的轨道名称（仅内存中使用，不写入存档）
  missingClips?: string[];
};
export type NoteInput = {
  pitch: number;
  velocity: number;
  instrument: Instrument;
};
export type ScheduledNote = NoteInput & {
  duration: number;
  when: number;
  trackId: string;
};
export type Listener = () => void;
