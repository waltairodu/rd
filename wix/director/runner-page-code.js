// Page code for the public "runner" page (https://your-site/runner). The search screen lives in an HTML element with the ID  runFrame.
// It only offers the three public methods of backend/runner.web, which read and change nothing and show a race only after a
// director has turned a switch on for it. Everything staff-only stays behind the login in the Director page.
// The race comes from the link:  https://your-site/runner?ev=RACE_ID   (without it, the page lists the races that are showing)
import wixLocation from 'wix-location';
import * as pub from 'backend/runner.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
}

const ALLOWED = ['pubRaces', 'pubFind', 'pubCert'];

$w.onReady(function () {
  const frame = pickFrame($w('#runFrame'));
  const ev = String((wixLocation.query && wixLocation.query.ev) || '');
  frame.onMessage(async (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
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
    if (msg.kind === 'hello') {
      frame.postMessage({ kind: 'init', ev });
      return;
    }
    if (msg.kind !== 'call') return;
    // A method this page code does not list is answered with an error, so the screen does not wait for nothing.
    if (ALLOWED.indexOf(msg.method) < 0) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: 'page_code_old' });
      return;
    }
    if (typeof pub[msg.method] !== 'function') {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: 'backend_old' });
      return;
    }
    try {
      const result = await pub[msg.method](msg.arg || {});
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
