import { supabaseAdmin } from '../../../_lib/supabaseAdmin.js';
import { requireSession } from '../../../_lib/auth.js';
import { EMAILJS_CONFIG } from '../../../_lib/emailjs.js';

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function formatINR(n) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

// Renders the PI as a self-contained HTML email body, reusing the cream
// ticket-stub look (--stub/--stub-ink colors, dotted row dividers) from the
// on-screen quote stub in src/App.jsx so the emailed PI matches what staff saw.
function buildPiHtml({ referenceId, items, grandTotal }) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px dotted #d8cdb9;">${escapeHtml(item.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px dotted #d8cdb9;text-align:right;">${escapeHtml(String(item.qty))}</td>
          <td style="padding:10px 12px;border-bottom:1px dotted #d8cdb9;text-align:right;">${formatINR(item.price)}</td>
          <td style="padding:10px 12px;border-bottom:1px dotted #d8cdb9;text-align:right;font-weight:700;">
            ${formatINR((Number(item.price) || 0) * (Number(item.qty) || 0))}
          </td>
        </tr>`
    )
    .join('');

  return `
    <div style="max-width:480px;margin:0 auto;font-family:Arial,sans-serif;background:#f4ede3;color:#1c1717;border-radius:14px;overflow:hidden;border:1px solid #d8cdb9;">
      <div style="padding:22px;">
        <div style="font-size:22px;font-weight:700;">Proforma Invoice</div>
        <div style="font-size:12px;color:#6b6058;margin-top:4px;">Reference: ${escapeHtml(referenceId)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="font-size:11px;text-transform:uppercase;color:#6b6058;">
            <th style="padding:0 12px 6px;text-align:left;">Line item</th>
            <th style="padding:0 12px 6px;text-align:right;">Qty</th>
            <th style="padding:0 12px 6px;text-align:right;">Price</th>
            <th style="padding:0 12px 6px;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;padding:18px 22px;font-size:20px;font-weight:700;color:#8f1c21;">
        <span>Grand Total</span>
        <span>${formatINR(grandTotal)}</span>
      </div>
    </div>`;
}

// POST /api/leads/:id/pi/send — emails the PI to the customer via EmailJS's
// server-side REST API, then marks the (already-drafted) PI row as sent.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  const { id } = req.query;
  const { items, grandTotal, customerEmail } = req.body || {};
  if (!Array.isArray(items) || grandTotal == null || !customerEmail) {
    return res.status(400).json({ error: 'Missing items, grandTotal or customerEmail' });
  }

  const templateParams = {
    to_email: customerEmail,
    reference_id: String(id),
    pi_html: buildPiHtml({ referenceId: String(id), items, grandTotal }),
    grand_total: formatINR(grandTotal),
  };

  const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_CONFIG.serviceId,
      template_id: EMAILJS_CONFIG.piTemplateId,
      user_id: EMAILJS_CONFIG.publicKey,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: templateParams,
    }),
  });

  if (!emailRes.ok) {
    const bodyText = await emailRes.text().catch(() => '');
    console.error('EmailJS PI send failed:', emailRes.status, bodyText);
    return res.status(502).json({ error: 'Failed to send PI email' });
  }

  const { data, error } = await supabaseAdmin
    .from('performa_invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('lead_id', id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'PI email sent, but failed to update its status' });
  }
  return res.status(200).json(data);
}
