import { useEffect, useReducer } from 'react';
import { apiUrl, socketUrl } from './ws';
import VideoPanels from './components/VideoPanels';
import MetricsCharts from './components/MetricsCharts';
import EscalationLog from './components/EscalationLog';
import ConfigPanel from './components/ConfigPanel';
import './styles.css';

const initial = {
  connected: false,
  frame: null,
  history: [],
  usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 },
  escalations: [],
  summary: { frames_processed: 0, mean_fps: 0, real_time_compliance_pct: 0, escalations: 0 },
};

function reducer(state, action) {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: action.value };
    case 'running':
      return { ...state, running: action.value };
    case 'summary':
      return { ...state, summary: { ...state.summary, ...action.value } };
    case 'frame': {
      const frame = action.value;
      const history = [
        ...state.history,
        { frame_id: frame.frame_id, fps: frame.fps || 0, fade_improvement: frame.fade_improvement || 0, contrast_gain: frame.contrast_gain || 0 },
      ].slice(-200);
      const usage = { ...state.usage };
      usage[frame.algorithm] = (usage[frame.algorithm] || 0) + 1;
      const escalations = frame.escalation
        ? [{ frame_id: frame.frame_id, reason: frame.escalation.reason, algorithm: frame.algorithm }, ...state.escalations].slice(0, 30)
        : state.escalations;
      return { ...state, frame, history, usage, escalations };
    }
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let attempts = 0, socket;
    const connect = () => {
      socket = new WebSocket(socketUrl());
      socket.onopen  = () => { attempts = 0; dispatch({ type: 'connected', value: true }); };
      socket.onmessage = e => { const d = JSON.parse(e.data); dispatch({ type: d.type === 'summary' ? 'summary' : 'frame', value: d }); };
      socket.onclose = () => { dispatch({ type: 'connected', value: false }); if (attempts++ < 5) setTimeout(connect, Math.min(1000 * 2 ** attempts, 10000)); };
    };
    connect();
    return () => socket?.close();
  }, []);

  const control = async path => {
    await fetch(apiUrl(`/api/${path}`), { method: 'POST' });
    dispatch({ type: 'running', value: path === 'start' });
  };

  const upload = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await fetch(apiUrl('/api/upload'), { method: 'POST', body: form });
  };

  const stats = [
    { label: 'Frames',           value: state.summary.frames_processed || 0 },
    { label: 'Mean FPS',         value: state.summary.mean_fps || 0 },
    { label: '30 FPS Compliance',value: `${state.summary.real_time_compliance_pct || 0}%` },
    { label: 'Escalations',      value: state.summary.escalations || 0 },
  ];

  return (
    <div id="root">
      {/* ── Top Nav ── */}
      <nav className="topnav">
        <div className="nav-brand">
          <div className="nav-logo">FP</div>
          <span className="nav-title">FogPilot</span>
        </div>

        <div className="nav-right">
          <span className={`status-pill${state.connected ? ' connected' : ''}`}>
            <span className="status-dot" />
            {state.connected ? 'Live' : 'Offline'}
          </span>

          <button className="btn btn-teal" onClick={() => control('start')}>
            ▶ Start
          </button>
          <button className="btn btn-danger" onClick={() => control('stop')}>
            ■ Stop
          </button>
          <label className="upload-btn">
            ↑ Upload
            <input type="file" accept="video/*" onChange={upload} />
          </label>
        </div>
      </nav>

      {/* ── Page ── */}
      <main className="page">

        {/* Stats row */}
        <p className="section-label">Session overview</p>
        <div className="stats-row">
          {stats.map(({ label, value }) => (
            <div className="stat-card" key={label}>
              <p className="stat-label">{label}</p>
              <p className="stat-value">{value}</p>
            </div>
          ))}
        </div>

        {/* Main 2-column grid */}
        <div className="grid-main">
          {/* Left col */}
          <div className="col-left">
            <p className="section-label" style={{ marginTop: 4 }}>Video feed</p>
            <VideoPanels frame={state.frame} />

            <EscalationLog items={state.escalations} />
          </div>

          {/* Right col — charts */}
          <div className="col-right">
            <p className="section-label" style={{ marginTop: 4 }}>Metrics</p>
            <MetricsCharts history={state.history} usage={state.usage} />
          </div>
        </div>

        {/* Config at bottom */}
        <ConfigPanel />
      </main>
    </div>
  );
}
