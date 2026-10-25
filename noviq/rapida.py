# -*- coding: utf-8 -*-
"""⚡ Respuestas rápidas de una IA para tareas cortas (corregir o mejorar un prompt, convertir una idea en el diseño de
un juego…). Elige la IA más rápida que funcionó bien en el 🧪 banco de pruebas y, si falla o tarda, prueba la siguiente.
No usa herramientas ni guarda nada en las conversaciones."""
import json
import re
import threading
import time

from .config import CONFIG, DATA_DIR


def _banco_rapidos():
    """Modelos del banco de pruebas con todas las respuestas bien y sin respuestas vacías, del más rápido al más lento."""
    f = DATA_DIR / "banco_pruebas.json"
    try:
        res = json.loads(f.read_text(encoding="utf-8")).get("resultados") or []
    except Exception:
        return []
    buenos = [r for r in res if r.get("aciertos", 0) >= max(1, r.get("total", 5) - 0) and not r.get("vacias")
              and r.get("seg_prom")]
    buenos.sort(key=lambda r: r["seg_prom"])
    return [r["modelo"] for r in buenos]


def candidatos(preferido=None):
    """Orden de IAs para una respuesta rápida."""
    from . import salud as S
    # 1) la elegida por el usuario, 2) las más rápidas que acertaron todo en el banco de pruebas, 3) su IA principal,
    # 4) la mejor del ranking, 5) el respaldo
    out = [preferido, (CONFIG.get("modelo_rapido") or "").strip()] + _banco_rapidos() + [CONFIG.get("model")]
    try:
        from . import evaluador as EV
        m, _ = EV.mejor("general", need_tools=False)
        out.append(m)
    except Exception:
        pass
    out += list(CONFIG.get("fallback_models") or [])
    vistos, res = set(), []
    for m in out:
        if not m or "::" not in m or m in vistos:
            continue
        vistos.add(m)
        pid = m.split("::", 1)[0]
        if not (CONFIG["providers"].get(pid) or {}).get("enabled"):
            continue
        try:
            if S.blocked(m):
                continue
        except Exception:
            pass
        res.append(m)
    return res


def _limpiar(texto):
    t = re.sub(r"<think(ing)?>.*?(</think(ing)?>|$)", "", texto or "", flags=re.S).strip()
    m = re.fullmatch(r"```[\w-]*\n(.*?)\n?```", t, flags=re.S)
    return (m.group(1) if m else t).strip()


def responder(system, usuario, preferido=None, max_tokens=2048, limite_seg=45, intentos=3, stop_ev=None, historial=None,
              temperatura=0.2):
    """(texto, modelo, ms) de la primera IA que responda bien. Lanza RuntimeError si ninguna responde.
    historial: mensajes previos [{"role": "user"|"assistant", "content": "…"}] (conversación del avatar)."""
    from .agent import extra_breve
    from .providers import APIError, stream_chat
    errores = []
    for m in candidatos(preferido)[:intentos]:
        corte = threading.Event()
        vencido = {"si": False}

        def _vence(c=corte, v=vencido):
            v["si"] = True
            c.set()
        timer = threading.Timer(limite_seg, _vence)
        timer.daemon = True
        timer.start()
        if stop_ev is not None:
            threading.Thread(target=lambda c=corte: (stop_ev.wait(limite_seg + 2), stop_ev.is_set() and c.set()), daemon=True).start()
        t0 = time.time()
        extra = dict(extra_breve(m) or {})
        extra.update({"max_tokens": max_tokens, "_read_timeout": limite_seg, "temperature": temperatura})
        try:
            msgs = [{"role": "system", "content": system}] + list(historial or []) + [{"role": "user", "content": usuario}]
            raw, reasoning, _calls, _fin = stream_chat(m, msgs, None, lambda *a: None, corte, extra=extra, max_attempts=1)
            texto = _limpiar(raw)
            if vencido["si"]:
                errores.append(f"{m.split('::')[-1]}: tardó más de {limite_seg} s")
                continue
            if not texto:
                errores.append(f"{m.split('::')[-1]}: respuesta vacía")
                continue
            return texto, m, int((time.time() - t0) * 1000)
        except APIError as e:
            errores.append(f"{m.split('::')[-1]}: {str(e).splitlines()[0][:120]}")
        except Exception as e:  # nunca rompe la ventana: se prueba la siguiente IA
            errores.append(f"{m.split('::')[-1]}: {type(e).__name__}: {e}"[:160])
        finally:
            timer.cancel()
    raise RuntimeError("; ".join(errores) or "no hay IAs activas con clave")


def json_de(texto):
    """Extrae el primer objeto JSON de una respuesta (con o sin ```json)."""
    t = _limpiar(texto)
    try:
        return json.loads(t)
    except Exception:
        pass
    i = t.find("{")
    while i >= 0:
        prof, j = 0, i
        en_cadena, esc = False, False
        while j < len(t):
            c = t[j]
            if en_cadena:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    en_cadena = False
            elif c == '"':
                en_cadena = True
            elif c == "{":
                prof += 1
            elif c == "}":
                prof -= 1
                if prof == 0:
                    try:
                        return json.loads(t[i:j + 1])
                    except Exception:
                        from .providers import _loads_lenient
                        v = _loads_lenient(t[i:j + 1])
                        if isinstance(v, dict):
                            return v
                    break
            j += 1
        i = t.find("{", i + 1)
    return None
