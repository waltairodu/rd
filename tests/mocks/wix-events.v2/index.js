// Minimal stand-in for wix-events.v2: wixEventsV2.queryEvents() and guests.queryGuests(options).
// Tests put rows in global.__EV = { events: [...], guests: [...] }.
const store = () => global.__EV || (global.__EV = { events: [], guests: [], fail: false });
class QB {
  constructor(kind, opts) { this.kind = kind; this.f = []; this.l = 50; this.cur = 0; this.opts = opts || {}; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  limit(n) { this.l = n; return this; }
  skipTo(c) { this.cur = parseInt(c, 10) || 0; return this; }
  async find() {
    if (store().fail) throw new Error('wix events unavailable');
    const all = store()[this.kind].filter((r) => this.f.every((f) => f(r)));
    const items = all.slice(this.cur, this.cur + this.l).map((x) => JSON.parse(JSON.stringify(x)));
    if (this.kind === 'guests' && !(this.opts.fields || []).includes('GUEST_DETAILS')) items.forEach((x) => { delete x.guestDetails; });
    const next = this.cur + this.l < all.length ? String(this.cur + this.l) : '';
    return { items, cursors: { next, prev: '' }, hasNext: () => !!next };
  }
}
exports.wixEventsV2 = { queryEvents: (o) => new QB('events', o) };
exports.guests = { queryGuests: (o) => new QB('guests', o) };
