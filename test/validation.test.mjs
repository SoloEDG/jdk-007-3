import { validateSession } from "../src/features/arrangement/lib/validation.ts";

let pass = 0;
const ok = (name, cond) => {
  if (!cond) { console.error("FAIL:", name); process.exitCode = 1; }
  else { pass++; console.log("PASS:", name); }
};
const expectThrow = (name, fn) => {
  try { fn(); console.error("FAIL:", name, "(未抛错)"); process.exitCode = 1; }
  catch { pass++; console.log("PASS:", name); }
};

const base = () => ({
  version: 1,
  title: "测试",
  bpm: 108,
  beats: 16,
  master: 0.7,
  channels: { d: { volume: 0.8, muted: false }, v: { volume: 0.9, muted: false } },
  tracks: [
    { id: "d", name: "鼓", instrument: "drums", color: "#d5f377", notes: [] },
    {
      id: "v", name: "人声", instrument: "vocals", color: "#80cfbb", notes: [],
      clip: {
        id: "c1", blobId: "b1", bpm: 108, beats: 16, sampleRate: 48000,
        durationSec: 8.8, peaks: Array(96).fill(0.3),
      },
    },
  ],
});

// 1) 含合法人声片段的存档通过
{
  const s = validateSession(base());
  ok("合法人声片段通过校验", s.tracks[1].clip?.blobId === "b1");
  ok("人声轨道被保留", s.tracks.length === 2);
}

// 2) 标记 missing 的片段通过校验并带出 missingClips
{
  const raw = base();
  raw.tracks[1].clip.missing = true;
  const s = validateSession(raw);
  ok("缺失标记被保留", s.tracks[1].clip?.missing === true);
  ok("带出缺失轨道名", (s.missingClips ?? []).includes("人声"));
  ok("其他轨道不受影响", s.tracks[0].id === "d");
}

// 3) 损坏的片段（峰值数组为空）被拒，而不是悄悄清空
expectThrow("空峰值数组被拒", () => {
  const raw = base();
  raw.tracks[1].clip.peaks = [];
  validateSession(raw);
});

// 4) 非法 blobId 被拒
expectThrow("缺少 blobId 被拒", () => {
  const raw = base();
  delete raw.tracks[1].clip.blobId;
  validateSession(raw);
});

// 5) 人声轨道没有片段也是合法的（尚未录音）
{
  const raw = base();
  delete raw.tracks[1].clip;
  const s = validateSession(raw);
  ok("无片段的人声音轨合法", s.tracks[1].instrument === "vocals" && !s.tracks[1].clip);
}

// 6) 未知乐器类型被拒
expectThrow("未知乐器被拒", () => {
  const raw = base();
  raw.tracks[1].instrument = "guitar";
  validateSession(raw);
});

console.log(`\n${pass} 项通过`);
