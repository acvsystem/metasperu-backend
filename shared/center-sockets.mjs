function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(value => value.trim().split('=')).filter(pair => pair.length === 2));
}
export function secureCenterSockets(io, boundary, origins) {
  io.use(async (socket, next) => {
    try {
      if (!origins.accepts(socket.handshake.headers.origin)) throw new Error();
      const auth = socket.handshake.auth || {};
      const req = { headers: socket.handshake.headers, cookies: cookies(socket.handshake.headers.cookie) };
      const token = auth.token || req.headers.authorization?.replace(/^Bearer /, '') || req.cookies.center_session;
      const principal = auth.agentToken ? await boundary.agent(auth.agentToken) : await boundary.security.authenticate(token);
      socket.data.principal = principal;
      socket.data.principalKind = auth.agentToken ? 'agent' : 'user';
      socket.data.sessionToken = undefined;
      // Revalidate a human's lease; a logout or removed permission closes stale connections.
      const lease = setInterval(async () => {
        try {
          const refreshed = auth.agentToken ? await boundary.agent(auth.agentToken) : await boundary.security.authenticate(token);
          if (identityScope(refreshed) !== identityScope(socket.data.principal)) { socket.emit('session_expired'); return socket.disconnect(true); }
          socket.data.principal = refreshed;
        } catch { socket.emit('session_expired');socket.disconnect(true); }
      }, 30000);
      lease.unref?.();
      socket.once('disconnect', () => clearInterval(lease));
      let received = 0, windowStarted = Date.now();
      socket.use(async ([event, payload], done) => {
        if (Date.now() - windowStarted > 60000) { received = 0; windowStarted = Date.now(); }
        if (++received > 600) return done(new Error('Demasiados eventos.'));
        if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) return done(new Error('Datos invalidos.'));
        const identity = socket.data.principal;
        const human = socket.data.principalKind === 'user';
        const serverEvent = event === 'registrar_servidor' || event.startsWith('py_register_server') ||
          ['py_response_documents_server','py_status_server_backup','py_response_comparation_documents_server','py_response_documents_pending_server'].includes(event);
        if ((human && event !== 'registrar_dashboard') || (!human && event === 'registrar_dashboard') ||
            (!human && serverEvent && identity.kind !== 'backup')) return done(new Error('Evento no autorizado.'));
        const registration = ['tienda_identificarse','py_register_store'].includes(event);
        if (registration && identity.kind !== 'store') return done(new Error('Dispositivo no autorizado.'));
        if (!human && identity.kind === 'store' && payload && typeof payload === 'object') {
          const claimed = registration ? (payload.id_tienda ?? payload.id) : payload.serie;
          if (claimed && String(claimed) !== identity.store) return done(new Error('Tienda no autorizada.'));
          payload.serie = identity.store;
          if (registration) { payload.id_tienda = identity.store; payload.id = identity.store; }
        }
        if (!human && payload) {
          for (const key of ['pedido_por','enviar_a','socketId','socket']) {
            if (!payload[key]) continue;
            if ((event==='py_response_informe_rendimiento'&&payload[key]==='CRONREPORTE01')||
                (event==='py_response_exchange_rate'&&payload[key]==='cron_accounting')) continue;
            let target=io.sockets.sockets.get(payload[key]);
            if(!target&&typeof payload[key]==='string') {
              try { [target]=await io.in(payload[key]).fetchSockets(); } catch { return done(new Error('Destinatario no disponible.')); }
            }
            const store=identity.kind==='store'?identity.store:payload.serie;
            if (!target || target.id!==payload[key] || target.data.principalKind!=='user' ||
                !(store ? boundary.security.canAccessStore(target.data.principal,store) : target.data.principal?.allStores)) {
              return done(new Error('Destinatario no autorizado.'));
            }
          }
        }
        done();
      });
      next();
    } catch { next(new Error('No se pudo autenticar la conexion.')); }
  });
  // Run before the legacy connection callbacks; room membership derives from identity.
  io.on('connection', socket => {
    const principal = socket.data.principal;
    const human = socket.data.principalKind === 'user';
    const join = socket.join.bind(socket);
    const allowed = new Set(human
      ? ['dashboards', `user:${principal.id}`, ...(principal.allStores ? ['dashboards:all'] : []), ...principal.stores.map(store => `dashboard:store:${store}`)]
      : principal.kind === 'store' ? ['grupo_tiendas', principal.store, principal.brand].filter(Boolean) : ['servidor_backup','servidor_ejb','servidor_access_checkinout']);
    socket.join = room => join((Array.isArray(room) ? room : [room]).filter(value => allowed.has(value)));
    if (human) void socket.join([...allowed]);
    const on = socket.on.bind(socket);
    socket.on = (event, listener) => on(event, (...args) => {
      const failed = () => socket.emit('operation_error', { message: 'No se pudo procesar la respuesta del dispositivo.' });
      try { const pending = listener(...args); pending?.catch?.(failed); } catch { failed(); }
    });
    socket.on('error', () => { /* Invalid events are rejected without exposing payloads. */ });
  });
}

export function identityScope(principal) {
  return JSON.stringify({ id:principal.id, role:principal.role, allStores:principal.allStores,
    stores:[...(principal.stores || [])].sort(), kind:principal.kind, store:principal.store, brand:principal.brand });
}

export function emitScoped(io, event, payload) {
  void io.in('dashboards').fetchSockets().then(sockets => {
    for (const socket of sockets) {
      const user = socket.data.principal;
      if (!user) continue;
      if (user.allStores) { io.to(socket.id).emit(event, payload); continue; }
      if (Array.isArray(payload)) {
        io.to(socket.id).emit(event, payload.filter(row => user.stores.includes(String(row.serie ?? row.id_tienda))));
      } else if (payload?.serie && user.stores.includes(String(payload.serie))) {
        io.to(socket.id).emit(event, payload);
      }
    }
  }).catch(() => console.error(JSON.stringify({ event: 'socket.delivery.failed' })));
}
