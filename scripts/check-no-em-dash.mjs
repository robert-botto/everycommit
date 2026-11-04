// Fails if the em dash character (U+2014) appears in any text file in the source, docs and workflows.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src', 'bin', 'widget', 'test', 'docs', '.github', 'README.md'];
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.ico', '.webp', '.avif', '.gif', '.woff', '.woff2']);
const EM_DASH = String.fromCharCode(0x2014);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) return [dir];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!BINARY.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.includes(EM_DASH)) hits.push(`${file}:${i + 1}`);
      });
  }
}

if (hits.length) {
  console.error(`Em dash (U+2014) found in ${hits.length} place(s):\n` + hits.join('\n'));
  process.exit(1);
}
console.log('No em dashes found.');
