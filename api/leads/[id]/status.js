import { supabaseAdmin } from '../../_lib/supabaseAdmin.js';
import { requireSession } from '../../_lib/auth.js';

const VALID_STATUSES = ['New', 'Contacted', 'Negotiating', 'Won', 'Lost'];

// PATCH /api/leads/:id/status — staff dashboard's status-pipeline dropdown.
export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  const { id } = req.query;
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { data, error } = await supabaseAdmin.from('leads').update({ status }).eq('id', id).select().single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update lead status' });
  }
  return res.status(200).json(data);
}
