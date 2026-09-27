// Web Worker: all heavy computation (raster, metrics, optimisation, model
// training) runs here so the UI and 3D view stay responsive on phones.

import { prepare, evaluateGenome, findOpenSpaces } from './engine/pipeline.js';
import { buildGrid } from './engine/raster.js';
import { optimize } from './engine/optimizer.js';
import { explain, trainAll, parseSurveyCSV } from './engine/model.js';
import { explainPrior } from './engine/keywords.js';

let site = null;
let model = null;
let trainingRows = null;
let ctx = null;

const post = (type, data) => self.postMessage({ type, ...data });

function strip(ev) {
  // Send only what the UI needs (no raster arrays).
  return {
    design: ev.design,
    agg: ev.agg,
    scores: ev.scores,
    compliance: ev.compliance,
    points: ev.points.map((p) => ({ x: p.x, y: p.y, m: p.m })),
  };
}

function proof(ev, keywords) {
  const out = {};
  for (const k of keywords) {
    out[k] = { prior: explainPrior(k, ev.agg), model: model ? explain(model, k, ev.agg) : null };
  }
  return out;
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      site = msg.site;
      model = msg.model || model;
      trainingRows = msg.trainingRows || trainingRows;
      let openSpaces = site.openSpaces;
      if (!openSpaces || !openSpaces.length) {
        openSpaces = findOpenSpaces(buildGrid(site, 2));
        site.openSpaces = openSpaces;
      }
      post('ready', { openSpaces });
    } else if (msg.type === 'baseline') {
      ctx = prepare(site, { zones: msg.zones, buildings: msg.buildings, comboLock: msg.comboLock || null });
      const zero = new Array(ctx.nGenes).fill(0);
      const ev = evaluateGenome(ctx, zero, model, { stride: 1, rays: 64 });
      post('baseline', { result: strip(ev), proof: proof(ev, msg.keywords) });
    } else if (msg.type === 'optimize') {
      ctx = prepare(site, { zones: msg.zones, buildings: msg.buildings, comboLock: msg.comboLock || null, seed: msg.seed });
      const t0 = performance.now();
      const res = optimize(ctx, model, msg.prefs, {
        seed: msg.seed,
        population: msg.population,
        generations: msg.generations,
        onProgress: (p) => post('progress', { gen: p.gen, generations: p.generations, best: p.best.fitness }),
      });
      // Re-evaluate baseline + variants at full resolution for the proof panel.
      const keys = Object.keys(msg.prefs);
      const base = evaluateGenome(ctx, new Array(ctx.nGenes).fill(0), model, { stride: 1, rays: 64 });
      const variants = res.variants.map((v) => {
        const ev = evaluateGenome(ctx, v.genome, model, { stride: 1, rays: 64 });
        return { ...strip(ev), genome: v.genome, fitness: v.fitness, proof: proof(ev, keys) };
      });
      post('result', {
        baseline: { ...strip(base), proof: proof(base, keys) },
        variants,
        history: res.history,
        evaluations: res.evaluations,
        ms: performance.now() - t0,
      });
    } else if (msg.type === 'calibrate') {
      const survey = parseSurveyCSV(msg.csv);
      if (!survey.length) throw new Error('No complete rows found: the CSV needs every feature column plus at least one keyword column.');
      model = trainAll(trainingRows, { survey, surveyWeight: msg.weight || 5 });
      post('calibrated', { model, nSurvey: survey.length });
    }
  } catch (err) {
    post('error', { message: err.message, stack: err.stack });
  }
};
