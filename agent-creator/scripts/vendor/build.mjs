import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'templates', 'agent', 'vendor');
const NODE_MODULES = 'node_modules/';

const result = await build({
  entryPoints: [join(here, 'entry.ts')],
  outfile: join(outDir, 'deps.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  metafile: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

function packageNameOf(inputPath) {
  const rest = inputPath.slice(inputPath.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
  const parts = rest.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

const bundled = [...new Set(
  Object.keys(result.metafile.inputs).filter((p) => p.includes(NODE_MODULES)).map(packageNameOf),
)].sort();

const versions = {};
const licenses = [];
for (const name of bundled) {
  const dir = join(here, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  versions[name] = pkg.version;
  const licenseFile = readdirSync(dir).find((f) => /^licen[sc]e/i.test(f));
  const text = licenseFile && existsSync(join(dir, licenseFile))
    ? readFileSync(join(dir, licenseFile), 'utf8').trim()
    : `(套件未附授權檔，package.json 標示：${pkg.license ?? '未標示'})`;
  licenses.push(`${'='.repeat(70)}\n${name}@${pkg.version}  (${pkg.license ?? '未標示'})\n${'='.repeat(70)}\n${text}\n`);
}

writeFileSync(join(outDir, 'VERSIONS.json'), `${JSON.stringify(versions, null, 2)}\n`);
writeFileSync(join(outDir, 'THIRD_PARTY_LICENSES.txt'), licenses.join('\n'));
console.log(`deps.mjs 已產生，內含 ${bundled.length} 個套件`);
