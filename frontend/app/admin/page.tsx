// app/admin/page.tsx — User flow + funnel analytics dashboard
'use client';
import { useEffect, useState } from 'react';
import { analyticsApi, type OverviewData, type FunnelData, type UserFlowData } from '@/lib/api';

export default function AdminDashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [flow, setFlow] = useState<UserFlowData | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    Promise.all([
      analyticsApi.overview(days).then(setOverview),
      analyticsApi.funnel(days).then(setFunnel),
      analyticsApi.userFlow(7).then(setFlow),
    ]).catch(console.error);
  }, [days]);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2rem' }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2rem' }}>Analytics dashboard</h1>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={selectStyle}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* ── Overview metrics ── */}
      {overview && (
        <>
          <h2 style={sectionTitle}>Overview</h2>
          <div style={grid4}>
            <MetricCard label="Total users" value={overview.users.total} sub={`+${overview.users.new_users} new`} />
            <MetricCard label="Hosts" value={overview.users.hosts} />
            <MetricCard label="Bookings" value={overview.bookings.total} sub={`${overview.bookings.completed} completed`} />
            <MetricCard label="Platform revenue" value={`$${parseFloat(overview.revenue.platform_revenue).toFixed(0)}`} sub="from host fees" />
          </div>

          <h2 style={sectionTitle}>Top spots</h2>
          <div style={card}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E4E0D6' }}>
                  {['Spot','City','Bookings','Revenue'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#8C8880', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.top_spots.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F0EDE6' }}>
                    <td style={td}>{s.title}</td>
                    <td style={td}>{s.city}</td>
                    <td style={td}>{s.bookings}</td>
                    <td style={td}>${parseFloat(s.revenue).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Booking funnel ── */}
      {funnel && (
        <>
          <h2 style={sectionTitle}>Booking funnel</h2>
          <div style={card}>
            {funnel.funnel.map((step, i) => (
              <div key={step.step} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{formatStep(step.step)}</span>
                  <span style={{ fontSize: '0.85rem', color: '#8C8880' }}>
                    {step.sessions.toLocaleString()} sessions
                    {i > 0 && <span style={{ color: step.conversion_from_prev < 50 ? '#A32D2D' : '#2E6B4F', marginLeft: '8px' }}>
                      {step.conversion_from_prev}%
                    </span>}
                  </span>
                </div>
                <div style={{ height: '8px', background: '#F0EDE6', borderRadius: '100px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '100px', transition: 'width 0.5s',
                    width: `${step.conversion_from_top}%`,
                    background: step.conversion_from_top > 50 ? '#2E6B4F' : step.conversion_from_top > 20 ? '#D97B3A' : '#A32D2D',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── User flow paths ── */}
      {flow && (
        <>
          <h2 style={sectionTitle}>Top user flow paths (last 7 days)</h2>
          <div style={card}>
            {flow.top_paths.slice(0, 12).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #F0EDE6', fontSize: '0.83rem' }}>
                <span style={{ color: '#4A4840', fontFamily: 'monospace', flex: 1, marginRight: '1rem' }}>
                  {p.path}
                </span>
                <span style={{ color: '#8C8880', flexShrink: 0 }}>{p.count} sessions</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Event frequency ── */}
      {overview && (
        <>
          <h2 style={sectionTitle}>Event frequency</h2>
          <div style={card}>
            {overview.top_events.map((e, i) => {
              const max = parseInt(overview.top_events[0]?.count || '1');
              const pct = (parseInt(e.count) / max) * 100;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ width: '200px', fontSize: '0.82rem', color: '#4A4840', flexShrink: 0 }}>{e.event_name}</span>
                  <div style={{ flex: 1, height: '6px', background: '#F0EDE6', borderRadius: '100px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#D97B3A', borderRadius: '100px' }} />
                  </div>
                  <span style={{ width: '60px', fontSize: '0.82rem', color: '#8C8880', textAlign: 'right' }}>{parseInt(e.count).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#F7F4EE', borderRadius: '10px', padding: '1rem 1.25rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#8C8880', fontWeight: 500, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: '#8C8880', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

function formatStep(step: string) {
  return step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' };
const card: React.CSSProperties = { background: 'white', border: '1px solid #E4E0D6', borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '2rem' };
const sectionTitle: React.CSSProperties = { fontFamily: "'Playfair Display', serif", fontSize: '1.2rem', marginBottom: '1rem', marginTop: '0.5rem' };
const selectStyle: React.CSSProperties = { border: '1px solid #E4E0D6', borderRadius: '8px', padding: '0.4rem 0.8rem', fontSize: '0.88rem', background: 'white' };
const td: React.CSSProperties = { padding: '0.6rem 0.75rem' };
