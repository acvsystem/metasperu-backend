# Consulta Access CHECKINOUT

Cliente Python para leer `CHECKINOUT` + `USERINFO` desde `Access.mdb` y responder
al backend por Socket.IO.

Por defecto solo consulta marcaciones de `CHECKINOUT.sn = SSR3241000241`.
Devuelve el nombre de `USERINFO.Name` en `userinfo_Name` y `name`, y el numero
de documento de `USERINFO.Education` en `userinfo_Education` y `documento`.

## Instalar

```powershell
cd C:\Users\W10\Desktop\PROYECTO_METAS_PERU\metasperu-backend\center-resources-human-service\python\access_checkinout
pip install -r requirements.txt
```

Python y el driver de Access deben tener la misma arquitectura. Si Python es
64 bits, instala el driver **Microsoft Access Database Engine** de 64 bits.

## Probar lectura local

```powershell
python test_read_access.py 2026-06-01 2026-06-18
python test_read_access.py 2026-06-01 2026-06-18 12345678
```

## Levantar cliente socket

```powershell
$env:ACCESS_DB_PATH="C:\Users\W10\Desktop\Access.mdb"
$env:CHECKINOUT_SN="SSR3241000241"
$env:SOCKET_URL="https://api.metasperu.net.pe"
$env:SOCKET_PATH="s5/socket"
python socket_client.py
```

El backend emitira `py_access_checkinout` a la sala `servidor_access_checkinout`. Este
cliente responde por acknowledgement con:

```json
{
  "ok": true,
  "request_id": "ABC123",
  "count": 1,
  "data": []
}
```
