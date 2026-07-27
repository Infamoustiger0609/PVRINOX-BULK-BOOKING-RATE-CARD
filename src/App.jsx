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

export default function App() {
  const [mode, setMode] = useState(null); // null | 'bulkBooking' | 'privateScreening'

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
  // { [cinemaName]: { timeSlotId, desiredAttendeesInput, selectedAudiNumber, requestDate, movieName, foodComboId, foodDropdownOpen, timeSlotDropdownOpen } }
  const [psCinemaDetails, setPSCinemaDetails] = useState({});
  const psCinemaFieldRef = useRef(null);

  const [psReferenceId, setPSReferenceId] = useState(generateReferenceId);
  const [psName, setPSName] = useState('');
  const [psPhone, setPSPhone] = useState('');
  const [psEmail, setPSEmail] = useState('');
  const [psStatus, setPSStatus] = useState('form'); // form | sending | interested | declined
  const [psFormError, setPSFormError] = useState('');
  const [psConfirmedFirstName, setPSConfirmedFirstName] = useState('');

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
      selectedAudiNumber: null,
      requestDate: '',
      movieName: '',
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
      const disabled = desiredAttendees > 0 && a.capacity < desiredAttendees;
      const subtotal = rate != null && requiredTickets != null ? rate * requiredTickets : null;
      return { ...a, ninetyPercentFloor, rate, requiredTickets, flooredByMinimum, disabled, subtotal };
    });

    const cheapestAudiNumber = (() => {
      const valid = rawAudiOptions.filter((a) => !a.disabled && a.subtotal != null);
      if (!valid.length) return null;
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

    const selectedAudi =
      detail.selectedAudiNumber != null ? rawAudiOptions.find((a) => a.audi === detail.selectedAudiNumber) || null : null;

    const ticketSubtotal = selectedAudi && selectedAudi.subtotal != null ? selectedAudi.subtotal : 0;
    const foodSubtotal = activeCombo ? activeCombo.price * desiredAttendees : 0;
    const lineTotal = ticketSubtotal + foodSubtotal;

    return {
      cinemaName,
      city: cinemaEntry.city,
      ...detail,
      desiredAttendees,
      audis,
      audiOptions,
      cheapestAudiNumber,
      selectedAudi,
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
      r.selectedAudi &&
      r.requestDate &&
      r.movieName.trim() &&
      !(r.dateAdjustment && r.dateAdjustment.blocked)
  );
  const psQuoteReady = Boolean(psSelectedCinemaNames.length > 0 && completePSCinemas.length === psSelectedCinemaNames.length);
  const psGrandTotal = computedPSCinemas.reduce((sum, r) => sum + r.lineTotal, 0);

  function toggleCity(city) {
    setSelectedCities((cities) => (cities.includes(city) ? cities.filter((c) => c !== city) : [...cities, city]));
  }

  function toggleDelhiNCR() {
    setSelectedCities((cities) => {
      const allSelected = BULK_NCR_CITIES.every((c) => cities.includes(c));
      if (allSelected) return cities.filter((c) => !BULK_NCR_CITIES.includes(c));
      return Array.from(new Set([...cities, ...BULK_NCR_CITIES]));
    });
  }

  function togglePSCity(city) {
    setPSSelectedCities((cities) => (cities.includes(city) ? cities.filter((c) => c !== city) : [...cities, city]));
  }

  function togglePSDelhiNCR() {
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
          selectedAudiNumber: null,
          requestDate: '',
          movieName: '',
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
      await Promise.all([sendPSLeadEmail(newReferenceId), submitPSLeadToSheet(newReferenceId)]);
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
        ['Audi', `Audi ${r.selectedAudi.audi} (${r.selectedAudi.format}, ${r.selectedAudi.capacity} seats)`],
        ['Movie', r.movieName],
        ['Time slot', `${r.activeTimeSlot.label} (${r.activeTimeSlot.range})`],
        ['Request date', r.requestDate],
        ['Attendees', String(r.desiredAttendees)],
        ['Tickets required', `${r.selectedAudi.requiredTickets} × ${formatINRForPdf(r.selectedAudi.rate)}`],
        ['Food', r.activeCombo ? r.activeCombo.label : 'None'],
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

  async function sendPSLeadEmail(refId) {
    const cinemasSummary = completePSCinemas
      .map((r, idx) => {
        const prefix = completePSCinemas.length > 1 ? idx + 1 + '. ' : '';
        return (
          prefix + r.cinemaName + ' — Private Screening\n' +
          '   Audi: ' + r.selectedAudi.audi + ' (' + r.selectedAudi.format + ', ' + r.selectedAudi.capacity + ' seats)\n' +
          '   Movie: ' + r.movieName + '\n' +
          '   Date: ' + r.requestDate + '\n' +
          '   Time slot: ' + r.activeTimeSlot.label + ' (' + r.activeTimeSlot.range + ')\n' +
          '   Desired attendees: ' + r.desiredAttendees + '\n' +
          '   Required tickets: ' + r.selectedAudi.requiredTickets + ' x ' + formatINR(r.selectedAudi.rate) + ' = ' + formatINR(r.ticketSubtotal) + '\n' +
          (r.dateAdjustment && !r.dateAdjustment.blocked && r.dateAdjustment.multiplier
            ? '   Price adjustment: ' + formatSurgeNote(r.dateAdjustment) + '\n'
            : '') +
          '   Food: ' + (r.activeCombo ? r.activeCombo.label : 'None') + ' x ' + r.desiredAttendees + ' = ' + (r.foodSubtotal ? formatINR(r.foodSubtotal) : 'None') + '\n' +
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
          audiNumber: r.selectedAudi.audi,
          audiFormat: r.selectedAudi.format,
          audiCapacity: r.selectedAudi.capacity,
          requiredTickets: r.selectedAudi.requiredTickets,
          desiredAttendees: r.desiredAttendees,
          timeSlot: r.activeTimeSlot.label,
          timeSlotRange: r.activeTimeSlot.range,
          pricePerTicket: r.selectedAudi.rate,
          requestDate: r.requestDate,
          movieName: r.movieName,
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
      await Promise.all([sendLeadEmail(newReferenceId), submitLeadToSheet(newReferenceId)]);
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
          gap: 7px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px;
          letter-spacing: 0.02em;
          line-height: 1;
          flex-shrink: 0;
          background: transparent;
          border: none;
          padding: 0;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .pb-brand-logo:hover { opacity: 0.8; }
        .pb-brand-pvr, .pb-brand-inox { color: var(--gold); }
        .pb-brand-star { color: var(--ink); font-size: 13px; }
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
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
        .pb-audi-card.disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .pb-audi-card.disabled:hover { border-color: var(--line); }
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
        .pb-audi-note-error { color: var(--red); }
        .pb-audi-subtotal {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 14px;
          font-weight: 700;
          color: var(--ink);
          margin-top: 6px;
        }

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
          .pb-brand-logo { font-size: 18px; gap: 5px; }
          .pb-brand-star { font-size: 10px; }
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
          .pb-contact-note, .pb-error, .pb-tentative-note {
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
          <span className="pb-brand-pvr">PVR</span>
          <span className="pb-brand-star">&#9733;</span>
          <span className="pb-brand-inox">INOX</span>
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

                    <div className="pb-actions">
                      <button className="pb-btn pb-btn-secondary" onClick={downloadQuotePdf}>
                        Download PDF
                      </button>
                      <button className="pb-btn pb-btn-secondary" onClick={handleNotInterested} disabled={status === 'sending'}>
                        Not right now
                      </button>
                      <button className="pb-btn pb-btn-primary" onClick={handleInterested} disabled={status === 'sending'}>
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
                                Movie name<span className="pb-required">*</span>
                              </label>
                              <input
                                className="pb-input"
                                placeholder="Which movie is this for?"
                                value={r.movieName}
                                onChange={(e) => updatePSCinemaDetail(r.cinemaName, { movieName: e.target.value })}
                                required
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
                                <div className="pb-audi-grid" style={{ marginTop: r.desiredAttendees === 0 ? 8 : 0 }}>
                                  {r.audiOptions.map((a) => (
                                    <div
                                      key={a.audi}
                                      className={
                                        'pb-audi-card' +
                                        (r.selectedAudiNumber === a.audi ? ' active' : '') +
                                        (a.disabled ? ' disabled' : '')
                                      }
                                      onClick={() => {
                                        if (!a.disabled) updatePSCinemaDetail(r.cinemaName, { selectedAudiNumber: a.audi });
                                      }}
                                    >
                                      <div className="pb-audi-card-head">
                                        <span className="pb-audi-name">Audi {a.audi} &middot; {a.format}</span>
                                        {!a.disabled && r.desiredAttendees > 0 && a.audi === r.cheapestAudiNumber && (
                                          <span className="pb-audi-badge">Cheapest</span>
                                        )}
                                      </div>
                                      <div className="pb-audi-capacity">{a.capacity} seats</div>
                                      <div className="pb-audi-rate">{formatINR(a.rate)}/ticket</div>
                                      {a.disabled && (
                                        <div className="pb-audi-note pb-audi-note-error">
                                          Group of {r.desiredAttendees} won&apos;t fit — capacity is {a.capacity}.
                                        </div>
                                      )}
                                      {!a.disabled && r.desiredAttendees > 0 && (
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
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Audi</span>
                        <span className="pb-stub-row-value">
                          {r.selectedAudi
                            ? `Audi ${r.selectedAudi.audi} (${r.selectedAudi.format}, ${r.selectedAudi.capacity} seats)`
                            : '—'}
                        </span>
                      </div>
                      <div className="pb-stub-row">
                        <span className="pb-stub-row-label">Movie</span>
                        <span className="pb-stub-row-value">{r.movieName.trim() ? r.movieName : '—'}</span>
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
                        <span className="pb-stub-row-label">
                          {r.selectedAudi
                            ? `Tickets required (${r.selectedAudi.requiredTickets} × ${formatINR(r.selectedAudi.rate)})`
                            : 'Tickets required'}
                        </span>
                        <span className="pb-stub-row-value">{r.ticketSubtotal ? formatINR(r.ticketSubtotal) : '—'}</span>
                      </div>
                      {r.selectedAudi && r.selectedAudi.flooredByMinimum && (
                        <div style={{ fontSize: 11, color: 'var(--red-dim)', padding: '0 0 6px', lineHeight: 1.4 }}>
                          {r.desiredAttendees} attending — this audi requires a minimum of {r.selectedAudi.requiredTickets}{' '}
                          tickets (90% of its {r.selectedAudi.capacity}-seat capacity).
                        </div>
                      )}
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

                    <div className="pb-actions">
                      <button className="pb-btn pb-btn-secondary" onClick={downloadPSQuotePdf}>
                        Download PDF
                      </button>
                      <button className="pb-btn pb-btn-secondary" onClick={handlePSNotInterested} disabled={psStatus === 'sending'}>
                        Not right now
                      </button>
                      <button className="pb-btn pb-btn-primary" onClick={handlePSInterested} disabled={psStatus === 'sending'}>
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
                        {c.movieName && (
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
