import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { writeFile } from 'node:fs/promises';

const [store, output] = process.argv.slice(2);
const secret = process.env.INVENTORY_IMPORT_SECRET;
if (!store || !/^[a-z0-9_-]{1,32}$/i.test(store) || !output || !secret || secret.length < 64) {
  throw Error(
    'Configure INVENTORY_IMPORT_SECRET y use: node scripts/create-import-token.mjs SERIE archivo-local.txt',
  );
}
const token = jwt.sign({ kind: 'store-import', store }, secret, {
  algorithm: 'HS256',
  issuer: 'inventory-importer',
  audience: 'inventory-import',
  expiresIn: '24h',
});
// Never print credentials into logs. Refuse to overwrite an existing credential file.
await writeFile(output, token, { flag: 'wx', mode: 0o600 });
console.log(
  'Credencial temporal guardada. Configure el importador y elimine el archivo al terminar.',
);
