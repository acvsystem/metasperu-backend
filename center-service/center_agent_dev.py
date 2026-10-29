"""DEV-only guards. Credentials belong to DEV, never to production stores."""
import functools
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from center_agent_auth import agent_api_origin, agent_token, agent_post

READ_EVENTS = frozenset((
    'py_request_one_store_inventory', 'py_request_inventory',
    'py_traffic_counter_verification', 'py_request_transactions_store',
    'py_request_informe_rendimiento', 'py_request_documents_store',
    'py_request_documents_server', 'py_request_exchange_rate', 'py_request_cuo',
    'py_request_kardex_store',
    'py_registro_empleados_oficina', 'py_registro_empleados',
    'py_works_hours_employes', 'py_asistencia_empleados',
))


def require_dev():
    if agent_api_origin() != 'https://dev.metasperu.net.pe':
        raise RuntimeError('Esta copia requiere CENTER_API_ORIGIN=https://dev.metasperu.net.pe.')


def dev_connect(client, *args, **kwargs):
    require_dev()
    kwargs['auth'] = {'agentToken': agent_token()}
    # The original URL is deliberately ignored; never silently fall back to PROD.
    return client.connect(agent_api_origin(), *args[1:], **kwargs)


def dev_post(url, *args, **kwargs):
    require_dev()
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in ('api.metasperu.net.pe', 'dev.metasperu.net.pe')
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or not any(parsed.path.startswith(prefix) for prefix in (
                '/s1/center/', '/s4/center/inventory/', '/s5/center/resources/human/', '/s6/center/accounting/'))):
        raise RuntimeError('Destino HTTP ajeno al Center DEV bloqueado.')
    if parsed.path.endswith('/send/email'):
        raise RuntimeError('Envio de correo bloqueado en el agente DEV.')
    return agent_post(url, *args, **kwargs)


def dev_handler(event):
    def decorate(callback):
        @functools.wraps(callback)
        def guarded(*args, **kwargs):
            require_dev()
            if event not in READ_EVENTS:
                raise RuntimeError('Operacion de escritura bloqueada en el agente DEV.')
            return callback(*args, **kwargs)
        return guarded
    return decorate


def dev_sql_connect(slot, original_connection, **kwargs):
    require_dev()
    # Explicit per-database mapping is required: a loop over several payroll
    # databases must never read the same configured database repeatedly.
    match = re.search(r'\bDATABASE\s*=\s*([^;]+)', original_connection, re.I)
    filename = Path(os.environ.get('CENTER_AGENT_SQL_FILE', ''))
    if not match or not filename.is_absolute():
        raise RuntimeError('Configure una ruta absoluta CENTER_AGENT_SQL_FILE y las bases SQL de prueba.')
    try:
        connections = json.loads(filename.read_text(encoding='utf-8-sig'))
        connection = connections[slot][match.group(1).strip().strip('{}')]
    except (OSError, ValueError, KeyError, TypeError):
        raise RuntimeError('Falta la conexion SQL de prueba para esta funcion y base.') from None
    if not isinstance(connection, str) or not connection.strip():
        raise RuntimeError('La conexion SQL de prueba esta vacia.')
    if os.environ.get('CENTER_AGENT_SQL_SANDBOX') != '1':
        raise RuntimeError('Confirme bases de prueba con usuarios SQL de solo lectura: CENTER_AGENT_SQL_SANDBOX=1.')
    import pyodbc
    kwargs['timeout'] = min(int(kwargs.get('timeout', 15)), 30)
    return pyodbc.connect(connection, **kwargs)
