import { useState } from 'react';
import { apiUrl } from '../ws';

const DEFAULT = {
  critical_fog_threshold:      0.75,
  min_fade_improvement:        1.5,
  max_consecutive_slow_frames: 5,
  max_escalations:             2,
};

export default function ConfigPanel() {
  const [open, setOpen]     = useState(false);
  const [cfg, setCfg]       = useState(DEFAULT);
  const [saved, setSaved]   = useState(false);

  const apply = async () => {
    await fetch(apiUrl('/api/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="config-card">
      <button
        className="config-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>Configuration / tuning</span>
        <span className={`config-chevron${open ? ' open' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="config-body">
          {Object.entries(cfg).map(([key, val]) => (
            <div className="config-field" key={key}>
              <label className="config-field-label">{key.replaceAll('_', ' ')}</label>
              <input
                className="config-input"
                type="number"
                step={key.includes('threshold') || key.includes('improvement') ? 0.1 : 1}
                value={val}
                onChange={e => setCfg({ ...cfg, [key]: Number(e.target.value) })}
              />
            </div>
          ))}

          <div>
            <button
              className={`btn btn-teal`}
              onClick={apply}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {saved ? '✓ Saved' : 'Apply changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
