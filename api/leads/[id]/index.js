import { supabaseAdmin } from '../../_lib/supabaseAdmin.js';
import { requireSession } from '../../_lib/auth.js';

const DELETE_ALLOWED_EMAIL = 'yash.verma@pvrinox.com';

// DELETE /api/leads/:id — dashboard's "Delete Query" button. Restricted to a single
// employee, enforced here (not just by hiding the button client-side) since the JWT
// cookie already carries the verified email — no extra DB lookup needed.
export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (session.email !== DELETE_ALLOWED_EMAIL) {
    return res.status(403).json({ error: 'Not authorized to delete leads' });
  }

  const { id } = req.query;
  const { error } = await supabaseAdmin.from('leads').delete().eq('id', id);

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete lead' });
  }
  return res.status(200).json({ ok: true });
}
