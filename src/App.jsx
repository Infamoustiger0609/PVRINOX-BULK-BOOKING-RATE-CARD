import React, { useState, useMemo, useRef, useEffect } from 'react';

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

// Cinema -> [{ format, morning, afternoon, evening }] — per-time-slot pricing, sorted cheapest-first per cinema
const CINEMA_DATA = {"INOX AIPL Joy Street Gurugram":[{"format":"Mainstream","morning":383.0,"afternoon":459.6,"evening":505.56}],"INOX Adalaj Gandhinagar":[{"format":"Mainstream","morning":251.0,"afternoon":301.2,"evening":331.32}],"INOX Ahluwalias Kota":[{"format":"Mainstream","morning":267.0,"afternoon":320.4,"evening":352.44}],"INOX Ansal Royal Jodhpur":[{"format":"Mainstream","morning":255.0,"afternoon":306.0,"evening":336.6}],"INOX Arcade Burdwan":[{"format":"Mainstream","morning":251.0,"afternoon":301.2,"evening":331.32}],"INOX Ardee Gurgaon":[{"format":"LUXE & INSIGNIA","morning":1144.0,"afternoon":1372.8,"evening":1510.08}],"INOX Ashoka One Mall Hyderabad":[{"format":"Mainstream","morning":349.0,"afternoon":418.8,"evening":460.68}],"INOX Atria Mall Worli Mumbai":[{"format":"LUXE & INSIGNIA","morning":1369.0,"afternoon":1642.8,"evening":1807.08}],"INOX Auros Mall Guwahati":[{"format":"LUXE & INSIGNIA","morning":842.0,"afternoon":1010.4,"evening":1111.44}],"INOX BMC Bhawani Bhubaneswar":[{"format":"Mainstream","morning":334.0,"afternoon":400.8,"evening":440.88}],"INOX Bellur Forum Howrah":[{"format":"Mainstream","morning":317.0,"afternoon":380.4,"evening":418.44}],"INOX Brookfield Mall Bengaluru":[{"format":"Mainstream","morning":329.0,"afternoon":394.8,"evening":434.28}],"INOX Bund Garden Pune":[{"format":"Mainstream","morning":317.0,"afternoon":380.4,"evening":418.44},{"format":"LUXE & INSIGNIA","morning":694.0,"afternoon":832.8,"evening":916.08}],"INOX CMR Central Vizag":[{"format":"Mainstream","morning":274.0,"afternoon":328.8,"evening":361.68}],"INOX CMR Gajuwaka Vizag":[{"format":"Mainstream","morning":288.0,"afternoon":345.6,"evening":380.16}],"INOX Central Manipal":[{"format":"Mainstream","morning":289.0,"afternoon":346.8,"evening":381.48}],"INOX Centro Mall Mysuru":[{"format":"Mainstream","morning":258.0,"afternoon":309.6,"evening":340.56}],"INOX Century 21 Indore":[{"format":"Mainstream","morning":317.0,"afternoon":380.4,"evening":418.44},{"format":"Club","morning":380.0,"afternoon":456.0,"evening":501.6},{"format":"4DX & MX4D","morning":551.0,"afternoon":661.2,"evening":727.32},{"format":"LUXE & INSIGNIA","morning":679.0,"afternoon":814.8,"evening":896.28}],"INOX Chandan Belgaum":[{"format":"Mainstream","morning":279.0,"afternoon":334.8,"evening":368.28}],"INOX Chitralayaa Vizag":[{"format":"Mainstream","morning":284.0,"afternoon":340.8,"evening":374.88}],"INOX City Center Chennai":[{"format":"Mainstream","morning":216.0,"afternoon":259.2,"evening":285.12}],"INOX City Center Salt Lake Kolkata":[{"format":"Mainstream","morning":344.0,"afternoon":412.8,"evening":454.08}],"INOX City Centre Bhilwara":[{"format":"Mainstream","morning":228.0,"afternoon":273.6,"evening":300.96}],"INOX City Centre Mall Patna":[{"format":"Mainstream","morning":396.0,"afternoon":475.2,"evening":522.72}],"INOX City Mall Gorakhpur":[{"format":"Mainstream","morning":323.0,"afternoon":387.6,"evening":426.36}],"INOX City Mall Raipur":[{"format":"Mainstream","morning":228.0,"afternoon":273.6,"evening":300.96}],"INOX City Pulse Mall Anand":[{"format":"Mainstream","morning":178.0,"afternoon":213.6,"evening":234.96},{"format":"LUXE & INSIGNIA","morning":232.0,"afternoon":278.4,"evening":306.24}],"INOX City Square Ajmer":[{"format":"Mainstream","morning":275.0,"afternoon":330.0,"evening":363.0}],"INOX Crown Mall Lucknow":[{"format":"Mainstream","morning":247.0,"afternoon":296.4,"evening":326.04}],"INOX Crownz Interiorz Mall Faridabad":[{"format":"Mainstream","morning":340.0,"afternoon":408.0,"evening":448.8}],"INOX Crystal Jamnagar":[{"format":"Mainstream","morning":285.0,"afternoon":342.0,"evening":376.2}],"INOX Crystal Palm Jaipur":[{"format":"Mainstream","morning":339.0,"afternoon":406.8,"evening":447.48}],"INOX DB Mall Gwalior":[{"format":"Mainstream","morning":313.0,"afternoon":375.6,"evening":413.16}],"INOX DN Regalia Mall Bhubaneswar":[{"format":"Mainstream","morning":367.0,"afternoon":440.4,"evening":484.44}],"INOX DR World Surat":[{"format":"Mainstream","morning":195.0,"afternoon":234.0,"evening":257.4}],"INOX Dhillon Plaza Zirakpur":[{"format":"Mainstream","morning":312.0,"afternoon":374.4,"evening":411.84}],"INOX EF3 Mall Faridabad":[{"format":"Mainstream","morning":274.0,"afternoon":328.8,"evening":361.68}],"INOX ELPRO Chinchwad Pune":[{"format":"Mainstream","morning":381.0,"afternoon":457.2,"evening":502.92}],"INOX Elements Mall Jaipur":[{"format":"Mainstream","morning":313.0,"afternoon":375.6,"evening":413.16}],"INOX Epicuria Delhi":[{"format":"LUXE & INSIGNIA","morning":1344.0,"afternoon":1612.8,"evening":1774.08}],"INOX Eros Churchgate Mumbai":[{"format":"IMAX","morning":543.0,"afternoon":651.6,"evening":716.76}],"INOX Forum Mall Elgin Kolkata":[{"format":"Mainstream","morning":377.0,"afternoon":452.4,"evening":497.64}],"INOX GMC Panjim Goa":[{"format":"Mainstream","morning":366.0,"afternoon":439.2,"evening":483.12},{"format":"P[XL] & BIGPIX","morning":461.0,"afternoon":553.2,"evening":608.52}],"INOX GSM Mall Hyderabad":[{"format":"Mainstream","morning":339.0,"afternoon":406.8,"evening":447.48}],"INOX GT Central Jaipur":[{"format":"Playhouse & Kiddles","morning":283.0,"afternoon":339.6,"evening":373.56},{"format":"Mainstream","morning":323.0,"afternoon":387.6,"evening":426.36},{"format":"Club","morning":328.0,"afternoon":393.6,"evening":432.96},{"format":"LUXE & INSIGNIA","morning":890.0,"afternoon":1068.0,"evening":1174.8}],"INOX GVK ONE Hyderabad":[{"format":"Mainstream","morning":326.0,"afternoon":391.2,"evening":430.32}],"INOX Garuda Magrath Road Bengaluru":[{"format":"Mainstream","morning":405.0,"afternoon":486.0,"evening":534.6},{"format":"LUXE & INSIGNIA","morning":914.0,"afternoon":1096.8,"evening":1206.48}],"INOX Garuda Swagath Jayanagar Bengaluru":[{"format":"Mainstream","morning":297.0,"afternoon":356.4,"evening":392.04}],"INOX Garuda Yelahanka Bengaluru":[{"format":"Mainstream","morning":316.0,"afternoon":379.2,"evening":417.12}],"INOX Heritage Mall Pune":[{"format":"Mainstream","morning":352.0,"afternoon":422.4,"evening":464.64}],"INOX Himalaya Mall Ahmedabad":[{"format":"Mainstream","morning":305.0,"afternoon":366.0,"evening":402.6},{"format":"LUXE & INSIGNIA","morning":539.0,"afternoon":646.8,"evening":711.48}],"INOX IRIS Broadway Gurugram":[{"format":"Mainstream","morning":297.0,"afternoon":356.4,"evening":392.04}],"INOX Indiabulls Mega Mall Jodhpur":[{"format":"Mainstream","morning":332.0,"afternoon":398.4,"evening":438.24}],"INOX JTM Jaipur":[{"format":"Mainstream","morning":307.0,"afternoon":368.4,"evening":405.24}],"INOX Jai Ganesh Pune":[{"format":"Mainstream","morning":257.0,"afternoon":308.4,"evening":339.24}],"INOX Janak Place Delhi":[{"format":"Mainstream","morning":335.0,"afternoon":402.0,"evening":442.2}],"INOX Jaswant Tuli Mall Nagpur":[{"format":"Mainstream","morning":286.0,"afternoon":343.2,"evening":377.52}],"INOX KP Mall Patna":[{"format":"Mainstream","morning":305.0,"afternoon":366.0,"evening":402.6}],"INOX Korum Thane Mumbai":[{"format":"Mainstream","morning":346.0,"afternoon":415.2,"evening":456.72}],"INOX LEPL Vijaywada":[{"format":"Mainstream","morning":314.0,"afternoon":376.8,"evening":414.48}],"INOX Laila Mall Vijaywada":[{"format":"Mainstream","morning":311.0,"afternoon":373.2,"evening":410.52}],"INOX Lake City Udaipur":[{"format":"Mainstream","morning":277.0,"afternoon":332.4,"evening":365.64}],"INOX Laserplex CR2 Nariman Point Mumbai":[{"format":"Mainstream","morning":506.0,"afternoon":607.2,"evening":667.92},{"format":"LUXE & INSIGNIA","morning":1186.0,"afternoon":1423.2,"evening":1565.52}],"INOX Lido Mall Ulsoor Bengaluru":[{"format":"Mainstream","morning":414.0,"afternoon":496.8,"evening":546.48}],"INOX MP Hyderabad":[{"format":"Mainstream","morning":289.0,"afternoon":346.8,"evening":381.48}],"INOX Madhyamgram Kolkata":[{"format":"Mainstream","morning":308.0,"afternoon":369.6,"evening":406.56}],"INOX Mahindra M5 Ecity Bengaluru":[{"format":"Playhouse & Kiddles","morning":398.0,"afternoon":477.6,"evening":525.36},{"format":"Club","morning":417.0,"afternoon":500.4,"evening":550.44},{"format":"Mainstream","morning":475.0,"afternoon":570.0,"evening":627.0},{"format":"P[XL] & BIGPIX","morning":490.0,"afternoon":588.0,"evening":646.8}],"INOX Maison Jio World Plaza BKC Mumbai":[{"format":"Mainstream","morning":629.0,"afternoon":754.8,"evening":830.28},{"format":"IMAX","morning":868.0,"afternoon":1041.6,"evening":1145.76},{"format":"LUXE & INSIGNIA","morning":1507.0,"afternoon":1808.4,"evening":1989.24}],"INOX Mall of Mysore Mysuru":[{"format":"Mainstream","morning":289.0,"afternoon":346.8,"evening":381.48}],"INOX Mantri Junction JP Nagar Bengaluru":[{"format":"Mainstream","morning":356.0,"afternoon":427.2,"evening":469.92}],"INOX Mantri Square Malleshwaram Bengaluru":[{"format":"Mainstream","morning":329.0,"afternoon":394.8,"evening":434.28},{"format":"IMAX","morning":644.0,"afternoon":772.8,"evening":850.08},{"format":"LUXE & INSIGNIA","morning":793.0,"afternoon":951.6,"evening":1046.76}],"INOX Margao Goa":[{"format":"Mainstream","morning":308.0,"afternoon":369.6,"evening":406.56}],"INOX Megaplex Emerald Mall Lucknow":[{"format":"Playhouse & Kiddles","morning":227.0,"afternoon":272.4,"evening":299.64},{"format":"Mainstream","morning":247.0,"afternoon":296.4,"evening":326.04},{"format":"LUXE & INSIGNIA","morning":604.0,"afternoon":724.8,"evening":797.28}],"INOX Megaplex Inorbit Malad Mumbai":[{"format":"Playhouse & Kiddles","morning":369.0,"afternoon":442.8,"evening":487.08},{"format":"Mainstream","morning":425.0,"afternoon":510.0,"evening":561.0},{"format":"ONYX","morning":440.0,"afternoon":528.0,"evening":580.8},{"format":"SCREEN X","morning":483.0,"afternoon":579.6,"evening":637.56},{"format":"4DX & MX4D","morning":663.0,"afternoon":795.6,"evening":875.16},{"format":"IMAX","morning":683.0,"afternoon":819.6,"evening":901.56},{"format":"LUXE & INSIGNIA","morning":934.0,"afternoon":1120.8,"evening":1232.88}],"INOX Megaplex Oberoi Sky City Mall Borivali Mumbai":[{"format":"Mainstream","morning":481.0,"afternoon":577.2,"evening":634.92},{"format":"4DX & MX4D","morning":693.0,"afternoon":831.6,"evening":914.76},{"format":"IMAX","morning":810.0,"afternoon":972.0,"evening":1069.2},{"format":"LUXE & INSIGNIA","morning":1145.0,"afternoon":1374.0,"evening":1511.4}],"INOX Megaplex Phoenix Mall of Asia Bengaluru":[{"format":"Mainstream","morning":375.0,"afternoon":450.0,"evening":495.0},{"format":"SCREEN X","morning":448.0,"afternoon":537.6,"evening":591.36},{"format":"LUXE & INSIGNIA","morning":965.0,"afternoon":1158.0,"evening":1273.8}],"INOX Megaplex Phoenix Mall of Millennium Wakad Pune":[{"format":"4DX & MX4D","morning":365.0,"afternoon":438.0,"evening":481.8},{"format":"Playhouse & Kiddles","morning":377.0,"afternoon":452.4,"evening":497.64},{"format":"Mainstream","morning":426.0,"afternoon":511.2,"evening":562.32},{"format":"IMAX","morning":710.0,"afternoon":852.0,"evening":937.2},{"format":"LUXE & INSIGNIA","morning":880.0,"afternoon":1056.0,"evening":1161.6}],"INOX Megaplex Phoenix Palassio Lucknow":[{"format":"Playhouse & Kiddles","morning":279.0,"afternoon":334.8,"evening":368.28},{"format":"Mainstream","morning":316.0,"afternoon":379.2,"evening":417.12},{"format":"4DX & MX4D","morning":462.0,"afternoon":554.4,"evening":609.84},{"format":"IMAX","morning":490.0,"afternoon":588.0,"evening":646.8},{"format":"LUXE & INSIGNIA","morning":698.0,"afternoon":837.6,"evening":921.36}],"INOX Metro Cinema Mumbai":[{"format":"Playhouse & Kiddles","morning":377.0,"afternoon":452.4,"evening":497.64},{"format":"Mainstream","morning":413.0,"afternoon":495.6,"evening":545.16},{"format":"LUXE & INSIGNIA","morning":1079.0,"afternoon":1294.8,"evening":1424.28}],"INOX Metro Junction Mall Kalyan Mumbai":[{"format":"Mainstream","morning":301.0,"afternoon":361.2,"evening":397.32},{"format":"LUXE & INSIGNIA","morning":526.0,"afternoon":631.2,"evening":694.32}],"INOX Metro Kolkata":[{"format":"Mainstream","morning":298.0,"afternoon":357.6,"evening":393.36}],"INOX Metropolis Mall Hiland Park Kolkata":[{"format":"Mainstream","morning":319.0,"afternoon":382.8,"evening":421.08}],"INOX NCS Mall Vizianagaram":[{"format":"Mainstream","morning":279.0,"afternoon":334.8,"evening":368.28}],"INOX NCS Square Mall Guwahati":[{"format":"Mainstream","morning":328.0,"afternoon":393.6,"evening":432.96}],"INOX Nakshatra Mall Dadar Mumbai":[{"format":"Mainstream","morning":264.0,"afternoon":316.8,"evening":348.48}],"INOX National Chennai":[{"format":"Mainstream","morning":229.0,"afternoon":274.8,"evening":302.28}],"INOX Nehru Place Delhi":[{"format":"Mainstream","morning":434.0,"afternoon":520.8,"evening":572.88},{"format":"LUXE & INSIGNIA","morning":1187.0,"afternoon":1424.4,"evening":1566.84}],"INOX Nexus (Forum) Whitefield Bengaluru":[{"format":"Mainstream","morning":360.0,"afternoon":432.0,"evening":475.2},{"format":"LUXE & INSIGNIA","morning":889.0,"afternoon":1066.8,"evening":1173.48}],"INOX Nexus Central Indore":[{"format":"Mainstream","morning":304.0,"afternoon":364.8,"evening":401.28},{"format":"LUXE & INSIGNIA","morning":671.0,"afternoon":805.2,"evening":885.72}],"INOX Odeon Delhi":[{"format":"Mainstream","morning":532.0,"afternoon":638.4,"evening":702.24}],"INOX Odeon Mall Hyderabad":[{"format":"Mainstream","morning":314.0,"afternoon":376.8,"evening":414.48}],"INOX Omaxe Greater Noida":[{"format":"Mainstream","morning":323.0,"afternoon":387.6,"evening":426.36},{"format":"LUXE & INSIGNIA","morning":664.0,"afternoon":796.8,"evening":876.48}],"INOX Opal Mall Nadiad":[{"format":"Mainstream","morning":262.0,"afternoon":314.4,"evening":345.84}],"INOX Orchid Mall Kalaburagi":[{"format":"Mainstream","morning":294.0,"afternoon":352.8,"evening":388.08}],"INOX Orion Gorakhpur":[{"format":"Mainstream","morning":338.0,"afternoon":405.6,"evening":446.16}],"INOX Osia Margao Goa":[{"format":"Mainstream","morning":365.0,"afternoon":438.0,"evening":481.8}],"INOX PVS Mall Meerut":[{"format":"Mainstream","morning":317.0,"afternoon":380.4,"evening":418.44}],"INOX Pacific Outlet Mall Jasola Delhi":[{"format":"4DX & MX4D","morning":340.0,"afternoon":408.0,"evening":448.8},{"format":"Mainstream","morning":440.0,"afternoon":528.0,"evening":580.8},{"format":"SCREEN X","morning":497.0,"afternoon":596.4,"evening":656.04},{"format":"P[XL] & BIGPIX","morning":524.0,"afternoon":628.8,"evening":691.68},{"format":"LUXE & INSIGNIA","morning":1074.0,"afternoon":1288.8,"evening":1417.68}],"INOX Palm Beach New Mumbai":[{"format":"Mainstream","morning":338.0,"afternoon":405.6,"evening":446.16},{"format":"LUXE & INSIGNIA","morning":577.0,"afternoon":692.4,"evening":761.64}],"INOX Paras Cinema Nehru Place Delhi":[{"format":"IMAX","morning":533.0,"afternoon":639.6,"evening":703.56}],"INOX Patel Nagar Delhi":[{"format":"Mainstream","morning":345.0,"afternoon":414.0,"evening":455.4}],"INOX Phoenix (LUXE) Velachery Chennai":[{"format":"Mainstream","morning":217.0,"afternoon":260.4,"evening":286.44},{"format":"IMAX","morning":611.0,"afternoon":733.2,"evening":806.52}],"INOX Phoenix Citadel Mall Indore":[{"format":"Playhouse & Kiddles","morning":323.0,"afternoon":387.6,"evening":426.36},{"format":"Mainstream","morning":337.0,"afternoon":404.4,"evening":444.84},{"format":"P[XL] & BIGPIX","morning":392.0,"afternoon":470.4,"evening":517.44},{"format":"LUXE & INSIGNIA","morning":704.0,"afternoon":844.8,"evening":929.28}],"INOX Pink Square Jaipur":[{"format":"Mainstream","morning":322.0,"afternoon":386.4,"evening":425.04}],"INOX Porvorim Panjim Goa":[{"format":"Mainstream","morning":387.0,"afternoon":464.4,"evening":510.84}],"INOX Prabhatam Grand Mall Dhanbad":[{"format":"Mainstream","morning":271.0,"afternoon":325.2,"evening":357.72}],"INOX Prism Mall Hyderabad":[{"format":"Mainstream","morning":336.0,"afternoon":403.2,"evening":443.52}],"INOX Prozone Coimbatore":[{"format":"Mainstream","morning":213.0,"afternoon":255.6,"evening":281.16}],"INOX Prozone Mall Aurangabad":[{"format":"Mainstream","morning":332.0,"afternoon":398.4,"evening":438.24}],"INOX Quest Mall Kolkata":[{"format":"Mainstream","morning":476.0,"afternoon":571.2,"evening":628.32},{"format":"SCREEN X","morning":588.0,"afternoon":705.6,"evening":776.16},{"format":"LUXE & INSIGNIA","morning":1028.0,"afternoon":1233.6,"evening":1356.96}],"INOX R City Ghatkopar Mumbai":[{"format":"Mainstream","morning":416.0,"afternoon":499.2,"evening":549.12},{"format":"IMAX","morning":661.0,"afternoon":793.2,"evening":872.52},{"format":"LUXE & INSIGNIA","morning":857.0,"afternoon":1028.4,"evening":1131.24}],"INOX R Cube Delhi":[{"format":"LUXE & INSIGNIA","morning":1239.0,"afternoon":1486.8,"evening":1635.48}],"INOX R Mall Thane Mumbai":[{"format":"LUXE & INSIGNIA","morning":878.0,"afternoon":1053.6,"evening":1158.96}],"INOX R World Rajkot":[{"format":"Mainstream","morning":275.0,"afternoon":330.0,"evening":363.0}],"INOX RMZ Galleria Yelahanka Bengaluru":[{"format":"Mainstream","morning":354.0,"afternoon":424.8,"evening":467.28},{"format":"IMAX","morning":622.0,"afternoon":746.4,"evening":821.04}],"INOX Race Course Vadodara":[{"format":"Mainstream","morning":250.0,"afternoon":300.0,"evening":330.0}],"INOX Raghuleela Mall Kandivali West Mumbai":[{"format":"Mainstream","morning":321.0,"afternoon":385.2,"evening":423.72}],"INOX Rajarhat Kolkata":[{"format":"Mainstream","morning":356.0,"afternoon":427.2,"evening":469.92}],"INOX Reliance Bhilwara":[{"format":"Mainstream","morning":309.0,"afternoon":370.8,"evening":407.88}],"INOX Reliance Jalandhar":[{"format":"Mainstream","morning":387.0,"afternoon":464.4,"evening":510.84}],"INOX Reliance Mall Rajkot":[{"format":"Mainstream","morning":282.0,"afternoon":338.4,"evening":372.24}],"INOX Reliance Mall Salem":[{"format":"Mainstream","morning":221.0,"afternoon":265.2,"evening":291.72}],"INOX Reliance Mall Surat":[{"format":"Mainstream","morning":288.0,"afternoon":345.6,"evening":380.16}],"INOX Reliance Mega Mall Aurangabad":[{"format":"Mainstream","morning":324.0,"afternoon":388.8,"evening":427.68}],"INOX Reliance Mega Mall Kolhapur":[{"format":"Mainstream","morning":285.0,"afternoon":342.0,"evening":376.2}],"INOX Reliance Vadodara":[{"format":"Mainstream","morning":269.0,"afternoon":322.8,"evening":355.08}],"INOX SBR Horizon Seegehalli Bengaluru":[{"format":"Mainstream","morning":332.0,"afternoon":398.4,"evening":438.24}],"INOX SGBL Square Cuttack":[{"format":"Mainstream","morning":365.0,"afternoon":438.0,"evening":481.8}],"INOX SMR Vinay Metro Mall Hyderabad":[{"format":"Mainstream","morning":356.0,"afternoon":427.2,"evening":469.92}],"INOX SRMT Mall Kakinada":[{"format":"Mainstream","morning":275.0,"afternoon":330.0,"evening":363.0}],"INOX Sapphire Sec 83 Gurugram":[{"format":"Mainstream","morning":349.0,"afternoon":418.8,"evening":460.68}],"INOX Sapphire Sec 90 Gurugram":[{"format":"Mainstream","morning":378.0,"afternoon":453.6,"evening":498.96}],"INOX Sattva Necklace Hyderabad":[{"format":"Mainstream","morning":337.0,"afternoon":404.4,"evening":444.84}],"INOX Shankar Mall Tumkur":[{"format":"Mainstream","morning":312.0,"afternoon":374.4,"evening":411.84},{"format":"LUXE & INSIGNIA","morning":517.0,"afternoon":620.4,"evening":682.44}],"INOX Shipra Mall Ghaziabad":[{"format":"Mainstream","morning":366.0,"afternoon":439.2,"evening":483.12}],"INOX Shriram Ozone Galleria Dhanbad":[{"format":"Mainstream","morning":268.0,"afternoon":321.6,"evening":353.76}],"INOX Smart City Mall Dharwad":[{"format":"Mainstream","morning":278.0,"afternoon":333.6,"evening":366.96}],"INOX Sobha City Thrissur":[{"format":"Mainstream","morning":260.0,"afternoon":312.0,"evening":343.2}],"INOX South City Mall Kolkata":[{"format":"Mainstream","morning":415.0,"afternoon":498.0,"evening":547.8},{"format":"IMAX","morning":643.0,"afternoon":771.6,"evening":848.76},{"format":"LUXE & INSIGNIA","morning":980.0,"afternoon":1176.0,"evening":1293.6}],"INOX Sunny Trade Centre Jaipur":[{"format":"Mainstream","morning":309.0,"afternoon":370.8,"evening":407.88}],"INOX Swabhumi Kolkata":[{"format":"Mainstream","morning":311.0,"afternoon":373.2,"evening":410.52}],"INOX Symphony Mall Bhubaneswar":[{"format":"Mainstream","morning":341.0,"afternoon":409.2,"evening":450.12}],"INOX Taksh Galaxy Mall NH8 Vadodara":[{"format":"Mainstream","morning":298.0,"afternoon":357.6,"evening":393.36}],"INOX Thakur Mall Dahisar Mumbai":[{"format":"Mainstream","morning":351.0,"afternoon":421.2,"evening":463.32}],"INOX The Marina OMR Chennai":[{"format":"Mainstream","morning":231.0,"afternoon":277.2,"evening":304.92},{"format":"P[XL] & BIGPIX","morning":235.0,"afternoon":282.0,"evening":310.2}],"INOX Trillium Amritsar":[{"format":"Mainstream","morning":272.0,"afternoon":326.4,"evening":359.04},{"format":"LUXE & INSIGNIA","morning":581.0,"afternoon":697.2,"evening":766.92}],"INOX Umrao Mall Lucknow":[{"format":"Mainstream","morning":241.0,"afternoon":289.2,"evening":318.12}],"INOX Urban Square Mall Udaipur":[{"format":"Mainstream","morning":293.0,"afternoon":351.6,"evening":386.76},{"format":"LUXE & INSIGNIA","morning":711.0,"afternoon":853.2,"evening":938.52}],"INOX Urvashi Complex Vijaywada":[{"format":"Mainstream","morning":306.0,"afternoon":367.2,"evening":403.92}],"INOX VR Mall Surat":[{"format":"Mainstream","morning":365.0,"afternoon":438.0,"evening":481.8},{"format":"LUXE & INSIGNIA","morning":731.0,"afternoon":877.2,"evening":964.92}],"INOX Vaibhav Amrapali Circle Jaipur":[{"format":"Mainstream","morning":267.0,"afternoon":320.4,"evening":352.44}],"INOX Varun Beach Vizag":[{"format":"Mainstream","morning":279.0,"afternoon":334.8,"evening":368.28}],"INOX Vashi Navi Mumbai":[{"format":"Mainstream","morning":274.0,"afternoon":328.8,"evening":361.68},{"format":"LUXE & INSIGNIA","morning":480.0,"afternoon":576.0,"evening":633.6}],"INOX Vishaal Mall Madurai":[{"format":"Mainstream","morning":235.0,"afternoon":282.0,"evening":310.2}],"INOX Vishal Enclave Rajouri Garden Delhi":[{"format":"4DX & MX4D","morning":395.0,"afternoon":474.0,"evening":521.4},{"format":"Mainstream","morning":471.0,"afternoon":565.2,"evening":621.72},{"format":"IMAX","morning":623.0,"afternoon":747.6,"evening":822.36}],"INOX Worldmark Gurugram":[{"format":"Mainstream","morning":506.0,"afternoon":607.2,"evening":667.92}],"INOX Z Square Kanpur":[{"format":"Mainstream","morning":361.0,"afternoon":433.2,"evening":476.52},{"format":"LUXE & INSIGNIA","morning":956.0,"afternoon":1147.2,"evening":1261.92}],"PVR 3Cs Lajpat Nagar Delhi":[{"format":"Mainstream","morning":345.0,"afternoon":414.0,"evening":455.4}],"PVR 4D Square Mall Motera Ahmedabad":[{"format":"Mainstream","morning":273.0,"afternoon":327.6,"evening":360.36}],"PVR Acropolis Ahmedabad":[{"format":"Mainstream","morning":375.0,"afternoon":450.0,"evening":495.0},{"format":"4DX & MX4D","morning":624.0,"afternoon":748.8,"evening":823.68}],"PVR Aerohub Chennai":[{"format":"Mainstream","morning":224.0,"afternoon":268.8,"evening":295.68}],"PVR Alveal Fun Savvy Mall Coimbatore":[{"format":"Mainstream","morning":220.0,"afternoon":264.0,"evening":290.4}],"PVR Ampa Skywalk Chennai":[{"format":"Mainstream","morning":215.0,"afternoon":258.0,"evening":283.8}],"PVR Anupam Saket Delhi":[{"format":"Mainstream","morning":435.0,"afternoon":522.0,"evening":574.2}],"PVR Arved Transcube Ahmedabad":[{"format":"Mainstream","morning":302.0,"afternoon":362.4,"evening":398.64}],"PVR Atrium Gachibowli Hyderabad":[{"format":"Mainstream","morning":335.0,"afternoon":402.0,"evening":442.2}],"PVR Aura Mall Bhopal":[{"format":"Mainstream","morning":319.0,"afternoon":382.8,"evening":421.08}],"PVR Aura Park Square Whitefield Bengaluru":[{"format":"Mainstream","morning":347.0,"afternoon":416.4,"evening":458.04}],"PVR Avani Kolkata":[{"format":"Mainstream","morning":330.0,"afternoon":396.0,"evening":435.6}],"PVR Avon (Flamez) City Mall Ludhiana":[{"format":"Mainstream","morning":330.0,"afternoon":396.0,"evening":435.6}],"PVR Bhartiya Mall of Bengaluru":[{"format":"Mainstream","morning":347.0,"afternoon":416.4,"evening":458.04},{"format":"P[XL] & BIGPIX","morning":426.0,"afternoon":511.2,"evening":562.32},{"format":"4DX & MX4D","morning":525.0,"afternoon":630.0,"evening":693.0}],"PVR Bokaro":[{"format":"Mainstream","morning":287.0,"afternoon":344.4,"evening":378.84}],"PVR Brahmaputra City Centre Guwahati":[{"format":"Mainstream","morning":354.0,"afternoon":424.8,"evening":467.28}],"PVR CP 67 Mall Mohali":[{"format":"Mainstream","morning":344.0,"afternoon":412.8,"evening":454.08},{"format":"P[XL] & BIGPIX","morning":426.0,"afternoon":511.2,"evening":562.32},{"format":"LUXE & INSIGNIA","morning":1325.0,"afternoon":1590.0,"evening":1749.0}],"PVR Capital Mall Nalasopara Mumbai":[{"format":"Mainstream","morning":355.0,"afternoon":426.0,"evening":468.6}],"PVR Celebration Mall Khanna":[{"format":"Mainstream","morning":286.0,"afternoon":343.2,"evening":377.52}],"PVR Centra Chandigarh":[{"format":"Mainstream","morning":237.0,"afternoon":284.4,"evening":312.84}],"PVR Central Panjagutta Hyderabad":[{"format":"Mainstream","morning":322.0,"afternoon":386.4,"evening":425.04}],"PVR Centrio Mall Dehradun":[{"format":"Mainstream","morning":421.0,"afternoon":505.2,"evening":555.72},{"format":"4DX & MX4D","morning":603.0,"afternoon":723.6,"evening":795.96}],"PVR Cinemagic, Unity One Elegante, NSP, Pitampura":[{"format":"Mainstream","morning":604.0,"afternoon":724.8,"evening":797.28},{"format":"P[XL] & BIGPIX","morning":661.0,"afternoon":793.2,"evening":872.52},{"format":"LUXE & INSIGNIA","morning":1628.0,"afternoon":1953.6,"evening":2148.96}],"PVR Cinemall Kota":[{"format":"Mainstream","morning":287.0,"afternoon":344.4,"evening":378.84}],"PVR Citi Mall Andheri Mumbai":[{"format":"Mainstream","morning":463.0,"afternoon":555.6,"evening":611.16}],"PVR City Center Nasik":[{"format":"Mainstream","morning":357.0,"afternoon":428.4,"evening":471.24}],"PVR City Center Raipur":[{"format":"Mainstream","morning":302.0,"afternoon":362.4,"evening":398.64}],"PVR City Centre Gurugram":[{"format":"Mainstream","morning":500.0,"afternoon":600.0,"evening":660.0}],"PVR City Mall Yamuna Nagar":[{"format":"Mainstream","morning":306.0,"afternoon":367.2,"evening":403.92}],"PVR Cosmo Zirakpur":[{"format":"Mainstream","morning":317.0,"afternoon":380.4,"evening":418.44}],"PVR Curo Jalandhar":[{"format":"Mainstream","morning":296.0,"afternoon":355.2,"evening":390.72}],"PVR DIT Jio World Drive BKC Mumbai":[{"format":"Drive In","morning":1987.0,"afternoon":2384.4,"evening":2622.84}],"PVR DLF Chanakya Delhi":[{"format":"Mainstream","morning":528.0,"afternoon":633.6,"evening":696.96}],"PVR DLF City Centre Chandigarh":[{"format":"Mainstream","morning":294.0,"afternoon":352.8,"evening":388.08}],"PVR DLF Promenade Vasant Kunj Delhi":[{"format":"Mainstream","morning":503.0,"afternoon":603.6,"evening":663.96},{"format":"ONYX","morning":537.0,"afternoon":644.4,"evening":708.84},{"format":"ICE","morning":611.0,"afternoon":733.2,"evening":806.52}],"PVR DYP City Kolhapur":[{"format":"Mainstream","morning":310.0,"afternoon":372.0,"evening":409.2}],"PVR Deep Kanpur":[{"format":"Mainstream","morning":289.0,"afternoon":346.8,"evening":381.48}],"PVR Diamond Plaza Jassore Kolkata":[{"format":"Mainstream","morning":365.0,"afternoon":438.0,"evening":481.8}],"PVR Directors Cut Ambience Mall Gurgaon":[{"format":"DIRECTORS CUT","morning":1525.0,"afternoon":1830.0,"evening":2013.0}],"PVR Directors Cut Ambience Vasant Kunj Delhi":[{"format":"DIRECTORS CUT","morning":1520.0,"afternoon":1824.0,"evening":2006.4}],"PVR Directors Cut Forum Rex Walk Bengaluru":[{"format":"DIRECTORS CUT","morning":1259.0,"afternoon":1510.8,"evening":1661.88}],"PVR Directors Cut Kopa Mall Pune":[{"format":"Mainstream","morning":554.0,"afternoon":664.8,"evening":731.28},{"format":"DIRECTORS CUT","morning":900.0,"afternoon":1080.0,"evening":1188.0}],"PVR Directors Cut Mall of India Noida":[{"format":"DIRECTORS CUT","morning":1366.0,"afternoon":1639.2,"evening":1803.12}],"PVR Dynamix Juhu Mumbai":[{"format":"Mainstream","morning":420.0,"afternoon":504.0,"evening":554.4}],"PVR EDM Ghaziabad":[{"format":"Mainstream","morning":303.0,"afternoon":363.6,"evening":399.96}],"PVR Elan Mercado Sec 80 Gurugram":[{"format":"Mainstream","morning":371.0,"afternoon":445.2,"evening":489.72}],"PVR Elan Miracle Sec 84 Gurugram":[{"format":"Mainstream","morning":430.0,"afternoon":516.0,"evening":567.6}],"PVR Elan Town Centre Sec 67 Gurugram":[{"format":"Mainstream","morning":340.0,"afternoon":408.0,"evening":448.8}],"PVR Eva Vadodara":[{"format":"Mainstream","morning":286.0,"afternoon":343.2,"evening":377.52}],"PVR Express Avenue (Escape) Chennai":[{"format":"Mainstream","morning":235.0,"afternoon":282.0,"evening":310.2}],"PVR Forum Galleria Rourkela":[{"format":"Mainstream","morning":279.0,"afternoon":334.8,"evening":368.28}],"PVR Forum Mall Kochi":[{"format":"Mainstream","morning":304.0,"afternoon":364.8,"evening":401.28},{"format":"P[XL] & BIGPIX","morning":392.0,"afternoon":470.4,"evening":517.44},{"format":"LUXE & INSIGNIA","morning":812.0,"afternoon":974.4,"evening":1071.84}],"PVR Friends Jalandhar":[{"format":"Mainstream","morning":282.0,"afternoon":338.4,"evening":372.24}],"PVR Fun City Panipat":[{"format":"Mainstream","morning":288.0,"afternoon":345.6,"evening":380.16}],"PVR Galada Chennai":[{"format":"Mainstream","morning":216.0,"afternoon":259.2,"evening":285.12}],"PVR Garuda Mall Mysuru":[{"format":"Mainstream","morning":282.0,"afternoon":338.4,"evening":372.24}],"PVR Gaur City Greater Noida":[{"format":"Mainstream","morning":366.0,"afternoon":439.2,"evening":483.12},{"format":"P[XL] & BIGPIX","morning":410.0,"afternoon":492.0,"evening":541.2}],"PVR Global Mall Mysore Road Bengaluru":[{"format":"Mainstream","morning":354.0,"afternoon":424.8,"evening":467.28},{"format":"4DX & MX4D","morning":532.0,"afternoon":638.4,"evening":702.24}],"PVR Grand Highstreet Mall Hinjewadi Pune":[{"format":"Mainstream","morning":373.0,"afternoon":447.6,"evening":492.36},{"format":"P[XL] & BIGPIX","morning":440.0,"afternoon":528.0,"evening":580.8}],"PVR Grand Mall Velachery Chennai":[{"format":"Mainstream","morning":218.0,"afternoon":261.6,"evening":287.76}],"PVR Heritage RSL ECR Chennai":[{"format":"Mainstream","morning":216.0,"afternoon":259.2,"evening":285.12},{"format":"Playhouse & Kiddles","morning":259.0,"afternoon":310.8,"evening":341.88}],"PVR ICON Hi-Tech (L&T) Hyderabad":[{"format":"Mainstream","morning":333.0,"afternoon":399.6,"evening":439.56}],"PVR ICON Infiniti Andheri Mumbai":[{"format":"Mainstream","morning":438.0,"afternoon":525.6,"evening":578.16},{"format":"LUXE & INSIGNIA","morning":1107.0,"afternoon":1328.4,"evening":1461.24}],"PVR ICON Nexus Pavillion Pune":[{"format":"Mainstream","morning":447.0,"afternoon":536.4,"evening":590.04}],"PVR ICON Oberoi Goregaon Mumbai":[{"format":"Playhouse & Kiddles","morning":437.0,"afternoon":524.4,"evening":576.84},{"format":"Mainstream","morning":477.0,"afternoon":572.4,"evening":629.64},{"format":"P[XL] & BIGPIX","morning":568.0,"afternoon":681.6,"evening":749.76}],"PVR ICON Phoenix Palladium Lower Parel Mumbai":[{"format":"Mainstream","morning":552.0,"afternoon":662.4,"evening":728.64},{"format":"IMAX","morning":811.0,"afternoon":973.2,"evening":1070.52},{"format":"LUXE & INSIGNIA","morning":1276.0,"afternoon":1531.2,"evening":1684.32}],"PVR Infiniti Malad Mumbai":[{"format":"Mainstream","morning":401.0,"afternoon":481.2,"evening":529.32},{"format":"4DX & MX4D","morning":653.0,"afternoon":783.6,"evening":861.96}],"PVR Inorbit Cyberabad Hyderabad":[{"format":"Mainstream","morning":319.0,"afternoon":382.8,"evening":421.08},{"format":"P[XL] & BIGPIX","morning":498.0,"afternoon":597.6,"evening":657.36},{"format":"LUXE & INSIGNIA","morning":819.0,"afternoon":982.8,"evening":1081.08}],"PVR Inorbit Mall Hubli":[{"format":"P[XL] & BIGPIX","morning":313.0,"afternoon":375.6,"evening":413.16},{"format":"Mainstream","morning":343.0,"afternoon":411.6,"evening":452.76}],"PVR JCR Firestone Mall Jamnagar":[{"format":"Mainstream","morning":312.0,"afternoon":374.4,"evening":411.84}],"PVR Jeevan Reddy Mall Armoor":[{"format":"Mainstream","morning":336.0,"afternoon":403.2,"evening":443.52}],"PVR KC Jammu":[{"format":"Mainstream","morning":368.0,"afternoon":441.6,"evening":485.76}],"PVR Kirti Mall Jalgaon":[{"format":"Mainstream","morning":216.0,"afternoon":259.2,"evening":285.12}],"PVR Kripa Cinema Trivandrum":[{"format":"Mainstream","morning":214.0,"afternoon":256.8,"evening":282.48}],"PVR Kumar Pacific Pune":[{"format":"Mainstream","morning":351.0,"afternoon":421.2,"evening":463.32}],"PVR Lakeshore Mall Hyderabad":[{"format":"Playhouse & Kiddles","morning":206.0,"afternoon":247.2,"evening":271.92},{"format":"Mainstream","morning":322.0,"afternoon":386.4,"evening":425.04},{"format":"P[XL] & BIGPIX","morning":340.0,"afternoon":408.0,"evening":448.8}],"PVR Latur":[{"format":"Mainstream","morning":249.0,"afternoon":298.8,"evening":328.68}],"PVR Le Reve Bandra Mumbai":[{"format":"Mainstream","morning":376.0,"afternoon":451.2,"evening":496.32}],"PVR Lido Juhu Mumbai":[{"format":"Mainstream","morning":457.0,"afternoon":548.4,"evening":603.24}],"PVR Lodha Xperia Dombivali Mumbai":[{"format":"Mainstream","morning":392.0,"afternoon":470.4,"evening":517.44}],"PVR Lulu Mall Kochi":[{"format":"Mainstream","morning":279.0,"afternoon":334.8,"evening":368.28},{"format":"4DX & MX4D","morning":534.0,"afternoon":640.8,"evening":704.88},{"format":"LUXE & INSIGNIA","morning":713.0,"afternoon":855.6,"evening":941.16}],"PVR MBD Jalandhar":[{"format":"Mainstream","morning":326.0,"afternoon":391.2,"evening":430.32}],"PVR MGF Gurugram":[{"format":"Mainstream","morning":469.0,"afternoon":562.8,"evening":619.08},{"format":"4DX & MX4D","morning":695.0,"afternoon":834.0,"evening":917.4}],"PVR Magneto Raipur":[{"format":"Mainstream","morning":353.0,"afternoon":423.6,"evening":465.96}],"PVR Mahagun Ghaziabad":[{"format":"Mainstream","morning":351.0,"afternoon":421.2,"evening":463.32}],"PVR Maison Jio World Drive BKC Mumbai":[{"format":"LIBRARY HALL","morning":571.0,"afternoon":685.2,"evening":753.72},{"format":"THE LOFT","morning":1072.0,"afternoon":1286.4,"evening":1415.04},{"format":"LIVING ROOM","morning":1190.0,"afternoon":1428.0,"evening":1570.8}],"PVR Mall of Jaipur":[{"format":"Mainstream","morning":432.0,"afternoon":518.4,"evening":570.24},{"format":"4DX & MX4D","morning":766.0,"afternoon":919.2,"evening":1011.12},{"format":"LUXE & INSIGNIA","morning":995.0,"afternoon":1194.0,"evening":1313.4}],"PVR Mani square Kolkata":[{"format":"Mainstream","morning":380.0,"afternoon":456.0,"evening":501.6},{"format":"P[XL] & BIGPIX","morning":464.0,"afternoon":556.8,"evening":612.48}],"PVR Maruti Solaris Anand":[{"format":"Mainstream","morning":216.0,"afternoon":259.2,"evening":285.12}],"PVR Mega Mall Gurugram":[{"format":"Mainstream","morning":495.0,"afternoon":594.0,"evening":653.4}],"PVR Midtown Moti Nagar Delhi":[{"format":"Mainstream","morning":732.0,"afternoon":878.4,"evening":966.24}],"PVR Milap Kandivali Mumbai":[{"format":"Mainstream","morning":301.0,"afternoon":361.2,"evening":397.32}],"PVR Mittal Mall Ajmer":[{"format":"Mainstream","morning":297.0,"afternoon":356.4,"evening":392.04}],"PVR Musarambagh (Next Galleria L&T) Hyderabad":[{"format":"Mainstream","morning":323.0,"afternoon":387.6,"evening":426.36}],"PVR Naraina Delhi":[{"format":"Mainstream","morning":325.0,"afternoon":390.0,"evening":429.0}],"PVR Nexus (L&T) Erramanzil Hyderabad":[{"format":"Mainstream","morning":335.0,"afternoon":402.0,"evening":442.2},{"format":"4DX & MX4D","morning":556.0,"afternoon":667.2,"evening":733.92}],"PVR Nexus (L&T) Metro Rail Panjagutta Hyderabad":[{"format":"Playhouse & Kiddles","morning":206.0,"afternoon":247.2,"evening":271.92},{"format":"Mainstream","morning":315.0,"afternoon":378.0,"evening":415.8}],"PVR Nexus Celebration Udaipur":[{"format":"Mainstream","morning":334.0,"afternoon":400.8,"evening":440.88}],"PVR Nexus City Centre Mysuru":[{"format":"Mainstream","morning":290.0,"afternoon":348.0,"evening":382.8}],"PVR Nexus Elante Chandigarh":[{"format":"Mainstream","morning":372.0,"afternoon":446.4,"evening":491.04},{"format":"4DX & MX4D","morning":610.0,"afternoon":732.0,"evening":805.2}],"PVR Nexus Fiza Mangalore":[{"format":"Mainstream","morning":308.0,"afternoon":369.6,"evening":406.56}],"PVR Nexus Koramangala Bengaluru":[{"format":"Playhouse & Kiddles","morning":384.0,"afternoon":460.8,"evening":506.88},{"format":"Mainstream","morning":410.0,"afternoon":492.0,"evening":541.2},{"format":"4DX & MX4D","morning":676.0,"afternoon":811.2,"evening":892.32},{"format":"IMAX","morning":741.0,"afternoon":889.2,"evening":978.12},{"format":"LUXE & INSIGNIA","morning":1136.0,"afternoon":1363.2,"evening":1499.52}],"PVR Nexus Select City Walk Delhi":[{"format":"Mainstream","morning":506.0,"afternoon":607.2,"evening":667.92},{"format":"IMAX","morning":792.0,"afternoon":950.4,"evening":1045.44},{"format":"LUXE & INSIGNIA","morning":1242.0,"afternoon":1490.4,"evening":1639.44}],"PVR Nexus Sujana Kukatpally Hyderabad":[{"format":"Mainstream","morning":335.0,"afternoon":402.0,"evening":442.2},{"format":"4DX & MX4D","morning":558.0,"afternoon":669.6,"evening":736.56}],"PVR Nexus Treasure Island Indore":[{"format":"Mainstream","morning":334.0,"afternoon":400.8,"evening":440.88},{"format":"Playhouse & Kiddles","morning":334.0,"afternoon":400.8,"evening":440.88},{"format":"4DX & MX4D","morning":561.0,"afternoon":673.2,"evening":740.52},{"format":"LUXE & INSIGNIA","morning":660.0,"afternoon":792.0,"evening":871.2}],"PVR Nexus Vega City Bengaluru":[{"format":"Playhouse & Kiddles","morning":363.0,"afternoon":435.6,"evening":479.16},{"format":"Mainstream","morning":403.0,"afternoon":483.6,"evening":531.96},{"format":"IMAX","morning":671.0,"afternoon":805.2,"evening":885.72},{"format":"4DX & MX4D","morning":676.0,"afternoon":811.2,"evening":892.32},{"format":"LUXE & INSIGNIA","morning":1043.0,"afternoon":1251.6,"evening":1376.76}],"PVR Nexus Vijaya Mall Chennai":[{"format":"Mainstream","morning":217.0,"afternoon":260.4,"evening":286.44},{"format":"IMAX","morning":606.0,"afternoon":727.2,"evening":799.92}],"PVR Nilamber Triumph Vadodara":[{"format":"Mainstream","morning":300.0,"afternoon":360.0,"evening":396.0}],"PVR Novelty Mall Pathankot":[{"format":"Mainstream","morning":245.0,"afternoon":294.0,"evening":323.4}],"PVR Nucleus Ranchi":[{"format":"Mainstream","morning":316.0,"afternoon":379.2,"evening":417.12}],"PVR OMR Uptown Bengaluru":[{"format":"Mainstream","morning":343.0,"afternoon":411.6,"evening":452.76}],"PVR Oberon Mall Kochi":[{"format":"Mainstream","morning":244.0,"afternoon":292.8,"evening":322.08}],"PVR Odeon Ghatkopar Mumbai":[{"format":"Mainstream","morning":298.0,"afternoon":357.6,"evening":393.36}],"PVR Orion Bengaluru":[{"format":"Mainstream","morning":389.0,"afternoon":466.8,"evening":513.48},{"format":"P[XL] & BIGPIX","morning":490.0,"afternoon":588.0,"evening":646.8},{"format":"4DX & MX4D","morning":619.0,"afternoon":742.8,"evening":817.08},{"format":"LUXE & INSIGNIA","morning":979.0,"afternoon":1174.8,"evening":1292.28}],"PVR Orion Mall Panvel Mumbai":[{"format":"Mainstream","morning":331.0,"afternoon":397.2,"evening":436.92}],"PVR PP Walk Mohali":[{"format":"Mainstream","morning":334.0,"afternoon":400.8,"evening":440.88}],"PVR Pacific Dehradun":[{"format":"Mainstream","morning":385.0,"afternoon":462.0,"evening":508.2}],"PVR Pacific Dwarka Delhi":[{"format":"Sapphire","morning":418.0,"afternoon":501.6,"evening":551.76},{"format":"Mainstream","morning":432.0,"afternoon":518.4,"evening":570.24}],"PVR Pacific Mall of Dehradun":[{"format":"Mainstream","morning":371.0,"afternoon":445.2,"evening":489.72}],"PVR Pacific Mall of Faridabad":[{"format":"Mainstream","morning":364.0,"afternoon":436.8,"evening":480.48},{"format":"P[XL] & BIGPIX","morning":425.0,"afternoon":510.0,"evening":561.0}],"PVR Pacific Subhash Nagar Delhi":[{"format":"Mainstream","morning":544.0,"afternoon":652.8,"evening":718.08},{"format":"4DX & MX4D","morning":709.0,"afternoon":850.8,"evening":935.88}],"PVR Parshavnath Mall Moradabad":[{"format":"Mainstream","morning":285.0,"afternoon":342.0,"evening":376.2}],"PVR Pavilion Mall Ludhiana":[{"format":"Mainstream","morning":304.0,"afternoon":364.8,"evening":401.28}],"PVR Pebble Downtown Faridabad":[{"format":"Mainstream","morning":375.0,"afternoon":450.0,"evening":495.0}],"PVR Phoenix Lucknow":[{"format":"Mainstream","morning":248.0,"afternoon":297.6,"evening":327.36}],"PVR Phoenix Market City Kurla Mumbai":[{"format":"Mainstream","morning":366.0,"afternoon":439.2,"evening":483.12},{"format":"P[XL] & BIGPIX","morning":462.0,"afternoon":554.4,"evening":609.84},{"format":"4DX & MX4D","morning":725.0,"afternoon":870.0,"evening":957.0},{"format":"LUXE & INSIGNIA","morning":765.0,"afternoon":918.0,"evening":1009.8}],"PVR Phoenix Market City Viman Nagar Pune":[{"format":"Mainstream","morning":375.0,"afternoon":450.0,"evening":495.0},{"format":"LUXE & INSIGNIA","morning":718.0,"afternoon":861.6,"evening":947.76},{"format":"4DX & MX4D","morning":752.0,"afternoon":902.4,"evening":992.64}],"PVR Phoenix Market City Whitefield Bengaluru":[{"format":"Playhouse & Kiddles","morning":399.0,"afternoon":478.8,"evening":526.68},{"format":"Mainstream","morning":410.0,"afternoon":492.0,"evening":541.2},{"format":"4DX & MX4D","morning":627.0,"afternoon":752.4,"evening":827.64}],"PVR Phoenix Palladium Ahmedabad":[{"format":"Mainstream","morning":448.0,"afternoon":537.6,"evening":591.36},{"format":"IMAX","morning":677.0,"afternoon":812.4,"evening":893.64},{"format":"LUXE & INSIGNIA","morning":960.0,"afternoon":1152.0,"evening":1267.2}],"PVR Phoenix United Bareilly":[{"format":"Mainstream","morning":396.0,"afternoon":475.2,"evening":522.72}],"PVR Piyush Mahendra Faridabad":[{"format":"Mainstream","morning":260.0,"afternoon":312.0,"evening":343.2}],"PVR Plaza Delhi":[{"format":"Mainstream","morning":474.0,"afternoon":568.8,"evening":625.68}],"PVR Plutone Mall Rourkela":[{"format":"Mainstream","morning":314.0,"afternoon":376.8,"evening":414.48}],"PVR Prashant Vihar Delhi":[{"format":"Mainstream","morning":363.0,"afternoon":435.6,"evening":479.16}],"PVR Preston Gachibowli Hyderabad":[{"format":"Mainstream","morning":326.0,"afternoon":391.2,"evening":430.32}],"PVR Priya Delhi":[{"format":"IMAX","morning":618.0,"afternoon":741.6,"evening":815.76}],"PVR RK Cineplex Banjara Hills Hyderabad":[{"format":"Mainstream","morning":372.0,"afternoon":446.4,"evening":491.04}],"PVR Rahul Raj Surat":[{"format":"Playhouse & Kiddles","morning":293.0,"afternoon":351.6,"evening":386.76},{"format":"Mainstream","morning":305.0,"afternoon":366.0,"evening":402.6},{"format":"P[XL] & BIGPIX","morning":375.0,"afternoon":450.0,"evening":495.0},{"format":"4DX & MX4D","morning":599.0,"afternoon":718.8,"evening":790.68}],"PVR Rama Magneto Bilaspur":[{"format":"Mainstream","morning":324.0,"afternoon":388.8,"evening":427.68}],"PVR Regalia Elements Bengaluru":[{"format":"Mainstream","morning":346.0,"afternoon":415.2,"evening":456.72}],"PVR Ridhi Sidhi Mall Sri Ganganagar":[{"format":"Mainstream","morning":268.0,"afternoon":321.6,"evening":353.76}],"PVR Ripples Vijaywada":[{"format":"Mainstream","morning":311.0,"afternoon":373.2,"evening":410.52}],"PVR Rivoli Delhi":[{"format":"Mainstream","morning":454.0,"afternoon":544.8,"evening":599.28}],"PVR S2 Haseen Bhiwandi Mumbai":[{"format":"Mainstream","morning":231.0,"afternoon":277.2,"evening":304.92}],"PVR S2 Maddox Warangal":[{"format":"Mainstream","morning":307.0,"afternoon":368.4,"evening":405.24}],"PVR S2 Perambur Chennai":[{"format":"Mainstream","morning":223.0,"afternoon":267.6,"evening":294.36}],"PVR S2 Theyagaraja Chennai":[{"format":"Mainstream","morning":219.0,"afternoon":262.8,"evening":289.08}],"PVR SCT Amritsar":[{"format":"Playhouse & Kiddles","morning":228.0,"afternoon":273.6,"evening":300.96},{"format":"Mainstream","morning":250.0,"afternoon":300.0,"evening":330.0}],"PVR SKLS Galaxy Red Hills Chennai":[{"format":"Mainstream","morning":212.0,"afternoon":254.4,"evening":279.84}],"PVR Sahara Lucknow":[{"format":"Mainstream","morning":243.0,"afternoon":291.6,"evening":320.76}],"PVR Sahu Lucknow":[{"format":"Mainstream","morning":239.0,"afternoon":286.8,"evening":315.48}],"PVR Sangam Andheri Mumbai":[{"format":"Mainstream","morning":328.0,"afternoon":393.6,"evening":432.96}],"PVR Sangam Delhi":[{"format":"Mainstream","morning":404.0,"afternoon":484.8,"evening":533.28}],"PVR Sathyam Royapettah Chennai":[{"format":"Mainstream","morning":222.0,"afternoon":266.4,"evening":293.04}],"PVR Satyamev Emporio Ahmedabad":[{"format":"Mainstream","morning":286.0,"afternoon":343.2,"evening":377.52}],"PVR Shalimar Bagh Delhi":[{"format":"Mainstream","morning":356.0,"afternoon":427.2,"evening":469.92}],"PVR Silver Arc Ludhiana":[{"format":"Mainstream","morning":332.0,"afternoon":398.4,"evening":438.24}],"PVR Soul Space Spirit Mall Bengaluru":[{"format":"Mainstream","morning":407.0,"afternoon":488.4,"evening":537.24}],"PVR South X Kanpur":[{"format":"Mainstream","morning":323.0,"afternoon":387.6,"evening":426.36}],"PVR Sree Kanya Narsipatnam":[{"format":"Mainstream","morning":222.0,"afternoon":266.4,"evening":293.04}],"PVR Superplex Ambience Gurgaon":[{"format":"Playhouse & Kiddles","morning":499.0,"afternoon":598.8,"evening":658.68},{"format":"Mainstream","morning":501.0,"afternoon":601.2,"evening":661.32},{"format":"ICE","morning":599.0,"afternoon":718.8,"evening":790.68},{"format":"4DX & MX4D","morning":748.0,"afternoon":897.6,"evening":987.36},{"format":"IMAX","morning":793.0,"afternoon":951.6,"evening":1046.76},{"format":"LUXE & INSIGNIA","morning":1295.0,"afternoon":1554.0,"evening":1709.4}],"PVR Superplex DLF Mall of India Noida":[{"format":"Mainstream","morning":449.0,"afternoon":538.8,"evening":592.68},{"format":"P[XL] & BIGPIX","morning":538.0,"afternoon":645.6,"evening":710.16},{"format":"4DX & MX4D","morning":619.0,"afternoon":742.8,"evening":817.08},{"format":"IMAX","morning":703.0,"afternoon":843.6,"evening":927.96}],"PVR Superplex Forum Mall, Kanakapura Bengaluru":[{"format":"Mainstream","morning":368.0,"afternoon":441.6,"evening":485.76},{"format":"P[XL] & BIGPIX","morning":447.0,"afternoon":536.4,"evening":590.04},{"format":"ICE","morning":449.0,"afternoon":538.8,"evening":592.68},{"format":"4DX & MX4D","morning":577.0,"afternoon":692.4,"evening":761.64},{"format":"LUXE & INSIGNIA","morning":938.0,"afternoon":1125.6,"evening":1238.16}],"PVR Superplex Logix Noida":[{"format":"Mainstream","morning":397.0,"afternoon":476.4,"evening":524.04},{"format":"Playhouse & Kiddles","morning":405.0,"afternoon":486.0,"evening":534.6},{"format":"4DX & MX4D","morning":651.0,"afternoon":781.2,"evening":859.32},{"format":"IMAX","morning":754.0,"afternoon":904.8,"evening":995.28},{"format":"LUXE & INSIGNIA","morning":1267.0,"afternoon":1520.4,"evening":1672.44}],"PVR Superplex Lulu Mall Lucknow":[{"format":"Mainstream","morning":318.0,"afternoon":381.6,"evening":419.76},{"format":"4DX & MX4D","morning":448.0,"afternoon":537.6,"evening":591.36},{"format":"P[XL] & BIGPIX","morning":452.0,"afternoon":542.4,"evening":596.64},{"format":"LUXE & INSIGNIA","morning":685.0,"afternoon":822.0,"evening":904.2}],"PVR Superplex Lulu Thiruvananthapuram":[{"format":"Mainstream","morning":306.0,"afternoon":367.2,"evening":403.92},{"format":"4DX & MX4D","morning":584.0,"afternoon":700.8,"evening":770.88},{"format":"IMAX","morning":628.0,"afternoon":753.6,"evening":828.96},{"format":"LUXE & INSIGNIA","morning":851.0,"afternoon":1021.2,"evening":1123.32}],"PVR Superplex Vegas Dwarka Delhi":[{"format":"Playhouse & Kiddles","morning":458.0,"afternoon":549.6,"evening":604.56},{"format":"Mainstream","morning":471.0,"afternoon":565.2,"evening":621.72},{"format":"4DX & MX4D","morning":661.0,"afternoon":793.2,"evening":872.52},{"format":"IMAX","morning":687.0,"afternoon":824.4,"evening":906.84},{"format":"LUXE & INSIGNIA","morning":1238.0,"afternoon":1485.6,"evening":1634.16}],"PVR Surya Treasure Island Bhillai":[{"format":"Mainstream","morning":295.0,"afternoon":354.0,"evening":389.4}],"PVR The Cinema Coimbatore":[{"format":"P[XL] & BIGPIX","morning":229.0,"afternoon":274.8,"evening":302.28},{"format":"Mainstream","morning":232.0,"afternoon":278.4,"evening":306.24}],"PVR The Cinema GT World Bengaluru":[{"format":"Mainstream","morning":323.0,"afternoon":387.6,"evening":426.36}],"PVR The Cinema Providence Pondicherry":[{"format":"Mainstream","morning":211.0,"afternoon":253.2,"evening":278.52}],"PVR TransCube Vadodara":[{"format":"Mainstream","morning":263.0,"afternoon":315.6,"evening":347.16}],"PVR Treasure Bazar Square Mall Nanded":[{"format":"Mainstream","morning":234.0,"afternoon":280.8,"evening":308.88}],"PVR Treasure Bazar Ujjain":[{"format":"Mainstream","morning":267.0,"afternoon":320.4,"evening":352.44}],"PVR Uniworld Downtown Mall Kolkata":[{"format":"Mainstream","morning":300.0,"afternoon":360.0,"evening":396.0}],"PVR Utkal Kanika Galleria Bhubaneswar":[{"format":"Mainstream","morning":373.0,"afternoon":447.6,"evening":492.36}],"PVR V Square Mall Cuddalore":[{"format":"Mainstream","morning":219.0,"afternoon":262.8,"evening":289.08}],"PVR VR Anna Nagar Chennai":[{"format":"Mainstream","morning":215.0,"afternoon":258.0,"evening":283.8},{"format":"P[XL] & BIGPIX","morning":222.0,"afternoon":266.4,"evening":293.04}],"PVR VR Punjab Mohali":[{"format":"Mainstream","morning":329.0,"afternoon":394.8,"evening":434.28},{"format":"LUXE & INSIGNIA","morning":1024.0,"afternoon":1228.8,"evening":1351.68}],"PVR VR Whitefield Bengaluru":[{"format":"Mainstream","morning":437.0,"afternoon":524.4,"evening":576.84},{"format":"IMAX","morning":627.0,"afternoon":752.4,"evening":827.64},{"format":"LUXE & INSIGNIA","morning":1005.0,"afternoon":1206.0,"evening":1326.6}],"PVR VRC City Patiala":[{"format":"Mainstream","morning":296.0,"afternoon":355.2,"evening":390.72}],"PVR VVIP Ghaziabad":[{"format":"Mainstream","morning":306.0,"afternoon":367.2,"evening":403.92}],"PVR Vaishnavi Sapphire Mall Bengaluru":[{"format":"Mainstream","morning":350.0,"afternoon":420.0,"evening":462.0}],"PVR Varam Central Machlipatnam":[{"format":"Mainstream","morning":307.0,"afternoon":368.4,"evening":405.24}],"PVR Velocity Vellore":[{"format":"Mainstream","morning":235.0,"afternoon":282.0,"evening":310.2}],"PVR Venu Mall Nizamabad":[{"format":"Mainstream","morning":319.0,"afternoon":382.8,"evening":421.08}],"PVR Venus Gorakhpur":[{"format":"Mainstream","morning":275.0,"afternoon":330.0,"evening":363.0}],"PVR Vikaspuri Delhi":[{"format":"Mainstream","morning":315.0,"afternoon":378.0,"evening":415.8}],"PVR Vinayak Prayagraj":[{"format":"Mainstream","morning":397.0,"afternoon":476.4,"evening":524.04}]};

// Manual city overrides for cinema names where the naive "last word" rule doesn't match the real city
const CITY_OVERRIDES = {
  'PVR City Mall Yamuna Nagar': 'Yamuna Nagar',
};

function getCityForCinema(name) {
  if (CITY_OVERRIDES[name]) return CITY_OVERRIDES[name];
  if (name.includes('Pitampura')) return 'Delhi';
  const words = name.trim().split(/\s+/);
  return words[words.length - 1];
}

// "Delhi NCR" quick-select in the city dropdown expands to this set — edit here to change it
const NCR_CITIES = ['Delhi', 'New Delhi', 'Gurugram', 'Gurgaon', 'Noida', 'Greater Noida', 'Faridabad', 'Ghaziabad'];

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Shared by bulk booking (CINEMA_DATA, city derived from the cinema name) and private
// screening (fetched dataset, city read from an explicit field) — each dataset supplies
// its own getCityFn so this just handles building + de-duping + sorting once.
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

const FOOD_COMBOS = [
  { id: 'none', label: 'No food', items: 'Tickets only', price: 0 },
  { id: 'small', label: 'Small Combo', items: 'Small pepsi + small popcorn', price: 550 },
  { id: 'medium', label: 'Medium Combo', items: 'Medium pepsi + medium popcorn', price: 750 },
  { id: 'smallBurger', label: 'Small Combo + Burger', items: 'Small pepsi + small popcorn + burger', price: 750 },
  { id: 'mediumBurger', label: 'Medium Combo + Burger', items: 'Medium pepsi + medium popcorn + burger', price: 850 },
];

const { cinemaNames: CINEMA_NAMES, allCities: ALL_CITIES } = buildCinemaAndCityLists(CINEMA_DATA, getCityForCinema);
// NCR_CITIES also covers private screening's city spellings ("New Delhi", "Greater Noida"), which
// never occur in the bulk-booking dataset — scope the "Delhi NCR" shortcut to what's actually selectable here.
const BULK_NCR_CITIES = NCR_CITIES.filter((c) => ALL_CITIES.includes(c));

function generateReferenceId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'PVX-';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function formatINR(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
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

export default function App() {
  const [mode, setMode] = useState(null); // null | 'bulkBooking' | 'privateScreening'

  const [referenceId, setReferenceId] = useState(generateReferenceId);

  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [selectedCities, setSelectedCities] = useState([]);
  const [cityQuery, setCityQuery] = useState('');

  const [showCinemaDropdown, setShowCinemaDropdown] = useState(false);
  const [selectedCinemaNames, setSelectedCinemaNames] = useState([]);
  const [cinemaQuery, setCinemaQuery] = useState('');
  const [cinemaDetails, setCinemaDetails] = useState({}); // { [cinemaName]: { format, timeSlotId, ticketCountInput, requestDate, movieName, foodComboId, foodDropdownOpen, timeSlotDropdownOpen } }
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
    return buildCinemaAndCityLists(privateScreeningData, (name) => toTitleCase(privateScreeningData[name]?.city || ''));
  }, [privateScreeningData]);

  const psNcrCities = useMemo(() => NCR_CITIES.filter((c) => PS_ALL_CITIES.includes(c)), [PS_ALL_CITIES]);
  const isPSNcrSelected = psNcrCities.length > 0 && psNcrCities.every((c) => psSelectedCities.includes(c));

  const psCityFilteredCinemaNames = useMemo(() => {
    const pool =
      psSelectedCities.length === 0
        ? PS_CINEMA_NAMES
        : PS_CINEMA_NAMES.filter((c) => psSelectedCities.includes(toTitleCase(privateScreeningData?.[c]?.city || '')));
    return pool.slice().sort((a, b) => a.localeCompare(b));
  }, [PS_CINEMA_NAMES, psSelectedCities, privateScreeningData]);

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
  }, [selectedCities]);

  const cityQueryTrimmed = cityQuery.trim().toLowerCase();
  const showAllCitiesOption = cityQueryTrimmed === '';
  const showDelhiNcrOption = cityQueryTrimmed === '' || 'delhi ncr'.includes(cityQueryTrimmed);
  const filteredCityOptions = useMemo(() => {
    if (!cityQueryTrimmed) return ALL_CITIES;
    return ALL_CITIES.filter((c) => c.toLowerCase().includes(cityQueryTrimmed));
  }, [cityQueryTrimmed]);

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
      movieName: '',
      foodComboId: 'none',
      foodDropdownOpen: false,
      timeSlotDropdownOpen: false,
    };
    const availableFormats = CINEMA_DATA[cinemaName] || [];
    const activeFormat = availableFormats.find((f) => f.format === detail.format);
    const activeTimeSlot = TIME_SLOTS.find((t) => t.id === detail.timeSlotId) || null;
    const activePrice = activeFormat && detail.timeSlotId ? activeFormat[detail.timeSlotId] : null;
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
      activePrice,
      activeCombo,
      ticketCount,
      ticketTotal,
      foodTotal,
      lineTotal: ticketTotal + foodTotal,
    };
  });

  const completeCinemas = computedCinemas.filter(
    (r) => r.activeFormat && r.timeSlotId && r.ticketCount >= MIN_TICKET_COUNT && r.requestDate && r.movieName.trim()
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

    const rawAudiOptions = audis.map((a) => {
      const ninetyPercentFloor = Math.ceil(a.capacity * 0.9);
      const rate = detail.timeSlotId ? a[detail.timeSlotId] : null;
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
      ticketSubtotal,
      foodSubtotal,
      lineTotal,
    };
  });

  const completePSCinemas = computedPSCinemas.filter(
    (r) => r.timeSlotId && r.desiredAttendees > 0 && r.selectedAudi && r.requestDate && r.movieName.trim()
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
      const formats = CINEMA_DATA[cinemaName] || [];
      setSelectedCinemaNames((names) => [...names, cinemaName]);
      setCinemaDetails((details) => ({
        ...details,
        [cinemaName]: {
          format: formats.length ? formats[0].format : '',
          timeSlotId: null,
          ticketCountInput: String(MIN_TICKET_COUNT),
          requestDate: '',
          movieName: '',
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
          '   Movie: ' + r.movieName + '\n' +
          '   Date: ' + r.requestDate + '\n' +
          '   Time slot: ' + r.activeTimeSlot.label + ' (' + r.activeTimeSlot.range + ')\n' +
          '   Tickets: ' + r.ticketCount + ' x ' + formatINR(r.activePrice) + ' = ' + formatINR(r.ticketTotal) + '\n' +
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
          movieName: r.movieName,
          foodCombo: r.activeCombo ? r.activeCombo.label : 'None',
          subtotal: r.lineTotal,
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

  function handleReset() {
    setStatus('form');
    setConfirmedFirstName('');
    resetFormFields();
  }

  const minDateStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
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
          padding: 32px 16px 64px;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .pb-page * { box-sizing: border-box; }

        .pb-shell { max-width: 980px; margin: 0 auto; }

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
          margin-bottom: 16px;
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
        }
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
          gap: 24px;
          align-items: start;
        }
        .pb-grid-left { grid-column: 1; }
        @media (max-width: 860px) {
          .pb-grid { grid-template-columns: 1fr; }
          .pb-grid-left { grid-column: 1; }
        }

        .pb-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 24px;
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

      <div className="pb-shell">
        <div className="pb-top-bar">
          <div className="pb-brand-logo" aria-label="PVR INOX">
            <span className="pb-brand-pvr">PVR</span>
            <span className="pb-brand-star">&#9733;</span>
            <span className="pb-brand-inox">INOX</span>
          </div>
          <button type="button" className="pb-lookup-trigger" onClick={openLookupModal}>
            Check a reference number
          </button>
        </div>

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

            {/* FORM */}
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
                            <div className="pb-date-help">7 or more days from today.</div>
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
                            <label className="pb-label">
                              Movie name<span className="pb-required">*</span>
                            </label>
                            <input
                              className="pb-input"
                              placeholder="Which movie is this for?"
                              value={r.movieName}
                              onChange={(e) => updateCinemaDetail(r.cinemaName, { movieName: e.target.value })}
                              required
                            />
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
                        <span className="pb-stub-row-label">
                          {r.ticketCount > 0 && r.activePrice ? `Tickets (${r.ticketCount} × ${formatINR(r.activePrice)})` : 'Tickets'}
                        </span>
                        <span className="pb-stub-row-value">{r.ticketCount > 0 && r.activePrice ? formatINR(r.ticketTotal) : '—'}</span>
                      </div>
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
                              <div className="pb-date-help">7 or more days from today.</div>
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
                        <div className="pb-stub-row">
                          <span className="pb-stub-row-label">Movie</span>
                          <span className="pb-stub-row-value">{c.movieName}</span>
                        </div>
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
