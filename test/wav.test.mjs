import { encodeWav, extractPeaks } from "../src/features/vocals/lib/wav.ts";

let pass = 0;
const ok = (name, cond) => {
  if (!cond) { console.error("FAIL:", name); process.exitCode = 1; }
  else { pass++; console.log("PASS:", name); }
};

// 构造一个最小 AudioBuffer 替身（只用到 encodeWav/extractPeaks 依赖的接口）
const fakeBuffer = (frames, channels, fill) => {
  const data = Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length: frames }, (_, i) => fill(c, i)));
  return {
    numberOfChannels: channels,
    sampleRate: 8000,
    length: frames,
    getChannelData: (c) => data[c],
  };
};

// 1) 编码：单声道、头部字段、数据长度、削顶
{
  const frames = 100;
  const buf = fakeBuffer(frames, 1, () => 1); // 满幅，验证削顶不越界
  const blob = encodeWav(buf);
  ok("输出是 WAV blob", blob.type === "audio/wav");
  const ab = await blob.arrayBuffer();
  const dv = new DataView(ab);
  ok("RIFF 魔数", dv.getUint32(0) === 0x52494646);
  ok("WAVE 魔数", String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11)) === "WAVE");
  ok("采样率写入正确", dv.getUint32(24, true) === 8000);
  ok("单声道", dv.getUint16(22, true) === 1);
  ok("16bit PCM", dv.getUint16(20, true) === 1 && dv.getUint16(34, true) === 16);
  ok("文件总长 = 44 头 + 2*帧", ab.byteLength === 44 + frames * 2);
  ok("data chunk 尺寸", dv.getUint32(40, true) === frames * 2);
  ok("满幅样本削到 +32767", dv.getInt16(44, true) === 32767);
}

// 2) 立体声被混成单声道，负样本正确编码
{
  const buf = fakeBuffer(4, 2, (c) => (c === 0 ? 0.5 : -0.5)); // 混合后接近 0
  const blob = encodeWav(buf);
  const dv = new DataView(await blob.arrayBuffer());
  ok("等幅反相混合近似静音", Math.abs(dv.getInt16(44, true)) <= 1);
}

// 3) 峰值提取：桶数量、范围、静音为 0
{
  const buf = fakeBuffer(1000, 1, (_, i) => (i < 500 ? 0.8 : 0));
  const peaks = extractPeaks(buf, 50);
  ok("峰值桶数符合请求", peaks.length === 50);
  ok("峰值都在 0..1", peaks.every((p) => p >= 0 && p <= 1));
  ok("前半段有峰值", peaks.slice(0, 25).some((p) => p > 0.5));
  ok("后半段静音", peaks.slice(25).every((p) => p === 0));
  const silent = extractPeaks(fakeBuffer(100, 1, () => 0), 20);
  ok("纯静音峰值全 0", silent.every((p) => p === 0));
}

console.log(`\n${pass} 项通过`);
