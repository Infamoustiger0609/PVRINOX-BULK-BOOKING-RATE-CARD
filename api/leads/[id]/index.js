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

  if (String(session.email || '').toLowerCase().trim() !== DELETE_ALLOWED_EMAIL) {
    return res.status(403).json({ error: 'Not authorized to delete leads' });
  }

  const { id } = req.query;

  // Delete any Proforma Invoice tied to this lead first, explicitly, rather than
  // relying on the DB-level "on delete cascade" FK — that clause only takes effect
  // if performa_invoices was created fresh with it; on a project where the table
  // already existed before the schema added that clause, `create table if not
  // exists` is a no-op and the old (non-cascading) constraint silently stays in
  // effect, which is exactly what was causing deletes to fail with a 500 for any
  // lead that already had a PI drafted — a private screening lead is far more
  // likely to have one than a bulk booking lead, which is why this looked like a
  // booking-type bug when it was actually a leftover-child-row bug.
  const { error: piError } = await supabaseAdmin.from('performa_invoices').delete().eq('lead_id', id);
  if (piError) {
    console.error(piError);
    return res.status(500).json({ error: 'Failed to delete associated proforma invoice', detail: piError.message });
  }

  const { error } = await supabaseAdmin.from('leads').delete().eq('id', id);

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete lead', detail: error.message });
  }
  return res.status(200).json({ ok: true });
}
