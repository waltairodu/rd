// Page code for the "director" page (a public page: logins are checked by the backend).
// The screen lives in an HTML element with the ID  dirFrame.
// This file only relays its requests to the backend module; the backend checks the session token on every call.
import * as rd from 'backend/racedir.web';
import * as expo from 'backend/exposoft.web';
import * as train from 'backend/training.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
}


const ALLOWED = ['health', 'login', 'logout', 'whoami', 'ensureSetup', 'listEvents', 'saveEvent', 'listShifts', 'saveShift', 'removeShift', 'listVolunteers', 'setVolunteerStatus', 'setVolunteerNote', 'addVolunteer', 'assignShift', 'unassignShift', 'volunteerCheck', 'listRun', 'saveRunItem', 'removeRunItem', 'listLog', 'addLog', 'closeLog', 'listPacers', 'savePaceGroups', 'savePacer', 'removePacer', 'listChecklist', 'toggleCheck', 'addCheck', 'removeCheck', 'overview', 'listQuals', 'saveQualRules', 'saveQualClaim', 'decideQual', 'listWixEvents', 'linkWixEvent', 'wixFormFields', 'saveWixMap', 'importRegs', 'listRegs', 'saveCats', 'dashboard', 'racesSummary', 'listPlan', 'savePlanItem', 'setPlanStatus', 'removePlanItem', 'seedPlanLists', 'expoRaces', 'saveBibPlan', 'assignBibs', 'setBib', 'sendToExpo', 'expoSummary', 'aiStatus', 'aiForecastNow', 'aiBriefing', 'aiAsk', 'aiDraftKinds', 'aiDraft', 'eventInfo', 'saveEventInfo', 'approvalTemplate', 'applyApprovalTemplate', 'approvalLetter', 'setApprovalDoc'];

// The Expo desk is shown inside this page. Its calls arrive tagged mod:'expo' and go to the Expo backend,
// with the same method list as the stand-alone Expo page.
const EXPO_ALLOWED = ['health', 'login', 'logout', 'whoami', 'chooseDesk', 'loadPage', 'loadSince', 'issue', 'getPickup', 'revert', 'addRunner', 'importRunners', 'removeSample', 'saveConfig', 'listEvents', 'ensureSetup', 'previewFindMyBib', 'syncFromFindMyBib'];

// The Coaching tab calls these Training methods, tagged mod:'train'. Staff sessions are shared, so the same login works.
const TRAIN_ALLOWED = ['listAthletes', 'listCoaches', 'assignCoach', 'declineCoaching', 'stopCoaching'];

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
      try {
        const result = await train[msg.method](msg.arg || {});
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
