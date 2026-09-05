import { algorithmColors } from './MetricsCharts';

export default function EscalationLog({ items }) {
  return <section className="panel"><h2>Critic escalation log</h2><div className="log">{items.length ? items.map((item, index) => <div className="log-item" style={{ borderColor: algorithmColors[item.algorithm] || '#fb7185' }} key={`${item.frame_id}-${index}`}><b>Frame {item.frame_id}</b> · next: {item.algorithm}<small>{item.reason}</small></div>) : <span className="muted">No escalations recorded.</span>}</div></section>;
}
