// routes/payments.js — Stripe Connect onboarding + webhooks
const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { trackEvent } = require('../middleware/analytics');

// ─── POST /api/payments/connect — host initiates Stripe Connect onboarding ───
// This creates an Express account for the host and returns an onboarding link.
// ParkNest deducts its platform fee automatically on each booking via
// application_fee_amount — the host is effectively "charged" their fee share.
router.post('/connect', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  try {
    const userRes = await pool.query(
      'SELECT stripe_account_id FROM users WHERE id=$1', [req.user.id]
    );
    let accountId = userRes.rows[0]?.stripe_account_id;

    if (!accountId) {
      // Create new Stripe Express account for host
      const account = await stripe.accounts.create({
        type: 'express',
        email: req.user.email,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { parknest_user_id: req.user.id },
      });
      accountId = account.id;

      await pool.query(
        `UPDATE users SET stripe_account_id=$1, stripe_account_status='pending', updated_at=NOW()
         WHERE id=$2`,
        [accountId, req.user.id]
      );
    }

    // Generate onboarding link (valid for 24h)
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL}/host/stripe/refresh`,
      return_url: `${process.env.FRONTEND_URL}/host/stripe/complete`,
      type: 'account_onboarding',
    });

    await trackEvent(req, 'stripe_connect_started', { host_id: req.user.id });
    res.json({ url: link.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/payments/connect/status — check host's Stripe account status ───
router.get('/connect/status', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  try {
    const userRes = await pool.query(
      'SELECT stripe_account_id, stripe_account_status FROM users WHERE id=$1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user?.stripe_account_id) return res.json({ status: 'not_started' });

    // Live-check from Stripe
    const account = await stripe.accounts.retrieve(user.stripe_account_id);
    const active = account.charges_enabled && account.payouts_enabled;
    const newStatus = active ? 'active' : 'pending';

    if (newStatus !== user.stripe_account_status) {
      await pool.query(
        'UPDATE users SET stripe_account_status=$1, updated_at=NOW() WHERE id=$2',
        [newStatus, req.user.id]
      );
    }

    if (active) await trackEvent(req, 'stripe_connect_completed', { host_id: req.user.id });
    res.json({ status: newStatus, charges_enabled: account.charges_enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/payments/host/earnings — host's earnings dashboard data ─────────
router.get('/host/earnings', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='completed') AS total_bookings,
         COALESCE(SUM(host_payout) FILTER (WHERE status='completed'), 0) AS total_earned,
         COALESCE(SUM(platform_fee) FILTER (WHERE status='completed'), 0) AS total_platform_fees,
         COALESCE(SUM(subtotal) FILTER (WHERE status='completed'), 0) AS gross_revenue
       FROM bookings WHERE host_id=$1`,
      [req.user.id]
    );

    const monthly = await pool.query(
      `SELECT
         DATE_TRUNC('month', completed_at) AS month,
         SUM(host_payout) AS earned,
         COUNT(*) AS bookings
       FROM bookings
       WHERE host_id=$1 AND status='completed' AND completed_at > NOW() - INTERVAL '12 months'
       GROUP BY 1 ORDER BY 1`,
      [req.user.id]
    );

    res.json({ summary: result.rows[0], monthly: monthly.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/payments/webhook — Stripe sends events here ───────────────────
// In production: stripe listen --forward-to localhost:4000/api/payments/webhook
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      await pool.query(
        `UPDATE bookings
         SET status='confirmed', confirmed_at=NOW(), stripe_charge_id=$1, updated_at=NOW()
         WHERE stripe_payment_intent_id=$2`,
        [pi.latest_charge, pi.id]
      );
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      await pool.query(
        `UPDATE bookings SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
         WHERE stripe_payment_intent_id=$1`,
        [pi.id]
      );
      break;
    }
    case 'account.updated': {
      // Host finished Stripe Connect onboarding
      const account = event.data.object;
      if (account.charges_enabled) {
        await pool.query(
          `UPDATE users SET stripe_account_status='active', updated_at=NOW()
           WHERE stripe_account_id=$1`,
          [account.id]
        );
      }
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
});

module.exports = router;
