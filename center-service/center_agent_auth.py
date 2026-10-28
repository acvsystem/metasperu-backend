"""Credential delivery for the legacy store and country agents; never log tokens."""
import os
from pathlib import Path
from urllib.parse import urlsplit
import requests


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
    if parsed.scheme == "https" and parsed.hostname == "api.metasperu.net.pe":
        headers = dict(kwargs.get("headers") or {})
        headers["x-center-agent"] = agent_token()
        kwargs["headers"] = headers
        kwargs["allow_redirects"] = False
    kwargs.setdefault("timeout", 30)
    return requests.post(url, *args, **kwargs)
