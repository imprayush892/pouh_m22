// Measure the physical condition of study sites from the literature corpus
// and turn each (paper, site) into a data vector.
//
// Inputs (produced by research/scripts/fetch_study_sites.py):
//   research/sites/sites.jsonl   {key, lat, lon, name, city, country, level, type, papers:[ids], display}
//   research/sites/raw/<key>.json  Overpass JSON within 200 m
// Outputs:
//   research/sites/site_metrics.jsonl   per site: 21 engine parameters (mean, p25, median, p75) + OSM data quality
//   research/sites/study_vectors.jsonl  per (paper, site): metrics + that paper's findings/methods/outcomes
//   research/sites/lexicon_check.json   per keyword × parameter: measured values at sites whose papers
//                                       found the keyword's outcome, vs the lexicon's full-score range
// usage: node scripts/study-sites.js [dir=research/sites]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { siteFromOverpass } from '../src/engine/osm.js';
import { buildGrid, CLS } from '../src/engine/raster.js';
import { pointMetrics, samplePoints, FEATURE_KEYS, CLIMATE, sunPosition } from '../src/engine/metrics.js';
import { KEYWORDS } from '../src/engine/keywords.js';

const dir = process.argv[2] || 'research/sites';
const read = (f) => readFileSync(`${dir}/${f}`, 'utf8');
const jsonl = (s) => s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sites = jsonl(read('sites.jsonl'));
const ext = new Map(jsonl(readFileSync('research/corpus/extractions.jsonl', 'utf8')).map((r) => [r.id, r]));

const OUTCOME_TO_KEYWORDS = {
  happiness: ['happy'], wellbeing_mental_health: ['happy', 'restorative'], stress: ['restorative', 'calm'], safety: ['safe'],
  liveliness_vitality: ['lively'], restorativeness: ['restorative'], thermal_comfort: ['comfortable'], wind_comfort: ['comfortable'],
  acoustic_pleasantness: ['calm'], beauty_aesthetic: ['happy', 'legible'], preference: ['happy'], enclosure_perception: ['intimate'],
  spaciousness: ['spacious'], walkability_walking: ['active', 'lively'], social_interaction: ['sociable'],
  stationary_activity_use: ['sociable', 'lively'], physical_activity: ['active'], place_attachment: ['happy', 'legible'],
  wayfinding_legibility: ['legible'], crowding: ['spacious', 'calm'],
};

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const round = (v, d = 3) => (v === null || v === undefined ? v : +v.toFixed(d));

// Each site keeps its own latitude for the sun path; climate otherwise fixed.
function measureSite(meta) {
  const raw = `${dir}/raw/${meta.key}.json`;
  if (!existsSync(raw)) return null;
  const site = siteFromOverpass(JSON.parse(readFileSync(raw, 'utf8')), { lat: meta.lat, lon: meta.lon, radius: 200, name: meta.name });
  const g = buildGrid(site, 2);
  // Sample open cells within 60 m of the geocoded point.
  const mask = new Uint8Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.x0 + (i + 0.5) * g.cell, y = g.y0 + (j + 0.5) * g.cell;
    if (x * x + y * y <= 60 * 60) mask[j * g.nx + i] = 1;
  }
  // Same design day for every site (pre-summer, 21 April; 21 October south of
  // the equator) and the same air temperature, so the measured differences
  // are those of form, not of local climate.
  const climate = { ...CLIMATE, lat: meta.lat, day: meta.lat < 0 ? CLIMATE.day + 183 : CLIMATE.day };
  const sun = climate.hours.map((h) => sunPosition(meta.lat, climate.day, h));
  const pts = samplePoints(g, mask, 2);
  if (pts.length < 5) return { key: meta.key, skipped: 'fewer than 5 open sample points', quality: site.quality };
  const per = pts.map((p) => pointMetrics(g, p.x, p.y, { rays: 48, climate, sun }));
  const stats = {};
  for (const k of FEATURE_KEYS) {
    const v = per.map((m) => m[k]);
    stats[k] = { mean: round(v.reduce((a, b) => a + b, 0) / v.length), p25: round(q(v, 0.25)), median: round(q(v, 0.5)), p75: round(q(v, 0.75)) };
  }
  let openCells = 0;
  for (let k = 0; k < mask.length; k++) if (mask[k] && g.cls[k] !== CLS.BUILDING) openCells++;
  // OSM completeness gate: sparse mapping makes a dense place look open.
  let c100 = 0, b100 = 0;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.x0 + (i + 0.5) * g.cell, y = g.y0 + (j + 0.5) * g.cell;
    if (x * x + y * y > 100 * 100) continue;
    c100++;
    if (g.cls[j * g.nx + i] === CLS.BUILDING) b100++;
  }
  const coverage100 = b100 / (c100 || 1);
  const nb = site.quality.buildings;
  const grade = nb >= 40 && coverage100 >= 0.15 ? 'good' : nb >= 15 && coverage100 >= 0.08 ? 'fair' : 'poor';
  return {
    key: meta.key, points: pts.length, stats,
    quality: { ...site.quality, openShare: round(openCells / mask.reduce((a, b) => a + b, 0)), coverage100: round(coverage100), grade },
  };
}

const metrics = [];
const vectors = [];
let n = 0;
for (const meta of sites) {
  const m = measureSite(meta);
  n++;
  if (n % 20 === 0) console.log(`measured ${n}/${sites.length}`);
  if (!m) continue;
  metrics.push({ ...meta, ...m });
  if (m.skipped) continue;
  for (const pid of meta.papers) {
    const r = ext.get(pid) || {};
    vectors.push({
      paper: pid, site: meta.key, name: meta.name, city: meta.city, country: meta.country, level: meta.level, type: meta.type,
      lat: meta.lat, lon: meta.lon,
      x: FEATURE_KEYS.map((k) => m.stats[k].median),
      methods: r.methods || [], outcomes: r.outcomes || [],
      findings: (r.findings || []).filter((f) => f && f.parameter).map((f) => ({ p: f.parameter, o: f.outcome, d: f.direction, low: f.low, high: f.high, unit: f.unit })),
      quality: m.quality,
    });
  }
}
writeFileSync(`${dir}/site_metrics.jsonl`, metrics.map((m) => JSON.stringify(m)).join('\n') + '\n');
writeFileSync(`${dir}/study_vectors.jsonl`, vectors.map((v) => JSON.stringify(v)).join('\n') + '\n');

// Lexicon check: where studies found a keyword's outcome (any direction
// reported), what physical condition did those sites have, and how often
// does it fall inside the lexicon's full-score range?
const check = {};
for (const [kw, def] of Object.entries(KEYWORDS)) {
  // Only sites whose OSM mapping passes the completeness gate.
  const vs = vectors.filter((v) => v.quality.grade !== 'poor' && v.outcomes.some((o) => (OUTCOME_TO_KEYWORDS[o] || []).includes(kw)));
  check[kw] = { sites: vs.length, terms: [] };
  for (const t of def.terms) {
    const i = FEATURE_KEYS.indexOf(t.f);
    const vals = vs.map((v) => v.x[i]).filter((x) => Number.isFinite(x));
    if (!vals.length) continue;
    const [a, b, c, d] = t.t;
    check[kw].terms.push({
      f: t.f, target: t.t,
      measured: { n: vals.length, p10: round(q(vals, 0.1)), p25: round(q(vals, 0.25)), median: round(q(vals, 0.5)), p75: round(q(vals, 0.75)), p90: round(q(vals, 0.9)) },
      insideCore: round(vals.filter((x) => x >= b && x <= c).length / vals.length),
      insideSupport: round(vals.filter((x) => x >= a && x <= d).length / vals.length),
    });
  }
}
writeFileSync(`${dir}/lexicon_check.json`, JSON.stringify(check, null, 1));
const grades = {};
for (const m of metrics) if (m.quality?.grade) grades[m.quality.grade] = (grades[m.quality.grade] || 0) + 1;
console.log(`sites measured: ${metrics.filter((m) => !m.skipped).length}/${sites.length}; OSM quality ${JSON.stringify(grades)}; vectors: ${vectors.length}`);
for (const [kw, c] of Object.entries(check)) {
  if (!c.sites) continue;
  console.log(kw.padEnd(12), `${c.sites} sites`, c.terms.slice(0, 6).map((t) => `${t.f} med ${t.measured.median} in-core ${Math.round(t.insideCore * 100)}%`).join(' | '));
}
