export default function VideoPanels({ frame }) {
  const panels = [
    { title: 'Raw Input',      src: frame?.raw_image },
    { title: 'Dehazed Output', src: frame?.output_image },
  ];

  return (
    <div className="video-grid">
      {panels.map(({ title, src }, i) => (
        <div key={title} className={`video-card${frame?.degraded_output ? ' degraded' : ''}`}>
          <div className="video-card-header">
            <span className="video-card-title">{title}</span>
            {i === 1 && frame && (
              <span className={`algo-badge${frame.degraded_output ? ' danger' : ''}`}>
                {frame.algorithm}
              </span>
            )}
          </div>

          {src ? (
            <img src={src} alt={title} />
          ) : (
            <div className="video-empty">
              <span className="video-empty-icon">📹</span>
              No video loaded
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
