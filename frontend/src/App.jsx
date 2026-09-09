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
  if (action.type === 'snapshot') return {
    ...state,
    frame: action.value.frame || state.frame,
    history: action.value.history || [],
    usage: action.value.usage || state.usage,
    escalations: action.value.escalations || [],
    summary: { ...state.summary, ...(action.value.summary || {}) },
  };
  if (action.type === 'media_removed') return { ...state, frame: null, history: [], usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 }, escalations: [] };
  if (action.type === 'frame') {
    const frame = action.value;
    const history = [...state.history, { frame_id: frame.frame_id, fps: frame.fps || 0, fade_improvement: frame.fade_improvement || 0, contrast_gain: frame.contrast_gain || 0 }].slice(-100);
    const usage = { ...state.usage }; usage[frame.algorithm] = (usage[frame.algorithm] || 0) + 1;
    const escalations = frame.escalation ? [{ frame_id: frame.frame_id, reason: frame.escalation.reason, algorithm: frame.algorithm }, ...state.escalations].slice(0, 20) : state.escalations;
    return { ...state, frame, history, usage, escalations, summary: frame.session_summary ? { ...state.summary, ...frame.session_summary } : state.summary };
  }
  return state;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [backendActive, setBackendActive] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
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
      socket.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'summary') dispatch({ type: 'summary', value: data });
        else if (data.type === 'snapshot') dispatch({ type: 'snapshot', value: data });
        else if (data.type === 'media_error') setUpload({ busy: false, progress: 0, phase: '', error: data.message, warning: '' });
        else dispatch({ type: 'frame', value: data });
      };
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
  const resetStatistics = async () => {
    try {
      const response = await fetch(apiUrl('/api/reset'), { method: 'POST' });
      if (!response.ok) throw new Error('Could not reset statistics');
      dispatch({ type: 'snapshot', value: { history: [], usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 }, escalations: [], summary: { frames_processed: 0, mean_fps: 0, real_time_compliance_pct: 0, escalations: 0 } } });
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
      <button className="side-link selected"><i className="ui-icon grid-icon" aria-hidden="true" /><span>Dashboard</span></button>
      <button className="side-link" onClick={() => document.querySelector('.video-workspace')?.scrollIntoView({ behavior: 'smooth' })}><i className="ui-icon stream-icon" aria-hidden="true" /><span>Live stream</span></button>
      <button className="side-link" onClick={() => document.querySelector('.metrics-workspace')?.scrollIntoView({ behavior: 'smooth' })}><i className="ui-icon chart-icon" aria-hidden="true" /><span>Analytics</span></button>
      <button className="side-link" onClick={() => setGuideOpen(true)}><i className="ui-icon info-icon" aria-hidden="true" /><span>User guide</span></button>
      <span className="sidebar-caption">System</span>
      {['Sensor', 'Planner', 'Critic', 'Logger'].map(agent => <div className="agent-row" key={agent}><i />{agent}<small>{state.connected ? 'live' : 'idle'}</small></div>)}
      <div className="sidebar-fill" />
      <button className="side-link" onClick={() => control('stop')}><i className="ui-icon stop-icon" aria-hidden="true" /><span>Stop session</span></button>
    </aside>
    <main className="dashboard">
      <header className="dashboard-header"><div><span className="eyebrow">Live monitoring</span><h1>Hi, FogPilot</h1><p>Adaptive dehazing, monitored in real time.</p></div><div className="header-actions"><span className={`connection ${state.connected ? 'online' : ''}`}><i />{state.connected ? 'Connected' : 'Reconnecting'}</span><button className="report-button" onClick={downloadReport}><i className="ui-icon download-icon" aria-hidden="true" />Report</button><button className="primary-button" onClick={() => control('start')}><i className="ui-icon play-icon" aria-hidden="true" />Start</button><label className={`upload-button${upload.busy ? ' disabled' : ''}`}><i className="ui-icon upload-icon" aria-hidden="true" />{upload.busy ? `Uploading ${upload.progress}%` : 'Upload'}<input type="file" accept="image/*,video/*" onChange={chooseFile} disabled={upload.busy} /></label>{upload.busy && <button className="cancel-button" onClick={cancelUpload}>Cancel</button>}</div></header>
      {(upload.warning || upload.error) && <div className="upload-alert">{upload.warning || upload.error}</div>}
      {upload.busy && <div className="upload-progress"><span style={{ width: `${upload.progress}%` }} /></div>}
      {upload.busy && <div className="upload-status">{upload.phase || 'Preparing media…'}</div>}
      <section className="overview-row"><div className="overview-main"><span className="card-label">Overall information</span><div className="overview-values"><div><b>{state.summary.frames_processed || 0}</b><small>frames processed</small></div><div><b>{state.summary.escalations || 0}</b><small>escalations</small></div></div><div className="overview-bottom"><span>30 FPS compliance <b>{state.summary.real_time_compliance_pct || 0}%</b></span><span>Mean FPS <b>{state.summary.mean_fps || 0}</b></span></div></div><div className="overview-light"><span className="card-label">Active algorithm</span><strong>{state.frame?.algorithm || '—'}</strong><small>{state.frame?.reason || 'Upload media or start a demo stream'}</small><div className="health"><i />{state.connected ? 'All agents operational' : 'Waiting for backend'}</div></div><div className="overview-light usage-summary"><div className="card-top"><span className="card-label">Routing distribution</span></div><div className="usage-bars">{Object.entries(state.usage).map(([name, count]) => <div key={name}><span>{name}</span><i><b style={{ width: `${Math.min(100, count ? Math.max(8, count / Math.max(1, state.summary.frames_processed || count) * 100) : 0)}%` }} /></i><small>{count}</small></div>)}</div><button className="outline-button" onClick={downloadReport}>Download report <i className="ui-icon download-icon" aria-hidden="true" /></button></div></section>
      <section className="video-workspace"><div className="section-heading"><h2>Video workspace</h2><div><button className="text-button" onClick={removeMedia}>Remove media</button><span>{state.frame ? `Frame ${state.frame.frame_id}` : upload.busy ? 'Preparing media…' : 'No media loaded'}</span></div></div><VideoPanels frame={state.frame} /></section>
      <section className="metrics-workspace"><div className="section-heading"><h2>Live analytics</h2><div><span>Last 100 points</span><button className="text-button" onClick={downloadReport}>Download report <i className="ui-icon download-icon" aria-hidden="true" /></button></div></div><MetricsCharts history={state.history} usage={state.usage} /></section>
      <section className="bottom-grid"><EscalationLog items={state.escalations} /><ConfigPanel /><button className="reset-statistics" onClick={resetStatistics}>Reset statistics</button></section>
    </main>
    {guideOpen && <div className="guide-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setGuideOpen(false); }}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <button className="guide-close" onClick={() => setGuideOpen(false)} aria-label="Close user guide" />
        <span className="eyebrow">FogPilot help</span>
        <h2 id="guide-title">How the dashboard works</h2>
        <p className="guide-intro">FogPilot watches each frame, chooses the most suitable dehazing method, checks the result, and reports the decision live.</p>
        <div className="guide-sections">
          <article><h3>1. Start a session</h3><p>Click <b>Start</b> to run the built-in fog-road demo, or use <b>Upload</b> for a JPG, PNG, MP4, MOV, AVI, MKV, or WebM file. Upload progress ends when the backend has validated the media and started streaming.</p></article>
          <article><h3>2. Follow the agents</h3><p><b>Sensor</b> measures fog, brightness, complexity, and FPS headroom. <b>Planner</b> routes the frame to DCP, CAP, CLAHE, or Retinex. <b>Critic</b> checks quality and speed, then escalates when needed. <b>Logger</b> stores bounded history and session totals.</p></article>
          <article><h3>3. Read the metrics</h3><p><b>Frames processed</b> is the total number of frames accepted by the pipeline. <b>Mean FPS</b> is measured processing speed. <b>30 FPS compliance</b> is the percentage of measured frames meeting the real-time target. <b>Escalations</b> counts frames that needed another algorithm.</p></article>
          <article><h3>4. Understand the charts</h3><p><b>FPS over time</b> shows speed against the dashed 30 FPS target. <b>Quality metrics</b> shows FADE improvement and contrast gain. <b>Algorithm usage</b> shows routing distribution. <b>Routing map</b> shows the frame count handled by each algorithm.</p></article>
          <article><h3>5. Tune the pipeline</h3><p>Open <b>Configuration / tuning</b> to change fog sensitivity, minimum quality improvement, slow-frame tolerance, and maximum escalations. Click <b>Apply changes</b>; updates affect new frames without restarting the service.</p></article>
          <article><h3>6. Manage the session</h3><p>Use <b>Remove media</b> to stop the current stream and clear its visuals. Use <b>Reset statistics</b> to clear counters, charts, routing counts, and escalation history while keeping the uploaded media. Use <b>Download report</b> to save the current session summary as JSON. Refreshing the page restores the active session snapshot while the backend remains running.</p></article>
        </div>
        <div className="guide-legend"><span><i className="guide-dot live" />Live means the WebSocket is connected</span><span><i className="guide-dot warn" />Red output means the Critic flagged degradation</span></div>
      </section>
    </div>}
  </div>;
}
