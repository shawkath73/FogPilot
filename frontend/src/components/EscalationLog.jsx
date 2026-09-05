import { algorithmColors } from './MetricsCharts';

export default function EscalationLog({ items }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Escalation log</span>
        {items.length > 0 && (
          <span className="algo-badge danger">{items.length} event{items.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="card-body" style={{ padding: '14px 16px' }}>
        {items.length ? (
          <div className="log-list">
            {items.map((item, idx) => (
              <div
                key={`${item.frame_id}-${idx}`}
                className="log-row"
                style={{ borderLeftColor: algorithmColors[item.algorithm] || '#f87171' }}
              >
                <div className="log-row-top">
                  <span className="log-frame">Frame #{item.frame_id}</span>
                  <span className="log-tag">{item.algorithm}</span>
                </div>
                <p className="log-reason">{item.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="log-empty">
            <span className="log-empty-icon">✓</span>
            No escalations recorded
          </div>
        )}
      </div>
    </div>
  );
}
