# Center: candidato coordinado, 29 de octubre de 2026

No desplegado. Hay mejoras verificadas; las ocho areas completas todavia no cumplen todos sus criterios. La seguridad no se considera certificada por pasar pruebas unitarias.

## Evidencia local

- Suites de Center, auth e Inventario; integracion real contra MySQL 8.4 Docker en 127.0.0.1:13316/center_qa. Nunca contra la base de produccion.
- Integracion: migrador repetido, perfil/login/logout/revocacion, cambios de permisos, grabaciones concurrentes/retencion, traspasos concurrentes/idempotentes/paginados, exportaciones privadas/cancelacion/limite de admision y asistencia por propietario con respuestas simultaneas e idempotentes.
- Frontend: compilacion de produccion, pruebas Angular, navegador escritorio/movil claro/oscuro para 15 modulos con API simulada. Prueba de actualizacion con service worker real entre dos builds de produccion; no borra borradores ni almacenamiento legacy.
- XLSX: validacion contra ZIP falsificado y exceso de filas; worker real de navegador exporta/reimporta 5.000 filas manteniendo ceros iniciales y formulas como texto, sin bloquear el intervalo de la pagina.
- Carga inicial estimada por Angular: 1,25 MB / 304,50 kB de transferencia, frente a la base medida de 3,25 MB / 676 kB. No equivale a un ensayo de capacidad del servidor.
- Audit: front/s1/s4 tienen 2 moderadas (ExcelJS/uuid), s5/s6 ninguna; cero altas/criticas en esos cinco proyectos. [Aviso oficial de UUID](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). No se ha silenciado ni forzado una version incompatible.

Artefactos y logs locales: `C:/Users/W10/Documents/Codex/2026-10-23/qu/outputs/revision-center-20261027/`. Los escenarios con mocks prueban UI, no la disponibilidad ni las credenciales del servidor real.

## Configuracion para staging

1. Respaldar DB y archivos privados, confirmar version/collation/nombres de tablas de MySQL, inventariar agentes instalados y fijar versiones exactas de los servicios que se revertirian. Los nombres de tablas legacy tienen mayusculas inconsistentes; comprobar especialmente Linux.
2. Preparar configuracion privada usando cada `.env.example`; nunca guardar `.env` o tokens en Git. Una clave aleatoria CENTER_JWT_SECRET de al menos 64 caracteres, diferente de Inventario, compartida solo por auth y s1/s4/s5/s6. No se acepta el placeholder del ejemplo. Cada pais usa credenciales/DB independientes. No cambiar el Node global: seleccionar y probar el runtime por proceso para conservar las otras aplicaciones.
3. CORS_ORIGINS contiene unicamente origenes HTTPS autorizados, separados por comas, y el origen localhost necesario solo en desarrollo. TRUST_PROXY_HOPS coincide con los proxies reales. HOST=127.0.0.1; no exponer directamente puertos de Node/MySQL/AMQP. Cookies HttpOnly/Secure necesitan HTTPS y la politica de cookies del navegador puede afectar accesos entre sitios diferentes.
4. Usuario de migracion con DDL durante la ventana; usuario de aplicacion limitado a sus tablas/acciones. Desde la raiz: `npm --prefix center-service run migrate`. El bloqueo es por conexion y las comprobaciones detienen duplicados; MySQL DDL hace commits implicitos. Si falla, detener despliegue y reparar sobre copia revisada, sin borrar duplicados automaticamente.
5. Preparar agentes con `scripts/provision-agent.js`: tokens en archivos privados, DB almacena hash. Distribuir `center_agent_auth.py` junto al script Python o configurar PYTHONPATH. En Windows establecer ACL; chmod no sustituye ACL. Inventariar los agentes que no estan incluidos en este repositorio; no activar el nuevo protocolo hasta probarlos. No habilitar acceso anonimo como alternativa.
6. Mantener ENABLE_SCHEDULED_JOBS=false al inicio; revisar cada cron, destinatario, errores absorbidos y tareas destructivas antes de habilitarlos. Un solo proceso designado para cron. La retencion de grabaciones requiere ambas banderas de jobs/retencion; revisar plazo aprobado antes de activarla.
7. Reportes nuevos: crear CENTER_EXPORT_DIR absoluto, fuera de la raiz web y con acceso solo de los procesos HTTP/worker. Configurar la misma ruta para ambos; ENABLE_EXPORT_WORKER=true en el worker y EXPORTS_ENABLED=true en HTTP cuando este listo. Iniciar `npm --prefix center-service run exports:worker`. El endpoint rechaza creacion si falta heartbeat. Un worker por pais al inicio; vigilar disco, edad de cola y fallos.
8. Front: `npm ci`, `npm test -- --watch=false --browsers=ChromeHeadless`, `npm run build`. Publicar el directorio browser completo de forma atomica, conservando archivos de la version anterior durante la transicion. index.html/ngsw.json/ngsw-worker.js con revalidacion/no-cache; assets con hash pueden usar cache immutable. No eliminar localStorage/IndexedDB del usuario. Servir SPA fallback solo para rutas de navegacion, no assets inexistentes.

## Puertas pendientes para produccion

- Matriz real de roles SISTEMAS/RRHH/OPERACIONES/FIELDLEADER/TIENDA/CONTABILIDAD: alta, consulta, modificacion y aislamiento por tienda. Algunas rutas legacy se deniegan deliberadamente hasta comprobar propiedad de IDs; no abrirlas globalmente para quitar errores 403.
- Aprobacion de horas: verificar pareja autorizacion/hora, usuario/rol derivados del servidor y avisos persistentes posteriores al commit. Todavia hay flujo legacy que no cumple esto.
- Inventario consolidado y auditoria de documentos conservan estado global por proceso; Redis instalado no aporta escalado por si solo. No habilitar replicas hasta migrar estado, protocolo/correlacion y rate limits compartidos.
- Asistencia guarda snapshots por consulta (15 min) y roster por usuario (1 hora). Expiracion impide lecturas; la purga fisica por lotes ocurre al iniciar consultas. Para garantizar borrado en periodos sin uso hace falta un job de retencion. Roster callback legacy aun no incluye identificador de solicitud, aunque se separa por propietario/conexion.
- FTP y correo siguen siendo integraciones externas: confirmar FTPS, reanudacion despues de cerrar navegador, outbox, privacidad/destinatarios y comportamiento ante acuse perdido. No se han usado servidores reales de tiendas, correo o FTP en QA.
- Pruebas de carga y recuperacion con datos representativos, agentes de prueba, fallo de DB/broker/red y dispositivos fisicos. XLSX requiere navegador con DecompressionStream; XLS antiguo debe convertirse a XLSX. Validar navegadores soportados antes de comunicar compatibilidad.
- Configuracion actual prevista: una instancia por servicio/pais. No afirmar soporte de replicas, numero de conexiones ni seguridad total con la evidencia disponible.

## Reversion coordinada

Guardar referencias exactas del front, auth y los cuatro servicios, sus configuraciones privadas y agentes anteriores antes de cambiar. Revertirlos como conjunto si fallan login/permisos/agentes. Desactivar cron y admision de exportaciones primero; permitir o cancelar los trabajos de forma controlada. Las tablas nuevas son aditivas: conservarlas para diagnostico y recuperacion; no ejecutar DROP ni restaurar una DB antigua sobre datos nuevos sin reconciliacion. El secreto nuevo invalida sesiones anteriores: una reversion debe prever nuevo login y no reutilizar claves historicamente expuestas. Verificar conteos, transferencias y archivos de trabajos antes de cerrar la ventana.
