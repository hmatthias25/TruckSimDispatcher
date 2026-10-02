"""Rebuilds eu-cities.txt (City|CC|lat|lon) with every name a driver might type for a place.

Fixes over the #269 build (reported from play: Hanover and Cologne blank, a Halle 200 km out):
  - a name two places share in one country goes to the most populous, main name or alternate alike
  - places of 15,000 or more are listed under every Latin-script name GeoNames has (English and local)
  - seats of government (PPLG: The Hague) are kept
  - every ETS2 and ProMods city is listed under its game spelling and its English name, at the most
    populous match
"""
import re, sys, unicodedata, json
sys.path.insert(0, '.')
from exonyms import DISPLAY, ACCEPT
exec(open('build_eu.py', encoding='utf-8').read().split('# ---------------------------------------------------------------- GeoNames')[0])

KEEP = re.compile(r'^(PPL|PPLA\d?|PPLC|PPLL|PPLG)$')
BIG = 15000
best = {}          # (cc, norm) -> (pop, lat, lon, name)


def offer(cc, name, lat, lon, pop):
    if not name or len(name) > 45 or re.search(r'\d', name):
        return
    f = fold(name)
    if not re.fullmatch(r"[A-Za-z .'’()\-/ łŁøØđĐßæÆþÞðÐıİœŒ]+", f):
        return                                  # not Latin script
    k = (cc, norm(name))
    if k not in best or best[k][0] < pop:
        best[k] = (pop, lat, lon, name)


with open('cities500.txt', encoding='utf-8') as f:
    for line in f:
        p = line.rstrip('\n').split('\t')
        if len(p) < 15 or p[6] != 'P' or not KEEP.match(p[7]):
            continue
        cc = GEONAMES_CC.get(p[8], p[8])
        if cc not in CODES:
            continue
        lat, lon, pop = float(p[4]), float(p[5]), int(p[14] or 0)
        offer(cc, p[1], lat, lon, pop)
        offer(cc, p[2], lat, lon, pop)
        if pop >= BIG:
            for alt in p[3].split(','):
                offer(cc, alt.strip(), lat, lon, pop)

EXTRA_CC = {'AX': ['FI'], 'SJ': ['NO'], 'XK': ['RS'], 'GL': ['DK'], 'FO': ['DK'], 'IM': ['UK'], 'JE': ['UK'], 'GG': ['UK']}


def find(cc, name):
    for c in [cc] + EXTRA_CC.get(cc, []):
        for key in (norm(name), norm(latin(name))):
            if (c, key) in best:
                return best[(c, key)]
    return None


# The game's cities: the market table as the app has it.
src = open(r'..\..\..\..\..\..\code\TruckSimDispatcher\TruckSimDispatcher\Services\Ets2Data.Generated.cs', encoding='utf-8').read() \
    if False else open(sys.argv[1], encoding='utf-8').read()
i = src.index('MarketTable = """'); j = src.index('""";', i)
game = [l.strip().split('|')[:2] for l in src[i:j].split('\n')[1:] if l.strip().count('|') >= 4]

rows = {}
for (cc, k), (pop, lat, lon, name) in best.items():
    rows[(cc, k)] = (name, cc, lat, lon)

# The #269 file already placed every game city it could, some by hand; anything GeoNames will not match
# by name keeps the coordinates it had there.
old = {}
for l in open('old-eu-cities.txt', encoding='utf-8'):
    if l.startswith('#') or l.count('|') < 3:
        continue
    n, c, la, lo = l.rstrip('\n').split('|')[:4]
    old[(c, norm(n))] = (0, float(la), float(lo), n)

missing = []
for city, cc in game:
    hit = find(cc, city) or old.get((cc, norm(city)))
    for eng, local in [(v, k[1]) for k, v in DISPLAY.items() if k[0] == cc and k[1] == city]:
        hit = hit or find(cc, eng)
    if not hit:
        missing.append(f'{city}|{cc}')
        continue
    pop, lat, lon, _ = hit
    names = {city, latin(city)}
    if (cc, city) in DISPLAY: names.add(DISPLAY[(cc, city)])
    names.update(ACCEPT.get((cc, city), []))
    for n in names:
        rows[(cc, norm(n))] = (n, cc, lat, lon)        # the game's spelling always points at the game's city

# English and other spellings for places that are not markets but drivers type (The Hague, Dunkirk...)
for (cc, local), alts in ACCEPT.items():
    hit = find(cc, local) or next((find(cc, a) for a in alts if find(cc, a)), None)
    if hit:
        pop, lat, lon, _ = hit
        for n in [local, *alts]:
            rows.setdefault((cc, norm(n)), (n, cc, lat, lon))

head = [l for l in open('eu-cities.txt', encoding='utf-8') if l.startswith('#')]
head = [h.replace('PPL/PPLA*/PPLC/PPLL, population 500+', 'PPL/PPLA*/PPLC/PPLL/PPLG, population 500+') for h in head]
head.append('# Places of 15,000 or more are also listed under their other Latin-script names (English and local),\n')
head.append('# and a name two places share in a country goes to the more populous. Game cities are listed under the\n')
head.append("# game's spelling and the English name the game shows with localized names on (Hanover, Cologne).\n")
with open('eu-cities.new.txt', 'w', encoding='utf-8', newline='\n') as out:
    out.writelines(head)
    for (cc, k) in sorted(rows, key=lambda x: (x[0], x[1])):
        name, cc2, lat, lon = rows[(cc, k)]
        out.write(f'{name}|{cc2}|{lat:.3f}|{lon:.3f}\n')
print('rows', len(rows), 'missing game cities', missing)
