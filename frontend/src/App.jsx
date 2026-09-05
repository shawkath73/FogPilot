import { useEffect, useReducer, useRef, useState } from 'react';
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
  if (action.type === 'media_removed') return { ...state, frame: null, history: [], usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 }, escalations: [] };
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
  const [upload, setUpload] = useState({ busy: false, progress: 0, phase: '', error: '', warning: '' });
  const uploadRequest = useRef(null);

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
      setUpload({ busy: false, progress: 0, phase: '', error: '', warning: `${file.name} is too large. Maximum upload size is 100 MB.` });
      return;
    }
    dispatch({ type: 'media_removed' });
    setUpload({ busy: true, progress: 0, phase: 'Uploading file…', error: '', warning: '' });
    const data = new FormData(); data.append('file', file);
    try {
      await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        uploadRequest.current = request;
        request.open('POST', apiUrl('/api/upload'));
        request.timeout = 15 * 60 * 1000;
        request.upload.onprogress = event => {
          if (event.lengthComputable) setUpload(current => ({ ...current, phase: `Uploading ${Math.round(event.loaded / event.total * 100)}%`, progress: Math.round(event.loaded / event.total * 100) }));
        };
        request.onload = () => {
          let result = {};
          try { result = JSON.parse(request.responseText || '{}'); } catch { reject(new Error('Backend returned an invalid upload response')); return; }
          if (request.status >= 200 && request.status < 300) resolve(result);
          else reject(new Error(result.detail || 'Upload failed'));
        };
        request.onerror = () => reject(new Error('Network error while uploading'));
        request.ontimeout = () => reject(new Error('Upload timed out. Try a smaller video or check the Render service logs.'));
        request.onabort = () => reject(new Error('Upload cancelled'));
        request.send(data);
      });
      setUpload({ busy: false, progress: 100, phase: 'Stream active', error: '', warning: '' });
    } catch (error) { setUpload({ busy: false, progress: 0, phase: '', error: error.message, warning: '' }); }
    finally { uploadRequest.current = null; }
  };
  const cancelUpload = () => {
    uploadRequest.current?.abort();
    setUpload(current => ({ ...current, busy: false, phase: '', error: 'Upload cancelled.' }));
  };
  const removeMedia = async () => {
    try {
      const response = await fetch(apiUrl('/api/media'), { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Could not remove media');
      dispatch({ type: 'media_removed' });
      setUpload({ busy: false, progress: 0, phase: '', error: '', warning: '' });
    } catch (error) {
      setUpload(current => ({ ...current, error: error.message, warning: '' }));
    }
  };
  const downloadReport = async () => {
    const response = await fetch(apiUrl('/api/report'));
    const blob = new Blob([JSON.stringify(await response.json(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fogpilot-report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

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
      <header className="dashboard-header"><div><span className="eyebrow">Live monitoring</span><h1>Hi, FogPilot <em>✦</em></h1><p>Adaptive dehazing, monitored in real time.</p></div><div className="header-actions"><span className={`connection ${state.connected ? 'online' : ''}`}><i />{state.connected ? 'Connected' : 'Reconnecting'}</span><button className="report-button" onClick={downloadReport}>↓ Report</button><button className="primary-button" onClick={() => control('start')}>▶ Start</button><label className={`upload-button${upload.busy ? ' disabled' : ''}`}>{upload.busy ? `Uploading ${upload.progress}%` : '↑ Upload'}<input type="file" accept="image/*,video/*" onChange={chooseFile} disabled={upload.busy} /></label>{upload.busy && <button className="cancel-button" onClick={cancelUpload}>Cancel</button>}</div></header>
      {(upload.warning || upload.error) && <div className="upload-alert">{upload.warning || upload.error}</div>}
      {upload.busy && <div className="upload-progress"><span style={{ width: `${upload.progress}%` }} /></div>}
      {upload.busy && <div className="upload-status">{upload.phase || 'Preparing media…'}</div>}
      <section className="overview-row"><div className="overview-main"><span className="card-label">Overall information</span><div className="overview-values"><div><b>{state.summary.frames_processed || 0}</b><small>frames processed</small></div><div><b>{state.summary.escalations || 0}</b><small>escalations</small></div></div><div className="overview-bottom"><span>30 FPS compliance <b>{state.summary.real_time_compliance_pct || 0}%</b></span><span>Mean FPS <b>{state.summary.mean_fps || 0}</b></span></div></div><div className="overview-light"><span className="card-label">Active algorithm</span><strong>{state.frame?.algorithm || '—'}</strong><small>{state.frame?.reason || 'Upload media or start a demo stream'}</small><div className="health"><i />{state.connected ? 'All agents operational' : 'Waiting for backend'}</div></div><div className="overview-light usage-summary"><div className="card-top"><span className="card-label">Routing distribution</span><span className="round-icon">◌</span></div><div className="usage-bars">{Object.entries(state.usage).map(([name, count]) => <div key={name}><span>{name}</span><i><b style={{ width: `${Math.min(100, count ? Math.max(8, count / Math.max(1, state.summary.frames_processed || count) * 100) : 0)}%` }} /></i><small>{count}</small></div>)}</div><button className="outline-button" onClick={downloadReport}>Download report ↓</button></div></section>
      <section className="video-workspace"><div className="section-heading"><h2>Video workspace</h2><div><button className="text-button" onClick={removeMedia}>Remove media</button><span>{state.frame ? `Frame ${state.frame.frame_id}` : upload.busy ? 'Preparing media…' : 'No media loaded'}</span></div></div><VideoPanels frame={state.frame} /></section>
      <section className="metrics-workspace"><div className="section-heading"><h2>Live analytics</h2><div><span>Last 100 points</span><button className="text-button" onClick={downloadReport}>Download report ↓</button></div></div><MetricsCharts history={state.history} usage={state.usage} /></section>
      <section className="bottom-grid"><EscalationLog items={state.escalations} /><ConfigPanel /></section>
    </main>
  </div>;
}
