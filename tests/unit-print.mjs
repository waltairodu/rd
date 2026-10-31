// UNIT TESTS (Print rules): safe text, colours and images, placeholders, the design of a bib and of a certificate, the papers
// they make, the three switches of the runner page, and what the public page may be told about a runner. The library has no
// database and no Wix in it, so every rule is tested on its own.
import * as P from './rd-print.test.mjs';
import { suite } from './lib.mjs';
const { ok, eq, done } = suite('Unit: Print rules');

const HOSTILE = [undefined, null, true, false, 0, -1, 1.5, NaN, Infinity, '', ' ', 'x'.repeat(5000), '\u0000', '‮', {}, [], [[]], { toString() { throw new Error('boom'); } }, () => 1];
const noThrow = (fn) => HOSTILE.every((h) => { try { fn(h); return true; } catch (e) { return false; } });
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
const RACE = { name: 'Vizag Half Marathon', date: '2027-02-07', venue: 'Beach Road' };
const CATS = ['10 K', '21 K'];
const CATLEN = [{ name: '10 K', km: 10 }, { name: '21 K', km: 21.0975 }];
// Every value inside a style="" in the output is a number with mm or pt, a colour or a size word: nothing a person typed.
const styles = (h) => (h.match(/style="[^"]*"/g) || []);
// Every tag in the output is one of ours, with only class, style, src and alt, and no value can end its quote early.
const TAGS = new Set(['div', 'span', 'i', 'b', 'small', 'p', 'h1', 'section', 'img', 'br']);
const tagsOk = (h) => (h.replace(/^[\s\S]*?<body>/, '').match(/<[^>]*>/g) || []).every((tg) => { const m = /^<\/?([a-z0-9]+)((?:\s+(?:class|style|src|alt)="[^"<>]*")*)\s*\/?>$/.exec(tg); return !!m && TAGS.has(m[1]); });
const cleanStyle = (h) => styles(h).every((s) => /^style="(?:[a-z-]+:(?:#[0-9a-f]{6}|[0-9.]+(?:mm|pt)|[0-9.]+(?:mm|pt);color:#[0-9a-f]{6}|#[0-9a-f]{6};color:#[0-9a-f]{6}|[0-9.]+mm);?)+"$/.test(s) || /^style="(?:[a-z-]+:[#0-9a-z.;:-]+)+"$/.test(s));

/* ---------- P1 safe text, colours and images ---------- */
{
  eq([P.esc('<b>&"\'`'), P.esc(5), P.esc(null), P.esc({}), P.esc('plain')], ['&lt;b&gt;&amp;&quot;&#39;&#96;', '5', '', '', 'plain'], 'P1 the five markup characters and the back-tick become entities; non-text gives nothing');
  ok(noThrow(P.esc) && noThrow(P.safeColor) && noThrow(P.safeImg) && noThrow(P.ink), 'P1 esc, safeColor, safeImg and ink never throw');
  eq(['#AABBCC', ' #aabbcc ', '#abc', 'red', 'rgb(0,0,0)', '#12345g', '#1234567', 'url(x)', '#aabbcc;x', '', null, 5].map((c) => P.safeColor(c, 'D')), ['#aabbcc', '#aabbcc', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'], 'P1 a colour is #rrggbb and nothing else');
  eq([P.ink('#ffffff'), P.ink('#000000'), P.ink('#1b5e9b'), P.ink('#ffd700'), P.ink('nonsense')], ['#111111', '#ffffff', '#ffffff', '#111111', '#ffffff'], 'P1 text on a dark colour is white, on a light one dark');
  const GOOD = ['https://static.wixstatic.com/media/a~mv2.png', 'https://static.wixstatic.com/media/a~mv2.png/v1/fill/w_200,h_100,al_c/logo.png', 'https://www.vtra.run/logo.png', 'https://vtra.run/a.png', 'https://Static.WixStatic.com/x.png', ' https://vtra.run/a.png '];
  eq(GOOD.map((g) => !!P.safeImg(g)), GOOD.map(() => true), 'P1 an https address on the Wix media server or the club site is a safe image');
  const EVIL = ['http://static.wixstatic.com/a.png', 'https://evil.com/a.png', 'https://static.wixstatic.com.evil.com/a.png', 'https://evil.com/static.wixstatic.com/a.png', 'https://static.wixstatic.com@evil.com/a.png', 'https://user:pw@static.wixstatic.com/a.png', 'https://static.wixstatic.com:8443/a.png',
    'https://static.wixstatic.com/a.png"onerror="x', "https://static.wixstatic.com/a.png'onerror='x", 'https://static.wixstatic.com/a b.png', 'https://static.wixstatic.com/a<b>.png', 'https://static.wixstatic.com/a\\b.png', 'https://static.wixstatic.com/a\n.png',
    'https://static.wixstatic.com/a‮.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//static.wixstatic.com/a.png', 'ftp://static.wixstatic.com/a.png', 'https://static.wixstatic.com/' + 'a'.repeat(300), 'https://127.0.0.1/a.png', 'https://localhost/a.png', 'https://xn--static-wixstatic.com/a.png', '', '   ', null, 5, {}, ['https://vtra.run/a.png']];
  eq(EVIL.map((g) => P.safeImg(g)), EVIL.map(() => ''), 'P1 every other address (http, another host, a look-alike host, a user name, a port, a quote, a space, a bracket, a line break, a script or data address, a list) is refused');
}

/* ---------- P2 text with placeholders ---------- */
{
  eq([P.fill('Hi {name} of {race}', { name: 'Asha', race: 'VHM' }), P.fill('{NAME}', { name: 'x' }), P.fill('{nope}', { name: 'x' }), P.fill('{name', { name: 'x' }), P.fill('{ name }', { name: 'x' }), P.fill('{a-b}', {}), P.fill(5, {}), P.fill(null, {})], ['Hi Asha of VHM', 'x', '{nope}', '{name', '{ name }', '{a-b}', '5', ''], 'P2 {name} is filled (any case), a name that is not known stays as typed');
  eq([P.fill('{constructor}', {}), P.fill('{toString}', {}), P.fill('{__proto__}', {}), P.fill('{hasOwnProperty}', {})], ['{constructor}', '{toString}', '{__proto__}', '{hasOwnProperty}'], 'P2 the names every object has are never filled in');
  eq(P.fill('{a}', { a: '{b}', b: 'SECOND' }), '{b}', 'P2 a value that holds {b} is not filled again');
  eq(P.html('Hi {name}\n{race}', { name: '<b>', race: 'A&B' }), 'Hi &lt;b&gt;<br>A&amp;B', 'P2 text for a page: values and the typed text are escaped, line breaks kept');
  eq(P.html('<script>alert(1)</script>{name}', { name: '"><img src=x onerror=1>' }), '&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=1&gt;', 'P2 markup typed in a design or in a name is only ever text');
  eq(P.cleanLines('a\r\nb\r\n\r\n\r\n\r\nc  d\u0000e‮f\ng\nh\ni\nj', 400), 'a\nb\n\nc d ef\ng\nh', 'P2 several lines: line breaks kept, runs of blank lines and spaces cut, control and direction characters dropped, six lines at most');
  eq([P.cleanLines('x'.repeat(500), 400).length, P.cleanLines(null, 10), P.cleanLines({}, 10)], [400, '', ''], 'P2 several lines are cut to the length and non-text gives nothing');
  ok(noThrow((h) => P.fill(h, h)) && noThrow((h) => P.html(h, h)) && noThrow((h) => P.cleanLines(h, 10)), 'P2 fill, html and cleanLines never throw');
}

/* ---------- P3 small things: ordinals, dates, pace, pages ---------- */
{
  eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 113, 120, 1000].map(P.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th', '113th', '120th', '1000th'], 'P3 places read as 1st, 2nd, 3rd, 4th, 11th, 21st, 101st, 111th');
  eq([0, -1, 1.5, NaN, '3', null, undefined, {}].map(P.ordinal), ['', '', '', '', '', '', '', ''], 'P3 a place that is not a whole number from 1 gives nothing');
  eq([P.longDate('2027-02-07'), P.longDate('2027-12-25'), P.longDate('2027-13-01'), P.longDate('2027-00-10'), P.longDate('2027-02-32'), P.longDate('07/02/2027'), P.longDate(''), P.longDate(null), P.longDate('2027-02-07T05:30:00Z')], ['7 February 2027', '25 December 2027', '', '', '', '', '', '', '7 February 2027'], 'P3 a date reads "7 February 2027"');
  eq([P.paceText(345000, 10), P.paceText(633000, 21.0975), P.paceText(0, 10), P.paceText(345000, 0), P.paceText(345000, null), P.paceText(-1, 5)], ['5:45 /km', '5:00 /km', '', '', '', ''], 'P3 pace is minutes and seconds a kilometre, cut not rounded');
  const list = Array.from({ length: 130 }, (x, i) => i);
  const a = P.pageOf(list, 0, 60);
  const b = P.pageOf(list, 60, 60);
  const c = P.pageOf(list, 120, 60);
  eq([a.items.length, a.next, a.total, b.items.length, b.next, c.items.length, c.next], [60, 60, 130, 60, 120, 10, null], 'P3 a long list is cut into pages; the last page has no next');
  eq([P.pageOf(list, -1, 5).items[0], P.pageOf(list, 'x', 5).items[0], P.pageOf(list, 1.5, 5).items[0], P.pageOf(list, 500, 5).items.length, P.pageOf([], 0, 5).next], [0, 0, 0, 0, null], 'P3 a start that is not a whole number from 0 begins at the top; one past the end gives nothing');
}

/* ---------- P4 the design of a bib ---------- */
{
  const d = P.cleanBibTpl({}, CATS);
  eq(d, P.BIB_DEFAULT, 'P4 no design is the default design');
  eq(P.cleanBibTpl(undefined, CATS), P.BIB_DEFAULT, 'P4 an unset design is the default too');
  const t = P.cleanBibTpl({ wmm: '200', hmm: 150, page: 'A3', orient: 'landscape', accent: '#C0392B', title: ' VHM ', subtitle: 'Sun', nameMode: 'name', showCat: false, catColors: { '10 k': '#00FF00', '5 K': '#ff0000', '21 K': '#0000ff' }, sponsors: 'Acme\nBeta\nhttps://static.wixstatic.com/media/a.png', tearoff: true, holes: false, footer: 'Run safe', evil: 'x', __proto__x: 1 }, CATS);
  eq([t.wmm, t.hmm, t.page, t.orient, t.accent, t.title, t.nameMode, t.showCat, t.tearoff, t.holes, t.footer, 'evil' in t], [200, 150, 'A3', 'landscape', '#c0392b', 'VHM', 'name', false, true, false, 'Run safe', false], 'P4 a design is read field by field: numbers from text, colours lower-cased, unknown fields dropped');
  eq(t.catColors, { '10 K': '#00ff00', '21 K': '#0000ff' }, 'P4 a colour is kept only for a category of the race (the right spelling is used)');
  eq(t.sponsors, ['Acme', 'Beta', 'https://static.wixstatic.com/media/a.png'], 'P4 sponsors: one a line, names and safe images');
  const BAD = [{ wmm: 79 }, { wmm: 301 }, { wmm: 1.5 }, { wmm: 'wide' }, { wmm: null }, { hmm: 59 }, { hmm: 211 }, { page: 'Letter' }, { orient: 'diagonal' }, { accent: 'red' }, { accent: '#fff' }, { title: 5 }, { subtitle: {} }, { nameMode: 'all' }, { showCat: 'yes' }, { showCat: 1 }, { tearoff: 'no' }, { holes: null }, { footer: [] }, { catColors: 'x' }, { catColors: [] }, { catColors: { '10 K': 'blue' } }, { sponsors: 5 }, { sponsors: [5] }, { sponsors: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 'x', 5, [], true];
  eq(BAD.map((x) => throws(() => P.cleanBibTpl(x, CATS))), BAD.map(() => 'bad_template'), 'P4 a design with a wrong size, page, colour, switch, text, colour list or sponsor list is refused');
  eq(['http://evil.com/a.png', 'https://evil.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA', '//evil.com/a.png', 'https://static.wixstatic.com/a"b.png'].map((s) => throws(() => P.cleanBibTpl({ sponsors: [s] }, CATS))), ['bad_image', 'bad_image', 'bad_image', 'bad_image', 'bad_image', 'bad_image'], 'P4 a sponsor that looks like an address but is not a safe image is refused, never printed as text');
  eq(P.cleanBibTpl({ sponsors: ['Sponsor:Acme', 'Title sponsor: Beta http'] }, CATS).sponsors, ['Sponsor:Acme', 'Title sponsor: Beta http'], 'P4 an ordinary name with a colon is a name');
  eq(P.cleanBibTpl({ sponsors: ['', '  ', 'A'] }, CATS).sponsors, ['A'], 'P4 empty sponsor lines are dropped');
  eq(P.cleanBibTpl({ title: 'x'.repeat(200) }, CATS).title.length, 80, 'P4 texts are cut to their length');
  eq(P.cleanBibTpl({ title: 'a\u0000b‮c' }, CATS).title, 'a bc', 'P4 control and direction characters are taken out of texts');
  eq(Object.keys(P.cleanBibTpl({ catColors: JSON.parse('{"__proto__":"#ffffff"}') }, [])).includes('__proto__'), false, 'P4 a "__proto__" key does not become a field');
  ok(Object.getPrototypeOf(P.cleanBibTpl({ catColors: JSON.parse('{"__proto__":"#ffffff","constructor":"#000000"}') }, ['x']).catColors) === Object.prototype, 'P4 and does not touch the prototype of the colour list');
  eq(P.cleanBibTpl({ catColors: { Marathon: '#112233' } }, []).catColors, { Marathon: '#112233' }, 'P4 with no list of categories a colour is kept as typed');
  eq(P.bibTplOf({ wmm: 5 }, CATS), P.BIB_DEFAULT, 'P4 a saved design that is damaged is read as the default');
  eq(P.bibTplOf('{"wmm":210}', CATS, (s) => JSON.parse(s)).wmm, 210, 'P4 a saved design can be read from stored text');
  eq(P.bibTplOf('{broken', CATS, (s) => { try { return JSON.parse(s); } catch (e) { return {}; } }), P.BIB_DEFAULT, 'P4 stored text that cannot be read is the default');
  ok(noThrow((h) => P.bibTplOf(h, CATS)), 'P4 reading a saved design never throws');
  eq([P.catColor(t, '10 k', CATS), P.catColor(t, '21 K', CATS), P.catColor(d, '10 K', CATS), P.catColor(d, '21 K', CATS), P.catColor(d, 'Unknown', CATS), P.catColor(d, '', [])], ['#00ff00', '#0000ff', '#c0392b', '#d35400', '#c0392b', '#c0392b'], 'P4 a category has the colour chosen, else one from the palette by its place in the list');
  ok(P.PLACEHOLDERS.bib.length === 7 && P.PLACEHOLDERS.cert.length === 13, 'P4 the placeholders each design may use are listed (7 on a bib, 13 on a certificate)');
}

/* ---------- P5 the design of a certificate ---------- */
{
  const d = P.cleanCertTpl({});
  eq(d, P.CERT_DEFAULT, 'P5 no design is the default design');
  const t = P.cleanCertTpl({ orient: 'portrait', border: 'simple', accent: '#112233', bg: '#FFFFEE', logo: 'https://static.wixstatic.com/media/l.png', title: 'Well run', intro: 'Presented to', body: 'Line 1\nLine 2 {name}', stats: false, sign1Name: 'Yogi', sign1Role: 'Race Director', sign2Name: 'Dr X', sign2Role: 'Timing', sponsors: 'A\nB', footer: 'VTRA, Reg. 429 of 2021', extra: 1 });
  eq([t.orient, t.border, t.accent, t.bg, t.logo, t.title, t.intro, t.body, t.stats, t.sign1Name, t.sign2Role, t.sponsors, t.footer, 'extra' in t], ['portrait', 'simple', '#112233', '#ffffee', 'https://static.wixstatic.com/media/l.png', 'Well run', 'Presented to', 'Line 1\nLine 2 {name}', false, 'Yogi', 'Timing', ['A', 'B'], 'VTRA, Reg. 429 of 2021', false], 'P5 a certificate design is read field by field; the body keeps its lines');
  const BAD = [{ orient: 'square' }, { border: 'gold' }, { accent: 'blue' }, { bg: 'url(x)' }, { title: 5 }, { intro: [] }, { body: 5 }, { stats: 'yes' }, { sign1Name: {} }, { sponsors: 7 }, { sponsors: Array(7).fill('x') }, { logo: 5 }, 'x', null === 1, []];
  eq(BAD.map((x) => throws(() => P.cleanCertTpl(x))), BAD.map(() => 'bad_template'), 'P5 a certificate design with a wrong value is refused');
  eq(['http://static.wixstatic.com/a.png', 'https://evil.com/a.png', 'javascript:alert(1)', 'https://static.wixstatic.com/a"b.png', 'data:x', 'logo.png', '//vtra.run/a.png'].map((s) => throws(() => P.cleanCertTpl({ logo: s }))), ['bad_image', 'bad_image', 'bad_image', 'bad_image', 'bad_image', 'bad_image', 'bad_image'], 'P5 a logo that is not a safe image is refused so that the director learns it');
  eq(P.cleanCertTpl({ logo: '   ' }).logo, '', 'P5 an empty logo box means no logo');
  eq(P.cleanCertTpl({ body: 'x'.repeat(900) }).body.length, 400, 'P5 the body is cut to 400 characters');
  eq(P.cleanCertTpl({ body: '1\n2\n3\n4\n5\n6\n7\n8' }).body, '1\n2\n3\n4\n5\n6', 'P5 and to six lines');
  eq(P.certTplOf({ orient: 'x' }), P.CERT_DEFAULT, 'P5 a saved certificate design that is damaged is read as the default');
  ok(noThrow((h) => P.certTplOf(h)), 'P5 reading a saved certificate design never throws');
}

/* ---------- P6 bibs on paper ---------- */
{
  const T0 = P.cleanBibTpl({}, CATS);
  const item = { bib: '123', name: 'Asha Rao', bibName: 'ASHA', cat: '10 K' };
  const one = P.renderBib(T0, item, RACE, CATS);
  ok(one.includes('>123<') && one.includes('ASHA') && !one.includes('Asha Rao') && one.includes('Vizag Half Marathon') && one.includes('7 February 2027 · Beach Road') && one.includes('10 K'), 'P6 a bib shows the number, the bib name (not the name), the race, the date and venue, and the category');
  eq([P.renderBib(P.cleanBibTpl({ nameMode: 'name' }, CATS), item, RACE, CATS).includes('ASHA'), P.renderBib(P.cleanBibTpl({ nameMode: 'name' }, CATS), item, RACE, CATS).includes('Asha Rao'), P.renderBib(P.cleanBibTpl({ nameMode: 'none' }, CATS), item, RACE, CATS).includes('class="nm"'), P.renderBib(P.cleanBibTpl({ nameMode: 'bibname' }, CATS), { bib: '5', name: 'Only Name', bibName: '', cat: '' }, RACE, CATS).includes('Only Name'), P.renderBib(P.cleanBibTpl({ nameMode: 'either' }, CATS), { bib: '5', name: 'Only Name', bibName: '', cat: '' }, RACE, CATS).includes('Only Name')], [false, true, false, false, true], 'P6 the name line follows the choice: bib name, name, none, bib name only (blank when there is none), or either');
  ok(!P.renderBib(P.cleanBibTpl({ showCat: false }, CATS), item, RACE, CATS).includes('class="cat"') && !P.renderBib(T0, { bib: '9', name: '', bibName: '', cat: '' }, RACE, CATS).includes('class="cat"'), 'P6 no category strip when it is switched off or the bib has no category (a spare)');
  const col = P.renderBib(P.cleanBibTpl({ catColors: { '10 K': '#ffee00' } }, CATS), item, RACE, CATS);
  ok(col.includes('background:#ffee00;color:#111111'), 'P6 the category strip has the chosen colour and a text colour that can be read on it');
  const ln = (s) => parseFloat((/class="n" style="font-size:([0-9.]+)mm/.exec(P.renderBib(T0, { bib: s, name: '', bibName: '', cat: '' }, RACE, CATS)) || [0, 0])[1]);
  ok(ln('1') >= ln('1234') && ln('1234') > ln('1234567') && ln('1234567') > ln('123456789012') && ln('123456789012') >= 8, 'P6 the more digits, the smaller the number, never below 8 mm (' + [ln('1'), ln('1234'), ln('1234567'), ln('123456789012')].join(', ') + ')');
  const small = P.cleanBibTpl({ wmm: 80, hmm: 60 }, CATS);
  ok(parseFloat((/class="n" style="font-size:([0-9.]+)mm/.exec(P.renderBib(small, { bib: '12345', name: '', bibName: '', cat: '' }, RACE, CATS)) || [0, 0])[1]) < 60 * 0.72, 'P6 on a small bib the number fits the bib');
  ok(P.renderBib(P.cleanBibTpl({ tearoff: true }, CATS), item, RACE, CATS).includes('class="tr"') && !one.includes('class="tr"'), 'P6 the tear-off strip is there only when asked for');
  ok((P.renderBib(T0, item, RACE, CATS).match(/class="h h[1-4]"/g) || []).length === 4 && !P.renderBib(P.cleanBibTpl({ holes: false }, CATS), item, RACE, CATS).includes('class="h '), 'P6 four hole marks, or none');
  const sp = P.renderBib(P.cleanBibTpl({ sponsors: ['Acme <b>', 'https://static.wixstatic.com/media/s.png'] }, CATS), item, RACE, CATS);
  ok(sp.includes('<span>Acme &lt;b&gt;</span>') && sp.includes('<img src="https://static.wixstatic.com/media/s.png"'), 'P6 sponsors: a name as text, a safe image as a picture');
  const hostile = P.renderBib(P.cleanBibTpl({ title: '<script>alert(1)</script>{name}', footer: '"><svg onload=x>' }, CATS), { bib: '<img src=x onerror=1>', name: '<b>Eve</b>', bibName: '<script>x</script>', cat: '"><i>' }, { name: '<h1>R</h1>', date: '2027-02-07', venue: "'><u>" }, CATS);
  ok(tagsOk(hostile) && !/<(script|svg|h1|u>)/i.test(hostile) && hostile.includes('&lt;script&gt;'), 'P6 markup in a title, a name, a bib, a category, a race name or a venue is shown as text and never becomes markup');
  const R = P.renderBibs(T0, [item, { bib: '124', name: 'Bina', bibName: '', cat: '21 K' }], RACE, CATS);
  ok(R.head.startsWith('<!DOCTYPE html>') && R.head.includes('<title>Bibs Vizag Half Marathon</title>') && R.head.includes('@page{size:210mm 297mm;margin:8mm}') && R.head.includes('print-color-adjust:exact') && R.body.startsWith('<div class="sheet">') && (R.body.match(/class="bib"/g) || []).length === 2 && P.DOC_FOOT === '</body></html>', 'P6 a set of bibs: a page start with its print style (A4, background colours kept) and one box per bib');
  ok(P.renderBibs(P.cleanBibTpl({ page: 'A3', orient: 'landscape', wmm: 200, hmm: 150 }, CATS), [], RACE, CATS).head.includes('size:420mm 297mm') && P.renderBibs(P.cleanBibTpl({ wmm: 200, hmm: 150 }, CATS), [], RACE, CATS).head.includes('width:200mm;height:150mm'), 'P6 the page size and the bib size follow the design');
  ok(cleanStyle(hostile) && cleanStyle(R.head + R.body), 'P6 every style a bib carries holds only numbers and colours, never typed text');
  ok(!P.renderBibs(P.cleanBibTpl({ title: '</style><script>x</script>' }, CATS), [item], { name: '</title><script>1</script>', date: '', venue: '' }, CATS).head.includes('<script'), 'P6 the page title cannot be broken out of');
  const sparesOk = P.spareBibs(2001, 2005, new Set(['2003']));
  eq([sparesOk.items.map((x) => x.bib), sparesOk.skipped, sparesOk.items[0].name, sparesOk.items[0].cat], [['2001', '2002', '2004', '2005'], 1, '', ''], 'P6 spare bibs: numbers with no name, leaving out those a runner already has');
  eq([[0, 5], [5, 4], [1, 501], [1, 500], [1.5, 3], ['1', '5'], [1, 100000000], [null, 3]].map((a) => throws(() => P.spareBibs(a[0], a[1], new Set()))), ['bad_spares', 'bad_spares', 'bad_spares', '', 'bad_spares', 'bad_spares', 'bad_spares', 'bad_spares'], 'P6 spare bibs: from 1, to not below from, at most 500, whole numbers');
}

/* ---------- P7 certificates on paper ---------- */
{
  const T0 = P.cleanCertTpl({});
  const row = { name: 'Asha Rao', bib: '123', cat: '10 K', t: 345000, place: 3, gplace: 1, aplace: 1, gender: 'F', ageGroup: '30-39', status: 'fin' };
  const v = P.certVars(row, RACE, CATLEN);
  eq([v.name, v.time, v.place, v.gender, v.gplace, v.agegroup, v.aplace, v.pace, v.date, v.race, v.venue], ['Asha Rao', '0:57:30', '3rd', 'Women', '1st', '30-39', '1st', '5:45 /km', '7 February 2027', 'Vizag Half Marathon', 'Beach Road'], 'P7 what a certificate can say about a runner');
  const v2 = P.certVars({ name: 'No Gender', bib: '9', cat: 'Odd', t: 600000, place: 12 }, RACE, CATLEN);
  eq([v2.gender, v2.gplace, v2.agegroup, v2.aplace, v2.pace, v2.place], ['', '', '', '', '', '12th'], 'P7 what is not known is empty (no gender, no age group, no distance for the pace)');
  const h = P.renderCert(T0, v);
  ok(h.includes('Certificate of Achievement') && h.includes('This is to certify that') && h.includes('Asha Rao') && h.includes('finishing 3rd overall in a time of 0:57:30') && h.includes('<small>Time</small><b>0:57:30</b>') && h.includes('<small>Women 30-39</small><b>1st</b>') && h.includes('class="fr2"'), 'P7 a certificate: title, intro, name, the sentence, the figures, a double border');
  const h2 = P.renderCert(T0, v2);
  ok(h2.includes('<small>Overall</small><b>12th</b>') && !h2.includes('Women') && !h2.includes('Pace') && !h2.includes('<small></small>'), 'P7 a figure that is not known is left out, not shown empty');
  ok(!P.renderCert(P.cleanCertTpl({ stats: false }), v).includes('class="st"'), 'P7 the figures can be switched off');
  eq(['none', 'simple', 'double'].map((b) => [P.renderCert(P.cleanCertTpl({ border: b }), v).includes('class="fr"'), P.renderCert(P.cleanCertTpl({ border: b }), v).includes('class="fr2"')]), [[false, false], [true, false], [true, true]], 'P7 the border: none, one line, two lines');
  const withLogo = P.renderCert(P.cleanCertTpl({ logo: 'https://static.wixstatic.com/media/l.png', sponsors: ['Acme', 'https://vtra.run/s.png'], sign1Name: 'Yogi', sign1Role: 'Race Director', footer: 'Reg. 429' }), v);
  ok(withLogo.includes('<img class="lg" src="https://static.wixstatic.com/media/l.png"') && withLogo.includes('<span>Acme</span>') && withLogo.includes('<img src="https://vtra.run/s.png"') && withLogo.includes('<div>Yogi<small>Race Director</small></div>') && withLogo.includes('Reg. 429') && !withLogo.includes('class="sg"><div></div>'), 'P7 logo, sponsors, a signature and a footer line');
  ok(!P.renderCert(T0, v).includes('class="sg"') && !P.renderCert(T0, v).includes('class="sp"') && !P.renderCert(T0, v).includes('class="lg"'), 'P7 nothing is drawn for a signature, a sponsor or a logo that was not given');
  const long = P.renderCert(T0, Object.assign({}, v, { name: 'A very long name that goes on and on for a while' }));
  const mid = P.renderCert(T0, Object.assign({}, v, { name: 'A fairly long name indeed ok' }));
  ok(/class="nm" style="font-size:22pt"/.test(long) && /class="nm" style="font-size:28pt"/.test(mid) && /class="nm" style="font-size:36pt"/.test(h), 'P7 a long name is set smaller so that it fits (36, 28 and 22 pt on a landscape page)');
  ok(P.renderCerts(P.cleanCertTpl({ orient: 'portrait' }), [v], RACE).head.includes('size:210mm 297mm') && P.renderCerts(T0, [v], RACE).head.includes('size:297mm 210mm') && P.renderCerts(T0, [v], RACE).head.includes('.cert + .cert{break-before:page'), 'P7 the page is A4, landscape or portrait, and each certificate starts a new page');
  const hostile = P.renderCert(P.cleanCertTpl({ title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)> {name}', footer: '"><svg onload=1>', sign1Name: '<b>x</b>', sponsors: ['<i>S</i>'] }), Object.assign({}, v, { name: '<script>x</script>', race: '<b>r</b>' }));
  ok(tagsOk(hostile) && !/<(script|svg)/i.test(hostile) && hostile.includes('&lt;script&gt;'), 'P7 markup in the design or in a name is shown as text and never becomes markup');
  const R = P.renderCerts(T0, [v, v2], RACE);
  ok((R.body.match(/<section class="cert">/g) || []).length === 2 && cleanStyle(R.body + R.head), 'P7 a set of certificates: one section each, styles hold only numbers and colours');
  ok(noThrow((h3) => P.renderCert(T0, h3)) && noThrow((h3) => P.certVars(h3, h3, h3)) && noThrow((h3) => P.renderBib(P.cleanBibTpl({}, CATS), h3, h3, h3)), 'P7 drawing a paper from damaged data never throws');
}

/* ---------- P8 the switches of the runner page ---------- */
{
  eq(P.cleanFlags({}), { startList: false, results: false, certs: false, note: '' }, 'P8 every switch is off until it is turned on');
  eq(P.cleanFlags({ startList: true, results: true, certs: true, note: ' Provisional ' }), { startList: true, results: true, certs: true, note: 'Provisional' }, 'P8 the three switches and a note');
  const BAD = [{ startList: 'yes' }, { startList: 1 }, { results: null }, { certs: 'true' }, { note: 5 }, { note: {} }, 'x', null, [], 5];
  eq(BAD.map((x) => throws(() => P.cleanFlags(x))), BAD.map(() => 'bad_flags'), 'P8 a switch must be true or false, nothing else');
  eq(throws(() => P.cleanFlags({ certs: true, results: false })), 'certs_need_results', 'P8 certificates cannot be shown unless results are shown');
  eq(P.cleanFlags({ note: 'x'.repeat(500) }).note.length, 200, 'P8 the note is cut to 200 characters');
  eq(P.flagsOf({ startList: 'yes' }), { startList: false, results: false, certs: false, note: '' }, 'P8 damaged switches read as all off');
  eq(P.flagsOf(null), { startList: false, results: false, certs: false, note: '' }, 'P8 missing switches read as all off');
  eq(P.flagsOf('{"results":true,"certs":true}', JSON.parse), { startList: false, results: true, certs: true, note: '' }, 'P8 switches can be read from stored text');
  eq([P.anyOn({ startList: true }), P.anyOn({ results: true }), P.anyOn({ certs: true }), P.anyOn({}), P.anyOn(null)], [true, true, false, false, false], 'P8 a race is public when the start list or the results are shown (certificates alone are not enough)');
  ok(noThrow((h) => P.flagsOf(h)) && HOSTILE.every((h) => { const m = throws(() => P.cleanFlags(h)); return m === '' || m === 'bad_flags'; }), 'P8 reading switches never throws; checking them refuses only with bad_flags');
}

/* ---------- P9 what the public page may be told ---------- */
{
  const REGS = [
    { id: 'r1', bib: '101', name: 'Asha Rao', cat: '10 K', paid: true },
    { id: 'r2', bib: '102', name: 'Bina Rao', cat: '10 K', paid: true },
    { id: 'r3', bib: '103', name: 'Unpaid Uma', cat: '10 K', paid: false },
    { id: 'r4', bib: '', name: 'No Bib Nina', cat: '10 K', paid: true },
    { id: 'r5', bib: '201', name: 'Chitra Devi', cat: '21 K', paid: true },
    { id: 'r6', bib: '0105', name: 'Dev Raman', cat: '10 K', paid: true },
    { id: 'r7', bib: '106', name: '<img src=x onerror=1>Eve', cat: '10 K', paid: true },
  ];
  const ASSIGN = new Map([['r1', { wave: 'w1', corral: 'A' }], ['r2', { wave: 'w1', corral: 'B' }], ['r5', { wave: 'wX', corral: '' }]]);
  const WAVES = [{ id: 'w1', name: 'Wave 1', start: '06:00' }];
  const ROWS = [
    { bib: '101', name: 'Asha Rao', cat: '10 K', gender: 'F', ageGroup: '30-39', status: 'fin', t: 345000, place: 2, gplace: 1, aplace: 1, age: 36, dob: '1990-01-01', email: 'a@example.com', phone: '9812300101', note: 'secret note' },
    { bib: '102', name: 'Bina Rao', cat: '10 K', gender: 'F', ageGroup: '30-39', status: 'dnf', t: 0, place: null, gplace: null, aplace: null },
    { bib: '777', name: 'Walk In Wally', cat: '10 K', gender: 'M', ageGroup: '40-49', status: 'fin', t: 300000, place: 1, gplace: 1, aplace: 1 },
    { bib: '105', name: 'Dev Raman', cat: '10 K', gender: 'M', ageGroup: '18-29', status: 'dsq', t: 0 },
  ];
  const idx = P.publicIndex(REGS, ASSIGN, WAVES, ROWS);
  const ALL = { startList: true, results: true, certs: true, note: '' };
  const find = (q, f, n) => P.searchPublic(idx, q, f || ALL, n);
  const bibs = (r) => r.items.map((x) => x.bib);
  eq([...idx.byBib.keys()].sort(), ['0105', '101', '102', '106', '201', '777'], 'P9 the index holds each paid runner with a bib, and each result (a result for 105 joins the runner registered as 0105)');
  ok(!idx.byBib.has('103') && !idx.byBib.has(''), 'P9 an unpaid runner and a runner with no bib are not listed');
  eq(bibs(find('101')), ['101'], 'P9 a bib number finds that runner');
  const v = find('101').items[0];
  eq(Object.keys(v).sort(), ['bib', 'cat', 'cert', 'name', 'result', 'start'], 'P9 what is told about a runner: bib, name, category, start, result and whether there is a certificate, nothing else');
  eq([v.start, v.result, v.cert], [{ wave: 'Wave 1', start: '06:00', corral: 'A' }, { status: 'fin', time: '0:57:30', place: 2, gender: 'Women', ageGroup: '30-39', gplace: 1, aplace: 1 }, true], 'P9 the start, the result and the certificate of a finisher');
  const text = JSON.stringify(find('Rao').items);
  ok(!/dob|email|phone|1990|example|98123|secret|age"/i.test(text) && !text.includes('"note"'), 'P9 no date of birth, age, e-mail, phone number or note is ever in an answer, even when the rows carry them');
  eq([find('102').items[0].result, find('102').items[0].cert], [{ status: 'dnf' }, false], 'P9 a DNF shows the status only, and has no certificate');
  eq([find('105').items[0].name, find('105').items[0].result], ['Dev Raman', { status: 'dsq' }], 'P9 a bib typed without its leading zeros finds the bib that has them');
  eq([find('0101').items.length, find('00101').items.length], [1, 1], 'P9 and a bib typed with extra zeros finds the plain one');
  eq(find('201').items[0].start, null, 'P9 a runner placed in a wave that no longer exists has no start');
  eq(find('777').items[0].start, null, 'P9 a walk-in with a result has no start');
  eq([find('201').items[0].result, find('201').items[0].cert], [null, false], 'P9 a runner with no result yet has none');
  eq(bibs(find('rao')), ['101', '102'], 'P9 a name (three letters at least, any case) finds every runner whose name holds it');
  eq(bibs(find('RAO')), ['101', '102'], 'P9 in any case');
  eq(bibs(find('sha ra')), ['101'], 'P9 spaces and punctuation do not matter');
  eq([find('ra').tooShort, find('ra').items.length, find('').tooShort, find('  ').tooShort, find('a b').tooShort], [true, 0, true, true, true], 'P9 fewer than three letters is not a search');
  eq(bibs(find('wally')), ['777'], 'P9 a walk-in is found by name too');
  eq([find('Unpaid').items.length, find('Nina').items.length, find('103').items.length], [0, 0, 0], 'P9 an unpaid runner and one with no bib cannot be found');
  const many = Array.from({ length: 25 }, (x, i) => ({ id: 'm' + i, bib: String(500 + i), name: 'Same Name ' + i, cat: '10 K', paid: true }));
  const idx2 = P.publicIndex(many, new Map(), [], []);
  const f2 = P.searchPublic(idx2, 'same name', ALL);
  eq([f2.items.length, f2.more], [10, true], 'P9 at most ten runners are listed for a name, and the page is told there are more');
  eq(P.searchPublic(idx2, 'same name', ALL, 3).items.length, 3, 'P9 the number listed can be set');
  ok(P.searchPublic(idx2, 'same name 1', ALL).items.length === 10 && P.searchPublic(idx2, 'same name 24', ALL).items.length === 1, 'P9 a longer name narrows the list');
  // the switches
  const noStart = { startList: false, results: true, certs: true };
  const noRes = { startList: true, results: false, certs: false };
  eq([find('101', noStart).items[0].start, find('101', noStart).items[0].result.status, find('101', noStart).items[0].cert], [null, 'fin', true], 'P9 with the start list off, the start is not told');
  eq([find('101', noRes).items[0].start.wave, find('101', noRes).items[0].result, find('101', noRes).items[0].cert], ['Wave 1', null, false], 'P9 with results off, no result and no certificate is told');
  eq([find('101', { startList: true, results: true, certs: false }).items[0].cert, find('101', { startList: false, results: false, certs: true }).items.length], [false, 0], 'P9 a certificate needs the certificate switch, and certificates alone show nothing');
  eq([find('201', { startList: false, results: true, certs: false }).items.length, find('777', { startList: true, results: false, certs: false }).items.length, find('rao', { startList: false, results: false, certs: false }).items.length], [0, 0, 0], 'P9 a runner with nothing that may be shown is not found: start list off and no result; walk-in with results off; everything off');
  eq(bibs(find('wally', noRes)), [], 'P9 a walk-in appears only through results');
  // hostile names are passed on as plain text (the page escapes them) and never change what is told
  eq(find('eve').items[0].name, '<img src=x onerror=1>Eve', 'P9 a name is passed on as typed; the page puts it in with esc()');
  ok(noThrow((h) => P.searchPublic(idx, h, ALL)) && noThrow((h) => P.publicIndex(h, h, h, h)) && noThrow((h) => P.searchPublic(P.publicIndex([h], h, [h], [h]), 'abc', ALL)), 'P9 hostile questions and damaged data never throw');
  eq(P.searchPublic(P.publicIndex(null, null, null, null), 'asha', ALL), { items: [], more: false, tooShort: false }, 'P9 with nothing behind it a search finds nothing');
  eq([P.CHUNK_BIBS, P.CHUNK_CERTS, P.MAX_FOUND], [60, 25, 10], 'P9 sizes: 60 bibs and 25 certificates a call, 10 runners an answer');
}

done();
