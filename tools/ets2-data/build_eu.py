"""Builds the ETS2 data for #269: the coordinate file, the freight-market table, and the country centres.

Inputs (in this folder): cities500.txt (GeoNames, CC BY 4.0), city_rows.json (the ETS2 wiki's city table:
name, country, companies), promods_cities.json (cities ProMods: Europe adds, by country).
Outputs: eu-cities.txt (City|CC|lat|lon), eu_markets.txt (City|CC|Tier|Reset|Source|), eu_centres.json, and a
report of any game city with no coordinates.
"""
import json
import re
import statistics
import unicodedata

# ---------------------------------------------------------------- the countries, by where they come from
# code -> (name, group). ISO 3166 alpha-2, except UK (the game's own code; GeoNames says GB) and XK (Kosovo).
REGIONS = [
    ('Base game', [('AT', 'Austria'), ('BE', 'Belgium'), ('CZ', 'Czechia'), ('FR', 'France'), ('DE', 'Germany'),
                   ('IT', 'Italy'), ('LU', 'Luxembourg'), ('NL', 'Netherlands'), ('PL', 'Poland'), ('SK', 'Slovakia'),
                   ('CH', 'Switzerland'), ('UK', 'United Kingdom')]),
    ('Going East!', [('HU', 'Hungary')]),
    ('Scandinavia', [('DK', 'Denmark'), ('NO', 'Norway'), ('SE', 'Sweden')]),
    ('Beyond the Baltic Sea', [('EE', 'Estonia'), ('LV', 'Latvia'), ('LT', 'Lithuania'), ('FI', 'Finland'), ('RU', 'Russia')]),
    ('Road to the Black Sea', [('RO', 'Romania'), ('BG', 'Bulgaria'), ('TR', 'Türkiye (European part)')]),
    ('Iberia', [('ES', 'Spain'), ('PT', 'Portugal')]),
    ('West Balkans', [('AL', 'Albania'), ('BA', 'Bosnia and Herzegovina'), ('HR', 'Croatia'), ('XK', 'Kosovo'),
                      ('ME', 'Montenegro'), ('MK', 'North Macedonia'), ('RS', 'Serbia'), ('SI', 'Slovenia')]),
    ('Greece', [('GR', 'Greece')]),
    ('Iceland', [('IS', 'Iceland')]),
    ('ProMods', [('AX', 'Åland Islands'), ('AD', 'Andorra'), ('CY', 'Cyprus'), ('FO', 'Faroe Islands'),
                 ('GE', 'Georgia'), ('GL', 'Greenland'), ('GG', 'Guernsey'), ('IE', 'Ireland'), ('IM', 'Isle of Man'),
                 ('JE', 'Jersey'), ('LI', 'Liechtenstein'), ('MT', 'Malta'), ('MD', 'Moldova'), ('MC', 'Monaco'),
                 ('SJ', 'Svalbard'), ('UA', 'Ukraine')]),
    ('ProMods Middle-East', [('EG', 'Egypt'), ('IQ', 'Iraq'), ('IL', 'Israel'), ('JO', 'Jordan'), ('LB', 'Lebanon'),
                             ('PS', 'Palestine'), ('SA', 'Saudi Arabia'), ('SY', 'Syria')]),
]
CODES = {code for _, rs in REGIONS for code, _ in rs}
GEONAMES_CC = {'GB': 'UK'}            # GeoNames code -> ours

# Wiki country names -> our codes.
WIKI = {
    'Albania': 'AL', 'Austria': 'AT', 'Belgium': 'BE', 'Bosnia and Herzegovina': 'BA', 'Bulgaria': 'BG', 'Croatia': 'HR',
    'Czech Republic': 'CZ', 'Denmark': 'DK', 'Estonia': 'EE', 'Finland': 'FI', 'France': 'FR', 'Germany': 'DE',
    'Greece': 'GR', 'Hungary': 'HU', 'Italy': 'IT', 'Kosovo': 'XK', 'Latvia': 'LV', 'Lithuania': 'LT', 'Luxembourg': 'LU',
    'Montenegro': 'ME', 'Netherlands': 'NL', 'North Macedonia': 'MK', 'Norway': 'NO', 'Poland': 'PL', 'Portugal': 'PT',
    'Romania': 'RO', 'Russia': 'RU', 'Serbia': 'RS', 'Slovakia': 'SK', 'Slovenia': 'SI', 'Spain': 'ES', 'Sweden': 'SE',
    'Switzerland': 'CH', 'Türkiye': 'TR', 'United Kingdom': 'UK',
    # ProMods' spellings
    'Åland': 'AX', 'Andorra': 'AD', 'Cyprus': 'CY', 'Faroe Islands': 'FO', 'Georgia': 'GE', 'Greenland': 'GL',
    'Guernsey': 'GG', 'Iceland': 'IS', 'Ireland': 'IE', 'Jersey': 'JE', 'Malta': 'MT', 'Man (Isle of)': 'IM',
    'Moldova': 'MD', 'Monaco': 'MC', 'Netherlands (The)': 'NL', 'Svalbard': 'SJ', 'Ukraine': 'UA',
}
DLC_OF = {code: group for group, rs in REGIONS for code, _ in rs}


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))


def norm(city):
    # Mirrors Geo.Normalise, so a name that matches here matches in the app.
    c = fold(city).strip().lower().replace('’', '').replace("'", '').replace('.', '').replace('-', ' ')
    c = c.replace('ł', 'l').replace('ø', 'o').replace('đ', 'd').replace('ß', 'ss').replace('æ', 'ae').replace('þ', 'th').replace('ð', 'd')
    if c.startswith('saint '):
        c = 'st ' + c[6:]
    return ' '.join(c.split())


def latin(name):
    """'Благоевград (Blagoevgrad)' -> 'Blagoevgrad'. Anything already Latin is returned as it is."""
    name = re.sub(r'\s*\((?:expanded|reworked)[^)]*\)', '', name).strip()
    if name.count('(') > name.count(')'):
        name += ')'                       # 'Разград (Razgrad' - the wiki dropped the closing bracket
    m = re.match(r'^(.*?)\s*\(([^)]*)\)\s*$', name)
    if m:
        outer, inner = m.group(1), m.group(2)
        if not re.search(r'[A-Za-z]', fold(outer)) or re.search(r'[Ͱ-ϿЀ-ӿႠ-ჿ؀-ۿ]', outer):
            return inner.strip()
        return outer.strip()
    return name


# ---------------------------------------------------------------- GeoNames
places = {}        # (cc, norm) -> (lat, lon, pop, display)
aliases = {}       # (cc, norm(alternate name)) -> best (lat, lon, pop)
KEEP = re.compile(r'^(PPL|PPLA\d?|PPLC|PPLL)$')
by_cc = {}
with open('cities500.txt', encoding='utf-8') as f:
    for line in f:
        p = line.rstrip('\n').split('\t')
        if len(p) < 15 or p[6] != 'P' or not KEEP.match(p[7]):
            continue
        cc = GEONAMES_CC.get(p[8], p[8])
        if cc not in CODES:
            continue
        lat, lon, pop = float(p[4]), float(p[5]), int(p[14] or 0)
        display = p[2] or p[1]
        k = (cc, norm(display))
        if k not in places or places[k][2] < pop:
            places[k] = (lat, lon, pop, display)
        by_cc.setdefault(cc, []).append((lat, lon))
        for alt in {p[1], p[2], *p[3].split(',')}:
            if not alt:
                continue
            ka = (cc, norm(alt))
            if ka not in aliases or aliases[ka][2] < pop:
                aliases[ka] = (lat, lon, pop)

# Places GeoNames files under a different code from the one the game puts them in.
EXTRA_CC = {'AX': ['FI'], 'SJ': ['NO'], 'XK': ['RS'], 'GL': ['DK'], 'FO': ['DK'], 'IM': ['UK'], 'JE': ['UK'], 'GG': ['UK']}


def locate(cc, name):
    for c in [cc] + EXTRA_CC.get(cc, []):
        for key in (norm(name), norm(latin(name))):
            if (c, key) in places:
                lat, lon, pop, _ = places[(c, key)]
                return lat, lon
            if (c, key) in aliases:
                lat, lon, _ = aliases[(c, key)]
                return lat, lon
    return None


# Game names GeoNames does not carry under any spelling, placed by hand off the map.
MANUAL = {
    ('UK', 'Felixstowe'): (51.963, 1.351), ('FR', 'Coquelles'): (50.927, 1.807),
    ('PT', 'Cortiçadas de Lavre'): (38.778, -8.437), ('SE', 'Kapellskär'): (59.721, 19.065),
    ('SE', 'Karesuando'): (68.441, 22.483), ('FI', 'Olkiluoto'): (61.236, 21.441),
    ('FR', 'Paluel'): (49.836, 0.633), ('ES', 'Port de Sagunt'): (39.660, -0.230),
    ('DE', 'Travemünde'): (53.962, 10.869), ('ES', 'Vandellòs'): (41.018, 0.832),
    ('DK', 'Vesterø Havn'): (57.297, 10.925), ('DE', 'Burg auf Fehmarn'): (54.437, 11.194),
    ('DE', 'Puttgarden'): (54.501, 11.226), ('IS', 'Hólmavík'): (65.706, -21.665),
    ('IS', 'Krafla'): (65.705, -16.778), ('IS', 'Norðurfjörður'): (66.054, -21.548),
    ('IS', 'Varmahlíð'): (65.552, -19.452), ('LV', 'Kolka'): (57.749, 22.588),
    ('MT', 'Il-Belt Valletta'): (35.899, 14.514), ('MC', 'Monaco City'): (43.731, 7.420),
    ('NO', 'Bardufoss'): (69.064, 18.515), ('NO', 'Bidjovagge'): (69.280, 22.470),
    ('NO', 'Finnsness'): (69.229, 17.981), ('NO', 'Lebesby'): (70.565, 27.004),
    ('RU', 'Verkhnetulomsky'): (68.598, 31.763), ('ES', 'Canfranc-Estación'): (42.752, -0.519),
    ('SJ', 'Grumantbyen'): (78.170, 15.150), ('SJ', 'Hiorthhamn'): (78.250, 15.720),
    ('TR', 'Türkgözü'): (41.570, 42.790), ('UA', 'Chernvitsi'): (48.292, 25.936),
    ('UA', 'Polyanytsya'): (48.418, 24.452), ('UK', 'Balivanich'): (57.471, -7.380),
    ('UK', 'Birsay'): (59.130, -3.320), ('UK', 'Evie'): (59.110, -3.104),
    ('UK', 'Lochboisdale'): (57.153, -7.311),
}

# ---------------------------------------------------------------- the game's cities
vanilla = [r for r in json.load(open('city_rows.json', encoding='utf-8')) if len(r) >= 3 and r[0] != 'Name' and r[2].isdigit()]
promods = json.load(open('promods_cities.json', encoding='utf-8'))

markets, game_aliases, missing = [], {}, []
seen = set()
for name, country, companies, *_ in vanilla:
    cc = WIKI.get(country)
    if not cc:
        continue                      # Winterland: the seasonal event map, not a country
    n = int(companies)
    tier = 1 if n >= 8 else 2 if n >= 5 else 3
    markets.append((name, cc, tier, 1 if tier <= 2 else 0, DLC_OF[cc]))
    seen.add((cc, norm(name)))
for country, cities in promods.items():
    cc = WIKI.get(country) or WIKI.get(country.replace('Åland', 'Åland'))
    if not cc:
        print('no code for ProMods country', country)
        continue
    for raw in cities:
        name = latin(raw)
        if (cc, norm(name)) in seen:
            continue
        seen.add((cc, norm(name)))
        markets.append((name, cc, 3, 0, 'ProMods'))

for name, cc, *_ in markets:
    hit = MANUAL.get((cc, name)) or locate(cc, name)
    if hit is None:
        missing.append(f'{name} ({cc})')
        continue
    game_aliases[(cc, norm(name))] = (name, hit)

# ---------------------------------------------------------------- outputs
rows = {}
for (cc, k), (lat, lon, pop, display) in places.items():
    rows[(cc, k)] = (display, lat, lon)
for (cc, k), (name, (lat, lon)) in game_aliases.items():
    rows[(cc, k)] = (name, lat, lon)            # the game's own spelling wins

with open('eu-cities.txt', 'w', encoding='utf-8', newline='\n') as f:
    f.write('# European city coordinates for Euro Truck Simulator 2 careers: City|CC|lat|lon\n#\n')
    f.write('# Source: GeoNames (https://www.geonames.org/), licensed CC BY 4.0.\n#\n')
    f.write('# Populated places (feature class P, PPL/PPLA*/PPLC/PPLL, population 500+) in every country the\n')
    f.write('# base game, SCS map DLC, ProMods and the ProMods Middle-East add-on cover. Country codes are ISO\n')
    f.write('# 3166 alpha-2 as MapCoverage keys them, except UK (the game\'s code; GeoNames says GB) and XK (Kosovo).\n#\n')
    f.write('# Every city the game or ProMods names is also listed under the game\'s own spelling, which is often\n')
    f.write('# the local name (Wien, Praha, Warszawa) where GeoNames has the English one. Geo.Normalise folds\n')
    f.write('# accents, so Kobenhavn and København both find a row. Same format as us-cities.txt.\n')
    for (cc, _), (name, lat, lon) in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[1][0].lower())):
        if '|' in name:
            continue
        f.write(f'{name}|{cc}|{lat:.3f}|{lon:.3f}\n')

with open('eu_markets.txt', 'w', encoding='utf-8', newline='\n') as f:
    for name, cc, tier, reset, source in sorted(markets, key=lambda m: (m[1], m[0])):
        f.write(f'{name}|{cc}|{tier}|{reset}|{source}|\n')

centres = {}
for cc in CODES:
    pts = by_cc.get(cc) or by_cc.get((EXTRA_CC.get(cc) or [''])[0]) or []
    if pts:
        centres[cc] = (round(statistics.median(p[0] for p in pts), 2), round(statistics.median(p[1] for p in pts), 2))
json.dump({'regions': REGIONS, 'centres': centres}, open('eu_centres.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

print(f'places {len(places)}, rows written {len(rows)}, markets {len(markets)} '
      f'({sum(1 for m in markets if m[4] != "ProMods")} SCS, {sum(1 for m in markets if m[4] == "ProMods")} ProMods)')
print('centres for', len(centres), 'of', len(CODES), 'countries; none for', sorted(CODES - set(centres)))
print('game cities with no coordinates:', len(missing))
for m in missing:
    print('  ', m)
