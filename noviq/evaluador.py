# -*- coding: utf-8 -*-
"""🏆 Agente evaluador de IAs: aprende qué IA trabaja mejor en cada TIPO de tarea y hace que Noviq use (y cambie a) la mejor.

No es un LLM: es un agente de estadística que vive dentro del programa, no gasta tokens y nunca se cuelga.
Combina tres fuentes:
  1. Lo que ya se sabe de cada modelo (catálogo: inteligencia, razonamiento, programación, herramientas) → punto de partida.
  2. Lo que MIDE el programa en cada turno, por tipo de tarea (crear, arreglar, analizar, web, general):
       ✔ herramientas que funcionaron, tareas completadas, pruebas que pasan, trabajos terminados
       ✗ errores de herramientas, respuestas vacías, bucles, texto repetido, cortes del guardián, errores del servidor
         (500/timeout), imágenes que no acepta, atascos (se tuvo que escalar), trabajos abandonados a medias y DAÑOS
         (un archivo que funcionaba y la IA lo rompió).
  3. Las calificaciones del usuario (👍 / 👎 en cada respuesta), que pesan mucho.

Con eso calcula un puntaje 0-100 por modelo y tipo de tarea (promedio bayesiano: con pocos datos manda el catálogo;
con muchos, manda lo medido). Además pone en «enfriamiento» unos minutos a la IA que falla varias veces seguidas
(ej. NVIDIA respondiendo 500), para que el respaldo no pierda tiempo con ella.
Lo usan: el orden del respaldo, el escalador (cuando una IA se atasca), el director (continuación automática) y
el panel 🏆 Ranking de IAs. Todo está protegido: si algo falla aquí, el agente principal sigue normal."""
import json
import re
import threading
import time

from .config import CONFIG, DATA_DIR

FILE = DATA_DIR / "evaluador.json"
_lock = threading.RLock()
_db = None
_last_save = [0.0]
_dirty = [False]

TIPOS = {"crear": "🛠 Crear programas", "arreglar": "🩺 Arreglar / depurar", "web": "🌐 Webs y juegos",
         "analizar": "🔎 Analizar / revisar", "general": "💬 General"}
# evento → peso (positivos suman «aciertos», negativos suman «fallos»)
POS = {"ok": 1, "tarea": 3, "prueba_ok": 2, "fin": 6, "up": 8}
NEG = {"err": 1, "vacia": 3, "bucle": 4, "repite": 3, "guardian": 2, "api": 2, "imagen": 1, "atasco": 5,
       "prueba_mal": 2, "dano": 6, "abandono": 4, "down": 8}
NOMBRES = {"ok": "herramientas bien", "tarea": "tareas completadas", "prueba_ok": "pruebas OK", "fin": "trabajos terminados",
           "up": "👍", "err": "errores de herramientas", "vacia": "respuestas vacías", "bucle": "bucles", "repite": "texto repetido",
           "guardian": "cortes del guardián", "api": "fallos del servidor", "imagen": "imágenes rechazadas", "atasco": "atascos",
           "prueba_mal": "pruebas fallidas", "dano": "daños a archivos", "abandono": "trabajos abandonados", "down": "👎",
           "turno": "respuestas"}
K_GLOBAL = 12   # «observaciones virtuales» del catálogo: con menos datos que esto, pesa más el catálogo
K_TIPO = 8      # idem para el tipo de tarea (parte del puntaje global del modelo)
ENFRIAR = 600   # segundos de enfriamiento por cada fallo seguido del servidor (máx. 4)
CEREBRO_MAX = 37.0
# «Degradadas»: las IAs que más problemas dan últimamente bajan al final de la lista (se usan solo si no queda otra).
# Las de razonamiento («pensamiento») tienen un umbral más estricto: cuando fallan, pierden mucho tiempo y tokens.
EXITO = {"turno", "fin", "tarea", "prueba_ok", "up"}
FALLO = {"api", "vacia", "guardian", "bucle", "atasco", "abandono", "dano", "down", "repite"}
VENTANA, VENTANA_SEG = 16, 12 * 3600
DEGRADA = {"normal": (4, 0.5), "razona": (3, 0.35)}  # (mínimo de fallos, proporción de fallos) en la ventana reciente
PENA_DEGRADADA = 35

_RX_ANALIZAR = re.compile(r"(?i)^\W*(analiza|analizar|revisa|revisar|explica|expl[íi]came|audita|eval[úu]a|describe|"
                          r"dime qu[ée]|qu[ée] hace|haz un (informe|reporte|resumen)|informe|reporte|resumen|review|analy[sz]e|explain)")
_RX_ARREGLAR = re.compile(r"(?i)(no funciona|no sirve|no carga|no abre|no se ve|no responde|arregl|corrig|repar|depur|"
                          r"\bfalla|\bbug|\bfix\b|debug|roto|crash|no compila|se cierra|pantalla (en )?(blanco|negro)|"
                          r"(da|sale|salta|aparece|tira|lanza|tengo|me sale|me da)\s+(un\s+|el\s+)?error)")
_RX_WEB = re.compile(r"(?i)(\bweb\b|p[áa]gina|\bhtml\b|\bcss\b|javascript|\bjs\b|juego|\bgame\b|three\.?js|canvas|landing|"
                     r"sitio|portafolio|tetris|snake|pong)")
_RX_CREAR = re.compile(r"(?i)\b(crea|cr[ée]ame|haz|hazme|genera|construye|desarrolla|programa|implementa|escribe|"
                       r"make|build|create|write)\b")
_RX_ANALIZAR2 = re.compile(r"(?i)(analiza|revisa|explica|informe|reporte|resumen|audita|qu[ée] hace|review|analy)")


def activo():
    return (CONFIG.get("evaluador") or {}).get("activo", True) is not False


def cfg():
    return dict({"activo": True, "elegir_al_inicio": "si_falla", "min_datos": 6}, **(CONFIG.get("evaluador") or {}))


# ───────────── Persistencia ─────────────
def _load():
    global _db
    if _db is None:
        try:
            _db = json.loads(FILE.read_text(encoding="utf-8"))
        except Exception:
            _db = {}
        _db.setdefault("version", 1)
        _db.setdefault("modelos", {})
        _db.setdefault("eventos", [])
    return _db


def _save(force=False):
    try:
        if not force and time.time() - _last_save[0] < 4:
            _dirty[0] = True
            return
        with _lock:
            d = _load()
            del d["eventos"][:-400]
            tmp = FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(FILE)
            _last_save[0] = time.time()
            _dirty[0] = False
    except Exception:
        pass


def flush():
    """Guarda lo pendiente (se llama al terminar cada trabajo), también la 🪙 contabilidad de tokens."""
    if _dirty[0]:
        _save(force=True)
    try:
        from . import tokens as TK
        TK.flush()
    except Exception:
        pass


def _m(model_id):
    d = _load()["modelos"].setdefault(model_id, {})
    d.setdefault("g", {})
    d.setdefault("t", {})
    d.setdefault("ms", 0)
    d.setdefault("n_ms", 0)
    d.setdefault("racha", 0)
    d.setdefault("t_fallo", 0)
    d.setdefault("motivo", "")
    return d


# ───────────── Tipo de tarea ─────────────
def tipo_tarea(texto):
    t = (texto or "").strip()
    if not t:
        return "general"
    head = t[:160]
    if _RX_ANALIZAR.search(head) and not re.search(r"(?i)(no funciona|no sirve|no carga|arregl|corrig|repar)", head):
        return "analizar"
    if _RX_ARREGLAR.search(t[:1500]):
        return "arreglar"
    if _RX_WEB.search(t[:600]):
        return "web"
    if _RX_CREAR.search(t[:400]):
        return "crear"
    if _RX_ANALIZAR2.search(t[:400]):
        return "analizar"
    return "general"


def tipo_conv(conv):
    """Tipo de la tarea actual de una conversación (según el último pedido del usuario)."""
    try:
        if conv.get("_tipo"):
            return conv["_tipo"]
        pedidos = (conv.get("estado") or {}).get("pedidos") or []
        txt = pedidos[-1]["texto"] if pedidos else ""
        if not txt:
            for m in reversed(conv.get("messages") or []):
                c = m.get("content")
                if isinstance(c, list):
                    c = " ".join(p.get("text", "") for p in c if isinstance(p, dict))
                if m.get("role") == "user" and isinstance(c, str) and not c.startswith("["):
                    txt = c
                    break
        return tipo_tarea(txt)
    except Exception:
        return "general"


# ───────────── Registro de lo que pasa ─────────────
def registrar(model_id, ev, tipo="general", n=1, detalle=""):
    """Anota un evento de un modelo (ok, err, vacia, bucle, api, fin, up, down…)."""
    if not activo() or not model_id or (ev not in POS and ev not in NEG and ev != "turno"):
        return
    try:
        with _lock:
            m = _m(model_id)
            for c in (m["g"], m["t"].setdefault(tipo if tipo in TIPOS else "general", {})):
                c[ev] = max(0, c.get(ev, 0) + n)
            now = time.time()
            m["visto"] = now
            if n > 0 and (ev in EXITO or ev in FALLO):
                rec = m.setdefault("rec", [])
                rec.append([int(now), 0 if ev in FALLO else 1, ev])
                del rec[:-VENTANA]
            if ev == "api":
                m["racha"] = m.get("racha", 0) + 1
                m["t_fallo"] = now
                m["motivo"] = str(detalle)[:160]
            elif ev in ("ok", "turno", "tarea", "fin", "prueba_ok"):
                m["racha"] = 0
            if ev not in ("ok", "turno") and n > 0:
                _load()["eventos"].append([int(now), model_id, ev, tipo, str(detalle)[:160]])
        _save(force=ev in ("up", "down", "dano", "atasco", "fin"))
    except Exception:
        pass


def latencia(model_id, ms):
    try:
        with _lock:
            m = _m(model_id)
            m["ms"] += int(ms)
            m["n_ms"] += 1
    except Exception:
        pass


def en_enfriamiento(model_id):
    """¿El modelo falló varias veces seguidas hace poco? (se salta unos minutos)."""
    try:
        m = _load()["modelos"].get(model_id)
        if not m or m.get("racha", 0) < 2:
            return False
        return time.time() - m.get("t_fallo", 0) < ENFRIAR * min(m["racha"], 4)
    except Exception:
        return False


def es_razonador(model_id):
    """¿Es una IA de razonamiento / «pensamiento» (piensa largo antes de responder)?"""
    try:
        from . import catalogo as K
        name = model_id.split("::")[-1].lower()
        if K.RAZ_RX.search(name):
            return True
        tk = str(K.info(model_id).get("tokens") or "")
        return "razona" in tk or "piensa" in tk
    except Exception:
        return False


def degradada(model_id):
    """Texto con el motivo si la IA está dando muchos problemas últimamente (se manda al final de la lista), o ''."""
    try:
        m = _load()["modelos"].get(model_id) or {}
        lim = time.time() - VENTANA_SEG
        rec = [r for r in m.get("rec") or [] if r[0] >= lim]
        fallos = [r for r in rec if not r[1]]
        if len(fallos) < DEGRADA["razona"][0]:
            return ""
        raz = es_razonador(model_id)
        minimo, prop = DEGRADA["razona" if raz else "normal"]
        if len(fallos) >= minimo and len(fallos) / len(rec) >= prop:
            tipos = {}
            for r in fallos:
                tipos[r[2] if len(r) > 2 else "api"] = tipos.get(r[2] if len(r) > 2 else "api", 0) + 1
            det = ", ".join(f"{NOMBRES.get(k, k)} ×{v}" for k, v in sorted(tipos.items(), key=lambda x: -x[1])[:3])
            return (f"{'IA de razonamiento con' if raz else 'dio'} {len(fallos)} fallos de sus últimas {len(rec)} respuestas "
                    f"({det})")
    except Exception:
        pass
    return ""


def fuera(model_id):
    """Motivo por el que NO conviene usar esta IA ahora (va al final del respaldo), o '' si está bien:
    fallando seguido (enfriamiento), degradada por problemas recientes o ⛽ sin cuota/tokens."""
    try:
        if en_enfriamiento(model_id):
            st = _load()["modelos"].get(model_id) or {}
            return f"falló {st.get('racha', 0)} veces seguidas hace poco ({st.get('motivo', '')[:80]})"
        from . import tokens as TK
        ag, hasta, mot = TK.agotado(model_id)
        if ag:
            return f"⛽ sin cuota/tokens hasta las {time.strftime('%H:%M', time.localtime(hasta))}" + (f" ({mot[:80]})" if mot else "")
        return degradada(model_id)
    except Exception:
        return ""


def _vacio_cronico(model_id):
    """¿Más de la mitad de sus últimas respuestas fueron vacías? (con al menos 4 respuestas medidas)."""
    try:
        g = (_load()["modelos"].get(model_id) or {}).get("g") or {}
        turnos = g.get("turno", 0) + g.get("vacia", 0)
        return turnos >= 4 and g.get("vacia", 0) * 2 > turnos
    except Exception:
        return False


# ───────────── Puntaje ─────────────
def _pn(c):
    pos = sum((c or {}).get(k, 0) * w for k, w in POS.items())
    neg = sum((c or {}).get(k, 0) * w for k, w in NEG.items())
    return pos, neg


PRIOR_MIN, PRIOR_MAX = 0.30, 0.85  # lo que dice el catálogo sin pruebas propias nunca llega a 100/100


def _prior(model_id, info=None):
    """Punto de partida según el catálogo, COMPRIMIDO: un modelo que nunca se ha probado con tus tareas no puede ganarle
    a uno que ya demostró que trabaja bien. (Antes kimi-k3 sin ningún dato tenía 100/100 y el escalador le pasó el
    trabajo aunque en el registro devolvía respuestas vacías una y otra vez.)"""
    try:
        if info is None:
            from . import catalogo as K
            info = K.info(model_id)
        cer = info.get("cerebro", -1)
        if cer is None or cer < 0:
            return -1.0
        crudo = max(0.05, min(1.0, cer / CEREBRO_MAX))
        return PRIOR_MIN + (PRIOR_MAX - PRIOR_MIN) * crudo
    except Exception:
        return 0.5


def importar_registro(max_dias=21):
    """Una sola vez: aprende del registro técnico (datos/registro.log) lo que pasó ANTES de que existiera el evaluador:
    respuestas vacías, cortes del guardián y respuestas con herramientas de cada modelo."""
    try:
        d = _load()
        if d.get("registro_importado"):
            return 0
        f = DATA_DIR / "registro.log"
        d["registro_importado"] = True
        if not f.exists():
            _save(force=True)
            return 0
        lim = time.time() - max_dias * 86400
        rx = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \| ([^|]+?) \| .*?\| fin=([^|]*?) \| texto=(\d+) \| "
                        r"razonamiento=(\d+) \| llamadas=(\[[^\]]*\])")
        n = 0
        with _lock:
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                m = rx.match(line)
                if not m:
                    continue
                try:
                    ts = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))
                except ValueError:
                    continue
                if ts < lim:
                    continue
                modelo, fin, texto, raz, llam = m.group(2).strip(), m.group(3).strip(), int(m.group(4)), int(m.group(5)), m.group(6)
                mm = _m(modelo)
                vacia = llam == "[]" and fin != "guardian" and texto == 0 and raz < 400 and fin not in ("length",)
                for c in (mm["g"], mm["t"].setdefault("general", {})):
                    if vacia:  # igual que en vivo: una respuesta vacía no cuenta como turno
                        c["vacia"] = c.get("vacia", 0) + 1
                        continue
                    c["turno"] = c.get("turno", 0) + 1
                    if llam != "[]":
                        c["ok"] = c.get("ok", 0) + 1
                    elif fin == "guardian":
                        c["guardian"] = c.get("guardian", 0) + 1
                n += 1
        _save(force=True)
        return n
    except Exception:
        return 0


def puntaje(model_id, tipo="general", info=None, detalle=False):
    """Puntaje 0-100 (más es mejor) del modelo para ese tipo de tarea; -1 si no se puede usar."""
    prior = _prior(model_id, info)
    if prior < 0:
        return (-1, {}) if detalle else -1
    m = _load()["modelos"].get(model_id) or {}
    pg, ng = _pn(m.get("g"))
    base = (prior * K_GLOBAL + pg) / (K_GLOBAL + pg + ng)
    pt, nt = _pn((m.get("t") or {}).get(tipo))
    score = (base * K_TIPO + pt) / (K_TIPO + pt + nt) * 100
    extra = {}
    if m.get("n_ms"):
        prom = m["ms"] / m["n_ms"] / 1000
        extra["seg_prom"] = round(prom, 1)
        if prom > 90:
            score -= 4
        elif prom > 45:
            score -= 2
    if en_enfriamiento(model_id):
        score -= 30
        extra["enfriando"] = True
    deg = degradada(model_id)
    if deg:
        score -= PENA_DEGRADADA
        extra["degradada"] = deg
    try:
        from . import tokens as TK
        pen = TK.penalizacion(model_id)
        if pen:
            score -= pen
            extra["sin_cuota"] = pen >= 60
        if detalle:
            extra["tokens"] = TK.texto_estado(model_id)
            extra["razonador"] = es_razonador(model_id)
    except Exception:
        pass
    up, down = (m.get("g") or {}).get("up", 0), (m.get("g") or {}).get("down", 0)
    score = round(max(0.0, min(100.0, score)), 1)
    if detalle:
        extra.update({"catalogo": round(prior * 100), "datos": pg + ng, "datos_tipo": pt + nt, "up": up, "down": down,
                      "sin_datos": (pg + ng) == 0,
                      "racha": m.get("racha", 0), "motivo": m.get("motivo", "") if extra.get("enfriando") else ""})
        return score, extra
    return score


def _usable(m, i, need_tools=True):
    from . import salud
    if i.get("cerebro", -1) < 0 or salud.blocked(m):
        return False
    if need_tools and i.get("tools") is False:
        return False
    if str(i.get("cabe", "")).startswith("❌") or not i.get("chat", True):
        return False
    return True


def ranking(tipo="general", need_tools=True, excluir=(), incluir=(), n=12, solo_nube=False, con_detalle=False,
            solo_gratis=False):
    """[(modelo, puntaje)] de los modelos disponibles, de mejor a peor para ese tipo de tarea."""
    try:
        from . import catalogo as K
        try:
            infos = dict(K.all_infos())
        except Exception:
            infos = {}
        for m in list(incluir or []) + list(CONFIG.get("fallback_models") or []) + [CONFIG.get("model") or ""]:
            if m and m not in infos:
                try:
                    infos[m] = K.info(m)
                except Exception:
                    pass
        out = []
        for m, i in infos.items():
            if m in excluir or not _usable(m, i, need_tools):
                continue
            if solo_nube and i.get("local"):
                continue
            if solo_gratis and not i.get("gratis"):
                continue
            if con_detalle:
                s, det = puntaje(m, tipo, i, detalle=True)
                out.append((m, s, det))
            else:
                out.append((m, puntaje(m, tipo, i)))
        out.sort(key=lambda x: x[1], reverse=True)
        return out[:n]
    except Exception:
        return []


def mejor(tipo="general", actual=None, excluir=(), need_tools=True, solo_nube=True):
    """(modelo, puntaje) de la mejor IA disponible que no sea `actual` ni esté en enfriamiento, o (None, motivo)."""
    ex = set(excluir or ()) | ({actual} if actual else set())
    pago = (CONFIG.get("escalado") or {}).get("permitir_pago", True) is not False
    r = ranking(tipo, need_tools=need_tools, excluir=ex, solo_nube=solo_nube, n=30, solo_gratis=not pago)
    for m, s in r:
        if not fuera(m) and not _vacio_cronico(m):
            return m, s
    for m, s in r:  # si todas dan problemas: la menos mala que no esté fallando AHORA ni sin cuota
        if not en_enfriamiento(m) and not _sin_cuota(m):
            return m, s
    if solo_nube:
        return mejor(tipo, actual, excluir, need_tools, solo_nube=False)
    return None, "no hay otra IA habilitada que esté funcionando"


def _sin_cuota(model_id):
    try:
        from . import tokens as TK
        return TK.agotado(model_id)[0]
    except Exception:
        return False


def ordenar_cadena(chain, tipo="general", fijar_primero=True):
    """Reordena el respaldo: la elegida primero (salvo que esté fallando, degradada o sin cuota), luego las demás de
    mejor a peor; al final las que dan problemas (degradadas) y, detrás de todo, las que fallan ahora o no tienen cuota."""
    if not activo() or not chain:
        return list(chain)
    try:
        first, rest = chain[0], list(dict.fromkeys(chain[1:]))
        rest.sort(key=lambda m: puntaje(m, tipo), reverse=True)
        frias = [m for m in rest if en_enfriamiento(m) or _sin_cuota(m)]
        malas = [m for m in rest if m not in frias and degradada(m)]
        rest = [m for m in rest if m not in frias and m not in malas] + malas + frias
        if fijar_primero and not fuera(first):
            return [first] + [m for m in rest if m != first]
        return [m for m in rest if m != first] + [first]
    except Exception:
        return list(chain)


def modelo_inicial(conv, elegido):
    """Con qué IA empezar un trabajo. Respeta la elegida por el usuario salvo que el evaluador tenga pruebas claras de
    que ahora falla (enfriamiento) o rinde mucho peor en este tipo de tarea. Devuelve (modelo, motivo_o_None)."""
    if not activo():
        return elegido, None
    c = cfg()
    modo = c.get("elegir_al_inicio", "si_falla")
    if modo == "nunca":
        return elegido, None
    tipo = tipo_conv(conv)
    try:
        if modo == "siempre":
            m, s = mejor(tipo, excluir=(), solo_nube=False)
            if m and m != elegido:
                return m, f"es la mejor IA para «{TIPOS.get(tipo, tipo)}» según el ranking ({s:.0f}/100)"
            return elegido, None
        mot = fuera(elegido)
        if mot:
            m, s = mejor(tipo, actual=elegido)
            if m:
                return m, f"{elegido.split('::')[-1]} {mot}"
        mine = _load()["modelos"].get(elegido) or {}
        pt, nt = _pn((mine.get("t") or {}).get(tipo))
        if pt + nt >= int(c.get("min_datos", 6)) * 2:
            s_el = puntaje(elegido, tipo)
            m, s = mejor(tipo, actual=elegido)
            if m and s - s_el >= 25:
                return m, (f"en «{TIPOS.get(tipo, tipo)}» {elegido.split('::')[-1]} tiene {s_el:.0f}/100 y "
                           f"{m.split('::')[-1]} {s:.0f}/100")
    except Exception:
        pass
    return elegido, None


# ───────────── Calificación del usuario ─────────────
def calificar(conv, valor):
    """👍 (+1) / 👎 (-1) sobre el último turno: se reparte entre las IAs que trabajaron en él."""
    valor = 1 if int(valor) > 0 else -1
    tipo = tipo_conv(conv)
    modelos = dict(conv.get("_turno_modelos") or {})
    if not modelos:
        ms = (conv.get("estado") or {}).get("modelos") or []
        if ms:
            modelos = {ms[-1]: 1}
    if not modelos:
        return []
    turno = len(conv.get("display") or [])
    prev = conv.get("_calif") or {}
    if prev.get("turno") == turno and prev.get("valor") == valor:
        return list(modelos)
    if prev.get("turno") == turno:  # cambió de opinión: se deshace la anterior
        for m in prev.get("modelos") or []:
            registrar(m, "up" if prev["valor"] > 0 else "down", tipo, n=-1)
    # cada IA que trabajó en el turno recibe la calificación (se anota cuál fue la principal)
    top = max(modelos.items(), key=lambda x: x[1])[0]
    for m in modelos:
        registrar(m, "up" if valor > 0 else "down", tipo, n=1,
                  detalle="calificación del usuario" + (" (IA principal del turno)" if m == top else ""))
    conv["_calif"] = {"turno": turno, "valor": valor, "modelos": list(modelos)}
    return list(modelos)


# ───────────── Informes ─────────────
def resumen(n=12):
    """Datos para el panel 🏆 Ranking de IAs."""
    out = {"tipos": TIPOS, "ranking": {}, "eventos": [], "nombres": NOMBRES, "activo": activo(), "config": cfg()}
    for tipo in TIPOS:
        filas = []
        for m, s, det in ranking(tipo, need_tools=False, n=n, con_detalle=True):
            st = _load()["modelos"].get(m) or {}
            filas.append({"modelo": m, "puntaje": s, **det, "stats": dict(st.get("g") or {}),
                          "stats_tipo": dict((st.get("t") or {}).get(tipo) or {})})
        out["ranking"][tipo] = filas
    try:
        from . import tokens as TK
        out["tokens"] = TK.resumen()
        out["proveedores"] = {k: v.get("name", k) for k, v in (CONFIG.get("providers") or {}).items()}
    except Exception:
        out["tokens"] = {}
    out["degradadas"] = [{"modelo": m, "motivo": degradada(m)} for m in list(_load()["modelos"]) if degradada(m)]
    for ts, m, ev, tipo, det in reversed(_load()["eventos"][-60:]):
        out["eventos"].append({"t": ts, "modelo": m, "evento": NOMBRES.get(ev, ev), "tipo": tipo, "detalle": det,
                               "bueno": ev in POS})
    return out


def texto_ranking(tipo="general", n=5):
    r = ranking(tipo, n=n)
    if not r:
        return "(sin datos)"
    return "\n".join(f"{i + 1}. {m.replace('::', ' · ')} — {s:.0f}/100" + (f" ({fuera(m)[:70]})" if fuera(m) else "")
                     for i, (m, s) in enumerate(r))


def rehabilitar(model_id):
    """El usuario la devuelve a la lista de las mejores: se olvidan sus fallos recientes (no las estadísticas)."""
    with _lock:
        m = _load()["modelos"].get(model_id)
        if m:
            m["rec"], m["racha"] = [], 0
        _save(force=True)


def borrar(model_id=None):
    global _db
    with _lock:
        if model_id:
            _load()["modelos"].pop(model_id, None)
        else:
            _db = {"version": 1, "modelos": {}, "eventos": []}
        _save(force=True)
