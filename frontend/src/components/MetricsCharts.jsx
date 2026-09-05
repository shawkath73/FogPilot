import { CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, Cell, Legend } from 'recharts';

const colors = { DCP: '#38bdf8', CAP: '#4ade80', CLAHE: '#fbbf24', Retinex: '#c084fc' };
export const algorithmColors = colors;

export default function MetricsCharts({ history, usage }) {
  const pie = Object.entries(usage).map(([name, value]) => ({ name, value }));
  return <div className="charts">
    <section className="panel chart"><h2>FPS over time</h2><ResponsiveContainer><LineChart data={history}><CartesianGrid stroke="#243244" /><XAxis dataKey="frame_id" /><YAxis /><Tooltip /><ReferenceLine y={30} stroke="#fb7185" strokeDasharray="5 5" /><Line dataKey="fps" stroke="#38bdf8" dot={false} /></LineChart></ResponsiveContainer></section>
    <section className="panel chart"><h2>Quality metrics</h2><ResponsiveContainer><LineChart data={history}><CartesianGrid stroke="#243244" /><XAxis dataKey="frame_id" /><YAxis /><Tooltip /><Line dataKey="fade_improvement" stroke="#4ade80" dot={false} /><Line dataKey="contrast_gain" stroke="#fbbf24" dot={false} /><Legend /></LineChart></ResponsiveContainer></section>
    <section className="panel chart"><h2>Algorithm usage</h2><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={82}>{pie.map(item => <Cell key={item.name} fill={colors[item.name]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></section>
  </div>;
}
