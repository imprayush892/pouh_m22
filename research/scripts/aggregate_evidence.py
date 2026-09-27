#!/usr/bin/env python3
"""Aggregate per-paper LLM extractions into a parameter × outcome evidence matrix.

Input: extractions.jsonl, one JSON object per paper:
  {id, relevant, methods[], outcomes[], findings[{parameter, outcome, direction, low, high, unit, quote}], setting, n}
Output: evidence_matrix.json with
  - methods / outcomes / parameters frequency tables
  - cells[keyword][parameter] = {n, pos, neg, nonlinear, none, consistency, papers[], ranges[], quotes[]}
  - engineMap: canonical parameter → engine feature (or null = not computable yet)
usage: python aggregate_evidence.py extractions.jsonl evidence_matrix.json
"""
import json, sys
from collections import Counter, defaultdict

# Canonical outcome → app keywords (an outcome can inform several keywords).
OUTCOME_TO_KEYWORDS = {
    'happiness': ['happy'], 'wellbeing_mental_health': ['happy', 'restorative'], 'stress': ['restorative', 'calm'],
    'safety': ['safe'], 'liveliness_vitality': ['lively'], 'restorativeness': ['restorative'],
    'thermal_comfort': ['comfortable'], 'wind_comfort': ['comfortable'], 'acoustic_pleasantness': ['calm'],
    'beauty_aesthetic': ['happy', 'legible'], 'preference': ['happy'], 'enclosure_perception': ['intimate'],
    'spaciousness': ['spacious'], 'walkability_walking': ['active', 'lively'], 'social_interaction': ['sociable'],
    'stationary_activity_use': ['sociable', 'lively'], 'physical_activity': ['active'], 'place_attachment': ['happy', 'legible'],
    'wayfinding_legibility': ['legible'], 'crowding': ['spacious', 'calm'],
}
# Outcomes where MORE of the outcome is BAD for the keyword (flip direction).
NEGATIVE_OUTCOMES = {('stress', 'restorative'), ('stress', 'calm'), ('crowding', 'spacious'), ('crowding', 'calm')}

# Canonical parameter → engine feature key, sign (+1 same direction, −1 inverse), or None if not computable yet.
ENGINE_MAP = {
    'isovist_area': ('isovistArea', 1), 'isovist_openness': ('openness', 1), 'visual_complexity': ('occlusions', 1),
    'occlusion_mystery': ('occlusions', 1), 'enclosure_height_width': ('enclosureHW', 1), 'building_height': ('meanHeight', 1),
    'building_density_coverage': ('bcr', 1), 'open_space_area': ('isovistArea', 1), 'open_space_proportion': ('bcr', -1),
    'sky_view_factor': ('svf', 1), 'green_view_index': ('gvi', 1), 'tree_canopy_cover': ('gvi', 1), 'vegetation_ndvi': ('gvi', 1),
    'lawn_grass': ('gvi', 1), 'water_presence': ('waterView', 1), 'blue_space_view': ('waterView', 1),
    'sun_exposure_hours': ('sunHours', 1), 'shade_coverage': ('shade', 1), 'utci': ('utci', 1), 'pet': ('utci', 1),
    'mean_radiant_temperature': ('utci', 1), 'air_temperature': ('utci', 1), 'wind_speed': ('wind', 1),
    'active_frontage': ('activeFrontage', 1), 'facade_transparency_windows': ('activeFrontage', 1), 'commercial_density': ('activeFrontage', 1),
    'street_furniture_seating': ('seating', 1), 'distance_to_road': ('roadDist', 1), 'traffic_volume': ('roadDist', -1),
    'noise_level_db': ('roadDist', -1), 'fractal_dimension': ('skylineVar', 1), 'skyline': ('skylineVar', 1),
    'building_height_variation': ('skylineVar', 1), 'street_width': ('enclosureHW', -1),
}
NOT_YET = ['visibility_integration', 'space_syntax_integration', 'space_syntax_choice', 'street_connectivity', 'block_size',
           'floor_area_ratio', 'setback', 'sidewalk_width', 'humidity', 'surface_albedo', 'surface_temperature', 'natural_sounds',
           'land_use_mix', 'poi_density', 'lighting', 'cleanliness_maintenance', 'paving_material', 'facade_colour',
           'facade_articulation', 'historic_buildings', 'landmarks', 'public_art', 'people_density_presence', 'vehicles_parking',
           'pedestrian_flow', 'accessibility_distance']


def main(src, dst):
    recs = [json.loads(l) for l in open(src) if l.strip()]
    rel = [r for r in recs if r.get('relevant')]
    methods = Counter(m for r in rel for m in (r.get('methods') or []))
    outcomes = Counter(o for r in rel for o in (r.get('outcomes') or []))
    params = Counter()
    cells = defaultdict(lambda: defaultdict(lambda: {'pos': 0, 'neg': 0, 'nonlinear': 0, 'none': 0, 'papers': set(), 'ranges': [], 'quotes': []}))
    for r in rel:
        for f in r.get('findings') or []:
            if not isinstance(f, dict) or not f.get('parameter') or not f.get('outcome'):
                continue
            p, o, d = f['parameter'], f['outcome'], f.get('direction')
            params[p] += 1
            for k in OUTCOME_TO_KEYWORDS.get(o, []):
                c = cells[k][p]
                dd = d
                if (o, k) in NEGATIVE_OUTCOMES and d in ('+', '-'):
                    dd = '-' if d == '+' else '+'
                c[{'+': 'pos', '-': 'neg', 'nonlinear': 'nonlinear'}.get(dd, 'none')] += 1
                c['papers'].add(r['id'])
                if f.get('low') is not None or f.get('high') is not None:
                    c['ranges'].append({'low': f.get('low'), 'high': f.get('high'), 'unit': f.get('unit'), 'id': r['id']})
                if f.get('quote') and len(c['quotes']) < 4:
                    c['quotes'].append({'id': r['id'], 'q': f['quote'][:220], 'dir': dd})
    out = {}
    for k, row in cells.items():
        out[k] = {}
        for p, c in row.items():
            n = len(c['papers'])
            directional = c['pos'] + c['neg']
            out[k][p] = {
                'n': n, 'pos': c['pos'], 'neg': c['neg'], 'nonlinear': c['nonlinear'], 'none': c['none'],
                'consistency': round((c['pos'] - c['neg']) / directional, 3) if directional else 0,
                'papers': sorted(c['papers'])[:40], 'ranges': c['ranges'][:12], 'quotes': c['quotes'],
                'engine': ENGINE_MAP.get(p, (None, 0))[0], 'sign': ENGINE_MAP.get(p, (None, 0))[1],
            }
    res = {
        'papers': len(recs), 'relevant': len(rel),
        'findings': sum(len(r.get('findings') or []) for r in rel),
        'methods': methods.most_common(), 'outcomes': outcomes.most_common(), 'parameters': params.most_common(),
        'cells': out, 'engineMap': {k: v[0] for k, v in ENGINE_MAP.items()}, 'notYetComputable': NOT_YET,
    }
    json.dump(res, open(dst, 'w'), ensure_ascii=False)
    print(json.dumps({k: res[k] for k in ('papers', 'relevant', 'findings')}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
