// Page code for the athlete "train" page. The screen lives in an HTML element with the ID  trainFrame.
// Only the listed methods can be called from the screen; everything else in the backend stays out of reach.
import * as tr from 'backend/training.web';

const ALLOWED = ['openPlans', 'athleteSignup', 'athleteLogin', 'athleteLogout', 'changePin', 'enrollPlan', 'endPlan', 'myHome', 'mySessions', 'logSession', 'addMySession', 'requestCoaching', 'cancelCoachingRequest', 'myMessages', 'sendMyMessage'];

$w.onReady(function () {
  const frame = $w('#trainFrame');
  frame.onMessage(async (event) => {
    const msg = event.data;
    if (!msg) return;
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
