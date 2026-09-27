# UrbanLM Lite — research basis

How qualitative feelings (*happy, calm, lively …*) are turned into quantitative, testable
parameters of physical space, and what each number in the app rests on.

Contents: 1 · Sources · 2 · POUH portfolio data · 3 · Literature corpus · 4 · Conversion
methods catalogue · 5 · Keyword lexicon · 6 · Metrics as implemented · 7 · Model ·
8 · Assumptions and limitations · 9 · Roadmap (probabilistic model, ABM, neural) · 10 · References

---

## 1 · Sources

| Source | What it contributes | Where in code |
|---|---|---|
| **Pursuit of Urban Happiness** portfolio (Shah, CEPT UR2001, Monsoon 2022, 55 pp.) | Site, problems, 8 measured happy places, 8 programmes, 3 strategy combinations with numeric bands, site-selection + intervention pseudo-code | `src/engine/pouh.js`, `generator.js` |
| Literature corpus (1,104 papers, tokenised + vectorised) | Evidence for every keyword and metric; 325 quantitative statements | `research/scripts/build_corpus.py`, `public/data/evidence.json` |
| Core papers read in full (Ewing & Handy 2009; Franz & Wiener 2005; Yilmaz et al. 2025; Psathiti & Sailer 2017) | Operational definitions, R² values, H/W test ranges, seat-preference predictors | `keywords.js` |
| OpenStreetMap (ODbL) | Street network of Manek Chowk → Nagbhudar ni pol | `data/osm_streets_manek_chowk.json` |

The CEPT portfolio web page could not be scraped from the cloud environment: it is behind a
Sucuri firewall with a country block ("GEO02") and a Cloudflare-protected mirror, and it has
no Wayback snapshot. All portfolio data was read from the PDF supplied by the author.

## 2 · POUH portfolio data (as encoded)

**Site (p. 7–15).** The site is a patch linking the Manek Chowk and Raipur Chakla attractors,
with Sankdi Sheri as a secondary street. Its residential core is dense, with commercial uses
on the periphery. The portfolio lists four problems:

- lack of green cover;
- a commercial edge that goes dead at night and feels unsafe;
- open spaces lost to haphazard parking;
- narrow, tall streets that get little sunlight, which isolates residents.

**Happiness factors (p. 17).** Ecological diversity; physical and mental well-being; community interaction.

**Measured happy places (p. 19–26).**

| Place | Built type | Quality | Elements | Sun hours | Isovist | Shading mask |
|---|---|---|---|---|---|---|
| North Lawns, CEPT | open | super green | lawns, mounds | 10.5 | 44 % | 0.96 |
| FP Plinth, CEPT | semi-open | paved | plinth, stepped seating | 10.8 | 50 % | 0.52 |
| Toritos Cafe | built + open | super green | cafe, seating around green | 8.5 | 85 % | 0.50 |
| Municipal Market | semi-open | paved | shaded corridor, stalls | 6.9 | 34 % | 0.80 |
| Chauraha Cafe | open | paved | lawns/mounds, steps, cafe, spill-over | 9.6 | 28 % | 0.48 |
| Art Gallery | open | paved | amphitheatre steps | 11.2 | 6.3 % | 0.91 |
| Makeba Cafe | open | super green | terrace, cafe, green | 6.5 | 24 % | 0.86 |
| FP Terrace, CEPT | open | paved | terrace | 6.8 | 56 % | 0.91 |

**Programmes (p. 28–29)** — area per unit (m²), elements, units:
cafe 65–100 (lawn + plinth + terrace, 3–4 u) · amphitheatre 380–485 (lawn + steps, 2–3 u) ·
plaza 205–275 (mound + corridor + steps, 2–3 u) · exhibition 205–275 (plinth + corridor, 1–2 u) ·
yoga 205–275 (lawn + steps + terrace, 3–4 u) · open gym 65–100 (mound + lawn, 1–2 u) ·
kids' play 380–485 (lawn + plinth + mound, 2–3 u) · light park 65–100 (lawn + corridor + steps, 1–2 u).

**Strategy combinations (p. 30–32)** — all 650–855 m², area ratio 0.25 / 0.30 / 0.45:

| Combination | Main road | Unit spacing | Residential share | Sun hours | Isovist | Shading mask | Step division (H × W, m) |
|---|---|---|---|---|---|---|---|
| Cafe + Exhibition + Amphitheatre | 120–160 m | 120–160 m | 50 % | 6–8 | 10–35 % | 0.75–0.90 | cafe 2.5–3 × 3–4; amph. 0.45–0.6 × 0.6–1.2 |
| Light park + Yoga + Kids | 160–200 m | 80–120 m | 65 % | 8–10 | 35–60 % | 0.60–0.75 | yoga 0.9–1.2 × 1.5–1.8 |
| Open gym + Plaza + Kids | 80–120 m | 160–200 m | 33 % | 10–12 | 60–85 % | 0.45–0.60 | plaza 0.15–0.45 × 0.6–0.9 |

Bars in the portfolio mark one tercile of a scale (e.g. sun hours 6–12 h), so the terciles
were read as the bands. **Pseudo-code (p. 34–35)** is implemented as the site-selection
constraints and the rectangle → strips → step grid → cut-out → directional extrusion
generator (`generator.js`).

## 3 · Literature corpus

Built with `research/scripts/build_corpus.py` (fully reproducible, fixed seeds):

- **Harvest.** OpenAlex title/abstract search over 130 query formulations, with Semantic
  Scholar filling thin topics (isovists, Place Pulse, restoration). That gave 1,455 unique
  records.
- **Relevance filter.** Abstracts over 300 characters with at least 3 urban-design domain
  terms leave **1,104 papers (1964–2026)**.
- **Tokenisation.** Lower-case, stop words (English plus 45 generic research words), light
  plural stemming, titles weighted ×2. This gives 241,570 tokens.
- **Vectorisation.** Unigram + bigram TF-IDF (min_df 2, max_df 0.5, sublinear tf) gives a
  **24,569-term vocabulary**. LSA (truncated SVD, 128 dimensions, 27.2 % variance) then gives
  a unit vector per paper.
- **Topics.** KMeans with k = 14: Ahmedabad / walled city · street vending · public space &
  space syntax · urban heat island · landscape preference · morphology & neural networks ·
  isovists & visibility · VR experiments · soundscape · health & green space · outdoor thermal
  comfort · street-view segmentation · pedestrian simulation · street canyons & wind.
- **Evidence retrieval.** Each keyword and metric has a query vector; its top papers by
  cosine similarity feed the *Evidence* list in the app's proof panel.
- **Quantitative statements.** 325 sentences pair a metric (SVF, GVI, UTCI/PET, H/W, wind,
  dB, shade) with numbers and units. For example, "H/W from 1 to 3 lowers PET by about
  10 °C" (Emmanuel 2007), and "neutral PET 28.6 °C" (Middel 2016).

The full artefacts (`papers.jsonl` with abstracts, tokens, TF-IDF matrix, LSA vectors) are
regenerated by the script. The app ships a compact evidence bundle (`public/data/evidence.json`).

## 4 · Qualitative → quantitative conversion methods (catalogue)

| # | Method | Converts … into … | Key numbers | In app |
|---|---|---|---|---|
| 1 | **Isovist analysis** (Benedikt 1979) | spaciousness, openness, complexity → area, perimeter, openness, jaggedness, vertex density | Franz & Wiener: rated spaciousness ~ isovist area + free near space, R² = .78; complexity R² = .93; pleasingness R² = .69; beauty R² = .78 | ✅ `metrics.js` |
| 2 | **Visibility graph analysis** (Turner et al. 2001) | visual integration, clustering → movement, co-presence | clustering coefficient ~ convexity / visual stability | roadmap |
| 3 | **Space syntax** (Hillier et al. 1993) | configuration → movement / liveliness | meta-analysis: integration ES 0.206, choice ES 0.481; angular ≈ 0.5 (Sharmin & Kamruzzaman 2018) | roadmap |
| 4 | **Expert-panel operationalisation** (Ewing & Handy 2009) | imageability, enclosure, human scale, transparency, complexity → countable features | 48 street clips, 10 experts; models explain 63–72 % of scene variance | ✅ as proxies (frontage, seating, sight lines) |
| 5 | **Crowdsourced pairwise comparison + CNN** (Place Pulse 2.0, Dubey et al. 2016) | safe / lively / beautiful / wealthy / boring / depressing → image scores | 1.17 M comparisons, 110,988 images, 56 cities | roadmap (street-view module) |
| 6 | **Semantic segmentation of street views** (Li et al. 2015 GVI) | greenery, sky, enclosure → pixel shares | GVI from 18 directional images; SVI → SVF | ✅ geometric analogue |
| 7 | **Explainable ML thresholds** (RF/XGBoost + SHAP) | nonlinear feature → perception curves | thresholds + interaction effects (e.g. LightGBM-SHAP 2026) | ✅ GBT + Saabas attribution |
| 8 | **Sky view factor** (Johnson & Watson 1984; Oke) | openness / enclosure / heat → 0–1 | SVF = 1 − mean sin²β | ✅ |
| 9 | **Thermal comfort indices** (UTCI, Bröde 2012; PET) | comfort → °C equivalent, stress classes | UTCI classes 26/32/38/46 °C; Ahmedabad CBD study (Mehta et al. 2024) | ✅ screening estimate |
| 10 | **Wind comfort criteria** (Lawson) | wind comfort → activity classes | 4 / 6 / 8 / 10 m/s at 5 % exceedance | ✅ |
| 11 | **Soundscape circumplex** (ISO/TS 12913-2) | pleasantness / eventfulness from 8 attributes | natural sounds ↑ pleasantness; traffic ↓ | ✅ proxy (distance to carriageway) |
| 12 | **Prospect–refuge** (Appleton 1975; Dosen & Ostwald 2016) | preference → view extent + enclosure | joint isovist area × connectivity best predicts seat choice (Psathiti & Sailer 2017) | ✅ edge distance, openness |
| 13 | **Behaviour mapping / liveliness index** (Gehl; Mehta 2007) | liveliness → people, groups, duration of stay | seating, active frontage, sidewalk width and shade drive stationary activity | ✅ frontage, seating, shade |
| 14 | **Kaplan preference matrix** | coherence, complexity, legibility, mystery | coherence, complexity and mystery explain restorativeness; legibility does not | ✅ occlusions, jaggedness, roundness |
| 15 | **Fractal analysis** (Taylor 2011; Cooper 2008) | visual complexity preference → D | D ≈ 1.3–1.5 preferred | ✅ approx. (skyline variation) |
| 16 | **Physiological measurement** (EDA, EEG, fEMG; Yilmaz et al. 2025) | affect → signals | H/W 0.5, 2, 4; enclosure ratings flat above H/W 4 | calibration route |
| 17 | **VR experiments** | controlled perception ratings | isolates one variable at a time | calibration route |
| 18 | **Surveys: subjective well-being / life satisfaction** | happiness → Likert | — | ✅ CSV calibration |
| 19 | **POUH measured happy places** | happiness → sun hours, isovist, shading mask bands | table in § 2 | ✅ |

## 5 · Keyword lexicon (generated from `src/engine/keywords.js`)

Each keyword is a weighted set of trapezoid membership functions: the score is 1 inside the
full-score range and ramps linearly to 0 at the outer bounds. The keyword score is the
weighted mean × 100.

#### Happy / joyful · `happy` · tree-model R² 0.985

The POUH target feeling: a green, comfortable, moderately enclosed space with people-oriented edges.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Green view index (0–1) | 0.18–0.4 (0 outside 0.08–0.55) | 15 % | li2015, bardhan2025, quercia2014 |
| Enclosure H/W (ratio) | 0.5–1.5 (0 outside 0.2–3) | 11 % | yilmaz2025, ewing2009 |
| Sky view factor (0–1) | 0.3–0.65 (0 outside 0.15–0.85) | 8 % | asgarzadeh2012, yilmaz2025 |
| UTCI estimate (°C) | ≤ 32 (0 at 38) | 13 % | brode2012, mehta2024 |
| Visible active frontage (0–1) | ≥ 0.35 (0 below 0.1) | 10 % | mehta2007, gehl1987 |
| Seats within 15 m (count) | ≥ 3 (0 below 0) | 8 % | whyte1980, mehta2007 |
| Isovist area (m²) | 300–2500 (0 outside 80–6000) | 6 % | wiener2007, gehl1987 |
| Distance to carriageway (m) | ≥ 12 (0 below 2) | 5 % | iso12913, quercia2014 |
| Direct sun hours (h) | 6.9–10.5 (0 outside 5.5–12) | 9 % | pouh2022 |
| Isovist % (clear rays ≤ 25 m) (%) | 24–56 (0 outside 4–90) | 8 % | pouh2022, wiener2007 |
| Shading mask (10–17 h) (0–1) | 0.5–0.91 (0 outside 0.4–1.01) | 9 % | pouh2022 |

#### Calm / serene · `calm` · tree-model R² 0.995

Low eventfulness: greenery and water, sheltered from wind and traffic, few distractions.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Green view index (0–1) | ≥ 0.25 (0 below 0.12) | 22 % | li2015, kaplan1989 |
| Distance to carriageway (m) | ≥ 20 (0 below 5) | 22 % | iso12913 |
| Visible active frontage (0–1) | ≤ 0.3 (0 at 0.7) | 13 % | iso12913, mehta2007 |
| Pedestrian wind (mean) (m/s) | ≤ 2.2 (0 at 3.3) | 11 % | lawson2001 |
| Occluding edges (vistas) (count) | ≤ 6 (0 at 14) | 11 % | franz2005 |
| Water in view (0–1) | ≥ 0.1 (0 below 0) | 11 % | whyte1980, bardhan2025 |
| Skyline variation (deg) | ≤ 8 (0 at 16) | 9 % | taylor2011 |

#### Lively / vibrant · `lively` · tree-model R² 0.993

Eventful: active edges, places to linger, visual complexity, well-connected views.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Visible active frontage (0–1) | ≥ 0.55 (0 below 0.25) | 25 % | mehta2007, gehl1987, ewing2009 |
| Seats within 15 m (count) | ≥ 6 (0 below 1) | 19 % | mehta2007, whyte1980 |
| Occluding edges (vistas) (count) | 7–16 (0 outside 3–26) | 12 % | ewing2009, franz2005 |
| Isovist area (m²) | 500–3000 (0 outside 150–7000) | 12 % | hillier1993, turner2001 |
| Enclosure H/W (ratio) | 0.6–1.6 (0 outside 0.3–3) | 12 % | ewing2009 |
| Shading mask (10–17 h) (0–1) | ≥ 0.45 (0 below 0.2) | 10 % | mehta2007, mehta2024 |
| Distance to nearest edge (m) | ≤ 8 (0 at 20) | 8 % | gehl1987 |

#### Safe / secure · `safe` · tree-model R² 0.995

Prospect with surveillance: long clear views, eyes on the street, few hidden corners.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Isovist openness (0–1) | 0.2–0.7 (0 outside 0.05–0.95) | 19 % | appleton1975, wiener2007 |
| Isovist area (m²) | ≥ 400 (0 below 100) | 19 % | wiener2007, dubey2016 |
| Visible active frontage (0–1) | ≥ 0.4 (0 below 0.1) | 23 % | jacobs1961, dubey2016 |
| Occluding edges (vistas) (count) | ≤ 6 (0 at 14) | 19 % | franz2005, appleton1975 |
| Isovist jaggedness P²/A () | ≤ 45 (0 at 90) | 12 % | wiener2007 |
| Green view index (0–1) | 0.1–0.35 (0 outside 0.03–0.55) | 9 % | dubey2016, li2015 |

#### Intimate / cosy · `intimate` · tree-model R² 0.996

Room-like: small convex space, strong enclosure, close edges — the pol courtyard (chowk) quality.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Enclosure H/W (ratio) | 1.2–3 (0 outside 0.7–5) | 27 % | yilmaz2025, ewing2009, matsuda2002 |
| Isovist area (m²) | 80–400 (0 outside 30–900) | 27 % | wiener2007, gehl1987 |
| Isovist roundness (0–1) | ≥ 0.5 (0 below 0.3) | 19 % | franz2005 |
| Distance to nearest edge (m) | ≤ 4 (0 at 10) | 14 % | gehl1987, psathiti2017 |
| Sky view factor (0–1) | 0.15–0.45 (0 outside 0.05–0.65) | 14 % | asgarzadeh2012 |

#### Spacious / open · `spacious` · tree-model R² 0.999

Large, bright, far-reaching views with low enclosure.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Isovist area (m²) | ≥ 2500 (0 below 800) | 29 % | wiener2007, benedikt1979 |
| Sky view factor (0–1) | ≥ 0.65 (0 below 0.45) | 26 % | asgarzadeh2012 |
| Isovist openness (0–1) | ≥ 0.4 (0 below 0.15) | 24 % | franz2005 |
| Enclosure H/W (ratio) | ≤ 0.4 (0 at 1) | 21 % | yilmaz2025 |

#### Restorative / green · `restorative` · tree-model R² 0.997

Attention restoration: abundant visible greenery, water, distance from traffic, coherent form.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Green view index (0–1) | ≥ 0.3 (0 below 0.15) | 40 % | kaplan1989, bardhan2025, li2015 |
| Water in view (0–1) | ≥ 0.15 (0 below 0) | 17 % | bardhan2025 |
| Distance to carriageway (m) | ≥ 20 (0 below 5) | 20 % | iso12913 |
| Skyline variation (deg) | 4–12 (0 outside 1–20) | 9 % | taylor2011 |
| UTCI estimate (°C) | ≤ 32 (0 at 38) | 14 % | brode2012 |

#### Mysterious / exploratory · `mysterious` · tree-model R² 0.998

Kaplan’s mystery: partly hidden vistas that promise more information around the corner.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Occluding edges (vistas) (count) | ≥ 12 (0 below 6) | 40 % | kaplan1989, franz2005 |
| Isovist jaggedness P²/A () | ≥ 60 (0 below 35) | 30 % | wiener2007 |
| Isovist openness (0–1) | ≤ 0.25 (0 at 0.5) | 17 % | franz2005 |
| Isovist area (m²) | 150–1500 (0 outside 60–4000) | 13 % | wiener2007 |

#### Thermally comfortable / cool · `comfortable` · tree-model R² 0.996

Shade and breeze against Ahmedabad’s 40 °C design day.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| UTCI estimate (°C) | ≤ 30 (0 at 36) | 41 % | brode2012, mehta2024 |
| Shading mask (10–17 h) (0–1) | ≥ 0.65 (0 below 0.35) | 29 % | mehta2024 |
| Pedestrian wind (mean) (m/s) | 1–3 (0 outside 0.4–4.5) | 18 % | lawson2001, brode2012 |
| Sky view factor (0–1) | 0.2–0.5 (0 outside 0.05–0.75) | 12 % | mehta2024 |

#### Legible / imageable · `legible` · tree-model R² 0.994

Easy to read and remember: coherent convex space, distinctive skyline, visible landmarks.

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Isovist roundness (0–1) | ≥ 0.4 (0 below 0.2) | 26 % | lynch1960, franz2005 |
| Occluding edges (vistas) (count) | ≤ 8 (0 at 15) | 23 % | kaplan1989 |
| Skyline variation (deg) | 6–15 (0 outside 3–25) | 19 % | lynch1960, taylor2011 |
| Isovist area (m²) | ≥ 500 (0 below 150) | 19 % | lynch1960, turner2001 |
| Visible active frontage (0–1) | ≥ 0.2 (0 below 0) | 13 % | ewing2009 |

#### Sociable / gathering · `sociable` · tree-model R² 0.996

Places to sit at the edge, in shade, with a view of activity (Whyte, Gehl, prospect–refuge seating).

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Seats within 15 m (count) | ≥ 8 (0 below 2) | 28 % | whyte1980, psathiti2017 |
| Distance to nearest edge (m) | ≤ 6 (0 at 15) | 16 % | gehl1987, psathiti2017 |
| Shading mask (10–17 h) (0–1) | ≥ 0.6 (0 below 0.3) | 19 % | mehta2007 |
| Visible active frontage (0–1) | ≥ 0.3 (0 below 0.1) | 16 % | mehta2007 |
| Isovist area (m²) | 250–2000 (0 outside 100–5000) | 12 % | gehl1987 |
| Pedestrian wind (mean) (m/s) | ≤ 2.2 (0 at 3.3) | 9 % | lawson2001 |

#### Active / playful · `active` · tree-model R² 0.995

Room to move and play: open, sunny, visible spaces (POUH gym + plaza + kids combination).

| Parameter | Full-score range (zero outside) | Weight | Sources |
|---|---|---|---|
| Isovist % (clear rays ≤ 25 m) (%) | 60–85 (0 outside 40–100) | 28 % | pouh2022 |
| Direct sun hours (h) | 10–12 (0 outside 8–13) | 22 % | pouh2022 |
| Shading mask (10–17 h) (0–1) | 0.45–0.6 (0 outside 0.3–0.8) | 22 % | pouh2022 |
| Isovist openness (0–1) | ≥ 0.2 (0 below 0.05) | 14 % | franz2005 |
| UTCI estimate (°C) | ≤ 34 (0 at 40) | 14 % | brode2012 |

## 6 · Metrics as implemented (`src/engine/metrics.js`)

All metrics are computed by ray-marching a 2.5D raster (2 m cells: building tops, tree
crowns with base/top/transmissivity, canopies, seats, frontage flags). The eye height is
1.6 m. Sampling covers every open cell (analysis) or every second cell (optimisation) inside
the zones plus a 6 m buffer.

| Parameter | Definition |
|---|---|
| Isovist area, perimeter, roundness, jaggedness | 48–64 rays to 100 m; roundness = 4πA/P²; jaggedness = P²/A (Wiener & Franz) |
| Openness | share of rays reaching 100 m |
| Occluding edges | adjacent-ray depth jumps > max(4 m, 35 %), a proxy for vistas / mystery |
| Isovist % (POUH) | share of rays unobstructed within 25 m (**assumed definition**, see § 8) |
| Enclosure H/W | mean wall height over the narrowest cross-section width |
| SVF | 1 − mean sin²β over 16 horizon angles; tree crowns count 60 % |
| Green view index | per ray, the vertical share of a −10°…+60° field filled by the nearest crown × 0.85 foliage density |
| Sun hours (POUH) | Σ hourly direct-beam transmissivity, 06:30–17:30 solar time, 21 April |
| Shading mask (POUH) | shaded share of the hot window 10:00–17:00 (**assumed definition**, see § 8) |
| UTCI estimate | Tₐ − 6 + 10·(1 − shade) + 2.5·SVF − 1.2·min(max(U − 0.5, 0), 3.5); Tₐ = 40 °C |
| Pedestrian wind | U₁₀ = 4 m/s from 225° (SW), power law α = 0.3, wake sheltering up to 5H upwind, Venturi factor ≤ 1.3 in gaps < 30 m |
| Ground coverage, mean height | within 50 m |
| Edge distance | nearest opaque obstacle (prospect–refuge, Gehl edge effect) |
| Active frontage | share of façade hits within 40 m that are active ground floors |
| Seats | seats within 15 m |
| Water in view, skyline variation, distance to carriageway | ray hits on water; SD of horizon angles; nearest road cell |

## 7 · Model

**Stage 1 (implemented): deterministic tree regression.** One gradient-boosted tree ensemble
per keyword (90 trees, depth 4, histogram splits, no randomness) maps the 21-parameter vector
to a 0–100 score.

- **Training data.** 4,600 samples. About 2,100 come from 300 random POUH designs generated
  on the trial site (zone-aggregated and per-point). About 2,500 are space-filling samples
  over each parameter's range, zero-inflated for sparse features to avoid a proxy artefact.
- **Labels.** Labels come from the literature + POUH lexicon (§ 5). Fit to that prior:
  R² 0.985–0.999.
- **Why trees and not the formula directly.** Trees fix the data pipeline, so real survey
  rows can override the prior without code changes (stage 2). They give exact,
  deterministic per-parameter attributions (Saabas paths, which sum to the prediction). They
  also run in microseconds on a phone.

**Stage 2 (implemented, needs data): calibration.** A survey CSV adds real observations: a
feature vector, measured on site or taken from this app's point export, plus keyword ratings
(Likert rows are rescaled). Survey rows are weighted ×5 against the prior, and the trees
retrain on-device.

**Optimiser.** A seeded genetic algorithm searches the generator genome. The population is
seeded with one design per POUH combination. The objective is:

`100 − RMSE(score − target) + 8 × POUH compliance − 0.4 × intervention cost`

It matches the *intensity* you ask for rather than maximising it. Programme-internal
clearing costs 0.4; stand-alone demolition costs 2.5.

## 8 · Assumptions and limitations (read before citing numbers)

- **The keyword scores are a literature-derived prior**, not measured happiness. The trees
  reproduce that prior until survey data is added.
- **POUH "isovist %" and "shading mask" definitions are inferred.** The portfolio reports
  the values without formulas. The isovist is read as the share of clear rays within 25 m,
  which matches an enclosed amphitheatre at 6.3 % and an open cafe at 85 %. The shading mask
  is read as the shaded share of the hot hours. Please confirm the original Grasshopper
  settings (radius, analysis grid, period); they are single constants in `metrics.js`.
- **UTCI and wind are screening models**, not a replacement for ENVI-met, Ladybug/Honeybee
  or CFD. The Lawson class assumes U₅% ≈ 1.8 × mean speed.
- **Default site.** The streets are real OSM data. The buildings are a procedural pol fabric,
  because this area of OSM is mostly schematic 14 m squares (247 of 428), which would distort
  the morphology metrics. Replace it with a surveyed model when available: import GLB, OBJ or
  GeoJSON.
- **Corpus evidence is retrieval, not meta-analysis.** Links show where a claim comes from;
  effect sizes are only those quoted in § 4.

## 9 · Roadmap: from deterministic to probabilistic, ABM and neural

1. **Probabilistic model.** Quantile or NGBoost trees (or a Bayesian hierarchical model over
   sites and respondents) that return a *distribution* per keyword. Add Monte-Carlo over
   climate (TMY hours rather than one design day), wind direction frequencies and user
   heterogeneity (age, gender, time of day). Output P(score ≥ target).
2. **Agent-based simulation.** Social-force pedestrians (Helbing & Molnár 1995) with
   stationary-activity choice driven by the per-cell comfort and affordance fields already
   computed. This follows Cheliotis (2020) and Yang, Dane & Arentze (2025) on affective ABMs
   for public-space design. Outputs are occupancy, dwell time, encounters and a Mehta-style
   liveliness index, which closes the loop from form to behaviour to feeling.
3. **Neural surrogate (UrbanLM Fabric Intelligence link).** A graph neural network over the
   building–open-space adjacency graph (Lei et al. 2024; Chen 2025 explainable GNN for
   morphology). It learns metrics and perception jointly from many cities, then is distilled
   into a small on-device model. The present trees are the teacher and a fallback.
4. **Image perception.** Place Pulse-style scores from street-level renders of the generated
   design, to cross-check the geometric proxies.
5. **Data collection.** Field surveys at the 8 POUH happy places plus the trial site, using
   the CSV format already supported: measure the 21 parameters, then collect ratings.

## 10 · References (short keys used in the app)

`benedikt1979` Benedikt, M. (1979) EPB 6(1) · `franz2005` Franz & Wiener, SSS5 ·
`wiener2007` Wiener et al., Perception 36 · `turner2001` Turner et al., EPB 28(1) ·
`ewing2009` Ewing & Handy, J. Urban Design 14(1) · `yilmaz2025` Yilmaz et al., Building &
Environment · `asgarzadeh2012` Asgarzadeh et al., Landscape & Urban Planning · `li2015` Li et
al., UF&UG 14(3) · `bardhan2025` Bardhan et al., Environ. Research · `dubey2016` Dubey et al.,
ECCV · `quercia2014` Quercia et al., ACM HT · `lawson2001` Lawson, Building Aerodynamics ·
`brode2012` Bröde et al., Int J Biometeorol 56 · `mehta2024` Mehta, Rawal & Shukla (UTCI,
Ahmedabad CBD) · `gehl1987` Gehl, Life Between Buildings · `mehta2007` Mehta, JPER 27(2) ·
`jacobs1961` Jacobs · `appleton1975` Appleton; Dosen & Ostwald (2016) · `psathiti2017` Psathiti &
Sailer, SSS11 · `kaplan1989` Kaplan & Kaplan · `lynch1960` Lynch · `hillier1993` Hillier et al.,
EPB 20(1) · `iso12913` ISO/TS 12913-2 · `taylor2011` Taylor et al. · `whyte1980` Whyte ·
`matsuda2002` Matsuda et al. (Manek Chowk collective form) · `pouh2022` Shah, CEPT UR2001.
The full list of 1,104 corpus papers is generated by the corpus script; the 151 papers cited
in the app are in `public/data/evidence.json`.
