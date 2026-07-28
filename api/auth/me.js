import { getSessionFromRequest } from '../_lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  return res.status(200).json({ id: session.id, name: session.name, email: session.email });
}
