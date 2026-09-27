#!/usr/bin/env python3
"""Geocode the study locations named in the corpus and download OSM data around them.

Input : a folder of per-paper location extractions (JSON: {id, empirical, sites:[{name, city,
        country, level, type}]}) produced with the LOC_PROMPT below.
Output: research/sites/sites.jsonl (one row per unique geocoded site) and
        research/sites/raw/<key>.json (Overpass JSON within 200 m).
Then run: node scripts/study-sites.js research/sites

Only 'site' and 'district' level places are geocoded (a whole city says nothing about
the physical condition of the studied space). Geocoding uses Nominatim (OSM) at ≤ 1
request/s with a descriptive User-Agent, as its usage policy requires.
"""
import glob, json, math, os, re, sys, time, urllib.parse
import requests

LOC_PROMPT = """From this urban-research abstract, extract WHERE the empirical study was carried out. Return ONLY JSON:
{"sites":[{"name":"most specific place named (street, square, park, campus, district, neighbourhood) or null","city":"...","country":"...",
 "level":"site|district|city|country|none",
 "type":"street|square_plaza|park|campus|market|neighbourhood|district|city|other"}],
 "empirical": true|false}
level: site = a specific named street/square/park/campus/building; district = a named neighbourhood or quarter.
empirical=false for reviews, idealised/parametric simulations, or when no real location is given.
Max 4 sites. Use null for unknown fields. Never invent places not in the text.
TITLE: %s
ABSTRACT: %s"""

UA = {'User-Agent': 'UrbanLM-Lite research (github.com/imprayush892/pouh_m22)'}
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']


def overpass_query(lat, lon, r=200):
    a = f'(around:{r},{lat},{lon})'
    return (f'[out:json][timeout:60];(way["building"]{a};relation["building"]{a};way["highway"]{a};node["natural"="tree"]{a};'
            f'way["leisure"]{a};way["landuse"]{a};way["natural"]{a};relation["leisure"]{a};node["shop"]{a};node["amenity"]{a};);out body;>;out skel qt;')


def geocode(name, city, country):
    q = ', '.join(x for x in (name, city, country) if x)
    r = requests.get('https://nominatim.openstreetmap.org/search', params={'q': q, 'format': 'jsonv2', 'limit': 1}, headers=UA, timeout=30)
    time.sleep(1.1)
    if r.status_code != 200 or not r.json():
        return None
    g = r.json()[0]
    return {'lat': float(g['lat']), 'lon': float(g['lon']), 'display': g.get('display_name'), 'osm_class': g.get('category') or g.get('class'), 'osm_type': g.get('type'),
            'importance': g.get('importance'), 'bbox': g.get('boundingbox')}


def key_of(lat, lon):
    return f'{lat:.4f}_{lon:.4f}'.replace('-', 'm')


def main(loc_dir, out_dir='research/sites'):
    os.makedirs(f'{out_dir}/raw', exist_ok=True)
    locs = [json.load(open(f)) for f in glob.glob(f'{loc_dir}/*.json')]
    sites = {}
    for rec in locs:
        if not rec.get('empirical'):
            continue
        for s in rec.get('sites') or []:
            if s.get('level') not in ('site', 'district') or not s.get('name'):
                continue
            g = geocode(s['name'], s.get('city'), s.get('country'))
            if not g:
                continue
            # Reject hits that resolved only to a whole city/country/region.
            if g['osm_type'] in ('city', 'country', 'state', 'administrative', 'county', 'region'):
                continue
            k = key_of(g['lat'], g['lon'])
            row = sites.setdefault(k, {'key': k, **g, 'name': s['name'], 'city': s.get('city'), 'country': s.get('country'),
                                       'level': s['level'], 'type': s.get('type'), 'papers': []})
            if rec['id'] not in row['papers']:
                row['papers'].append(rec['id'])
    for s in sites.values():
        fn = f"{out_dir}/raw/{s['key']}.json"
        if os.path.exists(fn):
            continue
        for ep in OVERPASS:
            try:
                r = requests.post(ep, data={'data': overpass_query(s['lat'], s['lon'])}, headers=UA, timeout=90)
                if r.status_code == 200:
                    open(fn, 'w').write(r.text)
                    break
            except requests.RequestException:
                pass
            time.sleep(5)
        time.sleep(1)
    with open(f'{out_dir}/sites.jsonl', 'w') as f:
        for s in sites.values():
            f.write(json.dumps(s, ensure_ascii=False) + '\n')
    print(f'{len(sites)} unique sites')


if __name__ == '__main__':
    main(*sys.argv[1:])
