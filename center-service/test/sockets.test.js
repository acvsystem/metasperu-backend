import test from 'node:test';
import assert from 'node:assert/strict';
import { secureCenterSockets, identityScope } from '../../shared/center-sockets.mjs';
function fixture(identity, agent = false) {
  const io = { middleware: null, handlers: [], sockets: { sockets: new Map() }, in(){return {fetchSockets:async()=>[]};}, use(fn) { this.middleware=fn; }, on(name,fn) { this.handlers.push(fn); } };
  const boundary = { agent: async () => identity, security: {
    authenticate: async () => { if (!identity) throw Error(); return identity; }, canAccessStore: () => false,
  } };
  const socket = { data:{}, handshake:{headers:{},auth:agent?{agentToken:'test'}:{token:'test'}},
    once(name,fn) { this.close=fn; }, use(fn) { this.packet=fn; }, join(rooms) { this.rooms=rooms; },
    on() { return this; }, emit() {}, disconnect() { this.disconnected=true;this.rooms=[];this.close?.(); },
  };
  secureCenterSockets(io,boundary,{accepts:()=>true});
  return {io,socket,boundary};
}
test('anonymous socket cannot connect', async () => {
  const {io,socket}=fixture(null); let error; await io.middleware(socket,e=>error=e); assert.ok(error);
});
test('a browser cannot register as a backup server or impersonate a store', async () => {
  const {io,socket}=fixture({id:1,role:'TIENDA',stores:['A']});
  await io.middleware(socket,e=>assert.equal(e,undefined));
  for(const event of ['registrar_servidor','tienda_identificarse','py_response_documents_server']) {
    let error; await socket.packet([event,{}],e=>error=e);assert.ok(error);
  }
  socket.disconnect();
});
test('store identity and room membership come from its credential', async () => {
  const {io,socket}=fixture({kind:'store',store:'A',brand:'VS'},true);
  await io.middleware(socket,e=>assert.equal(e,undefined));
  let error;await socket.packet(['tienda_identificarse',{id_tienda:'B'}],e=>error=e);assert.ok(error);
  io.handlers[0](socket);socket.join(['A','B','servidor_backup','VS']);assert.deepEqual(socket.rooms,['A','VS']);socket.disconnect();
});
test('a store cannot use a room name as a reply destination or spoof rows through arrays',async()=>{
  const {io,socket}=fixture({kind:'store',store:'A'},true);
  await io.middleware(socket,e=>assert.equal(e,undefined));
  for(const data of [{enviar_a:'dashboards',data:[]},{socketId:'dashboards'},{socket:'dashboards'},[{serie:'B'}]]) {
    let error;await socket.packet(['py_response_informe_rendimiento',data],e=>error=e);assert.ok(error);
  }
  socket.disconnect();
});
test('role changes, removed assignments and revoked sessions disconnect the actual lease',async context=>{
  context.mock.timers.enable({apis:['setInterval']});
  for(const next of [{id:1,role:'TIENDA',allStores:false,stores:['A']},{id:1,role:'SISTEMAS',allStores:true,stores:['B']},null]) {
    const {io,socket,boundary}=fixture({id:1,role:'SISTEMAS',allStores:true,stores:['A']});
    await io.middleware(socket,error=>assert.equal(error,undefined));io.handlers[0](socket);
    boundary.security.authenticate=async()=>{if(!next)throw Error('revoked');return next;};
    context.mock.timers.tick(30000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(socket.disconnected,true);assert.deepEqual(socket.rooms,[]);
  }
});
