"""Credential delivery for the legacy store and country agents; never log tokens."""
import os
from pathlib import Path
from urllib.parse import urlsplit
import requests


def agent_api_origin():
    origin = os.environ.get('CENTER_API_ORIGIN', 'https://api.metasperu.net.pe').rstrip('/')
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or parsed.hostname not in ('api.metasperu.net.pe', 'dev.metasperu.net.pe') or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise RuntimeError('CENTER_API_ORIGIN no es un destino HTTPS autorizado.')
    return origin


def agent_token():
    token_path = os.environ.get("CENTER_AGENT_TOKEN_FILE", "")
    if not token_path or not Path(token_path).is_absolute():
        raise RuntimeError("Configure CENTER_AGENT_TOKEN_FILE con una ruta absoluta.")
    try:
        token = Path(token_path).read_text(encoding="utf-8").strip()
    except OSError:
        raise RuntimeError("No se pudo leer la credencial del dispositivo.") from None
    if not 32 <= len(token) <= 512:
        raise RuntimeError("La credencial del dispositivo no es valida.")
    return token


def agent_post(url, *args, **kwargs):
    parsed = urlsplit(url)
    center_path = any(parsed.path.startswith(prefix) for prefix in ('/s1/center/', '/s4/center/inventory/', '/s5/center/resources/human/', '/s6/center/accounting/'))
    if parsed.scheme == "https" and parsed.hostname in ('api.metasperu.net.pe', 'dev.metasperu.net.pe') and parsed.port in (None, 443) and not parsed.username and not parsed.password and center_path:
        url = agent_api_origin() + parsed.path + ('?' + parsed.query if parsed.query else '')
        headers = dict(kwargs.get("headers") or {})
        headers["x-center-agent"] = agent_token()
        kwargs["headers"] = headers
        kwargs["allow_redirects"] = False
    kwargs.setdefault("timeout", 30)
    return requests.post(url, *args, **kwargs)
