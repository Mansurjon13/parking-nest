// middleware/analytics.js
const pool = require('../db/pool');

/**
 * trackEvent — call this anywhere to record a named event
 * e.g. trackEvent(req, 'booking_started', { spot_id, price })
 */
async function trackEvent(req, eventName, properties = {}) {
  try {
    const sessionId = req.headers['x-session-id'] || 'unknown';
    const userId = req.user?.id || null;
    const page = req.headers['x-page'] || req.originalUrl;
    const referrer = req.headers['referer'] || null;
    const userAgent = req.headers['user-agent'] || null;
    const ip = req.ip || req.socket?.remoteAddress || null;

    await pool.query(
      `INSERT INTO analytics_events
         (session_id, user_id, event_name, properties, page, referrer, user_agent, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sessionId, userId, eventName, JSON.stringify(properties), page, referrer, userAgent, ip]
    );
  } catch (err) {
    // Never let analytics crash the request
    console.error('[analytics] trackEvent error:', err.message);
  }
}

/**
 * pageviewMiddleware — auto-tracks every API call as a server-side event
 * Attach early in the middleware chain
 */
function pageviewMiddleware(req, res, next) {
  // Skip health checks and static
  if (req.path === '/health' || req.path.startsWith('/static')) return next();

  res.on('finish', () => {
    trackEvent(req, 'api_request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
    }).catch(() => {});
  });
  next();
}

module.exports = { trackEvent, pageviewMiddleware };
