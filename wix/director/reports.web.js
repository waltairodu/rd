// backend/reports.web.js
// Reports for RaceOS (Velo): counts and totals for one race as a few tables, and a CSV file of any table. It uses the same logins as
// RaceOS (the session token the page already holds).
//
//   director (admin or director)  every report, the Money report included
//   lead                          every report except Money
//   viewer, desk, coach, other    refused
//
// A report only reads. It is built from counts: a name, a bib, a phone number, an e-mail address or a date of birth is read to put a
// person in a group and is never copied into a table (see rd-report.js). Saving a table as a CSV file is written to the audit trail
// (who, which report, which table, how many rows) and nothing else is written anywhere. A source that cannot be read is named in the
// answer, so a report never shows a zero for something that was not read.
import { Permissions, webMethod as wixWebMethod } from 'wix-web-module';
import wixData from 'wix-data';
import { kindOf, unameOf, tidyError } from './rd-auth.js';
import { cleanText, lc, board, parseJson } from './rd-results.js';
import { SA, C, rows, getEvent, raceOf, knownCats, regMap, getSettings } from './rd-data.js';
import { oneLine } from './rd-comms.js';
import { bookOf, countsOf, waiverRunners, waiverVolunteers } from './rd-waiver.js';
import { summary, summaryOut, regRevenue, normInvoice, normOrder, normClaim, normLedger, istToday } from './rd-finance.js';
import { reportOf, allowedFor, regReport, raceReport, volReport, waiverReport, msgReport, moneyReport, tableCsv, csvName } from './rd-report.js';

// Every method below goes through this: an error this module does not know (a native error, or the text of a failed read) is logged
// and answered with 'server_error' only, so no internal detail ever reaches the browser. These are the only codes that leave.
const CODES = new Set(['not_logged_in', 'not_allowed', 'director_only', 'rp_bad_report', 'rp_bad_table', 'no_event', 'setup_needed', 'server_error']);
const webMethod = (permission, fn) =>
  wixWebMethod(permission, async (arg) => {
    try {
      return await fn(arg);
    } catch (e) {
      const t = tidyError(e, 'reports');
      if (t && typeof t.message === 'string' && CODES.has(t.message)) throw t;
      try {
        console.error('reports: ' + (e && e.stack ? e.stack : e));
      } catch (x) {
        // logging is best effort
      }
      throw new Error('server_error');
    }
  });

const VOLS = 'RDVolunteers';
const SHIFTS = 'RDShifts';
const ASSIGN = 'RDAssignments';
const COMMS = 'RDComms';
const INVS = 'RDInvoices';
const ORDS = 'RDOrders';
const CLMS = 'RDClaims';
const LED = 'RDLedger';
const PLAN = 'RDPlan';
const nowIso = () => new Date().toISOString();
const bad = (code) => new Error(code);

/* ---------- who is asking ---------- */
async function staffRows() {
  try {
    const out = [];
    for (let skip = 0; skip < 5000; skip += 1000) {
      const r = await wixData.query(C.STAFF).ascending('_id').skip(skip).limit(1000).find(SA);
      out.push(...r.items);
      if (r.items.length < 1000) break;
    }
    return out;
  } catch (e) {
    throw new Error('setup_needed');
  }
}
// Every method starts here: a live session of a director or a lead.
async function cauth(arg) {
  // A token is text. A list or an object that would turn into a token when printed is not one.
  const t = arg && typeof arg.token === 'string' ? arg.token : '';
  if (t.length < 20) throw new Error('not_logged_in');
  let sess;
  try {
    sess = (await wixData.query(C.SESS).eq('token', t).limit(1).find(SA)).items[0];
  } catch (e) {
    throw new Error('setup_needed');
  }
  if (!sess || !(Date.parse(sess.expires) > Date.now())) throw new Error('not_logged_in');
  const u = (await staffRows()).find((r) => lc(unameOf(r)) === lc(sess.username));
  if (!u) throw new Error('not_logged_in');
  const kind = kindOf(u);
  if (kind !== 'director' && kind !== 'lead') throw new Error('not_allowed');
  return { role: kind, name: String(u.name || unameOf(u)), username: String(unameOf(u)) };
}
async function audit(a, action, target, detail) {
  try {
    await wixData.insert(C.AUDIT, { at: nowIso(), by: a.username, action, target: cleanText(target, 60), detail: cleanText(detail, 200) }, SA);
  } catch (e) {
    // the note is lost, the file is not
  }
}

/* ---------- arguments ---------- */
// The report that was asked for, when this person may run it.
function reportFor(v, a) {
  const rep = reportOf(v);
  if (!rep) throw bad('rp_bad_report');
  if (rep.need === 'director' && a.role !== 'director') throw bad('director_only');
  return rep;
}
const raceOut = (e) => ({ id: e._id, name: oneLine(e.name, 80), date: typeof e.date === 'string' ? e.date : '', venue: oneLine(e.venue, 120) });

/* ---------- building ---------- */
// Reads what one report needs and makes its tables. A source that cannot be read (the collection is not there yet, or the read failed)
// is named in `unread` and counts as empty, so the screen can say so.
async function build(id, e) {
  const ev = e._id;
  const race = raceOf(e);
  const unread = [];
  const pull = (label, col) =>
    rows(col, ev).catch(() => {
      if (!unread.includes(label)) unread.push(label);
      return [];
    });
  let tables;
  if (id === 'reg') {
    const [regs, st] = await Promise.all([rows(C.REGS, ev), getSettings(ev)]);
    tables = regReport(regs, { st, race });
  } else if (id === 'race') {
    const [regs, res, st] = await Promise.all([rows(C.REGS, ev), pull('Results', C.RESULTS), getSettings(ev)]);
    tables = raceReport(board(res, regMap(regs, st.map), { settings: st, raceDate: race.raceDate, cats: race.cats }));
  } else if (id === 'vol') {
    const [vols, shifts, asg] = await Promise.all([pull('Volunteers', VOLS), pull('Shifts', SHIFTS), pull('Shift places', ASSIGN)]);
    tables = volReport(vols, shifts, asg);
  } else if (id === 'waiver') {
    const [regs, vols, wv] = await Promise.all([rows(C.REGS, ev), pull('Volunteers', VOLS), pull('Waiver records', C.WAIV)]);
    const book = bookOf(wv);
    tables = waiverReport({
      runners: countsOf('runner', waiverRunners(regs), book, knownCats(race, regs)),
      volunteers: countsOf('volunteer', waiverVolunteers(vols).filter((v) => v.event === ev), book),
    });
  } else if (id === 'msg') {
    tables = msgReport(await pull('Messages', COMMS));
  } else {
    const [inv, ord, clm, led, regs, plan] = await Promise.all([pull('Invoices', INVS), pull('Orders', ORDS), pull('Claims', CLMS), pull('Ledger', LED), rows(C.REGS, ev), pull('Budget', PLAN)]);
    const j = parseJson(e.json, {});
    const cats = Array.isArray(j.cats) ? j.cats.filter((c) => c && typeof c === 'object') : [];
    const s = summary(inv.map(normInvoice), ord.map(normOrder), clm.map(normClaim), led.map(normLedger), plan.filter((p) => p.kind === 'budget'), regRevenue(cats, regs), istToday());
    tables = moneyReport(summaryOut(s));
  }
  return { tables, unread };
}

/* ---------- the three methods ---------- */
// The race and the reports this person may run.
export const rpList = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg);
  const e = await getEvent(arg.ev);
  return { me: { role: a.role, name: a.name }, race: raceOut(e), reports: allowedFor(a.role).map((r) => ({ id: r.id, title: r.title, what: r.what })) };
});

// One report: its tables of counts.
export const rpRun = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg);
  const rep = reportFor(arg.report, a);
  const e = await getEvent(arg.ev);
  const built = await build(rep.id, e);
  return { report: { id: rep.id, title: rep.title, what: rep.what }, race: raceOut(e), made: nowIso(), tables: built.tables, unread: built.unread };
});

// One table of one report as a CSV file (a name for the file and its text). The save is written to the audit trail.
export const rpCsv = webMethod(Permissions.Anyone, async (arg) => {
  const a = await cauth(arg);
  const rep = reportFor(arg.report, a);
  if (typeof arg.table !== 'string' || !arg.table || arg.table.length > 40) throw bad('rp_bad_table');
  const e = await getEvent(arg.ev);
  const built = await build(rep.id, e);
  const t = built.tables.find((x) => x.id === arg.table);
  if (!t) throw bad('rp_bad_table');
  await audit(a, 'report saved as CSV', e._id, rep.id + ' / ' + t.id + ' · ' + t.rows.length + ' rows');
  return { name: csvName(e.name, rep.id, t.id), csv: tableCsv(t), rows: t.rows.length, unread: built.unread };
});

