import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const services = ['auth-service', 'inventory-service'];
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const localOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200', 'http://localhost:4700', 'http://127.0.0.1:4700', 'http://127.0.0.1:46344'];

function encodeValue(value, parse) {
  for (const candidate of [JSON.stringify(value), `'${value}'`, '`' + value + '`']) {
    if (parse('SETUP_VALUE=' + candidate).SETUP_VALUE === value) return candidate;
  }
  throw new Error('No se pudo conservar un valor de configuración. No se modificaron archivos.');
}

function setValues(text, values, parse) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const encoded = encodeValue(value, parse);
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const matches = lines.flatMap((line, index) => pattern.test(line) ? [index] : []);
    for (const index of matches) lines[index] = `${key}=${encoded}`;
    if (!matches.length) lines.push(`${key}=${encoded}`);
  }
  return lines.join(eol).replace(/(?:\r?\n)*$/, eol);
}

export async function configureLocalInventory(parse, root = defaultRoot) {
  const files = await Promise.all(services.map(async service => {
    const target = join(root, service, '.env');
    let text;
    try { text = await readFile(target, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; text = 'NODE_ENV=development\n'; }
    const values = parse(text);
    if (values.NODE_ENV === 'production') throw new Error(`No se modificó ${service}/.env: está marcado como producción.`);
    return { service, target, text, values };
  }));
  const keys = [...new Set(files.map(file => file.values.INVENTORY_JWT_SECRET).filter(value => value?.length >= 64))];
  if (keys.length > 1) throw new Error('Los servicios tienen claves válidas distintas. No se reemplazaron: revise la configuración compartida.');
  const secret = keys[0] || randomBytes(32).toString('hex');
  const prepared = files.map(file => {
    const origins = [...new Set([...(file.values.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean), ...localOrigins])];
    const updates = { INVENTORY_JWT_SECRET: secret, CORS_ORIGINS: origins.join(','), HOST: '127.0.0.1',
      PORT: file.service === 'auth-service' ? '3000' : '3001', DB_PORT: file.values.DB_PORT || '3306' };
    if (file.service === 'inventory-service' && (!file.values.INVENTORY_IMPORT_SECRET || file.values.INVENTORY_IMPORT_SECRET.length < 64)) updates.INVENTORY_IMPORT_SECRET = randomBytes(32).toString('hex');
    const content = setValues(file.text, updates, parse);
    const parsed = parse(content);
    for (const [key, value] of Object.entries(file.values)) {
      if (!Object.hasOwn(updates, key) && parsed[key] !== value) {
        throw new Error('La configuración no se puede reescribir sin alterar otros valores. No se modificaron archivos.');
      }
    }
    return { ...file, content };
  });
  for (const file of prepared) {
    await mkdir(join(root, file.service), { recursive: true });
    await writeFile(file.target + '.local-setup-tmp', file.content, { mode: 0o600 });
  }
  for (const file of prepared) await rename(file.target + '.local-setup-tmp', file.target);
  return services.map(service => ({ service, port: service === 'auth-service' ? 3000 : 3001 }));
}
