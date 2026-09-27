// Deterministic gradient-boosted regression trees (squared loss) with
// histogram split finding (quantile bins per feature, as in LightGBM/XGBoost
// "hist"). Small, dependency-free and JSON-serialisable so a trained model
// ships with the app and trains or re-calibrates on a phone. No randomness:
// identical inputs → identical model.

function quantileBins(X, f, nBins) {
  const vals = X.map((r) => r[f]).sort((a, b) => a - b);
  const edges = [];
  for (let b = 1; b < nBins; b++) {
    const v = vals[Math.floor((b * vals.length) / nBins)];
    if (!edges.length || v > edges[edges.length - 1]) edges.push(v);
  }
  return edges; // bin i covers (edges[i-1], edges[i]]
}

function binIndex(edges, v) {
  let lo = 0, hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v <= edges[mid]) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function buildTree(B, edges, r, w, idxs, depth, opts) {
  let sw = 0, sr = 0;
  for (const i of idxs) { sw += w[i]; sr += w[i] * r[i]; }
  const mean = sw ? sr / sw : 0;
  const n = idxs.length;
  if (depth >= opts.maxDepth || n < 2 * opts.minLeaf) return { v: mean * opts.lr, n };

  let best = null;
  const nf = edges.length;
  for (let f = 0; f < nf; f++) {
    const nb = edges[f].length + 1;
    const hw = new Float64Array(nb), hr = new Float64Array(nb), hc = new Int32Array(nb);
    for (const i of idxs) { const b = B[i][f]; hw[b] += w[i]; hr[b] += w[i] * r[i]; hc[b]++; }
    let lw = 0, lr = 0, lc = 0;
    for (let b = 0; b < nb - 1; b++) {
      lw += hw[b]; lr += hr[b]; lc += hc[b];
      if (lc < opts.minLeaf || n - lc < opts.minLeaf || lw <= 0 || sw - lw <= 0) continue;
      const rw = sw - lw, rr = sr - lr;
      const gain = (lr * lr) / lw + (rr * rr) / rw - (sr * sr) / sw;
      if (!best || gain > best.gain + 1e-12) best = { gain, f, b };
    }
  }
  if (!best || best.gain <= 1e-9) return { v: mean * opts.lr, n };
  const L = [], R = [];
  for (const i of idxs) (B[i][best.f] <= best.b ? L : R).push(i);
  return {
    f: best.f,
    t: edges[best.f][best.b], // x <= t goes left
    g: best.gain,
    n,
    l: buildTree(B, edges, r, w, L, depth + 1, opts),
    r: buildTree(B, edges, r, w, R, depth + 1, opts),
  };
}

// X: array of feature arrays, y: targets, weights optional (survey rows can
// be up-weighted against literature-prior rows).
export function trainGBT(X, y, options = {}, weights = null) {
  const opts = { nTrees: 90, maxDepth: 4, lr: 0.12, minLeaf: 10, nBins: 32, ...options };
  const n = y.length;
  const w = weights || new Float64Array(n).fill(1);
  const nf = X[0].length;
  const edges = Array.from({ length: nf }, (_, f) => quantileBins(X, f, opts.nBins));
  const B = X.map((row) => row.map((v, f) => binIndex(edges[f], v)));
  let sw = 0, sy = 0;
  for (let i = 0; i < n; i++) { sw += w[i]; sy += w[i] * y[i]; }
  const base = sy / sw;
  const pred = new Float64Array(n).fill(base);
  const trees = [];
  const all = Array.from({ length: n }, (_, i) => i);
  const r = new Float64Array(n);
  for (let t = 0; t < opts.nTrees; t++) {
    for (let i = 0; i < n; i++) r[i] = y[i] - pred[i];
    const tree = buildTree(B, edges, r, w, all, 0, opts);
    trees.push(tree);
    for (let i = 0; i < n; i++) pred[i] += evalTree(tree, X[i]);
  }
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) { sse += w[i] * (y[i] - pred[i]) ** 2; sst += w[i] * (y[i] - base) ** 2; }
  return { base, trees, nFeatures: nf, r2: 1 - sse / (sst || 1), rmse: Math.sqrt(sse / sw) };
}

export function evalTree(node, x) {
  while (node.v === undefined) node = x[node.f] <= node.t ? node.l : node.r;
  return node.v;
}

export function predictGBT(model, x) {
  let s = model.base;
  for (const t of model.trees) s += evalTree(t, x);
  return s;
}

// Saabas path attribution: exact, deterministic per-feature contributions that
// sum to (prediction - bias), bias = expected value over the training set.
function nodeMean(node) {
  if (node.v !== undefined) return node.v;
  if (node._m === undefined) node._m = (nodeMean(node.l) * node.l.n + nodeMean(node.r) * node.r.n) / (node.l.n + node.r.n);
  return node._m;
}

export function contributionsGBT(model, x) {
  const c = new Float64Array(model.nFeatures);
  let bias = model.base;
  for (const tree of model.trees) {
    let node = tree;
    let prev = nodeMean(node);
    bias += prev;
    while (node.v === undefined) {
      const f = node.f;
      node = x[f] <= node.t ? node.l : node.r;
      const m = nodeMean(node);
      c[f] += m - prev;
      prev = m;
    }
  }
  return { bias, contributions: Array.from(c) };
}

export function featureImportance(model) {
  const imp = new Float64Array(model.nFeatures);
  const walk = (n) => { if (n.v !== undefined) return; imp[n.f] += n.g; walk(n.l); walk(n.r); };
  model.trees.forEach(walk);
  const s = imp.reduce((a, b) => a + b, 0) || 1;
  return Array.from(imp, (v) => v / s);
}

// Strip training-only caches before serialising.
export function compactModel(model) {
  const strip = (n) => (n.v !== undefined
    ? { v: +n.v.toFixed(5), n: n.n }
    : { f: n.f, t: +n.t.toPrecision(6), g: +n.g.toPrecision(4), n: n.n, l: strip(n.l), r: strip(n.r) });
  return { ...model, trees: model.trees.map(strip), r2: +model.r2.toFixed(4), rmse: +model.rmse.toFixed(3) };
}
