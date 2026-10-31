import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });
for (const file of ['manifest.json', 'sidepanel.html', 'panel.css', 'auth-result.html', 'LUCIDE-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) await copyFile(path.join(root, 'extension', file), path.join(out, file));
for (const size of [16,32,48,128]) await copyFile(path.join(root,'extension/icons',`icon-${size}.png`),path.join(out,`icon-${size}.png`));
await build({ absWorkingDir: root, entryPoints: ['extension/background.js', 'extension/sidepanel.js', 'extension/auth-result.js'],
  outdir: out, bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', legalComments: 'eof' });
await build({ absWorkingDir: root, entryPoints: ['extension/extract.js'], outfile: path.join(out, 'extract.js'), bundle: true,
  format: 'iife', globalName: 'FactLensExtractor', platform: 'browser', target: 'chrome120', footer: { js: 'FactLensExtractor.extractSafely();' }, legalComments: 'eof' });
console.log(`Built unpacked extension: ${out}`);
