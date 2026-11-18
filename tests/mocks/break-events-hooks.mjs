// Module hooks for tests/events-lazy.mjs: they make the Wix Events module impossible to open, the way a missing app or a fault at Wix would.
// A shared flag (set by the test) says how: 0 = opens normally, 1 = cannot be found, 2 = refused ("not installed").
let flag;
export function initialize(data) {
  flag = new Int32Array(data.flag);
}
export async function resolve(specifier, context, nextResolve) {
  const how = flag ? Atomics.load(flag, 0) : 0;
  if (specifier === 'wix-events.v2' && how !== 0) {
    const e = new Error(how === 2 ? 'The wix-events.v2 module is not installed on this site' : "Cannot find package 'wix-events.v2' imported from the backend");
    e.code = 'ERR_MODULE_NOT_FOUND';
    throw e;
  }
  return nextResolve(specifier, context);
}
