# -*- coding: utf-8 -*-
"""🪙 Contabilidad de tokens: cuánto gasta cada IA y cuánto le QUEDA, para que el selector sepa cuál usar.

- Cada respuesta anota los tokens de entrada/salida del modelo (los que informa el servidor; si no los informa, una
  estimación por caracteres) por día, por mes y en total.
- Lee los límites que mandan los proveedores en las cabeceras (x-ratelimit-remaining-tokens / -requests, las de
  Cerebras por día, las anthropic-ratelimit-*, Retry-After…) → «quedan N tokens / N llamadas, se renueva en …».
- Un 429 «por día» (cuota diaria, free-models-per-day, TPD/RPD) deja la IA como AGOTADA hasta que se renueve: el
  respaldo y el evaluador la mandan al final y no pierden minutos reintentando.
- El usuario puede poner su propio cupo diario por proveedor (ej. 200 000 tokens/día) en 🏆 Ranking de IAs.
Todo en datos/tokens.json. Nada aquí puede romper una respuesta: los errores se ignoran."""
import atexit
import json
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from .config import CONFIG, DATA_DIR

FILE = DATA_DIR / "tokens.json"
_lock = threading.RLock()
_db = None
_last = [0.0]
CH = 3.6  # caracteres por token (estimación cuando el servidor no informa el uso)

_RX_DIA = re.compile(r"(?i)(per[\s_-]*day|daily|/day|\bday\b|\brpd\b|\btpd\b|free-models-per-day|por d[ií]a|diari|24 ?h)")
_RX_ESPERA = re.compile(r"(?i)(?:try again|retry|reintenta\w*|resets?)\s*(?:in|after|en)?\s*((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+)")


def _hoy():
    return datetime.now().strftime("%Y-%m-%d")


def _mes():
    return datetime.now().strftime("%Y-%m")


def _load():
    global _db
    if _db is None:
        try:
            _db = json.loads(FILE.read_text(encoding="utf-8"))
        except Exception:
            _db = {}
        for k in ("modelos", "limites", "agotado", "cupos"):
            _db.setdefault(k, {})
    return _db


_sucio = [False]


def _save(force=False):
    if not force and time.time() - _last[0] < 5:
        _sucio[0] = True  # se guarda en el próximo flush (fin de cada trabajo) o al cerrar
        return
    try:
        with _lock:
            tmp = FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(_load(), ensure_ascii=False, indent=0), encoding="utf-8")
            tmp.replace(FILE)
            _last[0] = time.time()
            _sucio[0] = False
    except Exception:
        pass


def flush():
    if _sucio[0]:
        _save(force=True)


atexit.register(flush)


def _pid(model_id):
    return model_id.split("::", 1)[0] if "::" in model_id else "nvidia"


def _local(model_id):
    return bool((CONFIG.get("providers", {}).get(_pid(model_id)) or {}).get("local"))


# ───────────── gasto ─────────────
def estimar(messages=None, tools=None, texto=""):
    """Tokens aproximados de un contexto (mensajes + esquemas de herramientas) o de un texto."""
    n = len(texto or "")
    for m in messages or []:
        c = m.get("content")
        if isinstance(c, str):
            n += len(c)
        elif isinstance(c, list):
            for p in c:
                if isinstance(p, dict):
                    n += len(p.get("text") or "") + (1100 * CH if p.get("type") == "image_url" else 0)
        for tc in m.get("tool_calls") or []:
            n += len(json.dumps(tc, ensure_ascii=False))
    if tools:
        n += len(json.dumps(tools, ensure_ascii=False))
    return int(n / CH)


def usar(model_id, entrada, salida, estimado=False):
    """Anota los tokens de una respuesta."""
    if not model_id:
        return
    try:
        entrada, salida = max(0, int(entrada or 0)), max(0, int(salida or 0))
        with _lock:
            for clave in (model_id, _pid(model_id) + "::*"):
                m = _load()["modelos"].setdefault(clave, {})
                if m.get("dia") != _hoy():
                    m.update(dia=_hoy(), d_in=0, d_out=0, d_n=0)
                if m.get("mes") != _mes():
                    m.update(mes=_mes(), m_in=0, m_out=0, m_n=0)
                for pre in ("d_", "m_", "t_"):
                    m[pre + "in"] = m.get(pre + "in", 0) + entrada
                    m[pre + "out"] = m.get(pre + "out", 0) + salida
                    m[pre + "n"] = m.get(pre + "n", 0) + 1
                m["estimado"] = bool(estimado)
                m["visto"] = time.time()
        _save()
    except Exception:
        pass


def usar_respuesta(model_id, usage, messages, tools, raw, reasoning, tool_calls):
    """Con el «usage» del servidor si lo mandó; si no, estimado por caracteres."""
    try:
        if usage and (usage.get("prompt_tokens") or usage.get("completion_tokens") or usage.get("input_tokens")):
            usar(model_id, usage.get("prompt_tokens") or usage.get("input_tokens"),
                 usage.get("completion_tokens") or usage.get("output_tokens"))
        else:
            sal = len(raw or "") + len(reasoning or "") + sum(len(json.dumps(t, ensure_ascii=False)) for t in tool_calls or [])
            usar(model_id, estimar(messages, tools), int(sal / CH), estimado=True)
    except Exception:
        pass


# ───────────── límites que informa el proveedor ─────────────
def _dur(txt):
    """'1m30.5s' / '7.66s' / '250ms' / '2h' / '45' → segundos (float) o None."""
    t = str(txt or "").strip().lower()
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        pass
    total, ok = 0.0, False
    for num, uni in re.findall(r"(\d+(?:\.\d+)?)\s*(ms|h|m|s)", t):
        ok = True
        total += float(num) * {"ms": 0.001, "h": 3600, "m": 60, "s": 1}[uni]
    return total if ok else None


def _reset_ts(v):
    """Cabecera de «reset» → timestamp. Acepta segundos, duraciones, epoch (s o ms) o fecha ISO."""
    v = str(v or "").strip()
    if not v:
        return None
    try:
        x = float(v)
        if x > 1e12:
            return x / 1000
        if x > 1e9:
            return x
        return time.time() + x
    except ValueError:
        pass
    d = _dur(v)
    if d is not None:
        return time.time() + d
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


_RX_H = re.compile(r"^(?:x-)?(?:anthropic-)?ratelimit-(?:(limit|remaining|reset)-(requests|tokens|input-tokens|output-tokens)"
                   r"|(requests|tokens|input-tokens|output-tokens)-(limit|remaining|reset)|(limit|remaining|reset))"
                   r"(?:-(day|minute|hour|month))?$")


def cabeceras(model_id, headers):
    """Guarda los límites que vienen en las cabeceras de la respuesta (si las hay)."""
    if not model_id or not headers or _local(model_id):
        return
    try:
        info = {}
        for k, v in headers.items():
            mt = _RX_H.match(k.lower())
            if not mt:
                continue
            campo = mt.group(1) or mt.group(4) or mt.group(5)
            que = (mt.group(2) or mt.group(3) or "requests").replace("input-tokens", "tokens").replace("output-tokens", "tokens_salida")
            vent = mt.group(6) or ""
            clave = que + ("_" + vent if vent else "")
            d = info.setdefault(clave, {})
            if campo == "reset":
                ts = _reset_ts(v)
                if ts:
                    d["reset"] = ts
            else:
                try:
                    d["limite" if campo == "limit" else "quedan"] = int(float(v))
                except ValueError:
                    pass
        if not info:
            return
        with _lock:
            _load()["limites"][model_id] = dict(info, t=time.time())
            ag = _load()["agotado"].get(model_id)
            if ag and not ag.get("dia"):  # respondió bien: si estaba «agotado» por minuto, ya no
                _load()["agotado"].pop(model_id, None)
        _save()
    except Exception:
        pass


def agotar(model_id, body="", headers=None):
    """Un 429 (o «cuota agotada»): hasta cuándo no conviene usar esta IA. Devuelve los segundos de espera."""
    try:
        txt = str(body or "")
        hasta = None
        h = {k.lower(): v for k, v in (headers or {}).items()}
        for k in ("retry-after", "x-ratelimit-reset-requests-day", "x-ratelimit-reset-tokens-day", "x-ratelimit-reset-requests",
                  "x-ratelimit-reset-tokens", "x-ratelimit-reset", "anthropic-ratelimit-tokens-reset", "anthropic-ratelimit-requests-reset"):
            if h.get(k):
                ts = _reset_ts(h[k])
                if ts and ts > time.time():
                    hasta = max(hasta or 0, ts)
        m = _RX_ESPERA.search(txt)
        if m:
            d = _dur(m.group(1))
            if d:
                hasta = max(hasta or 0, time.time() + d)
        dia = bool(_RX_DIA.search(txt)) or any("day" in k and h.get(k) in ("0", 0) for k in h if "remaining" in k)
        if not hasta:
            if dia:  # cuota diaria sin hora de renovación: normalmente a medianoche UTC
                man = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=0, minute=0, second=5, microsecond=0)
                hasta = man.timestamp()
            else:
                hasta = time.time() + 75
        with _lock:
            _load()["agotado"][model_id] = {"hasta": hasta, "dia": dia or hasta - time.time() > 3600, "motivo": txt[:200], "t": time.time()}
        _save(force=True)
        return max(0, hasta - time.time())
    except Exception:
        return 0


# ───────────── consultas ─────────────
def _cupo(model_id):
    return (_load()["cupos"].get(model_id) or _load()["cupos"].get(_pid(model_id)) or {})


def agotado(model_id):
    """¿Se quedó sin cuota/tokens por ahora? → (True, hasta_ts, motivo) o (False, None, '')."""
    try:
        a = _load()["agotado"].get(model_id)
        if a and a.get("hasta", 0) > time.time():
            return True, a["hasta"], a.get("motivo", "")
        # cupo propio del usuario (tokens por día del proveedor)
        cup = _cupo(model_id)
        if cup.get("tokens_dia"):
            p = _load()["modelos"].get(_pid(model_id) + "::*") or {}
            if p.get("dia") == _hoy() and p.get("d_in", 0) + p.get("d_out", 0) >= int(cup["tokens_dia"]):
                man = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
                return True, man.timestamp(), f"llegó a tu cupo de {int(cup['tokens_dia']):,} tokens/día"
        # el proveedor dijo que quedan 0 llamadas/tokens en la ventana diaria
        lim = _load()["limites"].get(model_id) or {}
        for k, d in lim.items():
            if isinstance(d, dict) and k.endswith("_day") and d.get("quedan") == 0 and d.get("reset", 0) > time.time():
                return True, d["reset"], f"sin {k.split('_')[0]} por hoy"
    except Exception:
        pass
    return False, None, ""


def fraccion(model_id):
    """0..1 de lo que le queda en su ventana más ajustada (None si no se sabe)."""
    try:
        lim = _load()["limites"].get(model_id) or {}
        if time.time() - lim.get("t", 0) > 6 * 3600:
            return None
        fr = []
        for k, d in lim.items():
            if not isinstance(d, dict) or not d.get("limite") or d.get("quedan") is None:
                continue
            if d.get("reset") and d["reset"] < time.time():
                continue  # ya se renovó
            fr.append(max(0.0, min(1.0, d["quedan"] / d["limite"])))
        cup = _cupo(model_id)
        if cup.get("tokens_dia"):
            p = _load()["modelos"].get(_pid(model_id) + "::*") or {}
            usado = p.get("d_in", 0) + p.get("d_out", 0) if p.get("dia") == _hoy() else 0
            fr.append(max(0.0, 1 - usado / int(cup["tokens_dia"])))
        return min(fr) if fr else None
    except Exception:
        return None


def penalizacion(model_id):
    """Puntos que el evaluador resta: sin cuota → mucho; casi sin cuota → algo."""
    if _local(model_id):
        return 0
    ag, _, _ = agotado(model_id)
    if ag:
        return 60
    f = fraccion(model_id)
    if f is None:
        return 0
    return 15 if f < 0.08 else 7 if f < 0.2 else 0


def estado(model_id):
    """Resumen corto para el ranking y la UI."""
    m = _load()["modelos"].get(model_id) or {}
    hoy = m.get("dia") == _hoy()
    ag, hasta, mot = agotado(model_id)
    lim = _load()["limites"].get(model_id) or {}
    quedan = {k: d for k, d in lim.items() if isinstance(d, dict) and d.get("quedan") is not None}
    return {"hoy": (m.get("d_in", 0) + m.get("d_out", 0)) if hoy else 0, "hoy_llamadas": m.get("d_n", 0) if hoy else 0,
            "mes": (m.get("m_in", 0) + m.get("m_out", 0)) if m.get("mes") == _mes() else 0,
            "total": m.get("t_in", 0) + m.get("t_out", 0), "estimado": m.get("estimado", False),
            "quedan": quedan, "fraccion": fraccion(model_id), "agotado": ag, "hasta": hasta, "motivo": mot[:160]}


def texto_estado(model_id):
    e = estado(model_id)
    partes = []
    if e["agotado"]:
        partes.append("⛽ sin cuota hasta " + datetime.fromtimestamp(e["hasta"]).strftime("%d/%m %H:%M"))
    elif e["fraccion"] is not None:
        partes.append(f"⛽ le queda {e['fraccion'] * 100:.0f}%")
    if e["hoy"]:
        partes.append(f"hoy {e['hoy']:,} tokens" + (" (aprox.)" if e["estimado"] else ""))
    return " · ".join(partes)


def resumen():
    """Para el panel: por proveedor y por modelo (gasto de hoy/mes/total y lo que queda)."""
    d = _load()
    prov, mods = {}, {}
    for k in d["modelos"]:
        if k.endswith("::*"):
            prov[k[:-3]] = estado(k)
        else:
            mods[k] = estado(k)
    for k in set(d["agotado"]) | set(d["limites"]):
        if not k.endswith("::*") and k not in mods:
            mods[k] = estado(k)
    return {"proveedores": prov, "modelos": dict(sorted(mods.items(), key=lambda x: -x[1]["hoy"])), "cupos": d["cupos"]}


def poner_cupo(pid, tokens_dia):
    with _lock:
        if tokens_dia:
            _load()["cupos"][pid] = {"tokens_dia": int(tokens_dia)}
        else:
            _load()["cupos"].pop(pid, None)
    _save(force=True)


def liberar(model_id=None):
    """Olvida las marcas de «agotado» (botón del panel)."""
    with _lock:
        if model_id:
            _load()["agotado"].pop(model_id, None)
        else:
            _load()["agotado"].clear()
    _save(force=True)
