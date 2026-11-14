import type { Session } from "@/shared/types";
import { validateSession } from "../lib/validation";
import { putAudioBlob, getAudioBlob, deleteAudioBlob } from "@/features/vocals/lib/blobStore";

const KEY = "nightshift-session-v1";

// 保存：音频 WAV 先写入 IndexedDB，成功后再落元数据，避免出现有引用没内容的存档。
export async function saveSession(session: Session, blobs: ReadonlyMap<string, Blob>) {
  const safe = validateSession(session);
  await Promise.all(
    [...blobs.entries()].map(([id, blob]) => putAudioBlob(id, blob)),
  );
  localStorage.setItem(KEY, JSON.stringify(safe));
}

// 恢复：元数据先过校验，再逐个确认音频 blob 仍然存在；
// 任何一个片段缺失只标记该片段，绝不清空其他轨道。
export async function loadSession(): Promise<Session> {
  const text = localStorage.getItem(KEY);
  if (!text) throw new Error("还没有本地存档，请先保存");
  if (text.length > 4000000) throw new Error("存档过大，已保留当前作品");
  const session = validateSession(JSON.parse(text));
  const missing: string[] = [];
  await Promise.all(
    session.tracks.map(async (track) => {
      if (track.instrument !== "vocals" || !track.clip) return;
      const blob = await getAudioBlob(track.clip.blobId);
      if (!blob) {
        track.clip.missing = true;
        missing.push(track.name);
      }
    }),
  );
  session.missingClips = missing;
  return session;
}

export async function removeAudio(blobId: string) {
  await deleteAudioBlob(blobId);
}
