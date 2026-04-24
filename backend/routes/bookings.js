// routes/bookings.js
const router = require('express').Router();
const pool = require('../db/pool');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth, requireRole } = require('../middleware/auth');
const { trackEvent } = require('../middleware/analytics');
const { v4: uuidv4 } = require('uuid');

const PLATFORM_FEE_PCT = parseFloat(process.env.STRIPE_PLATFORM_FEE_PERCENT || 15) / 100;

// ─── Helper: generate random access code ─────────────────────────────────────
function accessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── POST /api/bookings — client creates a booking & payment intent ───────────
// NOTE: Client pays for the parking. Stripe routes payment to host's Connect account
//       automatically, deducting the platform fee before transfer. The HOST effectively
//       "pays" the platform fee out of their earnings — clients are not charged extra.
router.post('/', requireAuth, requireRole('client', 'admin'), async (req, res) => {
  const { spot_id, starts_at, ends_at } = req.body;
  if (!spot_id || !starts_at || !ends_at) {
    return res.status(400).json({ error: 'spot_id, starts_at, ends_at required' });
  }

  const start = new Date(starts_at);
  const end = new Date(ends_at);
  if (end <= start) return res.status(400).json({ error: 'ends_at must be after starts_at' });

  try {
    // Fetch spot + host Stripe account
    const spotRes = await pool.query(
      `SELECT s.*, u.stripe_account_id, u.stripe_account_status
       FROM spots s JOIN users u ON u.id = s.host_id
       WHERE s.id=$1 AND s.is_active=TRUE`,
      [spot_id]
    );
    if (!spotRes.rows.length) return res.status(404).json({ error: 'Spot not found or inactive' });
    const spot = spotRes.rows[0];

    if (spot.stripe_account_status !== 'active') {
      return res.status(400).json({ error: 'Host has not completed Stripe setup yet' });
    }

    // Conflict check — no overlapping confirmed/active bookings
    const conflict = await pool.query(
      `SELECT id FROM bookings
       WHERE spot_id=$1 AND status IN ('confirmed','active')
         AND tstzrange(starts_at, ends_at) && tstzrange($2::timestamptz, $3::timestamptz)`,
      [spot_id, starts_at, ends_at]
    );
    if (conflict.rows.length) {
      return res.status(409).json({ error: 'Spot is already booked for this time range' });
    }

    // Pricing
    const totalHours = (end - start) / 3600000;
    const subtotal = parseFloat((totalHours * spot.price_per_hour).toFixed(2));
    const platformFee = parseFloat((subtotal * PLATFORM_FEE_PCT).toFixed(2));
    const hostPayout = parseFloat((subtotal - platformFee).toFixed(2));
    const clientPays = subtotal; // Client pays full subtotal; platform fee deducted from host side

    // Stripe PaymentIntent — destination charge to host's Connect account
    // application_fee_amount is deducted from host payout automatically
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(clientPays * 100), // cents
      currency: 'usd',
      payment_method_types: ['card'],
      transfer_data: {
        destination: spot.stripe_account_id,
      },
      application_fee_amount: Math.round(platformFee * 100),
      metadata: {
        spot_id,
        client_id: req.user.id,
        host_id: spot.host_id,
        starts_at,
        ends_at,
      },
    });

    // Create booking record
    const booking = await pool.query(
      `INSERT INTO bookings
         (spot_id, client_id, host_id, starts_at, ends_at, total_hours,
          price_per_hour, subtotal, platform_fee, host_payout, client_pays,
          status, stripe_payment_intent_id, access_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13)
       RETURNING *`,
      [spot_id, req.user.id, spot.host_id, starts_at, ends_at, totalHours,
       spot.price_per_hour, subtotal, platformFee, hostPayout, clientPays,
       paymentIntent.id, accessCode()]
    );

    await trackEvent(req, 'booking_created', {
      booking_id: booking.rows[0].id,
      spot_id, total_hours: totalHours, subtotal, platform_fee: platformFee,
    });

    res.status(201).json({
      booking: booking.rows[0],
      client_secret: paymentIntent.client_secret, // send to frontend for Stripe.js
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ─── GET /api/bookings — client's own bookings ────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query;
  const conditions = ['b.client_id=$1'];
  const params = [req.user.id];

  if (status) { params.push(status); conditions.push(`b.status=$${params.length}`); }
  params.push(Number(limit), Number(offset));

  try {
    const result = await pool.query(
      `SELECT b.*, s.title AS spot_title, s.address AS spot_address,
              s.city AS spot_city, s.images AS spot_images
       FROM bookings b JOIN spots s ON s.id=b.spot_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY b.starts_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/bookings/:id ────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, s.title AS spot_title, s.address, s.city,
              u_host.full_name AS host_name
       FROM bookings b
       JOIN spots s ON s.id=b.spot_id
       JOIN users u_host ON u_host.id=b.host_id
       WHERE b.id=$1 AND (b.client_id=$2 OR b.host_id=$2 OR $3='admin')`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Booking not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/bookings/:id/cancel ──────────────────────────────────────────
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const booking = await pool.query(
      `SELECT * FROM bookings WHERE id=$1 AND (client_id=$2 OR $3='admin')`,
      [req.params.id, req.user.id, req.user.role]
    );
    if (!booking.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = booking.rows[0];

    if (!['pending','confirmed'].includes(b.status)) {
      return res.status(400).json({ error: `Cannot cancel a ${b.status} booking` });
    }

    // Refund via Stripe
    if (b.stripe_payment_intent_id && b.stripe_charge_id) {
      await stripe.refunds.create({ charge: b.stripe_charge_id });
    }

    await pool.query(
      `UPDATE bookings SET status='cancelled', cancelled_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [b.id]
    );

    await trackEvent(req, 'booking_cancelled', { booking_id: b.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Host: GET /api/bookings/host/requests ────────────────────────────────────
router.get('/host/requests', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, s.title AS spot_title, u.full_name AS client_name, u.email AS client_email
       FROM bookings b
       JOIN spots s ON s.id=b.spot_id
       JOIN users u ON u.id=b.client_id
       WHERE b.host_id=$1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Host: PATCH /api/bookings/:id/complete — mark stay as done, trigger payout
router.patch('/:id/complete', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  try {
    const booking = await pool.query(
      `SELECT * FROM bookings WHERE id=$1 AND host_id=$2 AND status='active'`,
      [req.params.id, req.user.id]
    );
    if (!booking.rows.length) return res.status(404).json({ error: 'Active booking not found' });
    const b = booking.rows[0];

    await pool.query(
      `UPDATE bookings SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [b.id]
    );

    // Record payout (transfer happens automatically via Stripe Connect destination charges)
    await pool.query(
      `INSERT INTO host_payouts (host_id, booking_id, amount, platform_fee, status)
       VALUES ($1,$2,$3,$4,'paid')`,
      [b.host_id, b.id, b.host_payout, b.platform_fee]
    );

    await trackEvent(req, 'booking_completed', {
      booking_id: b.id, host_payout: b.host_payout, platform_fee: b.platform_fee,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
