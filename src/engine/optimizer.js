// Heuristic simulation: seeded genetic algorithm over generator genomes.
// Objective: match the user's keyword intensities (not just maximise them),
// with a small Occam penalty for bigger interventions and a POUH-compliance
// bonus. Deterministic for a given seed.

import { mulberry32, gaussian } from './rng.js';
import { evaluateGenome } from './pipeline.js';
import { designCost } from './generator.js';

export function objective(scores, prefs, compliance, design, { complianceWeight = 8, costWeight = 0.4 } = {}) {
  let se = 0, w = 0;
  for (const [k, target] of Object.entries(prefs)) {
    const s = scores[k]?.predicted ?? 0;
    se += (s - target) ** 2;
    w += 1;
  }
  const rmse = w ? Math.sqrt(se / w) : 0;
  const comp = compliance ? compliance.score : 0;
  return 100 - rmse + complianceWeight * comp - costWeight * designCost(design);
}

export function optimize(ctx, model, prefs, { population = 20, generations = 14, seed = 42, elite = 2, mutation = 0.18, onProgress, evalOpts = { stride: 2, rays: 40 } } = {}) {
  const rand = mulberry32(seed);
  const n = ctx.nGenes;
  const cache = new Map();
  const evaluate = (g) => {
    const key = g.map((v) => v.toFixed(3)).join(',');
    if (cache.has(key)) return cache.get(key);
    const ev = evaluateGenome(ctx, g, model, evalOpts);
    const fit = objective(ev.scores, prefs, ev.compliance, ev.design);
    const res = { genome: g, fitness: fit, scores: ev.scores, agg: ev.agg, combo: ev.design.combo };
    cache.set(key, res);
    return res;
  };

  // Seed population: baseline-ish, one per POUH combination, rest random.
  let pop = [];
  for (let i = 0; i < population; i++) {
    const g = Array.from({ length: n }, () => rand());
    if (i < 3 && !ctx.comboLock) g[0] = (i + 0.5) / 3;
    for (let z = 0; z < ctx.zones.length && i < 3; z++) g[1 + z * 10] = 0.9; // use zones
    pop.push(evaluate(g));
  }
  const history = [];
  for (let gen = 0; gen < generations; gen++) {
    pop.sort((a, b) => b.fitness - a.fitness || a.genome[0] - b.genome[0]);
    history.push({ gen, best: pop[0].fitness, mean: pop.reduce((s, p) => s + p.fitness, 0) / pop.length });
    onProgress?.({ gen: gen + 1, generations, best: pop[0] });
    const next = pop.slice(0, elite);
    const tournament = () => {
      const a = pop[Math.floor(rand() * pop.length)], b = pop[Math.floor(rand() * pop.length)];
      return a.fitness >= b.fitness ? a : b;
    };
    while (next.length < population) {
      const p1 = tournament(), p2 = tournament();
      const child = p1.genome.map((v, i) => (rand() < 0.5 ? v : p2.genome[i]));
      for (let i = 0; i < n; i++) {
        if (rand() < mutation) child[i] = Math.min(1, Math.max(0, child[i] + 0.25 * gaussian(rand)));
      }
      next.push(evaluate(child));
    }
    pop = next;
  }
  pop.sort((a, b) => b.fitness - a.fitness);
  // Distinct variants: best design per POUH combination first (they are
  // qualitatively different strategies), then the next-best distinct genomes.
  const ranked = [...cache.values()].sort((a, b) => b.fitness - a.fitness);
  const variants = [];
  for (const p of ranked) {
    if (!variants.some((v) => v.combo === p.combo)) variants.push(p);
  }
  for (const p of ranked) {
    if (variants.length >= 3) break;
    if (!variants.some((v) => v === p || dist(v.genome, p.genome) < 1.5)) variants.push(p);
  }
  variants.sort((a, b) => b.fitness - a.fitness);
  variants.length = Math.min(variants.length, 3);
  return { best: pop[0], variants, history, evaluations: cache.size };
}

function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}
