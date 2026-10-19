"""Builds eu-roads.txt: road distances between every ETS2 and ProMods city, as driven on real roads.

Reported from play (v0.87): Travemünde to Groningen planned at 247 km after the Helsinki boat, where the road is
nearer 400, and the driver was late. In Europe the app had a straight line and a road factor, and the coasts and bays
make that a poor guess — and where a ferry splits a load, there is no listing distance for either leg to fall back on.

Distances come from OSRM (https://project-osrm.org/) over OpenStreetMap data, © OpenStreetMap contributors,
ODbL (https://www.openstreetmap.org/copyright). The public demo server routes by land where it can: the long sea
crossings the app plans for itself are not in these figures (checked: Travemünde to Helsinki comes back 2,898 km by
road, no ferry). The game's roads are not the real ones, so a figure here is an estimate the trip log corrects as
loads are driven (Core/Services/RoadLearning).

Run from tools/ets2-data:  python build_roads.py
Writes ../../data-embedded/eu-roads.txt. About a hundred requests to the demo server, a second apart.
"""
import json, re, sys, time, unicodedata, urllib.request

ROOT = '../..'
SERVER = 'https://router.project-osrm.org/table/v1/driving/'
BLOCK = 50

SPECIAL = {'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE',
           'þ': 'th', 'Þ': 'Th', 'ð': 'd', 'Ð': 'D', 'ı': 'i', 'İ': 'I', 'œ': 'oe', 'Œ': 'OE'}


def norm(name):
    s = ''.join(SPECIAL.get(c, c) for c in name)
    s = ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))
    s = s.strip().lower().replace('’', '').replace("'", '').replace('.', '').replace('-', ' ')
    if s.startswith('saint '):
        s = 'st ' + s[6:]
    return ' '.join(s.split())


def game_cities():
    text = open(f'{ROOT}/Core/Services/Ets2Data.Generated.cs', encoding='utf-8').read()
    seen, out = set(), []
    for m in re.finditer(r'^\s+([^|/\n]+)\|([A-Z]{2})\|\d\|\d\|', text, re.M):
        key = (m.group(2), norm(m.group(1)))
        if key not in seen:
            seen.add(key)
            out.append((m.group(1).strip(), m.group(2)))
    return out


def coordinates():
    where = {}
    for line in open(f'{ROOT}/data-embedded/eu-cities.txt', encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        p = line.rstrip('\n').split('|')
        if len(p) >= 4:
            where.setdefault((p[1], norm(p[0])), (float(p[2]), float(p[3])))
    return where


def table(coords, sources, destinations):
    url = SERVER + ';'.join(f'{lon:.5f},{lat:.5f}' for lat, lon in coords) + \
        f"?annotations=distance&sources={';'.join(map(str, sources))}&destinations={';'.join(map(str, destinations))}"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'TruckSimDispatcher build_roads'}), timeout=120) as r:
                d = json.load(r)
            if d.get('code') == 'Ok':
                return d['distances']
            print('  server said', d.get('code'), d.get('message'), file=sys.stderr)
        except Exception as e:
            print('  retry after', e, file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise SystemExit('OSRM did not answer')


def main():
    where = coordinates()
    cities = []
    for name, cc in game_cities():
        hit = where.get((cc, norm(name)))
        if hit is None:
            print(f'  no coordinates for {name}, {cc} - left out', file=sys.stderr)
            continue
        cities.append((name, cc, hit))
    n = len(cities)
    print(f'{n} cities', file=sys.stderr)
    km = [[None] * n for _ in range(n)]
    blocks = [list(range(i, min(i + BLOCK, n))) for i in range(0, n, BLOCK)]
    done = 0
    for bi, a in enumerate(blocks):
        for b in blocks[bi:]:
            idx = a if a is b else a + b
            coords = [cities[i][2] for i in idx]
            src = list(range(len(a)))
            dst = src if a is b else list(range(len(a), len(idx)))
            rows = table(coords, src, dst)
            for si, row in zip(a, rows):
                for dj, metres in zip(b, row):
                    if metres is not None and si != dj:
                        km[si][dj] = round(metres / 1000)
            done += 1
            print(f'  {done} blocks', file=sys.stderr)
            time.sleep(1)

    with open(f'{ROOT}/data-embedded/eu-roads.txt', 'w', encoding='utf-8', newline='\n') as f:
        f.write('# Road distances between ETS2 and ProMods cities, in kilometres, by real roads.\n')
        f.write('# Source: OSRM (project-osrm.org) over OpenStreetMap data, (c) OpenStreetMap contributors, ODbL.\n')
        f.write('# Built by tools/ets2-data/build_roads.py. C|index|City|CC, then R|index|km to each later city ("" = no road).\n')
        for i, (name, cc, _) in enumerate(cities):
            f.write(f'C|{i}|{name}|{cc}\n')
        for i in range(n):
            # Whichever way round was measured: the shorter, so a one-way detour does not count against a pair.
            row = []
            for j in range(i + 1, n):
                v = [x for x in (km[i][j], km[j][i]) if x is not None]
                row.append(str(min(v)) if v else '')
            f.write(f'R|{i}|{",".join(row)}\n')
    print('written', file=sys.stderr)


if __name__ == '__main__':
    main()
