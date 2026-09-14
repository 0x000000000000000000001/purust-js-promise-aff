// Compile the unchanged upstream assertions and native bridge contracts from fresh TAST.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, globSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const tests = dirname(fileURLToPath(import.meta.url)), root = resolve(tests, '..');
const compiler = resolve(root, '../purust');
const packages = JSON.parse(readFileSync(join(compiler, 'spago.lock'))).packages;
const names = new Set();
function visitPackage(name) {
  if (names.has(name)) return;
  assert.ok(packages[name], name);
  names.add(name);
  packages[name].dependencies.forEach(visitPackage);
}
['aff', 'foreign', 'console', 'refs'].forEach(visitPackage);
const roots = [...names].map(name => {
  const native = resolve(root, `../purust-${name}/src`);
  return existsSync(native) ? native : join(compiler, `.spago/p/${name}-${packages[name].version}/src`);
});
roots.push(join(root, 'src'), resolve(root, '../purust-js-promise/src'), resolve(root, '../purust-assert/src'));
for (const path of roots) assert.ok(existsSync(path), path);
const fork = resolve(compiler, '../../purescript/.stack-work/dist');
const candidates = globSync('**/build/purs/purs', { cwd: fork });
const purs = process.env.PURS ?? (assert.equal(candidates.length, 1), join(fork, candidates[0]));
const directory = mkdtempSync(join(process.env.PURUST_PROMISE_KEEP_OUTPUT ?? tmpdir(), 'purust-promise-aff-'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const report = { complete: false, directory, bundleSha256: hash(join(compiler, 'bin/purust.js')), commands: [] };
const save = () => writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Promise/Aff fresh native diagnostic: ${directory}`);
function run(label, command, args, options = {}) {
  console.log(label);
  const start = Date.now();
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 180000,
    maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GHCRTS: '-N2', CARGO_BUILD_JOBS: '1',
      CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_DEV_INCREMENTAL: 'false' }, ...options });
  writeFileSync(join(directory, label + '.json'), JSON.stringify(result, null, 2) + '\n');
  report.commands.push({ label, command, args, status: result.status, signal: result.signal, elapsedMs: Date.now() - start });
  save();
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr.slice(-12000)}`);
  return result.stdout;
}
try {
  const index = new Map();
  for (const path of [join(tests, 'Main.purs'), join(tests, 'Native.purs'),
    ...roots.flatMap(path => globSync('**/*.purs', { cwd: path }).map(file => join(path, file)))]) {
    const source = readFileSync(path, 'utf8');
    const name = source.match(/^module\s+([A-Z][\w.]*)\s/m)?.[1];
    assert.ok(name && !index.has(name), `Duplicate or missing module: ${path}`);
    index.set(name, { path, depends: [...source.matchAll(/^import\s+([A-Z][\w.]*)\b/gm)].map(m => m[1]) });
  }
  const provisional = new Set();
  function select(name) {
    if (name === 'Prim' || name.startsWith('Prim.') || provisional.has(name)) return;
    assert.ok(index.has(name), name);
    provisional.add(name);
    index.get(name).depends.forEach(select);
  }
  select('Test.PromiseAff.Native');
  // purs graph validates the real closure; unrelated registry modules are not inputs.
  const graph = JSON.parse(run('graph', purs, ['graph', ...[...provisional].map(name => index.get(name).path)]));
  const selected = new Map();
  function visit(name) {
    if (name === 'Prim' || name.startsWith('Prim.') || selected.has(name)) return;
    assert.ok(graph[name], name);
    selected.set(name, resolve(directory, graph[name].path));
    graph[name].depends.forEach(visit);
  }
  visit('Test.PromiseAff.Native');
  report.sources = [...selected].map(([module, path]) => ({ module, path, sha256: hash(path) }));
  report.ffi = [...selected.values()].map(path => path.replace(/\.purs$/, '.rs')).filter(existsSync).map(path => ({ path, sha256: hash(path) }));
  const tast = join(directory, 'tast'), rust = join(directory, 'rust');
  run('tast', purs, ['compile', ...selected.values(), '--codegen', 'corefn', '--output', tast]);
  assert.ok(Array.isArray(JSON.parse(readFileSync(join(tast, 'Promise.Internal/corefn.json'))).typeTable));
  run('generate', process.execPath, ['--stack-size=65536', join(compiler, 'bin/purust.js'), '--source', tast,
    '--out', rust, '--main', 'Test.PromiseAff.Native', '--threaded']);
  run('build', 'cargo', ['build', '--offline', '--manifest-path', join(rust, 'Cargo.toml'), '-p', 'purust_output']);
  const stdout = run('execute', join(rust, 'target/debug/purust_output'), [], { timeout: 10000 });
  assert.ok(stdout.includes('Promise/Aff native bridge passed'));
  for (const { path, sha256 } of [...report.sources, ...report.ffi]) assert.equal(hash(path), sha256, path);
  assert.equal(hash(join(compiler, 'bin/purust.js')), report.bundleSha256);
  report.complete = true;
  console.log(`${selected.size} fresh TAST modules: original Promise.Aff assertions and native bridge passed.`);
} finally { save(); }
