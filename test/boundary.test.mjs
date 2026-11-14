// 边界对齐纯逻辑测试：不依赖浏览器/DOM。
// 用 tsx 不可用时，这里直接内联一份等价实现做行为验证；
// 真实源码通过 tsc/vite 构建保证类型与打包正确。
import { alignToBoundaries } from "../src/features/vocals/lib/boundary.ts";

const SR = 1000; // 1kHz 方便按毫秒断言
const tone = (n, v = 0.5) => Float32Array.from({ length: n }, () => v);

let pass = 0;
const ok = (name, cond) => {
  if (!cond) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    pass++;
    console.log("PASS:", name);
  }
};

// 1) 完美整圈：4 秒，4 块各 1 秒，时间戳精确
{
  const chunks = [0, 1, 2, 3].map((t) => ({
    samples: tone(SR),
    time: t,
    sampleRate: SR,
  }));
  const r = alignToBoundaries(chunks, 0, 4, SR);
  ok("整圈长度精确等于目标采样数", r.channel.length === 4 * SR);
  ok("整圈无偏差", r.driftSec === 0);
  ok("整圈内容完整", r.channel[0] === 0.5 && r.channel[3999] === 0.5);
}

// 2) 设备晚启动 200ms：开头补零，结尾裁切，总长度不变
{
  const chunks = [
    { samples: tone(SR), time: 0.2, sampleRate: SR },
    { samples: tone(SR), time: 1.2, sampleRate: SR },
    { samples: tone(SR), time: 2.2, sampleRate: SR },
    { samples: tone(SR), time: 3.2, sampleRate: SR },
  ];
  const r = alignToBoundaries(chunks, 0, 4, SR);
  ok("晚启动仍保持整圈长度", r.channel.length === 4 * SR);
  ok("晚启动开头补齐静音", r.channel[0] === 0 && r.channel[199] === 0);
  ok("晚启动边界后有内容", r.channel[200] === 0.5);
  ok("晚启动结尾被裁切", r.channel[3999] === 0.5); // 最后一块到4.2，裁到4.0
  ok("记录正偏差", Math.abs(r.driftSec - 0.2) < 1e-9);
}

// 3) 设备早启动 200ms：前面样本被裁掉
{
  // 用随样本递增的渐变值，才能区分裁剪偏移是否正确。
  const ramp = (base) =>
    Float32Array.from({ length: SR }, (_, i) => (base + i) / 10000);
  const chunks = [
    { samples: ramp(0), time: -0.2, sampleRate: SR },
    { samples: ramp(1000), time: 0.8, sampleRate: SR },
    { samples: ramp(2000), time: 1.8, sampleRate: SR },
    { samples: ramp(3000), time: 2.8, sampleRate: SR },
  ];
  const r = alignToBoundaries(chunks, 0, 4, SR);
  ok("早启动仍保持整圈长度", r.channel.length === 4 * SR);
  // 第一块覆盖 -0.2..0.8，拍钟 0 位置对应块内第 200 个样本 => 0.02
  ok("早启动开头裁到正确样本", Math.abs(r.channel[0] - 0.02) < 1e-9);
  // 最后一块覆盖 2.8..3.8s，其尾部样本落在输出位置 3799（值 (3000+999)/10000）。
  ok("早启动末块尾部对齐", Math.abs(r.channel[3799] - 0.3999) < 1e-6);
  // 3.8..4.0s 没有任何块覆盖，按规则静音补齐。
  ok("早启动结尾缺口补零", r.channel[3800] === 0 && r.channel[3999] === 0);
  ok("记录负偏差", Math.abs(r.driftSec + 0.2) < 1e-9);
}

// 4) 模拟十圈：每圈都用同一对齐函数，输出长度恒定 -> 不会逐圈累积错位
{
  const lengths = new Set();
  for (let lap = 0; lap < 10; lap++) {
    // 每圈加一点随机漂移，模拟设备时钟与拍钟的偏差
    const drift = (Math.sin(lap * 1.7) * 0.03);
    const chunks = [0, 1, 2, 3].map((t) => ({
      samples: tone(SR),
      time: lap * 4 + t + drift,
      sampleRate: SR,
    }));
    const r = alignToBoundaries(chunks, lap * 4, lap * 4 + 4, SR);
    lengths.add(r.channel.length);
  }
  ok("十圈输出采样数完全一致（无累积错位）", lengths.size === 1 && lengths.has(4 * SR));
}

// 5) 中间丢块：缺口补静音，长度依旧恒定
{
  const chunks = [
    { samples: tone(SR), time: 0, sampleRate: SR },
    // 缺 1..2 秒
    { samples: tone(SR), time: 2, sampleRate: SR },
    { samples: tone(SR), time: 3, sampleRate: SR },
  ];
  const r = alignToBoundaries(chunks, 0, 4, SR);
  ok("丢块保持整圈长度", r.channel.length === 4 * SR);
  ok("丢块处补静音", r.channel[1500] === 0);
  ok("丢块外内容保留", r.channel[500] === 0.5 && r.channel[2500] === 0.5);
}

console.log(`\n${pass} 项通过`);
