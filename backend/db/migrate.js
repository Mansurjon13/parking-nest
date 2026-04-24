// db/migrate.js — Run once: node db/migrate.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Users ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name     VARCHAR(255) NOT NULL,
        role          VARCHAR(20) NOT NULL DEFAULT 'client'
                        CHECK (role IN ('client', 'host', 'admin')),
        avatar_url    TEXT,

        -- Stripe Connect: hosts must connect their Stripe account so ParkNest
        -- can charge them (deduct platform fee) and pay them out automatically
        stripe_account_id         VARCHAR(255),   -- Stripe Connect account ID
        stripe_account_status     VARCHAR(50),    -- pending | active | restricted
        stripe_customer_id        VARCHAR(255),   -- for hosts paying subscription (optional)

        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Spots ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS spots (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        host_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           VARCHAR(255) NOT NULL,
        description     TEXT,
        address         VARCHAR(500) NOT NULL,
        city            VARCHAR(100) NOT NULL,
        lat             DECIMAL(9,6),
        lng             DECIMAL(9,6),
        spot_type       VARCHAR(50) NOT NULL
                          CHECK (spot_type IN ('driveway','garage','carport','lot')),
        price_per_hour  DECIMAL(8,2) NOT NULL,
        amenities       TEXT[] DEFAULT '{}',
        images          TEXT[] DEFAULT '{}',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        available_from  TIME NOT NULL DEFAULT '07:00',
        available_until TIME NOT NULL DEFAULT '22:00',
        avg_rating      DECIMAL(3,2) DEFAULT 0,
        total_reviews   INT DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_spots_host ON spots(host_id);
      CREATE INDEX IF NOT EXISTS idx_spots_city ON spots(city);
      CREATE INDEX IF NOT EXISTS idx_spots_active ON spots(is_active);
    `);

    // ── Bookings ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_id         UUID NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
        client_id       UUID NOT NULL REFERENCES users(id),
        host_id         UUID NOT NULL REFERENCES users(id),

        starts_at       TIMESTAMPTZ NOT NULL,
        ends_at         TIMESTAMPTZ NOT NULL,
        total_hours     DECIMAL(6,2) NOT NULL,

        -- Pricing (stored at time of booking, immune to future price changes)
        price_per_hour  DECIMAL(8,2) NOT NULL,
        subtotal        DECIMAL(10,2) NOT NULL,   -- price_per_hour × hours
        platform_fee    DECIMAL(10,2) NOT NULL,   -- 15% deducted from host payout
        host_payout     DECIMAL(10,2) NOT NULL,   -- subtotal - platform_fee

        -- Client pays nothing extra — full amount goes to host, platform fee deducted
        client_pays     DECIMAL(10,2) NOT NULL,   -- = subtotal (no markup to client)

        status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending','confirmed','active','completed','cancelled','refunded'
                          )),

        -- Stripe
        stripe_payment_intent_id  VARCHAR(255),
        stripe_transfer_id        VARCHAR(255),   -- transfer to host after completion
        stripe_charge_id          VARCHAR(255),

        -- Access
        access_code     VARCHAR(20),
        notes           TEXT,

        confirmed_at    TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        cancelled_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_host ON bookings(host_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_spot ON bookings(spot_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    `);

    // ── Reviews ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id  UUID UNIQUE NOT NULL REFERENCES bookings(id),
        spot_id     UUID NOT NULL REFERENCES spots(id),
        reviewer_id UUID NOT NULL REFERENCES users(id),
        rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_spot ON reviews(spot_id);
    `);

    // ── Host Payouts ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS host_payouts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        host_id             UUID NOT NULL REFERENCES users(id),
        booking_id          UUID NOT NULL REFERENCES bookings(id),
        amount              DECIMAL(10,2) NOT NULL,
        platform_fee        DECIMAL(10,2) NOT NULL,
        stripe_transfer_id  VARCHAR(255),
        status              VARCHAR(30) NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','paid','failed')),
        paid_at             TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_payouts_host ON host_payouts(host_id);
    `);

    // ── Analytics Events — user flow tracking ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id            BIGSERIAL PRIMARY KEY,
        session_id    VARCHAR(255) NOT NULL,       -- anonymous session ID from frontend
        user_id       UUID REFERENCES users(id),   -- null if not logged in
        event_name    VARCHAR(100) NOT NULL,        -- e.g. 'spot_viewed', 'booking_started'
        properties    JSONB DEFAULT '{}',           -- arbitrary event metadata
        page          VARCHAR(255),                 -- current page/route
        referrer      VARCHAR(500),
        user_agent    VARCHAR(500),
        ip_address    INET,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON analytics_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_user ON analytics_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(event_name);
      CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at DESC);
    `);

    // ── Funnel snapshots (materialized view rebuilt nightly) ──────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS funnel_snapshots (
        id            BIGSERIAL PRIMARY KEY,
        date          DATE NOT NULL,
        funnel_step   VARCHAR(100) NOT NULL,
        count         INT NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_date_step
        ON funnel_snapshots(date, funnel_step);
    `);

    await client.query('COMMIT');
    console.log('✅  Migration complete — all tables created.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
