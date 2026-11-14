import type { Track, Note } from "@/shared/types";
import { Waveform } from "@/features/vocals";
export function Timeline({
  tracks,
  selected,
  position,
  beats,
  draft,
  select,
}: {
  tracks: readonly Track[];
  selected: string | null;
  position: number;
  beats: number;
  draft: readonly Note[];
  select: (id: string) => void;
}) {
  return (
    <div className="timeline-scroll">
      <div className="timeline" style={{ minWidth: 500 }}>
        <div className="ruler">
          <span>轨道 / TRACK</span>
          <div>
            {Array.from({ length: beats / 4 }, (_, i) => (
              <b key={i}>{String(i + 1).padStart(2, "0")}</b>
            ))}
          </div>
        </div>
        {tracks.map((track, i) => (
          <div
            className={`lane ${selected === track.id ? "selected" : ""}`}
            key={track.id}
          >
            <button className="lane-name" onClick={() => select(track.id)}>
              <span style={{ color: track.color }}>0{i + 1}</span>
              <strong>{track.name}</strong>
              <small>
                {track.instrument === "drums"
                  ? "DRUM MACHINE"
                  : track.instrument === "keys"
                    ? "POLY SYNTH"
                    : track.clip?.missing
                      ? "VOCAL · 缺失"
                      : "VOCAL TAKE"}
              </small>
            </button>
            <div
              className="lane-notes"
              style={{ "--bars": beats / 4 } as React.CSSProperties}
            >
              {track.instrument === "vocals" && track.clip ? (
                <div
                  className={`clip-block ${track.clip.missing ? "unavailable" : ""}`}
                >
                  <Waveform
                    peaks={track.clip.peaks}
                    color={track.color}
                    missing={track.clip.missing}
                  />
                </div>
              ) : (
                [...track.notes, ...(selected === track.id ? draft : [])].map(
                  (n) => (
                    <span
                      className={`note-block ${draft.includes(n) ? "draft" : ""}`}
                      key={n.id}
                      style={{
                        left: `${(n.beat / beats) * 100}%`,
                        width: `${Math.max(0.6, (Math.min(n.duration, beats - n.beat) / beats) * 100)}%`,
                        top: `${12 + (track.instrument === "drums" ? n.pitch : (((72 - n.pitch) % 12) + 12) % 12) * 3}%`,
                        background: track.color,
                      }}
                    />
                  ),
                )
              )}
              <i
                className="playhead"
                style={{ left: `${(position / beats) * 100}%` }}
              />
            </div>
          </div>
        ))}
        {tracks.length === 0 && (
          <div className="empty-arrangement">
            <span>♫</span>
            <h3>第一拍，从你开始</h3>
            <p>添加鼓组、琴键或人声音轨，录下属于你的循环。</p>
          </div>
        )}
      </div>
    </div>
  );
}
