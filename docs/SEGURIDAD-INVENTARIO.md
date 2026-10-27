# Seguridad del inventario y migración coordinada

## Verificación de acceso local del 27 de octubre de 2026

Se recuperaron los datos de conexión de los `.env` locales ausentes desde el historial local, sin mostrar sus valores ni volverlos a versionar. Se generó una clave de sesión nueva compartida entre autenticación e inventario y se levantaron las APIs en 3000 y 3001. La base configurada es remota: ejecutar servicios locales no implica usar una base de pruebas.

La consulta de esquema detectó que faltaba `inventory_auth_sessions`. Se aplicó exclusivamente el primer `CREATE TABLE IF NOT EXISTS` de `inventory-service/sql/security.sql` para esa tabla; no se aplicaron los otros CREATE ni el ALTER del archivo. El login real desde `http://localhost:4700` cargó las 38 sesiones de inventario y conservó la sesión después de recargar. Las demás migraciones siguen pendientes.

Cambios locales del 26 de octubre de 2026. No se desplegaron servicios ni se modificó la base de datos de producción. El cambio previo del usuario en `center-inventory-service/src/routes/inventory.routes.js` queda fuera de esta entrega.

## Cambios aplicados

| Hallazgo anterior | Corrección |
| --- | --- |
| Administración accesible con cualquier token | Matriz de roles en cada ruta; usuarios y tiendas y cambios de mantenimiento solo administrador. Auditor supervisa sesiones, consultas y reportes. Pocket accede a conteos propios, secciones, tiendas de consulta y chat. |
| Tokens de otro sistema aceptados por inventario | Secreto independiente `INVENTORY_JWT_SECRET`, algoritmo HS256 explícito, issuer `inventory-auth`, audience `inventory-api`, sujeto y sesión identificados, caducidad de 8 horas. |
| Usuarios inactivos y tokens sin revocación | Cada petición consulta usuario activo y sesión vigente; logout revoca la sesión en MySQL. Un cambio de contraseña invalida sesiones anteriores mediante la huella del hash. Los cambios de rol se aplican al siguiente acceso. |
| Contraseña/hash registrados en consola | Eliminado el log de credenciales del login. Respuestas de inventario no incluyen errores internos de MySQL. Nuevas contraseñas usan bcrypt con costo 12 y validación de longitud y bytes. |
| Token legible por JavaScript | El login de inventario devuelve solo el usuario y establece `inventory_session`, HttpOnly/Secure/SameSite=None, 8 horas, host API y Path `/`. El navegador ya no guarda un bearer en localStorage. |
| CORS abierto y ausencia de controles HTTP | Orígenes exactos desde configuración, comprobación de Origin para evitar acciones con cookies desde otros sitios, Helmet, no-store y límites de solicitudes. Proxy confiable configurable y limitado por saltos. |
| Importaciones públicas | Ambos endpoints `/response/store` requieren administrador autenticado o un token de importador firmado, temporal y limitado a una tienda. |
| Socket sin autenticación y salas arbitrarias | Autenticación antes de conectar; se comprueba sesión en cada paquete y cada 15 segundos para conexiones pasivas. Sala de inventario existente; Pocket solo sesiones activas; importador solo sala de su tienda. Monitor solo administrador. |
| Edición libre del conteo | Cantidad entera acotada, sesión activa y propietario o administrador. Fila bloqueada con transacción; cambio y auditoría de cantidad anterior/nueva se confirman juntos. |
| Alta de sesión parcialmente guardada | Cabecera y secciones en una transacción. Códigos criptográficos de seis caracteres, con índice único. |
| Importación parcial, mezclada o duplicada | Un destino por lote, correspondencia de tienda y sesión, validación, transacción para todos los bloques y recibo persistente. Reintentos idénticos son idempotentes, incluso entre procesos. Un inventario diferente ya registrado devuelve 409. |
| `/scan` guardaba y después fallaba por req.io | Usa el contrato durable de Pocket con UUID, fecha y sección; no escribe sin esos datos. La sincronización confirma tras commit y no falla por una notificación de socket. |
| Escritura pesada por cada página de stock | La consulta sin filtros ya no ejecuta un UPDATE masivo para cada página. Calcula el resumen y añade conteos a las filas de la página. |

El bearer sigue admitido para consumidores HTTP autenticados y pruebas; el frontend no recibe ni persiste uno. La nueva cookie se llama diferente a la de Center para evitar sobrescribirla. Las consultas y exportaciones filtradas que dependen de acumulados todavía conservan la actualización derivada existente: la eliminación completa de escrituras en GET queda pendiente.

## Antes de desplegar

### Ejecución local desde Visual Studio Code

Desde `inventory-service` o `auth-service`, ejecutar una vez `npm run setup:local`. Configura ambos `.env` de desarrollo con una misma clave aleatoria de inventario de 64 caracteres, una clave distinta para el importador, orígenes locales y puertos HTTP `3000`/`3001`. Conserva los valores de conexión MySQL y no ejecuta migraciones. No imprime las claves ni las regenera si ya hay una clave compartida válida. Rechaza archivos marcados como producción o dos claves válidas contradictorias sin reemplazarlas.

Ajuste local del 27/10/2026: se comprobó el arranque de ambos procesos reales y respuesta 401 sin autenticación, sin consultar MySQL. Los procesos de comprobación se cerraron para dejar disponibles los puertos. Pasan 22 pruebas de inventario, incluidas 3 del configurador, y 3 de autenticación; QA independiente verificó la conservación de claves entre comillas con caracteres de comentario.

Después, usar dos terminales: `npm start` en `auth-service` y `npm start` en `inventory-service`. Los servicios locales escuchan solamente en `127.0.0.1`. `DB_PORT=3306` corresponde a MySQL; no debe confundirse con `PORT`, que es el puerto HTTP de cada API. La configuración de URLs del frontend y la migración de la base se revisan por separado: que la API arranque no certifica login ni conexión al esquema remoto.

### Preparación de producción

1. Respaldo y ventana coordinada de frontend, auth-service e inventory-service. Incluir `shared/inventory-security.mjs` en los artefactos: ambos servicios lo importan.
2. En el esquema de inventario, revisar códigos duplicados con `SELECT codigo_sesion, COUNT(*) FROM inventario_sesiones GROUP BY codigo_sesion HAVING COUNT(*) > 1`. Resolverlos antes de la migración; el script no borra ni corrige datos automáticamente.
3. Aplicar `inventory-service/sql/security.sql`. Crea sesiones de autenticación, auditoría y recibos de importación, y asegura unicidad del código de sesión. Fue ejecutado dos veces sobre MySQL 8.4 de prueba. Verificar el esquema y versión reales antes de producción; las tablas participantes deben usar InnoDB. Mantener también `sql/pocket-receipts.sql` para sincronización durable de Pocket.
4. Completar `.env.example` localmente en ambos servicios. Mismo secreto de inventario aleatorio de al menos 64 caracteres; secreto de importador diferente. Sin valores por defecto de DB ni claves dentro del código. Configurar DB_PORT si no es 3306.
5. `CORS_ORIGINS` debe contener los orígenes reales completos, sin slash final, separados por comas. No existe comodín. Mantener frontend y API dentro del mismo sitio HTTPS o usar un proxy del mismo sitio: un navegador puede bloquear cookies de terceros aun con SameSite=None. Las pruebas de API con cookies no sustituyen esta comprobación del dominio público.
6. Si hay proxy, configurar `TRUST_PROXY_HOPS` solo para la topología real y asegurar que el proxy reemplace los encabezados reenviados. Validar CORS, cookies y conexiones `/s3/socket/` a través del proxy.
7. Actualizar cada importador externo ANTES del cambio. Su código no está en estos repositorios. Configurar token temporal, `Authorization: Bearer …` al importar y `auth: { token: … }` en Socket.IO. El identificador de tienda debe corresponder a `tiendas.serie`; no basta cambiar el endpoint. Ejemplo de emisión: crear carpeta `.secrets`, luego ejecutar desde inventory-service `node scripts/create-import-token.mjs SERIE .secrets/importador.jwt`. El token caduca en 24 horas, se escribe exclusivamente en un archivo nuevo y nunca se imprime. Preparar renovación operativa. Nunca incluirlo en un frontend o repositorio.
8. Usuarios deben iniciar sesión nuevamente: tokens antiguos sin issuer/audience/expiración no se aceptan. Clientes antiguos de `/scan` deben enviar `client_scan_id` UUID v4, `scanned_at`, `seccion_id`, `sku`, `quantity` y `session_code`, o actualizar al sync-bulk actual. No reabrir la ruta anónima para compatibilidad.
9. Center tiene configuración propia `CENTER_DB_*` y `CENTER_JWT_SECRET`. Su autenticación continúa devolviendo bearer a sus clientes actuales; no se ha migrado el resto de servicios Center. Coordinar su clave con todos esos consumidores. No reutilizar la nueva clave de inventario. Sin configuración de Center, la conexión no cae a root/local por defecto.
10. Rotar las credenciales de DB y cualquier clave anteriormente versionada, revisar logs históricos del login y renovar el material TLS expuesto. Se dejaron de versionar `.env`, dependencias generadas de auth y los PEM del frontend; los archivos locales se conservaron. Esto NO elimina secretos del historial ni constituye rotación. No publicar el historial sin hacer esa revisión.

## Validación realizada

- `inventory-service`: 19 pruebas unitarias/HTTP/sockets, todas pasan; no conectan a DB real.
- `auth-service`: 3 pruebas HTTP, todas pasan: usuario inactivo, validación, cookie, cierre/revocación y límite de intentos.
- MySQL 8.4 aislado en Docker, sin montar datos existentes: migración repetible; rollback de cabecera cuando fallan secciones; rollback después de 1000 filas importadas; dos importaciones simultáneas guardan 120 filas una sola vez; fallo de auditoría revierte la cantidad; revocación persistente.
- Controlador HTTP real + MySQL: tres páginas 50/50/20, 120 IDs distintos. Login real de auth-service reconocido por inventory-service; cambio de rol produce 403 y logout produce 401 en el otro servicio.
- `npm audit`: cero hallazgos en auth-service e inventory-service con los lockfiles actualizados, sin `--force`. Son auditorías de avisos conocidos, no una garantía de ausencia de vulnerabilidades.

La integración Docker usa `test/mysql-schema.sql`, un esquema mínimo de prueba, no una copia ni una certificación del esquema de producción. El runner `test/mysql.integration.mjs` exige un contenedor llamado `inventory-security-qa-20261026` con etiqueta `codex.task=inventory-security-qa`, base vacía `inventory_qa` y un archivo local de entorno como argumento. No ejecutarlo sobre otro destino.

Revisión QA independiente posterior: la consulta POST `/api/v1/seccion/count/session` es de lectura y debe funcionar para Pocket y auditor, además del administrador. Se corrigió la restricción excesiva, validando pertenencia de sección y sesión activa para Pocket. La prueba reproduce el 403 anterior y verifica que no se habilite administración de usuarios. Los botones de escritura se muestran según el rol verificado, conservando el control obligatorio del servidor.

## Pendientes que impiden considerar cerrada toda la seguridad

- Dependencias del frontend: 54 → 18 avisos tras actualizaciones compatibles: 1 crítico, 12 altos, 4 moderados y 1 bajo. Quedan Angular/toolchain y SheetJS. La actualización coherente de Angular encontró conflictos de peers; su resolución aislada quedó bloqueada por la política npm `EALLOWREMOTE` al inspeccionar un paquete opcional de Tailwind. La distribución corregida oficial de SheetJS también fue bloqueada por esa política. No se usó `--force`, `--legacy-peer-deps`, supresiones ni se alteró la política del equipo. Revisión pendiente antes de lanzamiento; no ocultar el hallazgo crítico de Piscina por ser herramienta de construcción.
- Los límites de peticiones son por proceso. Al escalar, usar un almacén compartido o limitación en gateway; no tratarlos como límite distribuido.
- Retención/purga programada de sesiones caducadas y auditorías requiere una política operativa y backups.
- IndexedDB/cache conserva el modelo anterior: no se ha implementado aislamiento completo por usuario/país. Logout confirmado mantiene el aviso antes de borrar pendientes; una expiración conserva escaneos. Revisar recuperación de pendientes y cambio de cuenta en equipos compartidos antes de habilitar países.
- Los candados en memoria de otros mantenimientos no se convirtieron todos a candados distribuidos. Las garantías persistentes nuevas corresponden a recibos de Pocket e importación de stock; comprobar restricciones de username/serie en el esquema real.
- No hay aún separación de datos por país ni consola multinacional: este cambio endurece el inventario existente.

## Fuentes técnicas

- Express: https://expressjs.com/advanced/best-practice-security/
- Socket.IO: https://socket.io/docs/v4/middlewares/
- SheetJS, distribución oficial y aviso sobre npm obsoleto: https://docs.sheetjs.com/docs/getting-started/installation/frameworks/

Para volver atrás, revertir coordinadamente frontend y ambos servicios. Conservar las tablas nuevas y auditorías; no hacer DROP para un rollback de código. Volver al autenticador anterior reintroduciría los problemas detectados y no es una solución de seguridad.
