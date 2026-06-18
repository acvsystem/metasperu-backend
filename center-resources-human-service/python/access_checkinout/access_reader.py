from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import pyodbc


ACCESS_DB_PATH = os.getenv("ACCESS_DB_PATH", r"C:\ZKTeco\ZKAccess3.5\Access.mdb")
ACCESS_ODBC_DRIVER = os.getenv("ACCESS_ODBC_DRIVER")
CHECKINOUT_SN = os.getenv("CHECKINOUT_SN", "SSR3241000241")

CHECKINOUT_TABLE = "CHECKINOUT"
USERINFO_TABLE = "USERINFO"

CHECKINOUT_COLUMNS = [
    "USERID",
    "CHECKTIME",
    "CHECKTYPE",
    "VERIFYCODE",
    "SENSORID",
    "WorkCode",
    "sn",
    "UserExtFmt",
]

USERINFO_COLUMNS = [
    "USERID",
    "Badgenumber",
    "Name",
    "Education",
    "Gender",
    "TITLE",
    "DEFAULTDEPTID",
    "CardNo",
]


class AccessConfigurationError(RuntimeError):
    pass


def parse_datetime(value: str, *, end_of_day: bool = False) -> datetime:
    value = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(value, fmt)
            if fmt == "%Y-%m-%d":
                if end_of_day:
                    return parsed.replace(hour=23, minute=59, second=59)
                return parsed.replace(hour=0, minute=0, second=0)
            return parsed
        except ValueError:
            pass
    raise ValueError("Formato de fecha invalido. Usa YYYY-MM-DD o YYYY-MM-DD HH:MM:SS.")


def connect() -> pyodbc.Connection:
    if not os.path.exists(ACCESS_DB_PATH):
        raise AccessConfigurationError(f"No existe el archivo Access: {ACCESS_DB_PATH}")

    driver_candidates = [
        ACCESS_ODBC_DRIVER,
        "Microsoft Access Driver (*.mdb, *.accdb)",
        "Microsoft Access Driver (*.mdb)",
    ]
    last_error: Exception | None = None

    for driver in [candidate for candidate in driver_candidates if candidate]:
        connection_string = f"DRIVER={{{driver}}};DBQ={ACCESS_DB_PATH};READONLY=TRUE;"
        try:
            return pyodbc.connect(connection_string, timeout=10)
        except pyodbc.Error as exc:
            last_error = exc

    available = ", ".join(pyodbc.drivers()) or "ninguno"
    raise AccessConfigurationError(
        "No se pudo abrir el MDB por ODBC. Verifica que el driver Access tenga la "
        "misma arquitectura que Python. Si Python es 64 bits, instala Microsoft "
        "Access Database Engine de 64 bits o usa Python 32 bits. "
        f"Drivers visibles para este Python: {available}. Error original: {last_error}"
    )


def table_columns(cursor: pyodbc.Cursor, table_name: str) -> set[str]:
    return {row.column_name for row in cursor.columns(table=table_name)}


def find_column(columns: set[str], wanted: str) -> str | None:
    wanted_lower = wanted.lower()
    return next((column for column in columns if column.lower() == wanted_lower), None)


def bracket(identifier: str) -> str:
    return "[" + identifier.replace("]", "]]") + "]"


def convert_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, bytes):
        return value.hex()
    return value


def split_checktime(value: Any) -> tuple[str | None, str | None]:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d"), value.strftime("%H:%M:%S")

    if not value:
        return None, None

    text = str(value).strip()
    if not text:
        return None, None

    if "T" in text:
        text = text.replace("T", " ")

    parts = text.split(" ")
    fecha = parts[0] if parts else None
    hora = parts[1].split(".")[0] if len(parts) > 1 else None
    return fecha, hora


def group_by_person(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for row in rows:
        user_id = row.get("userinfo_USERID") or row.get("checkinout_USERID")
        documento = row.get("userinfo_Education") or row.get("userinfo_Badgenumber")
        name = row.get("userinfo_Name")
        group_key = str(documento or user_id or name or "sin_identificar")

        if group_key not in grouped:
            grouped[group_key] = {
                "name": name,
                "dni": documento,
                "documento": documento,
                "userid": user_id,
                "asistencia": {},
            }

        fecha, hora = split_checktime(row.get("checkinout_CHECKTIME"))
        fecha_key = fecha or "sin_fecha"
        asistencia_por_fecha = grouped[group_key]["asistencia"]
        if fecha_key not in asistencia_por_fecha:
            asistencia_por_fecha[fecha_key] = {
                "fecha": fecha,
                "registros": [],
            }

        registros = asistencia_por_fecha[fecha_key]["registros"]
        registros.append({
            "registro_numero": len(registros) + 1,
            "fecha": fecha,
            "hora": hora,
            "checktime": row.get("checkinout_CHECKTIME"),
            "sn": row.get("checkinout_sn"),
            "checktype": row.get("checkinout_CHECKTYPE"),
        })

    result: list[dict[str, Any]] = []
    for person in grouped.values():
        person["asistencia"] = list(person["asistencia"].values())
        result.append(person)
    return result


def fetch_checkins(start_date: str, end_date: str, documento: str | None = None) -> list[dict[str, Any]]:
    start = parse_datetime(start_date)
    end = parse_datetime(end_date, end_of_day=True)
    if end < start:
        raise ValueError("fecha_hasta no puede ser menor que fecha_desde.")

    with connect() as conn:
        cursor = conn.cursor()
        check_cols = table_columns(cursor, CHECKINOUT_TABLE)
        user_cols = table_columns(cursor, USERINFO_TABLE)

        missing_required = []
        for table_name, columns in ((CHECKINOUT_TABLE, check_cols), (USERINFO_TABLE, user_cols)):
            if not find_column(columns, "USERID"):
                missing_required.append(f"{table_name}.USERID")
        checktime_col = find_column(check_cols, "CHECKTIME")
        sn_col = find_column(check_cols, "sn")
        user_id_check_col = find_column(check_cols, "USERID")
        user_id_info_col = find_column(user_cols, "USERID")
        badgenumber_col = find_column(user_cols, "Badgenumber")

        if not checktime_col:
            missing_required.append(f"{CHECKINOUT_TABLE}.CHECKTIME")
        if CHECKINOUT_SN and not sn_col:
            missing_required.append(f"{CHECKINOUT_TABLE}.sn")
        if missing_required:
            raise AccessConfigurationError("Faltan columnas requeridas: " + ", ".join(missing_required))

        select_parts: list[str] = []
        output_names: list[str] = []

        for col in CHECKINOUT_COLUMNS:
            actual_col = find_column(check_cols, col)
            if actual_col:
                select_parts.append(f"c.{bracket(actual_col)} AS {bracket('checkinout_' + col)}")
                output_names.append("checkinout_" + col)

        for col in USERINFO_COLUMNS:
            actual_col = find_column(user_cols, col)
            if actual_col:
                select_parts.append(f"u.{bracket(actual_col)} AS {bracket('userinfo_' + col)}")
                output_names.append("userinfo_" + col)

        where_parts = [f"c.{bracket(checktime_col)} >= ?", f"c.{bracket(checktime_col)} <= ?"]
        params: list[Any] = [start, end]

        if documento and badgenumber_col:
            where_parts.append(f"u.{bracket(badgenumber_col)} = ?")
            params.append(str(documento).strip())

        if CHECKINOUT_SN:
            where_parts.append(f"c.{bracket(sn_col)} = ?")
            params.append(CHECKINOUT_SN)

        sql = f"""
            SELECT {", ".join(select_parts)}
            FROM {bracket(CHECKINOUT_TABLE)} AS c
            INNER JOIN {bracket(USERINFO_TABLE)} AS u
                ON c.{bracket(user_id_check_col)} = u.{bracket(user_id_info_col)}
            WHERE {" AND ".join(where_parts)}
            ORDER BY c.{bracket(checktime_col)}, c.{bracket(user_id_check_col)}
        """

        rows = cursor.execute(sql, *params).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            item = {name: convert_value(value) for name, value in zip(output_names, row)}
            item["name"] = item.get("userinfo_Name")
            item["documento"] = item.get("userinfo_Education")
            result.append(item)
        return group_by_person(result)
