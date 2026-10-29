# Edición de conteos con signo

29 de octubre de 2026. Rama `production-deploy`, tanto en `metasperu-backend` como en `metasperu.inventory`.

En Inventario activo → Conteo → Editar conteo se permiten cantidades enteras entre -999999999 y 999999999, incluidos cero y positivos. La cantidad editada sustituye la anterior: cambiar 8 por -2 guarda -2; no significa restar dos al valor anterior.

El backend conserva la autorización sobre el escaneo, el requisito de sesión activa, la consulta parametrizada y la transacción que guarda el valor anterior y el nuevo en `inventory_scan_audit`. Los escaneos nuevos y su sincronización siguen exigiendo cantidades positivas. El frontend muestra la cantidad actual en lugar del nombre de sección y deshabilita Guardar para valores incompletos, decimales o fuera de rango.

Pruebas: regresión reproducida antes del cambio; suite de inventario y suite Angular en ChromeHeadless. Se cubren -1, -2, -3, cero, positivos, extremos permitidos, auditoría y rechazo por permisos o sesión cerrada.

Despliegue: actualizar frontend y `inventory-service` conjuntamente. No se modificó la base de datos ni se desplegó el cambio desde esta intervención. El esquema de prueba usa columnas con signo para `inventario_escaneos.cantidad` y la auditoría; comprobar que el esquema del servidor también permita valores negativos antes de desplegar. No se pudo consultar el esquema real porque el entorno actual no tiene `DB_HOST` configurado.
