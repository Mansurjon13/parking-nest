// app/spots/[id]/book/page.tsx — Booking + Stripe payment flow
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { spotsApi, bookingsApi, type Spot } from '@/lib/api';
import { Analytics } from '@/lib/analytics';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// ─── Inner form (needs Stripe context) ───────────────────────────────────────
function BookingForm({ spot }: { spot: Spot }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const hours = startsAt && endsAt
    ? Math.max(0, (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3600000)
    : 0;
  const subtotal = hours * spot.price_per_hour;
  // No markup to client — they pay the spot price directly.
  // Platform fee is deducted from host payout on the backend.
  const clientPays = subtotal;

  useEffect(() => {
    if (spot) Analytics.bookingFormOpened(spot.id);
  }, [spot?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (!startsAt || !endsAt || hours <= 0) {
      setError('Please select valid start and end times.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Create booking + get client_secret from our API
      Analytics.bookingStarted(spot.id, hours, subtotal);
      const { booking, client_secret } = await bookingsApi.create({
        spot_id: spot.id,
        starts_at: startsAt,
        ends_at: endsAt,
      });

      // 2. Confirm payment with Stripe
      const cardEl = elements.getElement(CardElement);
      const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(client_secret, {
        payment_method: { card: cardEl! },
      });

      if (stripeErr) {
        setError(stripeErr.message || 'Payment failed');
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        Analytics.paymentCompleted(booking.id);
        setSuccess(true);
        setTimeout(() => router.push('/bookings'), 2500);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div style={successBox}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎉</div>
        <h2 style={{ fontFamily: "'Playfair Display', serif", marginBottom: '0.5rem' }}>Booking confirmed!</h2>
        <p style={{ color: '#8C8880' }}>Redirecting to your bookings…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={formCard}>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: '1.5rem', marginBottom: '1.5rem' }}>
        Reserve — {spot.title}
      </h2>

      <label style={label}>Start time</label>
      <input type="datetime-local" style={input}
        value={startsAt} onChange={e => setStartsAt(e.target.value)} required />

      <label style={label}>End time</label>
      <input type="datetime-local" style={input}
        value={endsAt} onChange={e => setEndsAt(e.target.value)} required />

      {hours > 0 && (
        <div style={priceBreakdown}>
          <div style={priceRow}>
            <span>${spot.price_per_hour}/hr × {hours.toFixed(1)}h</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div style={{ ...priceRow, color: '#2E6B4F', fontSize: '0.8rem' }}>
            <span>Platform fee (charged to host, not you)</span>
            <span>—</span>
          </div>
          <div style={{ ...priceRow, fontWeight: 500, borderTop: '1px solid #E4E0D6', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
            <span>You pay</span>
            <span>${clientPays.toFixed(2)}</span>
          </div>
        </div>
      )}

      <label style={label}>Card details</label>
      <div style={cardBox}>
        <CardElement options={{ style: { base: { fontSize: '16px', color: '#1A1A18', fontFamily: "'DM Sans', sans-serif" } } }} />
      </div>

      {error && <p style={{ color: '#A32D2D', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

      <button type="submit" disabled={loading || !stripe} style={submitBtn}>
        {loading ? 'Processing…' : `Pay $${clientPays.toFixed(2)}`}
      </button>

      <p style={{ fontSize: '0.75rem', color: '#8C8880', marginTop: '0.75rem', textAlign: 'center' }}>
        Secure payment via Stripe. The host is charged a 15% platform fee from their payout.
      </p>
    </form>
  );
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────
export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => {
    spotsApi.get(id).then(s => setSpot(s));
  }, [id]);

  if (!spot) return <div style={{ padding: '4rem', textAlign: 'center', color: '#8C8880' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: '520px', margin: '0 auto', padding: '2rem' }}>
      <Elements stripe={stripePromise}>
        <BookingForm spot={spot} />
      </Elements>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const formCard: React.CSSProperties = {
  background: 'white', borderRadius: '16px', border: '1px solid #E4E0D6', padding: '2rem',
};
const label: React.CSSProperties = {
  display: 'block', fontSize: '0.82rem', fontWeight: 500, marginBottom: '4px', color: '#1A1A18',
};
const input: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.9rem', border: '1px solid #E4E0D6', borderRadius: '8px',
  fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', marginBottom: '1rem',
  background: '#F7F4EE', outline: 'none',
};
const cardBox: React.CSSProperties = {
  border: '1px solid #E4E0D6', borderRadius: '8px', padding: '0.75rem 1rem',
  background: '#F7F4EE', marginBottom: '1rem',
};
const priceBreakdown: React.CSSProperties = {
  background: '#F7F4EE', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem',
};
const priceRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.4rem',
};
const submitBtn: React.CSSProperties = {
  width: '100%', padding: '0.85rem', background: '#D97B3A', color: 'white', border: 'none',
  borderRadius: '8px', fontFamily: "'DM Sans', sans-serif", fontSize: '0.95rem',
  fontWeight: 500, cursor: 'pointer',
};
const successBox: React.CSSProperties = {
  background: 'white', borderRadius: '16px', border: '1px solid #E4E0D6',
  padding: '3rem', textAlign: 'center',
};
