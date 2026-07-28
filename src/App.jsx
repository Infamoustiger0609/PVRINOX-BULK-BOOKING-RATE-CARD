import React, { useState, useMemo, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';

/* ---------------------------------------------------------------
   PVR INOX — Group Booking Quote Tool
   Single-file React component (App.jsx)

   SETUP REQUIRED BEFORE THIS SENDS REAL EMAILS:
   1. Create a free account at https://www.emailjs.com
   2. Add an Email Service (e.g. connect it to Outlook/Gmail) -> copy the Service ID
   3. Create an Email Template with these variable names in the body:
      {{reference_id}} {{cinemas_summary}} {{cinema_count}} {{grand_total}}
      {{customer_name}} {{customer_phone}} {{customer_email}}
      cinemas_summary lists each selected cinema's own format, movie,
      date, time slot, ticket count and food combo — see sendLeadEmail() below.
      -> copy the Template ID
   4. Account -> General -> copy the Public Key
   5. Paste all three into EMAILJS_CONFIG below.
   ------------------------------------------------------------- */

const EMAILJS_CONFIG = {
  serviceId: 'REPLACE_WITH_SERVICE_ID',
  templateId: 'REPLACE_WITH_TEMPLATE_ID',
  publicKey: 'REPLACE_WITH_PUBLIC_KEY',
};

// Google Apps Script web app: POST saves the lead to a Sheet, GET ?ref=... looks one up
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyh-LpQs8YyH9wyjTV4hwwAXOe0rxtTgbX_2L6WEXRu19gDuwdmvJQE8ulrTUSqiryCAA/exec';

// Real brand mark (replaces the old hand-drawn "PVR * INOX" text/shapes) — used in
// the header and embedded into both the quote PDF and the Proforma Invoice PDF.
const PVR_INOX_LOGO_URL = '/assests/pvr-inox-logo.png';

// Manual city overrides for cinema names where the naive "last word" rule doesn't match the real city
const CITY_OVERRIDES = {
  'PVR City Mall Yamuna Nagar': 'Yamuna Nagar',
};

// Some source data spells the same city more than one way — normalize at the point
// city lists are derived (not by editing the underlying data) so cinemas from either
// spelling surface under a single merged option.
const CITY_NAME_ALIASES = { Gurugram: 'Gurgaon', Ahemdabad: 'Ahmedabad' };
function normalizeCityName(city) {
  return CITY_NAME_ALIASES[city] || city;
}

function getCityForCinema(name) {
  if (CITY_OVERRIDES[name]) return normalizeCityName(CITY_OVERRIDES[name]);
  if (name.includes('Pitampura')) return normalizeCityName('Delhi');
  const words = name.trim().split(/\s+/);
  return normalizeCityName(words[words.length - 1]);
}

// "Delhi NCR" quick-select in the city dropdown expands to this set — edit here to change it
const NCR_CITIES = ['Delhi', 'New Delhi', 'Gurgaon', 'Noida', 'Greater Noida', 'Faridabad', 'Ghaziabad'];

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCityForPSCinema(dataset, name) {
  return normalizeCityName(toTitleCase(dataset[name]?.city || ''));
}

// Shared by bulk booking (bulkBookingData, city derived from the cinema name) and private
// screening (privateScreeningData, city read from an explicit field) — both datasets are
// fetched at runtime; each supplies its own getCityFn so this just handles building +
// de-duping + sorting once.
function buildCinemaAndCityLists(dataset, getCityFn) {
  const cinemaNames = Object.keys(dataset);
  const allCities = Array.from(new Set(cinemaNames.map(getCityFn))).sort((a, b) => a.localeCompare(b));
  return { cinemaNames, allCities };
}

const TIME_SLOTS = [
  { id: 'morning', label: 'Morning', range: '8:00 AM – 12:00 PM' },
  { id: 'afternoon', label: 'Afternoon', range: '12:00 PM – 5:00 PM' },
  { id: 'evening', label: 'Evening', range: '5:00 PM – 11:59 PM' },
];

const MIN_TICKET_COUNT = 50;

// Date-based price adjustments, checked against a cinema entry's request date.
// 'blocked' dates can't be booked at all (e.g. a holiday with no discounts available);
// 'surge' dates apply their own multiplier to the ticket price. Add real dates here as
// they're identified — this list is empty by default.
const DATE_PRICE_RULES = [
  // { date: '2026-08-15', type: 'blocked', label: 'Independence Day — no bulk booking discounts available' },
  // { date: '2026-10-20', type: 'surge', multiplier: 1.15, label: 'Festive release weekend' },
];

// Set to e.g. 1.1 in future to activate a 10% weekend surcharge on Saturdays/Sundays.
// Left at 1.0 for now — the logic below is fully wired up but has no visible effect
// until this changes.
const WEEKEND_SURGE_MULTIPLIER = 1.0;

// Shared by both flows' pricing calculations. Returns null when a date has no
// adjustment, { blocked: true, label } when the date can't be booked at all, or
// { blocked: false, multiplier, label } when a surge/weekend multiplier applies.
// A specific DATE_PRICE_RULES entry always takes priority over the weekend surge.
function getDatePriceAdjustment(dateStr) {
  if (!dateStr) return null;
  const rule = DATE_PRICE_RULES.find((r) => r.date === dateStr);
  if (rule) {
    if (rule.type === 'blocked') return { blocked: true, label: rule.label };
    if (rule.type === 'surge') return { blocked: false, multiplier: rule.multiplier, label: rule.label };
  }
  if (WEEKEND_SURGE_MULTIPLIER !== 1.0) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayOfWeek = new Date(y, m - 1, d).getDay(); // local time — avoids UTC date-shift off-by-one
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { blocked: false, multiplier: WEEKEND_SURGE_MULTIPLIER, label: 'Weekend pricing applied' };
    }
  }
  return null;
}

function formatSurgeNote(adjustment) {
  const pct = Math.round((adjustment.multiplier - 1) * 100);
  return `${adjustment.label} (${pct >= 0 ? '+' : ''}${pct}%)`;
}

const EVENT_TYPES = [
  'Movie',
  'Personal Celebrations',
  'Birthday Party',
  'Photo Shoot',
  'Wedding',
  'Wedding Proposal',
  'Bridal Shower',
  'Pre-Wedding Screening',
  'Anniversary',
  'Engagement',
  'Baby Shower',
  'Family Reunion',
  'Corporate Events',
  'Brand Activations & Launches',
  'School & Community Events',
  'Sports & Gaming',
  'Filmmaker & Premieres',
  'Other',
];

const FOOD_COMBOS = [
  { id: 'none', label: 'No food', items: 'Tickets only', price: 0 },
  { id: 'small', label: 'Small Combo', items: 'Small pepsi + small popcorn', price: 550 },
  { id: 'medium', label: 'Medium Combo', items: 'Medium pepsi + medium popcorn', price: 750 },
  { id: 'smallBurger', label: 'Small Combo + Burger', items: 'Small pepsi + small popcorn + burger', price: 750 },
  { id: 'mediumBurger', label: 'Medium Combo + Burger', items: 'Medium pepsi + medium popcorn + burger', price: 850 },
];

function generateReferenceId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'PVX-';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function formatINR(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// jsPDF's built-in fonts (Helvetica/Times/Courier) don't have the ₹ glyph — it
// renders as a garbled superscript character. Used only inside the PDF quote.
function formatINRForPdf(n) {
  return 'Rs. ' + Math.round(n).toLocaleString('en-IN');
}

// Accepts a plain "yyyy-MM-dd" string or a full ISO timestamp and always
// returns just the date portion, so a stray "T00:00:00.000Z" never leaks through.
function formatPlainDate(value) {
  if (!value) return '';
  const str = String(value);
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : str;
}

// Formats an ISO timestamp (or anything Date can parse) as "Submitted on 22 Jul 2026, 1:53 PM".
function formatSubmittedOn(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `Submitted on ${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
}

// Shared by both flows' "Download PDF" button. Takes already-computed display
// strings/numbers (built separately by each flow from its own live-stub state) and
// just lays them out — no pricing math happens in here.
function buildQuotePdf({ bookingType, referenceId, cinemaSections, grandTotal }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const valueX = 55;
  let y = 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(20, 20, 20);
  doc.text('PVR', marginX, y);
  const pvrWidth = doc.getTextWidth('PVR ');
  doc.setTextColor(190, 145, 40);
  doc.text('•', marginX + pvrWidth, y);
  doc.setTextColor(20, 20, 20);
  doc.text('INOX', marginX + pvrWidth + 6, y);

  y += 10;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(bookingType === 'Private Screening' ? 'Private Screening Quote' : 'Bulk Booking Quote', marginX, y);

  y += 7;
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 90, 90);
  const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.text(`Reference: ${referenceId}    Date: ${todayStr}`, marginX, y);

  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 9;

  cinemaSections.forEach((section, idx) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(20, 20, 20);
    doc.text(`${idx + 1}. ${section.heading}`, marginX, y);
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(60, 60, 60);
    section.rows.forEach(([label, value]) => {
      doc.text(`${label}:`, marginX + 4, y);
      doc.text(String(value), valueX, y);
      y += 5.5;
    });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 20, 20);
    doc.text('Subtotal:', marginX + 4, y);
    doc.text(formatINRForPdf(section.subtotal), valueX, y);
    y += 9;
  });

  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(150, 20, 25);
  doc.text('Estimated Total:', marginX, y);
  doc.text(formatINRForPdf(grandTotal), marginX + 62, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(150, 20, 25);
  doc.text('Prices are tentative and subject to change at confirmation.', marginX, y);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('This is not a confirmed booking. Our team will contact you to finalize details.', marginX, pageHeight - 15);

  doc.save(`${referenceId}-quote.pdf`);
}

/* ---------------------------------------------------------------
   Proforma Invoice (staff dashboard) — data prefill, Indian-numbering
   words conversion, and jsPDF layout. See CLAUDE.md for the field list.
   ------------------------------------------------------------- */

const PI_STAMP_IMAGE_URL = '/assests/Stamp_for_PI.png.png';

const PI_DEFAULTS = {
  companyName: 'PVR INOX LIMITED',
  companyAddress: 'Block A, 4th Floor, Building No. 9A, DLF Cyber City, Phase III, Gurugram, Haryana - 122002',
  gstNo: '27AAACP4526D1ZQ',
  panNo: 'AAACP4526D',
  cinNo: 'L74899DL1995PLC067827',
  gstNumberForInvoice: '27AAACE7796G1Z9',
  paymentTerms: '100% Advance',
  notes: [
    'Please Issue only A/c Payee Cheque/DD in the favour of PVR INOX LIMITED. Please quote Invoice No. while payment is made.',
    'In case of payment done thru NEFT/RTGS, please notify with detail at shailesh.dubey@pvrcinemas.com.',
    'Amount mentioned above is an estimate only and is subject to change on the finalisation of the actual cost.',
    'Any Discrepancy in this bill should be notified within 5 days of receipt, else acceptance shall be deemed.',
    'In case of cheque is bounced Rs.500/- will be charged.',
    'Interest @2% Per Month shall be charged after payment due date.',
    'All Disputes subject to Delhi Jurisdiction only.',
    'For any query regarding this bill please mail at salesaccounts@pvrcinemas.com',
  ]
    .map((line, idx) => `${idx + 1}. ${line}`)
    .join('\n'),
  bankDetails: {
    accountNo: '09290330000102',
    bankName: 'HDFC Bank Ltd.',
    branch: 'DLF Cyber City Gurugram',
    ifsc: 'HDFC0000929',
    micrCode: '110240120',
  },
};

// "July 2, 2026" — no leading zero on the day, matches the sample's date format.
function formatPiDate(d) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const PI_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const PI_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function piTwoDigitsToWords(n) {
  if (n < 20) return PI_ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return PI_TENS[tens] + (ones ? ' ' + PI_ONES[ones] : '');
}

function piThreeDigitsToWords(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let words = '';
  if (hundreds) words += PI_ONES[hundreds] + ' Hundred';
  if (rest) words += (words ? ' ' : '') + piTwoDigitsToWords(rest);
  return words;
}

// Indian numbering (crore/lakh/thousand, not the western "million/billion" grouping).
function numberToIndianWords(amount) {
  let n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Rupees Zero Only';

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts = [];
  if (crore) parts.push(piThreeDigitsToWords(crore) + ' Crore');
  if (lakh) parts.push(piTwoDigitsToWords(lakh) + ' Lakh');
  if (thousand) parts.push(piTwoDigitsToWords(thousand) + ' Thousand');
  if (hundred) parts.push(piThreeDigitsToWords(hundred));

  return 'Rupees ' + parts.join(' ') + ' Only';
}

// Starting line items for the PI editor — one ticket row per cinema, plus a separate
// food row when a paid combo was selected. Mirrors the pricing split documented in
// CLAUDE.md (bulk food count = ticket count; PS food count = desired attendees, not
// required tickets) using FOOD_COMBOS to recover a per-unit food price, since the
// lead record itself only stores the combined line subtotal. This is a best-effort
// starting point — every row is fully editable afterward.
function buildPiLineItemsFromLead(lead) {
  let nextId = 0;
  const items = [];
  (lead.cinemas || []).forEach((c) => {
    const isPS = c.bookingType === 'Private Screening';
    const ticketQty = Number(isPS ? c.requiredTickets : c.ticketCount) || 0;
    const multiplier = Number(c.priceAdjustmentMultiplier) || 1;
    const ticketRate = Math.round((Number(c.pricePerTicket) || 0) * multiplier);
    items.push({
      id: nextId++,
      description: `${c.cinema} - Tickets (${isPS ? `Audi ${c.audiNumber}` : c.format})`,
      quantity: ticketQty,
      rate: ticketRate,
      amount: ticketQty * ticketRate,
    });

    const combo = FOOD_COMBOS.find((f) => f.label === c.foodCombo);
    if (combo && combo.price > 0) {
      const foodQty = Number(isPS ? c.desiredAttendees : c.ticketCount) || 0;
      items.push({
        id: nextId++,
        description: `${c.cinema} - Food (${combo.label})`,
        quantity: foodQty,
        rate: combo.price,
        amount: foodQty * combo.price,
      });
    }
  });
  return items.length ? items : [{ id: 0, description: '', quantity: 1, rate: 0, amount: 0 }];
}

function buildPiDataFromLead(lead) {
  return {
    companyName: PI_DEFAULTS.companyName,
    companyAddress: PI_DEFAULTS.companyAddress,
    gstNo: PI_DEFAULTS.gstNo,
    panNo: PI_DEFAULTS.panNo,
    cinNo: PI_DEFAULTS.cinNo,
    refNo: '',
    date: formatPiDate(new Date()),
    pinvNo: '',
    partyName: lead.customerName || '',
    partyAddress: '',
    lineItems: buildPiLineItemsFromLead(lead),
    gstNumberForInvoice: PI_DEFAULTS.gstNumberForInvoice,
    paymentTerms: PI_DEFAULTS.paymentTerms,
    notes: PI_DEFAULTS.notes,
    bankDetails: { ...PI_DEFAULTS.bankDetails },
  };
}

async function loadImageAsDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Builds (but does not save/output) the A4 Proforma Invoice PDF. `piData` must carry
// the fully-resolved numbers (netValue/gstAmount/total/amountInWords already settled
// between calculated-vs-override in the caller) — no pricing math happens in here,
// matching buildQuotePdf's convention above. Caller decides doc.save(...) for a
// download or doc.output('datauristring') to attach it to the send-PI email.
async function buildPIPdf(piData) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 15;
  const rightX = pageWidth - marginX;
  const contentWidth = rightX - marginX;
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text('PROFORMA INVOICE', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text(piData.companyName, marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  const addrLines = doc.splitTextToSize(piData.companyAddress, contentWidth * 0.6);
  doc.text(addrLines, marginX, y);
  const addrBottomY = y + addrLines.length * 4.2;

  let ry = 16 + 8;
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  [
    ['GST No', piData.gstNo],
    ['PAN No', piData.panNo],
    ['CIN No', piData.cinNo],
  ].forEach(([label, value]) => {
    doc.text(`${label}: ${value}`, rightX, ry, { align: 'right' });
    ry += 4.5;
  });

  y = Math.max(addrBottomY, ry) + 5;
  doc.setDrawColor(180, 180, 180);
  doc.line(marginX, y, rightX, y);
  y += 7;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Ref No:', marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.text(piData.refNo || '-', marginX + 18, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', marginX + 75, y);
  doc.setFont('helvetica', 'normal');
  doc.text(piData.date || '-', marginX + 88, y);
  doc.setFont('helvetica', 'bold');
  doc.text('PINV No:', marginX + 130, y);
  doc.setFont('helvetica', 'normal');
  doc.text(piData.pinvNo || '-', rightX, y, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Party Name:', marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.text(piData.partyName || '-', marginX + 26, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Address:', marginX, y);
  doc.setFont('helvetica', 'normal');
  const partyAddrLines = doc.splitTextToSize(piData.partyAddress || '-', contentWidth - 26);
  doc.text(partyAddrLines, marginX + 26, y);
  y += partyAddrLines.length * 4.5 + 5;

  // Line items table
  const colX = { sno: marginX, desc: marginX + 9, qty: marginX + 122, rate: marginX + 140, amount: rightX };
  const descWidth = colX.qty - colX.desc - 3;

  function drawTableHeaderRow() {
    const h = 7;
    doc.setFillColor(232, 232, 232);
    doc.rect(marginX, y, contentWidth, h, 'F');
    doc.setDrawColor(120, 120, 120);
    doc.rect(marginX, y, contentWidth, h);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text('#', colX.sno + 2, y + 4.8);
    doc.text('Description', colX.desc, y + 4.8);
    doc.text('Qty', colX.qty, y + 4.8);
    doc.text('Rate', colX.rate, y + 4.8);
    doc.text('Amount', colX.amount, y + 4.8, { align: 'right' });
    y += h;
  }

  drawTableHeaderRow();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  piData.lineItems.forEach((item, idx) => {
    const descLines = doc.splitTextToSize(item.description || '', descWidth);
    const rowH = Math.max(6.5, descLines.length * 4 + 2.5);
    if (y + rowH > pageHeight - 20) {
      doc.addPage();
      y = 20;
      drawTableHeaderRow();
    }
    doc.setDrawColor(190, 190, 190);
    doc.rect(marginX, y, contentWidth, rowH);
    doc.text(String(idx + 1), colX.sno + 2, y + 4.5);
    doc.text(descLines, colX.desc, y + 4.5);
    doc.text(String(item.quantity), colX.qty, y + 4.5);
    doc.text(formatINRForPdf(item.rate), colX.rate, y + 4.5);
    doc.text(formatINRForPdf(item.amount), colX.amount, y + 4.5, { align: 'right' });
    y += rowH;
  });
  y += 7;

  if (y > pageHeight - 60) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Net Value', colX.rate, y);
  doc.text(formatINRForPdf(piData.netValue), colX.amount, y, { align: 'right' });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.text(`GST (${piData.gstNumberForInvoice}) @ 18%`, colX.rate - 20, y);
  doc.text(formatINRForPdf(piData.gstAmount), colX.amount, y, { align: 'right' });
  y += 4;
  doc.setDrawColor(120, 120, 120);
  doc.line(colX.rate - 20, y, rightX, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Total', colX.rate - 20, y);
  doc.text(formatINRForPdf(piData.total), colX.amount, y, { align: 'right' });
  y += 8;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  const wordsLines = doc.splitTextToSize(`Amount in Words: ${piData.amountInWords}`, contentWidth);
  doc.text(wordsLines, marginX, y);
  y += wordsLines.length * 4.2 + 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Payment Terms:', marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.text(piData.paymentTerms || '-', marginX + 32, y);
  y += 9;

  // Yellow-highlighted disclaimer, matching the sample.
  const disclaimerText =
    'NOTE: THIS IS A PROFORMA INVOICE ONLY. THIS IS NOT A TAX INVOICE / BILL OF SUPPLY AND CANNOT BE USED FOR AVAILING INPUT TAX CREDIT.';
  const disclaimerLines = doc.splitTextToSize(disclaimerText, contentWidth - 6);
  const disclaimerHeight = disclaimerLines.length * 4.2 + 4;
  if (y + disclaimerHeight > pageHeight - 20) {
    doc.addPage();
    y = 20;
  }
  doc.setFillColor(255, 240, 140);
  doc.rect(marginX, y, contentWidth, disclaimerHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 70, 0);
  doc.text(disclaimerLines, marginX + 3, y + 5);
  doc.setTextColor(20, 20, 20);
  y += disclaimerHeight + 8;

  if (y > pageHeight - 55) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Notes:', marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  String(piData.notes || '')
    .split('\n')
    .filter((line) => line.trim())
    .forEach((line) => {
      const lines = doc.splitTextToSize(line.trim(), contentWidth);
      if (y + lines.length * 3.8 > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      doc.text(lines, marginX, y);
      y += lines.length * 3.8 + 1;
    });
  y += 5;

  if (y > pageHeight - 45) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Bank Details', marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const bd = piData.bankDetails || {};
  [
    ['Account No', bd.accountNo],
    ['Bank Name', bd.bankName],
    ['Branch', bd.branch],
    ['RTGS/NEFT/IFSC', bd.ifsc],
    ['MICR Code', bd.micrCode],
  ].forEach(([label, value]) => {
    doc.text(`${label}: ${value || '-'}`, marginX, y);
    y += 4.3;
  });

  // Signature block, bottom-right of the last page — fixed position rather than
  // flowing with the content above, matching the sample's placement.
  const stampSize = 26;
  let sigY = pageHeight - 45;
  if (y > sigY - 6) {
    doc.addPage();
    sigY = pageHeight - 45;
  }
  const sigX = rightX - stampSize;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  doc.text(`For ${piData.companyName}`, rightX, sigY - 4, { align: 'right' });
  try {
    const stampDataUrl = await loadImageAsDataUrl(PI_STAMP_IMAGE_URL);
    doc.addImage(stampDataUrl, 'PNG', sigX, sigY, stampSize, stampSize);
  } catch (err) {
    console.error('Could not embed PI stamp image:', err);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Authorised Signatory', rightX, sigY + stampSize + 5, { align: 'right' });

  return doc;
}

export default function App() {
  const [mode, setMode] = useState(null); // null | 'bulkBooking' | 'privateScreening' | 'employeeLogin' | 'dashboard'

  // ---- Employee Dashboard: backed by /api/auth/* + /api/leads/* (Supabase + JWT cookie) ----
  const [isEmployeeLoggedIn, setIsEmployeeLoggedIn] = useState(false);
  const [loggedInEmployeeName, setLoggedInEmployeeName] = useState('');
  const [employeeLoginEmail, setEmployeeLoginEmail] = useState('');
  const [employeeLoginPassword, setEmployeeLoginPassword] = useState('');
  const [employeeLoginError, setEmployeeLoginError] = useState('');
  const [employeeLoginSubmitting, setEmployeeLoginSubmitting] = useState(false);

  const [dashboardDateFrom, setDashboardDateFrom] = useState('');
  const [dashboardDateTo, setDashboardDateTo] = useState('');
  const [dashboardSort, setDashboardSort] = useState('recent'); // 'recent' | 'value'
  const [dashboardLeads, setDashboardLeads] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [piData, setPiData] = useState(null); // null until "Create PI" is clicked — see buildPiDataFromLead
  const [piNetValueOverride, setPiNetValueOverride] = useState(null);
  const [piGstAmountOverride, setPiGstAmountOverride] = useState(null);
  const [piTotalOverride, setPiTotalOverride] = useState(null);
  const [piAmountInWordsOverride, setPiAmountInWordsOverride] = useState(null);
  const [piSaving, setPiSaving] = useState(false);
  const [piSending, setPiSending] = useState(false);
  const [piGeneratingPdf, setPiGeneratingPdf] = useState(false);
  const [piError, setPiError] = useState('');
  const [piSent, setPiSent] = useState(false);

  // netValue/gstAmount/total/amountInWords each cascade from the one before unless
  // the employee has typed a manual override into that specific field — matching
  // the PI spec's "editable as an override... until reset to calculated is clicked".
  const piCalculatedNetValue = useMemo(() => {
    if (!piData) return 0;
    return piData.lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }, [piData]);
  const piNetValue = piNetValueOverride !== null ? Number(piNetValueOverride) || 0 : piCalculatedNetValue;

  const piCalculatedGstAmount = useMemo(() => Math.round(piNetValue * 0.18), [piNetValue]);
  const piGstAmount = piGstAmountOverride !== null ? Number(piGstAmountOverride) || 0 : piCalculatedGstAmount;

  const piCalculatedTotal = useMemo(() => piNetValue + piGstAmount, [piNetValue, piGstAmount]);
  const piTotal = piTotalOverride !== null ? Number(piTotalOverride) || 0 : piCalculatedTotal;

  const piCalculatedAmountInWords = useMemo(() => numberToIndianWords(piTotal), [piTotal]);
  const piAmountInWords = piAmountInWordsOverride !== null ? piAmountInWordsOverride : piCalculatedAmountInWords;

  function resetPiEditor() {
    setPiData(null);
    setPiNetValueOverride(null);
    setPiGstAmountOverride(null);
    setPiTotalOverride(null);
    setPiAmountInWordsOverride(null);
    setPiError('');
    setPiSent(false);
  }

  // Bundles the live form state with the currently-resolved (calculated-or-override)
  // totals — this is the exact shape saved as a draft, rendered to PDF, and sent.
  function getResolvedPiData() {
    if (!piData) return null;
    return { ...piData, netValue: piNetValue, gstAmount: piGstAmount, total: piTotal, amountInWords: piAmountInWords };
  }

  // Restores a logged-in employee's session on page load (the JWT cookie
  // persists across reloads even though this component's state doesn't).
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setIsEmployeeLoggedIn(true);
          setLoggedInEmployeeName(data.name);
        }
      })
      .catch(() => {});
  }, []);

  function handleEmployeeSessionExpired() {
    setIsEmployeeLoggedIn(false);
    setLoggedInEmployeeName('');
    setSelectedLeadId(null);
    resetPiEditor();
    setEmployeeLoginError('Your session has expired — please log in again.');
    setMode('employeeLogin');
  }

  // Re-confirms the session every time the dashboard is entered (not just once at
  // page load) — covers direct navigation to 'dashboard' and a cookie that expired
  // while the tab sat open. Bounces to the login screen on a 401.
  useEffect(() => {
    if (mode !== 'dashboard') return;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) {
          handleEmployeeSessionExpired();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data) {
          setIsEmployeeLoggedIn(true);
          setLoggedInEmployeeName(data.name);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function handleEmployeeLogin() {
    setEmployeeLoginError('');
    setEmployeeLoginSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: employeeLoginEmail.trim(), password: employeeLoginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmployeeLoginError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setIsEmployeeLoggedIn(true);
      setLoggedInEmployeeName(data.name);
      setEmployeeLoginEmail('');
      setEmployeeLoginPassword('');
      setMode('dashboard');
    } catch {
      setEmployeeLoginError('Could not reach the server. Please try again.');
    } finally {
      setEmployeeLoginSubmitting(false);
    }
  }

  async function handleEmployeeLogout() {
    setIsEmployeeLoggedIn(false);
    setLoggedInEmployeeName('');
    setSelectedLeadId(null);
    resetPiEditor();
    setMode(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error(err);
    }
  }

  function fetchDashboardLeads() {
    setDashboardLoading(true);
    setDashboardError(false);
    const params = new URLSearchParams();
    if (dashboardDateFrom) params.set('from', dashboardDateFrom);
    if (dashboardDateTo) params.set('to', dashboardDateTo);
    params.set('sort', dashboardSort);

    fetch(`/api/leads?${params.toString()}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 401) {
          handleEmployeeSessionExpired();
          return null;
        }
        if (!res.ok) throw new Error('Failed to load leads');
        return res.json();
      })
      .then((data) => {
        if (data) setDashboardLeads(data);
      })
      .catch(() => setDashboardError(true))
      .finally(() => setDashboardLoading(false));
  }

  useEffect(() => {
    if (mode !== 'dashboard' || !isEmployeeLoggedIn) return;
    fetchDashboardLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isEmployeeLoggedIn, dashboardDateFrom, dashboardDateTo, dashboardSort]);

  const selectedLead = useMemo(
    () => dashboardLeads.find((lead) => lead.referenceId === selectedLeadId) || null,
    [dashboardLeads, selectedLeadId]
  );

  function openLeadDetail(refId) {
    setSelectedLeadId(refId);
    resetPiEditor();
  }

  function closeLeadDetail() {
    setSelectedLeadId(null);
    resetPiEditor();
  }

  async function startPiEditor(lead) {
    resetPiEditor();
    const initialPiData = buildPiDataFromLead(lead);
    setPiData(initialPiData);

    setPiSaving(true);
    try {
      const netValue = initialPiData.lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const gstAmount = Math.round(netValue * 0.18);
      const total = netValue + gstAmount;
      const resolved = { ...initialPiData, netValue, gstAmount, total, amountInWords: numberToIndianWords(total) };

      const res = await fetch(`/api/leads/${lead.id}/pi`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piData: resolved }),
      });
      if (res.status === 401) return handleEmployeeSessionExpired();
      if (!res.ok) setPiError('Could not save the draft PI — you can still edit it, but try Send again in a moment.');
    } catch {
      setPiError('Could not save the draft PI — you can still edit it, but try Send again in a moment.');
    } finally {
      setPiSaving(false);
    }
  }

  function updatePiField(field, value) {
    setPiData((d) => ({ ...d, [field]: value }));
  }

  function updatePiBankField(field, value) {
    setPiData((d) => ({ ...d, bankDetails: { ...d.bankDetails, [field]: value } }));
  }

  function updatePiLineItem(id, field, value) {
    setPiData((d) => ({
      ...d,
      lineItems: d.lineItems.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, [field]: value };
        // Amount stays editable on its own, but a qty/rate edit always wins and
        // recomputes it — that's what "keep the editable amount override per row"
        // means in practice: type over amount for a one-off adjustment, or change
        // qty/rate to recalculate it.
        if (field === 'quantity' || field === 'rate') {
          next.amount = (Number(next.quantity) || 0) * (Number(next.rate) || 0);
        }
        return next;
      }),
    }));
  }

  function addPiLineItem() {
    setPiData((d) => {
      const nextId = d.lineItems.length ? Math.max(...d.lineItems.map((item) => item.id)) + 1 : 0;
      return { ...d, lineItems: [...d.lineItems, { id: nextId, description: '', quantity: 1, rate: 0, amount: 0 }] };
    });
  }

  function removePiLineItem(id) {
    setPiData((d) => ({ ...d, lineItems: d.lineItems.filter((item) => item.id !== id) }));
  }

  async function handleDownloadPiPdf() {
    const resolved = getResolvedPiData();
    if (!resolved || !selectedLead) return;
    setPiGeneratingPdf(true);
    try {
      const doc = await buildPIPdf(resolved);
      doc.save(`PI_${resolved.pinvNo || selectedLead.referenceId}.pdf`);
    } catch (err) {
      console.error(err);
      setPiError('Could not generate the PDF.');
    } finally {
      setPiGeneratingPdf(false);
    }
  }

  async function handleSendPi() {
    const resolved = getResolvedPiData();
    if (!selectedLead || !resolved) return;
    const customerEmail = selectedLead.email;
    if (!customerEmail || customerEmail === 'Not provided') {
      setPiError('No email on file for this customer — cannot send a PI.');
      return;
    }

    setPiError('');
    setPiSending(true);
    try {
      const doc = await buildPIPdf(resolved);
      const pdfDataUri = doc.output('datauristring');

      const res = await fetch(`/api/leads/${selectedLead.id}/pi/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ piData: resolved, pdfDataUri, customerEmail }),
      });
      if (res.status === 401) return handleEmployeeSessionExpired();
      if (!res.ok) throw new Error('Failed to send PI');

      setPiSent(true);
    } catch (err) {
      console.error(err);
      setPiError('Failed to send the PI — please try again.');
    } finally {
      setPiSending(false);
    }
  }

  const [referenceId, setReferenceId] = useState(generateReferenceId);

  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [selectedCities, setSelectedCities] = useState([]);
  const [cityQuery, setCityQuery] = useState('');

  const [showCinemaDropdown, setShowCinemaDropdown] = useState(false);
  const [selectedCinemaNames, setSelectedCinemaNames] = useState([]);
  const [cinemaQuery, setCinemaQuery] = useState('');
  const [cinemaDetails, setCinemaDetails] = useState({}); // { [cinemaName]: { format, timeSlotId, ticketCountInput, requestDate, foodComboId, foodDropdownOpen, timeSlotDropdownOpen } }
  const cinemaFieldRef = useRef(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('form'); // form | sending | interested | declined
  const [formError, setFormError] = useState('');
  const [confirmedFirstName, setConfirmedFirstName] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const [showLookupModal, setShowLookupModal] = useState(false);
  const [lookupRef, setLookupRef] = useState('');
  const [lookupStatus, setLookupStatus] = useState('idle'); // idle | loading | found | not-found | error
  const [lookupResult, setLookupResult] = useState(null);

  // ---- Bulk Booking: data is fetched at runtime (not bundled), only once the flow is entered ----
  const [bulkBookingData, setBulkBookingData] = useState(null);
  const [bulkDataError, setBulkDataError] = useState(false);

  function fetchBulkBookingData() {
    setBulkDataError(false);
    fetch('/data/bulk_booking_data.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load bulk booking data');
        return res.json();
      })
      .then(setBulkBookingData)
      .catch(() => setBulkDataError(true));
  }

  useEffect(() => {
    if (mode !== 'bulkBooking' || bulkBookingData) return;
    fetchBulkBookingData();
  }, [mode, bulkBookingData]);

  const { cinemaNames: CINEMA_NAMES, allCities: ALL_CITIES } = useMemo(() => {
    if (!bulkBookingData) return { cinemaNames: [], allCities: [] };
    return buildCinemaAndCityLists(bulkBookingData, getCityForCinema);
  }, [bulkBookingData]);
  // NCR_CITIES also covers private screening's city spellings ("New Delhi", "Greater Noida"), which
  // never occur in the bulk-booking dataset — scope the "Delhi NCR" shortcut to what's actually selectable here.
  const BULK_NCR_CITIES = useMemo(() => NCR_CITIES.filter((c) => ALL_CITIES.includes(c)), [ALL_CITIES]);

  // ---- Private Screening: data is fetched at runtime (not bundled), only once the flow is entered ----
  const [privateScreeningData, setPrivateScreeningData] = useState(null);
  const [dataError, setDataError] = useState(false);

  function fetchPrivateScreeningData() {
    setDataError(false);
    fetch('/data/private_screening_data.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load private screening data');
        return res.json();
      })
      .then(setPrivateScreeningData)
      .catch(() => setDataError(true));
  }

  useEffect(() => {
    if (mode !== 'privateScreening' || privateScreeningData) return;
    fetchPrivateScreeningData();
  }, [mode, privateScreeningData]);

  const [psShowCityDropdown, setPSShowCityDropdown] = useState(false);
  const [psSelectedCities, setPSSelectedCities] = useState([]);
  const [psCityQuery, setPSCityQuery] = useState('');

  const [psShowCinemaDropdown, setPSShowCinemaDropdown] = useState(false);
  const [psSelectedCinemaNames, setPSSelectedCinemaNames] = useState([]);
  const [psCinemaQuery, setPSCinemaQuery] = useState('');
  // { [cinemaName]: { timeSlotId, desiredAttendeesInput, selectedAudiNumbers, requestDate, eventType, eventDetail, eventTypeDropdownOpen, eventTypeQuery, foodComboId, foodDropdownOpen, timeSlotDropdownOpen } }
  const [psCinemaDetails, setPSCinemaDetails] = useState({});
  const psCinemaFieldRef = useRef(null);

  const [psReferenceId, setPSReferenceId] = useState(generateReferenceId);
  const [psName, setPSName] = useState('');
  const [psPhone, setPSPhone] = useState('');
  const [psEmail, setPSEmail] = useState('');
  const [psStatus, setPSStatus] = useState('form'); // form | sending | interested | declined
  const [psFormError, setPSFormError] = useState('');
  const [psConfirmedFirstName, setPSConfirmedFirstName] = useState('');
  const [psAgreedToTerms, setPSAgreedToTerms] = useState(false);

  const { cinemaNames: PS_CINEMA_NAMES, allCities: PS_ALL_CITIES } = useMemo(() => {
    if (!privateScreeningData) return { cinemaNames: [], allCities: [] };
    return buildCinemaAndCityLists(privateScreeningData, (name) => getCityForPSCinema(privateScreeningData, name));
  }, [privateScreeningData]);

  const psNcrCities = useMemo(() => NCR_CITIES.filter((c) => PS_ALL_CITIES.includes(c)), [PS_ALL_CITIES]);
  const isPSNcrSelected = psNcrCities.length > 0 && psNcrCities.every((c) => psSelectedCities.includes(c));

  const psCityFilteredCinemaNames = useMemo(() => {
    const pool =
      psSelectedCities.length === 0
        ? PS_CINEMA_NAMES
        : PS_CINEMA_NAMES.filter((c) => psSelectedCities.includes(getCityForPSCinema(privateScreeningData || {}, c)));
    return pool.slice().sort((a, b) => a.localeCompare(b));
  }, [PS_CINEMA_NAMES, psSelectedCities, privateScreeningData]);

  // Same pruning as bulk booking's cityFilteredCinemaNames effect above, for the
  // private screening flow's own selection state. Still guarded on privateScreeningData
  // being loaded (getCityForPSCinema needs it), but not on psSelectedCities being
  // non-empty — clearing every city should clear every selected cinema too.
  useEffect(() => {
    if (!privateScreeningData) return;
    setPSSelectedCinemaNames((names) => names.filter((n) => psSelectedCities.includes(getCityForPSCinema(privateScreeningData, n))));
    setPSCinemaDetails((details) => {
      const next = {};
      Object.keys(details).forEach((n) => {
        if (psSelectedCities.includes(getCityForPSCinema(privateScreeningData, n))) next[n] = details[n];
      });
      return next;
    });
  }, [psSelectedCities, privateScreeningData]);

  const psCityQueryTrimmed = psCityQuery.trim().toLowerCase();
  const showAllPSCitiesOption = psCityQueryTrimmed === '';
  const showPSDelhiNcrOption = psNcrCities.length > 0 && (psCityQueryTrimmed === '' || 'delhi ncr'.includes(psCityQueryTrimmed));
  const filteredPSCityOptions = useMemo(() => {
    if (!psCityQueryTrimmed) return PS_ALL_CITIES;
    return PS_ALL_CITIES.filter((c) => c.toLowerCase().includes(psCityQueryTrimmed));
  }, [PS_ALL_CITIES, psCityQueryTrimmed]);

  const psCinemaQueryTrimmed = psCinemaQuery.trim().toLowerCase();
  const filteredPSCinemaOptions = useMemo(() => {
    if (!psCinemaQueryTrimmed) return psCityFilteredCinemaNames;
    return psCityFilteredCinemaNames.filter((c) => c.toLowerCase().includes(psCinemaQueryTrimmed));
  }, [psCityFilteredCinemaNames, psCinemaQueryTrimmed]);

  const isNcrSelected = BULK_NCR_CITIES.every((c) => selectedCities.includes(c));

  const cityFilteredCinemaNames = useMemo(() => {
    const pool = selectedCities.length === 0 ? CINEMA_NAMES : CINEMA_NAMES.filter((c) => selectedCities.includes(getCityForCinema(c)));
    return pool.slice().sort((a, b) => a.localeCompare(b));
  }, [CINEMA_NAMES, selectedCities]);

  // Dropping a city (chip remove, "Clear all", NCR toggle-off) should immediately drop
  // any already-selected cinemas that no longer belong to a selected city — not just
  // leave them orphaned until manually removed. "Clear all" empties selectedCities
  // entirely, which correctly clears every selected cinema too (nothing is "in" an
  // empty list) — this only ever runs once a cinema has actually been selected, so
  // there's no interaction with the separate "no city filter shows every cinema in
  // the picker" browsing behavior.
  useEffect(() => {
    setSelectedCinemaNames((names) => names.filter((n) => selectedCities.includes(getCityForCinema(n))));
    setCinemaDetails((details) => {
      const next = {};
      Object.keys(details).forEach((n) => {
        if (selectedCities.includes(getCityForCinema(n))) next[n] = details[n];
      });
      return next;
    });
  }, [selectedCities]);

  const cityQueryTrimmed = cityQuery.trim().toLowerCase();
  const showAllCitiesOption = cityQueryTrimmed === '';
  const showDelhiNcrOption = cityQueryTrimmed === '' || 'delhi ncr'.includes(cityQueryTrimmed);
  const filteredCityOptions = useMemo(() => {
    if (!cityQueryTrimmed) return ALL_CITIES;
    return ALL_CITIES.filter((c) => c.toLowerCase().includes(cityQueryTrimmed));
  }, [ALL_CITIES, cityQueryTrimmed]);

  const cinemaQueryTrimmed = cinemaQuery.trim().toLowerCase();
  const filteredCinemaOptions = useMemo(() => {
    if (!cinemaQueryTrimmed) return cityFilteredCinemaNames;
    return cityFilteredCinemaNames.filter((c) => c.toLowerCase().includes(cinemaQueryTrimmed));
  }, [cityFilteredCinemaNames, cinemaQueryTrimmed]);

  const computedCinemas = selectedCinemaNames.map((cinemaName) => {
    const detail = cinemaDetails[cinemaName] || {
      format: '',
      timeSlotId: null,
      ticketCountInput: String(MIN_TICKET_COUNT),
      requestDate: '',
      foodComboId: 'none',
      foodDropdownOpen: false,
      timeSlotDropdownOpen: false,
    };
    const availableFormats = (bulkBookingData && bulkBookingData[cinemaName]) || [];
    const activeFormat = availableFormats.find((f) => f.format === detail.format);
    const activeTimeSlot = TIME_SLOTS.find((t) => t.id === detail.timeSlotId) || null;
    const basePrice = activeFormat && detail.timeSlotId ? activeFormat[detail.timeSlotId] : null;
    const dateAdjustment = getDatePriceAdjustment(detail.requestDate);
    const priceMultiplier = dateAdjustment && !dateAdjustment.blocked && dateAdjustment.multiplier ? dateAdjustment.multiplier : 1;
    const activePrice = basePrice != null ? basePrice * priceMultiplier : null;
    const activeCombo = FOOD_COMBOS.find((c) => c.id === detail.foodComboId);
    const ticketCount = Math.max(0, parseInt(detail.ticketCountInput, 10) || 0);
    const ticketTotal = activePrice ? activePrice * ticketCount : 0;
    const foodTotal = activeCombo ? activeCombo.price * ticketCount : 0;
    return {
      cinemaName,
      ...detail,
      availableFormats,
      activeFormat,
      activeTimeSlot,
      basePrice,
      activePrice,
      dateAdjustment,
      priceMultiplier,
      activeCombo,
      ticketCount,
      ticketTotal,
      foodTotal,
      lineTotal: ticketTotal + foodTotal,
    };
  });

  const completeCinemas = computedCinemas.filter(
    (r) =>
      r.activeFormat &&
      r.timeSlotId &&
      r.ticketCount >= MIN_TICKET_COUNT &&
      r.requestDate &&
      !(r.dateAdjustment && r.dateAdjustment.blocked)
  );
  const quoteReady = Boolean(selectedCinemaNames.length > 0 && completeCinemas.length === selectedCinemaNames.length);
  const grandTotal = computedCinemas.reduce((sum, r) => sum + r.lineTotal, 0);

  const computedPSCinemas = psSelectedCinemaNames.map((cinemaName) => {
    const detail = psCinemaDetails[cinemaName] || {
      timeSlotId: null,
      desiredAttendeesInput: '',
      selectedAudiNumbers: [],
      requestDate: '',
      eventType: '',
      eventDetail: '',
      eventTypeQuery: '',
      eventTypeDropdownOpen: false,
      foodComboId: 'none',
      foodDropdownOpen: false,
      timeSlotDropdownOpen: false,
    };
    const cinemaEntry = privateScreeningData?.[cinemaName] || { city: '', audis: [] };
    const audis = cinemaEntry.audis || [];
    const activeTimeSlot = TIME_SLOTS.find((t) => t.id === detail.timeSlotId) || null;
    const activeCombo = FOOD_COMBOS.find((c) => c.id === detail.foodComboId);
    const desiredAttendees = Math.max(0, parseInt(detail.desiredAttendeesInput, 10) || 0);
    const dateAdjustment = getDatePriceAdjustment(detail.requestDate);
    const priceMultiplier = dateAdjustment && !dateAdjustment.blocked && dateAdjustment.multiplier ? dateAdjustment.multiplier : 1;

    const rawAudiOptions = audis.map((a) => {
      const ninetyPercentFloor = Math.ceil(a.capacity * 0.9);
      const baseRate = detail.timeSlotId ? a[detail.timeSlotId] : null;
      const rate = baseRate != null ? baseRate * priceMultiplier : null;
      const requiredTickets = desiredAttendees > 0 ? Math.max(desiredAttendees, ninetyPercentFloor) : null;
      const flooredByMinimum = desiredAttendees > 0 && desiredAttendees < ninetyPercentFloor;
      const subtotal = rate != null && requiredTickets != null ? rate * requiredTickets : null;
      return { ...a, ninetyPercentFloor, rate, requiredTickets, flooredByMinimum, subtotal };
    });

    const cheapestAudiNumber = (() => {
      const valid = rawAudiOptions.filter((a) => !a.disabled && a.subtotal != null);
      if (!valid.length) return null;
      const allSame = valid.every((a) => a.subtotal === valid[0].subtotal);
      if (allSame) return null;
      return valid.reduce((best, a) => (a.subtotal < best.subtotal ? a : best), valid[0]).audi;
    })();

    // Cheapest-and-valid first; disabled ones always sink to the bottom regardless of price.
    const audiOptions =
      desiredAttendees > 0
        ? rawAudiOptions.slice().sort((a, b) => {
            if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
            const aVal = a.subtotal == null ? Infinity : a.subtotal;
            const bVal = b.subtotal == null ? Infinity : b.subtotal;
            return aVal - bVal;
          })
        : rawAudiOptions;

    const selectedAudis = rawAudiOptions.filter((a) => detail.selectedAudiNumbers.includes(a.audi));

    const ticketSubtotal = selectedAudis.reduce((sum, a) => sum + (a.subtotal || 0), 0);
    const foodSubtotal = activeCombo ? activeCombo.price * desiredAttendees : 0;
    const lineTotal = ticketSubtotal + foodSubtotal;
    const combinedCapacity = selectedAudis.reduce((sum, a) => sum + a.capacity, 0);

    return {
      cinemaName,
      city: cinemaEntry.city,
      ...detail,
      desiredAttendees,
      audis,
      audiOptions,
      cheapestAudiNumber,
      selectedAudis,
      combinedCapacity,
      activeTimeSlot,
      activeCombo,
      dateAdjustment,
      priceMultiplier,
      ticketSubtotal,
      foodSubtotal,
      lineTotal,
    };
  });

  const completePSCinemas = computedPSCinemas.filter(
    (r) =>
      r.timeSlotId &&
      r.desiredAttendees > 0 &&
      r.selectedAudis.length > 0 &&
      r.requestDate &&
      r.eventType &&
      (!(r.eventType === 'Movie' || r.eventType === 'Other') || r.eventDetail.trim()) &&
      !(r.dateAdjustment && r.dateAdjustment.blocked)
  );
  const psQuoteReady = Boolean(psSelectedCinemaNames.length > 0 && completePSCinemas.length === psSelectedCinemaNames.length);
  const psGrandTotal = computedPSCinemas.reduce((sum, r) => sum + r.lineTotal, 0);

  function toggleCity(city) {
    if (status !== 'form') setStatus('form');
    setSelectedCities((cities) => (cities.includes(city) ? cities.filter((c) => c !== city) : [...cities, city]));
  }

  function toggleDelhiNCR() {
    if (status !== 'form') setStatus('form');
    setSelectedCities((cities) => {
      const allSelected = BULK_NCR_CITIES.every((c) => cities.includes(c));
      if (allSelected) return cities.filter((c) => !BULK_NCR_CITIES.includes(c));
      return Array.from(new Set([...cities, ...BULK_NCR_CITIES]));
    });
  }

  function togglePSCity(city) {
    if (psStatus !== 'form') setPSStatus('form');
    setPSSelectedCities((cities) => (cities.includes(city) ? cities.filter((c) => c !== city) : [...cities, city]));
  }

  function togglePSDelhiNCR() {
    if (psStatus !== 'form') setPSStatus('form');
    setPSSelectedCities((cities) => {
      const allSelected = psNcrCities.every((c) => cities.includes(c));
      if (allSelected) return cities.filter((c) => !psNcrCities.includes(c));
      return Array.from(new Set([...cities, ...psNcrCities]));
    });
  }

  function updatePSCinemaDetail(cinemaName, patch) {
    setPSCinemaDetails((details) => ({ ...details, [cinemaName]: { ...details[cinemaName], ...patch } }));
  }

  function togglePSCinemaSelection(cinemaName) {
    if (psStatus !== 'form') setPSStatus('form');
    if (psSelectedCinemaNames.includes(cinemaName)) {
      setPSSelectedCinemaNames((names) => names.filter((n) => n !== cinemaName));
      setPSCinemaDetails((details) => {
        const next = { ...details };
        delete next[cinemaName];
        return next;
      });
    } else {
      setPSSelectedCinemaNames((names) => [...names, cinemaName]);
      setPSCinemaDetails((details) => ({
        ...details,
        [cinemaName]: {
          timeSlotId: null,
          desiredAttendeesInput: '',
          selectedAudiNumbers: [],
          requestDate: '',
          eventType: '',
          eventDetail: '',
          eventTypeQuery: '',
          eventTypeDropdownOpen: false,
          foodComboId: 'none',
          foodDropdownOpen: false,
          timeSlotDropdownOpen: false,
        },
      }));
    }
  }

  function removePSCinema(cinemaName) {
    setPSSelectedCinemaNames((names) => names.filter((n) => n !== cinemaName));
    setPSCinemaDetails((details) => {
      const next = { ...details };
      delete next[cinemaName];
      return next;
    });
  }

  function resetPSFormFields() {
    setPSSelectedCities([]);
    setPSShowCityDropdown(false);
    setPSSelectedCinemaNames([]);
    setPSCinemaDetails({});
    setPSShowCinemaDropdown(false);
    setPSName('');
    setPSPhone('');
    setPSEmail('');
    setPSFormError('');
    setPSAgreedToTerms(false);
  }

  async function handlePSInterested() {
    setPSFormError('');
    if (!psName.trim() || !psPhone.trim()) {
      setPSFormError('Please add your name and phone number so our team can reach you.');
      return;
    }
    if (!/^[0-9+\-\s]{7,15}$/.test(psPhone.trim())) {
      setPSFormError('That phone number looks off — please double check it.');
      return;
    }

    const newReferenceId = generateReferenceId();
    setPSReferenceId(newReferenceId);

    setPSStatus('sending');
    try {
      await Promise.all([sendPSLeadEmail(newReferenceId), submitPSLeadToSheet(newReferenceId), submitPSLeadToBackend(newReferenceId)]);
    } catch (err) {
      // The customer should never see backend plumbing trouble.
      // If leads stop arriving, check EMAILJS_CONFIG, APPS_SCRIPT_URL and the browser console.
      console.error(err);
    }
    setPSConfirmedFirstName(psName.trim().split(' ')[0] || '');
    setPSStatus('interested');
    resetPSFormFields();
  }

  function handlePSNotInterested() {
    setPSStatus('declined');
    resetPSFormFields();
  }

  function downloadPSQuotePdf() {
    const cinemaSections = completePSCinemas.map((r) => ({
      heading: `${r.cinemaName} — ${getCityForPSCinema(privateScreeningData, r.cinemaName)}`,
      rows: [
        ...r.selectedAudis.map((a) => [
          `Audi ${a.audi}`,
          `(${a.format}, ${a.capacity} seats): ${a.requiredTickets} tickets × ${formatINRForPdf(a.rate)}`,
        ]),
        ['Event', r.eventDetail ? `${r.eventType} — ${r.eventDetail}` : r.eventType],
        ['Time slot', `${r.activeTimeSlot.label} (${r.activeTimeSlot.range})`],
        ['Request date', r.requestDate],
        ['Attendees', String(r.desiredAttendees)],
        ['Tickets subtotal', formatINRForPdf(r.ticketSubtotal)],
        ['Food', r.activeCombo && r.activeCombo.id !== 'none'
          ? `${r.activeCombo.label} (${r.desiredAttendees} × ${formatINRForPdf(r.activeCombo.price)})`
          : 'None'],
        ...(r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier
          ? [['Price adjustment', formatSurgeNote(r.dateAdjustment)]]
          : []),
      ],
      subtotal: r.lineTotal,
    }));
    buildQuotePdf({
      bookingType: 'Private Screening',
      referenceId: psReferenceId,
      cinemaSections,
      grandTotal: psGrandTotal,
    });
  }

  function handlePSReset() {
    setPSStatus('form');
    setPSConfirmedFirstName('');
    resetPSFormFields();
  }

  function updateCinemaDetail(cinemaName, patch) {
    setCinemaDetails((details) => ({ ...details, [cinemaName]: { ...details[cinemaName], ...patch } }));
  }

  function toggleCinemaSelection(cinemaName) {
    if (status !== 'form') setStatus('form');
    if (selectedCinemaNames.includes(cinemaName)) {
      setSelectedCinemaNames((names) => names.filter((n) => n !== cinemaName));
      setCinemaDetails((details) => {
        const next = { ...details };
        delete next[cinemaName];
        return next;
      });
    } else {
      const formats = (bulkBookingData && bulkBookingData[cinemaName]) || [];
      setSelectedCinemaNames((names) => [...names, cinemaName]);
      setCinemaDetails((details) => ({
        ...details,
        [cinemaName]: {
          format: formats.length ? formats[0].format : '',
          timeSlotId: null,
          ticketCountInput: String(MIN_TICKET_COUNT),
          requestDate: '',
          foodComboId: 'none',
          foodDropdownOpen: false,
          timeSlotDropdownOpen: false,
        },
      }));
    }
  }

  function removeCinema(cinemaName) {
    setSelectedCinemaNames((names) => names.filter((n) => n !== cinemaName));
    setCinemaDetails((details) => {
      const next = { ...details };
      delete next[cinemaName];
      return next;
    });
  }

  async function sendLeadEmail(refId) {
    const cinemasSummary = completeCinemas
      .map((r, idx) => {
        const prefix = completeCinemas.length > 1 ? idx + 1 + '. ' : '';
        return (
          prefix + r.cinemaName + ' (' + r.format + ')\n' +
          '   Date: ' + r.requestDate + '\n' +
          '   Time slot: ' + r.activeTimeSlot.label + ' (' + r.activeTimeSlot.range + ')\n' +
          '   Tickets: ' + r.ticketCount + ' x ' + formatINR(r.activePrice) + ' = ' + formatINR(r.ticketTotal) + '\n' +
          (r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier
            ? '   Price adjustment: ' + formatSurgeNote(r.dateAdjustment) + '\n'
            : '') +
          '   Food: ' + (r.activeCombo ? r.activeCombo.label : 'None') + ' = ' + (r.foodTotal ? formatINR(r.foodTotal) : 'None') + '\n' +
          '   Subtotal: ' + formatINR(r.lineTotal)
        );
      })
      .join('\n\n');

    const templateParams = {
      reference_id: refId,
      cinemas_summary: cinemasSummary,
      cinema_count: String(completeCinemas.length),
      grand_total: formatINR(grandTotal),
      customer_name: name,
      customer_phone: phone,
      customer_email: email || 'Not provided',
    };

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.publicKey,
        template_params: templateParams,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error('EmailJS request failed: ' + res.status + ' ' + bodyText);
    }
  }

  async function submitLeadToSheet(refId) {
    // text/plain avoids a CORS preflight, which Apps Script web apps don't handle
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        referenceId: refId,
        name,
        phone,
        email: email || 'Not provided',
        cinemas: completeCinemas.map((r) => ({
          bookingType: 'Bulk Booking',
          cinema: r.cinemaName,
          format: r.format,
          timeSlot: r.activeTimeSlot.label,
          timeSlotRange: r.activeTimeSlot.range,
          pricePerTicket: r.activePrice,
          ticketCount: r.ticketCount,
          requestDate: r.requestDate,
          foodCombo: r.activeCombo ? r.activeCombo.label : 'None',
          subtotal: r.lineTotal,
          priceAdjustmentReason:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.label : '',
          priceAdjustmentMultiplier:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.multiplier : 1,
        })),
        grandTotal,
      }),
    });
  }

  // Feeds the same submission into the employee dashboard's leads table
  // (api/leads/index.js POST), alongside the Sheet log above — same shape,
  // separate destination. Swallow failures the same way submitLeadToSheet's
  // caller already does: the customer should never see backend plumbing trouble.
  async function submitLeadToBackend(refId) {
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceId: refId,
        bookingType: 'Bulk Booking',
        customerName: name,
        phone,
        email: email || 'Not provided',
        cinemas: completeCinemas.map((r) => ({
          bookingType: 'Bulk Booking',
          cinema: r.cinemaName,
          format: r.format,
          timeSlot: r.activeTimeSlot.label,
          timeSlotRange: r.activeTimeSlot.range,
          pricePerTicket: r.activePrice,
          ticketCount: r.ticketCount,
          requestDate: r.requestDate,
          foodCombo: r.activeCombo ? r.activeCombo.label : 'None',
          subtotal: r.lineTotal,
          priceAdjustmentReason:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.label : '',
          priceAdjustmentMultiplier:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.multiplier : 1,
        })),
        grandTotal,
      }),
    });
  }

  async function sendPSLeadEmail(refId) {
    const cinemasSummary = completePSCinemas
      .map((r, idx) => {
        const prefix = completePSCinemas.length > 1 ? idx + 1 + '. ' : '';
        const audiLines = r.selectedAudis
          .map(
            (a) =>
              '   Audi ' + a.audi + ' (' + a.format + ', ' + a.capacity + ' seats): ' +
              a.requiredTickets + ' tickets x ' + formatINR(a.rate)
          )
          .join('\n');
        return (
          prefix + r.cinemaName + ' — Private Screening\n' +
          audiLines + '\n' +
          '   Event: ' + r.eventType + (r.eventDetail ? ' — ' + r.eventDetail : '') + '\n' +
          '   Date: ' + r.requestDate + '\n' +
          '   Time slot: ' + r.activeTimeSlot.label + ' (' + r.activeTimeSlot.range + ')\n' +
          '   Desired attendees: ' + r.desiredAttendees + '\n' +
          '   Tickets subtotal: ' + formatINR(r.ticketSubtotal) + '\n' +
          (r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier
            ? '   Price adjustment: ' + formatSurgeNote(r.dateAdjustment) + '\n'
            : '') +
          '   Food: ' + (r.activeCombo && r.activeCombo.id !== 'none'
            ? `${r.activeCombo.label} (${r.desiredAttendees} × ${formatINR(r.activeCombo.price)}) = ${formatINR(r.foodSubtotal)}`
            : 'None') + '\n' +
          '   Subtotal: ' + formatINR(r.lineTotal)
        );
      })
      .join('\n\n');

    const templateParams = {
      reference_id: refId,
      cinemas_summary: cinemasSummary,
      cinema_count: String(completePSCinemas.length),
      grand_total: formatINR(psGrandTotal),
      customer_name: psName,
      customer_phone: psPhone,
      customer_email: psEmail || 'Not provided',
    };

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.publicKey,
        template_params: templateParams,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error('EmailJS request failed: ' + res.status + ' ' + bodyText);
    }
  }

  async function submitPSLeadToSheet(refId) {
    // text/plain avoids a CORS preflight, which Apps Script web apps don't handle
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        referenceId: refId,
        name: psName,
        phone: psPhone,
        email: psEmail || 'Not provided',
        cinemas: completePSCinemas.map((r) => ({
          bookingType: 'Private Screening',
          cinema: r.cinemaName,
          // Multiple audis can be combined for one cinema — join per-audi values
          // with a comma rather than restructuring to one row per audi, so the
          // Sheet keeps one row per cinema.
          audiNumber: r.selectedAudis.map((a) => a.audi).join(', '),
          audiFormat: r.selectedAudis.map((a) => a.format).join(', '),
          audiCapacity: r.selectedAudis.map((a) => a.capacity).join(', '),
          requiredTickets: r.selectedAudis.map((a) => a.requiredTickets).join(', '),
          desiredAttendees: r.desiredAttendees,
          timeSlot: r.activeTimeSlot.label,
          timeSlotRange: r.activeTimeSlot.range,
          pricePerTicket: r.selectedAudis[0] ? r.selectedAudis[0].rate : null,
          requestDate: r.requestDate,
          eventType: r.eventType,
          eventDetail: r.eventDetail,
          foodCombo: r.activeCombo ? r.activeCombo.label : 'None',
          subtotal: r.lineTotal,
          priceAdjustmentReason:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.label : '',
          priceAdjustmentMultiplier:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.multiplier : 1,
        })),
        grandTotal: psGrandTotal,
      }),
    });
  }

  // Feeds the same submission into the employee dashboard's leads table
  // (api/leads/index.js POST), alongside the Sheet log above — same shape,
  // separate destination. Swallow failures the same way submitPSLeadToSheet's
  // caller already does: the customer should never see backend plumbing trouble.
  async function submitPSLeadToBackend(refId) {
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceId: refId,
        bookingType: 'Private Screening',
        customerName: psName,
        phone: psPhone,
        email: psEmail || 'Not provided',
        cinemas: completePSCinemas.map((r) => ({
          bookingType: 'Private Screening',
          cinema: r.cinemaName,
          // Multiple audis can be combined for one cinema — join per-audi values
          // with a comma rather than restructuring to one row per audi, so the
          // backend keeps one row per cinema (mirrors submitPSLeadToSheet above).
          audiNumber: r.selectedAudis.map((a) => a.audi).join(', '),
          audiFormat: r.selectedAudis.map((a) => a.format).join(', '),
          audiCapacity: r.selectedAudis.map((a) => a.capacity).join(', '),
          requiredTickets: r.selectedAudis.map((a) => a.requiredTickets).join(', '),
          desiredAttendees: r.desiredAttendees,
          timeSlot: r.activeTimeSlot.label,
          timeSlotRange: r.activeTimeSlot.range,
          pricePerTicket: r.selectedAudis[0] ? r.selectedAudis[0].rate : null,
          requestDate: r.requestDate,
          eventType: r.eventType,
          eventDetail: r.eventDetail,
          foodCombo: r.activeCombo ? r.activeCombo.label : 'None',
          subtotal: r.lineTotal,
          priceAdjustmentReason:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.label : '',
          priceAdjustmentMultiplier:
            r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier ? r.dateAdjustment.multiplier : 1,
        })),
        grandTotal: psGrandTotal,
      }),
    });
  }

  function resetFormFields() {
    setSelectedCities([]);
    setShowCityDropdown(false);
    setSelectedCinemaNames([]);
    setCinemaDetails({});
    setShowCinemaDropdown(false);
    setName('');
    setPhone('');
    setEmail('');
    setFormError('');
    setAgreedToTerms(false);
  }

  async function handleInterested() {
    setFormError('');
    if (!name.trim() || !phone.trim()) {
      setFormError('Please add your name and phone number so our team can reach you.');
      return;
    }
    if (!/^[0-9+\-\s]{7,15}$/.test(phone.trim())) {
      setFormError('That phone number looks off — please double check it.');
      return;
    }

    const newReferenceId = generateReferenceId();
    setReferenceId(newReferenceId);

    setStatus('sending');
    try {
      await Promise.all([sendLeadEmail(newReferenceId), submitLeadToSheet(newReferenceId), submitLeadToBackend(newReferenceId)]);
    } catch (err) {
      // The customer should never see backend plumbing trouble.
      // If leads stop arriving, check EMAILJS_CONFIG, APPS_SCRIPT_URL and the browser console.
      console.error(err);
    }
    // Capture the greeting name before the form fields underneath get wiped.
    setConfirmedFirstName(name.trim().split(' ')[0] || '');
    setStatus('interested');
    resetFormFields();
  }

  function handleNotInterested() {
    setStatus('declined');
    resetFormFields();
  }

  function downloadQuotePdf() {
    const cinemaSections = completeCinemas.map((r) => ({
      heading: `${r.cinemaName} — ${getCityForCinema(r.cinemaName)}`,
      rows: [
        ['Format', r.format],
        ['Time slot', `${r.activeTimeSlot.label} (${r.activeTimeSlot.range})`],
        ['Request date', r.requestDate],
        ['Tickets', `${r.ticketCount} × ${formatINRForPdf(r.activePrice)}`],
        ['Food', r.activeCombo ? r.activeCombo.label : 'None'],
        ...(r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier
          ? [['Price adjustment', formatSurgeNote(r.dateAdjustment)]]
          : []),
      ],
      subtotal: r.lineTotal,
    }));
    buildQuotePdf({
      bookingType: 'Bulk Booking',
      referenceId,
      cinemaSections,
      grandTotal,
    });
  }

  function handleReset() {
    setStatus('form');
    setConfirmedFirstName('');
    resetFormFields();
  }

  const minDateStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split('T')[0];
  }, []);

  function openLookupModal() {
    setShowLookupModal(true);
  }

  function closeLookupModal() {
    setShowLookupModal(false);
    setLookupRef('');
    setLookupStatus('idle');
    setLookupResult(null);
  }

  async function handleLookup() {
    const ref = lookupRef.trim();
    if (!ref) return;
    setLookupStatus('loading');
    setLookupResult(null);
    try {
      const res = await fetch(APPS_SCRIPT_URL + '?ref=' + encodeURIComponent(ref));
      const data = await res.json();
      if (data && data.found) {
        setLookupResult(data);
        setLookupStatus('found');
      } else {
        setLookupStatus('not-found');
      }
    } catch (err) {
      console.error(err);
      setLookupStatus('error');
    }
  }

  return (
    <div className="pb-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .pb-page {
          --bg: #120f10;
          --surface: #1c1717;
          --surface-2: #241d1d;
          --line: #3a2f2d;
          --red: #d1272e;
          --red-dim: #8f1c21;
          --gold: #e7b23d;
          --ink: #f4ede3;
          --ink-muted: #ab9f98;
          --stub: #f4ede3;
          --stub-ink: #1c1717;
          font-family: 'Inter', system-ui, sans-serif;
          background: radial-gradient(ellipse at top, #201a1a 0%, var(--bg) 55%);
          color: var(--ink);
          min-height: 100vh;
          padding: 32px 32px 64px;
          box-sizing: border-box;
        }
        .pb-page * { box-sizing: border-box; }

        .pb-shell { max-width: 1440px; margin: 0 auto; }

        .pb-header { margin-bottom: 28px; }
        .pb-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--gold);
          margin: 0 0 6px;
        }
        .pb-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(36px, 6vw, 56px);
          letter-spacing: 0.02em;
          line-height: 1;
          margin: 0 0 8px;
          color: var(--ink);
        }
        .pb-title span { color: var(--red); }
        .pb-subtitle { color: var(--ink-muted); font-size: 15px; line-height: 1.55; margin: 0; max-width: 560px; }

        .pb-top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 28px;
        }
        .pb-brand-logo {
          display: flex;
          align-items: center;
          flex-shrink: 0;
          background: transparent;
          border: none;
          padding: 0;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .pb-brand-logo:hover { opacity: 0.8; }
        .pb-brand-logo-img { display: block; height: 40px; width: auto; }
        .pb-lookup-trigger {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--ink-muted);
          padding: 9px 16px;
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .pb-lookup-trigger:hover { border-color: var(--gold); color: var(--gold); }

        .pb-mode-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: none;
          color: var(--ink-muted);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          margin-bottom: 14px;
        }
        .pb-mode-back:hover { color: var(--gold); }

        .pb-landing { max-width: 760px; margin: 0 auto; text-align: center; padding: 40px 0; }
        .pb-landing-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--gold);
          margin: 0 0 10px;
        }
        .pb-landing-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(36px, 6vw, 56px);
          letter-spacing: 0.02em;
          line-height: 1;
          margin: 0 0 12px;
          color: var(--ink);
        }
        .pb-landing-title span { color: var(--red); }
        .pb-landing-subtitle {
          color: var(--ink-muted);
          font-size: 15px;
          line-height: 1.55;
          margin: 0 auto 36px;
          max-width: 480px;
        }
        .pb-landing-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .pb-landing-option {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 32px 24px;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s, transform 0.15s;
        }
        .pb-landing-option:hover { border-color: var(--gold); transform: translateY(-2px); }
        .pb-landing-option-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 26px;
          letter-spacing: 0.02em;
          color: var(--ink);
          margin: 0 0 8px;
        }
        .pb-landing-option-desc {
          color: var(--ink-muted);
          font-size: 13.5px;
          line-height: 1.5;
          margin: 0 0 18px;
        }
        .pb-landing-option-cta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--red);
        }
        @media (max-width: 640px) {
          .pb-landing { padding: 20px 0; }
          .pb-landing-options { grid-template-columns: 1fr; }
        }

        .pb-employee-link-wrap { margin-top: 28px; text-align: center; }
        .pb-employee-link {
          background: transparent;
          border: none;
          color: var(--ink-muted);
          font-size: 12px;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
          padding: 4px;
        }
        .pb-employee-link:hover { color: var(--gold); }

        .pb-dashboard { max-width: 1100px; margin: 0 auto; }
        .pb-dash-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 24px;
        }
        .pb-dash-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(28px, 4vw, 38px);
          letter-spacing: 0.02em;
          margin: 0;
          color: var(--ink);
        }
        .pb-dash-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: flex-end;
          margin-bottom: 22px;
          padding: 16px;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 12px;
        }
        .pb-dash-filters .pb-field { min-width: 160px; flex: 1; margin-bottom: 0; }
        .pb-dash-list { display: flex; flex-direction: column; gap: 10px; }
        .pb-dash-empty { color: var(--ink-muted); font-size: 13.5px; padding: 24px; text-align: center; }
        .pb-dash-row {
          display: grid;
          grid-template-columns: 110px 130px 1fr 190px 120px;
          align-items: center;
          gap: 14px;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 10px;
          padding: 14px 18px;
          cursor: pointer;
          transition: border-color 0.15s, transform 0.15s;
        }
        .pb-dash-row:hover { border-color: var(--gold); transform: translateY(-1px); }
        .pb-dash-row-ref { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; color: var(--gold); }
        .pb-dash-badge {
          display: inline-block;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 4px 9px;
          border-radius: 999px;
          text-align: center;
          white-space: nowrap;
        }
        .pb-dash-badge-bulk { background: rgba(231, 178, 61, 0.15); color: var(--gold); border: 1px solid rgba(231, 178, 61, 0.35); }
        .pb-dash-badge-ps { background: rgba(209, 39, 46, 0.15); color: var(--red); border: 1px solid rgba(209, 39, 46, 0.35); }
        .pb-dash-row-name { font-size: 13.5px; color: var(--ink); font-weight: 600; }
        .pb-dash-row-date { font-size: 12px; color: var(--ink-muted); }
        .pb-dash-row-total { font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 700; color: var(--ink); text-align: right; }

        .pb-dash-detail { max-width: 480px; margin: 0 auto; }

        .pb-pi-form {
          background: var(--stub);
          color: var(--stub-ink);
          border-radius: 14px;
          padding: 22px;
          margin-top: 16px;
        }
        .pb-pi-form input, .pb-pi-form textarea {
          width: 100%;
          background: #fff;
          color: #1c1717;
          border: 1px solid #cbbfa8;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 13px;
          font-family: 'Inter', sans-serif;
          outline: none;
        }
        .pb-pi-form textarea { resize: vertical; line-height: 1.5; }
        .pb-pi-form input:focus, .pb-pi-form textarea:focus { border-color: var(--gold); }
        .pb-pi-section { margin-bottom: 20px; padding-bottom: 18px; border-bottom: 1px dashed #d8cdb9; }
        .pb-pi-section:last-of-type { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
        .pb-pi-section-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 17px;
          letter-spacing: 0.02em;
          color: #1c1717;
          margin: 0 0 12px;
        }
        .pb-pi-field { margin-bottom: 10px; }
        .pb-pi-field:last-child { margin-bottom: 0; }
        .pb-pi-field label {
          display: block;
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #6b6058;
          margin-bottom: 4px;
        }
        .pb-pi-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .pb-pi-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

        .pb-pi-table-header, .pb-pi-table-row {
          display: grid;
          grid-template-columns: 1fr 70px 90px 100px 24px;
          gap: 8px;
          align-items: center;
        }
        .pb-pi-table-header {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b6058;
          padding: 0 0 6px;
        }
        .pb-pi-table-row { padding: 6px 0; border-bottom: 1px dotted #d8cdb9; }
        .pb-pi-table-row:last-of-type { border-bottom: none; }
        .pb-pi-row-remove {
          background: transparent;
          border: none;
          color: #b23c3c;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
        }
        .pb-pi-row-remove:hover { color: var(--red); }
        .pb-pi-add-row {
          margin-top: 8px;
          background: transparent;
          border: 1px dashed #cbbfa8;
          border-radius: 8px;
          color: #6b6058;
          font-size: 12.5px;
          font-weight: 600;
          padding: 8px 12px;
          cursor: pointer;
          width: 100%;
        }
        .pb-pi-add-row:hover { border-color: var(--gold); color: #1c1717; }

        .pb-pi-total-row {
          display: grid;
          grid-template-columns: 1fr 140px auto;
          gap: 10px;
          align-items: center;
          margin-bottom: 10px;
          font-size: 13px;
          font-weight: 600;
        }
        .pb-pi-total-row-grand { font-size: 15px; }
        .pb-pi-total-row-grand input { font-weight: 700; color: var(--red-dim); }
        .pb-pi-reset-btn {
          background: transparent;
          border: none;
          color: var(--red-dim);
          font-size: 11.5px;
          font-weight: 600;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
          white-space: nowrap;
        }
        .pb-pi-words-row { display: flex; gap: 10px; align-items: flex-start; }
        .pb-pi-words-row textarea { flex: 1; }

        .pb-pi-notes { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; line-height: 1.6; }

        .pb-pi-signature-note {
          font-size: 11.5px;
          color: #6b6058;
          text-align: right;
          margin: 4px 0 14px;
        }
        .pb-pi-signature-note span { display: block; font-size: 10.5px; font-style: italic; }

        .pb-pi-actions { display: flex; gap: 10px; }
        .pb-pi-actions .pb-btn { flex: 1; }

        @media (max-width: 640px) {
          .pb-dash-row {
            grid-template-columns: 1fr 1fr;
            grid-template-areas: "ref badge" "name name" "date total";
          }
          .pb-dash-row-ref { grid-area: ref; }
          .pb-dash-badge { grid-area: badge; justify-self: start; }
          .pb-dash-row-name { grid-area: name; }
          .pb-dash-row-date { grid-area: date; }
          .pb-dash-row-total { grid-area: total; }
          .pb-pi-grid-2, .pb-pi-grid-3 { grid-template-columns: 1fr; }
          .pb-pi-table-header, .pb-pi-table-row { grid-template-columns: 1fr 50px 65px 75px 20px; font-size: 11px; }
          .pb-pi-total-row { grid-template-columns: 1fr 110px auto; }
          .pb-pi-actions { flex-direction: column; }
        }

        .pb-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(8, 6, 6, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 100;
        }
        .pb-modal {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          max-width: 460px;
          width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          padding: 22px;
        }
        .pb-modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          gap: 12px;
        }
        .pb-modal-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px;
          letter-spacing: 0.02em;
          color: var(--ink);
          margin: 0;
        }
        .pb-modal-close {
          background: transparent;
          border: none;
          color: var(--ink-muted);
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          padding: 4px;
          flex-shrink: 0;
        }
        .pb-modal-close:hover { color: var(--red); }
        .pb-lookup-message {
          margin-top: 14px;
          padding: 10px 12px;
          background: var(--surface-2);
          border: 1px solid var(--line);
          border-radius: 8px;
          font-size: 13px;
          color: var(--ink-muted);
        }
        .pb-lookup-result { margin-top: 16px; }

        .pb-grid {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 40px;
          align-items: start;
        }
        .pb-grid-left { grid-column: 1; }
        @media (max-width: 860px) {
          .pb-grid { grid-template-columns: 1fr; gap: 24px; }
          .pb-grid-left { grid-column: 1; }
        }

        .pb-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 32px;
        }

        .pb-field { margin-bottom: 20px; position: relative; }
        .pb-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ink-muted);
          margin-bottom: 8px;
        }
        .pb-required { color: var(--red); margin-left: 2px; }
        .pb-input, .pb-select {
          width: 100%;
          background: var(--surface-2);
          border: 1px solid var(--line);
          color: var(--ink);
          padding: 11px 13px;
          border-radius: 8px;
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          outline: none;
          transition: border-color 0.15s;
        }
        .pb-input:focus, .pb-select:focus { border-color: var(--gold); }
        .pb-input::placeholder { color: #6f645f; }

        input[type="date"].pb-input::-webkit-calendar-picker-indicator {
          filter: invert(1) brightness(1.6);
          cursor: pointer;
        }

        .pb-date-help { font-size: 11px; color: var(--ink-muted); margin-top: 6px; }

        .pb-movie-note { font-size: 13px; color: var(--ink-muted); line-height: 1.5; margin: 0; }
        .pb-movie-link { color: var(--gold); text-decoration: underline; }
        .pb-movie-link:hover { color: var(--red); }

        .pb-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin-top: 4px;
          background: var(--surface-2);
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: hidden;
          z-index: 20;
          max-height: 240px;
          overflow-y: auto;
        }
        .pb-suggestion {
          padding: 10px 13px;
          font-size: 13.5px;
          cursor: pointer;
          border-bottom: 1px solid var(--line);
        }
        .pb-suggestion:last-child { border-bottom: none; }
        .pb-suggestion:hover { background: var(--red-dim); }

        .pb-city-dropdown { max-height: 260px; }
        .pb-city-option { display: flex; align-items: center; gap: 8px; }
        .pb-city-option.active { color: var(--gold); }
        .pb-city-option input[type="checkbox"] { pointer-events: none; }
        .pb-city-divider { height: 1px; background: var(--line); margin: 2px 0; }
        .pb-ncr-hint { font-size: 10.5px; color: var(--ink-muted); }

        .pb-combobox { position: relative; }
        .pb-combobox input.pb-input { padding-right: 32px; cursor: text; }
        .pb-combobox-caret {
          position: absolute;
          right: 13px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--ink-muted);
          font-size: 11px;
          pointer-events: none;
        }

        .pb-select-trigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          text-align: left;
          cursor: pointer;
          appearance: none;
        }
        .pb-select-caret { color: var(--ink-muted); font-size: 11px; flex-shrink: 0; }
        .pb-food-dropdown { padding: 6px; max-height: 320px; }

        .pb-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        .pb-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--surface-2);
          border: 1px solid var(--gold);
          color: var(--ink);
          padding: 5px 6px 5px 12px;
          border-radius: 999px;
          font-size: 12px;
        }
        .pb-chip-remove {
          background: transparent;
          border: none;
          color: var(--ink-muted);
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 4px;
        }
        .pb-chip-remove:hover { color: var(--red); }
        .pb-chip-clear {
          background: transparent;
          border: none;
          color: var(--ink-muted);
          text-decoration: underline;
          font-size: 12px;
          cursor: pointer;
          padding: 4px 2px;
        }

        .pb-cinema-rows { display: flex; flex-direction: column; gap: 14px; }
        .pb-cinema-card {
          border: 1px solid var(--line);
          background: var(--surface-2);
          border-radius: 10px;
          padding: 14px 14px 4px;
        }
        .pb-cinema-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .pb-cinema-card-index {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-muted);
        }
        .pb-cinema-card-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--ink);
          margin-top: 2px;
        }

        .pb-two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .pb-cinema-remove {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--ink-muted);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11.5px;
          cursor: pointer;
        }
        .pb-cinema-remove:hover { border-color: var(--red); color: var(--red); }
        .pb-add-cinema {
          width: 100%;
          margin-top: 4px;
          padding: 10px;
          border-radius: 9px;
          border: 1px dashed var(--line);
          background: transparent;
          color: var(--ink-muted);
          font-size: 13px;
          cursor: pointer;
        }
        .pb-add-cinema:hover { border-color: var(--gold); color: var(--gold); }

        .pb-pill-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .pb-pill {
          border: 1px solid var(--line);
          background: var(--surface-2);
          color: var(--ink);
          padding: 9px 14px;
          border-radius: 999px;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          gap: 8px;
          align-items: baseline;
          transition: border-color 0.15s, background 0.15s;
        }
        .pb-pill:hover { border-color: var(--gold); }
        .pb-pill.active {
          background: var(--red);
          border-color: var(--red);
          color: #fff;
        }
        .pb-pill-price {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          opacity: 0.8;
        }
        .pb-pill-price-muted { opacity: 0.55; font-style: italic; }

        .pb-field-warning {
          margin-top: 6px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--gold);
        }
        .pb-date-blocked-warning {
          margin-top: 6px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--red);
        }
        .pb-date-surge-note {
          margin-top: 6px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--gold);
        }

        .pb-audi-hint {
          font-size: 12.5px;
          color: var(--ink-muted);
          padding: 10px 0 0;
        }
        .pb-audi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          grid-auto-flow: column;
          gap: 10px;
        }
        .pb-audi-card {
          border: 1px solid var(--line);
          background: var(--surface-2);
          border-radius: 10px;
          padding: 12px 14px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
          position: relative;
        }
        .pb-audi-card:hover { border-color: var(--gold); }
        .pb-audi-card.active { border-color: var(--red); background: #2a1c1c; }
        .pb-audi-card-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 4px;
        }
        .pb-audi-name { font-size: 13.5px; font-weight: 700; color: var(--ink); }
        .pb-audi-badge {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--bg);
          background: var(--gold);
          padding: 2px 6px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .pb-audi-capacity { font-size: 12px; color: var(--ink-muted); margin-bottom: 2px; }
        .pb-audi-rate { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-muted); margin-bottom: 6px; }
        .pb-audi-required {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          font-weight: 700;
          color: var(--gold);
          margin-top: 4px;
        }
        .pb-audi-note {
          font-size: 11px;
          line-height: 1.4;
          color: var(--gold);
          margin-top: 4px;
        }
        .pb-audi-subtotal {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 14px;
          font-weight: 700;
          color: var(--ink);
          margin-top: 6px;
        }
        .pb-audi-combined-capacity {
          font-size: 12px;
          line-height: 1.4;
          color: var(--ink-muted);
          margin-top: 8px;
        }
        .pb-audi-combined-capacity.warning { color: var(--gold); }

        .pb-combo-list { display: flex; flex-direction: column; gap: 8px; }
        .pb-combo {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border: 1px solid var(--line);
          background: var(--surface-2);
          border-radius: 10px;
          padding: 12px 14px;
          cursor: pointer;
        }
        .pb-combo.active { border-color: var(--gold); background: #2a2320; }
        .pb-combo-name { font-size: 13.5px; font-weight: 600; }
        .pb-combo-items { font-size: 12px; color: var(--ink-muted); margin-top: 2px; }
        .pb-combo-price { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--gold); white-space: nowrap; }

        .pb-stepper {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .pb-stepper button {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: var(--surface-2);
          color: var(--ink);
          font-size: 16px;
          cursor: pointer;
        }
        .pb-stepper input {
          width: 70px;
          text-align: center;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 15px;
        }

        /* Ticket stub */
        .pb-stub-wrap { grid-column: 2; position: sticky; top: 24px; }
        .pb-stub {
          background: var(--stub);
          color: var(--stub-ink);
          border-radius: 14px;
          position: relative;
          overflow: hidden;
          box-shadow: 0 20px 40px -20px rgba(0,0,0,0.6);
        }
        .pb-stub-top { padding: 22px 22px 18px; }
        .pb-stub-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--red);
          margin-bottom: 4px;
        }
        .pb-stub-admit {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 30px;
          letter-spacing: 0.03em;
          line-height: 1.05;
        }
        .pb-stub-estimate { text-align: center; color: var(--red-dim); }
        .pb-stub-sub { font-size: 12.5px; color: #4a4340; margin-top: 2px; }

        .pb-stub-divider {
          position: relative;
          height: 0;
          border-top: 2px dashed #cbbfa8;
          margin: 0 0;
        }
        .pb-stub-divider::before, .pb-stub-divider::after {
          content: '';
          position: absolute;
          top: -11px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--bg);
        }
        .pb-stub-divider::before { left: -11px; }
        .pb-stub-divider::after { right: -11px; }

        .pb-stub-rows { padding: 18px 22px 8px; }
        .pb-stub-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          padding: 6px 0;
          border-bottom: 1px dotted #d8cdb9;
        }
        .pb-stub-row:last-child { border-bottom: none; }
        .pb-stub-row-label { color: #6b6058; }
        .pb-stub-row-value { font-family: 'IBM Plex Mono', monospace; font-weight: 600; text-align: right; max-width: 60%; }

        .pb-stub-cinema-block { padding: 10px 0; border-bottom: 1px dotted #d8cdb9; }
        .pb-stub-cinema-block:last-child { border-bottom: none; }
        .pb-stub-cinema-block .pb-stub-row:last-child { border-bottom: 1px dotted #d8cdb9; }
        .pb-stub-cinema-block .pb-stub-row-subtotal:last-child { border-bottom: none; }
        .pb-stub-cinema-heading {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--red-dim);
          margin-bottom: 4px;
        }
        .pb-stub-row-subtotal .pb-stub-row-label,
        .pb-stub-row-subtotal .pb-stub-row-value { font-weight: 700; color: var(--stub-ink); }

        .pb-tentative-note {
          font-weight: 700;
          font-size: 11.5px;
          color: var(--red-dim);
          padding: 0 22px 14px;
        }
        .pb-tentative-note.small {
          padding: 6px 0 4px;
          font-size: 10.5px;
        }

        .pb-stub-total {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 14px 22px 6px;
        }
        .pb-stub-total-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6058; }
        .pb-stub-total-value { font-family: 'IBM Plex Mono', monospace; font-size: 26px; font-weight: 600; color: var(--red-dim); }

        .pb-barcode {
          display: flex;
          gap: 2px;
          padding: 0 22px 18px;
          align-items: stretch;
          height: 34px;
        }
        .pb-barcode span { display: block; background: var(--stub-ink); }

        .pb-actions { padding: 0 22px 22px; display: flex; gap: 10px; }
        .pb-btn {
          flex: 1;
          padding: 12px 14px;
          border-radius: 9px;
          font-size: 13.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          cursor: pointer;
          border: none;
        }
        .pb-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .pb-btn-primary { background: var(--red); color: #fff; }
        .pb-btn-secondary { background: transparent; color: #6b6058; border: 1px solid #cbbfa8; }

        .pb-contact-note { padding: 0 22px 4px; font-size: 11.5px; color: #8a8078; }

        .pb-terms-row {
          padding: 4px 22px 14px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 12.5px;
          color: #6b6058;
        }
        .pb-terms-row input[type="checkbox"] {
          width: 15px;
          height: 15px;
          accent-color: var(--red);
          cursor: pointer;
          flex-shrink: 0;
        }
        .pb-terms-row label { cursor: pointer; }
        .pb-terms-row a {
          margin-left: auto;
          color: var(--red);
          font-weight: 600;
          text-decoration: none;
          white-space: nowrap;
        }
        .pb-terms-row a:hover { text-decoration: underline; }

        .pb-error {
          margin: 0 22px 14px;
          padding: 10px 12px;
          background: #fbe3e3;
          border: 1px solid #e3a5a5;
          color: #8f2323;
          border-radius: 8px;
          font-size: 12.5px;
        }

        .pb-result {
          padding: 40px 22px;
          text-align: center;
        }
        .pb-result-title { font-family: 'Bebas Neue', sans-serif; font-size: 30px; margin-bottom: 8px; }
        .pb-result-text { font-size: 13.5px; color: #5c534d; max-width: 320px; margin: 0 auto 20px; }
        .pb-result-ref { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--red-dim); margin-bottom: 22px; }
        .pb-btn-reset {
          background: var(--stub-ink);
          color: var(--stub);
          padding: 10px 20px;
          border-radius: 9px;
          border: none;
          font-size: 13px;
          cursor: pointer;
        }

        .pb-empty-stub {
          padding: 60px 24px;
          text-align: center;
          color: var(--ink-muted);
          font-size: 13.5px;
          border: 1px dashed var(--line);
          border-radius: 14px;
        }

        @media (max-width: 860px) {
          .pb-stub-wrap { grid-column: 1; position: static; top: auto; }
        }

        @media (max-width: 480px) {
          .pb-page { padding: 18px 14px 40px; }
          .pb-card { padding: 16px; }

          .pb-top-bar { justify-content: space-between; margin-bottom: 14px; }
          .pb-brand-logo-img { height: 30px; }
          .pb-lookup-trigger { width: auto; padding: 8px 14px; font-size: 12px; min-height: 40px; }

          .pb-title { font-size: clamp(26px, 8vw, 34px); letter-spacing: 0.01em; }
          .pb-subtitle { font-size: 13.5px; max-width: 100%; }

          .pb-input, .pb-select { font-size: 16px; padding: 12px 13px; }
          .pb-combobox input.pb-input { padding-right: 34px; }
          .pb-cinema-card-name, .pb-stub-row-value { overflow-wrap: break-word; word-break: break-word; }

          .pb-btn, .pb-stepper button, .pb-btn-reset, .pb-select-trigger {
            min-height: 44px;
          }
          .pb-stepper button { width: 44px; }
          .pb-pill {
            min-height: 40px;
            padding: 10px 14px;
          }
          .pb-combo { min-height: 44px; }
          .pb-suggestion { min-height: 44px; display: flex; align-items: center; }
          .pb-chip { padding: 7px 8px 7px 14px; font-size: 13px; }
          .pb-chip-remove { min-height: 36px; min-width: 28px; font-size: 15px; }
          .pb-cinema-remove { min-height: 36px; }
          .pb-two-col { grid-template-columns: 1fr; }
          .pb-stub-admit { font-size: 26px; }
          .pb-stub-top, .pb-stub-rows, .pb-stub-total, .pb-actions, .pb-barcode,
          .pb-contact-note, .pb-error, .pb-tentative-note, .pb-terms-row {
            padding-left: 16px;
            padding-right: 16px;
          }
          .pb-actions { flex-direction: column; }
          .pb-modal { padding: 16px; max-height: 90vh; }
          .pb-modal-backdrop { padding: 12px; }
        }
      `}</style>

      <div className="pb-top-bar">
        <button type="button" className="pb-brand-logo" aria-label="PVR INOX — return to booking type choice" onClick={() => setMode(null)}>
          <img className="pb-brand-logo-img" src={PVR_INOX_LOGO_URL} alt="PVR INOX" />
        </button>
        <button type="button" className="pb-lookup-trigger" onClick={openLookupModal}>
          Check a reference number
        </button>
      </div>

      <div className="pb-shell">
        {mode === null && (
          <div className="pb-landing">
            <p className="pb-landing-eyebrow">PVR INOX Group &amp; Private Bookings</p>
            <h1 className="pb-landing-title">What are you <span>planning</span>?</h1>
            <p className="pb-landing-subtitle">
              Choose the type of booking you need a quote for — you can always come back and switch later.
            </p>
            <div className="pb-landing-options">
              <div className="pb-landing-option" onClick={() => setMode('bulkBooking')}>
                <h2 className="pb-landing-option-title">Bulk Booking</h2>
                <p className="pb-landing-option-desc">
                  Reserve a block of tickets across one or more cinemas for a large group, at a shared showtime.
                </p>
                <span className="pb-landing-option-cta">Get a bulk quote &rarr;</span>
              </div>
              <div className="pb-landing-option" onClick={() => setMode('privateScreening')}>
                <h2 className="pb-landing-option-title">Private Screening</h2>
                <p className="pb-landing-option-desc">
                  Book an entire audi just for your group, and compare screens by capacity and price.
                </p>
                <span className="pb-landing-option-cta">Get a private screening quote &rarr;</span>
              </div>
            </div>

            <div className="pb-employee-link-wrap">
              <button
                type="button"
                className="pb-employee-link"
                onClick={() => setMode(isEmployeeLoggedIn ? 'dashboard' : 'employeeLogin')}
              >
                Employee Login
              </button>
            </div>
          </div>
        )}

        {mode === 'employeeLogin' && (
          <div className="pb-landing" style={{ maxWidth: 420 }}>
            <button type="button" className="pb-mode-back" onClick={() => setMode(null)}>
              &larr; Back
            </button>
            <p className="pb-landing-eyebrow">Staff Access</p>
            <h1 className="pb-landing-title">Employee <span>Login</span></h1>
            <p className="pb-landing-subtitle" style={{ margin: '0 auto 24px' }}>
              Sign in to view and manage submitted leads.
            </p>
            <div style={{ textAlign: 'left' }}>
              <div className="pb-field">
                <label className="pb-label">Email</label>
                <input
                  className="pb-input"
                  type="email"
                  value={employeeLoginEmail}
                  onChange={(e) => setEmployeeLoginEmail(e.target.value)}
                  placeholder="you@pvrinox.com"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEmployeeLogin();
                  }}
                />
              </div>
              <div className="pb-field">
                <label className="pb-label">Password</label>
                <input
                  className="pb-input"
                  type="password"
                  value={employeeLoginPassword}
                  onChange={(e) => setEmployeeLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEmployeeLogin();
                  }}
                />
              </div>
              {employeeLoginError && (
                <div className="pb-error" style={{ margin: '0 0 16px' }}>
                  {employeeLoginError}
                </div>
              )}
              <button
                type="button"
                className="pb-btn pb-btn-primary"
                style={{ width: '100%' }}
                onClick={handleEmployeeLogin}
                disabled={employeeLoginSubmitting}
              >
                {employeeLoginSubmitting ? 'Logging in...' : 'Log in'}
              </button>
            </div>
          </div>
        )}

        {mode === 'dashboard' && isEmployeeLoggedIn && (
          <div className="pb-dashboard">
            <div className="pb-dash-header">
              <div>
                <p className="pb-landing-eyebrow" style={{ margin: '0 0 4px' }}>Staff Dashboard</p>
                <h1 className="pb-dash-title">Welcome, {loggedInEmployeeName}</h1>
              </div>
              <button type="button" className="pb-lookup-trigger" onClick={handleEmployeeLogout}>
                Log out
              </button>
            </div>

            {!selectedLead && (
              <>
                <div className="pb-dash-filters">
                  <div className="pb-field" style={{ marginBottom: 0 }}>
                    <label className="pb-label">From</label>
                    <input
                      type="date"
                      className="pb-input"
                      value={dashboardDateFrom}
                      onChange={(e) => setDashboardDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="pb-field" style={{ marginBottom: 0 }}>
                    <label className="pb-label">To</label>
                    <input
                      type="date"
                      className="pb-input"
                      value={dashboardDateTo}
                      onChange={(e) => setDashboardDateTo(e.target.value)}
                    />
                  </div>
                  <div className="pb-field" style={{ marginBottom: 0 }}>
                    <label className="pb-label">Sort by</label>
                    <select className="pb-input" value={dashboardSort} onChange={(e) => setDashboardSort(e.target.value)}>
                      <option value="recent">Most recent</option>
                      <option value="value">Order value</option>
                    </select>
                  </div>
                </div>

                <div className="pb-dash-list">
                  {dashboardLoading && <div className="pb-dash-empty">Loading leads...</div>}
                  {!dashboardLoading && dashboardError && (
                    <div className="pb-dash-empty">
                      Something went wrong loading leads.{' '}
                      <button type="button" className="pb-employee-link" style={{ padding: 0 }} onClick={fetchDashboardLeads}>
                        Retry
                      </button>
                    </div>
                  )}
                  {!dashboardLoading && !dashboardError && dashboardLeads.length === 0 && (
                    <div className="pb-dash-empty">No leads in this date range.</div>
                  )}
                  {!dashboardLoading && !dashboardError && dashboardLeads.map((lead) => (
                    <div key={lead.referenceId} className="pb-dash-row" onClick={() => openLeadDetail(lead.referenceId)}>
                      <span className="pb-dash-row-ref">{lead.referenceId}</span>
                      <span
                        className={
                          'pb-dash-badge ' +
                          (lead.bookingType === 'Private Screening' ? 'pb-dash-badge-ps' : 'pb-dash-badge-bulk')
                        }
                      >
                        {lead.bookingType}
                      </span>
                      <span className="pb-dash-row-name">{lead.customerName}</span>
                      <span className="pb-dash-row-date">{formatSubmittedOn(lead.submittedAt)}</span>
                      <span className="pb-dash-row-total">{formatINR(lead.grandTotal)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {selectedLead && (
              <div className="pb-dash-detail">
                <button type="button" className="pb-mode-back" onClick={closeLeadDetail}>
                  &larr; Back to all leads
                </button>

                <div className="pb-stub">
                  <div className="pb-stub-top">
                    <div className="pb-stub-eyebrow">Reference: {selectedLead.referenceId}</div>
                    <div className="pb-stub-admit" style={{ fontSize: 22 }}>{selectedLead.bookingType}</div>
                    <div className="pb-stub-sub">{formatSubmittedOn(selectedLead.submittedAt)}</div>
                  </div>
                  <div className="pb-stub-divider" />
                  <div className="pb-stub-rows">
                    <div className="pb-stub-row">
                      <span className="pb-stub-row-label">Customer</span>
                      <span className="pb-stub-row-value">{selectedLead.customerName}</span>
                    </div>
                    <div className="pb-stub-row">
                      <span className="pb-stub-row-label">Phone</span>
                      <span className="pb-stub-row-value">{selectedLead.phone}</span>
                    </div>
                    <div className="pb-stub-row">
                      <span className="pb-stub-row-label">Email</span>
                      <span className="pb-stub-row-value">{selectedLead.email}</span>
                    </div>
                  </div>
                  <div className="pb-stub-divider" />
                  <div className="pb-stub-rows">
                    {selectedLead.cinemas.map((c, idx) => {
                      const isPS = c.bookingType === 'Private Screening';
                      return (
                        <div key={idx} className="pb-stub-cinema-block">
                          {selectedLead.cinemas.length > 1 && (
                            <div className="pb-stub-cinema-heading">{idx + 1}. {c.cinema}</div>
                          )}
                          {selectedLead.cinemas.length === 1 && (
                            <div className="pb-stub-row">
                              <span className="pb-stub-row-label">Cinema</span>
                              <span className="pb-stub-row-value">{c.cinema}</span>
                            </div>
                          )}
                          {!isPS && (
                            <div className="pb-stub-row">
                              <span className="pb-stub-row-label">Format</span>
                              <span className="pb-stub-row-value">{c.format}</span>
                            </div>
                          )}
                          {isPS && (
                            <div className="pb-stub-row">
                              <span className="pb-stub-row-label">Audi</span>
                              <span className="pb-stub-row-value">
                                Audi {c.audiNumber} ({c.audiFormat}, {c.audiCapacity} seats) — {c.requiredTickets} tickets
                                required for {c.desiredAttendees} guests
                              </span>
                            </div>
                          )}
                          {isPS && c.eventType && (
                            <div className="pb-stub-row">
                              <span className="pb-stub-row-label">Event</span>
                              <span className="pb-stub-row-value">
                                {c.eventDetail ? `${c.eventType} — ${c.eventDetail}` : c.eventType}
                              </span>
                            </div>
                          )}
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Date</span>
                            <span className="pb-stub-row-value">{formatPlainDate(c.requestDate)}</span>
                          </div>
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Time slot</span>
                            <span className="pb-stub-row-value">
                              {c.timeSlot} ({c.timeSlotRange})
                            </span>
                          </div>
                          {isPS ? (
                            <div className="pb-stub-row">
                              <span className="pb-stub-row-label">
                                Tickets required ({c.requiredTickets} &times; {formatINR(c.pricePerTicket)})
                              </span>
                              <span className="pb-stub-row-value">{formatINR(c.requiredTickets * c.pricePerTicket)}</span>
                            </div>
                          ) : (
                            <div className="pb-stub-row">
                              <span className="pb-stub-row-label">
                                Tickets ({c.ticketCount} &times; {formatINR(c.pricePerTicket)})
                              </span>
                              <span className="pb-stub-row-value">{formatINR(c.ticketCount * c.pricePerTicket)}</span>
                            </div>
                          )}
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Food</span>
                            <span className="pb-stub-row-value">{c.foodCombo}</span>
                          </div>
                          <div className="pb-stub-row pb-stub-row-subtotal">
                            <span className="pb-stub-row-label">Subtotal</span>
                            <span className="pb-stub-row-value">{formatINR(c.subtotal)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pb-stub-total">
                    <span className="pb-stub-total-label">Grand total</span>
                    <span className="pb-stub-total-value">{formatINR(selectedLead.grandTotal)}</span>
                  </div>
                  <div className="pb-barcode">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <span key={i} style={{ width: (i % 5 === 0 ? 3 : 1.5) + 'px' }} />
                    ))}
                  </div>
                </div>

                {!piData && (
                  <button
                    type="button"
                    className="pb-btn pb-btn-primary"
                    style={{ marginTop: 16, width: '100%' }}
                    onClick={() => startPiEditor(selectedLead)}
                    disabled={piSaving}
                  >
                    {piSaving ? 'Creating...' : 'Create PI'}
                  </button>
                )}

                {piData && (
                  <div className="pb-pi-form">
                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Company Details</div>
                      <div className="pb-pi-field">
                        <label>Company Name</label>
                        <input value={piData.companyName} onChange={(e) => updatePiField('companyName', e.target.value)} />
                      </div>
                      <div className="pb-pi-field">
                        <label>Company Address</label>
                        <textarea
                          rows={2}
                          value={piData.companyAddress}
                          onChange={(e) => updatePiField('companyAddress', e.target.value)}
                        />
                      </div>
                      <div className="pb-pi-grid-3">
                        <div className="pb-pi-field">
                          <label>GST No</label>
                          <input value={piData.gstNo} onChange={(e) => updatePiField('gstNo', e.target.value)} />
                        </div>
                        <div className="pb-pi-field">
                          <label>PAN No</label>
                          <input value={piData.panNo} onChange={(e) => updatePiField('panNo', e.target.value)} />
                        </div>
                        <div className="pb-pi-field">
                          <label>CIN No</label>
                          <input value={piData.cinNo} onChange={(e) => updatePiField('cinNo', e.target.value)} />
                        </div>
                      </div>
                    </div>

                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Invoice Details</div>
                      <div className="pb-pi-grid-3">
                        <div className="pb-pi-field">
                          <label>Ref No</label>
                          <input value={piData.refNo} onChange={(e) => updatePiField('refNo', e.target.value)} placeholder="—" />
                        </div>
                        <div className="pb-pi-field">
                          <label>Date</label>
                          <input value={piData.date} onChange={(e) => updatePiField('date', e.target.value)} />
                        </div>
                        <div className="pb-pi-field">
                          <label>PINV No</label>
                          <input value={piData.pinvNo} onChange={(e) => updatePiField('pinvNo', e.target.value)} placeholder="—" />
                        </div>
                      </div>
                    </div>

                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Party Details</div>
                      <div className="pb-pi-field">
                        <label>Party Name</label>
                        <input value={piData.partyName} onChange={(e) => updatePiField('partyName', e.target.value)} />
                      </div>
                      <div className="pb-pi-field">
                        <label>Party Address</label>
                        <textarea
                          rows={2}
                          value={piData.partyAddress}
                          onChange={(e) => updatePiField('partyAddress', e.target.value)}
                          placeholder="Billing address"
                        />
                      </div>
                    </div>

                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Line Items</div>
                      <div className="pb-pi-table-header">
                        <span>Description</span>
                        <span>Qty</span>
                        <span>Rate</span>
                        <span>Amount</span>
                        <span />
                      </div>
                      {piData.lineItems.map((item) => (
                        <div key={item.id} className="pb-pi-table-row">
                          <input
                            value={item.description}
                            onChange={(e) => updatePiLineItem(item.id, 'description', e.target.value)}
                            placeholder="Description"
                          />
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updatePiLineItem(item.id, 'quantity', e.target.value)}
                          />
                          <input
                            type="number"
                            value={item.rate}
                            onChange={(e) => updatePiLineItem(item.id, 'rate', e.target.value)}
                          />
                          <input
                            type="number"
                            value={item.amount}
                            onChange={(e) => updatePiLineItem(item.id, 'amount', e.target.value)}
                          />
                          <button
                            type="button"
                            className="pb-pi-row-remove"
                            onClick={() => removePiLineItem(item.id)}
                            aria-label="Remove line item"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                      <button type="button" className="pb-pi-add-row" onClick={addPiLineItem}>
                        + Add line item
                      </button>
                    </div>

                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Totals</div>
                      <div className="pb-pi-total-row">
                        <span>Net Value</span>
                        <input
                          type="number"
                          value={piNetValueOverride !== null ? piNetValueOverride : piNetValue}
                          onChange={(e) => setPiNetValueOverride(e.target.value)}
                        />
                        {piNetValueOverride !== null && (
                          <button type="button" className="pb-pi-reset-btn" onClick={() => setPiNetValueOverride(null)}>
                            Reset
                          </button>
                        )}
                      </div>
                      <div className="pb-pi-field">
                        <label>GST Number (for this invoice)</label>
                        <input
                          value={piData.gstNumberForInvoice}
                          onChange={(e) => updatePiField('gstNumberForInvoice', e.target.value)}
                        />
                      </div>
                      <div className="pb-pi-total-row">
                        <span>GST Amount (18%)</span>
                        <input
                          type="number"
                          value={piGstAmountOverride !== null ? piGstAmountOverride : piGstAmount}
                          onChange={(e) => setPiGstAmountOverride(e.target.value)}
                        />
                        {piGstAmountOverride !== null && (
                          <button type="button" className="pb-pi-reset-btn" onClick={() => setPiGstAmountOverride(null)}>
                            Reset
                          </button>
                        )}
                      </div>
                      <div className="pb-pi-total-row pb-pi-total-row-grand">
                        <span>Total</span>
                        <input
                          type="number"
                          value={piTotalOverride !== null ? piTotalOverride : piTotal}
                          onChange={(e) => setPiTotalOverride(e.target.value)}
                        />
                        {piTotalOverride !== null && (
                          <button type="button" className="pb-pi-reset-btn" onClick={() => setPiTotalOverride(null)}>
                            Reset
                          </button>
                        )}
                      </div>
                      <div className="pb-pi-field">
                        <label>Amount in Words</label>
                        <div className="pb-pi-words-row">
                          <textarea
                            rows={2}
                            value={piAmountInWordsOverride !== null ? piAmountInWordsOverride : piAmountInWords}
                            onChange={(e) => setPiAmountInWordsOverride(e.target.value)}
                          />
                          {piAmountInWordsOverride !== null && (
                            <button
                              type="button"
                              className="pb-pi-reset-btn"
                              onClick={() => setPiAmountInWordsOverride(null)}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="pb-pi-field">
                        <label>Payment Terms</label>
                        <input value={piData.paymentTerms} onChange={(e) => updatePiField('paymentTerms', e.target.value)} />
                      </div>
                    </div>

                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Notes</div>
                      <textarea
                        className="pb-pi-notes"
                        rows={8}
                        value={piData.notes}
                        onChange={(e) => updatePiField('notes', e.target.value)}
                      />
                    </div>

                    <div className="pb-pi-section">
                      <div className="pb-pi-section-title">Bank Details</div>
                      <div className="pb-pi-grid-2">
                        <div className="pb-pi-field">
                          <label>Account No</label>
                          <input
                            value={piData.bankDetails.accountNo}
                            onChange={(e) => updatePiBankField('accountNo', e.target.value)}
                          />
                        </div>
                        <div className="pb-pi-field">
                          <label>Bank Name</label>
                          <input
                            value={piData.bankDetails.bankName}
                            onChange={(e) => updatePiBankField('bankName', e.target.value)}
                          />
                        </div>
                        <div className="pb-pi-field">
                          <label>Branch</label>
                          <input
                            value={piData.bankDetails.branch}
                            onChange={(e) => updatePiBankField('branch', e.target.value)}
                          />
                        </div>
                        <div className="pb-pi-field">
                          <label>RTGS/NEFT/IFSC</label>
                          <input value={piData.bankDetails.ifsc} onChange={(e) => updatePiBankField('ifsc', e.target.value)} />
                        </div>
                        <div className="pb-pi-field">
                          <label>MICR Code</label>
                          <input
                            value={piData.bankDetails.micrCode}
                            onChange={(e) => updatePiBankField('micrCode', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pb-pi-signature-note">
                      For {piData.companyName} — Authorised Signatory
                      <span> (stamp is added automatically in the generated PDF)</span>
                    </div>

                    {piError && <div className="pb-error">{piError}</div>}

                    {!piSent ? (
                      <div className="pb-pi-actions">
                        <button
                          type="button"
                          className="pb-btn pb-btn-secondary"
                          onClick={handleDownloadPiPdf}
                          disabled={piGeneratingPdf}
                        >
                          {piGeneratingPdf ? 'Generating...' : 'Download PDF'}
                        </button>
                        <button type="button" className="pb-btn pb-btn-primary" onClick={handleSendPi} disabled={piSending}>
                          {piSending ? 'Sending...' : 'Send PI'}
                        </button>
                      </div>
                    ) : (
                      <div className="pb-result">
                        <div className="pb-result-title">PI sent</div>
                        <p className="pb-result-text">The proforma invoice was emailed to {selectedLead.email}.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'bulkBooking' && (
        <div className="pb-grid">
          <div className="pb-grid-left">
            <div className="pb-header">
              <button type="button" className="pb-mode-back" onClick={() => setMode(null)}>
                &larr; Change booking type
              </button>
              <p className="pb-eyebrow"></p>
              <h1 className="pb-title">Get your <span>quote</span> in seconds</h1>
              <p className="pb-subtitle">
                Pick a cinema, tell us about your group, and we will show you an instant estimate.
                Like what you see? Tap Interested and our team will call you to lock in the details.
              </p>
            </div>

            {!bulkBookingData && !bulkDataError && (
              <div className="pb-empty-stub">Loading cinemas&hellip;</div>
            )}

            {bulkDataError && (
              <div className="pb-empty-stub">
                Couldn&apos;t load bulk booking cinemas — please check your connection and try again.
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="pb-btn pb-btn-primary" style={{ flex: 'none', padding: '9px 20px' }} onClick={fetchBulkBookingData}>
                    Retry
                  </button>
                </div>
              </div>
            )}

            {bulkBookingData && (
            /* FORM */
            <div className="pb-card">
                <div className="pb-field">
                  <label className="pb-label">City</label>
                <div className="pb-combobox">
                  <input
                    type="text"
                    className="pb-input"
                    placeholder={selectedCities.length === 0 ? 'Search cities...' : selectedCities.length + ' selected'}
                    value={cityQuery}
                    onChange={(e) => {
                      setCityQuery(e.target.value);
                      setShowCityDropdown(true);
                    }}
                    onFocus={() => setShowCityDropdown(true)}
                    onBlur={() =>
                      setTimeout(() => {
                        setShowCityDropdown(false);
                        setCityQuery('');
                      }, 120)
                    }
                  />
                  <span className="pb-combobox-caret">&#9662;</span>
                </div>
                {selectedCities.length > 0 && (
                  <div className="pb-chip-row">
                    {selectedCities.map((city) => (
                      <span key={city} className="pb-chip">
                        {city}
                        <button
                          type="button"
                          className="pb-chip-remove"
                          onMouseDown={() => toggleCity(city)}
                          aria-label={'Remove ' + city}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <button type="button" className="pb-chip-clear" onMouseDown={() => setSelectedCities([])}>
                      Clear all
                    </button>
                  </div>
                )}
                {showCityDropdown && (
                  <div className="pb-suggestions pb-city-dropdown">
                    {showAllCitiesOption && (
                      <div
                        className={'pb-suggestion pb-city-option' + (selectedCities.length === 0 ? ' active' : '')}
                        onMouseDown={() => setSelectedCities([])}
                      >
                        All cities
                      </div>
                    )}
                    {showDelhiNcrOption && (
                      <div
                        className={'pb-suggestion pb-city-option' + (isNcrSelected ? ' active' : '')}
                        onMouseDown={toggleDelhiNCR}
                      >
                        <input type="checkbox" readOnly checked={isNcrSelected} />
                        Delhi NCR <span className="pb-ncr-hint">({BULK_NCR_CITIES.join(', ')})</span>
                      </div>
                    )}
                    {(showAllCitiesOption || showDelhiNcrOption) && filteredCityOptions.length > 0 && (
                      <div className="pb-city-divider" />
                    )}
                    {filteredCityOptions.map((city) => (
                      <div
                        key={city}
                        className={'pb-suggestion pb-city-option' + (selectedCities.includes(city) ? ' active' : '')}
                        onMouseDown={() => toggleCity(city)}
                      >
                        <input type="checkbox" readOnly checked={selectedCities.includes(city)} /> {city}
                      </div>
                    ))}
                    {filteredCityOptions.length === 0 && !showDelhiNcrOption && (
                      <div className="pb-suggestion" style={{ cursor: 'default' }}>
                        No matching cities.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pb-field" ref={cinemaFieldRef}>
                <label className="pb-label">Cinemas</label>
                <div className="pb-combobox">
                  <input
                    type="text"
                    className="pb-input"
                    placeholder={
                      selectedCinemaNames.length === 0 ? 'Search cinemas...' : selectedCinemaNames.length + ' selected'
                    }
                    value={cinemaQuery}
                    onChange={(e) => {
                      setCinemaQuery(e.target.value);
                      setShowCinemaDropdown(true);
                    }}
                    onFocus={() => setShowCinemaDropdown(true)}
                    onBlur={() =>
                      setTimeout(() => {
                        setShowCinemaDropdown(false);
                        setCinemaQuery('');
                      }, 120)
                    }
                  />
                  <span className="pb-combobox-caret">&#9662;</span>
                </div>
                {showCinemaDropdown && (
                  <div className="pb-suggestions pb-city-dropdown">
                    {cityFilteredCinemaNames.length === 0 && (
                      <div className="pb-suggestion" style={{ cursor: 'default' }}>
                        No cinemas in the selected cities.
                      </div>
                    )}
                    {cityFilteredCinemaNames.length > 0 && filteredCinemaOptions.length === 0 && (
                      <div className="pb-suggestion" style={{ cursor: 'default' }}>
                        No matching cinemas.
                      </div>
                    )}
                    {filteredCinemaOptions.map((c) => (
                      <div
                        key={c}
                        className={'pb-suggestion pb-city-option' + (selectedCinemaNames.includes(c) ? ' active' : '')}
                        onMouseDown={() => toggleCinemaSelection(c)}
                      >
                        <input type="checkbox" readOnly checked={selectedCinemaNames.includes(c)} /> {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>
  
              {computedCinemas.length > 0 && (
                <div className="pb-field">
                  <div className="pb-cinema-rows">
                    {computedCinemas.map((r, idx) => (
                      <div key={r.cinemaName} className="pb-cinema-card">
                        <div className="pb-cinema-card-head">
                          <div>
                            <span className="pb-cinema-card-index">
                              {computedCinemas.length > 1 ? 'Cinema ' + (idx + 1) : 'Cinema'}
                            </span>
                            <div className="pb-cinema-card-name">{r.cinemaName}</div>
                          </div>
                          <button type="button" className="pb-cinema-remove" onClick={() => removeCinema(r.cinemaName)}>
                            Remove
                          </button>
                        </div>
  
                        <div className="pb-pill-row" style={{ marginBottom: 14 }}>
                          {r.availableFormats.map((f) => (
                            <div
                              key={f.format}
                              className={'pb-pill' + (r.format === f.format ? ' active' : '')}
                              onClick={() => updateCinemaDetail(r.cinemaName, { format: f.format })}
                            >
                              {f.format}
                              {r.timeSlotId ? (
                                <span className="pb-pill-price">{formatINR(f[r.timeSlotId])}/ticket</span>
                              ) : (
                                <span className="pb-pill-price pb-pill-price-muted"></span>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="pb-two-col">
                          <div className="pb-field" style={{ marginBottom: 0 }}>
                            <label className="pb-label">Number of tickets</label>
                            <div className="pb-stepper">
                              <button
                                type="button"
                                onClick={() =>
                                  updateCinemaDetail(r.cinemaName, {
                                    ticketCountInput: String(Math.max(MIN_TICKET_COUNT, r.ticketCount - 1)),
                                  })
                                }
                              >
                                -
                              </button>
                              <input
                                className="pb-input"
                                type="number"
                                min={MIN_TICKET_COUNT}
                                value={r.ticketCountInput}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '' || /^[0-9]+$/.test(v)) updateCinemaDetail(r.cinemaName, { ticketCountInput: v });
                                }}
                                onBlur={() => {
                                  if (
                                    r.ticketCountInput === '' ||
                                    Math.max(0, parseInt(r.ticketCountInput, 10) || 0) < MIN_TICKET_COUNT
                                  ) {
                                    updateCinemaDetail(r.cinemaName, { ticketCountInput: String(MIN_TICKET_COUNT) });
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => updateCinemaDetail(r.cinemaName, { ticketCountInput: String(r.ticketCount + 1) })}
                              >
                                +
                              </button>
                            </div>
                            {r.ticketCountInput !== '' && r.ticketCount < MIN_TICKET_COUNT && (
                              <div className="pb-field-warning">Minimum group size is {MIN_TICKET_COUNT} tickets</div>
                            )}
                          </div>

                          <div className="pb-field" style={{ marginBottom: 0 }}>
                            <label className="pb-label">Request date</label>
                            <input
                              className="pb-input"
                              type="date"
                              min={minDateStr}
                              value={r.requestDate}
                              onChange={(e) => updateCinemaDetail(r.cinemaName, { requestDate: e.target.value })}
                            />
                            <div className="pb-date-help">You can only select a date 15 or more days from today.</div>
                            {r.dateAdjustment && r.dateAdjustment.blocked && (
                              <div className="pb-date-blocked-warning">{r.dateAdjustment.label}</div>
                            )}
                            {r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier && (
                              <div className="pb-date-surge-note">{formatSurgeNote(r.dateAdjustment)}</div>
                            )}
                          </div>
                        </div>

                        <div className="pb-two-col" style={{ marginTop: 14 }}>
                          <div className="pb-field" style={{ marginBottom: 0 }}>
                            <label className="pb-label">Time slot</label>
                            <button
                              type="button"
                              className="pb-input pb-select-trigger"
                              onClick={() =>
                                updateCinemaDetail(r.cinemaName, { timeSlotDropdownOpen: !r.timeSlotDropdownOpen })
                              }
                              onBlur={() =>
                                setTimeout(() => updateCinemaDetail(r.cinemaName, { timeSlotDropdownOpen: false }), 120)
                              }
                            >
                              <span>{r.activeTimeSlot ? r.activeTimeSlot.label : 'Select a time slot'}</span>
                              <span className="pb-select-caret">&#9662;</span>
                            </button>
                            {r.timeSlotDropdownOpen && (
                              <div className="pb-suggestions pb-food-dropdown">
                                <div className="pb-combo-list">
                                  {TIME_SLOTS.map((t) => (
                                    <div
                                      key={t.id}
                                      className={'pb-combo' + (r.timeSlotId === t.id ? ' active' : '')}
                                      onMouseDown={() =>
                                        updateCinemaDetail(r.cinemaName, { timeSlotId: t.id, timeSlotDropdownOpen: false })
                                      }
                                    >
                                      <div>
                                        <div className="pb-combo-name">{t.label}</div>
                                        <div className="pb-combo-items">{t.range}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="pb-field" style={{ marginBottom: 0 }}>
                            <label className="pb-label">Movie</label>
                            <p className="pb-movie-note">
                              Movies are scheduled by the cinema and can&apos;t be pre-selected here. Check current
                              showtimes at{' '}
                              <a
                                href="https://www.pvrcinemas.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="pb-movie-link"
                              >
                                pvrcinemas.com &rarr;
                              </a>
                            </p>
                          </div>
                        </div>

                        <div className="pb-field" style={{ marginTop: 14, marginBottom: 0 }}>
                          <label className="pb-label">Food &amp; beverages, per person</label>
                          <button
                            type="button"
                            className="pb-input pb-select-trigger"
                            onClick={() => updateCinemaDetail(r.cinemaName, { foodDropdownOpen: !r.foodDropdownOpen })}
                            onBlur={() => setTimeout(() => updateCinemaDetail(r.cinemaName, { foodDropdownOpen: false }), 120)}
                          >
                            <span>{r.activeCombo.label}</span>
                            <span className="pb-select-caret">&#9662;</span>
                          </button>
                          {r.foodDropdownOpen && (
                            <div className="pb-suggestions pb-food-dropdown">
                              <div className="pb-combo-list">
                                {FOOD_COMBOS.map((c) => (
                                  <div
                                    key={c.id}
                                    className={'pb-combo' + (r.foodComboId === c.id ? ' active' : '')}
                                    onMouseDown={() =>
                                      updateCinemaDetail(r.cinemaName, { foodComboId: c.id, foodDropdownOpen: false })
                                    }
                                  >
                                    <div>
                                      <div className="pb-combo-name">{c.label}</div>
                                      <div className="pb-combo-items">{c.items}</div>
                                    </div>
                                    <div className="pb-combo-price">{c.price ? formatINR(c.price) : '—'}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="pb-add-cinema"
                    onClick={() => {
                      setShowCinemaDropdown(true);
                      cinemaFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  >
                    + Add another cinema
                  </button>
                </div>
              )}
            </div>
            )}
          </div>

          {/* TICKET STUB */}
          <div className="pb-stub-wrap">
            {selectedCinemaNames.length === 0 && status === 'form' && (
              <div className="pb-empty-stub">
                Pick a city and select a cinema to start building your live quote — it fills in as you go.
              </div>
            )}

            {selectedCinemaNames.length > 0 && status === 'form' && (
              <div className="pb-stub">
                <div className="pb-stub-top">
                  
                  <div className="pb-stub-admit pb-stub-estimate">ESTIMATE</div>
                  <div className="pb-stub-sub">
                    {computedCinemas.length} cinema{computedCinemas.length > 1 ? 's' : ''} selected
                  </div>
                </div>
                <div className="pb-stub-divider" />
                <div className="pb-stub-rows">
                  {computedCinemas.map((r, idx) => (
                    <div key={r.cinemaName} className="pb-stub-cinema-block">
                      {computedCinemas.length > 1 && (
                        <div className="pb-stub-cinema-heading">{idx + 1}. {r.cinemaName}</div>
                      )}
                      {computedCinemas.length === 1 && (
                        <div className="pb-stub-row">
                          <span className="pb-stub-row-label">Cinema</span>
                          <span className="pb-stub-row-value">{r.cinemaName}</span>
                        </div>
                      )}
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Format</span>
                        <span className="pb-stub-row-value">{r.format}</span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Date</span>
                        <span className="pb-stub-row-value">{r.requestDate || '—'}</span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Time slot</span>
                        <span className="pb-stub-row-value">
                          {r.activeTimeSlot ? `${r.activeTimeSlot.label} (${r.activeTimeSlot.range})` : '—'}
                        </span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">
                          {r.ticketCount > 0 && r.activePrice ? `Tickets (${r.ticketCount} × ${formatINR(r.activePrice)})` : 'Tickets'}
                        </span>
                        <span className="pb-stub-row-value">{r.ticketCount > 0 && r.activePrice ? formatINR(r.ticketTotal) : '—'}</span>
                      </div>
                      {r.dateAdjustment && r.dateAdjustment.blocked && (
                        <div style={{ fontSize: 11, color: 'var(--red-dim)', fontWeight: 700, padding: '0 0 6px', lineHeight: 1.4 }}>
                          {r.dateAdjustment.label}
                        </div>
                      )}
                      {r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier && (
                        <div style={{ fontSize: 11, color: 'var(--red-dim)', padding: '0 0 6px', lineHeight: 1.4 }}>
                          {formatSurgeNote(r.dateAdjustment)}
                        </div>
                      )}
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Food ({r.activeCombo.label})</span>
                        <span className="pb-stub-row-value">{r.foodTotal ? formatINR(r.foodTotal) : '—'}</span>
                      </div>
                      {computedCinemas.length > 1 && (
                        <>
                          <div className="pb-stub-row pb-stub-row-subtotal">
                            <span className="pb-stub-row-label">Subtotal</span>
                            <span className="pb-stub-row-value">{formatINR(r.lineTotal)}</span>
                          </div>
                          <div className="pb-tentative-note small"> Prices are tentative and may vary based on the final ticket price.</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="pb-stub-total">
                  <span className="pb-stub-total-label">
                    {computedCinemas.length > 1 ? 'Combined estimated total' : 'Estimated total'}
                  </span>
                  <span className="pb-stub-total-value">{formatINR(grandTotal)}</span>
                </div>
                <div className="pb-tentative-note">Prices are tentative and may vary based on the final ticket price.</div>
                <div className="pb-barcode">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <span key={i} style={{ width: (i % 5 === 0 ? 3 : 1.5) + 'px' }} />
                  ))}
                </div>

                {quoteReady && (
                  <>
                    <div className="pb-field" style={{ padding: '0 22px', marginBottom: 14 }}>
                      <label className="pb-label" style={{ color: '#6b6058' }}>Your name</label>
                      <input className="pb-input" style={{ background: '#fff', color: '#1c1717', border: '1px solid #cbbfa8' }}
                        value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="pb-field" style={{ padding: '0 22px', marginBottom: 14 }}>
                      <label className="pb-label" style={{ color: '#6b6058' }}>Phone number</label>
                      <input className="pb-input" style={{ background: '#fff', color: '#1c1717', border: '1px solid #cbbfa8' }}
                        value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" />
                    </div>
                    <div className="pb-field" style={{ padding: '0 22px', marginBottom: 4 }}>
                      <label className="pb-label" style={{ color: '#6b6058' }}>Email (optional)</label>
                      <input className="pb-input" style={{ background: '#fff', color: '#1c1717', border: '1px solid #cbbfa8' }}
                        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                    </div>
                    <div className="pb-contact-note">We only use this to follow up on your booking.</div>

                    {formError && <div className="pb-error">{formError}</div>}

                    <div className="pb-terms-row">
                      <input
                        type="checkbox"
                        id="agreedToTerms"
                        checked={agreedToTerms}
                        onChange={(e) => setAgreedToTerms(e.target.checked)}
                      />
                      <label htmlFor="agreedToTerms">I have read and agree to the Terms &amp; Conditions</label>
                      <a href="/PVR_INOX_Terms_and_Conditions.html" target="_blank" rel="noopener noreferrer">
                        View Terms &amp; Conditions
                      </a>
                    </div>

                    <div className="pb-actions">
                      <button className="pb-btn pb-btn-secondary" onClick={downloadQuotePdf}>
                        Download PDF
                      </button>
                      <button className="pb-btn pb-btn-secondary" onClick={handleNotInterested} disabled={status === 'sending'}>
                        Not right now
                      </button>
                      <button className="pb-btn pb-btn-primary" onClick={handleInterested} disabled={status === 'sending' || !agreedToTerms}>
                        {status === 'sending' ? 'Sending...' : "I'm interested"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {status === 'interested' && (
              <div className="pb-stub">
                <div className="pb-result">
                  <div className="pb-result-title">You're all set</div>
                  <p className="pb-result-text">
                    Thanks{confirmedFirstName ? ', ' + confirmedFirstName : ''}! A member of our bulk booking team will call
                    you shortly to confirm details and finalize pricing.
                  </p>
                  <div className="pb-result-ref">Reference: {referenceId}</div>
                  <button className="pb-btn-reset" onClick={handleReset}>Start a new quote</button>
                </div>
              </div>
            )}

            {status === 'declined' && (
              <div className="pb-stub">
                <div className="pb-result">
                  <div className="pb-result-title">No worries</div>
                  <p className="pb-result-text">
                    Thanks for checking us out. Come back anytime you're ready to plan a group screening.
                  </p>
                  <button className="pb-btn-reset" onClick={handleReset}>Start a new quote</button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {mode === 'privateScreening' && (
        <div className="pb-grid">
          <div className="pb-grid-left">
            <div className="pb-header">
              <button type="button" className="pb-mode-back" onClick={() => setMode(null)}>
                &larr; Change booking type
              </button>
              <h1 className="pb-title" style={{ fontSize: 32 }}>Private <span>Screening</span></h1>
              <p className="pb-subtitle">
                Book an entire audi for your group. Pick a city and cinema to start comparing screens.
              </p>
            </div>

            {!privateScreeningData && !dataError && (
              <div className="pb-empty-stub">Loading cinemas&hellip;</div>
            )}

            {dataError && (
              <div className="pb-empty-stub">
                Couldn&apos;t load private screening cinemas — please check your connection and try again.
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="pb-btn pb-btn-primary" style={{ flex: 'none', padding: '9px 20px' }} onClick={fetchPrivateScreeningData}>
                    Retry
                  </button>
                </div>
              </div>
            )}

            {privateScreeningData && (
              <div className="pb-card">
                <div className="pb-field">
                  <label className="pb-label">City</label>
                  <div className="pb-combobox">
                    <input
                      type="text"
                      className="pb-input"
                      placeholder={psSelectedCities.length === 0 ? 'Search cities...' : psSelectedCities.length + ' selected'}
                      value={psCityQuery}
                      onChange={(e) => {
                        setPSCityQuery(e.target.value);
                        setPSShowCityDropdown(true);
                      }}
                      onFocus={() => setPSShowCityDropdown(true)}
                      onBlur={() =>
                        setTimeout(() => {
                          setPSShowCityDropdown(false);
                          setPSCityQuery('');
                        }, 120)
                      }
                    />
                    <span className="pb-combobox-caret">&#9662;</span>
                  </div>
                  {psSelectedCities.length > 0 && (
                    <div className="pb-chip-row">
                      {psSelectedCities.map((city) => (
                        <span key={city} className="pb-chip">
                          {city}
                          <button
                            type="button"
                            className="pb-chip-remove"
                            onMouseDown={() => togglePSCity(city)}
                            aria-label={'Remove ' + city}
                          >
                            &times;
                          </button>
                        </span>
                      ))}
                      <button type="button" className="pb-chip-clear" onMouseDown={() => setPSSelectedCities([])}>
                        Clear all
                      </button>
                    </div>
                  )}
                  {psShowCityDropdown && (
                    <div className="pb-suggestions pb-city-dropdown">
                      {psCityQueryTrimmed === '' && (
                        <div
                          className={'pb-suggestion pb-city-option' + (psSelectedCities.length === 0 ? ' active' : '')}
                          onMouseDown={() => setPSSelectedCities([])}
                        >
                          All cities
                        </div>
                      )}
                      {showPSDelhiNcrOption && (
                        <div
                          className={'pb-suggestion pb-city-option' + (isPSNcrSelected ? ' active' : '')}
                          onMouseDown={togglePSDelhiNCR}
                        >
                          <input type="checkbox" readOnly checked={isPSNcrSelected} />
                          Delhi NCR <span className="pb-ncr-hint">({psNcrCities.join(', ')})</span>
                        </div>
                      )}
                      {(showAllPSCitiesOption || showPSDelhiNcrOption) && filteredPSCityOptions.length > 0 && (
                        <div className="pb-city-divider" />
                      )}
                      {filteredPSCityOptions.map((city) => (
                        <div
                          key={city}
                          className={'pb-suggestion pb-city-option' + (psSelectedCities.includes(city) ? ' active' : '')}
                          onMouseDown={() => togglePSCity(city)}
                        >
                          <input type="checkbox" readOnly checked={psSelectedCities.includes(city)} /> {city}
                        </div>
                      ))}
                      {filteredPSCityOptions.length === 0 && !showPSDelhiNcrOption && (
                        <div className="pb-suggestion" style={{ cursor: 'default' }}>
                          No matching cities.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pb-field" ref={psCinemaFieldRef}>
                  <label className="pb-label">Cinemas</label>
                  <div className="pb-combobox">
                    <input
                      type="text"
                      className="pb-input"
                      placeholder={
                        psSelectedCinemaNames.length === 0 ? 'Search cinemas...' : psSelectedCinemaNames.length + ' selected'
                      }
                      value={psCinemaQuery}
                      onChange={(e) => {
                        setPSCinemaQuery(e.target.value);
                        setPSShowCinemaDropdown(true);
                      }}
                      onFocus={() => setPSShowCinemaDropdown(true)}
                      onBlur={() =>
                        setTimeout(() => {
                          setPSShowCinemaDropdown(false);
                          setPSCinemaQuery('');
                        }, 120)
                      }
                    />
                    <span className="pb-combobox-caret">&#9662;</span>
                  </div>
                  {psShowCinemaDropdown && (
                    <div className="pb-suggestions pb-city-dropdown">
                      {psCityFilteredCinemaNames.length === 0 && (
                        <div className="pb-suggestion" style={{ cursor: 'default' }}>
                          No cinemas in the selected cities.
                        </div>
                      )}
                      {psCityFilteredCinemaNames.length > 0 && filteredPSCinemaOptions.length === 0 && (
                        <div className="pb-suggestion" style={{ cursor: 'default' }}>
                          No matching cinemas.
                        </div>
                      )}
                      {filteredPSCinemaOptions.map((c) => (
                        <div
                          key={c}
                          className={'pb-suggestion pb-city-option' + (psSelectedCinemaNames.includes(c) ? ' active' : '')}
                          onMouseDown={() => togglePSCinemaSelection(c)}
                        >
                          <input type="checkbox" readOnly checked={psSelectedCinemaNames.includes(c)} /> {c}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {computedPSCinemas.length > 0 && (
                  <div className="pb-field" style={{ marginBottom: 0 }}>
                    <div className="pb-cinema-rows">
                      {computedPSCinemas.map((r, idx) => (
                        <div key={r.cinemaName} className="pb-cinema-card">
                          <div className="pb-cinema-card-head">
                            <div>
                              <span className="pb-cinema-card-index">
                                {computedPSCinemas.length > 1 ? 'Cinema ' + (idx + 1) : 'Cinema'}
                              </span>
                              <div className="pb-cinema-card-name">{r.cinemaName}</div>
                            </div>
                            <button type="button" className="pb-cinema-remove" onClick={() => removePSCinema(r.cinemaName)}>
                              Remove
                            </button>
                          </div>

                          <div className="pb-two-col">
                            <div className="pb-field" style={{ marginBottom: 0 }}>
                              <label className="pb-label">Time slot</label>
                              <button
                                type="button"
                                className="pb-input pb-select-trigger"
                                onClick={() =>
                                  updatePSCinemaDetail(r.cinemaName, { timeSlotDropdownOpen: !r.timeSlotDropdownOpen })
                                }
                                onBlur={() =>
                                  setTimeout(() => updatePSCinemaDetail(r.cinemaName, { timeSlotDropdownOpen: false }), 120)
                                }
                              >
                                <span>{r.activeTimeSlot ? r.activeTimeSlot.label : 'Select a time slot'}</span>
                                <span className="pb-select-caret">&#9662;</span>
                              </button>
                              {r.timeSlotDropdownOpen && (
                                <div className="pb-suggestions pb-food-dropdown">
                                  <div className="pb-combo-list">
                                    {TIME_SLOTS.map((t) => (
                                      <div
                                        key={t.id}
                                        className={'pb-combo' + (r.timeSlotId === t.id ? ' active' : '')}
                                        onMouseDown={() =>
                                          updatePSCinemaDetail(r.cinemaName, { timeSlotId: t.id, timeSlotDropdownOpen: false })
                                        }
                                      >
                                        <div>
                                          <div className="pb-combo-name">{t.label}</div>
                                          <div className="pb-combo-items">{t.range}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="pb-field" style={{ marginBottom: 0 }}>
                              <label className="pb-label">Desired attendees</label>
                              <div className="pb-stepper">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updatePSCinemaDetail(r.cinemaName, {
                                      desiredAttendeesInput: String(Math.max(0, r.desiredAttendees - 1)),
                                    })
                                  }
                                >
                                  -
                                </button>
                                <input
                                  className="pb-input"
                                  type="number"
                                  min={0}
                                  placeholder="0"
                                  value={r.desiredAttendeesInput}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === '' || /^[0-9]+$/.test(v)) updatePSCinemaDetail(r.cinemaName, { desiredAttendeesInput: v });
                                  }}
                                  onBlur={() => {
                                    if (r.desiredAttendeesInput !== '' && (parseInt(r.desiredAttendeesInput, 10) || 0) < 0) {
                                      updatePSCinemaDetail(r.cinemaName, { desiredAttendeesInput: '0' });
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updatePSCinemaDetail(r.cinemaName, { desiredAttendeesInput: String(r.desiredAttendees + 1) })
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="pb-two-col" style={{ marginTop: 14 }}>
                            <div className="pb-field" style={{ marginBottom: 0 }}>
                              <label className="pb-label">Request date</label>
                              <input
                                className="pb-input"
                                type="date"
                                min={minDateStr}
                                value={r.requestDate}
                                onChange={(e) => updatePSCinemaDetail(r.cinemaName, { requestDate: e.target.value })}
                              />
                              <div className="pb-date-help">You can only select a date 15 or more days from today.</div>
                              {r.dateAdjustment && r.dateAdjustment.blocked && (
                                <div className="pb-date-blocked-warning">{r.dateAdjustment.label}</div>
                              )}
                              {r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier && (
                                <div className="pb-date-surge-note">{formatSurgeNote(r.dateAdjustment)}</div>
                              )}
                            </div>

                            <div className="pb-field" style={{ marginBottom: 0 }}>
                              <label className="pb-label">
                                Event type<span className="pb-required">*</span>
                              </label>
                              <div className="pb-combobox">
                                <input
                                  type="text"
                                  className="pb-input"
                                  placeholder={r.eventType || 'Search event types...'}
                                  value={r.eventTypeQuery || ''}
                                  onChange={(e) =>
                                    updatePSCinemaDetail(r.cinemaName, { eventTypeQuery: e.target.value, eventTypeDropdownOpen: true })
                                  }
                                  onFocus={() => updatePSCinemaDetail(r.cinemaName, { eventTypeDropdownOpen: true })}
                                  onBlur={() =>
                                    setTimeout(
                                      () => updatePSCinemaDetail(r.cinemaName, { eventTypeDropdownOpen: false, eventTypeQuery: '' }),
                                      120
                                    )
                                  }
                                />
                                <span className="pb-combobox-caret">&#9662;</span>
                              </div>
                              {r.eventTypeDropdownOpen && (
                                <div className="pb-suggestions pb-city-dropdown">
                                  {EVENT_TYPES.filter((et) =>
                                    et.toLowerCase().includes((r.eventTypeQuery || '').trim().toLowerCase())
                                  ).map((et) => (
                                    <div
                                      key={et}
                                      className={'pb-suggestion pb-city-option' + (r.eventType === et ? ' active' : '')}
                                      onMouseDown={() =>
                                        updatePSCinemaDetail(r.cinemaName, {
                                          eventType: et,
                                          eventTypeQuery: '',
                                          eventTypeDropdownOpen: false,
                                        })
                                      }
                                    >
                                      {et}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <input
                                className="pb-input"
                                style={{ marginTop: 8 }}
                                placeholder={r.eventType === 'Movie' ? 'Which movie?' : 'Any additional details (optional)'}
                                value={r.eventDetail}
                                onChange={(e) => updatePSCinemaDetail(r.cinemaName, { eventDetail: e.target.value })}
                                required={r.eventType === 'Movie' || r.eventType === 'Other'}
                              />
                            </div>
                          </div>

                          <div className="pb-field" style={{ marginTop: 14, marginBottom: 0 }}>
                            <label className="pb-label">Food &amp; beverages, per person</label>
                            <button
                              type="button"
                              className="pb-input pb-select-trigger"
                              onClick={() => updatePSCinemaDetail(r.cinemaName, { foodDropdownOpen: !r.foodDropdownOpen })}
                              onBlur={() => setTimeout(() => updatePSCinemaDetail(r.cinemaName, { foodDropdownOpen: false }), 120)}
                            >
                              <span>{r.activeCombo.label}</span>
                              <span className="pb-select-caret">&#9662;</span>
                            </button>
                            {r.foodDropdownOpen && (
                              <div className="pb-suggestions pb-food-dropdown">
                                <div className="pb-combo-list">
                                  {FOOD_COMBOS.map((c) => (
                                    <div
                                      key={c.id}
                                      className={'pb-combo' + (r.foodComboId === c.id ? ' active' : '')}
                                      onMouseDown={() =>
                                        updatePSCinemaDetail(r.cinemaName, { foodComboId: c.id, foodDropdownOpen: false })
                                      }
                                    >
                                      <div>
                                        <div className="pb-combo-name">{c.label}</div>
                                        <div className="pb-combo-items">{c.items}</div>
                                      </div>
                                      <div className="pb-combo-price">{c.price ? formatINR(c.price) : '—'}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="pb-field" style={{ marginTop: 14, marginBottom: 0 }}>
                            <label className="pb-label">Choose an audi</label>
                            {!r.timeSlotId && (
                              <div className="pb-audi-hint">Select a time slot above to compare audis.</div>
                            )}
                            {r.timeSlotId && (
                              <>
                                {r.desiredAttendees === 0 && (
                                  <div className="pb-audi-hint">
                                    Enter how many people are attending to see ticket requirements and pricing.
                                  </div>
                                )}
                                <div
                                  className="pb-audi-grid"
                                  style={{
                                    marginTop: r.desiredAttendees === 0 ? 8 : 0,
                                    gridTemplateRows: `repeat(${Math.ceil(r.audiOptions.length / 2)}, auto)`,
                                  }}
                                >
                                  {r.audiOptions.map((a) => (
                                    <div
                                      key={a.audi}
                                      className={'pb-audi-card' + (r.selectedAudiNumbers.includes(a.audi) ? ' active' : '')}
                                      onClick={() => {
                                        const nextNumbers = r.selectedAudiNumbers.includes(a.audi)
                                          ? r.selectedAudiNumbers.filter((n) => n !== a.audi)
                                          : [...r.selectedAudiNumbers, a.audi];
                                        updatePSCinemaDetail(r.cinemaName, { selectedAudiNumbers: nextNumbers });
                                      }}
                                    >
                                      <div className="pb-audi-card-head">
                                        <span className="pb-audi-name">Audi {a.audi} &middot; {a.format}</span>
                                        {r.desiredAttendees > 0 && a.audi === r.cheapestAudiNumber && (
                                          <span className="pb-audi-badge">Cheapest</span>
                                        )}
                                      </div>
                                      <div className="pb-audi-capacity">{a.capacity} seats</div>
                                      <div className="pb-audi-rate">{formatINR(a.rate)}/ticket</div>
                                      {r.desiredAttendees > 0 && (
                                        <>
                                          {a.flooredByMinimum ? (
                                            <div className="pb-audi-note">
                                              You need {r.desiredAttendees} seats — this audi requires a minimum of{' '}
                                              {a.requiredTickets} tickets (90% of its {a.capacity}-seat capacity).
                                            </div>
                                          ) : (
                                            <div className="pb-audi-required">{a.requiredTickets} tickets</div>
                                          )}
                                          <div className="pb-audi-subtotal">{formatINR(a.subtotal)}</div>
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                {r.desiredAttendees > 0 && (
                                  <div
                                    className={
                                      'pb-audi-combined-capacity' +
                                      (r.combinedCapacity < r.desiredAttendees ? ' warning' : '')
                                    }
                                  >
                                    Combined capacity: {r.combinedCapacity} / {r.desiredAttendees} needed
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="pb-add-cinema"
                      onClick={() => {
                        setPSShowCinemaDropdown(true);
                        psCinemaFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      + Add another cinema
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pb-stub-wrap">
            {psSelectedCinemaNames.length === 0 && psStatus === 'form' && (
              <div className="pb-empty-stub">
                Pick a city and select a cinema to start building your live quote — it fills in as you go.
              </div>
            )}

            {psSelectedCinemaNames.length > 0 && psStatus === 'form' && (
              <div className="pb-stub">
                <div className="pb-stub-top">
                  <div className="pb-stub-admit pb-stub-estimate">ESTIMATE</div>
                  <div className="pb-stub-sub">
                    {computedPSCinemas.length} cinema{computedPSCinemas.length > 1 ? 's' : ''} selected
                  </div>
                </div>
                <div className="pb-stub-divider" />
                <div className="pb-stub-rows">
                  {computedPSCinemas.map((r, idx) => (
                    <div key={r.cinemaName} className="pb-stub-cinema-block">
                      {computedPSCinemas.length > 1 && (
                        <div className="pb-stub-cinema-heading">{idx + 1}. {r.cinemaName}</div>
                      )}
                      {computedPSCinemas.length === 1 && (
                        <div className="pb-stub-row">
                          <span className="pb-stub-row-label">Cinema</span>
                          <span className="pb-stub-row-value">{r.cinemaName}</span>
                        </div>
                      )}
                      {r.selectedAudis.length > 0 ? (
                        r.selectedAudis.map((a) => (
                          <div className="pb-stub-row" key={a.audi}>
                            <span className="pb-stub-row-label">Audi {a.audi}</span>
                            <span className="pb-stub-row-value">
                              ({a.format}, {a.capacity} seats): {a.requiredTickets} tickets × {formatINR(a.rate)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="pb-stub-row">
                          <span className="pb-stub-row-label">Audi</span>
                          <span className="pb-stub-row-value">—</span>
                        </div>
                      )}
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Event</span>
                        <span className="pb-stub-row-value">
                          {r.eventType ? (r.eventDetail ? `${r.eventType} — ${r.eventDetail}` : r.eventType) : '—'}
                        </span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Date</span>
                        <span className="pb-stub-row-value">{r.requestDate || '—'}</span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Time slot</span>
                        <span className="pb-stub-row-value">
                          {r.activeTimeSlot ? `${r.activeTimeSlot.label} (${r.activeTimeSlot.range})` : '—'}
                        </span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Attendees</span>
                        <span className="pb-stub-row-value">{r.desiredAttendees > 0 ? r.desiredAttendees : '—'}</span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Tickets subtotal</span>
                        <span className="pb-stub-row-value">{r.ticketSubtotal ? formatINR(r.ticketSubtotal) : '—'}</span>
                      </div>
                      {r.selectedAudis
                        .filter((a) => a.flooredByMinimum)
                        .map((a) => (
                          <div key={a.audi} style={{ fontSize: 11, color: 'var(--red-dim)', padding: '0 0 6px', lineHeight: 1.4 }}>
                            {r.desiredAttendees} attending — Audi {a.audi} requires a minimum of {a.requiredTickets}{' '}
                            tickets (90% of its {a.capacity}-seat capacity).
                          </div>
                        ))}
                      {r.dateAdjustment && r.dateAdjustment.blocked && (
                        <div style={{ fontSize: 11, color: 'var(--red-dim)', fontWeight: 700, padding: '0 0 6px', lineHeight: 1.4 }}>
                          {r.dateAdjustment.label}
                        </div>
                      )}
                      {r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier && (
                        <div style={{ fontSize: 11, color: 'var(--red-dim)', padding: '0 0 6px', lineHeight: 1.4 }}>
                          {formatSurgeNote(r.dateAdjustment)}
                        </div>
                      )}
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">
                          {r.activeCombo && r.activeCombo.id !== 'none' && r.desiredAttendees > 0
                            ? `Food (${r.activeCombo.label}) (${r.desiredAttendees} × ${formatINR(r.activeCombo.price)})`
                            : `Food (${r.activeCombo.label})`}
                        </span>
                        <span className="pb-stub-row-value">{r.foodSubtotal ? formatINR(r.foodSubtotal) : '—'}</span>
                      </div>
                      {computedPSCinemas.length > 1 && (
                        <>
                          <div className="pb-stub-row pb-stub-row-subtotal">
                            <span className="pb-stub-row-label">Subtotal</span>
                            <span className="pb-stub-row-value">{formatINR(r.lineTotal)}</span>
                          </div>
                          <div className="pb-tentative-note small"> Prices are tentative and may vary based on the final ticket price.</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="pb-stub-total">
                  <span className="pb-stub-total-label">
                    {computedPSCinemas.length > 1 ? 'Combined estimated total' : 'Estimated total'}
                  </span>
                  <span className="pb-stub-total-value">{formatINR(psGrandTotal)}</span>
                </div>
                <div className="pb-tentative-note">Prices are tentative and may vary based on the final ticket price.</div>
                <div className="pb-barcode">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <span key={i} style={{ width: (i % 5 === 0 ? 3 : 1.5) + 'px' }} />
                  ))}
                </div>

                {psQuoteReady && (
                  <>
                    <div className="pb-field" style={{ padding: '0 22px', marginBottom: 14 }}>
                      <label className="pb-label" style={{ color: '#6b6058' }}>Your name</label>
                      <input className="pb-input" style={{ background: '#fff', color: '#1c1717', border: '1px solid #cbbfa8' }}
                        value={psName} onChange={(e) => setPSName(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="pb-field" style={{ padding: '0 22px', marginBottom: 14 }}>
                      <label className="pb-label" style={{ color: '#6b6058' }}>Phone number</label>
                      <input className="pb-input" style={{ background: '#fff', color: '#1c1717', border: '1px solid #cbbfa8' }}
                        value={psPhone} onChange={(e) => setPSPhone(e.target.value)} placeholder="10-digit mobile number" />
                    </div>
                    <div className="pb-field" style={{ padding: '0 22px', marginBottom: 4 }}>
                      <label className="pb-label" style={{ color: '#6b6058' }}>Email (optional)</label>
                      <input className="pb-input" style={{ background: '#fff', color: '#1c1717', border: '1px solid #cbbfa8' }}
                        value={psEmail} onChange={(e) => setPSEmail(e.target.value)} placeholder="you@company.com" />
                    </div>
                    <div className="pb-contact-note">We only use this to follow up on your booking.</div>

                    {psFormError && <div className="pb-error">{psFormError}</div>}

                    <div className="pb-terms-row">
                      <input
                        type="checkbox"
                        id="psAgreedToTerms"
                        checked={psAgreedToTerms}
                        onChange={(e) => setPSAgreedToTerms(e.target.checked)}
                      />
                      <label htmlFor="psAgreedToTerms">I have read and agree to the Terms &amp; Conditions</label>
                      <a href="/PVR_INOX_Terms_and_Conditions.html" target="_blank" rel="noopener noreferrer">
                        View Terms &amp; Conditions
                      </a>
                    </div>

                    <div className="pb-actions">
                      <button className="pb-btn pb-btn-secondary" onClick={downloadPSQuotePdf}>
                        Download PDF
                      </button>
                      <button className="pb-btn pb-btn-secondary" onClick={handlePSNotInterested} disabled={psStatus === 'sending'}>
                        Not right now
                      </button>
                      <button className="pb-btn pb-btn-primary" onClick={handlePSInterested} disabled={psStatus === 'sending' || !psAgreedToTerms}>
                        {psStatus === 'sending' ? 'Sending...' : "I'm interested"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {psStatus === 'interested' && (
              <div className="pb-stub">
                <div className="pb-result">
                  <div className="pb-result-title">You're all set</div>
                  <p className="pb-result-text">
                    Thanks{psConfirmedFirstName ? ', ' + psConfirmedFirstName : ''}! A member of our private screening team
                    will call you shortly to confirm details and finalize pricing.
                  </p>
                  <div className="pb-result-ref">Reference: {psReferenceId}</div>
                  <button className="pb-btn-reset" onClick={handlePSReset}>Start a new quote</button>
                </div>
              </div>
            )}

            {psStatus === 'declined' && (
              <div className="pb-stub">
                <div className="pb-result">
                  <div className="pb-result-title">No worries</div>
                  <p className="pb-result-text">
                    Thanks for checking us out. Come back anytime you're ready to plan a private screening.
                  </p>
                  <button className="pb-btn-reset" onClick={handlePSReset}>Start a new quote</button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {showLookupModal && (
        <div className="pb-modal-backdrop" onMouseDown={closeLookupModal}>
          <div className="pb-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="pb-modal-head">
              <h2 className="pb-modal-title">Check a reference number</h2>
              <button type="button" className="pb-modal-close" onClick={closeLookupModal} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="pb-field" style={{ marginBottom: 12 }}>
              <label className="pb-label">Reference number</label>
              <input
                className="pb-input"
                placeholder="PVX-XXXXXX"
                value={lookupRef}
                onChange={(e) => setLookupRef(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLookup();
                }}
              />
            </div>

            <button
              type="button"
              className="pb-btn pb-btn-primary"
              style={{ width: '100%' }}
              onClick={handleLookup}
              disabled={lookupStatus === 'loading' || !lookupRef.trim()}
            >
              {lookupStatus === 'loading' ? 'Looking up...' : 'Look up'}
            </button>

            {lookupStatus === 'not-found' && (
              <div className="pb-lookup-message">
                We couldn't find a request with that reference number — double check it and try again.
              </div>
            )}
            {lookupStatus === 'error' && (
              <div className="pb-lookup-message">
                Something went wrong looking that up — please try again in a moment.
              </div>
            )}

            {lookupStatus === 'found' && lookupResult && (
              <div className="pb-stub pb-lookup-result">
                <div className="pb-stub-top">
                  <div className="pb-stub-eyebrow">Reference: {lookupResult.referenceId}</div>
                  <div className="pb-stub-admit" style={{ fontSize: 22 }}>Status: {lookupResult.status || 'Submitted'}</div>
                  <div className="pb-stub-sub">{formatSubmittedOn(lookupResult.timestamp)}</div>
                </div>
                <div className="pb-stub-divider" />
                <div className="pb-stub-rows">
                  {(lookupResult.cinemas || []).map((c, idx) => {
                    const isPrivateScreening = c.bookingType === 'Private Screening';
                    return (
                      <div key={idx} className="pb-stub-cinema-block">
                        {lookupResult.cinemas.length > 1 && (
                          <div className="pb-stub-cinema-heading">{idx + 1}. {c.cinema}</div>
                        )}
                        {lookupResult.cinemas.length === 1 && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Cinema</span>
                            <span className="pb-stub-row-value">{c.cinema}</span>
                          </div>
                        )}
                        {!isPrivateScreening && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Format</span>
                            <span className="pb-stub-row-value">{c.format}</span>
                          </div>
                        )}
                        {isPrivateScreening && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Audi</span>
                            <span className="pb-stub-row-value">
                              Audi {c.audiNumber} ({c.audiFormat}, {c.audiCapacity} seats) — {c.requiredTickets} tickets
                              required for {c.desiredAttendees} guests
                            </span>
                          </div>
                        )}
                        {isPrivateScreening && c.eventType && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Event</span>
                            <span className="pb-stub-row-value">
                              {c.eventDetail ? `${c.eventType} — ${c.eventDetail}` : c.eventType}
                            </span>
                          </div>
                        )}
                        {!isPrivateScreening && c.movieName && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Movie</span>
                            <span className="pb-stub-row-value">{c.movieName}</span>
                          </div>
                        )}
                        <div className="pb-stub-row">
                          <span className="pb-stub-row-label">Date</span>
                          <span className="pb-stub-row-value">{formatPlainDate(c.requestDate)}</span>
                        </div>
                        {c.timeSlot && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Time slot</span>
                            <span className="pb-stub-row-value">
                              {c.timeSlot}{c.timeSlotRange ? ` (${c.timeSlotRange})` : ''}
                            </span>
                          </div>
                        )}
                        {!isPrivateScreening && (
                          <div className="pb-stub-row">
                            <span className="pb-stub-row-label">Tickets</span>
                            <span className="pb-stub-row-value">{c.ticketCount}</span>
                          </div>
                        )}
                        <div className="pb-stub-row">
                          <span className="pb-stub-row-label">Food</span>
                          <span className="pb-stub-row-value">{c.foodCombo}</span>
                        </div>
                        <div className="pb-stub-row pb-stub-row-subtotal">
                          <span className="pb-stub-row-label">Subtotal</span>
                          <span className="pb-stub-row-value">{formatINR(Number(c.subtotal) || 0)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="pb-stub-total">
                  <span className="pb-stub-total-label">Tentative Grand total</span>
                  <span className="pb-stub-total-value">{formatINR(Number(lookupResult.grandTotal) || 0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
