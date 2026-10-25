# -*- coding: utf-8 -*-
"""📅 Agente de agenda: las tareas programadas vistas como una agenda + las notas importantes de lo que hace Noviq.

- interpretar("lunes, miércoles y jueves a las 9") → {"tipo": "semanal", "dias": [0, 2, 3], "hora": "09:00"} (sin IA): así
  cualquier modelo, incluso uno pequeño, programa bien las tareas repetidas y quedan en «Nueva tarea programada».
- semana(): lo que va a pasar los próximos 7 días (para la vista de agenda y /agenda en Telegram).
- Notas: cada ejecución de una tarea deja su resultado resumido; cada aprobación/rechazo queda anotado; la IA puede guardar
  notas importantes (herramienta agenda accion='nota'). Todo en datos/agenda_notas.json (las últimas 600)."""
import json
import re
import threading
import time
import unicodedata
import uuid
from datetime import datetime, timedelta

from .config import DATA_DIR

NOTAS = DATA_DIR / "agenda_notas.json"
_lock = threading.Lock()
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
DIA_RX = {0: r"lunes|lun\b", 1: r"martes|mar\b", 2: r"miercoles|mie\b|mier\b", 3: r"jueves|jue\b", 4: r"viernes|vie\b",
          5: r"sabados?|sab\b", 6: r"domingos?|dom\b"}
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9,
         "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}


def _n(t):
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _hora(t):
    """«a las 9», «9:30», «3 pm», «8 de la noche», «mediodía» → "HH:MM" o None."""
    if re.search(r"medio ?dia", t):
        return "12:00"
    if "medianoche" in t:
        return "00:00"
    m = re.search(r"\b(\d{1,2})(?::|h|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?", t) or \
        re.search(r"\b(?:a las|a la|las|alas|at)\s+(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.|de la manana|de la tarde|de la noche|horas|hrs|h)?", t) or \
        re.search(r"\b(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.|de la manana|de la tarde|de la noche)\b", t)
    if not m:
        return None
    h, mi, suf = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "")
    if suf.startswith(("pm", "p.m", "de la tarde", "de la noche")) and h < 12:
        h += 12
    if suf.startswith(("am", "a.m")) and h == 12:
        h = 0
    if h > 23 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}"


def interpretar(texto, ahora=None):
    """Texto libre en español → «cuando» de programador (o None si no entiende)."""
    t = _n(texto)
    ahora = ahora or datetime.now()
    hora = _hora(t)
    # cada N minutos / horas
    m = re.search(r"cada\s+(\d+)\s*(minutos?|min|horas?|h)\b", t) or re.search(r"cada\s+(media hora|hora)\b", t)
    if m:
        if m.group(1) in ("media hora", "hora"):
            return {"tipo": "intervalo", "cada_min": 30 if m.group(1) == "media hora" else 60}
        n = int(m.group(1))
        return {"tipo": "intervalo", "cada_min": max(5, n * 60 if m.group(2).startswith("h") else n)}
    dias = set()
    if re.search(r"todos los dias|cada dia|diari[oa]|todas las (mananas|tardes|noches)|a diario|everyday|every day", t):
        dias = set(range(7))
    if re.search(r"entre semana|dias (laborables|habiles)|de lunes a viernes", t):
        dias |= set(range(5))
    if re.search(r"fines? de semana", t):
        dias |= {5, 6}
    r = re.search(r"de\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+a\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)", t)
    if r:
        a = next(k for k, rx in DIA_RX.items() if re.match(rx, r.group(1)))
        b = next(k for k, rx in DIA_RX.items() if re.match(rx, r.group(2)))
        dias |= set(range(a, b + 1)) if a <= b else set(range(a, 7)) | set(range(0, b + 1))
    if not r:
        for k, rx in DIA_RX.items():
            if re.search(r"\b(" + rx + r")", t):
                dias.add(k)
    repetido = bool(re.search(r"\b(cada|todos|todas|los (lunes|martes|miercoles|jueves|viernes|sabados|domingos)|semanal|siempre)\b", t)) \
        or len(dias) > 1 or dias == set(range(7))
    # fecha concreta: hoy / mañana / pasado mañana / el 5 de octubre / 2026-10-05
    fecha = None
    if re.search(r"\bpasado manana\b", t):
        fecha = (ahora + timedelta(days=2)).date()
    elif re.search(r"\bmanana\b", re.sub(r"(de|por|en) la manana|las mananas|cada manana", " ", t)):
        fecha = (ahora + timedelta(days=1)).date()
    elif re.search(r"\bhoy\b|esta (tarde|noche)", t):
        fecha = ahora.date()
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", t)
    if m:
        fecha = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
    m = re.search(r"\b(\d{1,2})\s+de\s+(" + "|".join(MESES) + r")(?:\s+(?:de\s+)?(\d{4}))?", t)
    if m:
        y = int(m.group(3) or ahora.year)
        f = datetime(y, MESES[m.group(2)], int(m.group(1))).date()
        if f < ahora.date() and not m.group(3):
            f = datetime(y + 1, MESES[m.group(2)], int(m.group(1))).date()
        fecha = f
    m = re.search(r"\ben\s+(\d+)\s*(minutos?|min|horas?)\b", t)
    if m and not dias:
        d = ahora + timedelta(minutes=int(m.group(1)) * (60 if m.group(2).startswith("h") else 1))
        return {"tipo": "una_vez", "fecha": d.strftime("%Y-%m-%dT%H:%M")}
    if fecha and not repetido:
        h = hora or "09:00"
        return {"tipo": "una_vez", "fecha": f"{fecha.isoformat()}T{h}"}
    if dias:
        c = {"tipo": "semanal" if len(dias) < 7 else "diario", "hora": hora or "08:00"}
        if len(dias) < 7:
            c["dias"] = sorted(dias)
        if not repetido and len(dias) == 1:  # «el jueves a las 5» (una vez: el próximo jueves)
            k = next(iter(dias))
            delta = (k - ahora.weekday()) % 7
            h = hora or "09:00"
            d = (ahora + timedelta(days=delta)).replace(hour=int(h[:2]), minute=int(h[3:]), second=0, microsecond=0)
            if d <= ahora:
                d += timedelta(days=7)
            return {"tipo": "una_vez", "fecha": d.strftime("%Y-%m-%dT%H:%M")}
        return c
    if hora and re.search(r"\b(cada|todos|todas|diario)\b", t):
        return {"tipo": "diario", "hora": hora}
    return None


# ───────────── Notas ─────────────
def _cargar():
    try:
        return json.loads(NOTAS.read_text(encoding="utf-8"))
    except Exception:
        return []


def nota(texto, tipo="nota", tarea=None, conv=None, importante=False):
    with _lock:
        ns = _cargar()
        n = {"id": uuid.uuid4().hex[:8], "t": time.time(), "texto": str(texto)[:4000], "tipo": tipo, "tarea": tarea, "conv": conv,
             "importante": bool(importante)}
        ns.append(n)
        ns = ns[-600:]
        tmp = NOTAS.with_suffix(".tmp")
        tmp.write_text(json.dumps(ns, ensure_ascii=False, indent=0), encoding="utf-8")
        tmp.replace(NOTAS)
    if importante:
        try:
            from . import telegram_bot as TG
            TG.avisar("📝 Nota importante: " + str(texto)[:3000], "notas")
        except Exception:
            pass
    return n


def notas(n=50, tipo=None, tarea=None, buscar=None):
    ns = _cargar()
    if tipo:
        ns = [x for x in ns if x.get("tipo") == tipo or (tipo == "importante" and x.get("importante"))]
    if tarea:
        ns = [x for x in ns if x.get("tarea") == tarea]
    if buscar:
        q = _n(buscar)
        ns = [x for x in ns if q in _n(x.get("texto"))]
    return ns[-n:][::-1]


def borrar_nota(nid):
    with _lock:
        ns = [x for x in _cargar() if x.get("id") != nid]
        NOTAS.write_text(json.dumps(ns, ensure_ascii=False, indent=0), encoding="utf-8")


def texto_notas(n=15):
    ns = notas(n)
    if not ns:
        return "📝 Todavía no hay notas."
    return "📝 Últimas notas:\n" + "\n".join(f"• {datetime.fromtimestamp(x['t']):%d/%m %H:%M} {'⭐ ' if x.get('importante') else ''}{x['texto'][:300]}"
                                            for x in ns)


# ───────────── Agenda (próximos días) ─────────────
def semana(dias=7):
    from . import programador as PG
    ahora = datetime.now()
    out = [{"fecha": (ahora + timedelta(days=i)).date().isoformat(), "dia": DIAS[(ahora + timedelta(days=i)).weekday()],
            "items": []} for i in range(dias)]
    fin = (ahora + timedelta(days=dias)).replace(hour=0, minute=0, second=0, microsecond=0)
    for t in PG.listar():
        c = t.get("cuando") or {}
        base = {"id": t["id"], "nombre": t.get("nombre"), "activa": t.get("activa"), "descripcion": t.get("descripcion"),
                "proyecto": t.get("proyecto")}
        if c.get("tipo") == "intervalo":
            for d in out:
                d["items"].append(dict(base, hora=f"cada {c.get('cada_min')} min"))
            continue
        cursor = ahora - timedelta(minutes=1)
        for _ in range(30):
            nx = PG.next_run(t, after=cursor)
            if not nx:
                break
            dt = datetime.fromtimestamp(nx)
            if dt >= fin:
                break
            for d in out:
                if d["fecha"] == dt.date().isoformat():
                    d["items"].append(dict(base, hora=dt.strftime("%H:%M")))
            cursor = dt
            if c.get("tipo") == "una_vez":
                break
    for d in out:
        d["items"].sort(key=lambda x: x["hora"])
    return out


def texto_semana():
    s = semana()
    lin = ["📅 Agenda de los próximos 7 días:"]
    vacia = True
    for i, d in enumerate(s):
        if not d["items"]:
            continue
        vacia = False
        etiqueta = "Hoy" if i == 0 else "Mañana" if i == 1 else d["dia"].capitalize()
        lin.append(f"\n{etiqueta} {d['fecha'][8:]}/{d['fecha'][5:7]}:")
        for it in d["items"]:
            lin.append(f"  {it['hora']} · {it['nombre']}" + ("" if it.get("activa") else " (pausada)"))
    if vacia:
        lin.append("No hay tareas programadas. Pídeme algo como «cada lunes, miércoles y jueves a las 8 revisa mis correos».")
    return "\n".join(lin)


def registrar_resultado(tarea_id, conv_id, resumen, error=None):
    """Lo llama app.py cuando termina la ejecución de una tarea programada."""
    from . import programador as PG
    txt = (f"❌ {error}" if error else (resumen or "(sin resumen)"))[:1500]
    PG.anotar_resultado(tarea_id, conv_id, txt, bool(error))
    t = next((x for x in PG.listar() if x["id"] == tarea_id), {})
    nota(f"⏰ {t.get('nombre', 'Tarea')}: {txt}", tipo="resultado", tarea=tarea_id, conv=conv_id)


# ───────────── Herramienta para la IA ─────────────
def tool(a, ctx):
    acc = (a.get("accion") or "semana").lower()
    try:
        if acc == "semana":
            return texto_semana()
        if acc == "nota":
            n = nota(a.get("texto") or "", "nota", a.get("tarea"), ctx.conv.get("id"), bool(a.get("importante")))
            return f"✔ Nota guardada ({n['id']})" + (" y avisada por Telegram." if a.get("importante") else ".")
        if acc == "notas":
            ns = notas(int(a.get("cantidad") or 20), a.get("tipo"), a.get("tarea"), a.get("buscar"))
            return "\n".join(f"[{x['id']}] {datetime.fromtimestamp(x['t']):%Y-%m-%d %H:%M} ({x.get('tipo')}) {x['texto'][:400]}" for x in ns) or "Sin notas."
        if acc == "interpretar":
            c = interpretar(a.get("texto") or "")
            return json.dumps(c, ensure_ascii=False) if c else "No entendí cuándo. Usa, por ejemplo: «lunes, miércoles y jueves a las 9»."
        return "ERROR: accion debe ser semana, nota, notas o interpretar."
    except Exception as e:
        return f"ERROR: {e}"


TOOL_DEF = {"type": "function", "function": {
    "name": "agenda",
    "description": "Agenda de Noviq: ver lo programado para los próximos 7 días, guardar notas importantes de lo que haces (con importante=true también se avisa por Telegram) y leer notas anteriores (resultados de tareas, aprobaciones). Para CREAR tareas repetidas usa programar_tarea.",
    "parameters": {"type": "object", "properties": {"accion": {"type": "string", "enum": ["semana", "nota", "notas", "interpretar"]},
                                                    "texto": {"type": "string"}, "importante": {"type": "boolean"},
                                                    "tipo": {"type": "string", "enum": ["nota", "resultado", "aprobacion", "importante"]},
                                                    "tarea": {"type": "string"}, "buscar": {"type": "string"}, "cantidad": {"type": "integer"}},
                   "required": ["accion"]}}}
