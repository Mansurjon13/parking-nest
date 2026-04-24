// lib/api.ts — typed API client wrapping fetch
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let sid = sessionStorage.getItem('pn_session');
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem('pn_session', sid);
  }
  return sid;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pn_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-session-id': getSessionId(),
    'x-page': typeof window !== 'undefined' ? window.location.pathname : '',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (body: { email: string; password: string; full_name: string; role: string }) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST', body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST', body: JSON.stringify(body),
    }),
  me: () => request<User>('/auth/me'),
};

// ── Spots ─────────────────────────────────────────────────────────────────────
export const spotsApi = {
  list: (params?: Record<string, string | number>) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<{ spots: Spot[]; total: number }>(`/spots${qs}`);
  },
  get: (id: string) => request<Spot & { reviews: Review[] }>(`/spots/${id}`),
  create: (body: Partial<Spot>) =>
    request<Spot>('/spots', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Spot>) =>
    request<Spot>(`/spots/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  mine: () => request<Spot[]>('/spots/host/mine'),
};

// ── Bookings ──────────────────────────────────────────────────────────────────
export const bookingsApi = {
  create: (body: { spot_id: string; starts_at: string; ends_at: string }) =>
    request<{ booking: Booking; client_secret: string }>('/bookings', {
      method: 'POST', body: JSON.stringify(body),
    }),
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Booking[]>(`/bookings${qs}`);
  },
  get: (id: string) => request<Booking>(`/bookings/${id}`),
  cancel: (id: string) =>
    request<{ success: boolean }>(`/bookings/${id}/cancel`, { method: 'PATCH' }),
  hostRequests: () => request<Booking[]>('/bookings/host/requests'),
  complete: (id: string) =>
    request<{ success: boolean }>(`/bookings/${id}/complete`, { method: 'PATCH' }),
};

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsApi = {
  connectStripe: () => request<{ url: string }>('/payments/connect', { method: 'POST' }),
  connectStatus: () => request<{ status: string; charges_enabled: boolean }>('/payments/connect/status'),
  earnings: () => request<EarningsData>('/payments/host/earnings'),
};

// ── Analytics (admin only) ────────────────────────────────────────────────────
export const analyticsApi = {
  funnel: (days?: number) =>
    request<FunnelData>(`/analytics/funnel?days=${days || 30}`),
  overview: (days?: number) =>
    request<OverviewData>(`/analytics/overview?days=${days || 30}`),
  userFlow: (days?: number) =>
    request<UserFlowData>(`/analytics/user-flow?days=${days || 7}`),
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface User {
  id: string; email: string; full_name: string; role: string;
  stripe_account_id?: string; stripe_account_status?: string;
  avatar_url?: string; created_at: string;
}

export interface Spot {
  id: string; host_id: string; title: string; description?: string;
  address: string; city: string; lat?: number; lng?: number;
  spot_type: string; price_per_hour: number; amenities: string[];
  images: string[]; is_active: boolean;
  available_from: string; available_until: string;
  avg_rating: number; total_reviews: number;
  host_name?: string; host_avatar?: string;
  created_at: string;
}

export interface Booking {
  id: string; spot_id: string; client_id: string; host_id: string;
  starts_at: string; ends_at: string; total_hours: number;
  price_per_hour: number; subtotal: number; platform_fee: number;
  host_payout: number; client_pays: number;
  status: string; access_code?: string;
  spot_title?: string; spot_address?: string;
  stripe_payment_intent_id?: string;
  created_at: string;
}

export interface Review {
  rating: number; comment?: string; reviewer_name: string; created_at: string;
}

export interface EarningsData {
  summary: { total_bookings: string; total_earned: string; total_platform_fees: string; gross_revenue: string; };
  monthly: { month: string; earned: string; bookings: string; }[];
}

export interface FunnelData {
  days: number;
  funnel: { step: string; sessions: number; conversion_from_prev: number; conversion_from_top: number; }[];
}

export interface OverviewData {
  users: { total: string; hosts: string; clients: string; new_users: string; };
  bookings: { total: string; completed: string; cancelled: string; recent: string; };
  revenue: { gross: string; platform_revenue: string; host_payouts: string; };
  top_spots: { title: string; city: string; bookings: string; revenue: string; }[];
  top_events: { event_name: string; count: string; }[];
}

export interface UserFlowData {
  days: number;
  top_paths: { path: string; count: number; }[];
  sample_sessions: { session_id: string; flow: string[]; event_count: string; }[];
}
