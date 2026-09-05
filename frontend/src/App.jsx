import { useEffect, useReducer } from 'react';
import { apiUrl, socketUrl } from './ws';
import VideoPanels from './components/VideoPanels';
import MetricsCharts from './components/MetricsCharts';
import EscalationLog from './components/EscalationLog';
import ConfigPanel from './components/ConfigPanel';

const initial = { connected: false, running: false, frame: null, history: [], usage: { DCP: 0, CAP: 0, CLAHE: 0, Retinex: 0 }, escalations: [], summary: { frames_processed: 0, mean_fps: 0, real_time_compliance_pct: 0, escalations: 0 } };
function reducer(state, action) {
  if (action.type === 'connected') return { ...state, connected: action.value };
  if (action.type === 'summary') return { ...state, summary: { ...state.summary, ...action.value } };
  if (action.type === 'frame') {
    const frame = action.value, history = [...state.history, { frame_id: frame.frame_id, fps: frame.fps || 0, fade_improvement: frame.fade_improvement || 0, contrast_gain: frame.contrast_gain || 0 }].slice(-200);
    const usage = { ...state.usage }; usage[frame.algorithm] = (usage[frame.algorithm] || 0) + 1;
    const escalations = frame.escalation ? [{ frame_id: frame.frame_id, reason: frame.escalation.reason, algorithm: frame.algorithm }, ...state.escalations].slice(0, 30) : state.escalations;
    return { ...state, frame, history, usage, escalations };
  }
  if (action.type === 'running') return { ...state, running: action.value };
  return state;
}
export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  useEffect(() => {
    let attempts = 0, socket;
    const connect = () => { socket = new WebSocket(socketUrl()); socket.onopen = () => { attempts = 0; dispatch({ type: 'connected', value: true }); }; socket.onmessage = event => { const data = JSON.parse(event.data); dispatch({ type: data.type === 'summary' ? 'summary' : 'frame', value: data }); }; socket.onclose = () => { dispatch({ type: 'connected', value: false }); if (attempts++ < 5) setTimeout(connect, Math.min(1000 * 2 ** attempts, 10000)); }; };
    connect(); return () => socket?.close();
  }, []);
  const control = async path => { await fetch(apiUrl(`/api/${path}`), { method: 'POST' }); dispatch({ type: 'running', value: path === 'start' }); };
  const upload = async event => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.append('file', file); await fetch(apiUrl('/api/upload'), { method: 'POST', body: form }); };
  return <main><header><div><h1>FogPilot</h1><p>Adaptive multi-agent dehazing monitor</p></div><div className="controls"><span className={state.connected ? 'status connected' : 'status'}>{state.connected ? '● WebSocket connected' : '● Reconnecting...'}</span><button onClick={() => control('start')} className="primary">Start</button><button onClick={() => control('stop')} className="danger">Stop</button><label className="upload">Upload<input type="file" accept="video/*" onChange={upload} /></label></div></header><div className="layout"><section><VideoPanels frame={state.frame} /><section className="panel summary"><h2>Session summary</h2><div className="summary-grid">{[['Frames', state.summary.frames_processed], ['Mean FPS', state.summary.mean_fps], ['30 FPS compliance', `${state.summary.real_time_compliance_pct}%`], ['Escalations', state.summary.escalations]].map(([label, value]) => <div key={label}><small>{label}</small><b>{value || 0}</b></div>)}</div></section><EscalationLog items={state.escalations} /></section><MetricsCharts history={state.history} usage={state.usage} /></div><ConfigPanel /></main>;
}
