export function centerActionAllowed(user, method, path) {
  if (!user) return false;
  if (user.role === 'SISTEMAS') return true;
  if (method === 'POST' && /^\/api\/rrweb\/(session\/(start|end)|events)$/.test(path)) return true;
  if (method === 'GET' && ['/api/store', '/api/configuration/permissions/store'].includes(path)) return true;
  if (path === '/api/reports/informe-rendimiento') return ['OPERACIONES', 'FIELDLEADER'].includes(user.role);
  return false;
}

export function authorizeCenterAction(req, res, next) {
  if (centerActionAllowed(req.user, req.method, req.path)) return next();
  res.status(403).json({ message: 'No tiene permiso para realizar esta accion.' });
}
