import jwt from 'jsonwebtoken';

export const SESSION_COOKIE_NAME = 'session';

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=');
      const key = (idx === -1 ? pair : pair.slice(0, idx)).trim();
      const value = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).trim());
      return [key, value];
    })
  );
}

// Returns the decoded JWT payload ({ id, name, email }) or null — never throws,
// so callers can treat "no session" and "bad session" the same way.
export function getSessionFromRequest(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

// Call at the top of a protected handler. Writes the 401 itself and returns
// null when unauthorized, so the caller can just `if (!session) return;`.
export function requireSession(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return session;
}

export function buildSessionCookie(token, maxAgeSeconds) {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function buildClearSessionCookie() {
  return [`${SESSION_COOKIE_NAME}=`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0'].join('; ');
}
