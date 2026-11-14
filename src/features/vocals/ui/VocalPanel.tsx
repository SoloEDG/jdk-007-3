import type { VocalRecorder } from "../model/vocalRecorder";

type State = ReturnType<VocalRecorder["snapshot"]>;

const permissionText: Record<State["permission"], string> = {
  unknown: "权限未查询",
  prompt: "等待浏览器授权",
  granted: "麦克风已授权",
  denied: "权限被拒绝",
};

export function VocalPanel({
  state,
  hasVocalTrack,
  recording,
  busy,
  refresh,
  requestAccess,
  selectDevice,
  toggleMonitor,
  record,
  cancel,
}: {
  state: State;
  hasVocalTrack: boolean;
  recording: boolean;
  busy: boolean;
  refresh: () => void;
  requestAccess: () => void;
  selectDevice: (id: string) => void;
  toggleMonitor: (on: boolean) => void;
  record: () => void;
  cancel: () => void;
}) {
  const denied = state.permission === "denied";
  return (
    <div className="vocal-panel">
      <div className="vocal-row">
        <label className="vocal-device">
          <span>
            输入设备
            <i
              className={`perm-dot ${state.permission}`}
              title={permissionText[state.permission]}
            />
            <em>{permissionText[state.permission]}</em>
          </span>
          <select
            aria-label="麦克风输入设备"
            value={state.selectedDevice}
            disabled={recording || busy || denied}
            onChange={(e) => selectDevice(e.target.value)}
          >
            {state.devices.length === 0 && <option value="">未检测到设备</option>}
            {state.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ghost-small"
          onClick={refresh}
          disabled={recording || busy}
          title="重新扫描输入设备"
        >
          ↻ 扫描
        </button>
        {denied && (
          <button className="ghost-small warn" onClick={requestAccess}>
            重新授权
          </button>
        )}
      </div>
      <div className="vocal-row">
        <label className="monitor-switch">
          <input
            type="checkbox"
            checked={state.monitor}
            disabled={recording}
            onChange={(e) => toggleMonitor(e.target.checked)}
          />
          <span>
            实时监听
            <em>默认关闭以防啸叫 · 开启请戴耳机</em>
          </span>
        </label>
        {recording ? (
          <button className="record-cancel" onClick={cancel}>
            取消本次录音
          </button>
        ) : (
          <button
            className="vocal-record"
            disabled={
              busy ||
              denied ||
              !hasVocalTrack ||
              state.devices.length === 0 ||
              !state.selectedDevice
            }
            onClick={record}
            title={
              !hasVocalTrack
                ? "请先在编排区添加一条人声音轨"
                : denied
                  ? "麦克风权限被拒绝"
                  : "从下一个循环边界录一整圈"
            }
          >
            <span /> 录制人声循环
          </button>
        )}
      </div>
      {!hasVocalTrack && state.status === "idle" && (
        <p className="vocal-hint">先在上方「循环编排」里 ＋ 人声音轨，再回到这里录音。</p>
      )}
    </div>
  );
}
