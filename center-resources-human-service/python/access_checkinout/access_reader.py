from __future__ import annotations

import os
from datetime import datetime
from typing import Any

import pyodbc


ACCESS_DB_PATH = os.getenv("ACCESS_DB_PATH", r"C:\Users\W10\Desktop\Access.mdb")
ACCESS_ODBC_DRIVER = os.getenv("ACCESS_ODBC_DRIVER")

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


def bracket(identifier: str) -> str:
    return "[" + identifier.replace("]", "]]") + "]"


def convert_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, bytes):
        return value.hex()
    return value


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
            if "USERID" not in columns:
                missing_required.append(f"{table_name}.USERID")
        if "CHECKTIME" not in check_cols:
            missing_required.append(f"{CHECKINOUT_TABLE}.CHECKTIME")
        if missing_required:
            raise AccessConfigurationError("Faltan columnas requeridas: " + ", ".join(missing_required))

        select_parts: list[str] = []
        output_names: list[str] = []

        for col in CHECKINOUT_COLUMNS:
            if col in check_cols:
                select_parts.append(f"c.{bracket(col)} AS {bracket('checkinout_' + col)}")
                output_names.append("checkinout_" + col)

        for col in USERINFO_COLUMNS:
            if col in user_cols:
                select_parts.append(f"u.{bracket(col)} AS {bracket('userinfo_' + col)}")
                output_names.append("userinfo_" + col)

        where_parts = ["c.[CHECKTIME] >= ?", "c.[CHECKTIME] <= ?"]
        params: list[Any] = [start, end]

        if documento and "Badgenumber" in user_cols:
            where_parts.append("u.[Badgenumber] = ?")
            params.append(str(documento).strip())

        sql = f"""
            SELECT {", ".join(select_parts)}
            FROM {bracket(CHECKINOUT_TABLE)} AS c
            INNER JOIN {bracket(USERINFO_TABLE)} AS u
                ON c.[USERID] = u.[USERID]
            WHERE {" AND ".join(where_parts)}
            ORDER BY c.[CHECKTIME], c.[USERID]
        """

        rows = cursor.execute(sql, *params).fetchall()
        return [{name: convert_value(value) for name, value in zip(output_names, row)} for row in rows]
