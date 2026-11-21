#!/usr/bin/env python3
"""
Alchemy's branding, built into Chromium (StaticForge #993; replaces scripts/alchemy-brand-chromium.js for this build):

  - the product name: "Chromium" -> "Alchemy" in the message text of every .grd / .grdp under chrome/app, components
    and extensions/strings (chromium_strings.grd and the feature strings that name the browser; credits keep "The
    Chromium Authors", "the Chromium open source project" and "Chromium OS"), and PRODUCT_FULLNAME /
    PRODUCT_SHORTNAME in the BRANDING file (chrome://version, --version).
    Changed English text has new message ids, so other locales show these strings in English (Alchemy runs en-US).
  - the logos: every product_logo*.png / favicon_product.png under the chromium theme folders redrawn from
    brand/alchemy.png at its own size (the _mono ones from brand/alchemy-mono.png, the _white ones from it in white),
    and product_logo.svg / product_logo_animation.svg as the 256 px logo. The wordmarks (product_logo_name_22*)
    stay: they draw the word Chromium as artwork and nothing in Alchemy shows them.

Called by apply.py; needs Pillow on the build host. Idempotent: a file that already has its Alchemy content is skipped.
"""

import base64
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, 'brand', 'alchemy.png')
MONO_LOGO = os.path.join(HERE, 'brand', 'alchemy-mono.png')

# the string files are found by scanning these folders: Chromium names itself in chromium_strings.grd and friends, but
# also in plain feature strings (password manager, autofill, the security interstitials, ...)
STRING_DIRS = ['chrome/app', 'components', 'extensions/strings']
STRING_SKIP_DIRS = {'test', 'tests', 'test_data', 'testdata', 'android', 'ios', 'out'}

LOGO_DIRS = [
    'chrome/app/theme/chromium',
    'chrome/app/theme/chromium/linux',
    'chrome/app/theme/default_100_percent/chromium',
    'chrome/app/theme/default_100_percent/chromium/linux',
    'chrome/app/theme/default_200_percent/chromium',
    'chrome/app/theme/default_200_percent/chromium/linux',
    'components/resources/default_100_percent/chromium',
    'components/resources/default_200_percent/chromium',
]

SVG_LOGOS = [
    'chrome/app/theme/chromium/product_logo.svg',
    'chrome/app/theme/chromium/product_logo_animation.svg',
]

BRANDING = 'chrome/app/theme/chromium/BRANDING'
BRANDING_VALUES = {
    'PRODUCT_FULLNAME': 'Alchemy',
    'PRODUCT_SHORTNAME': 'Alchemy',
    'PRODUCT_INSTALLER_FULLNAME': 'Alchemy Installer',
    'PRODUCT_INSTALLER_SHORTNAME': 'Alchemy Installer',
}

# <ph ...>...</ph> placeholders stand in for \0 while the text is renamed, so "Chromium<ph END_LINK> open source"
# reads as "Chromium\0 open source"
PH = re.compile(r'<ph\b[^>]*>.*?</ph>|<ph\b[^>]*/>', re.S)
PRODUCT = re.compile(r'Chromium(?! Authors|\x00* open source| OS)')
MESSAGE = re.compile(r'(<message\b[^>]*>)(.*?)(</message>)', re.S)


def rename_text(body):
    holders = []

    def hold(m):
        holders.append(m.group(0))
        return '\x00'

    text = PRODUCT.sub('Alchemy', PH.sub(hold, body))
    it = iter(holders)
    return re.sub('\x00', lambda _m: next(it), text)


def string_files(src):
    for top in STRING_DIRS:
        for root, dirs, names in os.walk(os.path.join(src, top)):
            dirs[:] = sorted(d for d in dirs if d not in STRING_SKIP_DIRS)
            for name in sorted(names):
                if name.endswith(('.grd', '.grdp')):
                    yield os.path.relpath(os.path.join(root, name), src)


def brand_strings(src, check):
    failed = 0
    already = 0
    if not os.path.exists(os.path.join(src, 'chrome/app/chromium_strings.grd')):
        print('MISSING  chrome/app/chromium_strings.grd')
        return 1
    for rel in string_files(src):
        path = os.path.join(src, rel)
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
        if 'Chromium' not in text:
            continue
        count = [0]

        def message(m):
            body = rename_text(m.group(2))
            if body != m.group(2):
                count[0] += 1
            return m.group(1) + body + m.group(3)

        new = MESSAGE.sub(message, text)
        if not count[0]:
            already += 1
            continue
        print(('would    ' if check else 'patched  ') + rel + ' (' + str(count[0]) + ' messages)')
        if not check:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(new)
    print('already  ' + str(already) + ' string files with only credits left (The Chromium Authors, ...)')
    return failed


def brand_branding(src, check):
    path = os.path.join(src, BRANDING)
    with open(path, encoding='utf-8') as fh:
        lines = fh.read().split('\n')
    out = []
    for line in lines:
        key = line.split('=', 1)[0]
        out.append(key + '=' + BRANDING_VALUES[key] if key in BRANDING_VALUES else line)
    if out == lines:
        print('already  ' + BRANDING)
        return 0
    print(('would    ' if check else 'patched  ') + BRANDING)
    if not check:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(out))
    return 0


def render(source, size, white=False):
    from PIL import Image
    image = Image.open(source).convert('RGBA')
    if white:
        alpha = image.getchannel('A')
        image = Image.new('RGBA', image.size, (255, 255, 255, 255))
        image.putalpha(alpha)
    # resample premultiplied, or the transparent edge bleeds dark
    image = image.convert('RGBa').resize((size, size), Image.LANCZOS).convert('RGBA')
    buf = io.BytesIO()
    image.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def write_if_changed(path, data, rel, check):
    with open(path, 'rb') as fh:
        if fh.read() == data:
            print('already  ' + rel)
            return
    print(('would    ' if check else 'patched  ') + rel)
    if not check:
        with open(path, 'wb') as fh:
            fh.write(data)


def brand_logos(src, check):
    from PIL import Image
    done = 0
    for folder in LOGO_DIRS:
        base = os.path.join(src, folder)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            if not name.endswith('.png') or not (name.startswith('product_logo') or name == 'favicon_product.png'):
                continue
            if name.startswith('product_logo_name'):
                continue
            path = os.path.join(base, name)
            width, height = Image.open(path).size
            if width != height:
                continue
            white = '_white' in name
            mono = white or '_mono' in name
            write_if_changed(path, render(MONO_LOGO if mono else LOGO, width, white), folder + '/' + name, check)
            done += 1
    png = base64.b64encode(render(LOGO, 256)).decode('ascii')
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" '
           'height="256" viewBox="0 0 256 256"><image width="256" height="256" xlink:href="data:image/png;base64,'
           + png + '"/></svg>\n').encode('ascii')
    for rel in SVG_LOGOS:
        path = os.path.join(src, rel)
        if os.path.exists(path):
            write_if_changed(path, svg, rel, check)
            done += 1
    if not done:
        print('MISSING  logos (no product_logo*.png under the chromium theme folders)')
        return 1
    return 0


def apply(src, check):
    return brand_strings(src, check) + brand_branding(src, check) + brand_logos(src, check)
