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
  const [cfg, setCfg]       = useState({ ...DEFAULT });
  const [status, setStatus] = useState({ type: '', message: '' });
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    setSaving(true);
    setStatus({ type: '', message: '' });
    try {
      const response = await fetch(apiUrl('/api/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(result.detail)
          ? result.detail.map(item => item.msg).join(', ')
          : result.detail;
        throw new Error(detail || 'The backend rejected these settings.');
      }
      setStatus({ type: 'success', message: 'Applied to the live stream' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not update configuration.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-card">
      <button
        className="config-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span>Configuration / tuning <small className="config-help">Change routing thresholds without restarting</small></span>
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
                onChange={e => setCfg(current => ({ ...current, [key]: Number(e.target.value) }))}
              />
            </div>
          ))}

          <div>
            <button
              className={`btn btn-teal`}
              onClick={apply}
              disabled={saving || Object.values(cfg).some(value => !Number.isFinite(value))}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {saving ? 'Applying…' : 'Apply changes'}
            </button>
          </div>
          {status.message && <div className={`config-status ${status.type}`}><i className={`status-icon ${status.type}`} aria-hidden="true" />{status.message}</div>}
        </div>
      )}
    </div>
  );
}
