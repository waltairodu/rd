// Page code for the "coach" page. The screen lives in an HTML element with the ID  coachFrame.
// Only the listed methods can be called from the screen; everything else in the backend stays out of reach.
import * as tr from 'backend/training.web';

const ALLOWED = ['tLogin', 'tLogout', 'tWhoami', 'getTrainSettings', 'saveTrainSettings', 'listPlans', 'getPlan', 'savePlan', 'removePlan', 'listCoaches', 'listAthletes', 'athleteDetail', 'assignCoach', 'stopCoaching', 'declineCoaching', 'coachSaveSession', 'coachRemoveSession', 'coachFeedback', 'coachMessage'];

$w.onReady(function () {
  const frame = $w('#coachFrame');
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
