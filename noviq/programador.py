# -*- coding: utf-8 -*-
"""Tareas programadas de Noviq: la IA hace un trabajo sola a una hora (una vez, cada día, ciertos días
o cada N minutos) — revisar algo, generar un informe, abrir programas, probar un proyecto…
Funcionan mientras Noviq está abierto (activa «Iniciar Noviq con Windows» para que siempre lo esté).
Si el PC estaba apagado a la hora programada, la tarea se hace al abrir Noviq (si «recuperar» está activo)."""
import json
import re
import threading
import time
import uuid
from datetime import datetime, timedelta

from .config import DATA_DIR

FILE = DATA_DIR / "tareas_programadas.json"
_lock = threading.Lock()
_runner = None
DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def _load():
    try:
        return json.loads(FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(tasks):
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(tasks, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(FILE)


def _hm(s):
    h, m = (s or "08:00").split(":")[:2]
    return int(h), int(m)


def next_run(t, after=None):
    """Próxima ejecución (timestamp) o None."""
    now = after or datetime.now()
    c = t.get("cuando") or {}
    tipo = c.get("tipo", "una_vez")
    try:
        if tipo == "una_vez":
            d = datetime.fromisoformat(c.get("fecha"))
            return d.timestamp() if d > now or not t.get("ultima") else None
        if tipo == "intervalo":
            n = max(5, int(c.get("cada_min") or 60))
            base = datetime.fromtimestamp(t["ultima"]) if t.get("ultima") else now
            d = base + timedelta(minutes=n)
            return max(d, now + timedelta(seconds=20)).timestamp()
        if tipo in ("diario", "semanal"):
            h, m = _hm(c.get("hora"))
            dias = c.get("dias") if c.get("dias") else list(range(7))
            for k in range(0, 8):
                d = (now + timedelta(days=k)).replace(hour=h, minute=m, second=0, microsecond=0)
                if d > now and d.weekday() in dias:
                    return d.timestamp()
    except Exception:
        return None
    return None


def describe(t):
    c = t.get("cuando") or {}
    tipo = c.get("tipo")
    if tipo == "una_vez":
        return "una vez, " + (c.get("fecha") or "").replace("T", " ")[:16]
    if tipo == "intervalo":
        return f"cada {c.get('cada_min')} min"
    dias = c.get("dias")
    txt = "todos los días" if not dias or len(dias) == 7 else ", ".join(DIAS[d] for d in sorted(dias))
    return f"{txt} a las {c.get('hora', '08:00')}"


def listar():
    with _lock:
        ts = _load()
    for t in ts:
        t["descripcion"] = describe(t)
    return ts


def crear(nombre, instruccion, cuando, proyecto=None, modelo=None, autonomo=True, misma_conv=False, recuperar=True, id=None):
    with _lock:
        ts = _load()
        t = next((x for x in ts if x["id"] == id), None) if id else None
        if not t:
            t = {"id": uuid.uuid4().hex[:10], "creada": time.time(), "ultima": None, "historial": [], "activa": True}
            ts.append(t)
        t.update({"nombre": (nombre or instruccion[:40]).strip(), "instruccion": instruccion.strip(), "cuando": cuando,
                  "proyecto": proyecto or None, "modelo": modelo or None, "autonomo": bool(autonomo),
                  "misma_conv": bool(misma_conv), "recuperar": bool(recuperar)})
        t["proxima"] = next_run(t)
        if t["proxima"] is None or t["proxima"] < time.time() - 60:
            raise ValueError("La fecha/hora ya pasó o no es válida (usa AAAA-MM-DDTHH:MM en el futuro).")
        _save(ts)
        return t


def anotar_resultado(tid, conv_id, resultado, error=False):
    """Resultado resumido de la última ejecución (lo ve la agenda y llega a Telegram)."""
    with _lock:
        ts = _load()
        for t in ts:
            if t["id"] == tid:
                h = t.get("historial") or []
                if h and h[-1].get("conv") == conv_id:
                    h[-1]["resultado"] = ("❌ " if error else "✔ ") + resultado[:400]
                    h[-1]["fin"] = time.time()
                else:
                    h.append({"t": time.time(), "resultado": ("❌ " if error else "✔ ") + resultado[:400], "conv": conv_id, "fin": time.time()})
                t["historial"] = h[-20:]
        _save(ts)


def _dias(v):
    """[0, 2, 3] | «lunes, miércoles y jueves» | «L,X,J» → lista de días (0 = lunes)."""
    if not v:
        return None
    if isinstance(v, str):
        from .agenda import DIA_RX, _n
        t = _n(v)
        por_nombre = sorted({k for k, rx in DIA_RX.items() if re.search(r"\b(" + rx + r")", t)})
        if por_nombre:
            return por_nombre
        letras = {"l": 0, "m": 1, "x": 2, "j": 3, "v": 4, "s": 5, "d": 6}
        out = [letras[x] for x in re.findall(r"\b([lmxjvsd])\b", v.lower()) if x in letras]
        return sorted(set(out)) or None
    out = []
    for x in v:
        if isinstance(x, int) or str(x).isdigit():
            out.append(int(x) % 7)
        else:
            d = _dias(str(x))
            out += d or []
    return sorted(set(out)) or None


def eliminar(tid):
    with _lock:
        ts = [t for t in _load() if t["id"] != tid]
        _save(ts)


def activar(tid, on):
    with _lock:
        ts = _load()
        for t in ts:
            if t["id"] == tid:
                t["activa"] = bool(on)
                t["proxima"] = next_run(t) if on else None
        _save(ts)


def _mark(tid, result, conv_id=None):
    with _lock:
        ts = _load()
        for t in ts:
            if t["id"] == tid:
                t["ultima"] = time.time()
                if conv_id:
                    t["conv_id"] = conv_id
                t["historial"] = (t.get("historial") or [])[-19:] + [{"t": time.time(), "resultado": result, "conv": conv_id}]
                t["proxima"] = next_run(t)
                if t["proxima"] is None:
                    t["activa"] = False
        _save(ts)


def ejecutar_ahora(tid):
    t = next((x for x in _load() if x["id"] == tid), None)
    if not t or not _runner:
        return "no encontrada"
    try:
        cid = _runner(t)
        _mark(tid, "iniciada" if cid else "ocupada", cid)
        return cid or "ocupada"
    except Exception as e:
        _mark(tid, f"error: {e}")
        return f"error: {e}"


def _loop():
    first = True
    while True:
        try:
            now = time.time()
            for t in _load():
                if not t.get("activa") or not t.get("proxima"):
                    continue
                due = t["proxima"] <= now
                missed = first and due and now - t["proxima"] > 120
                if due and (not missed or t.get("recuperar", True)):
                    ejecutar_ahora(t["id"])
                elif missed:
                    _mark(t["id"], "omitida (PC apagado)")
            first = False
        except Exception:
            pass
        time.sleep(20)


def iniciar(runner):
    """runner(tarea) → id de la conversación iniciada (o None si estaba ocupada)."""
    global _runner
    if _runner:
        return
    _runner = runner
    threading.Thread(target=_loop, daemon=True, name="programador").start()


def tool(a, ctx):
    """Herramienta para la IA: programar_tarea."""
    acc = (a.get("accion") or "listar").lower()
    try:
        if acc == "listar":
            ts = listar()
            if not ts:
                return "No hay tareas programadas."
            return "\n".join(f"- [{t['id']}] {t['nombre']}: {t['descripcion']} · {'activa' if t.get('activa') else 'pausada'}"
                             + (f" · próxima {datetime.fromtimestamp(t['proxima']):%Y-%m-%d %H:%M}" if t.get("proxima") else "")
                             for t in ts)
        if acc == "eliminar":
            eliminar(a.get("id", ""))
            return f"Tarea {a.get('id')} eliminada."
        if acc in ("pausar", "reanudar"):
            activar(a.get("id", ""), acc == "reanudar")
            return f"Tarea {a.get('id')} {'reanudada' if acc == 'reanudar' else 'pausada'}."
        if acc == "crear":
            cuando = None
            if a.get("cuando"):  # texto libre: «lunes, miércoles y jueves a las 9», «cada 2 horas», «mañana a las 10»
                from .agenda import interpretar
                cuando = interpretar(str(a["cuando"]))
                if not cuando and not (a.get("tipo") or a.get("fecha") or a.get("hora") or a.get("dias")):
                    return (f"ERROR: no entendí «{a['cuando']}». Ejemplos: «lunes, miércoles y jueves a las 9», «todos los días a las 8», "
                            "«cada 30 minutos», «mañana a las 10», «el 5 de octubre a las 9».")
            if not cuando:
                tipo = a.get("tipo") or ("una_vez" if a.get("fecha") else "semanal" if a.get("dias") else "diario")
                cuando = {"tipo": tipo}
                if tipo == "una_vez":
                    cuando["fecha"] = a.get("fecha")
                elif tipo == "intervalo":
                    cuando["cada_min"] = int(a.get("cada_min") or 60)
                else:
                    cuando["hora"] = a.get("hora") or "08:00"
                    d = _dias(a.get("dias"))
                    if d and len(d) < 7:
                        cuando["dias"] = d
            t = crear(a.get("nombre"), a.get("instruccion") or "", cuando, a.get("proyecto") or ctx.conv.get("project"),
                      ctx.conv.get("model"), autonomo=a.get("autonomo", True))
            try:
                from . import agenda
                agenda.nota(f"📅 Programé «{t['nombre']}»: {describe(t)}", tipo="nota", tarea=t["id"], conv=ctx.conv.get("id"))
            except Exception:
                pass
            return (f"✔ Tarea programada [{t['id']}] «{t['nombre']}»: {describe(t)}. Próxima: "
                    f"{datetime.fromtimestamp(t['proxima']):%Y-%m-%d %H:%M}. (Se ejecuta mientras Noviq esté abierto; "
                    "el usuario la ve en la 📅 Agenda de 🖥 PC y tareas y el resultado le llega por Telegram si lo vinculó.)")
        return "ERROR: accion debe ser crear, listar, eliminar, pausar o reanudar."
    except Exception as e:
        return f"ERROR: {e}"


TOOL_DEF = {"type": "function", "function": {
    "name": "programar_tarea",
    "description": "Programa un trabajo para que Noviq lo haga solo más tarde o de forma repetida y queda en la Agenda (🖥 PC y tareas). ÚSALA SIEMPRE que el usuario diga cuándo repetir algo («los lunes, miércoles y jueves», «todos los días a las 8», «cada 2 horas», «mañana a las 10»): pasa ese texto en 'cuando' tal cual. También lista, pausa, reanuda o elimina.",
    "parameters": {"type": "object", "properties": {
        "accion": {"type": "string", "enum": ["crear", "listar", "eliminar", "pausar", "reanudar"]},
        "nombre": {"type": "string"}, "instruccion": {"type": "string", "description": "Qué debe hacer la IA cuando se ejecute (instrucción completa)"},
        "cuando": {"type": "string", "description": "Cuándo, en palabras del usuario: «lunes, miércoles y jueves a las 9», «cada 30 minutos», «mañana a las 10»"},
        "tipo": {"type": "string", "enum": ["una_vez", "diario", "semanal", "intervalo"]},
        "fecha": {"type": "string", "description": "Para una_vez: AAAA-MM-DDTHH:MM (hora local)"},
        "hora": {"type": "string", "description": "Para diario/semanal: HH:MM"},
        "dias": {"type": "array", "items": {"type": "integer"}, "description": "0=lunes, 1=martes, 2=miércoles, 3=jueves, 4=viernes, 5=sábado, 6=domingo"},
        "cada_min": {"type": "integer"}, "proyecto": {"type": "string"}, "id": {"type": "string"},
        "autonomo": {"type": "boolean", "description": "Ejecutar sin pedir permisos (por defecto true)"}},
        "required": ["accion"]}}}
