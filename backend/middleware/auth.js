// middleware/auth.js
const jwt = require('jsonwebtoken');

/**
 * requireAuth — verifies JWT and attaches user to req.user
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

/**
 * requireRole — gate a route to specific roles
 * Usage: requireRole('host') or requireRole(['host','admin'])
 */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${allowed.join(' or ')}` });
    }
    next();
  };
}

/**
 * optionalAuth — attaches user if token present, continues either way
 * Used on public routes that want user context if available
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch (_) { /* ignore */ }
  }
  next();
}

module.exports = { requireAuth, requireRole, optionalAuth };
