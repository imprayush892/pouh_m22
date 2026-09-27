// Build helper: turn dist/index.html into dist/urbanlm-lite.html, an entry
// page without <html>/<head>/<body> wrappers (for hosts that supply their
// own document skeleton, e.g. a claude.ai Artifact). Run after `vite build`.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const assets = [...head.matchAll(/<(link rel="stylesheet"[^>]*|script type="module"[^>]*)>(<\/script>)?/g)].map((m) => m[0]);
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(new URL('../dist/urbanlm-lite.html', import.meta.url), `${title}\n${assets.join('\n')}\n${body}`);
console.log('dist/urbanlm-lite.html', assets.length, 'assets');
