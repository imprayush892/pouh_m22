// The regression layer: one gradient-boosted tree ensemble per qualitative
// keyword, mapping the quantitative feature vector → 0–100 keyword score.
//
// Stage 1 (now): trees are fitted to the literature + POUH prior evaluated on
// feature vectors sampled from many generated designs ("teacher → student").
// This gives a smooth, explainable, fast surrogate and fixes the data
// pipeline. Stage 2: `calibrate()` mixes in real survey rows (feature vector +
// perceived rating) so field data progressively overrides the prior.
// Stage 3 (roadmap): probabilistic model (quantile trees / Bayesian) + ABM.

import { trainGBT, compactModel, contributionsGBT, featureImportance, predictGBT } from './gbt.js';
import { KEYWORD_KEYS, priorScore } from './keywords.js';
import { FEATURES, FEATURE_KEYS, toVector } from './metrics.js';
import { mulberry32 } from './rng.js';
import { prepare, evaluateGenome } from './pipeline.js';

// Draw training samples from random designs over random zones of a site.
export function sampleTrainingData(site, { designs = 120, zonesPerDesign = 2, seed = 7, perPoint = 6, uniform = 2500, onProgress } = {}) {
  const rand = mulberry32(seed);
  const cands = (site.openSpaces || []).filter((o) => o.area >= 60);
  const rows = [];
  for (let d = 0; d < designs; d++) {
    const zones = [];
    for (let z = 0; z < zonesPerDesign && cands.length; z++) zones.push(cands[Math.floor(rand() * cands.length)]);
    const near = nearbyBuildings(site, zones, 12);
    const buildings = near.filter(() => rand() < 0.5).slice(0, 8);
    const ctx = prepare(site, { zones, buildings, seed: d });
    const genome = Array.from({ length: ctx.nGenes }, () => rand());
    if (d % 4 === 0) genome[1] = 0.1; // include untouched baselines
    const ev = evaluateGenome(ctx, genome, null, { stride: 2, rays: 32 });
    rows.push(toVector(ev.agg)); // zone-aggregated sample
    // plus a few individual points for local variety
    for (let i = 0; i < perPoint && ev.points.length; i++) rows.push(toVector(ev.points[Math.floor(rand() * ev.points.length)].m));
    onProgress?.(d + 1, designs);
  }
  // Space-filling samples over each feature's documented range, so the trees
  // are defined for open/sunny conditions the dense trial site never shows.
  // Sparse features are zero-inflated as they are on real sites; otherwise the
  // trees learn "feature == 0" as a proxy for "came from the site sample".
  const ZERO_INFLATED = { waterView: 0.6, seating: 0.35, activeFrontage: 0.3, gvi: 0.25 };
  for (let i = 0; i < uniform; i++) {
    rows.push(FEATURES.map((f) => (rand() < (ZERO_INFLATED[f.key] || 0) ? 0 : f.range[0] + rand() * (f.range[1] - f.range[0]))));
  }
  return rows;
}

export function nearbyBuildings(site, zones, dist) {
  const out = [];
  site.buildings.forEach((b, i) => {
    const [x, y] = b.footprint[0];
    for (const z of zones) {
      for (const [px, py] of z.polygon) if (Math.hypot(px - x, py - y) < dist) { out.push(i); return; }
    }
  });
  return out;
}

const vecToRecord = (v) => Object.fromEntries(FEATURE_KEYS.map((k, i) => [k, v[i]]));

export function trainAll(rows, { survey = [], surveyWeight = 5, options } = {}) {
  const models = {};
  for (const k of KEYWORD_KEYS) {
    const X = [], y = [], w = [];
    for (const v of rows) { X.push(v); y.push(priorScore(k, vecToRecord(v))); w.push(1); }
    for (const s of survey) if (s.ratings[k] !== undefined) { X.push(s.x); y.push(s.ratings[k]); w.push(surveyWeight); }
    models[k] = compactModel(trainGBT(X, y, options, Float64Array.from(w)));
  }
  return { version: 1, features: FEATURE_KEYS, keywords: models, nPrior: rows.length, nSurvey: survey.length };
}

export function predict(model, agg) {
  const x = toVector(agg);
  const out = {};
  for (const k of KEYWORD_KEYS) {
    const m = model.keywords[k];
    out[k] = Math.max(0, Math.min(100, predictGBT(m, x)));
  }
  return out;
}

export function explain(model, keyword, agg) {
  const m = model.keywords[keyword];
  const { bias, contributions } = contributionsGBT(m, toVector(agg));
  return {
    bias,
    items: FEATURE_KEYS.map((f, i) => ({ feature: f, value: agg[f], contribution: contributions[i] }))
      .filter((d) => Math.abs(d.contribution) > 0.05)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
  };
}

export function importances(model) {
  const out = {};
  for (const k of KEYWORD_KEYS) out[k] = featureImportance(model.keywords[k]);
  return out;
}

// Survey CSV: one row per observation; columns = any FEATURE_KEYS present +
// any keyword columns (0–100 or 1–5/1–7 Likert, auto-rescaled).
export function parseSurveyCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((s) => s.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((s) => s.trim());
    const rec = Object.fromEntries(head.map((h, i) => [h, Number(cols[i])]));
    const x = FEATURE_KEYS.map((f) => (Number.isFinite(rec[f]) ? rec[f] : NaN));
    if (x.some((v) => Number.isNaN(v))) continue; // need a full feature vector
    const ratings = {};
    for (const k of KEYWORD_KEYS) if (Number.isFinite(rec[k])) ratings[k] = rec[k];
    rows.push({ x, ratings });
  }
  // Rescale Likert columns to 0–100.
  for (const k of KEYWORD_KEYS) {
    const vals = rows.map((r) => r.ratings[k]).filter((v) => v !== undefined);
    if (!vals.length) continue;
    const max = Math.max(...vals), min = Math.min(...vals);
    if (max <= 7 && min >= 0) {
      const top = max <= 5 ? 5 : 7;
      for (const r of rows) if (r.ratings[k] !== undefined) r.ratings[k] = ((r.ratings[k] - 1) / (top - 1)) * 100;
    }
  }
  return rows;
}
