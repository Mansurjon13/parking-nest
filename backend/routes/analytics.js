// routes/analytics.js — user flow & funnel reporting
const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { trackEvent } = require('../middleware/analytics');

// ─── POST /api/analytics/event — frontend tracks client-side events ───────────
// e.g. page_view, spot_card_clicked, search_performed, booking_form_opened
router.post('/event', async (req, res) => {
  const { session_id, event_name, properties = {}, page } = req.body;
  if (!session_id || !event_name) {
    return res.status(400).json({ error: 'session_id and event_name required' });
  }

  try {
    const userId = req.user?.id || null;
    await pool.query(
      `INSERT INTO analytics_events
         (session_id, user_id, event_name, properties, page, referrer, user_agent, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        session_id, userId, event_name, JSON.stringify(properties),
        page, req.headers['referer'] || null,
        req.headers['user-agent'] || null,
        req.ip || null,
      ]
    );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/analytics/funnel — booking conversion funnel ───────────────────
// Admin only — shows drop-off at each step
router.get('/funnel', requireAuth, requireRole('admin'), async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const funnelSteps = [
      'page_view',
      'spots_searched',
      'spot_viewed',
      'booking_form_opened',
      'booking_created',
      'booking_confirmed', // payment succeeded
    ];

    const result = await pool.query(
      `SELECT event_name, COUNT(DISTINCT session_id) AS sessions
       FROM analytics_events
       WHERE event_name = ANY($1)
         AND created_at > NOW() - ($2 || ' days')::INTERVAL
       GROUP BY event_name`,
      [funnelSteps, days]
    );

    const byName = Object.fromEntries(result.rows.map(r => [r.event_name, parseInt(r.sessions)]));
    const funnel = funnelSteps.map((step, i) => {
      const count = byName[step] || 0;
      const prev = i === 0 ? count : (byName[funnelSteps[i - 1]] || 1);
      return {
        step,
        sessions: count,
        conversion_from_prev: i === 0 ? 100 : parseFloat(((count / prev) * 100).toFixed(1)),
        conversion_from_top: i === 0 ? 100 : parseFloat(((count / (byName[funnelSteps[0]] || 1)) * 100).toFixed(1)),
      };
    });

    res.json({ days: parseInt(days), funnel });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/analytics/overview — general stats for admin dashboard ──────────
router.get('/overview', requireAuth, requireRole('admin'), async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const [users, bookings, revenue, topSpots, topEvents] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE role='host') AS hosts,
                COUNT(*) FILTER (WHERE role='client') AS clients,
                COUNT(*) FILTER (WHERE created_at > NOW() - ($1||' days')::INTERVAL) AS new_users
         FROM users`, [days]
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status='completed') AS completed,
                COUNT(*) FILTER (WHERE status='cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE created_at > NOW() - ($1||' days')::INTERVAL) AS recent
         FROM bookings`, [days]
      ),
      pool.query(
        `SELECT COALESCE(SUM(subtotal),0) AS gross,
                COALESCE(SUM(platform_fee),0) AS platform_revenue,
                COALESCE(SUM(host_payout),0) AS host_payouts
         FROM bookings WHERE status='completed'`
      ),
      pool.query(
        `SELECT s.title, s.city, COUNT(b.id) AS bookings, SUM(b.host_payout) AS revenue
         FROM spots s JOIN bookings b ON b.spot_id=s.id
         WHERE b.status='completed'
         GROUP BY s.id ORDER BY bookings DESC LIMIT 5`
      ),
      pool.query(
        `SELECT event_name, COUNT(*) AS count
         FROM analytics_events
         WHERE created_at > NOW() - ($1||' days')::INTERVAL
         GROUP BY event_name ORDER BY count DESC LIMIT 15`, [days]
      ),
    ]);

    res.json({
      users: users.rows[0],
      bookings: bookings.rows[0],
      revenue: revenue.rows[0],
      top_spots: topSpots.rows,
      top_events: topEvents.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/analytics/user-flow — session-level flow paths ─────────────────
router.get('/user-flow', requireAuth, requireRole('admin'), async (req, res) => {
  const { days = 7 } = req.query;
  try {
    // Most common event sequences per session
    const result = await pool.query(
      `SELECT session_id,
              array_agg(event_name ORDER BY created_at) AS flow,
              COUNT(*) AS event_count,
              MAX(user_id) AS user_id
       FROM analytics_events
       WHERE created_at > NOW() - ($1||' days')::INTERVAL
       GROUP BY session_id
       ORDER BY event_count DESC
       LIMIT 100`,
      [days]
    );

    // Aggregate common paths
    const pathCounts = {};
    result.rows.forEach(row => {
      const path = row.flow.slice(0, 6).join(' → ');
      pathCounts[path] = (pathCounts[path] || 0) + 1;
    });

    const paths = Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, count]) => ({ path, count }));

    res.json({ days: parseInt(days), top_paths: paths, sample_sessions: result.rows.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
