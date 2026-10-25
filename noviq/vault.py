# -*- coding: utf-8 -*-
"""Bóveda de API keys cifrada.

Windows: cifrado DPAPI (el mismo que usa Windows para contraseñas guardadas). Solo tu usuario de
Windows en esta PC puede descifrarlo: si copian el archivo a otra PC o a otro usuario, no sirve.
Otros sistemas: ofuscado + permisos 600 (solo tu usuario puede leerlo).
"""
import base64
import getpass
import hashlib
import json
import os
import platform
import re
import shutil
import threading
import time

from .config import DATA_DIR, IS_WINDOWS

VAULT = DATA_DIR / "claves.vault"
_ENTROPY = b"NVIDIA-Chat-v2-boveda"  # NO cambiar: descifra las claves ya guardadas
_lock = threading.Lock()
_cache = None

if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def _mk(data: bytes):
        buf = ctypes.create_string_buffer(data, len(data))
        return _BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    def _dpapi(data: bytes, protect: bool) -> bytes:
        crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
        inb, _b1 = _mk(data)
        ent, _b2 = _mk(_ENTROPY)
        out = _BLOB()
        if protect:
            ok = crypt32.CryptProtectData(ctypes.byref(inb), "Noviq", ctypes.byref(ent), None, None, 0x01,
                                          ctypes.byref(out))
        else:
            ok = crypt32.CryptUnprotectData(ctypes.byref(inb), None, ctypes.byref(ent), None, None, 0x01,
                                            ctypes.byref(out))
        if not ok:
            raise OSError("DPAPI falló (código %d)" % kernel32.GetLastError())
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            kernel32.LocalFree(out.pbData)


def _obf_key():
    return hashlib.sha256(f"{getpass.getuser()}|{platform.node()}|".encode() + _ENTROPY).digest()


def _xor(data: bytes) -> bytes:
    k = _obf_key()
    return bytes(b ^ k[i % len(k)] for i, b in enumerate(data))


def _encrypt(data: bytes) -> str:
    if IS_WINDOWS:
        try:
            return "DPAPI:" + base64.b64encode(_dpapi(data, True)).decode()
        except Exception as e:  # respaldo si DPAPI no está disponible
            print("[bóveda] DPAPI no disponible, uso ofuscación:", e)
    return "OBF:" + base64.b64encode(_xor(data)).decode()


def _decrypt(text: str) -> bytes:
    if _sin_boveda():
        raise PermissionError("este proceso no puede leer la bóveda de claves")
    kind, _, b64 = text.partition(":")
    raw = base64.b64decode(b64)
    if kind == "DPAPI":
        return _dpapi(raw, False)
    return _xor(raw)


# ───────────── Limpieza de claves pegadas ─────────────
# La gente pega la clave como la muestra la web: «Bearer nvapi-…», «Authorization: Bearer …», «NVIDIA_API_KEY=…»,
# «clave 2 nvapi-…», entre comillas o con espacios/invisibles. Antes «Bearer» se guardaba como si fuera OTRA clave
# (la caja se partía por espacios) y, como era la primera, la lista de modelos fallaba con «clave inválida».
_INVISIBLES = re.compile(r"[\u200b-\u200f\u2060\ufeff\u00a0]")
_RUIDO = re.compile(r"(?i)^(bearer|authorization|auth|token|api[-_ ]?key|apikey|key|clave|llave|password|y|and|o|or|"
                    r"nvidia|export|set|header|headers|\d{1,3}[.):-]?|[-–—•*#:=|,;]+)$")
_ASIGNACION = re.compile(r"^[\"']?([A-Za-z_][A-Za-z0-9_\-]*)[\"']?\s*[:=]\s*(.+)$")
_NOMBRE_VAR = re.compile(r"(?i)(key|token|auth|api|clave|bearer|secret|nvidia|header)")
_MAYUS = re.compile(r"^[A-Z][A-Z0-9_]*_[A-Z0-9_]+$")  # NVIDIA_API_KEY, OPENAI_KEY…


def extraer_claves(texto) -> list:
    """Devuelve las claves que hay en un texto pegado (sin «Bearer», comillas, nombres de variable, números de orden…)."""
    if not texto:
        return []
    t = _INVISIBLES.sub(" ", str(texto))
    out = []
    for linea in re.split(r"[\r\n,;]+", t):
        linea = linea.strip().strip("\"'`").strip()
        if not linea:
            continue
        m = _ASIGNACION.match(linea)  # NVIDIA_API_KEY=nvapi-…  /  Authorization: Bearer …  /  "api_key": "…"
        if m and (_NOMBRE_VAR.search(m.group(1)) or _MAYUS.match(m.group(1))) and len(m.group(2).strip()) >= 6:
            linea = m.group(2).strip()
        for tok in re.split(r"\s+", linea):
            tok = tok.strip().strip("\"'`{}[]()<>").rstrip(":").strip()
            m2 = re.match(r"^([A-Za-z_][A-Za-z0-9_\-]*)=(.{6,})$", tok)  # export NVIDIA_API_KEY='nvapi-…'
            if m2 and (_NOMBRE_VAR.search(m2.group(1)) or _MAYUS.match(m2.group(1))):
                tok = m2.group(2).strip("\"'`")
            if not tok or _RUIDO.match(tok):
                continue
            if "…" in tok or "•" in tok:  # una clave enmascarada nunca es una clave real
                continue
            if len(tok) < 6:  # «2», «de»… no son claves
                continue
            out.append(tok)
    return list(dict.fromkeys(out))


def limpiar_lista(keys) -> list:
    res = []
    for k in keys or []:
        res.extend(extraer_claves(k))
    return list(dict.fromkeys(res))


def _sin_boveda():
    """Procesos que NUNCA deben tocar la bóveda (p. ej. el servidor MCP del programador que abre el avatar):
    así ningún antivirus ve a otro programa descifrando las claves de Noviq (incidente Avast del 01-10-2026)."""
    return bool(os.environ.get("NOVIQ_SIN_BOVEDA"))


def load() -> dict:
    global _cache
    if _sin_boveda():
        return {}
    if _cache is not None:
        return _cache
    data = {}
    if VAULT.exists():
        try:
            data = json.loads(_decrypt(VAULT.read_text(encoding="utf-8").strip()).decode("utf-8"))
        except Exception as e:
            print("[bóveda] no se pudo descifrar las claves:", e)
            bak = VAULT.with_suffix(".vault.bak")
            data = {}
            if bak.exists():  # la copia anterior (se hace en cada guardado) suele estar sana
                try:
                    data = json.loads(_decrypt(bak.read_text(encoding="utf-8").strip()).decode("utf-8"))
                    print("[bóveda] recuperé las claves de la copia claves.vault.bak")
                except Exception:
                    data = {}
    if not isinstance(data, dict):
        data = {}
    # limpieza de claves guardadas con versiones anteriores («Bearer» suelto, comillas, duplicadas…)
    limpio = {k: (list(v) if isinstance(v, list) else [v]) if k.startswith(SECRETO) else limpiar_lista(v if isinstance(v, list) else [v])
              for k, v in data.items()}
    _cache = limpio
    if limpio != data and VAULT.exists():
        try:
            save(limpio)
            print("[bóveda] claves limpiadas (quité «Bearer», comillas o duplicadas)")
        except Exception as e:
            print("[bóveda] no pude guardar la limpieza:", e)
    return _cache


def save(data: dict):
    global _cache
    if _sin_boveda():
        raise PermissionError("este proceso no puede escribir la bóveda de claves")
    with _lock:
        _cache = {k: [x for x in v if x] for k, v in data.items()}
        tmp = VAULT.with_suffix(".tmp")
        tmp.write_text(_encrypt(json.dumps(_cache).encode("utf-8")), encoding="utf-8")
        if VAULT.exists():
            try:  # copia de la versión anterior: si algo sale mal se recupera sola al abrir
                shutil.copy2(VAULT, VAULT.with_suffix(".vault.bak"))
            except OSError:
                pass
        for i in range(6):  # en Windows el antivirus/OneDrive a veces bloquea el archivo un instante
            try:
                tmp.replace(VAULT)
                break
            except PermissionError:
                if i == 5:
                    raise
                time.sleep(0.3)
        if not IS_WINDOWS:
            os.chmod(VAULT, 0o600)


def get_keys(pid) -> list:
    return list(load().get(pid, []))


def set_keys(pid, keys):
    """Guarda las claves de un proveedor (limpias y sin duplicadas). Devuelve la lista guardada."""
    d = dict(load())
    d[pid] = limpiar_lista(keys)
    save(d)
    return list(d[pid])


def add_key(pid, key):
    """Agrega una clave (o varias pegadas juntas) a las que ya tiene el proveedor."""
    return set_keys(pid, get_keys(pid) + extraer_claves(key))


def formato_sospechoso(pid, key):
    """Aviso si la clave no tiene la forma típica de ese proveedor (no se rechaza: solo se avisa)."""
    pref = {"nvidia": "nvapi-", "openrouter": "sk-or-", "anthropic": "sk-ant-", "groq": "gsk_", "gemini": "AIza"}.get(pid)
    if pref and not key.startswith(pref):
        return f"no empieza por «{pref}» como las claves de ese proveedor"
    return ""


SECRETO = "secreto:"  # contraseñas de correo, token de Telegram…: se guardan tal cual (con espacios, comas o símbolos)


def get_secreto(nombre, defecto=""):
    v = load().get(SECRETO + nombre) or []
    return v[0] if v else defecto


def set_secreto(nombre, valor):
    d = dict(load())
    if valor:
        d[SECRETO + nombre] = [str(valor)]
    else:
        d.pop(SECRETO + nombre, None)
    save(d)


def mask(k):
    return k[:9] + "…" + k[-6:] if len(k) > 20 else (k[:4] + "…" + k[-3:] if len(k) > 10 else "•" * len(k))
