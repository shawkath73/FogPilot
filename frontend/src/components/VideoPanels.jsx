export default function VideoPanels({ frame }) {
  const panels = [
    { title: 'Raw Input',      src: frame?.raw_image },
    { title: 'Dehazed Output', src: frame?.output_image },
  ];

  return (
    <>
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
    <div className="algorithm-output-grid">
      {['DCP', 'CAP', 'CLAHE', 'Retinex'].map(algorithm => {
        const active = frame?.algorithm === algorithm;
        return (
          <div className={`algorithm-output-card${active ? ' active' : ''}`} key={algorithm}>
            <div className="algorithm-output-header">
              <span>{algorithm}</span>
              <small>{active ? 'Active route' : 'Available worker'}</small>
            </div>
            {frame?.algorithm_images?.[algorithm] ? (
              <img src={frame.algorithm_images[algorithm]} alt={`${algorithm} output`} />
            ) : (
              <div className="algorithm-output-empty">Waiting for frame</div>
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}
