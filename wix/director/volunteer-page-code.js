// Page code for the public "volunteer" page. The sign-up form lives in an HTML element with the ID  volFrame.
// It only offers the four public methods; everything staff-only stays behind a login in the Director page.
// The race comes from the link:  https://your-site/volunteer?ev=RACE_ID
import wixLocation from 'wix-location';
import * as rd from 'backend/racedir.web';

const ALLOWED = ['openEvents', 'openShifts', 'volunteerSignup', 'volunteerStatus'];

$w.onReady(function () {
  const frame = $w('#volFrame');
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
