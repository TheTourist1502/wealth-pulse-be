// Syncs postman/WealthPulse.postman_collection.json with the Express routes.
// Adds missing endpoints, removes deleted ones, leaves hand-edited requests (bodies, tests) alone.
// ponytail: regex parse of the route files, relies on the `router.<method>('path', ...)` convention.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const collectionPath = join(root, 'postman/WealthPulse.postman_collection.json');
const read = (p) => readFileSync(join(root, p), 'utf8');
const METHOD = '(get|post|put|patch|delete)';

// { folder, method, path, name, auth }
const routes = [];

for (const m of read('src/app.ts').matchAll(new RegExp(`app\\.${METHOD}\\(\\s*'/api([^']*)'`, 'g'))) {
  routes.push({ folder: null, method: m[1].toUpperCase(), path: m[2], name: m[2].split('/').pop(), auth: false });
}

const index = read('src/routes/index.ts');
for (const [, prefix, varName] of index.matchAll(/router\.use\(\s*'([^']+)',\s*(\w+)\s*\)/g)) {
  const file = index.match(new RegExp(`import ${varName} from '@/(routes/[^']+)'`))?.[1];
  if (!file || !existsSync(join(root, `src/${file}.ts`))) continue;
  const folder = prefix.slice(1).replace(/^./, (c) => c.toUpperCase());
  for (const m of read(`src/${file}.ts`).matchAll(new RegExp(`router\\.${METHOD}\\(\\s*'([^']*)'([^;]*)\\)`, 'g'))) {
    const path = prefix + (m[2] === '/' ? '' : m[2]);
    const name = m[3].match(/(\w+)\s*$/)?.[1] ?? path;
    routes.push({ folder, method: m[1].toUpperCase(), path, name, auth: m[3].includes('authenticate') });
  }
}

const collection = JSON.parse(readFileSync(collectionPath, 'utf8'));
const key = (method, path) => `${method} ${path}`;
const wanted = new Set(routes.map((r) => key(r.method, r.path)));
const itemKey = (item) => {
  const url = item.request.url?.raw ?? item.request.url;
  return key(item.request.method, url.replace('{{baseUrl}}', '').split('?')[0]);
};

// Drop requests whose route no longer exists, then empty folders.
const prune = (items) =>
  items
    .map((i) => (i.item ? { ...i, item: prune(i.item) } : i))
    .filter((i) => (i.item ? i.item.length > 0 : wanted.has(itemKey(i))));
collection.item = prune(collection.item);

const existing = new Set();
const collect = (items) => items.forEach((i) => (i.item ? collect(i.item) : existing.add(itemKey(i))));
collect(collection.item);

const added = [];
for (const r of routes) {
  if (existing.has(key(r.method, r.path))) continue;
  const request = { method: r.method, url: `{{baseUrl}}${r.path}` };
  if (['POST', 'PUT', 'PATCH'].includes(r.method)) {
    request.header = [{ key: 'Content-Type', value: 'application/json' }];
    request.body = { mode: 'raw', raw: '{\n}' };
  }
  if (r.auth) request.description = 'Requires login (accessToken cookie). Run Auth > Login first.';
  const item = { name: r.name, request };

  let target = collection.item;
  if (r.folder) {
    let folder = collection.item.find((i) => i.item && i.name === r.folder);
    if (!folder) collection.item.push((folder = { name: r.folder, item: [] }));
    target = folder.item;
  }
  target.push(item);
  added.push(key(r.method, r.path));
}

writeFileSync(collectionPath, JSON.stringify(collection, null, 2) + '\n');
if (added.length) console.log(`postman: added ${added.join(', ')}`);
