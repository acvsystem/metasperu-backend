# Informe de Rendimiento – Cambios

## Archivos modificados
- `src/config/socket.js` – recolección de respuestas, generación de Excel y envío de email
- `src/app.js` – cron 21:00 inicia la recolección
- `src/controllers/report.controller.js` – soporta `?enviar_email=1`

## Cómo funciona
1. A las 21:00 (America/Lima) el cron emite `py_request_informe_rendimiento` a todas las tiendas.
2. Cada tienda responde con `py_response_informe_rendimiento` (serie + data con TOTAL GENERAL + Stock).
3. Cuando responden todas las online o pasan 3 minutos, se genera el Excel y se envía a:
   - itperu@metasperu.com
   - johnnygermano@metasperu.com

## Probar manualmente
```
GET /s1/center/api/reports/informe-rendimiento?socket_id=CRONREPORTE01&fecha_desde=2026-08-24&fecha_hasta=2026-08-24&enviar_email=1
```

## Requisitos
- Paquete `xlsx` (ya está en package.json)
- Worker de email debe aceptar el campo `archivo` con base64

## Formato Excel
ORDEN DE TIENDA | BRAND | NAME | TYPE | DAILY SALES S/ | DAILY SALES $ | DAILY UNITS | STOCK
