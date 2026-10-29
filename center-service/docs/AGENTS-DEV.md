# Agentes Center: pruebas aisladas

Estas copias se preparan sin importar ni ejecutar los originales. Los originales
no se modifican. `manifest.json` permite comprobar su SHA-256. No instalar estas
copias encima de los agentes de produccion.

Incluidos: centerService (s1), centerInventario (s4), centerAccounting (s6),
serverResoucesHumanEJB y serverResourcesHuman (s5), agenteServidor (s1).
`inventarioService.py` pertenece a Inventario s3; `agenteServer_RRHH.py` usa el
servicio general de RR. HH. No comparten este protocolo y se dejan fuera.

## Preparacion y limites

1. Deben estar desplegados los servicios Center actualizados en DEV, con su
   propia base y credenciales de agentes. La existencia del subdominio por si
   sola NO demuestra que el backend actualizado este desplegado.
2. Configure `CENTER_API_ORIGIN=https://dev.metasperu.net.pe` y
   `CENTER_AGENT_TOKEN_FILE` como ruta absoluta al token privado, emitido solo
   para la tienda o servidor de prueba. No usar tokens de produccion.
3. Copie `sql-connections.example.json` fuera del repositorio, complete cada
   funcion/base origen con una conexion a una COPIA SQL de prueba. Conserve como
   clave el nombre de base original para identificar las iteraciones de los
   agentes de RR. HH.; el DATABASE de la conexion de destino sera el de prueba.
   Use usuarios SQL con permisos SELECT exclusivamente. Establezca
   `CENTER_AGENT_SQL_FILE` como ruta absoluta al archivo y, tras comprobarlo,
   `CENTER_AGENT_SQL_SANDBOX=1`. Esta variable es una confirmacion de
   configuracion, no verifica por si misma los permisos ni el servidor SQL.
4. Instale las dependencias originales en un entorno virtual separado. No se
   instala ni inicia ningun servicio de Windows automaticamente.
5. Ejecute UN agente de prueba, valide su autenticacion y respuestas en DEV y
   luego amplie la prueba. No ejecutar las copias antes de configurar el destino.

Los callbacks de borrado, transferencia, insercion contable y modificacion de
campos libres del kardex estan bloqueados;
los callbacks de lectura se conservan. Los envios HTTP de resultados apuntan a
DEV, con timeout y sin seguir redirecciones autenticadas. Las conexiones SQL no
usan las claves que venian incorporadas en el codigo. Los secretos deben estar
en archivos con permisos exclusivos del usuario que ejecuta el agente.

Validacion automatica realizada: compilacion de las seis copias y pruebas
unitarias del adaptador/autenticacion. La prueba completa con SQL Server,
tiendas y el servidor DEV requiere el despliegue y las credenciales de prueba;
no se afirma completada por estas comprobaciones estaticas.
