# Study sites (generated)

Where the corpus papers did their fieldwork, and what those places physically look like when measured with this engine.

Pipeline: `research/scripts/fetch_study_sites.py` (LLM location extraction from abstracts → Nominatim geocoding → Overpass OSM within 200 m) → `node scripts/study-sites.js research/sites` (OSM → engine site → 21 parameters sampled within 60 m).

| File | Contents |
|---|---|
| `sites.jsonl` | 50 geocoded study sites (site/district level only): name, city, country, lat/lon, OSM match, papers |
| `osm_raw.tar.gz` | Overpass JSON per site (buildings, streets, trees, green, water, shops/amenities), 200 m radius |
| `site_metrics.jsonl` | per site: mean / p25 / median / p75 of the 21 engine parameters + OSM completeness grade |
| `study_vectors.jsonl` | per (paper, site): parameter vector `x` (medians, order = FEATURE_KEYS) + the paper's methods, outcomes and findings |
| `lexicon_check.json` | per keyword term: measured values at study sites of papers on that keyword vs the lexicon's full-score range |
| `study_sites_app.json` | compact bundle used by the app |
| `geocode_cache.json` | Nominatim responses (reproducibility) |

Limits: abstracts rarely name exact sites (74 site + 66 district mentions in 394 empirical papers → 50 geocoded). OSM completeness varies:
sites are graded good / fair / poor by mapped buildings and coverage within 100 m; poor sites are excluded from comparisons.
Street trees and benches are rarely mapped, so greenery, shade and seating measured from OSM are flagged low reliability.
All sites use the same design day and air temperature, so values compare urban form, not local climate.
Data © OpenStreetMap contributors (ODbL).
