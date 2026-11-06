// Test double for wix-crm-backend: the contacts and the triggered e-mails, in memory.
// global.__CRM holds everything a test wants to look at or change:
//   contacts  Map of id -> contact        sent  every e-mail that Wix accepted: { emailId, contactId, variables }
//   calls     every call made: { fn, opts }   fail  { query, create, email }: a function that may throw for a call
//   delay     milliseconds each call waits (for tests that run two sends at once)
// Like Wix, a query and a create need suppressAuth (the visitor who calls a web method has no right to contacts), an e-mail
// to an unsubscribed contact is not sent (and is not an error), and a variable must be text.
const S = global.__CRM || (global.__CRM = { contacts: new Map(), sent: [], calls: [], fail: {}, delay: 0, n: 0 });
const wait = () => (S.delay ? new Promise((r) => setTimeout(r, S.delay)) : Promise.resolve());
const note = (fn, opts) => S.calls.push({ fn, opts: opts === undefined ? undefined : JSON.parse(JSON.stringify(opts)) });
const cl = (o) => JSON.parse(JSON.stringify(o));
class Q {
  constructor() { this.f = []; this.l = 50; }
  eq(k, v) { this.f.push([k, v]); return this; }
  limit(n) { this.l = n; return this; }
  async find(opts) {
    note('query', opts);
    await wait();
    if (!opts || opts.suppressAuth !== true) throw new Error('permission_denied');
    if (S.fail.query) S.fail.query(this.f);
    const items = [...S.contacts.values()].filter((c) => this.f.every(([k, v]) => k === 'info.emails.email' && (c.info.emails || []).some((e) => String(e.email).toLowerCase() === String(v).toLowerCase())));
    return { items: items.slice(0, this.l).map(cl), length: Math.min(items.length, this.l) };
  }
}
exports.contacts = {
  queryContacts: () => new Q(),
  createContact: async (info, opts) => {
    note('create', Object.assign({ info }, opts));
    await wait();
    if (!opts || opts.suppressAuth !== true) throw new Error('permission_denied');
    if (S.fail.create) S.fail.create(info);
    const emails = (info && info.emails) || [];
    if (!emails.length && !(info && info.name)) throw new Error('empty_contact');
    if (opts.allowDuplicates === false && emails.some((e) => [...S.contacts.values()].some((c) => (c.info.emails || []).some((x) => String(x.email).toLowerCase() === String(e.email).toLowerCase())))) throw new Error('duplicate_contact');
    const id = 'c' + ++S.n;
    const c = { _id: id, info: Object.assign({}, cl(info), { extendedFields: { 'emailSubscriptions.subscriptionStatus': 'NOT_SET' } }) };
    S.contacts.set(id, c);
    return cl(c);
  },
};
exports.triggeredEmails = {
  emailContact: async (emailId, contactId, options) => {
    note('email', { emailId, contactId, options });
    await wait();
    if (typeof emailId !== 'string' || !emailId) throw new Error('bad_email_id');
    const c = S.contacts.get(contactId);
    if (!c) throw new Error('contact_not_found');
    const vars = (options && options.variables) || {};
    for (const k of Object.keys(vars)) if (typeof vars[k] !== 'string') throw new Error('variable_not_text');
    if (S.fail.email) S.fail.email(emailId, contactId, options);
    if (c.info.extendedFields['emailSubscriptions.subscriptionStatus'] === 'UNSUBSCRIBED') return;
    S.sent.push({ emailId, contactId, variables: cl(vars) });
  },
};
