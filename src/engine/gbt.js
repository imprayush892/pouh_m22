// Deterministic gradient-boosted regression trees (squared loss).
// Small, dependency-free and JSON-serialisable so a trained model ships with
// the app and runs on a phone. Split search is exact over sorted unique
// thresholds (quantile-capped), no randomness → identical models every run.

function buildTree(X, r, idxs, depth, opts) {
  const n = idxs.length;
  let mean = 0;
  for (const i of idxs) mean += r[i];
  mean /= n || 1;
  if (depth >= opts.maxDepth || n < 2 * opts.minLeaf) return { v: mean * opts.lr, n };

  let best = null;
  const nf = X[0].length;
  let total = 0;
  for (const i of idxs) total += r[i];
  for (let f = 0; f < nf; f++) {
    const sorted = idxs.slice().sort((a, b) => X[a][f] - X[b][f] || a - b);
    let left = 0;
    const stride = Math.max(1, Math.floor(n / opts.maxBins));
    for (let p = 0; p < n - 1; p++) {
      left += r[sorted[p]];
      const nl = p + 1;
      if (nl < opts.minLeaf || n - nl < opts.minLeaf) continue;
      const xa = X[sorted[p]][f], xb = X[sorted[p + 1]][f];
      if (xa === xb) continue;
      if (p % stride !== 0 && p !== n - 2) continue;
      const nr = n - nl;
      const right = total - left;
      const gain = (left * left) / nl + (right * right) / nr - (total * total) / n;
      if (!best || gain > best.gain + 1e-12) best = { gain, f, thr: (xa + xb) / 2 };
    }
  }
  if (!best || best.gain <= 1e-9) return { v: mean * opts.lr, n };
  const L = [], R = [];
  for (const i of idxs) (X[i][best.f] <= best.thr ? L : R).push(i);
  return {
    f: best.f,
    t: best.thr,
    g: best.gain,
    n,
    l: buildTree(X, r, L, depth + 1, opts),
    r: buildTree(X, r, R, depth + 1, opts),
  };
}

export function trainGBT(X, y, options = {}) {
  const opts = { nTrees: 80, maxDepth: 4, lr: 0.12, minLeaf: 8, maxBins: 64, ...options };
  const n = y.length;
  const base = y.reduce((s, v) => s + v, 0) / n;
  const pred = new Float64Array(n).fill(base);
  const trees = [];
  const all = Array.from({ length: n }, (_, i) => i);
  for (let t = 0; t < opts.nTrees; t++) {
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = y[i] - pred[i];
    const tree = buildTree(X, r, all, 0, opts);
    trees.push(tree);
    for (let i = 0; i < n; i++) pred[i] += evalTree(tree, X[i]);
  }
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) { sse += (y[i] - pred[i]) ** 2; sst += (y[i] - base) ** 2; }
  return { base, trees, nFeatures: X[0].length, r2: 1 - sse / (sst || 1), rmse: Math.sqrt(sse / n) };
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
// sum to (prediction - bias), bias = expected value over the training set. Used for the "why" panel next to SHAP-style bars.
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
      const m = node.v !== undefined ? node.v : nodeMean(node);
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
  const strip = (n) => (n.v !== undefined ? { v: +n.v.toFixed(5), n: n.n } : { f: n.f, t: +n.t.toFixed(5), g: +n.g.toFixed(3), n: n.n, l: strip(n.l), r: strip(n.r) });
  return { ...model, trees: model.trees.map(strip) };
}
