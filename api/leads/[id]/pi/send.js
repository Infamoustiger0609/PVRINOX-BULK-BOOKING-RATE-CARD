import { Resend } from 'resend';
import { supabaseAdmin } from '../../../_lib/supabaseAdmin.js';
import { requireSession } from '../../../_lib/auth.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/leads/:id/pi/send — emails the already-generated PI PDF (built
// client-side by buildPIPdf in src/App.jsx) via Resend, then upserts the
// performa_invoices row to status 'sent'. Scoped to PI sending only — the
// customer lead-notification email (sendLeadEmail/sendPSLeadEmail) still
// goes through EmailJS, unchanged.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  const { id } = req.query;
  const { piData, pdfDataUri, customerEmail } = req.body || {};
  if (!piData || typeof piData !== 'object' || !pdfDataUri || !customerEmail) {
    return res.status(400).json({ error: 'Missing piData, pdfDataUri or customerEmail' });
  }

  const base64Pdf = String(pdfDataUri).split(',')[1];
  if (!base64Pdf) {
    return res.status(400).json({ error: 'pdfDataUri must be a data: URI' });
  }

  const refLabel = piData.refNo || piData.pinvNo || String(id);

  const { error: sendError } = await resend.emails.send({
    from: 'PVR INOX <onboarding@resend.dev>', // swap once a verified sending domain exists
    to: customerEmail,
    subject: `Proforma Invoice - Ref ${refLabel}`,
    text: 'Please find the attached Proforma Invoice.',
    attachments: [
      {
        filename: `PI_${piData.pinvNo || 'draft'}.pdf`,
        content: base64Pdf,
      },
    ],
  });

  if (sendError) {
    console.error('Resend PI send failed:', sendError);
    return res.status(502).json({ error: 'Failed to send PI email' });
  }

  const { data, error } = await supabaseAdmin
    .from('performa_invoices')
    .upsert(
      {
        lead_id: id,
        items: piData,
        grand_total: Number(piData.total) || 0,
        status: 'sent',
        sent_at: new Date().toISOString(),
        created_by: session.id,
      },
      { onConflict: 'lead_id' }
    )
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'PI email sent, but failed to update its status' });
  }
  return res.status(200).json(data);
}
