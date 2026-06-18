from __future__ import annotations

import os
from typing import Any

import socketio

from access_reader import AccessConfigurationError, fetch_checkins


SOCKET_URL = os.getenv("SOCKET_URL", "https://api.metasperu.net.pe")
SOCKET_PATH = os.getenv("SOCKET_PATH", "s5/socket")
REGISTER_EVENT = os.getenv("REGISTER_EVENT", "py_register_server_access_checkinout")
REQUEST_EVENT = os.getenv("REQUEST_EVENT", "py_access_checkinout")
SERVER_ID = os.getenv("SERVER_ID", "access-checkinout")

sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)


def read_range(payload: dict[str, Any]) -> tuple[str, str, str | None, str | None]:
    start_date = payload.get("fecha_desde") or payload.get("start_date") or payload.get("desde")
    end_date = payload.get("fecha_hasta") or payload.get("end_date") or payload.get("hasta")
    documento = payload.get("documento") or payload.get("nro_documento")
    request_id = payload.get("request_id") or payload.get("id")

    if not start_date or not end_date:
        raise ValueError("El payload debe incluir fecha_desde y fecha_hasta.")

    return (
        str(start_date),
        str(end_date),
        str(documento).strip() if documento else None,
        str(request_id) if request_id is not None else None,
    )


@sio.event
def connect() -> None:
    sio.emit(REGISTER_EVENT, {"id": SERVER_ID})
    print("Conectado y registrado como servidor_access_checkinout.")


@sio.event
def disconnect() -> None:
    print("Desconectado del socket.")


@sio.on(REQUEST_EVENT)
def on_access_checkinout(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        start_date, end_date, documento, request_id = read_range(payload or {})
        rows = fetch_checkins(start_date, end_date, documento)
        return {
            "ok": True,
            "request_id": request_id,
            "fecha_desde": start_date,
            "fecha_hasta": end_date,
            "documento": documento,
            "count": len(rows),
            "data": rows,
        }
    except (AccessConfigurationError, ValueError) as exc:
        return {"ok": False, "error": str(exc), "payload": payload}
    except Exception as exc:
        return {"ok": False, "error": f"Error inesperado: {exc}", "payload": payload}


def main() -> None:
    print(f"Conectando a {SOCKET_URL} con path {SOCKET_PATH}...")
    sio.connect(SOCKET_URL, socketio_path=SOCKET_PATH, transports=["websocket", "polling"])
    sio.wait()


if __name__ == "__main__":
    main()
