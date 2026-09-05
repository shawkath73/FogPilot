import { useEffect, useReducer, useState } from 'react';
import { apiUrl, socketUrl } from './ws';
import MetricsCharts from './components/MetricsCharts';
import VideoPanels from './components/VideoPanels';
import EscalationLog from './components/EscalationLog';
import ConfigPanel from './components/ConfigPanel';
import './styles.css';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const initial = { connected: false, frame: null, history: [], usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 }, escalations: [], summary: { frames_processed: 0, mean_fps: 0, real_time_compliance_pct: 0, escalations: 0 } };

function reducer(state, action) {
  if (action.type === 'connected') return { ...state, connected: action.value };
  if (action.type === 'summary') return { ...state, summary: { ...state.summary, ...action.value } };
  if (action.type === 'frame') {
    const frame = action.value;
    const history = [...state.history, { frame_id: frame.frame_id, fps: frame.fps || 0, fade_improvement: frame.fade_improvement || 0, contrast_gain: frame.contrast_gain || 0 }].slice(-100);
    const usage = { ...state.usage }; usage[frame.algorithm] = (usage[frame.algorithm] || 0) + 1;
    const escalations = frame.escalation ? [{ frame_id: frame.frame_id, reason: frame.escalation.reason, algorithm: frame.algorithm }, ...state.escalations].slice(0, 20) : state.escalations;
    return { ...state, frame, history, usage, escalations };
  }
  return state;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [backendActive, setBackendActive] = useState(false);
  const [upload, setUpload] = useState({ busy: false, error: '', warning: '' });

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch(apiUrl('/healthz'), { cache: 'no-store' });
        if (!response.ok) throw new Error();
        if (!stopped) setBackendActive(true);
      } catch { if (!stopped) setTimeout(check, 1500); }
    };
    check();
    let socket;
    let retry = 0;
    const connect = () => {
      socket = new WebSocket(socketUrl());
      socket.onopen = () => { retry = 0; dispatch({ type: 'connected', value: true }); };
      socket.onmessage = event => { const data = JSON.parse(event.data); dispatch({ type: data.type === 'summary' ? 'summary' : 'frame', value: data }); };
      socket.onerror = () => socket.close();
      socket.onclose = () => { dispatch({ type: 'connected', value: false }); if (!stopped) setTimeout(connect, Math.min(1000 * 2 ** ++retry, 10000)); };
    };
    connect();
    return () => { stopped = true; socket?.close(); };
  }, []);

  const control = async path => { await fetch(apiUrl(`/api/${path}`), { method: 'POST' }); };
  const chooseFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setUpload({ busy: false, error: '', warning: `${file.name} is too large. Maximum upload size is 100 MB.` });
      return;
    }
    setUpload({ busy: true, error: '', warning: '' });
    const data = new FormData(); data.append('file', file);
    try {
      const response = await fetch(apiUrl('/api/upload'), { method: 'POST', body: data });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Upload failed');
      setUpload({ busy: false, error: '', warning: '' });
    } catch (error) { setUpload({ busy: false, error: error.message, warning: '' }); }
  };
  const removeMedia = async () => { await fetch(apiUrl('/api/media'), { method: 'DELETE' }); setUpload({ busy: false, error: '', warning: '' }); };

  return <div className="app-shell">
    {!backendActive && <div className="boot-screen"><div className="boot-card"><div className="loader-ring" /><b>Starting FogPilot</b><p>Waiting for the backend to become active…</p><small>This screen closes automatically.</small></div></div>}
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">FP</div><b>FogPilot</b></div>
      <span className="sidebar-caption">Monitoring</span>
      <button className="side-link selected">▦ <span>Dashboard</span></button>
      <button className="side-link" onClick={() => document.querySelector('.video-workspace')?.scrollIntoView({ behavior: 'smooth' })}>◉ <span>Live stream</span></button>
      <button className="side-link" onClick={() => document.querySelector('.metrics-workspace')?.scrollIntoView({ behavior: 'smooth' })}>⌁ <span>Analytics</span></button>
      <span className="sidebar-caption">System</span>
      {['Sensor', 'Planner', 'Critic', 'Logger'].map(agent => <div className="agent-row" key={agent}><i />{agent}<small>{state.connected ? 'live' : 'idle'}</small></div>)}
      <div className="sidebar-fill" />
      <button className="side-link" onClick={() => control('stop')}>■ <span>Stop session</span></button>
    </aside>
    <main className="dashboard">
      <header className="dashboard-header"><div><span className="eyebrow">Dashboard</span><h1>FogPilot <em>✦</em></h1><p>Adaptive dehazing, monitored in real time.</p></div><div className="header-actions"><span className={`connection ${state.connected ? 'online' : ''}`}><i />{state.connected ? 'Connected' : 'Reconnecting'}</span><button className="primary-button" onClick={() => control('start')}>▶ Start</button><label className={`upload-button${upload.busy ? ' disabled' : ''}`}>{upload.busy ? 'Uploading…' : '↑ Upload'}<input type="file" accept="image/*,video/*" onChange={chooseFile} disabled={upload.busy} /></label></div></header>
      {(upload.warning || upload.error) && <div className="upload-alert">{upload.warning || upload.error}</div>}
      <section className="overview-row"><div className="overview-main"><span className="card-label">Session overview</span><div className="overview-values"><div><b>{state.summary.frames_processed || 0}</b><small>frames processed</small></div><div><b>{state.summary.mean_fps || 0}</b><small>mean FPS</small></div></div><div className="overview-bottom"><span>30 FPS compliance <b>{state.summary.real_time_compliance_pct || 0}%</b></span><span>Escalations <b>{state.summary.escalations || 0}</b></span></div></div><div className="overview-light"><span className="card-label">Active algorithm</span><strong>{state.frame?.algorithm || '—'}</strong><small>{state.frame?.reason || 'Upload media or start a demo stream'}</small><div className="health"><i />{state.connected ? 'All agents operational' : 'Waiting for backend'}</div></div></section>
      <section className="video-workspace"><div className="section-heading"><h2>Video workspace</h2><div><button className="text-button" onClick={removeMedia}>Remove media</button><span>{state.frame ? `Frame ${state.frame.frame_id}` : 'No media loaded'}</span></div></div><VideoPanels frame={state.frame} /></section>
      <section className="metrics-workspace"><div className="section-heading"><h2>Live analytics</h2><span>Last 100 points</span></div><MetricsCharts history={state.history} usage={state.usage} /></section>
      <section className="bottom-grid"><EscalationLog items={state.escalations} /><ConfigPanel /></section>
    </main>
  </div>;
}
