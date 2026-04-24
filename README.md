# ParkNest — Full Stack Parking Marketplace

**Airbnb for parking spots.** Clients find and book spots for free. Hosts list their driveways/garages and are charged a 15% platform fee from their payout.

---

## Architecture

```
parknest/
├── backend/          Node.js + Express API
│   ├── server.js     Entry point
│   ├── db/
│   │   ├── pool.js   PostgreSQL connection pool
│   │   └── migrate.js  All table definitions
│   ├── middleware/
│   │   ├── auth.js   JWT verification
│   │   └── analytics.js  Auto event tracking
│   └── routes/
│       ├── auth.js       Register / login / me
│       ├── spots.js      CRUD for parking spots
│       ├── bookings.js   Create / cancel / complete bookings
│       ├── payments.js   Stripe Connect + webhooks
│       └── analytics.js  Funnel & user flow queries
│
└── frontend/         Next.js 14 (App Router) + TypeScript
    ├── lib/
    │   ├── api.ts        Typed API client
    │   ├── analytics.ts  Client-side event tracking
    │   └── store.ts      Zustand auth store
    ├── components/
    │   └── Navbar.tsx
    └── app/
        ├── layout.tsx          Auto page-view tracking
        ├── admin/page.tsx      Analytics dashboard
        ├── host/stripe/page.tsx  Stripe Connect onboarding
        └── spots/[id]/book/page.tsx  Booking + Stripe payment
```

---

## Payment Model — Hosts pay the platform fee

| Who | What they pay | Amount |
|-----|--------------|--------|
| **Client** | Spot rate only | `hours × price_per_hour` |
| **Host** | Platform fee deducted from payout | 15% of booking subtotal |

**How it works technically (Stripe Connect):**
1. Client pays full amount → goes to Stripe
2. Stripe routes payment to host's Connect account (`transfer_data.destination`)
3. `application_fee_amount` (15%) is automatically deducted before transfer
4. Host receives 85% of booking value; ParkNest keeps 15%

---

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env       # fill in DB URL, JWT secret, Stripe keys
npm install
node db/migrate.js         # create tables
npm run dev                # starts on :4000
```

### 2. Stripe Setup

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local backend
stripe listen --forward-to localhost:4000/api/payments/webhook

# Copy the webhook secret it prints into .env as STRIPE_WEBHOOK_SECRET
```

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # add API URL + Stripe publishable key
npm install
npm run dev                         # starts on :3000
```

---

## API Reference

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register (role: client or host) |
| POST | `/api/auth/login` | — | Login, returns JWT |
| GET | `/api/auth/me` | JWT | Current user profile |

### Spots
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/spots` | optional | Search/list spots |
| GET | `/api/spots/:id` | optional | Spot detail + reviews |
| POST | `/api/spots` | host JWT | Create spot (requires Stripe) |
| PATCH | `/api/spots/:id` | host JWT | Update spot |
| GET | `/api/spots/host/mine` | host JWT | Host's own spots + earnings |

### Bookings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/bookings` | client JWT | Create booking + get Stripe client_secret |
| GET | `/api/bookings` | JWT | Client's bookings |
| GET | `/api/bookings/:id` | JWT | Single booking |
| PATCH | `/api/bookings/:id/cancel` | JWT | Cancel + refund |
| GET | `/api/bookings/host/requests` | host JWT | All bookings for host's spots |
| PATCH | `/api/bookings/:id/complete` | host JWT | Mark complete, trigger payout |

### Payments
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/payments/connect` | host JWT | Start Stripe Connect onboarding |
| GET | `/api/payments/connect/status` | host JWT | Check Stripe account status |
| GET | `/api/payments/host/earnings` | host JWT | Earnings summary + monthly breakdown |
| POST | `/api/payments/webhook` | Stripe | Stripe event handler |

### Analytics (admin only)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analytics/event` | Track client-side event |
| GET | `/api/analytics/funnel` | Booking conversion funnel |
| GET | `/api/analytics/overview` | Users, bookings, revenue overview |
| GET | `/api/analytics/user-flow` | Most common session paths |

---

## User Flow Tracking

Every action is tracked in the `analytics_events` table:

| Event | When it fires |
|-------|--------------|
| `page_view` | Every page navigation |
| `spots_searched` | Search/filter submitted |
| `spot_viewed` | Spot detail page opened |
| `booking_form_opened` | Book button clicked |
| `booking_created` | Booking submitted to API |
| `booking_confirmed` | Stripe payment succeeded |
| `user_registered` | Sign up completed |
| `user_logged_in` | Login completed |
| `stripe_connect_started` | Host begins Stripe onboarding |
| `stripe_connect_completed` | Host Stripe account activated |
| `spot_created` | Host publishes a spot |

View the funnel at `GET /api/analytics/funnel` (admin JWT) or in the `/admin` dashboard.

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a strong random `JWT_SECRET`
- [ ] Switch Stripe to live keys (`sk_live_...` / `pk_live_...`)
- [ ] Set up Stripe webhook endpoint in Stripe Dashboard
- [ ] Use a managed PostgreSQL (Supabase, Neon, RDS)
- [ ] Add HTTPS (Nginx / Vercel / Railway)
- [ ] Deploy backend (Railway, Render, or EC2)
- [ ] Deploy frontend (Vercel)
