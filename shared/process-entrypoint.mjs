import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isProcessEntrypoint(moduleUrl, runtime = process) {
  const modulePath = fileURLToPath(moduleUrl);
  // PM2 fork mode uses its wrapper as argv[1] and supplies the actual entry here.
  return [runtime.argv[1], runtime.env.pm_exec_path].some(
    (entry) => typeof entry === 'string' && entry.length > 0 && resolve(entry) === modulePath,
  );
}
