const db = require('./db');
const { hashToken } = require('./security');

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return { ...rest, suspended: Boolean(rest.suspended) };
}

function findSessionUser(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash);
  if (!row) return null;
  if (new Date(`${row.expires_at}Z`).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  if (row.suspended) return null;
  delete row.expires_at;
  return row;
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

// Attaches req.user when a valid session exists; never rejects the request.
function optionalAuth(req, _res, next) {
  req.user = findSessionUser(tokenFromRequest(req));
  next();
}

function requireAuth(req, res, next) {
  req.user = findSessionUser(tokenFromRequest(req));
  if (!req.user) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' });
    }
    next();
  };
}

module.exports = { publicUser, findSessionUser, optionalAuth, requireAuth, requireRole };
