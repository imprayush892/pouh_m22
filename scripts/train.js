// Offline training of the keyword tree models on the default site.
// usage: node scripts/train.js [designs=300]  → public/models/gbt.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { sampleTrainingData, trainAll, importances } from '../src/engine/model.js';
import { FEATURE_KEYS } from '../src/engine/metrics.js';

const designs = Number(process.argv[2] || 300);
const site = JSON.parse(readFileSync(new URL('../public/data/site-manek-chowk.json', import.meta.url)));
let t = performance.now();
const rows = sampleTrainingData(site, {
  designs,
  onProgress: (d, n) => { if (d % 50 === 0) console.log(`sampled ${d}/${n} designs`); },
});
console.log(`${rows.length} samples in ${((performance.now() - t) / 1000).toFixed(1)} s`);
t = performance.now();
const model = trainAll(rows);
console.log(`trained ${Object.keys(model.keywords).length} keyword models in ${((performance.now() - t) / 1000).toFixed(1)} s`);
const imp = importances(model);
for (const [k, m] of Object.entries(model.keywords)) {
  const top = imp[k].map((v, i) => [FEATURE_KEYS[i], v]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([f, v]) => `${f} ${(v * 100).toFixed(0)}%`).join(', ');
  console.log(`${k.padEnd(12)} R²=${m.r2.toFixed(3)} RMSE=${m.rmse.toFixed(2)}  top: ${top}`);
}
mkdirSync(new URL('../public/models/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/models/gbt.json', import.meta.url), JSON.stringify(model));
// Training rows ship too, so the app can re-train with survey data on-device.
writeFileSync(new URL('../public/models/training-rows.json', import.meta.url),
  JSON.stringify({ features: FEATURE_KEYS, rows: rows.map((r) => r.map((v) => +v.toPrecision(4))) }));
