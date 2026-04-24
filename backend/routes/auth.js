// routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { trackEvent } = require('../middleware/analytics');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, full_name, role = 'client' } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'email, password, full_name required' });
  }
  if (!['client', 'host'].includes(role)) {
    return res.status(400).json({ error: 'role must be client or host' });
  }

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4) RETURNING id, email, full_name, role, created_at`,
      [email.toLowerCase(), hash, full_name, role]
    );
    const user = result.rows[0];
    const token = signToken(user);

    await trackEvent(req, 'user_registered', { user_id: user.id, role });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    const result = await pool.query(
      'SELECT id, email, full_name, role, password_hash FROM users WHERE email=$1',
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    const { password_hash, ...safe } = user;

    await trackEvent(req, 'user_logged_in', { user_id: user.id, role: user.role });
    res.json({ token, user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, full_name, role, avatar_url,
              stripe_account_id, stripe_account_status, created_at
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
