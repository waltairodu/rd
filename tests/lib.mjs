// Small helpers shared by the newer test suites (unit, integration, penetration, security).
// Every suite ends with one line, "<Name>: N passed, M failed", which tests/all.sh and tests/report.sh read.
export function suite(name) {
  let pass = 0;
  let fail = 0;
  const failed = [];
  const ok = (cond, msg) => {
    if (cond) pass++;
    else {
      fail++;
      failed.push(msg);
      console.log('  FAIL', msg);
    }
  };
  // The message of the error a promise throws ('' when it does not throw).
  const err = async (p) => {
    try {
      await p;
      return '';
    } catch (e) {
      return (e && e.message) || String(e);
    }
  };
  // ok() for a call that must be refused with exactly this error.
  const refused = async (p, code, msg) => {
    const got = await err(p);
    ok(got === code, msg + (got === code ? '' : '   [wanted ' + code + ', got ' + (got || 'no error') + ']'));
  };
  const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : '   [got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ']'));
  const done = () => {
    console.log(`\n${name}: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };
  return { ok, err, refused, eq, done, counts: () => ({ pass, fail }) };
}

// Clears the in-memory Wix mock between scenarios inside one suite.
export function resetDb() {
  const DB = global.__DB;
  for (const k of Object.keys(DB)) DB[k].clear();
}

export const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// "Ten minutes later" for the login limits: every login slot (see takeSlot in rd-auth.js) is given back, as it would be
// by the time a lock made by wrong tries has run out. Tests that move a lock time into the past call this too.
export function tenMinutesLater() {
  const t = global.__DB && global.__DB.RDRate;
  if (!t) return;
  for (const k of [...t.keys()]) if (k.startsWith('att~') || k.startsWith('ath~')) t.delete(k);
}

// "An hour later" for the setup-key limits.
export function anHourLater() {
  const t = global.__DB && global.__DB.RDRate;
  if (!t) return;
  for (const k of [...t.keys()]) if (k.startsWith('setup~') || k.startsWith('tsetup~')) t.delete(k);
}
