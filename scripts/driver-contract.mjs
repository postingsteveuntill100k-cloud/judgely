/**
 * Does the Firestore driver actually implement the whole storage contract?
 *
 * The Firebase deployment is blocked by API access, not by missing code, so
 * this is the check that tells us whether turning the API on would be enough.
 * It compares the Driver interface in src/server/db/driver.ts with the methods
 * the Firestore class really defines.
 */
import { readFileSync } from 'node:fs';

const driver = readFileSync('src/server/db/driver.ts', 'utf8');
const firestore = readFileSync('src/server/db/firestore.ts', 'utf8');
const sqlite = readFileSync('src/server/db/sqlite.ts', 'utf8');

const body = driver.slice(driver.indexOf('export interface Driver'));
const required = [...body.matchAll(/^\s{2}(\w+)\s*\(/gm)].map((m) => m[1]);
const unique = [...new Set(required)].sort();

const methodsIn = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/^\s{2}(?:async\s+)?(\w+)\s*[<(]/gm)) names.add(m[1]);
  return names;
};

const fsMethods = methodsIn(firestore);
const sqMethods = methodsIn(sqlite);

let missing = 0;
let stubs = 0;
const rows = [];
for (const name of unique) {
  const hasFs = fsMethods.has(name);
  const hasSq = sqMethods.has(name);
  if (!hasFs) missing += 1;
  // Extract the method body by brace counting from its first occurrence, so
  // both one-liners and multi-line methods are read correctly.
  const start = firestore.search(new RegExp(`\\n  (?:async )?${name}\\b`));
  let body = '';
  let isStub = false;
  if (start === -1) {
    isStub = true;
  } else {
    const open = firestore.indexOf('{', start);
    let depth = 0;
    let i = open;
    for (; i < firestore.length; i += 1) {
      if (firestore[i] === '{') depth += 1;
      else if (firestore[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    body = firestore.slice(open, i + 1);
    // Strip comments and whitespace: an empty body, or one that only throws
    // "not implemented", is a stub.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
    isStub = code === '{}' || /^thrownewError\(["'`].{0,40}not[ ]?implemented/i.test(code);
  }
  if (isStub) stubs += 1;
  rows.push({ name, firestore: hasFs ? (isStub ? 'STUB' : 'ok') : 'MISSING', sqlite: hasSq ? 'ok' : 'MISSING' });
}

const bad = rows.filter((r) => r.firestore !== 'ok' || r.sqlite !== 'ok');
console.log(`Driver interface methods: ${unique.length}`);
console.log(`Firestore driver missing: ${missing}   stubs: ${stubs}`);
console.log(`SQLite driver issues:    ${rows.filter((r) => r.sqlite !== 'ok').length}`);
if (bad.length) {
  console.log('\nnot implemented:');
  for (const r of bad) console.log(`  ${r.name.padEnd(30)} firestore=${r.firestore} sqlite=${r.sqlite}`);
} else {
  console.log('\nBoth drivers implement every method the interface declares, with no stubs.');
}
process.exit(bad.length ? 1 : 0);
