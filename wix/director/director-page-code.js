// Page code for the "director" page (a public page: logins are checked by the backend).
// The screen lives in an HTML element with the ID  dirFrame.
// This file only relays its requests to the backend module; the backend checks the session token on every call.
import * as rd from 'backend/racedir.web';
import * as expo from 'backend/exposoft.web';
import * as train from 'backend/training.web';
import * as fin from 'backend/finance.web';
import * as res from 'backend/results.web';
import * as prn from 'backend/print.web';
import * as comms from 'backend/comms.web';
import * as wv from 'backend/waivers.web';
import * as rp from 'backend/reports.web';
import * as pv from 'backend/privacy.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
}

// Asks the backend to ANSWER a failure instead of throwing it (the second argument of every call; failure() and WIRE in rd-auth.js).
const WIRE = 2;
// A backend method asked this way does not throw to the page (Wix would replace the message of a thrown error with its own text on the live site):
// a failure comes back as { __rdError: 'code' }, and the screen is told the same ok:false and code as for a thrown error. A real throw is relayed as before.
function answer(frame, id, result) {
  if (result && typeof result === 'object' && typeof result.__rdError === 'string') frame.postMessage({ kind: 'result', id, ok: false, error: result.__rdError });
  else frame.postMessage({ kind: 'result', id, ok: true, result });
}


const ALLOWED = ['health', 'login', 'logout', 'whoami', 'ensureSetup', 'listEvents', 'saveEvent', 'listShifts', 'saveShift', 'removeShift', 'listVolunteers', 'setVolunteerStatus', 'setVolunteerNote', 'addVolunteer', 'assignShift', 'unassignShift', 'volunteerCheck', 'listRun', 'saveRunItem', 'removeRunItem', 'listLog', 'addLog', 'closeLog', 'listPacers', 'savePaceGroups', 'savePacer', 'removePacer', 'listChecklist', 'toggleCheck', 'addCheck', 'removeCheck', 'overview', 'listQuals', 'saveQualRules', 'saveQualClaim', 'decideQual', 'listWixEvents', 'linkWixEvent', 'wixFormFields', 'saveWixMap', 'importRegs', 'listRegs', 'saveCats', 'dashboard', 'racesSummary', 'listPlan', 'savePlanItem', 'setPlanStatus', 'removePlanItem', 'seedPlanLists', 'expoRaces', 'saveBibPlan', 'assignBibs', 'setBib', 'sendToExpo', 'expoSummary', 'aiStatus', 'aiForecastNow', 'aiBriefing', 'aiAsk', 'aiDraftKinds', 'aiDraft', 'eventInfo', 'saveEventInfo', 'approvalTemplate', 'applyApprovalTemplate', 'approvalLetter', 'setApprovalDoc', 'listTeam', 'saveTeam', 'resetTeamSecret', 'signOutTeam', 'removeTeam'];

// The Expo desk is shown inside this page and has no login of its own. Its calls arrive tagged mod:'expo', with the
// session token of the RaceOS login added by the page, and go to the Expo backend. There is no login, logout or setup here.
const EXPO_ALLOWED = ['health', 'enter', 'whoami', 'chooseDesk', 'loadPage', 'loadSince', 'issue', 'getPickup', 'revert', 'addRunner', 'importRunners', 'removeSample', 'saveConfig', 'listEvents', 'previewFindMyBib', 'syncFromFindMyBib'];

// The Coaching tab calls these Training methods, tagged mod:'train'. Staff sessions are shared, so the same login works.
const TRAIN_ALLOWED = ['listAthletes', 'listCoaches', 'assignCoach', 'declineCoaching', 'stopCoaching'];

// The Finance tab (invoices, claims, cash, orders, the ledger). Calls arrive tagged mod:'fin' with the session token added by
// the screen. The backend decides who may use each one (directors everything; a lead only their own claims).
const FIN_ALLOWED = ['finOverview', 'finSettings', 'finSaveSettings', 'finListInvoices', 'finRaiseInvoice', 'finCancelInvoice', 'finPayInvoice', 'finListOrders', 'finSaveOrder', 'finAddBill', 'finPayOrder', 'finRefundOrder', 'finCancelOrder', 'finListClaims', 'finSaveClaim', 'finDecideClaim', 'finPayClaim', 'finCancelClaim', 'finCash', 'finAddCash', 'finLedger', 'finAddEntry', 'finVoid'];

// The Waves & results tab (waves and corrals, the start list, importing results, the board, awards). Calls arrive tagged mod:'res'
// with the session token added by the screen. The backend decides who may use each one (directors everything; leads only look).
const RES_ALLOWED = ['resOverview', 'resFormFields', 'resSaveSettings', 'resSaveWaves', 'resAssign', 'resPlace', 'resStartList', 'resImport', 'resBoard', 'resSaveRow', 'resVoid', 'resAwards'];

// The Bibs & certificates tab (the design of the bib and of the certificate, previews, printing in pages, the runner page's switches).
// Calls arrive tagged mod:'prn' with the session token added by the screen. The backend decides who may use each one (directors
// everything; leads only preview and print).
const PRN_ALLOWED = ['prnOverview', 'prnSaveTemplate', 'prnPreview', 'prnBibs', 'prnCerts', 'prnSavePublish'];

// The Messages tab (templates, who gets a message, e-mails sent through one Wix e-mail, WhatsApp links, a file of the people, a test).
// Calls arrive tagged mod:'comms' with the session token added by the screen. The backend decides who may use each one (directors
// everything; leads only look).
const COMMS_ALLOWED = ['cmOverview', 'cmPreview', 'cmAudience', 'cmSaveSettings', 'cmSaveTemplate', 'cmPrepare', 'cmSend', 'cmBatch', 'cmLinks', 'cmMark', 'cmExport', 'cmTest'];

// The Waivers tab (the text of the waiver in versions, which question of the form is the waiver, who has signed, papers signed on the day,
// papers to print). Calls arrive tagged mod:'wv' with the session token added by the screen. The backend decides who may use each one
// (directors everything; leads look, print and record a paper).
const WV_ALLOWED = ['wvOverview', 'wvText', 'wvList', 'wvRecords', 'wvSheet', 'wvRecord', 'wvSaveText', 'wvSaveSettings', 'wvVoid'];

// The Reports tab (counts and totals as tables, and a CSV file of a table). Calls arrive tagged mod:'rp' with the session token added by
// the screen. The backend decides who may run which report (directors all; leads all but Money).
const RP_ALLOWED = ['rpList', 'rpRun', 'rpCsv'];

// The Privacy tab and the Show buttons (showing one phone number or e-mail address that a list hides, a file with all the contact details,
// the trail of who looked, erasing a person). Calls arrive tagged mod:'pv' with the session token added by the screen. The backend decides
// who may use each one (directors everything; leads may show one detail).
const PV_ALLOWED = ['pvList', 'pvReveal', 'pvExport', 'pvErasePlan', 'pvErase'];

// Backend check. When a backend module cannot answer, the screen is told which module is empty or old, so nobody has to guess.
// The answer reaches the screen as  code|details.
// Each backend file of the pack is one web module that holds everything it needs (it imports no other file of ours), so a module
// that is empty or old is a file that is missing, cut, misnamed, left out by Wix's build, or from an older pack.
function modules() {
  return [
    ['racedir.web.js', rd, ALLOWED],
    ['exposoft.web.js', expo, EXPO_ALLOWED],
    ['training.web.js', train, TRAIN_ALLOWED],
    ['finance.web.js', fin, FIN_ALLOWED],
    ['results.web.js', res, RES_ALLOWED],
    ['print.web.js', prn, PRN_ALLOWED],
    ['comms.web.js', comms, COMMS_ALLOWED],
    ['waivers.web.js', wv, WV_ALLOWED],
    ['reports.web.js', rp, RP_ALLOWED],
    ['privacy.web.js', pv, PV_ALLOWED],
  ];
}

// A method name that is safe to show: letters, digits, dots and dashes only, and short.
function shortName(x) {
  try {
    return String(x === undefined || x === null ? '' : x).replace(/[^\w.-]/g, '').slice(0, 40);
  } catch (e) {
    return '';
  }
}

function backendCheck() {
  const rows = modules().map((m) => {
    const missing = m[2].filter((name) => !(m[1] && typeof m[1][name] === 'function'));
    return { file: m[0], want: m[2].length, have: m[2].length - missing.length, missing };
  });
  const empty = rows.filter((r) => r.have === 0);
  const old = rows.filter((r) => r.have > 0 && r.missing.length > 0);
  // What to do comes first, then the facts it rests on (a few of them), so a long list can never cut the advice off.
  const parts = [];
  if (empty.length === rows.length) {
    parts.push('none of the ' + rows.length + ' backend files answers: check that the Backend list has the 11 files of this pack with exactly these names, paste each one whole, then save and publish');
  } else {
    empty.slice(0, 3).forEach((r) => parts.push(r.file + ' has none of its ' + r.want + ' methods: paste ' + r.file + ' again, then save and publish'));
    if (empty.length > 3) parts.push(empty.length - 3 + (empty.length === 4 ? ' more module has none of its methods' : ' more modules have none of their methods'));
  }
  old.slice(0, 2).forEach((r) => parts.push(r.file + ' has ' + r.have + ' of ' + r.want + ' methods (missing ' + r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? ', ...' : '') + ')'));
  if (old.length > 2) parts.push(old.length - 2 + (old.length === 3 ? ' more module is an older copy' : ' more modules are older copies'));
  if (!parts.length) parts.push('every backend module answers, so paste the newest backend files and publish');
  return parts.join('; ').slice(0, 420);
}

$w.onReady(function () {
  const frame = pickFrame($w('#dirFrame'));
  // A method this page code does not list is answered with an error, so the screen can say "page code out of date" instead of waiting.
  const refuse = (m) => frame.postMessage({ kind: 'result', id: m.id, ok: false, error: 'page_code_old|does not list ' + (shortName(m.method) || 'this method') });
  // The backend has no such method: the answer says which backend modules are empty or old and which file is probably missing.
  const oldBackend = (m) => frame.postMessage({ kind: 'result', id: m.id, ok: false, error: 'backend_old|' + backendCheck() });
  frame.onMessage(async (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.kind === 'resize') {
      // The embed reports its content height; the page grows or shrinks the element to fit (no inner scrollbar).
      const h = Math.round(Number(msg.height));
      if (h > 0) {
        try {
          frame.height = Math.max(300, Math.min(20000, h));
        } catch (e) {
          // the element cannot be resized from code; it keeps its designed height
        }
      }
      return;
    }
    if (!msg || msg.kind !== 'call') return;
    if (msg.mod === 'expo') {
      if (msg.method === 'ping') {
        frame.postMessage({ kind: 'result', id: msg.id, ok: true, result: { pong: true } });
        return;
      }
      if (EXPO_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof expo[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await expo[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'train') {
      if (TRAIN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof train[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await train[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'res') {
      if (RES_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof res[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await res[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'prn') {
      if (PRN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof prn[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await prn[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'comms') {
      if (COMMS_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof comms[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await comms[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'wv') {
      if (WV_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof wv[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await wv[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'rp') {
      if (RP_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof rp[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await rp[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'pv') {
      if (PV_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof pv[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await pv[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'fin') {
      if (FIN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof fin[msg.method] !== 'function') {
        oldBackend(msg);
        return;
      }
      try {
        const result = await fin[msg.method](msg.arg || {}, WIRE);
        answer(frame, msg.id, result);
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
    if (typeof rd[msg.method] !== 'function') {
      oldBackend(msg);
      return;
    }
    try {
      const result = await rd[msg.method](msg.arg || {}, WIRE);
      answer(frame, msg.id, result);
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
