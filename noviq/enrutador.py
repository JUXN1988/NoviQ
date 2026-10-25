# -*- coding: utf-8 -*-
"""🧭 Enrutador de pedidos: decide A DÓNDE va cada cosa que le pides a Noviq (ventana, avatar, Telegram, MCP).

Antes todo lo que se le pedía al avatar (o por Telegram) caía en UNA sola conversación, aunque fueran temas o
proyectos distintos, y si esa conversación estaba ocupada el pedido se rechazaba o se abría otra sin criterio.
Ahora, para cada pedido el enrutador decide:

  • «misma»       → sigue la conversación actual (es una respuesta, un ajuste o el mismo tema);
  • «en_caliente» → la conversación actual está trabajando: el pedido va a su 📥 bandeja y se integra al plan;
  • «continuar»   → retoma OTRA conversación existente (dijiste «sigue con lo del login» o es claramente ese tema);
  • «nueva»       → abre una conversación nueva, dentro del proyecto que nombraste si existe, o marca que hay que
                    crear un proyecto nuevo («haz un proyecto nuevo llamado…»).

Cómo decide (lo fiable primero, la IA solo si hace falta):
  1. Frases explícitas: «nueva conversación…», «otro tema…», «nuevo proyecto…», «continúa con…», «en el proyecto X…».
  2. Nombres de tus proyectos dentro del pedido (sin importar tildes, mayúsculas, guiones ni espacios).
  3. Parecido de tema con la conversación actual y con las recientes (título, pedidos anteriores y tareas).
  4. Solo si queda en duda, la IA más rápida elige entre los candidatos (respuesta corta en JSON, validada).

Inspirado en las referencias entre sesiones, la búsqueda de sesiones y los títulos automáticos de DeepSeek Harness
(dsh-session-reference, dsh-tool-session-query, dsh-session-title; licencia MIT). Implementación propia de Noviq."""
import difflib
import json
import re
import time
import unicodedata

from .config import CONFIG, CONV_DIR

DEFAULTS = {"activo": True, "ia": True, "dias": 14, "max_candidatos": 40}

# ── frases explícitas (texto ya normalizado: minúsculas y sin tildes) ──
_NUEVA_CONV = re.compile(
    r"^\W*(?:(?:oye|ok|bueno|vale|ahora|porfa|por favor)\W+)?(?:"
    r"(?:abre|abrir|empieza|empezar|empecemos|inicia|iniciar|crea|crear|haz|hacer|comienza|comenzar)\s+(?:una?\s+)?(?:nueva|nuevo|otra|otro)\s+(?:conversacion|chat|platica|charla)"
    r"|(?:una?\s+)?(?:nueva|otra)\s+(?:conversacion|platica|charla)|(?:nuevo|otro)\s+chat"
    r"|(?:otro\s+tema|cambiando\s+de\s+tema|cambio\s+de\s+tema|aparte\s+de\s+eso|desde\s+cero|empecemos\s+de\s+nuevo)"
    r"|new\s+(?:chat|conversation)|(?:another|different)\s+topic)\b")
_NUEVO_PROYECTO = re.compile(
    r"\b(?:(?:un|otro)\s+)?(?:nuevo\s+proyecto|proyecto\s+nuevo|new\s+project)\b"
    r"|\b(?:crea(?:r|me)?|haz(?:me)?|hacer|inicia(?:r)?|empieza|arma(?:me)?)\s+(?:un|otro)\s+proyecto\b")
_NOMBRE_PROYECTO = re.compile(r"(?:llamado|llamada|que\s+se\s+llame|con\s+(?:el\s+)?nombre(?:\s+de)?|named|called)\s+[«\"'“]?([\w][\w .-]{1,40}?)[»\"'”]?(?=[,.;:!?]|\s+(?:que|para|con|y|donde|en|with|that)\b|$)")
_CONTINUAR = re.compile(
    r"\b(?:continu[ae](?:r|mos)?|sigue|seguir|sigamos|segui|retoma(?:r|mos)?|reanuda(?:r)?|vuelve\s+a|regresa\s+a"
    r"|lo\s+que\s+(?:estabamos|estaba|estabas|quedo)|donde\s+(?:nos\s+)?(?:quedamos|quedaste|quedo)|keep\s+going|resume|continue)\b")
_REFERENCIA = re.compile(
    r"^\W*(?:y\s|ademas|tambien|ahora\s|mejor\s|no[,.!]?\s|pero\s|agrega|anade|quita|elimina|cambia|cambiale|ponle|pon\s|haz\s+que|"
    r"que\s+(?:tenga|sea|haga|se\s+vea|funcione)|eso\b|esto\b|lo\s+mismo|otra\s+vez|de\s+nuevo|corrige(?:lo|la)?\b|arreglalo|arreglala|"
    r"si[,.!]?\s|si$|dale|ok|listo|perfecto|gracias|asi|igual|tambien|and\s|also|now\s|make\s+it|change|fix\s+it|add\s)")
_PROYECTO_NOMBRADO = re.compile(r"\b(?:proyecto|project|carpeta|repo|repositorio)\s+(?:de\s+|del\s+|llamado\s+)?[«\"'“]?([\w][\w.-]{1,40})")

_PALABRAS_CONTINUAR = {"continu", "continua", "continuar", "continue", "sigue", "seguir", "sigamo", "segui", "retoma",
                       "retomar", "reanuda", "reanudar", "vuelve", "regresa", "quedamo", "quedaste", "quedo", "estabamo",
                       "estaba", "estaba", "keep", "going", "resume"}
_STOP = set("""a al algo alla alli ante antes aqui asi aun bien cada como con contra cual cuando de del desde donde dos el ella
ellos en entre era es esa ese eso esta estaba estan estar este esto estos fue ha hace hacer han hasta hay la las le les lo
los mas me mi mis mucho muy nada ni no nos nuestra nuestro o otra otro para pero poco por porque pues que quien se sea ser
si sin sobre solo su sus tambien te tengo tiene todo todos tu tus un una uno unos y ya yo quiero quisiera necesito puedes
podrias haz hazme dame dime pon ponle favor porfa oye noviq ahora luego despues mejor mas menos the and for with that this
from you your please can could would should want need make let get all any are was have has not but what when where
which who will just""".split())


def cfg():
    return dict(DEFAULTS, **(CONFIG.get("enrutador") or {}))


# ── conversaciones ocupadas: app.py registra cómo saberlo (evita importar app desde aquí) ──
_ocupados_fn = None


def registrar_ocupados(fn):
    global _ocupados_fn
    _ocupados_fn = fn


def ocupados():
    try:
        return set(_ocupados_fn() if _ocupados_fn else [])
    except Exception:
        return set()


# ── texto ──
def normalizar(t):
    t = unicodedata.normalize("NFKD", str(t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _raiz(w):
    """Raíz muy simple (plurales y terminaciones comunes) para que «juegos» y «juego» cuenten igual."""
    for suf in ("aciones", "acion", "mente", "ados", "adas", "ando", "iendo", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[:-len(suf)]
    return w


def palabras(t):
    return {_raiz(w) for w in re.findall(r"[a-z0-9ñ]{3,}", normalizar(t)) if w not in _STOP}


def parecido(a_palabras, b_palabras):
    """Qué fracción de las palabras clave del pedido aparece en el tema de la conversación (0…1)."""
    if not a_palabras or not b_palabras:
        return 0.0
    exactas = a_palabras & b_palabras
    resto = [w for w in a_palabras - exactas if len(w) >= 5]
    casi = sum(1 for w in resto if difflib.get_close_matches(w, b_palabras, n=1, cutoff=0.86))
    return min(1.0, (len(exactas) + 0.6 * casi) / max(1, len(a_palabras)))


# ── proyectos ──
def _variantes(nombre):
    n = normalizar(nombre)
    sep = re.sub(r"[_.\-]+", " ", n).strip()
    camel = normalizar(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", str(nombre)))
    return {v for v in (n, sep, camel, sep.replace(" ", "")) if len(v) >= 3}


def _lista_proyectos():
    try:
        from . import tools as T
        return [p["name"] for p in T.list_projects() if p.get("existe", True)]
    except Exception:
        return []


def buscar_proyecto(texto, proyectos=None):
    """→ (nombre, puntaje) del proyecto existente que se menciona en el pedido, o (None, 0)."""
    n = " " + re.sub(r"[_.\-]+", " ", normalizar(texto)) + " "
    compacto = n.replace(" ", "")
    mejor, pmejor = None, 0.0
    for nombre in proyectos if proyectos is not None else _lista_proyectos():
        for v in _variantes(nombre):
            if (" " + v + " ") in n or (len(v) >= 6 and " " not in v and v in compacto):
                p = 1.0 + len(v) / 100   # el nombre más largo gana («juego naves 2» antes que «juego»)
                if p > pmejor:
                    mejor, pmejor = nombre, p
    if mejor:
        return mejor, min(pmejor, 1.0)
    m = _PROYECTO_NOMBRADO.search(normalizar(texto))
    if m:
        cand = m.group(1)
        for nombre in proyectos if proyectos is not None else _lista_proyectos():
            r = max((difflib.SequenceMatcher(None, cand, v).ratio() for v in _variantes(nombre)), default=0)
            if r >= 0.82 and r > pmejor:
                mejor, pmejor = nombre, r * 0.85
    return (mejor, pmejor) if mejor else (None, 0.0)


# ── conversaciones recientes (con caché por archivo) ──
_CACHE = {}


def _resumen_conv(p):
    try:
        mt = p.stat().st_mtime
    except OSError:
        return None
    c = _CACHE.get(p)
    if c and c[0] == mt:
        return c[1]
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
    st = d.get("estado") or {}
    pedidos = [x.get("texto", "") for x in (st.get("pedidos") or [])][-6:]
    tareas = [t.get("contenido", "") for t in (d.get("tasks") or [])][:12]
    tema = " ".join([d.get("title") or ""] + pedidos + tareas + [d.get("project") or ""])
    r = {"id": d.get("id"), "title": d.get("title") or "", "project": d.get("project"), "updated": d.get("updated") or mt,
         "origen": d.get("origen") or "", "pedidos": pedidos, "tareas": tareas, "palabras": palabras(tema),
         "n_user": sum(1 for x in d.get("display") or [] if x.get("type") == "user"),
         "a_medias": bool(d.get("en_progreso"))}
    _CACHE[p] = (mt, r)
    return r


def recientes(dias=None, limite=None, proyecto=None):
    c = cfg()
    dias = dias or c["dias"]
    limite = limite or c["max_candidatos"]
    corte = time.time() - dias * 86400
    archivos = []
    for p in CONV_DIR.glob("*.json"):
        try:
            mt = p.stat().st_mtime
        except OSError:
            continue
        if mt >= corte:
            archivos.append((mt, p))
    archivos.sort(reverse=True)
    out = []
    for _mt, p in archivos[:limite * 2]:
        r = _resumen_conv(p)
        if r and r.get("id") and (proyecto is None or r.get("project") == proyecto):
            out.append(r)
        if len(out) >= limite:
            break
    return out


def resumen(cid):
    from .server_state import conv_path
    return _resumen_conv(conv_path(cid)) if cid else None


def _puntaje(pal, r):
    s = parecido(pal, r["palabras"])
    edad = time.time() - (r.get("updated") or 0)
    s += 0.08 if edad < 3600 else (0.04 if edad < 86400 else 0.0)
    return s


def _titulo(texto):
    t = re.sub(r"\s+", " ", str(texto or "")).strip()
    t = re.sub(r"(?i)^(?:oye|ok|bueno|vale|ahora|porfa|por favor)\W+", "", t)
    return (t[:1].upper() + t[1:])[:60] if t else "Conversación"


def _nombre_proyecto(texto):
    m = _NOMBRE_PROYECTO.search(str(texto or ""))
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip(" .-")[:60]
    return ""


def _sin_frase_nueva(texto):
    """Quita «nueva conversación:» / «otro tema,» del principio: lo que queda es el pedido."""
    m = _NUEVA_CONV.search(normalizar(texto))
    if not m:
        return texto
    resto = str(texto)[m.end():].lstrip(" ,.:;-—–")
    resto = re.sub(r"(?i)^(?:para|sobre|de|acerca de|about|for)\s+", "", resto) if len(resto.split()) > 3 else resto
    return resto or texto


def _decision(accion, conv=None, proyecto=None, motivo="", confianza=0.8, via="reglas", **extra):
    d = {"accion": accion, "conv": conv, "proyecto": proyecto, "nuevo_proyecto": False, "nombre_proyecto": "",
         "titulo": "", "motivo": motivo, "confianza": round(float(confianza), 2), "sugerencia": None, "via": via,
         "texto": None}
    d.update(extra)
    return d


# ── la decisión ──
def decidir(texto, conv_actual=None, proyecto=None, modo="auto", usar_ia=None, proyectos=None):
    """Decide a dónde va un pedido.
    conv_actual: la conversación abierta (ventana) o la última usada por ese canal (avatar, Telegram).
    proyecto: el proyecto que el canal ya tiene elegido (si hay).
    modo: «ventana» (el usuario está mirando un chat: NUNCA se le cambia de chat salvo que lo pida explícitamente) o
          «auto» (avatar, Telegram, MCP: el enrutador elige libremente la mejor conversación).
    → dict con accion, conv, proyecto, nuevo_proyecto, nombre_proyecto, titulo, motivo, confianza, sugerencia, via,
      texto (el pedido sin la frase «nueva conversación…», si la había)."""
    c = cfg()
    texto = str(texto or "").strip()
    run = ocupados()
    act = resumen(conv_actual) if conv_actual else None
    if conv_actual and not act:
        conv_actual = None

    def con_actual(motivo, conf=0.8, sug=None):
        acc = "en_caliente" if conv_actual in run else "misma"
        return _decision(acc, conv_actual, (act or {}).get("project") or proyecto, motivo, conf, sugerencia=sug)

    if not c["activo"] or not texto:
        return con_actual("enrutador apagado o pedido vacío", 1.0) if conv_actual else \
            _decision("nueva", None, proyecto, "conversación nueva", 1.0, titulo=_titulo(texto))

    n = normalizar(texto)
    proyectos = proyectos if proyectos is not None else _lista_proyectos()
    proj, _pp = buscar_proyecto(texto, proyectos)

    # 1) «nuevo proyecto…» → conversación nueva que crea el proyecto
    if _NUEVO_PROYECTO.search(n):
        nombre = _nombre_proyecto(texto)
        return _decision("nueva", None, None, "pediste un proyecto nuevo" + (f" («{nombre}»)" if nombre else ""), 0.95,
                         nuevo_proyecto=True, nombre_proyecto=nombre, titulo=_titulo(texto))

    # 2) «nueva conversación… / otro tema…» → conversación nueva (en el proyecto nombrado, o en el del canal)
    if _NUEVA_CONV.search(n):
        resto = _sin_frase_nueva(texto)
        destino = proj or proyecto
        return _decision("nueva", None, destino, "pediste una conversación nueva" + (f" en el proyecto «{destino}»" if destino else ""),
                         0.95, titulo=_titulo(resto), texto=resto if resto != texto else None)

    pal = palabras(texto)
    continuar = bool(_CONTINUAR.search(n))
    pal_tema = {w for w in pal if w not in _PALABRAS_CONTINUAR}   # «sigue con lo del login» → {login}
    referencia = bool(_REFERENCIA.search(n)) and len(pal) <= 6   # «y además…», «eso no», «sí, dale»: solo en mensajes cortos

    # 3) la conversación actual
    if act:
        otro_proyecto = proj and act.get("project") != proj
        s_act = _puntaje(pal_tema or pal, act)
        if not (otro_proyecto and modo == "auto"):
            corto = len(pal) < 3 and not (continuar and pal_tema)
            sim_act = parecido(pal_tema or pal, act["palabras"])          # (sin el bono por actividad reciente)
            ref_ok = referencia and (len(pal_tema) <= 2 or sim_act > 0)   # «corrige el error del login» nombra OTRO tema
            if ref_ok or corto or s_act >= 0.34 or (continuar and not pal_tema and not proj):
                return con_actual("sigue el mismo tema" if s_act >= 0.34 else "es una respuesta o un ajuste a lo que se está haciendo",
                                  0.6 + min(0.35, s_act))
            if modo == "ventana":
                sug = "nueva" if (s_act < 0.12 and len(pal) >= 4 and act.get("n_user", 0) >= 2) else None
                if otro_proyecto:
                    sug = "proyecto:" + proj
                return con_actual("el chat abierto manda (lo elegiste tú)", 0.55, sug)

    # 4) otra conversación existente
    cands = [r for r in recientes(proyecto=proj or None) if r["id"] != conv_actual]
    puntuados = sorted(((_puntaje(pal_tema or pal, r), r) for r in cands), key=lambda x: -x[0])
    mejor_s, mejor = puntuados[0] if puntuados else (0.0, None)
    destino = proj or proyecto
    if continuar and mejor and (mejor_s >= 0.15 or proj):
        return _decision("en_caliente" if mejor["id"] in run else "continuar", mejor["id"], mejor.get("project"),
                         f"retomo «{mejor['title'][:50]}»", 0.75 + min(0.2, mejor_s))
    if continuar and act and not proj and modo == "auto" and not (mejor and mejor_s >= 0.15):
        return con_actual("no encontré otra conversación de ese tema: sigo con la actual", 0.5)
    if continuar and proj and not mejor:
        return _decision("nueva", None, proj, f"no hay conversaciones recientes de «{proj}»: abro una nueva en ese proyecto", 0.7,
                         titulo=_titulo(texto))
    if modo == "auto" and mejor and mejor_s >= 0.5 and len(pal) >= 2:
        return _decision("en_caliente" if mejor["id"] in run else "continuar", mejor["id"], mejor.get("project"),
                         f"es el mismo tema que «{mejor['title'][:50]}»", 0.6 + min(0.3, mejor_s - 0.5))

    # 5) en duda: la IA más rápida elige (solo en modo auto, o en ventana si dijo «continúa» sin tema claro)
    if (usar_ia if usar_ia is not None else c["ia"]) and (modo == "auto" or continuar) and puntuados and \
            (0.18 <= mejor_s < 0.5 or (act and modo == "auto")):
        d = _decidir_con_ia(texto, act, [r for _s, r in puntuados[:8]], proyectos, run)
        if d:
            return d

    if act and modo == "auto" and not proj:
        # sin parecido suficiente con nada y sin proyecto nombrado: tema nuevo (en el proyecto del canal, si lo tiene)
        return _decision("nueva", None, proyecto, "tema distinto de la conversación anterior", 0.6, titulo=_titulo(texto))
    return _decision("nueva", None, destino,
                     ("conversación nueva en el proyecto «" + destino + "»") if destino else "conversación nueva",
                     0.65 if proj else 0.55, titulo=_titulo(texto))


_SISTEMA_IA = """Eres el enrutador de Noviq, un asistente de programación. Decide a qué conversación va el NUEVO PEDIDO.
Responde SOLO un JSON: {"accion": "misma"|"continuar"|"nueva", "conv": "<id o null>", "proyecto": "<nombre exacto o null>", "nuevo_proyecto": false, "motivo": "<máx 12 palabras>"}
- "misma": responde, ajusta o continúa el tema de la CONVERSACIÓN ACTUAL.
- "continuar": es claramente el tema de otra conversación de la lista (pon su id en "conv").
- "nueva": es un tema distinto. Si menciona uno de los PROYECTOS, pon su nombre exacto en "proyecto"; si pide crear un proyecto, "nuevo_proyecto": true.
Ante la duda entre "misma" y "nueva", elige "nueva" (es mejor separar temas que mezclarlos)."""


def _decidir_con_ia(texto, act, cands, proyectos, run):
    try:
        from . import rapida as R
        lineas = []
        if act:
            lineas.append(f"CONVERSACIÓN ACTUAL: id={act['id']} · proyecto={act.get('project') or '-'} · «{act['title'][:60]}» · "
                          f"pedidos: {' | '.join(p[:80] for p in act.get('pedidos', [])[-3:])}")
        lineas.append("OTRAS CONVERSACIONES:")
        for r in cands:
            lineas.append(f"- id={r['id']} · proyecto={r.get('project') or '-'} · «{r['title'][:60]}» · "
                          f"pedidos: {' | '.join(p[:70] for p in r.get('pedidos', [])[-2:])}")
        lineas.append("PROYECTOS: " + (", ".join(proyectos[:40]) or "(ninguno)"))
        lineas.append(f"NUEVO PEDIDO: «{texto[:600]}»")
        raw, _m, _ms = R.responder(_SISTEMA_IA, "\n".join(lineas), max_tokens=200, limite_seg=12, intentos=2, temperatura=0.0)
        j = R.json_de(raw) or {}
    except Exception:
        return None
    acc = j.get("accion")
    ids = {r["id"]: r for r in cands}
    proj = j.get("proyecto") if j.get("proyecto") in proyectos else None
    motivo = "🤖 " + str(j.get("motivo") or "decidido por la IA")[:120]
    if acc == "misma" and act:
        return _decision("en_caliente" if act["id"] in run else "misma", act["id"], act.get("project"), motivo, 0.6, via="ia")
    if acc == "continuar" and j.get("conv") in ids:
        r = ids[j["conv"]]
        return _decision("en_caliente" if r["id"] in run else "continuar", r["id"], r.get("project"), motivo, 0.6, via="ia")
    if acc == "nueva":
        return _decision("nueva", None, proj, motivo, 0.6, via="ia", nuevo_proyecto=bool(j.get("nuevo_proyecto")),
                         titulo=_titulo(texto))
    return None


def preparar_texto(dec, texto):
    """El texto que se manda a la IA según la decisión (quita «nueva conversación:» y explica si hay que crear un proyecto)."""
    t = dec.get("texto") or texto
    if dec.get("nuevo_proyecto"):
        nombre = dec.get("nombre_proyecto")
        t += ("\n\n(Es un PROYECTO NUEVO: créalo primero con crear_proyecto"
              + (f" con el nombre «{nombre}»" if nombre else " con un nombre corto y claro") + " y trabaja dentro de él.)")
    return t
