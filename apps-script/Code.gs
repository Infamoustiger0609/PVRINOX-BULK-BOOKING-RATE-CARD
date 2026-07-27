/* ---------------------------------------------------------------
   PVR INOX — Group & Private Screening Booking backend

   Paste this whole file into the Apps Script project behind
   APPS_SCRIPT_URL in src/App.jsx (script.google.com -> your project),
   replacing whatever is there now, then re-deploy the web app
   (Deploy -> Manage deployments -> Edit -> New version).

   doPost(e)  — called once per submission ("I'm interested"), with one
                row appended per cinema entry in the quote.
   doGet(e)   — called by the "Check a reference number" lookup, with
                ?ref=PVX-XXXXXX; returns every row for that reference.

   Bulk booking and private screening share one sheet. The "Booking
   Type" column tells them apart; audi-specific columns are simply
   blank for bulk-booking rows.
   ------------------------------------------------------------- */

const SHEET_NAME = 'Leads';

const COLUMNS = [
  'Reference ID',
  'Timestamp',
  'Status',
  'Name',
  'Phone',
  'Email',
  'Booking Type',
  'Cinema',
  'Format',
  'Audi Number',
  'Audi Capacity',
  'Time Slot',
  'Time Slot Range',
  'Price Per Ticket',
  'Ticket Count',
  'Required Tickets',
  'Desired Attendees',
  'Request Date',
  'Movie Name',
  'Food Combo',
  'Subtotal',
  'Grand Total',
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  }
  return sheet;
}

function colIndex_(header, name) {
  return header.indexOf(name);
}

function doPost(e) {
  const sheet = getSheet_();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const body = JSON.parse(e.postData.contents);
  const timestamp = new Date().toISOString();

  (body.cinemas || []).forEach(function (c) {
    const row = COLUMNS.map(function (col) {
      switch (col) {
        case 'Reference ID':
          return body.referenceId;
        case 'Timestamp':
          return timestamp;
        case 'Status':
          return 'Submitted';
        case 'Name':
          return body.name;
        case 'Phone':
          return body.phone;
        case 'Email':
          return body.email;
        case 'Booking Type':
          return c.bookingType || 'Bulk Booking';
        case 'Cinema':
          return c.cinema;
        case 'Format':
          return c.format || c.audiFormat || '';
        case 'Audi Number':
          return c.audiNumber != null ? c.audiNumber : '';
        case 'Audi Capacity':
          return c.audiCapacity != null ? c.audiCapacity : '';
        case 'Time Slot':
          return c.timeSlot || '';
        case 'Time Slot Range':
          return c.timeSlotRange || '';
        case 'Price Per Ticket':
          return c.pricePerTicket;
        case 'Ticket Count':
          return c.ticketCount != null ? c.ticketCount : '';
        case 'Required Tickets':
          return c.requiredTickets != null ? c.requiredTickets : '';
        case 'Desired Attendees':
          return c.desiredAttendees != null ? c.desiredAttendees : '';
        case 'Request Date':
          return c.requestDate;
        case 'Movie Name':
          return c.movieName;
        case 'Food Combo':
          return c.foodCombo;
        case 'Subtotal':
          return c.subtotal;
        case 'Grand Total':
          return body.grandTotal;
        default:
          return '';
      }
    });
    sheet.appendRow(row);
  });

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const ref = e.parameter.ref;
  if (!ref) {
    return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const refCol = colIndex_(header, 'Reference ID');
  const rows = data.slice(1).filter(function (row) {
    return row[refCol] === ref;
  });

  if (!rows.length) {
    return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
  }

  function val(row, name) {
    return row[colIndex_(header, name)];
  }

  const cinemas = rows.map(function (row) {
    return {
      bookingType: val(row, 'Booking Type'),
      cinema: val(row, 'Cinema'),
      format: val(row, 'Format'),
      audiNumber: val(row, 'Audi Number'),
      audiFormat: val(row, 'Format'),
      audiCapacity: val(row, 'Audi Capacity'),
      timeSlot: val(row, 'Time Slot'),
      timeSlotRange: val(row, 'Time Slot Range'),
      pricePerTicket: val(row, 'Price Per Ticket'),
      ticketCount: val(row, 'Ticket Count'),
      requiredTickets: val(row, 'Required Tickets'),
      desiredAttendees: val(row, 'Desired Attendees'),
      requestDate: val(row, 'Request Date'),
      movieName: val(row, 'Movie Name'),
      foodCombo: val(row, 'Food Combo'),
      subtotal: val(row, 'Subtotal'),
    };
  });

  const first = rows[0];
  const result = {
    found: true,
    referenceId: ref,
    status: val(first, 'Status'),
    timestamp: val(first, 'Timestamp'),
    bookingType: val(first, 'Booking Type'),
    cinemas: cinemas,
    grandTotal: val(first, 'Grand Total'),
  };

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
