// lib/analytics.ts
// Client-side analytics — sends named events to our backend.
// Every meaningful user action is tracked so we can build funnel reports.

const API = process.env.NEXT_PUBLIC_API_URL;

// Persist session ID across page loads
function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let sid = sessionStorage.getItem('pn_session');
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem('pn_session', sid);
  }
  return sid;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pn_token');
}

export async function track(eventName: string, properties: Record<string, unknown> = {}) {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-session-id': getSessionId(),
      'x-page': typeof window !== 'undefined' ? window.location.pathname : '',
    };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    await fetch(`${API}/analytics/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session_id: getSessionId(),
        event_name: eventName,
        properties,
        page: typeof window !== 'undefined' ? window.location.pathname : '',
      }),
    });
  } catch (_) {
    // Never block UX on analytics failure
  }
}

// ── Named event helpers ───────────────────────────────────────────────────────

export const Analytics = {
  pageView: (page: string) => track('page_view', { page }),
  searchPerformed: (query: Record<string, unknown>) => track('spots_searched', query),
  spotViewed: (spotId: string, spotTitle: string) =>
    track('spot_viewed', { spot_id: spotId, spot_title: spotTitle }),
  bookingFormOpened: (spotId: string) =>
    track('booking_form_opened', { spot_id: spotId }),
  bookingStarted: (spotId: string, totalHours: number, subtotal: number) =>
    track('booking_created', { spot_id: spotId, total_hours: totalHours, subtotal }),
  paymentCompleted: (bookingId: string) =>
    track('booking_confirmed', { booking_id: bookingId }),
  stripeConnectStarted: () => track('stripe_connect_started', {}),
  spotListingStarted: () => track('spot_listing_started', {}),
  spotListingCompleted: (spotId: string) =>
    track('spot_created', { spot_id: spotId }),
  userRegistered: (role: string) => track('user_registered', { role }),
  userLoggedIn: () => track('user_logged_in', {}),
};
