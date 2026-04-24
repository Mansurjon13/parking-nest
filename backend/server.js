// server.js — ParkNest API server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { pageviewMiddleware } = require('./middleware/analytics');
const { optionalAuth } = require('./middleware/auth');

const authRoutes     = require('./routes/auth');
const spotsRoutes    = require('./routes/spots');
const bookingsRoutes = require('./routes/bookings');
const paymentsRoutes = require('./routes/payments');
const analyticsRoutes = require('./routes/analytics');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// ── Stripe webhook needs raw body ─────────────────────────────────────────────
app.use('/api/payments/webhook',
  express.raw({ type: 'application/json' })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
}));

// Stricter limit on auth endpoints
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts.' },
}));

// ── Analytics tracking (auto-tracks all API calls) ───────────────────────────
app.use(optionalAuth);
app.use(pageviewMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/spots',     spotsRoutes);
app.use('/api/bookings',  bookingsRoutes);
app.use('/api/payments',  paymentsRoutes);
app.use('/api/analytics', analyticsRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚗  ParkNest API running on http://localhost:${PORT}`);
  console.log(`    ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`    DB:  ${process.env.DATABASE_URL?.split('@')[1] || 'not set'}`);
});

module.exports = app;
