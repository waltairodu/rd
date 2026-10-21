#!/usr/bin/env python3
"""Builds wix/director/rd-embed.html: the Race Director page with the Expo desk inside it (Expo desk tab).
Paste rd-embed.html into the /rd page's HTML element. Run again after changing director-embed.html or exposoft-embed.html."""
import json, os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
d = open(os.path.join(root, 'wix/director/director-embed.html'), encoding='utf-8').read()
x = open(os.path.join(root, 'wix/expo/exposoft-embed.html'), encoding='utf-8').read()
marker = "var EXPO_SRC=null;"
assert d.count(marker) == 1
lit = json.dumps(x, ensure_ascii=False).replace('</', '<\\/').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
out = d.replace(marker, "var EXPO_SRC=" + lit + ";")
open(os.path.join(root, 'wix/director/rd-embed.html'), 'w', encoding='utf-8').write(out)
print('rd-embed.html', len(out), 'bytes')
