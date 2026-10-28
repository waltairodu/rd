// Page code for the "director" page (a public page: logins are checked by the backend).
// The screen lives in an HTML element with the ID  dirFrame.
// This file only relays its requests to the backend module; the backend checks the session token on every call.
import * as rd from 'backend/racedir.web';
import * as expo from 'backend/exposoft.web';
import * as train from 'backend/training.web';
import * as fin from 'backend/finance.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
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

$w.onReady(function () {
  const frame = pickFrame($w('#dirFrame'));
  // A method this page code does not list is answered with an error, so the screen can say "page code out of date" instead of waiting.
  const refuse = (m) => frame.postMessage({ kind: 'result', id: m.id, ok: false, error: 'page_code_old' });
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
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: 'backend_old' });
        return;
      }
      try {
        const result = await expo[msg.method](msg.arg || {});
        frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'train') {
      if (TRAIN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof train[msg.method] !== 'function') {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: 'backend_old' });
        return;
      }
      try {
        const result = await train[msg.method](msg.arg || {});
        frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (msg.mod === 'fin') {
      if (FIN_ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
      if (typeof fin[msg.method] !== 'function') {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: 'backend_old' });
        return;
      }
      try {
        const result = await fin[msg.method](msg.arg || {});
        frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (ALLOWED.indexOf(msg.method) < 0) return refuse(msg);
    if (typeof rd[msg.method] !== 'function') {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: 'backend_old' });
      return;
    }
    try {
      const result = await rd[msg.method](msg.arg || {});
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
