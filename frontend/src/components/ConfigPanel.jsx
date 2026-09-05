import { useState } from 'react';
import { apiUrl } from '../ws';

export default function ConfigPanel() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState({ critical_fog_threshold: .75, min_fade_improvement: 1.5, max_consecutive_slow_frames: 5, max_escalations: 2 });
  const apply = async () => { await fetch(apiUrl('/api/config'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }); };
  return <section className="panel config"><button onClick={() => setOpen(!open)} className="collapse">Configuration / tuning {open ? '▴' : '▾'}</button>{open && <div className="config-grid">{Object.entries(config).map(([key, value]) => <label key={key}>{key.replaceAll('_', ' ')}<input type="number" step={key.includes('threshold') || key.includes('improvement') ? .1 : 1} value={value} onChange={event => setConfig({ ...config, [key]: Number(event.target.value) })} /></label>)}<button onClick={apply} className="primary">Apply</button></div>}</section>;
}
