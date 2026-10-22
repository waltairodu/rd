// Page code for the athlete "train" page. The screen lives in an HTML element with the ID  trainFrame.
// Only the listed methods can be called from the screen; everything else in the backend stays out of reach.
import * as tr from 'backend/training.web';

// Finds the HTML embed. If the element ID is missing or mistyped, it falls back to the page's HTML embed by type.
function pickFrame(byId) {
  if (byId && typeof byId.onMessage === 'function') return byId;
  const byType = $w('HtmlComponent');
  if (byType && typeof byType.onMessage === 'function') return byType;
  console.error('No HTML embed found on this page. Add the HTML embed and give it the element ID named at the top of this file.');
  return { onMessage() {}, postMessage() {} };
}


const ALLOWED = ['openPlans', 'athleteSignup', 'athleteLogin', 'athleteLogout', 'changePin', 'enrollPlan', 'endPlan', 'myHome', 'mySessions', 'logSession', 'addMySession', 'requestCoaching', 'cancelCoachingRequest', 'myMessages', 'sendMyMessage'];

$w.onReady(function () {
  const frame = pickFrame($w('#trainFrame'));
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
    if (msg.kind === 'hello') {
      frame.postMessage({ kind: 'init' });
      return;
    }
    if (msg.kind !== 'call' || ALLOWED.indexOf(msg.method) < 0) return;
    try {
      const result = await tr[msg.method](msg.arg || {});
      frame.postMessage({ kind: 'result', id: msg.id, ok: true, result });
    } catch (e) {
      frame.postMessage({ kind: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
});
