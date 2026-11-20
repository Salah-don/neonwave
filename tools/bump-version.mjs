// Bumps the service-worker cache version (sw.js) and the app version (js/version.js) before a deploy.
// Usage: node tools/bump-version.mjs   — run automatically by the GitHub Actions workflow.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const d = new Date();
const stamp = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}`;

async function replace(file, re, value) {
  const url = new URL(file, root);
  const src = await readFile(url, 'utf8');
  if (!re.test(src)) throw new Error(`Version pattern not found in ${file}`);
  await writeFile(url, src.replace(re, value));
}

await replace('sw.js', /const VERSION = '[^']*'/, `const VERSION = '${stamp}'`);
await replace('js/version.js', /APP_VERSION = '[^']*'/, `APP_VERSION = '${stamp}'`);
process.stdout.write(`Version ${stamp}\n`);
