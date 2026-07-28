import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { requireSession } from '../_lib/auth.js';

const LEAD_COLUMNS = 'id, reference_id, booking_type, customer_name, phone, email, cinemas, grand_total, submitted_at';

function toCamelLead(row) {
  return {
    id: row.id,
    referenceId: row.reference_id,
    bookingType: row.booking_type,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    cinemas: row.cinemas,
    grandTotal: Number(row.grand_total),
    submittedAt: row.submitted_at,
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

// GET /api/leads?from=YYYY-MM-DD&to=YYYY-MM-DD&sort=recent|value — staff dashboard only.
async function handleGet(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  const { from, to, sort } = req.query;

  let query = supabaseAdmin.from('leads').select(LEAD_COLUMNS);
  if (from) query = query.gte('submitted_at', `${from}T00:00:00`);
  if (to) query = query.lte('submitted_at', `${to}T23:59:59.999`);
  query = sort === 'value' ? query.order('grand_total', { ascending: false }) : query.order('submitted_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load leads' });
  }
  return res.status(200).json(data.map(toCamelLead));
}

// POST /api/leads — public, called by the customer-facing Bulk Booking / Private
// Screening quote forms right after they log a lead to the Google Sheet, so the
// same submission also shows up here for staff. Body shape matches what's already
// sent to submitLeadToSheet/submitPSLeadToSheet.
async function handlePost(req, res) {
  const body = req.body || {};
  const { referenceId, bookingType, phone, email, cinemas, grandTotal } = body;
  const customerName = body.customerName || body.name;

  if (!referenceId || !bookingType || !customerName || !phone || !Array.isArray(cinemas) || grandTotal == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({
      reference_id: referenceId,
      booking_type: bookingType,
      customer_name: customerName,
      phone,
      email: email || 'Not provided',
      cinemas,
      grand_total: grandTotal,
    })
    .select('id')
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
  return res.status(201).json({ id: data.id });
}
