# Mejoras autorizadas de Center

Solicitud: implementar todas las mejoras propuestas de frontend y backend con código mantenible y escalable. No se solicitó desplegar esta versión. La aprobación del usuario cubre los cambios de autenticación, permisos, CORS y límites incluidos en esta iniciativa.

## Mapa y orden de construcción

| Módulo | Responsabilidad | Depende de |
| --- | --- | --- |
| identity | Sesiones revocables, roles vigentes, alcance por tienda, identidad de agentes | MySQL |
| realtime | Una conexión por servicio, limpieza, reconexión, salas autorizadas | identity |
| operations | Solicitudes identificadas, concurrencia, cancelación, idempotencia | identity, realtime |
| forms | Validación, mensajes, doble envío, cambios pendientes | identity, operations |
| queries | Paginación y filtros de servidor, carga diferida | identity |
| exports | Trabajos persistentes, worker, progreso y descarga autorizada | operations, queries |
| recordings | Propiedad, lotes idempotentes, paginación, retención | identity |
| releases | Actualización segura, dependencias, migración, observabilidad | todos |

## Estado verificado — 28/10/2026 (candidato, no desplegable todavia)

- Sesiones persistentes revocables, perfil/menu restaurados desde DB, cookies protegidas, tokens solo en memoria y separacion del alcance por tienda. Auth de Inventario conserva sus pruebas.
- Frontera HTTP y sockets integrada en s1/s4/s5/s6; agentes separados de personas, destinatarios exactos, salas restringidas y revision de permisos cada 30 segundos. Las operaciones aun no adaptadas se deniegan; esto NO equivale a compatibilidad completa con todos los roles.
- Migrador aditivo idempotente con bloqueo/preflight de duplicados; herramientas para agentes, hashes en DB y archivos privados. Scripts Python del repositorio adaptados al nuevo handshake. Falta validar todos los agentes instalados y su distribucion.
- Grabaciones: propietario, lotes idempotentes/transacciones, compresion asincrona, paginacion, privacidad de campos/texto, cola acotada por eventos/bytes, retencion por lotes desactivada por defecto.
- Usuarios: validacion, bcrypt12, ultimo administrador protegido, revocacion al editar; formularios esperan confirmacion y mantienen datos ante errores; paginas desde servidor.
- Traspasos: historico paginado sin N+1, tiendas derivadas desde DB, TXT validado, temporales limpiados, registro transaccional/idempotente y correlativo serializado. UI espera subida + registro y permite reintentar solo el registro. FTP requiere TLS. Falta hacer durable la entrega externa/reanudacion tras cerrar navegador.
- Una conexion por servicio, callbacks/suscripciones se limpian. Inicio sin descargar todos los modulos de trabajo (lazy module). Candidato incluye pagina de actualizaciones, aviso en cabecera y bloqueo de recarga con cambios pendientes.
- AMQP compartido con confirmacion y limites; el correo ya no se da por confirmado antes de la respuesta del broker. Eliminados logs de payloads/errores crudos en controladores/sockets; eliminado backup local de horarios con datos personales.
- Verificacion: pruebas unitarias + MySQL 8.4 aislado (migracion repetida, login/logout/perfil, permisos/revocacion, grabaciones concurrentes/retencion y traspasos concurrentes/idempotencia/paginacion). Navegador desktop/mobile claro/oscuro con APIs simuladas; repetir despues del ultimo cambio de rutas. Esto no prueba agentes reales ni integraciones productivas.

## Trabajo pendiente obligatorio antes de afirmar que estan terminadas las ocho areas

1. Completar matriz funcional de RRHH/operaciones/tiendas con consultas que comprueben propiedad de cada ID, sin abrir rutas globales como atajo. Probar tambien cambios de permisos de tiendas/menu en transacciones.
2. Sustituir caches globales de asistencia/inventario e informes por solicitudes/resultados persistentes con correlacion; acordar protocolo de agentes y estados/cancelacion. El consolidador de informes rechaza solapamiento y separa respuestas del cron, pero aun es de un solo proceso.
3. Cola persistente de exportaciones/trabajadores, progreso y descargas protegidas. Las exportaciones existentes aun requieren migracion fuera del hilo principal.
4. Aislar/persistir borradores por cuenta/tienda y probar actualizacion real entre dos builds PWA. No se borran almacenamientos para actualizar.
5. Sustituir SheetJS vulnerable. Su version corregida por CDN fue bloqueada por la politica de paquetes remotos; no evadirla. Migrar con alternativa del registro y pruebas de importacion/exportacion.
6. Redis adapter/shared limiter estan instalados pero NO configurados. La version sigue siendo de una instancia por servicio; no presentarla como preparada para replicas hasta migrar caches y probarlas.
7. Terminar auditoria de dependencias, QA de contratos/roles/agentes, carga y errores, guia de migracion/rollback y revision final de cambios.

## Reglas del despliegue

El secreto CENTER_JWT_SECRET nuevo necesita al menos 64 caracteres, distinto de Inventario y compartido por auth + s1/s4/s5/s6. El cambio incorpora issuer, audience y jti: los tokens antiguos dejan de ser válidos. Aplicar SQL, aprovisionar agentes y coordinar todos los consumidores antes de activar. No reutilizar la credencial histórica comprometida ni habilitar un fallback anónimo de agentes. Las cookies permanecen HttpOnly/Secure y los orígenes se configuran explícitamente.

No modificar la base real, enviar correos, ejecutar comandos de tiendas ni cambiar producción durante QA. El archivo RAR eliminado en el frontend es un cambio previo del usuario y no se debe restaurar ni incluir en los commits.
