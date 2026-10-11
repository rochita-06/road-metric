import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Segment, Summary } from './App'

const chartColors = {
  Low: '#4ea96d',
  Moderate: '#d9a63d',
  High: '#d85d5d',
}

export default function AnalyticsPage({ segments, summary }: { segments: Segment[]; summary: Summary }) {
  const volumeData = segments.map((segment) => ({
    corridor: segment.name,
    volume: segment.traffic_volume,
    speed: segment.avg_speed_kmh,
    queue: segment.queue_length,
  }))
  const congestionData = (['Low', 'Moderate', 'High'] as const).map((status) => ({
    status,
    segments: segments.filter((segment) => segment.status.toLowerCase() === status.toLowerCase()).length,
  })).filter((item) => item.segments > 0)
  const queueTotal = segments.reduce((total, segment) => total + segment.queue_length, 0)
  const volumeTotal = segments.reduce((total, segment) => total + segment.traffic_volume, 0)
  const averageSpeed = segments.length
    ? segments.reduce((total, segment) => total + segment.avg_speed_kmh, 0) / segments.length
    : 0

  return (
    <main className="analytics-page panel full-width-panel">
      <div className="analytics-heading">
        <div>
          <p className="eyebrow">Traffic intelligence · Hyderabad</p>
          <h2>Network analytics</h2>
          <p className="analytics-subtitle">Comparisons calculated from the currently monitored corridor data.</p>
        </div>
        <span className="analytics-source">{summary.data_source} · {segments.length} corridors</span>
      </div>

      <section className="analytics-kpis" aria-label="Network metrics">
        <article className="analytics-kpi"><span>Total estimated flow</span><strong>{volumeTotal.toLocaleString()} <small>veh/h</small></strong></article>
        <article className="analytics-kpi"><span>Mean corridor speed</span><strong>{averageSpeed.toFixed(1)} <small>km/h</small></strong></article>
        <article className="analytics-kpi"><span>Vehicles in queues</span><strong>{queueTotal.toLocaleString()} <small>vehicles</small></strong></article>
        <article className="analytics-kpi"><span>Monitored segments</span><strong>{segments.length}</strong></article>
      </section>

      <section className="analytics-charts">
        <article className="panel analytics-chart-card analytics-volume-card">
          <div className="panel-header compact"><div><p className="eyebrow">Demand</p><h3>Traffic volume by corridor</h3></div></div>
          <div className="analytics-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeData} margin={{ top: 8, right: 12, left: 2, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e8e4" />
                <XAxis dataKey="corridor" tick={{ fill: '#59656e', fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={56} />
                <YAxis tick={{ fill: '#59656e', fontSize: 11 }} />
                <Tooltip formatter={(value) => [`${Number(value).toLocaleString()} veh/h`, 'Flow']} />
                <Bar dataKey="volume" name="Flow" fill="#267a91" radius={[7, 7, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel analytics-chart-card">
          <div className="panel-header compact"><div><p className="eyebrow">Mobility</p><h3>Speed and queue by corridor</h3></div></div>
          <div className="analytics-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={volumeData} margin={{ top: 8, right: 6, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e8e4" />
                <XAxis dataKey="corridor" tick={{ fill: '#59656e', fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={56} />
                <YAxis yAxisId="speed" tick={{ fill: '#59656e', fontSize: 11 }} />
                <YAxis yAxisId="queue" orientation="right" tick={{ fill: '#59656e', fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="queue" dataKey="queue" name="Queue (vehicles)" fill="#e7ae4b" radius={[6, 6, 0, 0]} />
                <Line yAxisId="speed" dataKey="speed" name="Speed (km/h)" stroke="#315d9a" strokeWidth={3} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel analytics-chart-card analytics-status-card">
          <div className="panel-header compact"><div><p className="eyebrow">Congestion</p><h3>Corridors by traffic state</h3></div></div>
          <div className="analytics-chart status-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={congestionData} dataKey="segments" nameKey="status" cx="50%" cy="48%" innerRadius={58} outerRadius={92} paddingAngle={4}>
                  {congestionData.map((item) => <Cell key={item.status} fill={chartColors[item.status as keyof typeof chartColors]} />)}
                </Pie>
                <Tooltip formatter={(value) => [`${value} corridors`, 'Segments']} />
                <Legend formatter={(name) => `${name} · ${congestionData.find((item) => item.status === name)?.segments ?? 0}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="chart-footnote">Distribution is by monitored corridor count, not citywide vehicle share.</p>
        </article>
      </section>
    </main>
  )
}
