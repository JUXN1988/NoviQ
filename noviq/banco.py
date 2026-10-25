# -*- coding: utf-8 -*-
"""🧪 Banco de pruebas de IAs: preguntas y respuestas reales para medir qué tan bien y qué tan rápido responde cada modelo
con TUS claves (no con datos de internet).

Cada modelo recibe 5 pruebas cortas:
  1. obedece   — responder exactamente una palabra
  2. cálculo   — una multiplicación (respuesta verificable)
  3. código    — una función de Python que se EJECUTA y se comprueba
  4. herramienta — llamar a una herramienta con los argumentos correctos (lo que más importa en un agente)
  5. español   — explicar algo en una frase (sin quedarse vacío)
Se mide: acierto, tiempo hasta la primera letra, tiempo total, velocidad y respuestas vacías/errores del servidor.
Los resultados alimentan al 🏆 evaluador (el ranking que decide a qué IA pasar el trabajo) y quedan en
datos/banco_pruebas.json y un informe datos/banco_pruebas_<fecha>.md.

Uso: botón «🧪 Banco de pruebas» en 🏆 Ranking de IAs, o desde la consola:
     python -m noviq.banco nvidia::moonshotai/kimi-k3 nvidia::z-ai/glm-5.3
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime

from .config import CONFIG, DATA_DIR, NO_WINDOW

RESULTADOS = DATA_DIR / "banco_pruebas.json"
LIMITE_SEG = 120  # máximo por pregunta
_estado = {"activo": False, "hechos": 0, "total": 0, "actual": "", "resultados": [], "inicio": 0, "fin": 0, "informe": ""}
_lock = threading.Lock()

HERRAMIENTA = [{"type": "function", "function": {
    "name": "sumar", "description": "Suma dos números enteros y devuelve el resultado.",
    "parameters": {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"]}}}]


def _prueba_codigo(texto):
    m = re.search(r"```(?:python|py)?\s*\n(.*?)```", texto, re.S)
    code = m.group(1) if m else texto
    if "def es_primo" not in code:
        return False, "no escribió def es_primo"
    test = code + "\n\nassert [n for n in range(1, 30) if es_primo(n)] == [2,3,5,7,11,13,17,19,23,29]\nprint('OK')\n"
    from .config import python_exe
    py = python_exe()
    if not py:
        return True, "escribió def es_primo (no hay Python en la PC para ejecutarlo)"
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(test)
        try:
            r = subprocess.run([py, f.name], capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
        finally:
            try:
                os.unlink(f.name)
            except OSError:
                pass
        if "OK" in r.stdout:
            return True, "el código funciona (primos del 1 al 29 correctos)"
        return False, "el código falla: " + (r.stderr.strip().splitlines() or ["resultado incorrecto"])[-1][:120]
    except Exception as e:
        return False, f"no se pudo ejecutar ({type(e).__name__})"


PRUEBAS = [
    {"id": "obedece", "nombre": "Obedece", "msg": "Responde solo con la palabra: listo",
     "ok": lambda t, c: (bool(re.fullmatch(r"\W*listo\W*", t.strip(), re.I)), "respondió exactamente «listo»"
                         if re.fullmatch(r"\W*listo\W*", t.strip(), re.I) else f"respondió «{t.strip()[:40]}»")},
    {"id": "calculo", "nombre": "Cálculo", "msg": "¿Cuánto es 17 × 23? Responde solo el número.",
     "ok": lambda t, c: ("391" in t.replace(".", "").replace(",", ""), "391 correcto" if "391" in t else f"respondió «{t.strip()[:40]}»")},
    {"id": "codigo", "nombre": "Código", "max_tokens": 4000,
     "msg": "Escribe una función de Python es_primo(n) que devuelva True si n es primo. Responde SOLO con el código en un bloque ```python.",
     "ok": lambda t, c: _prueba_codigo(t)},
    {"id": "herramienta", "nombre": "Herramienta", "tools": True,
     "msg": "Usa la herramienta sumar para calcular 1234 + 5678. No respondas con texto: llama a la herramienta.",
     "ok": lambda t, c: _eval_tool(c, t)},
    {"id": "espanol", "nombre": "Español", "msg": "Explica en UNA sola frase corta qué es una API.",
     "ok": lambda t, c: (len(t.strip()) >= 15 and len(t.strip()) <= 600, "frase correcta" if 15 <= len(t.strip()) <= 600
                         else ("vacía o muy corta" if len(t.strip()) < 15 else "demasiado larga"))},
]


def _eval_tool(calls, texto):
    from .providers import parse_text_tool_calls
    if not calls and texto:
        calls = parse_text_tool_calls(texto, {"sumar"})
        via = " (escrita como texto)"
    else:
        via = " (nativa)"
    for c in calls or []:
        f = c.get("function") or {}
        if f.get("name") == "sumar":
            try:
                a = json.loads(f.get("arguments") or "{}")
            except Exception:
                return False, "argumentos JSON inválidos"
            if {int(a.get("a", -1)), int(a.get("b", -1))} == {1234, 5678}:
                return True, "llamó a sumar(1234, 5678)" + via
            return False, f"llamó a sumar con {a}"
    return False, "no llamó a la herramienta" + (f"; escribió «{texto.strip()[:50]}»" if texto.strip() else "")


def _una(model_id, prueba, stop_ev):
    from .providers import APIError, stream_chat, strip_tool_text
    marcas = {"primero": None}
    t0 = time.time()

    def emit(kind, payload):
        if kind in ("token", "reasoning", "tool_delta") and marcas["primero"] is None:
            marcas["primero"] = time.time()

    msgs = [{"role": "system", "content": "Eres un asistente preciso. Responde en español."},
            {"role": "user", "content": prueba["msg"]}]
    extra = {"max_tokens": prueba.get("max_tokens", 2048), "_read_timeout": LIMITE_SEG}
    res = {"prueba": prueba["id"], "nombre": prueba["nombre"], "ok": False, "detalle": "", "ms": None, "ms_primero": None,
           "chars": 0, "razonamiento": 0, "vacia": False, "error": ""}
    # límite por pregunta: una IA que tarda más de LIMITE_SEG en contestar algo tan simple no sirve para trabajar
    local_stop = threading.Event()
    vencido = {"si": False}

    def _vence():
        vencido["si"] = True
        local_stop.set()
    timer = threading.Timer(LIMITE_SEG, _vence)
    timer.daemon = True
    timer.start()
    enlace = threading.Thread(target=lambda: (stop_ev.wait(LIMITE_SEG + 5), stop_ev.is_set() and local_stop.set()), daemon=True)
    enlace.start()
    try:
        raw, reasoning, calls, finish = stream_chat(model_id, msgs, HERRAMIENTA if prueba.get("tools") else None, emit, local_stop,
                                                    extra=extra, max_attempts=2)
        timer.cancel()
        if vencido["si"]:
            res.update(ms=int((time.time() - t0) * 1000), error=f"tardó más de {LIMITE_SEG} s (se cortó)", detalle="demasiado lenta")
            return res
        texto = strip_tool_text(raw)
        res.update(ms=int((time.time() - t0) * 1000), chars=len(texto), razonamiento=len(reasoning or ""), fin=finish,
                   ms_primero=int((marcas["primero"] - t0) * 1000) if marcas["primero"] else None)
        if not texto.strip() and not calls:
            res["vacia"] = True
            res["detalle"] = f"respuesta VACÍA (fin={finish}, {len(reasoning or '')} caracteres de razonamiento)"
            return res
        ok, det = prueba["ok"](texto, calls)
        res.update(ok=bool(ok), detalle=det, muestra=texto.strip()[:160])
    except APIError as e:
        timer.cancel()
        if vencido["si"]:
            res.update(ms=int((time.time() - t0) * 1000), error=f"tardó más de {LIMITE_SEG} s (se cortó)", detalle="demasiado lenta")
            return res
        res.update(ms=int((time.time() - t0) * 1000), error=str(e).split("\n")[0][:200], detalle="error del servidor",
                   status=getattr(e, "status", 0))
    except Exception as e:
        res.update(ms=int((time.time() - t0) * 1000), error=f"{type(e).__name__}: {e}"[:200], detalle="error")
    return res


def probar_modelo(model_id, stop_ev=None, pruebas=None):
    stop_ev = stop_ev or threading.Event()
    out = []
    for pr in pruebas or PRUEBAS:
        if stop_ev.is_set():
            break
        with _lock:
            _estado["actual"] = f"{model_id.split('::')[-1]} · {pr['nombre']}"
        r = _una(model_id, pr, stop_ev)
        out.append(r)
        with _lock:
            _estado["hechos"] += 1
        if r.get("error") and any(x in r["error"].lower() for x in ("clave", "401", "403", "no disponible", "not found", "404")):
            break  # el modelo no está disponible con tus claves: no tiene sentido seguir con las demás preguntas
        if len(out) >= 2 and all("tardó más" in (x.get("error") or "") for x in out[-2:]):
            break  # dos preguntas seguidas sin respuesta a tiempo: el servidor de ese modelo está saturado ahora
    aciertos = sum(1 for r in out if r["ok"])
    tiempos = [r["ms"] for r in out if r.get("ms") and not r.get("error")]
    primeros = [r["ms_primero"] for r in out if r.get("ms_primero")]
    resumen = {"modelo": model_id, "aciertos": aciertos, "total": len(PRUEBAS), "vacias": sum(1 for r in out if r["vacia"]),
               "errores": sum(1 for r in out if r.get("error")),
               "seg_prom": round(sum(tiempos) / len(tiempos) / 1000, 1) if tiempos else None,
               "seg_primero": round(sum(primeros) / len(primeros) / 1000, 1) if primeros else None,
               "herramientas": next((r["ok"] for r in out if r["prueba"] == "herramienta"), None),
               "pruebas": out, "t": datetime.now().isoformat(timespec="seconds")}
    resumen["nota"] = round(100 * aciertos / len(PRUEBAS) - 10 * resumen["vacias"] - (5 if (resumen["seg_prom"] or 0) > 30 else 0))
    _al_evaluador(model_id, out)
    return resumen


def _al_evaluador(model_id, out):
    try:
        from . import evaluador as EV
        for r in out:
            if r.get("error"):
                if r.get("status", 0) >= 500 or not r.get("status"):
                    EV.registrar(model_id, "api", "general", detalle="banco de pruebas: " + r["error"][:100])
            elif r["vacia"]:
                EV.registrar(model_id, "vacia", "general", detalle="banco de pruebas: " + r["nombre"])
            else:
                EV.registrar(model_id, "turno", "general")
                EV.registrar(model_id, "ok" if r["ok"] else "err", "general",
                             detalle=("" if r["ok"] else "banco de pruebas: " + r["nombre"] + " — " + r["detalle"][:80]))
                if r.get("ms"):
                    EV.latencia(model_id, r["ms"])
        EV.flush()
    except Exception:
        pass


def informe_md(resultados):
    lin = [f"# 🧪 Banco de pruebas de IAs — {datetime.now():%Y-%m-%d %H:%M}", "",
           "| Modelo | Aciertos | Herramientas | Vacías | Errores | 1.ª letra (s) | Promedio (s) | Nota |",
           "|---|---|---|---|---|---|---|---|"]
    for r in sorted(resultados, key=lambda x: x.get("nota", 0), reverse=True):
        lin.append(f"| {r['modelo']} | {r['aciertos']}/{r['total']} | {'✅' if r['herramientas'] else '❌' if r['herramientas'] is False else '—'} | "
                   f"{r['vacias']} | {r['errores']} | {r['seg_primero'] if r['seg_primero'] is not None else '—'} | "
                   f"{r['seg_prom'] if r['seg_prom'] is not None else '—'} | {r['nota']} |")
    lin.append("")
    for r in resultados:
        lin.append(f"## {r['modelo']}")
        for p in r["pruebas"]:
            est = "✅" if p["ok"] else ("⚠ vacía" if p["vacia"] else "❌")
            lin.append(f"- {est} **{p['nombre']}** — {p['detalle']}" + (f" · {p['ms'] / 1000:.1f} s" if p.get("ms") else "")
                       + (f" · error: {p['error']}" if p.get("error") else ""))
        lin.append("")
    return "\n".join(lin)


def ejecutar(modelos, stop_ev=None):
    """Prueba varios modelos (uno tras otro, para no chocar con el límite por minuto). Guarda el informe."""
    modelos = [m for m in dict.fromkeys(modelos) if m][:10]
    with _lock:
        _estado.update(activo=True, hechos=0, total=len(modelos) * len(PRUEBAS), actual="", resultados=[], inicio=time.time(),
                       fin=0, informe="")
    f = DATA_DIR / f"banco_pruebas_{datetime.now():%Y%m%d_%H%M}.md"
    try:
        for m in modelos:
            if stop_ev is not None and stop_ev.is_set():
                break
            r = probar_modelo(m, stop_ev)
            with _lock:
                _estado["resultados"].append(r)
                _estado["hechos"] = max(_estado["hechos"], len(_estado["resultados"]) * len(PRUEBAS))
            _guardar(list(_estado["resultados"]), f)  # se guarda tras CADA modelo (si se cierra Noviq no se pierde nada)
        return list(_estado["resultados"])
    finally:
        with _lock:
            _estado.update(activo=False, fin=time.time(), actual="")


def _guardar(res, f):
    try:
        RESULTADOS.write_text(json.dumps({"t": datetime.now().isoformat(timespec="seconds"), "resultados": res},
                                         ensure_ascii=False, indent=1), encoding="utf-8")
        f.write_text(informe_md(res), encoding="utf-8")
        with _lock:
            _estado["informe"] = str(f)
    except OSError:
        pass


_STOP = threading.Event()


def detener():
    _STOP.set()


def iniciar(modelos):
    if _estado["activo"]:
        return False
    _STOP.clear()
    threading.Thread(target=ejecutar, args=(modelos, _STOP), daemon=True).start()
    return True


def estado():
    with _lock:
        e = dict(_estado)
        e["resultados"] = list(_estado["resultados"])
    if not e["activo"] and not e["resultados"] and RESULTADOS.exists():
        try:
            e["resultados"] = json.loads(RESULTADOS.read_text(encoding="utf-8")).get("resultados", [])
            e["anterior"] = True
        except Exception:
            pass
    return e


def modelos_sugeridos(n=6):
    """El modelo elegido + el respaldo (lo que de verdad usa Noviq)."""
    ms = [CONFIG.get("model") or ""] + list(CONFIG.get("fallback_models") or [])
    return [m for m in dict.fromkeys(ms) if m][:n]


if __name__ == "__main__":
    mods = sys.argv[1:] or modelos_sugeridos()
    print("Probando:", ", ".join(mods))
    res = ejecutar(mods)
    print(informe_md(res))
