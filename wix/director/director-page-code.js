// Page code for the "director" page (a public page: logins are checked by the backend).
// The screen lives in an HTML element with the ID  dirFrame.
// This file only relays its requests to the backend module; the backend checks the session token on every call.
import * as rd from 'backend/racedir.web';
import * as expo from 'backend/exposoft.web';

const ALLOWED = ['health', 'login', 'logout', 'whoami', 'ensureSetup', 'listEvents', 'saveEvent', 'listShifts', 'saveShift', 'removeShift', 'listVolunteers', 'setVolunteerStatus', 'setVolunteerNote', 'addVolunteer', 'assignShift', 'unassignShift', 'volunteerCheck', 'listRun', 'saveRunItem', 'removeRunItem', 'listLog', 'addLog', 'closeLog', 'listPacers', 'savePaceGroups', 'savePacer', 'removePacer', 'listChecklist', 'toggleCheck', 'addCheck', 'removeCheck', 'overview', 'listQuals', 'saveQualRules', 'saveQualClaim', 'decideQual', 'listWixEvents', 'linkWixEvent', 'wixFormFields', 'saveWixMap', 'importRegs', 'listRegs', 'listPlan', 'savePlanItem', 'setPlanStatus', 'removePlanItem', 'seedPlanLists'];

// The Expo desk is shown inside this page. Its calls arrive tagged mod:'expo' and go to the Expo backend,
// with the same method list as the stand-alone Expo page.
const EXPO_ALLOWED = ['health', 'login', 'logout', 'whoami', 'chooseDesk', 'loadPage', 'loadSince', 'issue', 'getPickup', 'revert', 'addRunner', 'importRunners', 'removeSample', 'saveConfig', 'listEvents', 'ensureSetup', 'previewFindMyBib', 'syncFromFindMyBib'];

$w.onReady(function () {
  const frame = $w('#dirFrame');
  frame.onMessage(async (event) => {
    const msg = event.data;
    if (!msg || msg.kind !== 'call') return;
    if (msg.mod === 'expo') {
      if (msg.method === 'ping') {
        frame.postMessage({ kind: 'result', id: msg.id, ok: true, result: { pong: true } });
        return;
      }
      if (EXPO_ALLOWED.indexOf(msg.method) < 0) return;
      try {
        const result = await expo[msg.method](msg.arg || {});
        frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
      } catch (e) {
        frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (ALLOWED.indexOf(msg.method) < 0) return;
    try {
      const result = await rd[msg.method](msg.arg || {});
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
