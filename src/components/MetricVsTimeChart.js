import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="metric-vs-time-tooltip">
      <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ margin: 0 }}>{p.name}: <strong>{Number(p.value).toLocaleString()}</strong></p>
      ))}
    </div>
  );
}

export default function MetricVsTimeChart({ data, metric, title, onEnlarge }) {
  if (!data?.length) return null;
  const formatted = data.map((d) => ({
    ...d,
    shortDate: d.fullDate ? new Date(d.fullDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }) : d.name,
  }));
  return (
    <div className="metric-vs-time-wrap">
      <p className="metric-vs-time-title">{title || `${metric} vs Time`}</p>
      <div className="metric-vs-time-chart" role="button" tabIndex={0} onClick={onEnlarge} onKeyDown={(e) => e.key === 'Enter' && onEnlarge?.()}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={formatted} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
            <XAxis dataKey="shortDate" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} axisLine={false} tickLine={false} width={55} tickFormatter={(v) => Number(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="value" name={metric} stroke="#818cf8" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {onEnlarge && <button type="button" className="metric-vs-time-enlarge-btn" onClick={(e) => { e.stopPropagation(); onEnlarge(); }}>Enlarge · Download</button>}
    </div>
  );
}
