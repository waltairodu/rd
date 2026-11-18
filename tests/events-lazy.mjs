// The Wix Events module is opened only when a Registrations screen asks for it, never when racedir.web.js loads (wix/director/racedir.web.js, eventsApi).
// Here the module is made impossible to open (tests/mocks/break-events-hooks.mjs) and the file must still load, log in and do everything except the three
// Registrations calls, which answer "wix_events_unavailable" (cannot be opened) or "wix_events_denied" (not installed / not allowed) and nothing else.
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { suite } from './lib.mjs';
import wd from 'wix-data';

const { ok, err, eq, done } = suite('Events-lazy');
const SA = { suppressAuth: true };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ---- E1: nothing in the backend opens the Events module while a file loads
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : x.name.endsWith('.js') ? [path.join(d, x.name)] : []));
const files = walk(path.join(root, 'wix'));
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const staticEvents = files.filter((f) => /^\s*import\b[^;]*['"]wix-events[.\-]v2['"]/m.test(stripComments(fs.readFileSync(f, 'utf8'))) || /\brequire\(\s*['"]wix-events/.test(stripComments(fs.readFileSync(f, 'utf8'))));
eq(staticEvents.map((f) => path.relative(root, f)), [], 'E1 no backend file imports wix-events.v2 at the top (that import is the one that stops a file from loading)');
const racedir = stripComments(fs.readFileSync(path.join(root, 'wix/director/racedir.web.js'), 'utf8'));
eq(racedir.match(/import\(\s*['"]wix-events\.v2['"]\s*\)/g) || [], ["import('wix-events.v2')"], 'E1 racedir.web.js opens it in exactly one place');
ok(/const eventsApi = \(\) => import\('wix-events\.v2'\);/.test(racedir), 'E1 that one place is the small eventsApi function');
const users = [...racedir.matchAll(/\beventsApi\(\)/g)].length;
eq(users, 2, 'E1 only two spots call eventsApi: the list of Wix events and the ticket holders (' + users + ' found)');
const holderCalls = [...racedir.matchAll(/\bholders\(/g)].length;
eq(holderCalls, 3, 'E1 only the Wix form fields and the registration import ask for ticket holders (' + holderCalls + ' calls incl. the definition)');

// ---- the module cannot be opened from here on
const flag = new Int32Array(new SharedArrayBuffer(4));
Atomics.store(flag, 0, 1);
register('./mocks/break-events-hooks.mjs', { parentURL: import.meta.url, data: { flag: flag.buffer } });
global.__EV = { events: [{ _id: 'w1', title: 'VHM 2026', dateAndTimeSettings: { startDate: '2026-12-13T00:30:00.000Z' }, status: 'UPCOMING' }], guests: [], fail: false };

let D;
try {
  D = await import('./racedir.test.mjs');
} catch (e) {
  ok(false, 'E2 racedir.web.js loads while the Events module cannot be opened   [' + (e && e.message) + ']');
  done();
}
ok(typeof D.login === 'function' && typeof D.health === 'function', 'E2 racedir.web.js loads while the Events module cannot be opened');
ok((await D.health()).ok === true, 'E2 health answers');
await wd.insert('ExpoStaff', { username: 'boss', password: 'pw-boss', role: 'admin', desks: '', name: 'BOSS', failCount: '0', lockUntil: '' }, SA);
await wd.insert('ExpoStaff', { username: 'lead1', password: 'pw-lead1', role: 'lead', desks: '', name: 'LEAD', failCount: '0', lockUntil: '' }, SA);
const boss = await D.login({ username: 'boss', password: 'pw-boss' });
const lead = await D.login({ username: 'lead1', password: 'pw-lead1' });
ok(boss.role === 'director' && boss.token, 'E2 the Director login works');
ok((await D.whoami({ token: boss.token })).role === 'director', 'E2 whoami works');
ok((await err(D.login({ username: 'boss', password: 'nope' }))) === 'bad_login', 'E2 a wrong password is still "bad_login" (not an Events error)');

// ---- E3: everything that does not need Wix Events carries on
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const ev = (await D.saveEvent({ token: boss.token, name: 'VHM', date: future })).event;
ok(ev && ev.id, 'E3 an event can be created');
ok((await D.listEvents({ token: boss.token })).events.length === 1, 'E3 the events list works');
ok((await D.linkWixEvent({ token: boss.token, ev: ev.id, wixEventId: 'w1' })).ok === true, 'E3 an event can be linked to a Wix event id (it needs no Wix call)');
ok((await D.saveWixMap({ token: boss.token, ev: ev.id, map: { size: 'T-shirt size' } })).ok === true, 'E3 the form mapping can be saved');

// ---- E4: the three Registrations calls say plainly what is wrong
for (const [how, code, what] of [[1, 'wix_events_unavailable', 'cannot be opened'], [2, 'wix_events_denied', 'is not installed']]) {
  Atomics.store(flag, 0, how);
  eq(await err(D.listWixEvents({ token: boss.token })), code, 'E4 the list of Wix events says "' + code + '" when the module ' + what);
  eq(await err(D.wixFormFields({ token: boss.token, ev: ev.id })), code, 'E4 the form fields say "' + code + '" when the module ' + what);
  eq(await err(D.importRegs({ token: boss.token, ev: ev.id })), code, 'E4 the registration import says "' + code + '" when the module ' + what);
  ok((await D.listEvents({ token: boss.token })).events.length === 1, 'E4 the events list still works when the module ' + what);
  ok((await D.whoami({ token: boss.token })).role === 'director', 'E4 whoami still works when the module ' + what);
}
Atomics.store(flag, 0, 1);
eq(await err(D.listWixEvents({ token: lead.token })), 'director_only', 'E4 the login check still comes first: a lead is refused before Wix Events is touched');
eq(await err(D.listWixEvents({})), 'not_logged_in', 'E4 no login, no answer: "not_logged_in" (Wix Events is not touched)');
eq(await err(D.listWixEvents({ token: 'x'.repeat(30) })), 'not_logged_in', 'E4 a made-up token is refused before Wix Events is touched');

// ---- E5: a failed open does not stick; when Wix Events can be opened again the next call works
Atomics.store(flag, 0, 0);
const list = await D.listWixEvents({ token: boss.token });
ok(Array.isArray(list.events) && list.events.length === 1 && list.events[0].id === 'w1' && list.events[0].title === 'VHM 2026', 'E5 once the module opens, the very next call lists the Wix events');
global.__EV.fail = true;
eq(await err(D.listWixEvents({ token: boss.token })), 'wix_events_unavailable', 'E5 a fault while asking Wix Events is "wix_events_unavailable" too');
global.__EV.fail = false;
done();
