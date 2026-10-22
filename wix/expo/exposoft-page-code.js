// Page code for the "exposoft" page (a public page: logins are checked by the backend).
// The desk screen lives in an HTML element with the ID  expoFrame.
// This file only relays its requests to the backend module; the backend checks
// the session token against ExpoStaff / ExpoSessions on every call.
import * as expo from 'backend/exposoft.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
}


const ALLOWED = ['health', 'login', 'logout', 'whoami', 'chooseDesk', 'loadPage', 'loadSince', 'issue', 'getPickup', 'revert', 'addRunner', 'importRunners', 'removeSample', 'saveConfig', 'listEvents', 'ensureSetup', 'previewFindMyBib', 'syncFromFindMyBib'];

$w.onReady(function () {
  const frame = pickFrame($w('#expoFrame'));
  frame.onMessage(async (event) => {
    const msg = event.data;
    if (!msg || msg.kind !== 'call') return;
    if (msg.method === 'ping') {
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result: { pong: true } });
      return;
    }
    if (ALLOWED.indexOf(msg.method) < 0) return;
    try {
      const result = await expo[msg.method](msg.arg || {});
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
