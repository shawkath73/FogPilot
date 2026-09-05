import { useEffect, useReducer, useState } from 'react';
import { apiUrl, socketUrl } from './ws';
import MetricsCharts from './components/MetricsCharts';
import VideoPanels from './components/VideoPanels';
import EscalationLog from './components/EscalationLog';
import ConfigPanel from './components/ConfigPanel';
import './styles.css';

const initial = {
  connected: false,
  running: false,
  frame: null,
  history: [],
  usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 },
  escalations: [],
  summary: { frames_processed: 0, mean_fps: 0, real_time_compliance_pct: 0, escalations: 0 },
};

function reducer(state, action) {
  if (action.type === 'connected') return { ...state, connected: action.value };
  if (action.type === 'running') return { ...state, running: action.value };
  if (action.type === 'summary') return { ...state, summary: { ...state.summary, ...action.value } };
  if (action.type === 'frame') {
    const frame = action.value;
    const history = [...state.history, {
      frame_id: frame.frame_id,
      fps: frame.fps || 0,
      fade_improvement: frame.fade_improvement || 0,
      contrast_gain: frame.contrast_gain || 0,
    }].slice(-200);
    const usage = { ...state.usage };
    usage[frame.algorithm] = (usage[frame.algorithm] || 0) + 1;
    const escalations = frame.escalation
      ? [{ frame_id: frame.frame_id, reason: frame.escalation.reason, algorithm: frame.algorithm }, ...state.escalations].slice(0, 30)
      : state.escalations;
    return { ...state, frame, history, usage, escalations };
  }
  return state;
}

function Icon({ children }) {
  return <span className="nav-icon">{children}</span>;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [backendActive, setBackendActive] = useState(false);
  const [uploadState, setUploadState] = useState({ busy: false, error: '' });
  const [activeNav, setActiveNav] = useState('Dashboard');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [goals, setGoals] = useState([
    { label: 'Connect a video source', done: false },
    { label: 'Run 100 frames', done: false },
    { label: 'Reach 30 FPS compliance', done: false },
  ]);

  useEffect(() => {
    let cancelled = false;
    const checkBackend = async () => {
      try {
        const response = await fetch(apiUrl('/healthz'), { cache: 'no-store' });
        if (!response.ok) throw new Error('backend is not ready');
        if (!cancelled) setBackendActive(true);
      } catch {
        if (!cancelled) setTimeout(checkBackend, 1500);
      }
    };
    checkBackend();
    let attempts = 0;
    let socket;
    const connect = () => {
      socket = new WebSocket(socketUrl());
      socket.onopen = () => { attempts = 0; dispatch({ type: 'connected', value: true }); };
      socket.onerror = () => socket.close();
      socket.onmessage = event => {
        const data = JSON.parse(event.data);
        dispatch({ type: data.type === 'summary' ? 'summary' : 'frame', value: data });
      };
      socket.onclose = () => {
        dispatch({ type: 'connected', value: false });
        attempts += 1;
        setTimeout(connect, Math.min(1000 * 2 ** attempts, 10000));
      };
    };
    connect();
    return () => { cancelled = true; socket?.close(); };
  }, []);

  useEffect(() => {
    setGoals(current => current.map(goal => (
      goal.label === 'Connect a video source' ? { ...goal, done: Boolean(state.frame) }
        : goal.label === 'Run 100 frames' ? { ...goal, done: state.summary.frames_processed >= 100 }
          : { ...goal, done: state.summary.real_time_compliance_pct >= 80 }
    )));
  }, [state.frame, state.summary]);

  const control = async path => {
    const response = await fetch(apiUrl(`/api/${path}`), { method: 'POST' });
    if (response.ok) dispatch({ type: 'running', value: path === 'start' });
  };

  const upload = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState({ busy: true, error: '' });
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(apiUrl('/api/upload'), { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || 'Upload failed');
      setUploadState({ busy: false, error: '' });
      setGoals(current => current.map(goal => goal.label === 'Connect a video source' ? { ...goal, done: true } : goal));
    } catch (error) {
      setUploadState({ busy: false, error: error.message });
    } finally {
      event.target.value = '';
    }
  };

  const downloadReport = async () => {
    const response = await fetch(apiUrl('/api/report'));
    const blob = new Blob([JSON.stringify(await response.json(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'fogpilot-report.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const shareReport = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setNoticeOpen(true);
  };

  const stats = [
    ['Frames processed', state.summary.frames_processed || 0, 'Since session start'],
    ['Mean FPS', state.summary.mean_fps || 0, 'Pipeline average'],
    ['30 FPS compliance', `${state.summary.real_time_compliance_pct || 0}%`, 'Real-time target'],
    ['Escalations', state.summary.escalations || 0, 'Critic reroutes'],
  ];

  return (
    <div className={`app-shell${lightMode ? ' light-mode' : ''}`}>
      {!backendActive && <div className="boot-screen"><div className="boot-card"><div className="loader-ring" /><h2>Connecting to FogPilot</h2><p>Waiting for the backend to become active…</p><span>Do not close this window</span></div></div>}

      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">FP</div><span>FogPilot</span></div>
        <div className="sidebar-label">Workspace</div>
        {['Dashboard', 'Live stream', 'Analytics', 'Media library'].map(item => (
          <button className={`side-link${activeNav === item ? ' selected' : ''}`} onClick={() => setActiveNav(item)} key={item}><Icon>{item === 'Dashboard' ? '▦' : item === 'Live stream' ? '◉' : item === 'Analytics' ? '⌁' : '▱'}</Icon>{item}</button>
        ))}
        <div className="sidebar-label">Tools</div>
        <button className="side-link" onClick={() => setShowCreate(true)}><Icon>＋</Icon>New session</button>
        <button className="side-link" onClick={() => setNoticeOpen(true)}><Icon>◇</Icon>System status</button>
        <div className="sidebar-label">Agents</div>
        {['Sensor', 'Planner', 'Critic', 'Logger'].map(item => <div className="agent-row" key={item}><span className="agent-dot" />{item}<span className="agent-state">{state.connected ? 'live' : 'idle'}</span></div>)}
        <div className="sidebar-spacer" />
        <button className="side-link" onClick={() => setLightMode(mode => !mode)}><Icon>{lightMode ? '☾' : '☼'}</Icon>{lightMode ? 'Dark mode' : 'Light mode'}</button>
        <div className="profile"><div className="avatar">FP</div><div><b>FogPilot user</b><small>{state.connected ? 'Online now' : 'Offline'}</small></div><span>⋮</span></div>
      </aside>

      <main className="dashboard">
        <header className="dashboard-header">
          <div><span className="eyebrow">{activeNav}</span><h1>Good evening, operator <span>✦</span></h1><p>Monitor adaptive dehazing performance in real time.</p></div>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setSearchOpen(open => !open)}>⌕</button>
            <button className="icon-button" onClick={() => setNoticeOpen(open => !open)}>♧<i>{state.escalations.length > 0 ? '!' : ''}</i></button>
            <button className="create-button" onClick={() => setShowCreate(true)}>＋ Create</button>
          </div>
          {searchOpen && <input autoFocus className="global-search" placeholder="Search agents, frames, reports…" />}
          {noticeOpen && <div className="notice-popover"><b>{state.connected ? 'All agents operational' : 'Backend reconnecting'}</b><span>{state.escalations.length} recent escalations · {state.summary.frames_processed} frames</span></div>}
        </header>

        <div className="hero-grid">
          <section className="overview-card dark-card"><div className="card-top"><div><h2>Overall information</h2><p>Live session performance</p></div><div className="card-actions"><button onClick={shareReport}>↗</button><button onClick={downloadReport}>⋮</button></div></div><div className="overview-numbers"><div><strong>{state.summary.frames_processed || 0}</strong><span>frames processed</span></div><div><strong>{state.usage.CAP + state.usage.DCP + state.usage.CLAHE + state.usage.Retinex || 0}</strong><span>agent decisions</span></div></div><div className="mini-stat-grid">{stats.slice(2).map(([label, value]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</div></section>
          <section className="panel-card progress-card"><div className="card-top"><div><h2>Weekly progress</h2><p>Frames and quality targets</p></div><span className="round-icon">⌁</span></div><div className="progress-line"><span style={{ width: `${Math.min(state.summary.frames_processed / 100 * 100, 100)}%` }} /></div><div className="progress-meta"><b>{Math.min(state.summary.frames_processed, 100)} / 100 frames</b><span>{state.summary.mean_fps || 0} FPS avg</span></div><div className="week-bars">{[35, 52, 44, 68, 58, Math.min(90, 20 + state.summary.frames_processed % 80), 28].map((height, index) => <div key={index}><span style={{ height: `${height}%` }} /><small>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</small></div>)}</div></section>
          <section className="panel-card month-card"><div className="card-top"><div><h2>Session health</h2><p>Compared with 30 FPS target</p></div><span className="round-icon">⌁</span></div><div className="health-ring"><div><b>{state.summary.real_time_compliance_pct || 0}%</b><span>healthy</span></div></div><button className="outline-button" onClick={downloadReport}>Download report ↓</button></section>
        </div>

        <div className="content-grid">
          <div className="left-content">
            <section className="section-heading"><h2>Video workspace</h2><span>{state.frame ? `Frame ${state.frame.frame_id}` : 'No source loaded'}</span></section>
            <VideoPanels frame={state.frame} />
            <section className="panel-card goals-card"><div className="section-heading"><h2>Session goals</h2><button className="more-button" onClick={() => setGoals(goals.map(goal => ({ ...goal, done: false })))}>Reset</button></div>{goals.map((goal, index) => <label className="goal-row" key={goal.label}><input type="checkbox" checked={goal.done} onChange={() => setGoals(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, done: !item.done } : item))} /><span className={goal.done ? 'done' : ''}>{goal.label}</span></label>)}</section>
          </div>
          <div className="right-content"><section className="section-heading"><h2>Task in process</h2><span>{state.running ? '1 active' : '0 active'}</span></section><div className="task-grid"><button className="task-card task-active" onClick={() => control(state.running ? 'stop' : 'start')}><span className="task-icon">◉</span><b>{state.running ? 'Stop live pipeline' : 'Start live pipeline'}</b><small>{state.running ? 'Processing frames now' : 'Ready for a new run'}</small><strong>{state.running ? '■' : '▶'}</strong></button><label className="task-card upload-task"><span className="task-icon">＋</span><b>{uploadState.busy ? 'Uploading media…' : 'Add image or video'}</b><small>{uploadState.error || 'JPG, PNG, MP4, MOV and more'}</small><input type="file" accept="video/*,image/*" onChange={upload} disabled={uploadState.busy} /></label></div><MetricsCharts history={state.history} usage={state.usage} /><EscalationLog items={state.escalations} /></div>
        </div>
        <ConfigPanel />
      </main>

      {showCreate && <div className="modal-backdrop" onClick={() => setShowCreate(false)}><div className="create-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setShowCreate(false)}>×</button><span className="modal-icon">✦</span><h2>Create a new session</h2><p>Choose how FogPilot should start monitoring your next source.</p><button className="modal-option" onClick={() => { setShowCreate(false); control('start'); }}>▶ Start demo stream <small>Use generated foggy frames</small></button><label className="modal-option">↑ Upload media <small>Choose an image or video file</small><input type="file" accept="video/*,image/*" onChange={event => { setShowCreate(false); upload(event); }} /></label></div></div>}
    </div>
  );
}
