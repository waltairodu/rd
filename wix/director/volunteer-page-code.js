// Page code for the public "volunteer" page. The sign-up form lives in an HTML element with the ID  volFrame.
// It only offers the four public methods; everything staff-only stays behind a login in the Director page.
// The race comes from the link:  https://your-site/volunteer?ev=RACE_ID
import wixLocation from 'wix-location';
import * as rd from 'backend/racedir.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
}


const ALLOWED = ['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'];

$w.onReady(function () {
  const frame = pickFrame($w('#volFrame'));
  const ev = String((wixLocation.query && wixLocation.query.ev) || '');
  frame.onMessage(async (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.kind === 'hello') {
      frame.postMessage({ kind: 'init', ev });
      return;
    }
    if (msg.kind !== 'call' || ALLOWED.indexOf(msg.method) < 0) return;
    try {
      const result = await rd[msg.method](msg.arg || {});
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
