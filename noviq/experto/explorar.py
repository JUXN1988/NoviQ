# -*- coding: utf-8 -*-
"""🔎 explorar_codigo: responde «¿dónde está X?» en UNA llamada y sin IA.

Una IA pequeña gasta 5-15 llamadas buscando (el caso real del «cóndor» tardó 10 minutos y se canceló) porque:
busca en español y el código está en inglés («salto» vs «jump»), no prueba sinónimos, y lee archivos enteros.
Aquí se hace lo que haría un programador: se sacan las palabras clave de la pregunta, se amplían con sinónimos
español↔inglés y con las partes de los identificadores (camelCase, snake_case), se puntúa cada zona del código
(nombres de funciones/clases y del archivo pesan más; las palabras que aparecen en todas partes, menos) y se
devuelven las 3-6 mejores zonas con sus números de línea y la función que las contiene.
"""
import math
import os
import re
import unicodedata
from pathlib import Path

STOP = set("""a al algo alli ante aqui asi como con cual cuales cuando de del desde donde dos el ella ellas ellos en
entre era es esa ese eso esta este esto estos estas fue ha hay la las le les lo los mas me mi mis muy no nos o para
pero por porque que quien se ser si sin sobre su sus tambien te tiene tu un una unas uno unos y ya yo quiero quisiera
puedes podrias dime muestra muestrame ensename ver busca buscar encuentra encontrar codigo archivo archivos parte
funcion programa proyecto hace hacer esta estan cosa cosas linea lineas the a an of to in on for is are be where
which what how does do code file files function find show me please controla controlan maneja manejan define
the and or that this with""".split())

# conceptos frecuentes en juegos, webs y programas (español → inglés y variantes)
SINONIMOS = {
    "salto": ["jump", "saltar", "salta", "jumping", "vy", "impulso", "gravedad", "gravity"],
    "saltar": ["jump", "salto", "vy", "impulso"],
    "vuelo": ["fly", "flight", "volar", "vuela", "alas", "wings", "glide", "planear"],
    "volar": ["fly", "flight", "vuelo", "alas", "wings"],
    "mover": ["move", "movement", "mueve", "movimiento", "velocity", "velocidad", "speed", "dx", "dy"],
    "movimiento": ["move", "movement", "mover", "velocity", "velocidad", "speed"],
    "velocidad": ["speed", "velocity", "vel", "rapidez"],
    "tecla": ["key", "keydown", "keyup", "keyboard", "teclado", "teclas", "input", "controles"],
    "teclado": ["key", "keydown", "keyboard", "tecla", "input"],
    "control": ["controls", "input", "key", "tecla", "controles"],
    "controles": ["controls", "input", "key", "tecla", "keydown"],
    "raton": ["mouse", "click", "pointer", "cursor"],
    "clic": ["click", "mouse", "onclick", "pointer"],
    "disparo": ["shoot", "fire", "bullet", "bala", "disparar", "proyectil"],
    "disparar": ["shoot", "fire", "bullet", "bala", "disparo"],
    "bala": ["bullet", "shoot", "proyectil", "projectile"],
    "enemigo": ["enemy", "enemies", "enemigos", "monster", "monstruo", "zombie", "ia"],
    "jugador": ["player", "hero", "heroe", "personaje", "character"],
    "personaje": ["character", "player", "jugador", "hero", "npc"],
    "vida": ["health", "life", "lives", "hp", "vidas", "salud"],
    "vidas": ["lives", "life", "health", "vida"],
    "puntos": ["score", "points", "puntaje", "puntuacion"],
    "puntaje": ["score", "points", "puntos", "puntuacion"],
    "puntuacion": ["score", "points", "puntos", "puntaje"],
    "nivel": ["level", "levels", "niveles", "stage", "zona", "mundo"],
    "colision": ["collision", "collide", "hit", "choque", "intersect", "overlap"],
    "choque": ["collision", "collide", "hit", "colision"],
    "camara": ["camera", "cam", "view", "vista"],
    "sonido": ["sound", "audio", "music", "musica", "sfx", "play"],
    "musica": ["music", "audio", "sound", "sonido"],
    "pantalla": ["screen", "display", "canvas", "render", "draw"],
    "dibujar": ["draw", "render", "paint", "canvas", "dibuja"],
    "fondo": ["background", "bg", "sky", "cielo"],
    "menu": ["menu", "pause", "pausa", "inicio", "start", "title"],
    "pausa": ["pause", "paused", "menu"],
    "inicio": ["start", "init", "begin", "main", "iniciar", "setup", "load"],
    "iniciar": ["init", "start", "setup", "begin", "inicio", "main"],
    "fin": ["end", "gameover", "game_over", "finish", "win", "lose", "victoria", "derrota"],
    "guardar": ["save", "store", "write", "persist", "localstorage"],
    "cargar": ["load", "read", "fetch", "import"],
    "boton": ["button", "btn", "click", "onclick"],
    "ventana": ["window", "dialog", "modal", "frame"],
    "usuario": ["user", "usuario", "login", "account", "cuenta"],
    "contrasena": ["password", "pass", "pwd", "clave"],
    "clave": ["key", "password", "token", "secret"],
    "error": ["error", "exception", "catch", "throw", "fail", "falla"],
    "archivo": ["file", "path", "fs"],
    "red": ["network", "fetch", "request", "http", "api"],
    "servidor": ["server", "api", "route", "endpoint", "flask", "express"],
    "base": ["database", "db", "sql", "sqlite"],
    "datos": ["data", "db", "json", "store"],
    "fecha": ["date", "time", "datetime", "fecha"],
    "tiempo": ["time", "timer", "clock", "delay", "timeout", "reloj"],
    "arma": ["weapon", "gun", "sword", "espada"],
    "espada": ["sword", "weapon", "attack", "ataque"],
    "ataque": ["attack", "hit", "damage", "dano"],
    "dano": ["damage", "hurt", "hit"],
    "moneda": ["coin", "coins", "money", "gold", "monedas"],
    "gemas": ["gem", "gems", "jewel", "crystal", "cristal"],
    "condor": ["condor", "bird", "ave", "pajaro", "eagle"],
    "ave": ["bird", "condor", "pajaro"],
    "agua": ["water", "sea", "lake", "lago", "river"],
    "terreno": ["terrain", "ground", "floor", "suelo", "map", "mapa"],
    "suelo": ["ground", "floor", "terrain", "onground", "ensuelo"],
    "luz": ["light", "lights", "lamp", "sun", "sol"],
    "color": ["color", "colour", "rgb", "hex"],
    "texto": ["text", "label", "font", "string"],
    "imagen": ["image", "img", "sprite", "texture", "textura"],
    "animacion": ["animation", "animate", "anim", "tween", "frame"],
    "precio": ["price", "cost", "amount", "total"],
    "total": ["total", "sum", "amount"],
    "correo": ["email", "mail", "smtp"],
    "pdf": ["pdf", "fpdf", "report", "informe"],
    "informe": ["report", "pdf", "summary", "resumen"],
}


_POR_RAIZ = {}


def _norm(s):
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()


def _raiz(w):
    """Tallo aproximado: «salta», «salto», «saltar» → «salt»; «dispara», «disparo» → «dispar»."""
    for suf in ("aciones", "acion", "amientos", "amiento", "imientos", "imiento", "mente", "ando", "iendo", "ados", "adas",
                "idos", "idas", "ado", "ada", "ido", "ida", "ar", "er", "ir", "as", "es", "os", "an", "en", "a", "e", "o", "s"):
        if len(w) - len(suf) >= 4 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _sinonimos(n):
    return SINONIMOS.get(n) or SINONIMOS.get(_POR_RAIZ.get(_raiz(n), ""), [])


def terminos(pregunta):
    """Palabras clave (con su peso) a partir de una pregunta en lenguaje natural o identificadores."""
    crudo = re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ_][\wÁÉÍÓÚÜÑáéíóúüñ]*", str(pregunta or ""))
    out = {}
    for w in crudo:
        w = unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode()  # sin tildes, conserva mayúsculas
        if _norm(w) in STOP:
            continue
        partes = [w] + re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", w) + w.split("_")
        for p in partes:
            n = _norm(p)
            if len(n) < 3 or n in STOP:
                continue
            out[n] = max(out.get(n, 0), 1.0)
            for s in _sinonimos(n):
                s = _norm(s)
                if len(s) >= 2:
                    out.setdefault(s, 0.7)
            r = _raiz(n)
            if r != n and len(r) >= 4:
                out.setdefault(r, 0.8)
    return out


for _k in list(SINONIMOS):
    _POR_RAIZ.setdefault(_raiz(_k), _k)

EXT_CODIGO = {".py", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".json", ".cs", ".java", ".kt",
              ".php", ".ps1", ".bat", ".go", ".rs", ".dart", ".ino", ".cpp", ".c", ".h", ".vue", ".svelte", ".sql", ".gd", ".lua",
              ".rb", ".swift", ".md", ".yml", ".yaml", ".toml", ".ini", ".xml", ".sh"}
SALTAR = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".gradle", "bin", "obj", ".idea",
          ".vs", ".noviq", ".noviq_logs", "entregas", "site-packages", "capturas", "vendor"}
VENDOR = re.compile(r"(?i)^(three|jquery|react|react-dom|vue|bootstrap|phaser|babylon|pixi|cannon|ammo|p5|d3|chart|lodash|"
                    r"tailwind|socket\.io|gsap|howler|matter|tone)([.\-][\w.\-]*)?\.(js|css)$")
DEF = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:def|class|function|func|fn|sub|procedure)\s+([A-Za-z_][\w$]*)|"
                 r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w$]*)\s*=\s*(?:async\s*)?(?:function|\(|[A-Za-z_]\w*\s*=>)|"
                 r"^\s*(?:public|private|protected|static|async|override|virtual|\s)*[\w<>\[\],]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$|"
                 r"^\s{2,}([A-Za-z_]\w*)\s*\([^)]*\)\s*\{\s*$")


def _archivos(raiz: Path, max_archivos=600):
    salto = SALTAR
    n = 0
    for dp, dns, fns in os.walk(raiz):
        dns[:] = [d for d in dns if d not in salto and not d.startswith(".")]
        for f in fns:
            p = Path(dp) / f
            if p.suffix.lower() not in EXT_CODIGO or f.endswith((".min.js", ".min.css")) or f == "activos_datos.js" or VENDOR.match(f):
                continue
            try:
                if p.stat().st_size > 800_000:
                    continue
            except OSError:
                continue
            n += 1
            if n > max_archivos:
                return
            yield p


def _leer(p: Path):
    try:
        from .. import texto as TX
        return TX.read_text(p)
    except Exception:
        try:
            return p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""


def explorar(pregunta, raiz: Path, max_resultados=5, contexto=6):
    """Devuelve texto con las mejores zonas del código para la pregunta."""
    raiz = Path(raiz)
    if raiz.is_file():
        archivos = [raiz]
        base = raiz.parent
    else:
        archivos = list(_archivos(raiz))
        base = raiz
    T = terminos(pregunta)
    if not T:
        return "ERROR: la pregunta no tiene palabras para buscar. Ej.: explorar_codigo(pregunta='dónde se controla el salto del jugador')."
    if not archivos:
        return f"No hay archivos de código en {raiz}."
    datos = []
    df = {t: 0 for t in T}
    # términos cortos (vy, hp, db…) solo como palabra completa; los largos también dentro de identificadores
    esta = {t: ((lambda x, t=t: t in x) if len(t) > 3 else re.compile(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])").search)
            for t in T}
    for p in archivos:
        txt = _leer(p)
        if not txt:
            continue
        lineas = txt.split("\n")
        normal = [_norm(x) for x in lineas]
        presentes = set()
        nombre = _norm(p.stem)
        for t in T:
            if esta[t](nombre) or any(esta[t](x) for x in normal):
                presentes.add(t)
        for t in presentes:
            df[t] += 1
        if presentes:
            datos.append((p, lineas, normal, presentes))
    if not datos:
        return (f"No encontré nada sobre «{pregunta}» en {len(archivos)} archivos (busqué: {', '.join(list(T)[:12])}). "
                "Prueba con otras palabras o con buscar_en_archivos.")
    N = max(1, len(archivos))
    idf = {t: math.log(1 + N / (1 + df[t])) + 0.2 for t in T}
    zonas = []
    for p, lineas, normal, presentes in datos:
        nombre = _norm(p.stem)
        bonus_archivo = sum(T[t] * idf[t] for t in presentes if esta[t](nombre)) * 0.8
        defs = {}
        actual = None
        for i, x in enumerate(lineas):
            m = DEF.match(x)
            if m:
                actual = next(g for g in m.groups() if g)
                defs[i] = actual
            defs.setdefault(i, actual)
        puntos = []
        for i, x in enumerate(normal):
            hits = [t for t in presentes if esta[t](x)]
            if not hits:
                continue
            w = sum(T[t] * idf[t] for t in hits)
            if DEF.match(lineas[i]):
                w *= 2.2
            elif x.lstrip().startswith(("//", "#", "/*", "*", "<!--")):
                w *= 1.3  # los comentarios suelen explicar en español qué hace el código
            puntos.append((i, w, hits))
        # agrupa líneas cercanas en zonas
        grupo = []
        for i, w, hits in puntos + [(10 ** 9, 0, [])]:
            if grupo and i - grupo[-1][0] > 12:
                ini, fin = grupo[0][0], grupo[-1][0]
                terms = set(h for g in grupo for h in g[2])
                s = sum(g[1] for g in grupo) + len(terms) * 1.5 + bonus_archivo
                fn = defs.get(ini)
                if fn and _norm(fn) and any(t in _norm(fn) for t in T):
                    s += 3
                zonas.append((s, p, ini, fin, terms, fn))
                grupo = []
            if i < 10 ** 9:
                grupo.append((i, w, hits))
    zonas.sort(key=lambda z: -z[0])
    out, vistos = [], set()
    for s, p, ini, fin, terms, fn in zonas:
        clave = (p, ini // 20)
        if clave in vistos:
            continue
        vistos.add(clave)
        lineas = _leer(p).split("\n")
        a, b = max(0, ini - contexto // 2), min(len(lineas), max(fin + 1, ini + 1) + contexto // 2)
        if b - a > 22:
            b = a + 22
        try:
            rel = p.relative_to(base).as_posix()
        except ValueError:
            rel = str(p)
        cab = f"### {rel} líneas {a + 1}-{b}" + (f" (en {fn})" if fn else "") + f" — coincide: {', '.join(sorted(terms)[:6])}"
        cuerpo = "\n".join(f"{k + 1:>5}\t{lineas[k][:220]}" for k in range(a, b))
        out.append(cab + "\n" + cuerpo)
        if len(out) >= max_resultados:
            break
    return (f"Zonas del código más relacionadas con «{pregunta}» (de {len(archivos)} archivos; busqué: "
            f"{', '.join(sorted(T, key=lambda t: -T[t])[:10])}):\n\n" + "\n\n".join(out)
            + "\n\n→ Para cambiar algo: editar_archivo con la ruta de arriba y desde_linea/hasta_linea de esas líneas "
              "(o texto_anterior copiado SIN los números).")
