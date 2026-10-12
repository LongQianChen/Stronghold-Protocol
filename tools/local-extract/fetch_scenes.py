#!/usr/bin/env python3
"""Download the 卫戍协议 battlefield scene bundles of an in-season version from the official asset CDN (optional).

The scene bundles (scenes.py) ship only while the season runs: an off-season client has none, and the current
hot-update list does not name them. The CDN still serves the versions that had them; this fetches the bundles of
scenes.SCENES (scene, lighting data, lighting settings) into .cache/official-scenes/<version>/<bundle path>, where
extract.py --only scene finds them. Every file is checked against the md5 of that version's hot-update list.

Usage:
  python3 tools/local-extract/fetch_scenes.py [--version 26-04-13-12-31-42_e9b560] [--platform Android] [--out <dir>]
  python3 tools/local-extract/fetch_scenes.py --list      (what would be downloaded; reads the hot-update list only)

VERSION is the last version of 盟约·下半 that carried all eleven scenes (the `Data:` version of the game-data commits
of that season). Needs no dependencies. Everything is (c) Hypergryph; for private, non-commercial fan use only.
"""
import argparse
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scenes  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
VERSION = '26-04-13-12-31-42_e9b560'
PLATFORM = 'Android'
CDN = 'https://ak.hycdn.cn/assetbundle/official/{platform}/assets/{version}/'


def dat_name(bundle):
    """File name of a bundle on the CDN: the path without its extension, '/' → '_', '#' → '__', as .dat (a zip)."""
    return bundle.rsplit('.', 1)[0].replace('/', '_').replace('#', '__') + '.dat'


def wanted(names, stage_ids):
    """The bundles of `names` (a hot-update list) that belong to the scenes of `stage_ids`, in list order."""
    dirs = tuple(scenes.scene_bundle(sid).rsplit('/', 1)[0] + '/' for sid in stage_ids)
    return [n for n in names if n.startswith(dirs)]


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--version', default=VERSION)
    ap.add_argument('--platform', default=PLATFORM)
    ap.add_argument('--out', help='output root (default .cache/official-scenes/<version>)')
    ap.add_argument('--list', action='store_true', help='print the bundles and sizes, download nothing')
    args = ap.parse_args()
    base = CDN.format(platform=args.platform, version=args.version)
    out = Path(args.out) if args.out else ROOT / '.cache' / 'official-scenes' / args.version
    try:
        infos = json.loads(get(base + 'hot_update_list.json'))['abInfos']
    except Exception as e:
        print(f'cannot read the hot-update list of {args.version} ({args.platform}): {e}', file=sys.stderr)
        return 2
    by_name = {x['name']: x for x in infos}
    names = wanted(list(by_name), [sid for sid, _ in scenes.SCENES])
    if not names:
        print(f'version {args.version} lists no 卫戍协议 scene bundle (an off-season version?)', file=sys.stderr)
        return 1
    if args.list:
        for n in names:
            print(f'{by_name[n].get("totalSize", 0):>9}  {n}')
        print(f'{sum(by_name[n].get("totalSize", 0) for n in names):>9}  total ({len(names)} bundles)')
        return 0
    bad = 0
    for n in names:
        dst = out / n
        md5 = by_name[n].get('md5')
        if dst.is_file() and hashlib.md5(dst.read_bytes()).hexdigest() == md5:
            print(f'have {n}')
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(get(base + dat_name(n)))) as z:
                blob = z.read(z.namelist()[0])
        except Exception as e:
            print(f'FAIL {n}: {e}', file=sys.stderr)
            bad += 1
            continue
        if md5 and hashlib.md5(blob).hexdigest() != md5:
            print(f'FAIL {n}: md5 mismatch', file=sys.stderr)
            bad += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(blob)
        print(f'got  {n} ({len(blob)} bytes)')
    print(f'done: {len(names) - bad}/{len(names)} bundles under {out}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
