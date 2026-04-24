// routes/spots.js
const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { trackEvent } = require('../middleware/analytics');

// GET /api/spots — public listing with search/filter
router.get('/', optionalAuth, async (req, res) => {
  const { city, min_price, max_price, spot_type, limit = 20, offset = 0 } = req.query;

  const conditions = ['s.is_active = TRUE'];
  const params = [];

  if (city) {
    params.push(`%${city}%`);
    conditions.push(`s.city ILIKE $${params.length}`);
  }
  if (min_price) { params.push(min_price); conditions.push(`s.price_per_hour >= $${params.length}`); }
  if (max_price) { params.push(max_price); conditions.push(`s.price_per_hour <= $${params.length}`); }
  if (spot_type) { params.push(spot_type); conditions.push(`s.spot_type = $${params.length}`); }

  params.push(Number(limit), Number(offset));
  const where = conditions.join(' AND ');

  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name AS host_name, u.avatar_url AS host_avatar
       FROM spots s
       JOIN users u ON u.id = s.host_id
       WHERE ${where}
       ORDER BY s.avg_rating DESC, s.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const count = await pool.query(
      `SELECT COUNT(*) FROM spots s WHERE ${where}`,
      params.slice(0, -2)
    );

    await trackEvent(req, 'spots_searched', { city, min_price, max_price, spot_type, results: result.rows.length });
    res.json({ spots: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/spots/:id — spot detail
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name AS host_name, u.avatar_url AS host_avatar,
              u.stripe_account_status
       FROM spots s
       JOIN users u ON u.id = s.host_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Spot not found' });

    const reviews = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.spot_id = $1
       ORDER BY r.created_at DESC LIMIT 10`,
      [req.params.id]
    );

    await trackEvent(req, 'spot_viewed', { spot_id: req.params.id });
    res.json({ ...result.rows[0], reviews: reviews.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/spots — host creates a spot
router.post('/', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  const {
    title, description, address, city, lat, lng,
    spot_type, price_per_hour, amenities = [], images = [],
    available_from = '07:00', available_until = '22:00',
  } = req.body;

  if (!title || !address || !city || !spot_type || !price_per_hour) {
    return res.status(400).json({ error: 'title, address, city, spot_type, price_per_hour required' });
  }

  // Hosts must have connected Stripe before listing
  const hostCheck = await pool.query(
    'SELECT stripe_account_status FROM users WHERE id=$1', [req.user.id]
  );
  if (hostCheck.rows[0]?.stripe_account_status !== 'active') {
    return res.status(403).json({
      error: 'You must connect your Stripe account before listing a spot.',
      stripe_required: true,
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO spots
         (host_id, title, description, address, city, lat, lng,
          spot_type, price_per_hour, amenities, images, available_from, available_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.user.id, title, description, address, city, lat, lng,
       spot_type, price_per_hour, amenities, images, available_from, available_until]
    );

    await trackEvent(req, 'spot_created', { spot_id: result.rows[0].id, city, spot_type, price_per_hour });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/spots/:id — host updates their spot
router.patch('/:id', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  const allowed = ['title','description','address','city','lat','lng',
                   'spot_type','price_per_hour','amenities','images',
                   'is_active','available_from','available_until'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.params.id, ...updates.map(([, v]) => v)];

  try {
    const result = await pool.query(
      `UPDATE spots SET ${setClauses}, updated_at=NOW()
       WHERE id=$1 AND host_id=$${updates.length + 2}
       RETURNING *`,
      [...values, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Spot not found or not yours' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/spots/host/mine — host sees their own spots
router.get('/host/mine', requireAuth, requireRole('host', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*,
         (SELECT COUNT(*) FROM bookings b WHERE b.spot_id=s.id AND b.status='completed') AS total_bookings,
         (SELECT COALESCE(SUM(b.host_payout),0) FROM bookings b WHERE b.spot_id=s.id AND b.status='completed') AS total_earned
       FROM spots s WHERE s.host_id=$1 ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
