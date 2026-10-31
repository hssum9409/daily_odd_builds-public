import './verify-auth.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['extension', 'shared', 'scripts', 'tests']) for (const file of await readdir(directory)) {
  if (!/\.(mjs|js)$/.test(file)) continue;
  const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { encoding: 'utf8' });
  if (result.status) { console.error(result.stderr); process.exit(1); }
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.permissions.includes('webRequestBlocking')) throw new Error('Blocking webRequest is not supported');
if (!manifest.host_permissions.includes('<all_urls>') || manifest.permissions.includes('activeTab')) throw new Error('All-site access must not depend on temporary activeTab grants');
console.log('Syntax and manifest checks passed.');
