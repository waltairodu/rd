#!/usr/bin/env python3
"""Applies the RaceOS "Action Blue" theme to every embed page: tokens, fonts and the shared component styles.
Run once on a page that does not have the marker yet; it is safe to run again (pages with the marker are skipped)."""
import re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['wix/director/director-embed.html', 'wix/director/volunteer-embed.html', 'wix/training/athlete-embed.html',
         'wix/training/coach-embed.html', 'wix/expo/exposoft-embed.html']
MARK = '/*raceos-theme*/'
FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">'
LIGHT = ('--bg:#f3f6fb;--surface:#ffffff;--surface-2:#f1f5fb;--line:#e2e8f2;--ink:#0f1b33;--ink-2:#5b6b85;'
         '--primary:#1558e8;--on-primary:#ffffff;--navy:#0a1f4f;--navy-2:#12306f;'
         '--good:#12803d;--warn:#b45309;--bad:#c0261c;--good-bg:#ddf5e6;--warn-bg:#fef0d0;--bad-bg:#fde3e0;--info-bg:#e4edff;'
         "--f-display:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--f-body:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;")
DARK = ('--bg:#0a1226;--surface:#111c36;--surface-2:#16233f;--line:#243457;--ink:#e8eefb;--ink-2:#9fb0d0;'
        '--primary:#5b8dff;--on-primary:#06122b;--navy:#060d1f;--navy-2:#0e1c3d;'
        '--good:#4cc77a;--warn:#f0a640;--bad:#ff8a80;--good-bg:#12331f;--warn-bg:#3a2a0d;--bad-bg:#3d1a17;--info-bg:#172a52;')
EXTRA = MARK + '''
body{font-family:var(--f-body);-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--f-display);letter-spacing:-.01em}
h1{font-weight:700}h2{font-size:22px;font-weight:700}h3{font-size:16px;font-weight:700}
.eyebrow{font:600 11px/1 var(--f-display);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2)}
.card{border-radius:14px;border-color:var(--line);box-shadow:0 1px 2px rgba(15,27,51,.04),0 4px 14px rgba(15,27,51,.04)}
.btn{border-radius:9px;font-weight:600;border-color:var(--line)}
.btn.pri{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.btn.pri:hover:not(:disabled){filter:brightness(1.08)}
.btn.alt{background:var(--info-bg);border-color:transparent;color:var(--primary)}
.pill{background:var(--info-bg);color:var(--primary)}
.kpi .n{font:700 30px/1.05 var(--f-display);letter-spacing:-.02em}
.kpi .l{font:600 12px var(--f-display);letter-spacing:.06em;text-transform:none;color:var(--ink-2)}
.bar i{background:var(--primary)}
th{font:600 11px var(--f-display);letter-spacing:.07em;color:var(--ink-2)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--primary);outline-offset:0;border-color:var(--primary)}
.tab[aria-selected=true]{border-bottom-color:var(--primary)}
'''

def match_block(s, start):
    """index just after the closing brace of the block that opens at s[start] == '{' """
    depth = 0
    for i in range(start, len(s)):
        if s[i] == '{': depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0: return i + 1
    raise ValueError('unbalanced')

def replace_blocks(s):
    # first :root{...}
    i = s.index(':root{') if ':root{' in s else s.index(':root {')
    j = match_block(s, s.index('{', i))
    keep = ''
    old = s[i:j]
    ks = re.findall(r'--k\d:#[0-9a-f]{6}|--on-k:#[0-9a-f]{6}', old)
    s = s[:i] + ':root{' + LIGHT + ''.join(k + ';' for k in ks) + '}' + s[j:]
    # dark media block(s)
    m = re.search(r'@media \(prefers-color-scheme: dark\)\s*\{', s)
    if m:
        a = m.start(); b = match_block(s, s.index('{', a))
        s = s[:a] + '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + DARK + 'color-scheme:dark}}' + s[b:]
    m = re.search(r':root\[data-theme="dark"\]\s*\{', s)
    if m:
        a = m.start(); b = match_block(s, s.index('{', a))
        s = s[:a] + ':root[data-theme="dark"]{' + DARK + 'color-scheme:dark}' + s[b:]
    return s

def run(path):
    p = os.path.join(ROOT, path)
    s = open(p, encoding='utf8').read()
    if MARK in s:
        print('skip', path); return
    s = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/css2\?family=Barlow[^"]*">', FONT, s)
    s = replace_blocks(s)
    k = s.index('</style>')
    s = s[:k] + EXTRA + s[k:]
    open(p, 'w', encoding='utf8').write(s)
    print('themed', path)

if __name__ == '__main__':
    for pg in (sys.argv[1:] or PAGES): run(pg)
