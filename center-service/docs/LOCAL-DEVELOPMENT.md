# Center local

Frontend: http://localhost:4900. El proxy de Angular envia las peticiones a los
servicios locales; no se necesita borrar datos del navegador. Al cambiar
`proxy.conf.cjs` o `angular.json`, reinicie `ng serve` para cargar el proxy.

## Base de datos y usuarios

La instancia Docker `center-local-dev-20261029` publica MySQL exclusivamente en
`127.0.0.1:13317`, con volumen persistente propio y base `center_local_dev`.
No comparte la base desechable de las pruebas automatizadas.

Se preparo una copia de datos el 29 de octubre de 2026. Los servicios locales
usan esta copia, no la base de produccion. Los cambios realizados aqui no se
sincronizan con produccion. Los usuarios conservan sus contraseñas. Una cuenta
duplicada se distinguio con un sufijo solo en esta copia; el registro esta en
`.private/center-local-20261029/local-account-adjustments.json`.

No se copiaron grabaciones rrweb, sesiones, enlaces temporales ni credenciales
de las integraciones externas. Las tareas programadas y el procesamiento de
correo estan deshabilitados. Los agentes de las tiendas no estan conectados
a estos servicios locales.

Los `.env` locales de autenticacion y de los cuatro servicios Center estan
configurados. Contienen credenciales privadas y no deben subirse a Git. Las
credenciales de Center son independientes de las de Inventario. El usuario
SQL de la aplicacion solo tiene SELECT, INSERT, UPDATE y DELETE en la base
local; las migraciones requieren el administrador local.

## Iniciar desde VS Code

1. Inicie Docker Desktop. Si el contenedor esta detenido, ejecute
   `docker start center-local-dev-20261029`.
2. Abra una terminal por servicio y ejecute `npm start` desde su carpeta:

| Carpeta del backend | Puerto |
| --- | --- |
| auth-service | 3000 |
| center-service | 3002 |
| center-inventory-service | 3003 |
| center-resources-human-service | 3004 |
| center-accounting-service | 3006 |

3. Desde `metasperu.center`, ejecute `npm start -- --port 4900`.
4. Abra http://localhost:4900 e ingrese con su usuario de Center.

La restauracion de la sesion usa una cookie segura; use `localhost`, como en
la URL indicada. Los borradores del navegador no se eliminan al actualizar
la pagina ni al cambiar el destino de la API.

## Validacion realizada

Se verificaron contra los servicios reales locales: login, carga de tiendas,
restauracion de sesion al recargar, cierre de sesion y rechazo del token
revocado. La cuenta temporal de QA se elimino al terminar. Esto valida el
flujo local de acceso, no certifica todos los modulos ni el despliegue DEV.

El subdominio `dev.metasperu.net.pe` requiere su despliegue coordinado y un
certificado de origen que incluya ese nombre. Esta configuracion local no
modifica Nginx, Cloudflare ni los servicios de produccion.
