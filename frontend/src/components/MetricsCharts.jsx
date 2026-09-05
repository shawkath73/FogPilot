import {
  CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, BarChart, Bar,
  Tooltip, XAxis, YAxis,
} from 'recharts';

const COLORS = {
  DCP:     '#2dd4bf',
  CAP:     '#818cf8',
  CLAHE:   '#fb923c',
  Retinex: '#f472b6',
};

export const algorithmColors = COLORS;

const TICK  = { fill: '#4b5675', fontSize: 10, fontFamily: "'JetBrains Mono', monospace" };
const GRID  = 'rgba(255,255,255,0.04)';
const TIP   = {
  backgroundColor: '#0f1117',
  border: '1px solid #2a3045',
  borderRadius: 8,
  color: '#f1f5f9',
  fontSize: 11,
};

export default function MetricsCharts({ history, usage }) {
  const pie = Object.entries(usage).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));

  return (
    <>
      <div className="chart-card">
        <div className="chart-card-header">FPS over time</div>
        <div className="chart-card-body">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis dataKey="frame_id" tick={TICK} />
              <YAxis tick={TICK} />
              <Tooltip contentStyle={TIP} cursor={{ fill: 'rgba(45,212,191,.05)' }} />
              <ReferenceLine y={30} stroke="#f87171" strokeDasharray="4 4" strokeWidth={1.5} />
              <Line dataKey="fps" stroke={COLORS.DCP} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-card-header">Quality metrics</div>
        <div className="chart-card-body">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={GRID} />
              <XAxis dataKey="frame_id" tick={TICK} />
              <YAxis tick={TICK} />
              <Tooltip contentStyle={TIP} cursor={{ fill: 'rgba(45,212,191,.05)' }} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#4b5675' }} />
              <Line dataKey="fade_improvement" stroke={COLORS.CAP}     strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line dataKey="contrast_gain"    stroke={COLORS.Retinex} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-card-header">Algorithm usage</div>
        <div className="chart-card-body">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="70%" paddingAngle={3} strokeWidth={0}>
                {pie.map(item => <Cell key={item.name} fill={COLORS[item.name] || '#818cf8'} />)}
              </Pie>
              <Tooltip contentStyle={TIP} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#4b5675' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

        <div className="chart-card">
          <div className="chart-card-header">Routing map</div>
          <div className="chart-card-body">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={Object.entries(usage).map(([name, value]) => ({ name, value }))} layout="vertical" margin={{ top: 4, right: 12, left: 2, bottom: 0 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={TICK} width={52} />
                <Tooltip contentStyle={TIP} />
                <Bar dataKey="value" radius={[0, 5, 5, 0]}>
                  {Object.keys(usage).map(name => <Cell key={name} fill={COLORS[name]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
    </>
  );
}
