import { supabaseAdmin } from '../../../_lib/supabaseAdmin.js';
import { requireSession } from '../../../_lib/auth.js';

// POST /api/leads/:id/pi — create or update the (single) draft PI for a lead.
// One row per lead_id: re-editing an existing PI upserts it back to 'draft'
// rather than creating a second row. `piData` is the full PI document (company/
// party/line-items/totals/notes/bank details, see buildPiDataFromLead in
// src/App.jsx) — stored whole in the `items` jsonb column, no schema change.
// `grand_total` is duplicated out of piData.total for dashboard sorting.
//
// Lives at pi/index.js (not a sibling pi.js) so "pi" is consistently a folder —
// having both api/leads/[id]/pi.js and api/leads/[id]/pi/send.js previously
// broke Vercel's route generation for both endpoints (405s in production even
// though the handlers were correct). index.js still resolves to /api/leads/:id/pi.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  const { id } = req.query;
  const { piData } = req.body || {};
  if (!piData || typeof piData !== 'object' || !Array.isArray(piData.lineItems)) {
    return res.status(400).json({ error: 'Missing piData' });
  }

  const { data, error } = await supabaseAdmin
    .from('performa_invoices')
    .upsert(
      {
        lead_id: id,
        items: piData,
        grand_total: Number(piData.total) || 0,
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
