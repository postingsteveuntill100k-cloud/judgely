import { cpSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// schema.sql must sit next to the compiled db module so the driver can find it.
const root = process.cwd();
const pairs = [
  ['src/server/db/schema.sql', 'dist/server/db/schema.sql'],
];
for (const [from, to] of pairs) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(src)) {
    cpSync(src, dest);
    process.stdout.write(`copied ${from} -> ${to}\n`);
  }
}
