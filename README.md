# UrbanLM Lite · Pursuit of Urban Happiness

A small, local-first version of **UrbanLM** (Urban Fabric Intelligence Engine). You import a
3D urban model, mark what is open for intervention, and say how the place should *feel*.
The engine then generates public spaces and shows the quantitative proof of how each design
meets those qualitative keywords.

It grew out of the CEPT studio project *Pursuit of Urban Happiness* (UR2001, Monsoon 2022),
which linked the feeling of being in a space to its physical characteristics: isovist, sun,
shade, ground coverage and so on. Everything runs in the browser, including on a phone,
with no server and no network after load.

## Workflow

1. **Site.** The Manek Chowk → Nagbhudar ni pol (Ahmedabad) trial site loads by default.
   You can also import a **.glb / .gltf / .obj / .stl** model or a **GeoJSON** file. A
   deterministic classifier labels ground, buildings, roads, trees, water, green and
   furniture from names, geometry and normals, and shows its reason for every object. You
   can override any label.
2. **Select.** Tap candidate open spaces (chowks), draw zones, and open buildings for
   intervention. The engine may raise, lower or activate these buildings, or clear them for
   a programme.
3. **Feel.** Pick keywords from *happy, calm, lively, safe, intimate, spacious, restorative,
   mysterious, comfortable, legible, sociable, active* and set a target intensity for each.
   You can lock one of the three POUH strategy combinations.
4. **Results.** You get three variants, one per strategy. Each variant shows:
   - keyword scores against your targets;
   - POUH band compliance;
   - 21 measured parameters (existing vs design) with heat maps;
   - per-parameter attributions, the literature rules behind them, and linked papers;
   - export to JSON, CSV and PNG.

## Run it

```bash
npm install
npm run dev          # open the printed URL; --host also serves it to your phone on the LAN
npm test             # engine tests (node:test)
npm run build        # static site in dist/ (works from any folder)
```

Rebuild data and models:

```bash
npm run site         # default site from data/osm_streets_manek_chowk.json
npm run train        # keyword tree models → public/models/
python research/scripts/build_corpus.py --out research/corpus   # literature corpus (needs internet)
python research/scripts/extract_findings.py …; python research/scripts/aggregate_evidence.py …   # findings → matrix
npm run evidence     # evidence matrix → lexicon weights (then npm run train)
```

## How it works

```
3D file ─► classify.js ─► site model ─► raster.js (2.5D grid)
                                          │
keywords + targets ─► optimizer.js (seeded GA)
                          │  genome
                          ▼
                    generator.js  (POUH pseudo-code: rectangle → programme strips →
                          │        step grid → cut-out → extrusion; trees, seats, corridors)
                          ▼
                    metrics.js  (isovist, SVF, GVI, sun hours, shading mask, UTCI, wind,
                          │      enclosure, frontage, seats … 21 parameters)
                          ▼
                    model.js / gbt.js  (tree ensemble per keyword → score + attribution)
                          ▼
                    proof: keywords.js lexicon + POUH bands + corpus evidence
```

- **Deterministic.** The same inputs and seed always give the same design.
- **Explainable.** Every score decomposes into parameter contributions, and every rule cites
  its source.
- **Calibratable.** Load a survey CSV (feature columns plus keyword ratings) and the models
  retrain on-device.

The research basis is in **[research/RESEARCH.md](research/RESEARCH.md)**. It covers the
POUH data, the corpus (1,104 papers, tokenised and vectorised, with 1,376 LLM-extracted
parameter → outcome findings that re-weight the lexicon), a catalogue of 19
qualitative-to-quantitative methods, every keyword's parameter ranges and sources, the
assumptions, and the roadmap to probabilistic models, agent-based simulation and a neural
surrogate.

## Repository

| Path | Contents |
|---|---|
| `src/engine/` | engine (pure JS, no dependencies): geometry, raster, metrics, keyword lexicon, POUH rules, generator, trees, model, optimiser, classifier |
| `src/viewer/` | three.js viewer and file importers |
| `src/main.js`, `src/worker.js` | UI and Web Worker |
| `public/data/` | trial site, corpus evidence bundle |
| `public/models/` | trained keyword models and training rows (for on-device calibration) |
| `scripts/` | site builder, model training |
| `research/` | research write-up and corpus pipeline |
| `test/` | engine tests |

## Status and limits

This is **stage 1**: a deterministic regression over a literature + POUH prior. The scores
are evidence-based estimates, not measured happiness, until survey data is added. UTCI and
wind are screening models. The default site uses real streets with a procedural building
fabric. See RESEARCH.md § 8 before citing any numbers.

Street data © OpenStreetMap contributors (ODbL).
