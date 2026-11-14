// 编排区的人声波形：按峰值数组绘制，缺失音频时明确标注不可用。
export function Waveform({
  peaks,
  color,
  missing,
}: {
  peaks: readonly number[];
  color: string;
  missing?: boolean;
}) {
  const bars = peaks.length || 1;
  return (
    <div
      className={`waveform ${missing ? "missing" : ""}`}
      role="img"
      aria-label={missing ? "人声片段音频不可用" : "人声波形"}
    >
      {Array.from({ length: bars }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${Math.max(6, (peaks[i] ?? 0) * 100)}%`,
            background: missing ? "#7a4a4a" : color,
          }}
        />
      ))}
      {missing && <b>音频不可用 · 元数据已保留</b>}
    </div>
  );
}
