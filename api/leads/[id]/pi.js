import { supabaseAdmin } from '../../_lib/supabaseAdmin.js';
import { requireSession } from '../../_lib/auth.js';

// POST /api/leads/:id/pi — create or update the (single) draft PI for a lead.
// One row per lead_id: re-editing an existing PI upserts it back to 'draft'
// rather than creating a second row.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  const { id } = req.query;
  const { items, grandTotal } = req.body || {};
  if (!Array.isArray(items) || grandTotal == null) {
    return res.status(400).json({ error: 'Missing items or grandTotal' });
  }

  const { data, error } = await supabaseAdmin
    .from('performa_invoices')
    .upsert(
      {
        lead_id: id,
        items,
        grand_total: grandTotal,
        status: 'draft',
        created_by: session.id,
      },
      { onConflict: 'lead_id' }
    )
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to save proforma invoice' });
  }
  return res.status(200).json(data);
}
