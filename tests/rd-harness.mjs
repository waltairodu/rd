// Shared helper for the screen-level tests of the combined /rd page (RaceOS with the Expo desk inside it).
// Like the real thing: the Wix page (outer window) holds the page-code relay; the /rd page is a frame in it; the Expo desk
// is a frame inside that. Messages from the desk carry their real sender, as in a browser.
// By default the relay calls the backend modules directly; pass `relay` to put the real page code (with its allow-lists) in between.
import fs from 'fs';
import { execSync } from 'child_process';
import { JSDOM, VirtualConsole } from 'jsdom';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeHarness({ D, X, T, onJsError, relay }) {
  execSync('python3 ../tools/build_rd.py');
  const html = fs.readFileSync('../wix/director/rd-embed.html', 'utf8');
  const log = { calls: [], args: [], frameSent: [], tokens: [], answers: [], jsErrors: [], console: [] };

  function open() {
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => {
      log.jsErrors.push(e.message);
      if (onJsError) onJsError(e);
    });
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) vc.on(k, (...a) => log.console.push(a.map(String).join(' ')));
    const outer = new JSDOM('<body></body>', { virtualConsole: vc, runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
    const ow = outer.window;
    const fr = ow.document.createElement('iframe');
    ow.document.body.appendChild(fr);
    const w = fr.contentWindow;
    const cd = fr.contentDocument;
    cd.open();
    // jsdom ignores iframe srcdoc, so write the page into the frame the way a browser would load it.
    Object.defineProperty(w.HTMLIFrameElement.prototype, 'srcdoc', {
      configurable: true,
      set(v) {
        const f = this;
        setTimeout(() => {
          const iw = f.contentWindow;
          const proxy = {
            postMessage(data) {
              log.frameSent.push(data);
              w.dispatchEvent(new w.MessageEvent('message', { data, source: iw }));
            },
          };
          Object.defineProperty(iw, 'parent', { configurable: true, get: () => proxy });
          // What the RaceOS page sends down to the desk frame arrives as coming from the page itself (the frame's parent).
          iw.postMessage = (data) => setTimeout(() => iw.dispatchEvent(new iw.MessageEvent('message', { data, source: proxy })), 0);
          const c2 = f.contentDocument;
          c2.open();
          c2.write(v);
          c2.close();
          f.dispatchEvent(new w.Event('load'));
        }, 20);
      },
      get() {
        return '';
      },
    });
    cd.write(html);
    cd.close();
    const d = w.document;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    const reply = (m, ok, payload) => {
      const msg = ok ? { kind: 'result', id: m.id, ok: true, result: JSON.parse(JSON.stringify(payload === undefined ? null : payload)) } : { kind: 'result', id: m.id, ok: false, error: payload };
      log.answers.push(msg);
      w.postMessage(msg, '*');
    };
    ow.addEventListener('message', async (e) => {
      const m = e.data;
      if (!m || m.kind !== 'call') return;
      log.calls.push((m.mod || 'rd') + ':' + m.method);
      log.args.push({ mod: m.mod || 'rd', method: m.method, arg: m.arg });
      if (relay) return relay(m, reply);
      const mod = m.mod === 'expo' ? X : m.mod === 'train' ? T : D;
      try {
        const r = m.method === 'ping' ? { pong: true } : await mod[m.method](m.arg);
        if (m.method === 'login' && r && r.token) log.tokens.push(r.token);
        reply(m, true, r);
      } catch (x) {
        reply(m, false, x.message);
      }
    });
    return { w, d, ow };
  }

  const set = (w, el, v) => {
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
  const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ') : '');
  const inner = (s) => {
    const f = s.d.querySelector('#expoFrame');
    return f && f.contentDocument;
  };
  async function login(user, pw, wait) {
    const s = open();
    await sleep(60);
    set(s.w, s.d.querySelector('#lgUser'), user);
    set(s.w, s.d.querySelector('#lgPass'), pw);
    submit(s.w, s.d.querySelector('#loginForm'));
    await sleep(wait || 500);
    return s;
  }
  const reset = () => {
    log.calls.length = 0;
    log.args.length = 0;
    log.frameSent.length = 0;
    log.tokens.length = 0;
    log.answers.length = 0;
    log.console.length = 0;
  };
  return { html, log, open, set, change, submit, click, txt, inner, login, reset };
}
