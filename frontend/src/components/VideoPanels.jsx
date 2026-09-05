export default function VideoPanels({ frame }) {
  const panels = [['Raw Input', frame?.raw_image], ['Dehazed Output', frame?.output_image]];
  return <div className="video-grid">{panels.map(([title, image], index) => (
    <section className={`panel video-panel ${frame?.degraded_output ? 'degraded' : ''}`} key={title}>
      <h2>{title}</h2>
      {image ? <img src={image} alt={title} /> : <div className="empty">No video loaded</div>}
      {index === 1 && frame && <span className="algorithm-badge">{frame.algorithm} — {frame.reason}</span>}
    </section>
  ))}</div>;
}
