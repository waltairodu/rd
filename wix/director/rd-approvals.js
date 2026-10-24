// backend/rd-approvals.js
// The approvals template: the permissions a race usually needs in India, what to attach to each application,
// a suggested lead time, the wording of the application letter, and the sign-offs on race morning.
// Pure logic with no Wix imports, so it can be tested on its own. racedir.web.js imports it.
//
// Nothing here is a race detail. The race name, edition, date, venue, place and the organiser's details are
// entered by the race director and passed in; anything missing shows up as [a bracketed blank] in the letter.

/* ---------- dates, times, numbers ---------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function addDays(iso, n) {
  if (!isDate(iso)) return '';
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}
export function longDate(iso) {
  if (!isDate(iso)) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
export function weekdayOf(iso) {
  return isDate(iso) ? DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()] : '';
}
// 'HH:MM' minus minutes; never goes below 00:00 (a sign-off is always on the race day itself).
export function minusMinutes(hhmm, mins) {
  if (!isTime(hhmm)) return '';
  const t = Math.max(0, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) - Number(mins || 0));
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
export function clock12(hhmm) {
  if (!isTime(hhmm)) return '';
  const h = Number(hhmm.slice(0, 2));
  return (h % 12 === 0 ? 12 : h % 12) + ':' + hhmm.slice(3) + ' ' + (h < 12 ? 'am' : 'pm');
}
export function ordinalOf(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10] || 'th');
}
// "5" becomes "5th"; "Fifth", "5th" and "2026" are kept as typed.
export function editionLabel(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (/^\d{1,2}$/.test(s) && Number(s) > 0) return ordinalOf(Number(s));
  return s;
}
// Indian digit grouping: 1,00,000.
export function indian(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return '';
  const s = String(Math.abs(x));
  const g = s.length > 3 ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3) : s;
  return (x < 0 ? '-' : '') + g;
}
const kmText = (km) => String(Number(Number(km).toFixed(1)));
function distanceText(cats, distanceKm) {
  let kms = (Array.isArray(cats) ? cats : []).map((c) => Number(c && c.km)).filter((k) => Number.isFinite(k) && k > 0);
  if (!kms.length && Number(distanceKm) > 0) kms = [Number(distanceKm)];
  const u = [...new Set(kms.map(kmText))].sort((a, b) => Number(b) - Number(a)).map((k) => k + ' km');
  if (!u.length) return '';
  return u.length === 1 ? u[0] : u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1];
}

/* ---------- what the race involves ---------- */
// These answers decide which approvals are suggested. Each can be changed in the panel before anything is added.
export const SCOPES = [
  { key: 'roads', label: 'Part of the route is on public roads that are closed or diverted', on: true },
  { key: 'trail', label: 'The route goes through forest, hills or village land', on: false },
  { key: 'expo', label: 'Expo, stage, tents or other temporary structures', on: true },
  { key: 'sound', label: 'Loudspeakers or a public address system', on: true },
  { key: 'music', label: 'Music or a DJ is played', on: false },
  { key: 'food', label: 'Food or water is served at aid stations or stalls', on: true },
  { key: 'power', label: 'A temporary electricity connection or a generator', on: true },
  { key: 'banners', label: 'Banners, flex boards or hoardings are put up', on: true },
  { key: 'drone', label: 'Drone photography or filming', on: false },
  { key: 'other', label: 'The route touches a highway, port, railway, defence or private land', on: false },
  { key: 'aims', label: 'The road course is measured and certified (AIMS or World Athletics)', on: false },
];
export function defaultScope() {
  const o = {};
  SCOPES.forEach((s) => (o[s.key] = s.on));
  return o;
}
export function cleanScope(raw, base) {
  const o = Object.assign(defaultScope(), base || {});
  if (raw && typeof raw === 'object') SCOPES.forEach((s) => raw[s.key] !== undefined && (o[s.key] = raw[s.key] === true || raw[s.key] === 'true' || raw[s.key] === 'on'));
  return o;
}

/* ---------- the letter building blocks ---------- */
// Tokens in {braces} are filled from the race details. A token that starts with _ is optional: it is left out when empty.
// All other empty tokens become a [bracketed blank] and are listed as missing.
const B = {
  intro: 'I am writing on behalf of {organiser} to seek your kind permission for {event}, to be held on {when} at {venue}{_in}.',
  details: 'The event has runs of {distances}. About {participants} runners are expected, supported by {_volunteers}. The flag-off is at {start} and the event will close by {end}.',
  route: { when: ['route'], text: 'The route is: {route}. A route map is enclosed.' },
  safety: 'We will have ambulances and doctors on site, marshals at every crossing, and drinking water and first aid along the route.',
  undertake: 'We undertake to follow every condition you set, to keep the area clean, and to leave it as we found it. We will remain responsible for our participants, volunteers and vendors during the event.',
  close: 'I request you to kindly grant the permission, and to let me know if any further document or a meeting is needed. I can be reached on {phone}.',
  about: 'I am writing on behalf of {organiser} about {event}, to be held on {when} at {venue}{_in}.',
};

/* ---------- the permits ---------- */
// who: the designation shown as the authority. at: which race detail is added after it (place, localBody or venue).
// lead: days before the race by which the application should go in (a suggestion, editable).
// to: a function that gives the address lines of the letter (party is the authority as it stands on the row; def says whether
// that is still the suggested text). Without it the letter is addressed to "The <authority>".
export const PERMITS = [
  {
    key: 'police', cat: 'Police', title: 'Police permission for road use and traffic diversion', who: { role: 'Commissioner of Police', at: 'place' }, lead: 45,
    docs: [
      'Route map showing the start, finish, turning points, aid stations and the roads to be closed or diverted',
      'Programme with reporting time, flag-off time for each distance, cut-off times and closing time',
      'Traffic plan: barricade and marshal points, diversion routes and parking areas',
      'Expected number of runners, volunteers and spectators',
      'Medical and ambulance plan with names and phone numbers',
      'Copy of the organiser registration certificate and ID proof of the signatory',
      'Copies of permissions already received (venue owner, local body, forest, fire)',
      'Event-day phone list of the organising team',
    ],
    tips: 'Apply at the Commissionerate (in a district, the Superintendent of Police office) and copy the traffic police and the local Station House Officer. Ask for written police arrangements and traffic marshals at major crossings. Keep the signed acknowledgement, and ask whether a joint route walk is needed.',
    subject: 'Request for permission to conduct {event} on {when} at {venue}, and for traffic regulation and police arrangements - reg.',
    body: [
      B.intro, B.details, B.route,
      { when: ['@roads'], text: 'As the run uses public roads, I request you to kindly: (a) permit the use of the route between {start} and {end}; (b) arrange the temporary closure or diversion of traffic along the route during these hours; (c) depute traffic personnel at the major junctions and police personnel at the start, the finish and the expo area; and (d) permit our marshals to place barricades and cones at turns and crossings.' },
      { unless: ['@roads'], text: 'Although the route is largely away from public roads, I request you to kindly take note of the event, to depute police personnel at the start, the finish and the access roads, and to help with crowd and traffic control at the entry points.' },
      B.safety, B.undertake, B.close,
    ],
  },
  {
    key: 'civic', cat: 'Local body', title: 'Municipal corporation permission for the route, start and finish areas and sanitation', who: { role: 'Commissioner', at: 'localBody', fallback: 'Municipal Corporation or local body' }, lead: 30,
    docs: [
      'Route map marking the start, finish, aid stations, toilets and dustbin points',
      'Programme with dates and times, including the expo, set-up and clean-up',
      'Sanitation and waste plan: toilets, dustbins, collection and clearing',
      'Copy of the organiser registration certificate and ID proof of the signatory',
      'Police permission or the acknowledgement of the application',
      'Fee receipt, if the local body charges a fee',
    ],
    tips: 'Ask which department handles road use, sanitation and toilets, and whether there is a single-window or online process. Get dates in writing for route cleaning, toilets and waste clearing. Beaches and parks may belong to a development authority or the tourism department rather than the corporation, so confirm who owns each stretch.',
    subject: 'Request for permission to use the route and the venue, and for sanitation support, for {event} on {when} - reg.',
    body: [
      B.intro, B.details, B.route,
      'We request your permission to use the road stretches and open spaces shown in the enclosed route map for the start, the finish and the aid stations, and your support with: (a) cleaning and sweeping the route and the venue before the event; (b) portable toilets and dustbins at the start, the finish and the aid stations; (c) clearing the waste collected during and after the event; and (d) removing obstructions, parked vehicles and stray animals from the route on the morning of the event.',
      B.undertake, B.close,
    ],
  },
  {
    key: 'venue', cat: 'Venue', title: 'Venue, ground or park owner permission', who: { role: 'Owner or manager', at: 'venue' }, lead: 45,
    docs: [
      'Layout plan of the venue showing the start, finish, expo, stage, parking and medical post',
      'Dates and times for set-up, the event and dismantling',
      'Copy of the organiser registration certificate and ID proof of the signatory',
      'Signed undertaking to restore the premises and make good any damage',
      'Proof of payment of the usage fee, if any',
      'Name and phone number of the person in charge of power, water and toilets at the venue',
    ],
    tips: 'Get the permission on the owner\'s letterhead with the dates, the areas covered and any charges. Ask about power, water, toilets, parking and the last time the venue can be used, and who to call on the day.',
    subject: 'Request for permission to use {venue} for {event} on {when} - reg.',
    body: [
      'I am writing on behalf of {organiser} to request your kind permission to use {venue}{_in} for {event}, to be held on {when}.',
      'We would like to use the premises for the start and finish of the run, the expo and bib collection, the stage and prize distribution, parking, and the medical and aid posts. The event has runs of {distances}. About {participants} runners are expected, supported by {_volunteers}. The flag-off is at {start} and the event will close by {end}.',
      { when: ['expoDate'], text: 'The expo and bib collection will be held on {expoDate}.' },
      'We request access from the evening before for set-up, and until the evening of the event for dismantling, with access to power, water and toilets if available. We will pay any usage charges, make good any damage and hand the premises back clean.',
      B.close,
    ],
  },
  {
    key: 'fire', scope: 'expo', cat: 'Fire and safety', title: 'Fire safety clearance for the expo, stage and tents', who: { role: 'District Fire Officer', at: 'place' }, lead: 30,
    docs: [
      'Layout plan of tents, stage, stalls, exits and fire lanes',
      'Stability confirmation from the vendor or an engineer for the stage, truss and finish gantry',
      'List of fire extinguishers with their type and positions',
      'Electrical load and wiring plan, with the electrician\'s name',
      'Venue owner permission',
      'Expected crowd at the expo and the finish area',
    ],
    tips: 'Fire offices usually inspect tents, stages and gantries before the event. Ask what they want in writing and fix a date for the inspection. Keep extinguishers at the generator, the stage and the food area, and keep every exit clear.',
    subject: 'Request for fire safety clearance for temporary structures at {venue} for {event} on {when} - reg.',
    body: [
      B.about,
      'The event will have temporary structures: tents and stalls for the expo and bib collection, a stage, a finish gantry and a medical tent. About {participants} runners are expected, along with volunteers and spectators.',
      'A layout plan showing the structures, the exits, the fire lanes and the places for fire extinguishers is enclosed. We will keep fire extinguishers near the stage, the generator and the food area, keep all exits clear, and use flame-retardant material where possible.',
      'I request you to kindly inspect the arrangements at a convenient time before the event and issue the fire safety clearance or any directions you consider necessary. We will make the changes you suggest.',
      B.close,
    ],
  },
  {
    key: 'medical', cat: 'Medical', title: 'Ambulance and hospital tie-up letter', who: { role: 'Partner hospital and ambulance provider' }, lead: 30,
    to: (party, def) => ['The Medical Superintendent', def ? '[Hospital or ambulance provider]' : party],
    docs: [
      'Ambulance details: number of ambulances, type (basic or advanced), vehicle numbers and crew phone numbers',
      'Hospital confirmation naming the emergency unit and the doctor on call',
      'List of doctors and paramedics on duty and their posts',
      'Medical plan with the post locations on the route map',
      'Control-room sheet of emergency numbers (108 for an ambulance, 112 for any emergency)',
    ],
    tips: 'Decide the number of ambulances and doctors with your medical lead, based on distance, number of runners, heat and terrain. Mark the nearest emergency hospital on the route map and tell it the date, the number of runners and the hours.',
    subject: 'Request for ambulance, doctors and emergency medical support for {event} on {when} - reg.',
    body: [
      B.about, B.details, B.route,
      'We request your support with: (a) ambulances with trained paramedics at the start and finish and at points along the route from {start} to {end}; (b) a doctor and nursing staff at the finish-line medical post; (c) your emergency department receiving runners who are referred from the event; and (d) the name and mobile number of a doctor we can call during the event.',
      'We will share the final medical plan, the route map and our control-room numbers with you before the event. Please confirm your support in writing, with the number of ambulances and staff you will provide and the charges, if any.',
      B.close,
    ],
  },
  {
    key: 'insurance', cat: 'Insurance', title: 'Event insurance policy', who: { role: 'Insurance company or broker' }, lead: 21,
    to: (party, def) => ['The Manager, Corporate or Event Insurance', def ? '[Insurance company or broker]' : party],
    docs: [
      'Event details: name, date, venue, distances and number of participants',
      'Copy of the organiser registration certificate',
      'Quotations compared and the policy chosen',
      'Premium payment receipt',
      'Policy schedule copy for the control room',
    ],
    tips: 'Ask for public liability cover for the event and, if possible, accident cover for participants and volunteers. Check the exclusions (for example hills, night running and pre-existing conditions). Keep the policy copy at the control room.',
    subject: 'Request for a quotation for event insurance for {event} on {when} - reg.',
    body: [
      'I am writing on behalf of {organiser}. We are organising {event} on {when} at {venue}{_in} and would like a quotation for event insurance.',
      B.details,
      'We would like quotes for: (a) public liability cover for the event, including the expo and the route; and (b) personal accident cover for participants and volunteers. Please also send the policy wording, the exclusions, the claim procedure and the last date by which the policy must be taken.',
      'Please contact me on {phone} for any further information.',
    ],
  },
  {
    key: 'sound', scope: 'sound', cat: 'Sound and music', title: 'Loudspeaker and sound permission', who: { role: 'Commissioner of Police', at: 'place' }, lead: 15,
    docs: [
      'Hours of use and the positions of the speakers',
      'Sound vendor name, number of speakers and total power',
      'Venue owner permission',
      'Undertaking to keep the sound within the permitted limits',
      'ID proof of the signatory',
    ],
    tips: 'The Noise Pollution (Regulation and Control) Rules, 2000 need written permission for loudspeakers and do not allow them between 10 pm and 6 am, except in closed premises or a public emergency. For a start before 6 am, ask the police in writing how the early announcements should be handled, and keep loud music for after 6 am.',
    subject: 'Request for permission to use loudspeakers at {venue} for {event} on {when} - reg.',
    body: [
      'I am writing on behalf of {organiser} to request permission to use a public address system at {venue}{_in} during {event}, to be held on {when}.',
      'The system will be used for the start briefing, announcements, commentary at the finish and the prize ceremony, between {start} and {end}. It will be set up by [name of the sound vendor], with [number] speakers of about [total power in watts].',
      'We will keep the volume within the limits prescribed under the Noise Pollution (Regulation and Control) Rules, 2000, and will use the system only during the hours you permit.',
      { when: ['@early'], text: 'As the flag-off is at {start}, before 6:00 am, I request your guidance on how the announcements before 6:00 am should be handled, since the Rules restrict the use of loudspeakers between 10:00 pm and 6:00 am. We will follow the conditions you set.' },
      B.close,
    ],
  },
  {
    key: 'music', scope: 'music', cat: 'Sound and music', title: 'Music licences (IPRS and PPL) for songs played at the event', who: { role: 'IPRS and PPL licensing offices' }, lead: 15,
    to: (party, def) => ['The Licensing Manager', def ? '[IPRS or PPL India office]' : party],
    docs: [
      'Event details with the date, time, venue and expected audience',
      'Where the music will be played (expo, start, finish) and for how long',
      'Whether it is live or recorded, and the DJ or band name',
      'Payment of the tariff (IPRS and PPL each issue their own licence)',
      'Written confirmation from your DJ or sound vendor if they already hold licences that cover the event',
    ],
    tips: 'Playing film or recorded songs in public usually needs a licence from IPRS (for the songwriters and composers) and from PPL (for the recording owners). Ask your DJ or sound vendor whether their licences already cover your event, and get that in writing.',
    subject: 'Request for a public performance licence for music at {event} on {when} - reg.',
    body: [
      'I am writing on behalf of {organiser}. We are organising {event} on {when} at {venue}{_in} and plan to play [live or recorded] music at [the expo, the start and the finish area]. About {participants} runners are expected, along with their families and spectators.',
      'Please let us know which licence you issue for this, the tariff for a one-day public event, the documents required and the last date to apply. We will pay the licence fee before the event.',
      B.close,
    ],
  },
  {
    key: 'drone', scope: 'drone', cat: 'Aviation', title: 'Drone permission (airspace zone and police)', who: { role: 'Commissioner of Police', at: 'place' }, lead: 21,
    docs: [
      'Drone make, model and registration number (Digital Sky)',
      'Pilot name and remote pilot certificate, if required',
      'Airspace map check showing the zone (green, yellow or red) for the flying area',
      'Flying plan: areas, hours and maximum height',
      'Air traffic control permission through Digital Sky, if the area is yellow',
    ],
    tips: 'Under the Drone Rules, 2021 (check the current rules), the Digital Sky airspace map shows green, yellow and red zones: green needs no airspace permission, yellow needs air traffic control permission and red needs the Central Government. Near an airport or a naval area the map may show yellow or red, so check before you promise drone shots. Tell the police too.',
    subject: 'Request for permission to fly a camera drone at {event} on {when} - reg.',
    body: [
      'I am writing on behalf of {organiser} to request permission to fly a camera drone to film {event}, to be held on {when} at {venue}{_in}.',
      'The drone will film the start, the finish and parts of the route between {start} and {end}. It will be flown by [name of the pilot], who holds [certificate number], using [make and model], registered as [registration number]. We have checked the airspace map: the flying area is in a [green, yellow or red] zone.',
      'The drone will be flown within the pilot\'s visual line of sight, at the height and in the areas you permit, and will not be flown over crowds. We will follow the Drone Rules and every condition you set.',
      B.close,
    ],
  },
  {
    key: 'food', scope: 'food', cat: 'Food safety', title: 'Food safety registration for aid-station food and stalls', who: { role: 'Designated Officer (Food Safety)', at: 'place' }, lead: 30,
    docs: [
      'FSSAI licence or registration of each caterer and stall holder',
      'List of items to be served at the aid stations and the finish',
      'Source of drinking water (licensed packaged water or a tested supply)',
      'Hygiene plan: covered storage, gloves, dustbins and hand wash',
      'Written reply from the Food Safety office on whether a temporary registration is needed',
    ],
    tips: 'Ask each caterer and stall holder for a current FSSAI licence or registration. If you give out food or water yourself, ask the Food Safety office whether a temporary registration is needed. Use packaged water from licensed brands, keep cut fruit covered, and keep dustbins at every station.',
    subject: 'Intimation and request for guidance on food and water distribution at {event} on {when} - reg.',
    body: [
      B.about,
      'At the aid stations and at the finish we will give water, electrolyte drink, fruit and light snacks to the runners. About {participants} runners are expected. Our caterers and stall holders hold FSSAI licences or registrations, and copies are enclosed. The drinking water will be packaged water of licensed brands.',
      'I request you to kindly guide us on whether any registration or permission is needed from your office for this event, and to inspect the arrangements if you consider it necessary.',
      B.close,
    ],
  },
  {
    key: 'power', scope: 'power', cat: 'Power', title: 'Electricity and generator permission', who: { role: 'Superintending Engineer, electricity distribution company', at: 'place' }, lead: 21,
    docs: [
      'Venue owner permission',
      'Power requirement in kW for the stage, sound, lights, timing and expo',
      'Name and licence number of the electrician',
      'Generator capacity, earthing and fire safety arrangements',
      'Fee receipt for a temporary connection, if any',
    ],
    tips: 'Ask the local distribution company for the process and charges for a temporary connection (in Andhra Pradesh the companies are APEPDCL, APCPDCL and APSPDCL, by region). If you use a generator, keep it fenced, earthed and away from the crowd, with an extinguisher beside it and the fuel stored safely.',
    subject: 'Request for a temporary electricity connection and permission to use a generator for {event} on {when} - reg.',
    body: [
      B.about,
      'We need electric power for the stage and sound system, lighting, the timing and results equipment and the expo area, from the evening before until {end} on the day, with a total load of about [load in kW]. Where a connection is not practical, we will use a generator of [capacity in kVA], run by a licensed electrician, earthed and fenced away from the crowd, with a fire extinguisher beside it.',
      'Please let us know the procedure, the charges and the documents needed for a temporary connection.',
      B.close,
    ],
  },
  {
    key: 'banner', scope: 'banners', cat: 'Advertising', title: 'Banner, flex board and hoarding permission', who: { role: 'Commissioner', at: 'localBody', fallback: 'Municipal Corporation or local body' }, lead: 21,
    docs: [
      'Banner designs with the text, size and number',
      'List or map of the locations',
      'Dates of display and removal',
      'Fee or deposit receipt',
      'Undertaking to remove all banners after the event',
    ],
    tips: 'Many cities restrict flex boards and hoardings. Ask where banners may go, for how long, and whether flex is allowed at all. Put each banner up only after permission, and take every one down within a day after the event.',
    subject: 'Request for permission to display banners and flex boards for {event} on {when} - reg.',
    body: [
      'I am writing on behalf of {organiser} to request permission to display [number] banners and flex boards for {event}, to be held on {when} at {venue}{_in}. The locations and sizes are: [list of locations and sizes].',
      'The banners will be displayed from [start date] until {date}, and we will remove all of them within 24 hours after the event. We will pay the prescribed fee, if any, and will not put up any banner without your permission.',
      B.close,
    ],
  },
  {
    key: 'forest', scope: 'trail', cat: 'Forest', title: 'Forest department permission (trail routes)', who: { role: 'District Forest Officer', at: 'place' }, lead: 90,
    docs: [
      'Route map with the GPS (GPX) track over the forest area',
      'Dates, times and the number of runners and volunteers',
      'Waste and no-plastic plan, with a no-fire and no-loudspeaker undertaking',
      'Safety and rescue plan: marshals, first aid and evacuation points',
      'Details of guides and local volunteers',
      'Copy of the organiser registration certificate and ID proof of the signatory',
      'Fee receipt, if prescribed',
    ],
    tips: 'Parks, sanctuaries and reserved forests have different rules, so ask the Forest office which category your route falls in and who approves it (the Divisional Forest Officer or the Wildlife Warden). Apply early, since forest permissions can take weeks. No loudspeakers, fires or plastic inside the forest.',
    subject: 'Request for permission to conduct {event} on {when} through forest area - reg.',
    body: [
      B.intro, B.details,
      'The route passes through [name of the forest block, reserve or sanctuary]. A map with the GPS track of the route is enclosed. We have limited the number of runners to {participants}.',
      'To protect the forest and its wildlife we will: not use loudspeakers or light fires; ban single-use plastic and carry back all waste; keep runners on the marked trail; use removable route markers and take all of them down after the event.',
      'We will keep marshals and first-aiders on the route, and request that forest staff accompany or guide us wherever you consider necessary. We will pay any fee prescribed and follow every condition of the permission.',
      B.close,
    ],
  },
  {
    key: 'village', scope: 'trail', cat: 'Community', title: 'Village and Gram Panchayat consent along the trail', who: { role: 'Sarpanch of each village on the route' }, lead: 45,
    to: (party, def) => ['The Sarpanch', def ? '[Gram Panchayat and village name]' : party],
    docs: [
      'Route map showing the village stretch',
      'Date and times when the runners will pass',
      'Plan for noise, waste, and local volunteers or vendors',
      'Gram Panchayat resolution or signed consent',
    ],
    tips: 'For trail routes through villages, meet the Sarpanch before you apply and take written consent. In tribal (Scheduled) areas, ask the Mandal or the tribal development agency office whether any further consultation is expected. Hire local guides, volunteers and vendors where possible.',
    subject: 'Request for consent for {event} on {when} to pass through your village - reg.',
    body: [
      'I am writing on behalf of {organiser}. We are organising {event} on {when}, and the route passes through your village. About {participants} runners will pass between {start} and {end}.',
      'We will keep village roads clear, keep noise low, take away all waste, and use local guides, volunteers and vendors wherever we can. We would also like to hear any concern the village has about the route.',
      'I request your consent and support for the event, along with a resolution of the Gram Panchayat if one is needed. I can be reached on {phone}.',
    ],
  },
  {
    key: 'land', scope: 'other', cat: 'Land', title: 'Highway, port, railway, defence or private land permission', who: { role: 'Authority or owner of the land' }, lead: 45,
    to: (party, def) => ['The Officer in Charge', def ? '[Authority or landowner]' : party],
    docs: [
      'Map marking the stretch or land to be used',
      'Dates, times and the number of people',
      'Copy of the organiser registration certificate and ID proof of the signatory',
      'Signed undertaking on safety, damage and cleaning',
    ],
    tips: 'Highways belong to NHAI or the state Roads and Buildings department; ports, railways and defence areas need their own written permission. Ask the police which of these they want before they sign off.',
    subject: 'Request for permission to use [stretch or land] for {event} on {when} - reg.',
    body: [
      B.intro,
      'We would like to use [the stretch or land shown in the enclosed map] for [the run, the start or the finish]. About {participants} runners are expected between {start} and {end}.',
      B.undertake, B.close,
    ],
  },
  {
    key: 'aims', scope: 'aims', cat: 'Certification', title: 'Course measurement certificate (AIMS or World Athletics)', who: { role: 'Certified course measurer' }, lead: 90,
    to: (party, def) => ['The Certified Course Measurer', def ? '[AIMS or World Athletics measurer]' : party],
    docs: [
      'The distances to be certified',
      'Route map with the start and finish points',
      'Previous certificate number and date, if renewing',
      'Date for the measurement and the road arrangements for it',
      'Measurer\'s fee',
    ],
    tips: 'Use a measurer certified by AIMS or World Athletics. A certificate is valid only for a limited number of years and may need re-validation, so check the dates. Keep the certificate with your race documents.',
    subject: 'Request for measurement and certification of the course for {event} - reg.',
    body: [
      'I am writing on behalf of {organiser}. We are organising {event} on {when} at {venue}{_in}, with runs of {distances}.',
      'We would like the course to be measured and certified by you, or the existing certificate to be validated, under the AIMS and World Athletics course measurement rules. The start is at [start location] and the finish at [finish location].',
      'Please let us know the dates you are available, your fee, and any preparation we should make, such as the road arrangements for the measurement.',
      B.close,
    ],
  },
];

/* ---------- sign-offs on race morning ---------- */
// offset: minutes before the flag-off.
export const SIGNOFFS = [
  { key: 'rd-weather', title: 'Weather go or no-go', owner: 'Race Director', offset: 120, notes: 'Check the forecast and the live conditions: heat and humidity, rain or lightning, wind, visibility and air quality. Agree the triggers beforehand: delay the start, shorten the cut-offs or the route, add water and ice, or cancel. Record the decision and the time.' },
  { key: 'rd-course', title: 'Course cleared and marked', owner: 'Route lead', offset: 90, notes: 'Turns have arrows and marshals; kilometre markers are up; barricades are in place; parked vehicles, debris and animals are cleared; known hazards (potholes, wet patches, loose stones) are marked. The sweep vehicle and sweepers are ready.' },
  { key: 'rd-medical', title: 'Medical team in position', owner: 'Medical lead', offset: 60, notes: 'Ambulances are at their posts with crew and fuel; doctors are at the start and finish; aid posts are stocked; the hospital knows the run is on; radios or phones are tested.' },
  { key: 'rd-police', title: 'Police and traffic in position', owner: 'Operations', offset: 60, notes: 'Traffic personnel are at the main crossings and the diversions are in place. The permission letters are with the team lead and the police liaison numbers are on the control-room sheet.' },
  { key: 'rd-timing', title: 'Start, timing and finish ready', owner: 'Timing lead', offset: 45, notes: 'Start and finish gantry anchored; timing mats connected and tested; chips tested; clock and results desk ready; finish chute marshalled; medals and water at the finish.' },
  { key: 'rd-aid', title: 'Aid stations stocked and staffed', owner: 'Aid-station lead', offset: 45, notes: 'Water, electrolytes, ice and food match the plan; a lead volunteer is at every station; cups, bins and signs are in place; first-aid kits and cold sprays are available.' },
  { key: 'rd-volunteers', title: 'Volunteers and pacers briefed', owner: 'Volunteer lead', offset: 30, notes: 'All volunteers have checked in with their role and vest; marshals know their turn, the cut-off times and the emergency contacts; pacers have flags and group times; radios or WhatsApp groups are tested.' },
  { key: 'rd-kit', scope: 'trail', title: 'Mandatory kit and safety check at the start', owner: 'Start lead', offset: 40, notes: 'Runners show the mandatory kit set in your race rules (for example water, light, whistle, emergency blanket and phone); cut-offs and any route change are announced; the sweepers and the runner tracking are briefed.' },
  { key: 'rd-final', title: 'Final flag-off approval', owner: 'Race Director', offset: 10, notes: 'All sign-offs above are given, the police and medical teams have confirmed, and the announcer is ready. Record the flag-off time.' },
];
// The titles of the lists that earlier versions loaded for every race. A line that still has one of these titles and has
// never been touched is replaced when the template is added.
export const LEGACY_TITLES = {
  'Police permission for road use and traffic diversion': 'police',
  'Municipal corporation permission for the route and venue': 'civic',
  'Forest department permission (trail routes)': 'forest',
  'Fire safety clearance for the expo, stage and tents': 'fire',
  'Ambulance and hospital tie-up letter': 'medical',
  'Event insurance policy': 'insurance',
  'Loudspeaker and sound permission': 'sound',
  'Drone permission (if drones are used)': 'drone',
  'Land or beach owner permission': 'venue',
  'Food safety registration for aid-station food': 'food',
  'Electricity and generator permission': 'power',
  'Banner and hoarding permission': 'banner',
};
SIGNOFFS.forEach((s) => {
  if (s.key !== 'rd-kit') LEGACY_TITLES[s.title] = s.key;
});

export const permitByKey = (k) => PERMITS.find((p) => p.key === k) || null;
export const signoffByKey = (k) => SIGNOFFS.find((p) => p.key === k) || null;
export const itemByKey = (k) => permitByKey(k) || signoffByKey(k);

/* ---------- building the lines ---------- */
// The authority as it is shown on the line, for example "Commissioner of Police, Visakhapatnam".
export function authorityName(p, event, info) {
  const w = p.who || {};
  const at = w.at === 'place' ? info.place : w.at === 'localBody' ? info.localBody : w.at === 'venue' ? event.venue : '';
  const tail = at || w.fallback || '';
  return tail ? w.role + ', ' + tail : w.role;
}
const NOTES_MAX = 600;
// What the panel shows and what is stored for each suggested approval.
export function suggest(event, info, scope) {
  const sc = cleanScope(scope);
  const date = isDate(event.date) ? event.date : '';
  const permits = PERMITS.map((p, i) => ({
    key: p.key,
    kind: 'permit',
    title: p.title,
    cat: p.cat,
    party: authorityName(p, event, info),
    lead: p.lead,
    due: date ? addDays(date, -p.lead) : '',
    scope: p.scope || '',
    on: p.scope ? !!sc[p.scope] : true,
    docs: p.docs.length,
    notes: p.tips.slice(0, NOTES_MAX),
    order: String(i).padStart(3, '0'),
  }));
  const signoffs = SIGNOFFS.map((s, i) => ({
    key: s.key,
    kind: 'signoff',
    title: s.title,
    cat: 'Sign-off',
    owner: s.owner,
    offset: s.offset,
    due: date,
    time: info.startTime ? minusMinutes(info.startTime, s.offset) : '',
    scope: s.scope || '',
    on: s.scope ? !!sc[s.scope] : true,
    notes: s.notes.slice(0, NOTES_MAX),
    order: String(100 + i).padStart(3, '0'),
  }));
  return { permits, signoffs };
}
// The rows to store for the chosen items. picks[key] may change on, party, lead, due, time and owner.
export function planRows(event, info, scope, picks) {
  const s = suggest(event, info, scope);
  const pk = picks && typeof picks === 'object' ? picks : {};
  const rows = [];
  for (const it of s.permits.concat(s.signoffs)) {
    const o = pk[it.key] && typeof pk[it.key] === 'object' ? pk[it.key] : {};
    const on = o.on === undefined ? it.on : !!o.on;
    if (!on) continue;
    const base = { tpl: it.key, title: it.title, cat: it.cat, notes: it.notes, order: it.order, status: 'todo' };
    if (it.kind === 'permit') {
      const lead = o.lead === undefined || o.lead === '' ? it.lead : Math.max(0, Math.min(365, Math.round(Number(o.lead))));
      const due = o.due !== undefined ? String(o.due || '') : isDate(event.date) ? addDays(event.date, -lead) : '';
      rows.push(Object.assign(base, { phase: 'permit', party: o.party !== undefined ? String(o.party).trim().slice(0, 80) : it.party, owner: '', lead, offset: '', due, time: '' }));
    } else {
      const offset = o.offset === undefined || o.offset === '' ? it.offset : Math.max(0, Math.min(600, Math.round(Number(o.offset))));
      const time = o.time !== undefined ? String(o.time || '') : info.startTime ? minusMinutes(info.startTime, offset) : '';
      rows.push(Object.assign(base, { phase: 'raceday', party: '', owner: o.owner !== undefined ? String(o.owner).trim().slice(0, 60) : it.owner, lead: '', offset, due: o.due !== undefined ? String(o.due || '') : it.due, time }));
    }
  }
  return rows;
}

/* ---------- following the race date ---------- */
// When the race date or the start time changes, a line whose date or time was never edited by hand moves with it.
// Returns the fields to change, or null. before and after are {date, start}.
export function follow(row, before, after) {
  if (!row || !row.tpl || !['todo', 'applied'].includes(row.status || 'todo')) return null;
  const out = {};
  if (row.phase === 'permit') {
    const lead = Number(row.lead);
    if (!Number.isFinite(lead) || row.lead === '' || row.lead === undefined) return null;
    const was = isDate(before.date) ? addDays(before.date, -lead) : '';
    const now = isDate(after.date) ? addDays(after.date, -lead) : '';
    if (was !== now && (row.due || '') === was) out.due = now;
  } else if (row.phase === 'raceday') {
    const off = Number(row.offset);
    const wasD = isDate(before.date) ? before.date : '';
    const nowD = isDate(after.date) ? after.date : '';
    if (wasD !== nowD && (row.due || '') === wasD) out.due = nowD;
    if (Number.isFinite(off) && row.offset !== '' && row.offset !== undefined) {
      const wasT = before.start ? minusMinutes(before.start, off) : '';
      const nowT = after.start ? minusMinutes(after.start, off) : '';
      if (wasT !== nowT && (row.time || '') === wasT) out.time = nowT;
    }
  }
  return Object.keys(out).length ? out : null;
}

/* ---------- the letter ---------- */
const LABELS = {
  organiser: 'organiser name', event: 'race name', when: 'race date', date: 'race date', venue: 'venue', participants: 'expected number of runners',
  distances: 'distances', start: 'start time', end: 'finish time', route: 'route', phone: 'phone number', email: 'email', signatory: 'signatory name',
  role: 'signatory role', address: 'organiser address', expoDate: 'expo date', party: 'authority', place: 'city or district',
};
function context(event, info, today) {
  const ed = editionLabel(info.edition);
  const name = String(event.name || '').trim();
  const phrase = name ? (ed ? 'the ' + ed + ' edition of ' + name : name) : '';
  const date = longDate(event.date);
  const wk = weekdayOf(event.date);
  const v = {
    organiser: info.organiser || '',
    _reg: info.regNo ? ' (' + (/^reg/i.test(info.regNo) ? info.regNo : 'registration no. ' + info.regNo) + ')' : '',
    event: phrase,
    when: date ? wk + ', ' + date : '',
    date,
    venue: event.venue || '',
    _in: info.place && !String(event.venue || '').toLowerCase().includes(String(info.place).toLowerCase()) ? ', ' + info.place : '',
    place: info.place || '',
    participants: Number(info.participants) > 0 ? indian(info.participants) : '',
    _volunteers: Number(info.volunteers) > 0 ? 'about ' + indian(info.volunteers) + ' volunteers' : 'our volunteers',
    distances: distanceText(event.cats, event.distanceKm),
    start: clock12(info.startTime),
    end: clock12(info.endTime),
    route: info.route || '',
    expoDate: longDate(info.expoDate),
    phone: info.phone || '',
    email: info.email || '',
    signatory: info.signatory || '',
    role: info.role || '',
    address: info.address || '',
    today: longDate(today),
  };
  return v;
}
function fill(text, v, flags, missing) {
  return String(text).replace(/\{(_?[A-Za-z]+)\}/g, (m, k) => {
    const val = v[k];
    if (k[0] === '_') return val || '';
    if (val) return val;
    const lab = LABELS[k] || k;
    if (!missing.includes(lab)) missing.push(lab);
    return '[' + lab + ']';
  });
}
function flagOn(name, flags) {
  return name === '@early' ? !!flags.early : name[0] === '@' ? !!flags[name.slice(1)] : false;
}
export function paragraphs(list, v, flags, missing) {
  const out = [];
  for (const p of list) {
    if (typeof p === 'string') {
      out.push(fill(p, v, flags, missing));
      continue;
    }
    if (p.when && !p.when.every((k) => (k[0] === '@' ? flagOn(k, flags) : !!v[k]))) continue;
    if (p.unless && p.unless.some((k) => (k[0] === '@' ? flagOn(k, flags) : !!v[k]))) continue;
    out.push(fill(p.text, v, flags, missing));
  }
  return out;
}
const GENERIC = {
  subject: 'Request for permission: {title} for {event} on {when} - reg.',
  body: [B.intro, B.details, B.route, B.undertake, B.close],
};
// row: the approval line {title, party, tpl, ...}. docsDone is not needed here; the caller adds it.
export function renderLetter(row, event, info, opts) {
  opts = opts || {};
  const p = row && row.tpl ? permitByKey(row.tpl) : null;
  const v = context(event, info, opts.today || '');
  const flags = { roads: !!(opts.scope && opts.scope.roads), early: !!info.startTime && info.startTime < '06:00' };
  const missing = [];
  const tpl = p || GENERIC;
  const title = row && row.title ? row.title : p ? p.title : 'Permission';
  const subject = fill(String(tpl.subject).replace('{title}', title.replace(/\s*\(.*?\)\s*$/, '')), v, flags, missing);
  const defParty = p ? authorityName(p, event, info) : '';
  const party = String((row && row.party) || '').trim();
  const isDefault = !party || party === defParty || (!!p && party === authorityName(p, { venue: '' }, {}));
  const the = (t) => (/^the\s/i.test(t) ? t : 'The ' + t);
  const addr = (p && typeof p.to === 'function' ? p.to(party || defParty, isDefault) : [the(party || defParty || '[authority]')]).filter(Boolean);
  if (!party && !p && !missing.includes(LABELS.party)) missing.push(LABELS.party);
  if (info.place && p && p.who && p.who.at === 'place' && !addr.join(' ').toLowerCase().includes(String(info.place).toLowerCase())) addr.push(info.place);
  const body = paragraphs(tpl.body, v, flags, missing);
  const docs = p ? p.docs.slice() : [];
  const head = [info.organiser || '[organiser name]'];
  if (!info.organiser && !missing.includes(LABELS.organiser)) missing.push(LABELS.organiser);
  if (v._reg) head.push(v._reg.slice(2, -1));
  if (info.address) head.push(info.address);
  const contact = [info.phone ? 'Phone: ' + info.phone : '', info.email ? 'Email: ' + info.email : ''].filter(Boolean).join(' | ');
  if (contact) head.push(contact);
  const sig = [];
  for (const k of ['signatory', 'role']) {
    if (!v[k] && !missing.includes(LABELS[k])) missing.push(LABELS[k]);
  }
  sig.push(v.signatory || '[signatory name]');
  if (v.role) sig.push(v.role);
  else sig.push('[signatory role]');
  sig.push(info.organiser || '[organiser name]');
  if (contact) sig.push(contact);
  const lines = [];
  lines.push(head.join('\n'), '', 'Date: ' + (v.today || '[date]'), '', 'To', addr.join('\n'), '', 'Sub: ' + subject, '', 'Respected Sir/Madam,', '');
  body.forEach((t) => lines.push(t, ''));
  lines.push('Thanking you,', '', 'Yours faithfully,', '', '', sig.join('\n'));
  if (docs.length) {
    lines.push('', 'Enclosures:');
    docs.forEach((d, i) => lines.push(i + 1 + '. ' + d));
  }
  return { subject, to: addr.join(', '), text: lines.join('\n'), docs, missing };
}
