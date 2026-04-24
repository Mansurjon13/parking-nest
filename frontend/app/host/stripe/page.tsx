// app/host/stripe/page.tsx — Host connects Stripe account
'use client';
import { useEffect, useState } from 'react';
import { paymentsApi } from '@/lib/api';
import { Analytics } from '@/lib/analytics';

export default function HostStripePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    paymentsApi.connectStatus().then(r => setStatus(r.status)).catch(() => setStatus('not_started'));
  }, []);

  async function startConnect() {
    setLoading(true);
    try {
      Analytics.stripeConnectStarted();
      const { url } = await paymentsApi.connectStripe();
      window.location.href = url; // Redirect to Stripe hosted onboarding
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '540px', margin: '4rem auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '2rem', marginBottom: '0.5rem' }}>
        Connect your bank account
      </h1>
      <p style={{ color: '#8C8880', marginBottom: '2rem' }}>
        ParkNest uses Stripe to pay you instantly when a booking completes.
        A 15% platform fee is deducted from each booking's payout — clients are not charged extra.
      </p>

      <div style={infoCard}>
        <div style={infoRow}>
          <span style={dot('green')} />
          <span>Clients pay the spot price, nothing extra</span>
        </div>
        <div style={infoRow}>
          <span style={dot('orange')} />
          <span>15% platform fee deducted from <b>your</b> payout</span>
        </div>
        <div style={infoRow}>
          <span style={dot('green')} />
          <span>Payouts sent automatically after booking completion</span>
        </div>
        <div style={infoRow}>
          <span style={dot('green')} />
          <span>Powered by Stripe — bank-level security</span>
        </div>
      </div>

      {status === 'active' ? (
        <div style={successBanner}>
          ✅ Your Stripe account is connected and active. You're ready to accept bookings.
        </div>
      ) : status === 'pending' ? (
        <div>
          <div style={warningBanner}>
            ⏳ Your Stripe account is pending. Complete the onboarding to activate payouts.
          </div>
          <button onClick={startConnect} disabled={loading} style={btn}>
            {loading ? 'Redirecting…' : 'Resume Stripe onboarding →'}
          </button>
        </div>
      ) : (
        <button onClick={startConnect} disabled={loading} style={btn}>
          {loading ? 'Redirecting to Stripe…' : 'Connect with Stripe →'}
        </button>
      )}
    </div>
  );
}

const infoCard: React.CSSProperties = {
  background: 'white', borderRadius: '12px', border: '1px solid #E4E0D6',
  padding: '1.25rem 1.5rem', marginBottom: '1.5rem',
};
const infoRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  fontSize: '0.9rem', marginBottom: '0.6rem',
};
const dot = (color: 'green' | 'orange'): React.CSSProperties => ({
  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
  background: color === 'green' ? '#2E6B4F' : '#D97B3A',
});
const btn: React.CSSProperties = {
  width: '100%', padding: '0.9rem', background: '#D97B3A', color: 'white',
  border: 'none', borderRadius: '10px', fontFamily: "'DM Sans', sans-serif",
  fontSize: '1rem', fontWeight: 500, cursor: 'pointer',
};
const successBanner: React.CSSProperties = {
  background: '#E3F0E9', color: '#2E6B4F', borderRadius: '10px',
  padding: '1rem 1.25rem', fontSize: '0.9rem', fontWeight: 500,
};
const warningBanner: React.CSSProperties = {
  background: '#F5EAD8', color: '#D97B3A', borderRadius: '10px',
  padding: '1rem 1.25rem', fontSize: '0.9rem', marginBottom: '1rem',
};
