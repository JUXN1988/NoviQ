"""🎨 Diseños 2D profesionales de Noviq.

Crea, a partir de las figuras 3D animadas (figuras3d) y de generadores propios:
  • Retratos (busto con fondo pintado, luz de contra y marco) → diálogos, menús, créditos.
  • Tarjetas de personaje (plano de 3/4, fondo transparente) → pantallas para elegir traje.
  • Iconos de armas y objetos (en diagonal, como en los mejores juegos de rol) → HUD e inventario.
  • Hojas de sprites animadas (Idle, Correr, Saltar, Atacar, Golpe, Caer) en vista lateral o cenital de 4 direcciones,
    en alta definición o estilo pixel art → motor 2D.
  • Fondos panorámicos por capas (cielo, montañas, colinas con árboles, primer plano) que se repiten sin costuras → parallax.
  • Texturas que encajan sin costuras y juegos de baldosas (tiles) por tema.

Todo se guarda ordenado por categorías en la carpeta 2D (docs/2D/Noviq Creados/<Categoría>/) con una ficha
.noviq.json al lado (qué es, para qué rol, con qué tema) para reutilizarlo después sin volver a crearlo."""
import hashlib
import json
import math
import os
import re
import time
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from . import figuras3d as F
from . import geo3d as G

try:
    import numpy as np
except ImportError:  # sin numpy: retratos/iconos/sprites funcionan (render simple); fondos y texturas no
    np = None

VERSION_2D = 1
CATEGORIAS = {"retrato": "Retratos", "tarjeta": "Personajes", "icono": "Iconos", "sprites": "Sprites", "fondo": "Fondos",
              "textura": "Texturas", "tiles": "Baldosas"}
LEEME = """🎨 Carpeta estándar de diseños 2D de Noviq
==========================================

Aquí el 🎮 Estudio de juegos guarda (y reutiliza) los diseños 2D que crea para tus juegos:

• Noviq Creados/Retratos     → retratos de personajes para diálogos y menús
• Noviq Creados/Personajes   → tarjetas de personajes (para elegir traje)
• Noviq Creados/Iconos       → armas y objetos
• Noviq Creados/Sprites      → hojas de sprites animadas (.png + .json con los cuadros de cada animación)
• Noviq Creados/Fondos       → fondos panorámicos por capas (parallax): cielo, lejos, medio, cerca y vista
• Noviq Creados/Texturas     → texturas que encajan sin costuras
• Noviq Creados/Baldosas     → juegos de baldosas (tiles) por tema para el motor 2D

Cada diseño tiene su ficha .noviq.json (qué es, tema, rol…). Todo es tuyo (CC0): úsalo donde quieras.
También puedes poner aquí tus propias imágenes .png en carpetas por tema.
"""


# ───────────── Carpeta y guardado ─────────────
def carpeta(crear=True):
    from .config import CONFIG
    c = str((CONFIG.get("juegos") or {}).get("carpeta_2d") or "").strip().strip('"').strip("'")
    if c:
        p = Path(os.path.expandvars(c)).expanduser()
    else:
        from . import biblioteca3d as B
        p = B.carpeta_defecto().parent / "2D"   # junto a la carpeta 3D estándar: docs/2D (o Documentos/Noviq/2D)
    if crear:
        try:
            p.mkdir(parents=True, exist_ok=True)
            le = p / "LEEME.txt"
            if not le.exists():
                le.write_text(LEEME, encoding="utf-8")
        except OSError:
            pass
    return p


def carpeta_creados(base=None):
    return Path(base) if base else carpeta() / "Noviq Creados"


def _nombre(t):
    t = unicodedata.normalize("NFKD", str(t or "Diseño"))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^\w \-()]+", "", t).strip()
    return re.sub(r"\s+", " ", t)[:60] or "Diseno"


def _firma(*partes):
    return hashlib.md5(json.dumps([VERSION_2D, *partes], sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()[:12]


def _buscar(dcat, firma):
    for f in dcat.glob("**/*.noviq.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if d.get("firma") == firma:
            png = f.with_name(d.get("archivo") or (f.name[:-len(".noviq.json")] + ".png"))
            if png.exists():
                d["png"] = str(png)
                d["ficha"] = str(f)
                d["reutilizado"] = True
                return d
    return None


def _libre(dcat, nom, ext=".png"):
    k = 1
    while True:
        stem = nom if k == 1 else f"{nom} ({k})"
        if not (dcat / (stem + ext)).exists() and not (dcat / stem).exists():
            return stem
        k += 1


def _png(img, ruta):
    """PNG: optimizado si es pequeño; los grandes (fondos, hojas) con compresión normal (mucho más rápido)."""
    if img.size[0] * img.size[1] <= 300_000:
        img.save(ruta, optimize=True)
    else:
        img.save(ruta, compress_level=6)


def _guardar(img, tipo, nombre, ficha, firma, base=None, extra_archivos=None):
    """Guarda la imagen (o un paquete de imágenes) con su ficha. Si ya existe un diseño idéntico, lo reutiliza."""
    dcat = carpeta_creados(base) / CATEGORIAS[tipo]
    dcat.mkdir(parents=True, exist_ok=True)
    ya = _buscar(dcat, firma)
    if ya:
        return ya
    stem = _libre(dcat, _nombre(nombre))
    destino = dcat
    if extra_archivos:  # paquete (fondo por capas): una subcarpeta
        destino = dcat / stem
        destino.mkdir(parents=True, exist_ok=True)
        for n, im in extra_archivos.items():
            _png(im, destino / f"{n}.png")
    png = destino / f"{stem}.png"
    _png(img, png)
    d = dict(ficha)
    d.update(tipo=tipo, nombre=nombre, categoria=CATEGORIAS[tipo], firma=firma, archivo=png.name, creado=time.strftime("%Y-%m-%d %H:%M"),
             version=VERSION_2D, autor="Noviq", licencia="CC0 (creado por ti con Noviq)", tam=list(img.size))
    if extra_archivos:
        d["capas"] = {n: f"{n}.png" for n in extra_archivos}
    fj = png.with_name(stem + ".noviq.json")
    fj.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    d["png"] = str(png)
    d["ficha"] = str(fj)
    d["reutilizado"] = False
    return d


def creados(base=None, tipo=None):
    """Lista de diseños 2D guardados (los más nuevos primero)."""
    raiz = carpeta_creados(base)
    out = []
    if not raiz.exists():
        return out
    for f in raiz.glob("**/*.noviq.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if tipo and d.get("tipo") != tipo:
            continue
        png = f.with_name(d.get("archivo") or "")
        if not png.exists():
            continue
        d["png"] = str(png)
        d["ficha"] = str(f)
        out.append(d)
    out.sort(key=lambda d: d.get("creado") or "", reverse=True)
    return out


# ───────────── Paletas por tema y hora ─────────────
# cielo arriba, horizonte, montañas, colinas, árboles, primer plano, niebla, estilo del paisaje
PALETAS = {
    "bosque": ("#4f92e0", "#d6ebff", "#6d8aa6", "#4d7d42", "#2c5a2a", "#1d3a1b", "#cfe3f0", "pinos"),
    "granja": ("#5aa8ee", "#fff1d2", "#8aa0b8", "#79a84a", "#3d6d2d", "#2f4a1c", "#f5ecd8", "granja"),
    "medieval": ("#5a9ae6", "#f3e7d3", "#8295ab", "#5d8a3c", "#335f2c", "#28441f", "#efe4d0", "castillo"),
    "desierto": ("#5aa4ee", "#ffe6bc", "#c49a72", "#d9b26f", "#8a6a3a", "#9a7442", "#ffe6c0", "dunas"),
    "nieve": ("#6aa6e6", "#f4faff", "#a3b8d0", "#dfe9f3", "#35503f", "#b8c8d8", "#eef5ff", "nevado"),
    "oceano": ("#3aa6ee", "#e8fbff", "#7aa6b8", "#e6d49e", "#3a8a3a", "#b89e66", "#dff5ff", "playa"),
    "ciudad": ("#5a9ae6", "#e8eef5", "#8a96a8", "#6b7078", "#454b53", "#30353c", "#dfe6ee", "ciudad"),
    "deportes": ("#5a9ae6", "#e8eef5", "#8a96a8", "#5f9a4a", "#454b53", "#30353c", "#dfe6ee", "ciudad"),
    "fantasia": ("#7a5ff0", "#ffd6f5", "#9a8ad0", "#5aa06a", "#3a7a5a", "#274d3b", "#f0dcff", "fantasia"),
    "terror": ("#0c1020", "#3a3550", "#262a38", "#20261c", "#12150d", "#0a0c07", "#4a4658", "terror"),
    "zombies": ("#4e5966", "#b3aa96", "#666a6a", "#4e5a3a", "#2c3324", "#1e2418", "#a8a08c", "terror"),
    "espacio": ("#02030a", "#241a44", "#3a3050", "#4a3f5c", "#2a2238", "#161222", "#3a2a5a", "espacio"),
    "futurista": ("#12082a", "#ff4fd8", "#2a2050", "#1e2a44", "#141c30", "#0c1220", "#5a2a7a", "neon"),
    "dinosaurios": ("#5ab2ee", "#f5ffe0", "#7c9888", "#5f8a2a", "#2d581d", "#1f3d14", "#e8f5d8", "selva"),
    "andes": ("#4f92e0", "#eef6ff", "#8898ae", "#7a8f4a", "#4a6a3a", "#34502a", "#e0ecf8", "andes"),
    "militar": ("#6fa0cc", "#efe6d2", "#8a9080", "#6b7a4a", "#3d4828", "#2c3520", "#e8e0cc", "granja"),
    "volcan": ("#2a1210", "#ff7a3a", "#4a2a24", "#3a2622", "#1a1210", "#120c0a", "#8a4a3a", "volcan"),
}
ALIAS_TEMA = {"selva": "dinosaurios", "jungla": "dinosaurios", "playa": "oceano", "isla": "oceano", "cementerio": "terror",
              "halloween": "terror", "castillo": "medieval", "montana": "andes", "invierno": "nieve", "espacial": "espacio",
              "cyberpunk": "futurista", "lava": "volcan", "infierno": "volcan", "pueblo": "granja", "campo": "granja"}


def paleta(tema, hora="dia"):
    t = ALIAS_TEMA.get(tema, tema)
    p = list(PALETAS.get(t) or PALETAS["bosque"])
    if hora == "noche" and t not in ("espacio", "terror"):
        p[0], p[1] = G.mezclar_hex(p[0], "#050a1e", 0.8), G.mezclar_hex(p[1], "#26345a", 0.75)
        for i in (2, 3, 4, 5):
            p[i] = G.mezclar_hex(p[i], "#0a1030", 0.55)
        p[6] = G.mezclar_hex(p[6], "#1a2240", 0.7)
    elif hora == "atardecer":
        p[0], p[1] = G.mezclar_hex(p[0], "#3a3a8a", 0.55), G.mezclar_hex(p[1], "#ffae6a", 0.7)
        for i in (2, 3, 4, 5):
            p[i] = G.mezclar_hex(p[i], "#5a2a3a", 0.25)
        p[6] = G.mezclar_hex(p[6], "#ffb88a", 0.5)
    return p


def _rgb(h):
    h = str(h).lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


# ───────────── Diseños sacados de las figuras 3D ─────────────
def _pl(pl):
    return F.POR_ID[pl] if isinstance(pl, str) else pl


def _figura(pl, cambios=None, detalle=1.0):
    pl = _pl(pl)
    animado = pl["rig"] not in ("arma", "objeto", "escenario")
    C, esq, clips, alto = F.construir(pl, dict(cambios or {}), detalle, animado)
    return pl, C, esq, clips, alto


def _clip(clips, nombre):
    return next((c for c in clips or [] if c["nombre"] == nombre), None)


def _tris(C, esq, clips, anim="Idle", t=0.35):
    an = _clip(clips, anim) if esq else None
    return G.triangulos_posados(C, esq, an, t if an else 0.0)


def _transformar(tris, M):
    Mn = G.m_normal(M)
    return [(G.m_punto(M, t[0]), G.m_punto(M, t[1]), G.m_punto(M, t[2]), G.v_norm(G.m_dir(Mn, t[3])), G.v_norm(G.m_dir(Mn, t[4])),
             G.v_norm(G.m_dir(Mn, t[5])), t[6], t[7], t[8]) for t in tris]


def _tris_arma(arma, esq, anim, t, detalle=0.85, tipo_arma=None):
    """Triángulos del arma en la mano derecha, en la pose del instante t (igual que la engancha el motor 3D)."""
    if not arma or not esq or "hand_R" not in esq:
        return []
    apl = _pl(arma)
    Ca, _, _, _ = F.construir(apl, {}, detalle, False)
    ta = G.triangulos_posados(Ca, None, None, 0.0)
    mats = G.matrices_pose(esq, anim, t)
    i = esq["hand_R"]
    M = G.m_mul(mats[i], G.m_trans(*esq.huesos[i]["pos"]))
    if (tipo_arma or {"pistola": "disparo", "rifle": "disparo", "escopeta": "disparo", "blaster": "disparo", "ballesta": "disparo",
                      "arco": "disparo", "tirachinas": "disparo"}.get(apl.get("tipo"))) == "disparo":
        M = G.m_mul(M, G.m_rot_x(math.pi / 2))
    return _transformar(ta, M)


def _es_humanoide(pl):
    return pl["rig"] == "humanoide"


def _zona(tris, eje, desde, hasta):
    return [t for t in tris if max(p[eje] for p in t[:3]) >= desde and min(p[eje] for p in t[:3]) <= hasta]


def _degradado(tam, centro, interior, exterior, radio=0.85, ruido=0.0, semilla=1):
    """Fondo radial suave (se calcula en pequeño y se escala: rápido y sin bandas)."""
    n = 48
    im = Image.new("RGB", (n, n))
    px = im.load()
    rnd = __import__("random").Random(semilla)
    for y in range(n):
        for x in range(n):
            d = math.hypot((x + 0.5) / n - centro[0], (y + 0.5) / n - centro[1]) / radio
            f = min(1.0, max(0.0, d)) ** 1.35
            c = _mix(interior, exterior, f)
            if ruido:
                k = 1 + (rnd.random() - 0.5) * ruido
                c = tuple(max(0, min(255, int(v * k))) for v in c)
            px[x, y] = c
    return im.resize((tam, tam), Image.BICUBIC).filter(ImageFilter.GaussianBlur(tam / 90))


def _bokeh(img, color, n=9, semilla=3):
    import random
    r = random.Random(semilla)
    W, H = img.size
    capa = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(capa)
    for _ in range(n):
        x, y, rr = r.random() * W, r.random() * H * 0.8, (0.03 + r.random() * 0.08) * W
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=color + (int(18 + r.random() * 30),))
    capa = capa.filter(ImageFilter.GaussianBlur(W / 120))
    base = img.convert("RGBA")
    base.alpha_composite(capa)
    return base


def _vineta(img, fuerza=0.55):
    W, H = img.size
    m = _degradado(W, (0.5, 0.45), (255, 255, 255), (0, 0, 0), radio=0.95).convert("L")
    oscuro = Image.new("RGBA", img.size, (0, 0, 0, 255))
    alfa = m.point(lambda v: int((255 - v) * fuerza))
    oscuro.putalpha(alfa)
    base = img.convert("RGBA")
    base.alpha_composite(oscuro)
    return base


def _redondear(img, radio, borde=None, grosor=0):
    W, H = img.size
    S = 3
    m = Image.new("L", (W * S, H * S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W * S - 1, H * S - 1), radius=radio * S, fill=255)
    m = m.resize((W, H), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), m)
    if borde and grosor:
        c = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
        dc = ImageDraw.Draw(c)
        g = grosor * S
        dc.rounded_rectangle((g / 2, g / 2, W * S - g / 2, H * S - g / 2), radius=radio * S, outline=borde + (255,), width=g)
        dc.rounded_rectangle((g * 1.4, g * 1.4, W * S - g * 1.4, H * S - g * 1.4), radius=max(1, (radio - grosor) * S),
                             outline=_mix(borde, (255, 255, 255), 0.45) + (140,), width=max(1, S))
        out.alpha_composite(c.resize((W, H), Image.LANCZOS))
    return out


def _hueso_mundo(esq, an, t, nombre):
    if not esq or nombre not in esq:
        return None
    mats = G.matrices_pose(esq, an, t)
    i = esq[nombre]
    return G.m_punto(G.m_mul(mats[i], G.m_trans(*esq.huesos[i]["pos"])), (0, 0, 0))


def _vista(p, yaw, pitch):
    x, y, z = p
    cy_, sy_, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
    return x, y * cp - z * sp


def encuadre_cabeza(tris, esq, an, t, tam, yaw, pitch, alto, humanoide=True):
    """Encuadre de retrato: la cabeza ocupa ~45 % del alto, un poco arriba del centro, y se ven los hombros."""
    c = _hueso_mundo(esq, an, t, "head")
    if c is None:
        return G.encuadre_de([tris], (tam, tam), yaw, pitch, 0.07)
    r = 0.2 * (alto / 1.8) if humanoide else 0.28 * alto
    cab = [q for tr in tris for q in tr[:3] if math.dist(q, c) < r * (3.0 if humanoide else 1.0) and (not humanoide or q[1] > c[1] - 0.02 * alto)]
    if not cab:
        return G.encuadre_de([tris], (tam, tam), yaw, pitch, 0.07)
    vs = [_vista(q, yaw, pitch) for q in cab]
    x0, x1 = min(v[0] for v in vs), max(v[0] for v in vs)
    y0, y1 = min(v[1] for v in vs), max(v[1] for v in vs)
    h = max(y1 - y0, 1e-6)
    w = max(x1 - x0, 1e-6)
    esc = min(tam * (0.5 if humanoide else 0.62) / h, tam * (0.62 if humanoide else 0.8) / w)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2 - (tam * (0.13 if humanoide else 0.02)) / esc
    return (cx, cy, esc)


def retrato(pl, cambios=None, tema=None, tam=256, enemigo=None, marco=True, detalle=1.0, anim="Idle", t=0.35):
    """Retrato de busto con fondo pintado del tema, luz principal, luz de contra y marco (oro para jefes y enemigos)."""
    pl, C, esq, clips, alto = _figura(pl, cambios, detalle)
    enemigo = pl.get("enemigo") if enemigo is None else enemigo
    an = _clip(clips, anim) if esq else None
    tris = _tris(C, esq, clips, anim, t)
    p = paleta(tema or (pl.get("temas") or ["bosque"])[0])
    cielo, horiz = _rgb(p[0]), _rgb(p[1])
    hum = _es_humanoide(pl)
    yaw, pitch = (-0.32, 0.05) if hum else (-0.62, 0.12)
    enc = encuadre_cabeza(tris, esq, an, t, tam, yaw, pitch, alto, hum)
    if enemigo:
        interior, exterior = _mix(horiz, (200, 60, 40), 0.45), _mix(cielo, (20, 4, 8), 0.75)
        borde_luz = (1.0, 0.45, 0.3)
    else:
        interior, exterior = _mix(horiz, (255, 255, 255), 0.15), _mix(cielo, (10, 14, 30), 0.55)
        borde_luz = tuple(min(1.0, c / 255 * 1.1) for c in horiz)
    fondo = _degradado(tam, (0.55, 0.36), interior, exterior, radio=0.95, ruido=0.05)
    fondo = _bokeh(fondo, _mix(interior, (255, 255, 255), 0.5), semilla=len(pl["id"]))
    fig = G.renderizar(tris, (tam, tam), yaw=yaw, pitch=pitch, encuadre=enc, sombra=False, perspectiva=0.12,
                       luz=(-0.55, 0.7, 0.75), luz_borde=borde_luz)
    # sombra suave detrás de la figura para despegarla del fondo
    sombra = Image.new("RGBA", fig.size, (0, 0, 0, 0))
    sombra.putalpha(fig.getchannel("A").point(lambda v: int(v * 0.45)))
    sombra = sombra.filter(ImageFilter.GaussianBlur(tam / 40))
    img = fondo.convert("RGBA")
    img.alpha_composite(sombra, (int(tam * 0.02), int(tam * 0.02)))
    img.alpha_composite(fig)
    img = _vineta(img, 0.5)
    if marco:
        oro, plata = (214, 170, 72), (196, 204, 214)
        img = _redondear(img, int(tam * 0.1), oro if enemigo else plata, max(2, tam // 48))
    return img


def tarjeta(pl, cambios=None, tam=256, detalle=1.0, arma=None):
    """Personaje de 3/4 (cabeza a rodillas en humanoides), fondo transparente: para las cartas de «elige tu personaje»."""
    pl, C, esq, clips, alto = _figura(pl, cambios, detalle)
    an = _clip(clips, "Idle") if esq else None
    tris = _tris(C, esq, clips, "Idle", 0.35)
    if arma:
        tris += _tris_arma(arma, esq, an, 0.35, detalle)
    ys = [q[1] for tr in tris for q in tr[:3]]
    ytop, ybot = max(ys), min(ys)
    if _es_humanoide(pl):
        yaw, pitch = -0.45, 0.1
        enc = G.encuadre_de([_zona(tris, 1, ytop - (ytop - ybot) * 0.7, ytop)], (tam, tam), yaw, pitch, 0.04)
    else:
        yaw, pitch = -0.7, 0.22
        enc = G.encuadre_de([tris], (tam, tam), yaw, pitch, 0.06)
    return G.renderizar(tris, (tam, tam), yaw=yaw, pitch=pitch, encuadre=enc, sombra=not _es_humanoide(pl), perspectiva=0.1,
                        luz=(-0.5, 0.75, 0.7), contorno=None)


# orientaciones de icono para armas: la que muestre más superficie (la hoja de plano, el arco de frente…)
_BASES_ICONO = [
    [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0], [0, 0, 0, 1]],    # ancho (+Y) de lado, largo (+Z) arriba
    [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]],   # grosor (+X) de lado, largo arriba
]
_FUEGO = {"pistola", "rifle", "escopeta", "blaster", "ballesta"}
_BRILLO = {"antorcha": "#ffae3a", "varita": "#c07aff", "baculo": "#8ac8ff", "blaster": "#3bffe8"}


def _area_vista(tris, yaw=0.0, pitch=0.0):
    """Tamaño de la silueta vista de frente (área del rectángulo que la encierra): así se elige la vista «de plano»."""
    xs, ys = [], []
    for t in tris:
        for q in t[:3]:
            x, y = _vista(q, yaw, pitch)
            xs.append(x)
            ys.append(y)
    return (max(xs) - min(xs)) * (max(ys) - min(ys)) if xs else 0.0


def icono(pl, cambios=None, tam=256, fondo=None, contorno=(18, 20, 28), detalle=1.0, brillo_magico=None):
    """Icono de arma u objeto: armas blancas en diagonal (mango abajo a la izquierda), armas de fuego de perfil apuntando a
    la derecha, escudos de frente, objetos de 3/4. Fondo transparente o una insignia del color que se pida."""
    pl, C, esq, clips, alto = _figura(pl, cambios, detalle)
    tris = G.triangulos_posados(C, None, None, 0.0)
    tipo = pl.get("tipo")
    if pl["rig"] == "arma":
        if tipo in _FUEGO:  # cañón (+Z) a la derecha, empuñadura abajo
            tris = _transformar(tris, G.m_mul(G.m_rot_z(0.12), [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1]]))
            yaw, pitch = 0.3, 0.12
        elif tipo == "escudo":
            opciones = [(tris, 0.0)] + [(_transformar(tris, B), 0.0) for B in _BASES_ICONO]
            tris = max(opciones, key=lambda o: _area_vista(o[0]))[0]
            yaw, pitch = 0.35, 0.15
        else:
            opciones = [tris] + [_transformar(tris, B) for B in _BASES_ICONO]
            tris = max(opciones, key=_area_vista)
            tris = _transformar(tris, G.m_rot_z(-math.pi / 4))
            yaw, pitch = 0.28, 0.12
        brillo_magico = brillo_magico or _BRILLO.get(tipo)
    else:
        yaw, pitch = -0.55, 0.3
    img = G.renderizar(tris, (tam, tam), yaw=yaw, pitch=pitch, margen=0.1, sombra=False, luz=(-0.5, 0.8, 0.6),
                       contorno=contorno, perspectiva=0.08)
    if brillo_magico:
        glow = Image.new("RGBA", img.size, _rgb(brillo_magico) + (0,))
        glow.putalpha(img.getchannel("A").filter(ImageFilter.GaussianBlur(tam / 26)).point(lambda v: int(v * 0.8)))
        glow.alpha_composite(img)
        img = glow
    if fondo:
        base = _degradado(tam, (0.5, 0.42), _mix(_rgb(fondo), (255, 255, 255), 0.25), _mix(_rgb(fondo), (0, 0, 0), 0.6), radio=0.75)
        base = _redondear(base, tam // 5, _mix(_rgb(fondo), (255, 255, 255), 0.3), max(2, tam // 40))
        base.alpha_composite(img)
        img = base
    return img


# ───────────── Hojas de sprites animadas ─────────────
ANIMS_LATERAL = [("Idle", 6, 7, True), ("Run", 8, 13, True), ("Jump", 4, 8, False), ("Attack", 6, 16, False), ("Hit", 3, 12, False),
                 ("Death", 6, 9, False)]
ANIMS_SUPERIOR = [("Idle", 4, 6, True), ("Walk", 6, 9, True), ("Attack", 5, 14, False), ("Hit", 2, 10, False), ("Death", 5, 8, False)]
DIRECCIONES = [("abajo", 0.0), ("izquierda", -math.pi / 2), ("derecha", math.pi / 2), ("arriba", math.pi)]


def _pixelar(img, colores=40, contorno=(14, 12, 20)):
    """Estilo pixel art: paleta limitada, sin semitransparencias y contorno de 1 px."""
    a = img.getchannel("A").point(lambda v: 255 if v > 110 else 0)
    rgb = Image.new("RGB", img.size, (0, 0, 0))
    rgb.paste(img.convert("RGB"), (0, 0), a)
    q = rgb.quantize(colors=colores, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGBA")
    q.putalpha(a)
    if contorno:
        borde = a.filter(ImageFilter.MaxFilter(3))
        out = Image.new("RGBA", img.size, (0, 0, 0, 0))
        out.paste(Image.new("RGBA", img.size, contorno + (255,)), (0, 0), borde)
        out.alpha_composite(q)
        return out
    return q


def _xs_vista(listas, yaw):
    """x en pantalla (vista con giro yaw) de todos los vértices de varias listas de triángulos."""
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    if np is not None:
        a = np.array([q for tr in listas for t_ in tr for q in t_[:3]], float)
        return (a[:, 0] * cy_ + a[:, 2] * sy_).tolist()
    return [q[0] * cy_ + q[2] * sy_ for tr in listas for t_ in tr for q in t_[:3]]


def hoja_sprites(pl, cambios=None, vista="lateral", alto_px=96, arma=None, pixel=False, detalle=0.85, anims=None, contorno=True):
    """Hoja de sprites desde la figura 3D animada. vista: 'lateral' (mira a la derecha; el motor la voltea) o 'superior'
    (4 direcciones, cámara a 3/4 desde arriba). → (imagen, meta) con cuadro, pivote (pies) y filas por animación."""
    pl, C, esq, clips, alto = _figura(pl, cambios, detalle)
    lista = anims or (ANIMS_LATERAL if vista == "lateral" else ANIMS_SUPERIOR)
    lista = [a for a in lista if _clip(clips, a[0]) or a[0] == "Idle"]
    if vista == "lateral":
        dirs, pitch = [("derecha", math.pi / 2 + 0.28)], 0.1
    else:
        dirs, pitch = DIRECCIONES, 0.62
    # cuadros: tris de cada instante (mismo encuadre para todos para que no «salten»)
    cuadros = []
    for nombre, n, fps, bucle in lista:
        an = _clip(clips, nombre)
        dur = an["duracion"] if an else 1.0
        fila = []
        for k in range(n):
            tt = dur * (k / n if bucle else k / max(1, n - 1)) * (0.999 if not bucle else 1)
            if nombre == "Jump" and an:
                tt = dur * (0.15 + 0.7 * k / max(1, n - 1))
            tr = G.triangulos_posados(C, esq, an, tt) if an else _tris(C, esq, clips, "Idle", 0.35)
            if arma:
                tr = tr + _tris_arma(arma, esq, an, tt, detalle)
            fila.append(tr)
        cuadros.append((nombre, n, fps, bucle, fila))
    # tamaño del cuadro: la figura en reposo mide alto_px (con margen para brazos, armas y la caída)
    base = cuadros[0][4][0]
    ys = [q[1] for tr in base for q in tr[:3]]
    alto_m = max(ys) - min(ys)
    esc = alto_px / max(alto_m, 1e-6)
    todos = [tr for c in cuadros for tr in c[4]]
    muestra = todos[:: max(1, len(todos) // 16)]
    if vista == "lateral":  # ancho real de lo que se ve de perfil (cola, arma, caída…), sin cortar nada
        xs_ = _xs_vista(muestra, dirs[0][1])
        cx0 = (max(xs_) + min(xs_)) / 2
        fw = int(math.ceil(((max(xs_) - min(xs_)) * esc + 10) / 4) * 4)
    else:
        ext = max(math.hypot(q[0], q[2]) for tr in muestra for t_ in tr for q in t_[:3])
        cx0 = 0.0
        fw = int(math.ceil(max(alto_px * 0.9, (2 * ext + 0.2) * esc * 0.9) / 4) * 4)
    xb = _xs_vista([base], dirs[0][1])
    ancho_cuerpo = (max(xb) - min(xb)) * esc
    fh = int(math.ceil((alto_px * (1.25 if vista == "lateral" else 1.35)) / 4) * 4)
    fw = max(int(alto_px * 0.6), min(fw, int(alto_px * 3.2)))
    ymin = min(ys)
    S = 2
    filas = []
    meta_anims = {}
    cy = ymin + (fh * 0.5 - fh * (0.09 if vista == "lateral" else 0.12)) / esc

    def cuadro(tr, yaw):
        # la cámara mira al origen; el suelo (ymin) queda fijo en la parte baja del cuadro (pivote)
        im = G.renderizar(tr, (fw, fh), yaw=yaw, pitch=pitch, encuadre=(cx0, cy, esc), sombra="contacto" if vista != "lateral" else False,
                          sobremuestreo=S, luz=(-0.5, 0.8, 0.55), ao=True, contorno=None)
        if pixel:
            return _pixelar(im)
        if contorno:
            borde = im.getchannel("A").filter(ImageFilter.MaxFilter(3)).point(lambda v: int(v * 0.55))
            out = Image.new("RGBA", im.size, (12, 10, 18, 0))
            out.putalpha(borde)
            out.alpha_composite(im)
            return out
        return im
    trabajos = [(dnom, yaw, nombre, n, fps, bucle, tr) for dnom, yaw in dirs for nombre, n, fps, bucle, fila in cuadros for tr in fila]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, min(6, (os.cpu_count() or 2) // 2))) as ex:  # numpy suelta el GIL: varios núcleos a la vez
        hechas = list(ex.map(lambda j: cuadro(j[6], j[1]), trabajos))
    k = 0
    for dnom, yaw in dirs:
        for nombre, n, fps, bucle, fila in cuadros:
            imgs = hechas[k:k + len(fila)]
            k += len(fila)
            clave = nombre if len(dirs) == 1 else f"{nombre}_{dnom}"
            meta_anims[clave] = {"fila": len(filas), "cuadros": n, "fps": fps, "bucle": bucle}
            filas.append(imgs)
    cols = max(len(f) for f in filas)
    hoja = Image.new("RGBA", (cols * fw, len(filas) * fh), (0, 0, 0, 0))
    for j, f in enumerate(filas):
        for i, im in enumerate(f):
            hoja.alpha_composite(im, (i * fw, j * fh))
    pie = fh - fh * (0.09 if vista == "lateral" else 0.12)
    meta = {"cuadro": [fw, fh], "pivote": [round(fw / 2 - cx0 * esc, 1), round(pie, 1)], "alto_figura": alto_px, "vista": vista, "anims": meta_anims,
            "direcciones": [d[0] for d in dirs] if len(dirs) > 1 else None, "pixel": bool(pixel), "plantilla": pl["id"],
            "altura_m": round(alto_m, 3), "rig": pl["rig"], "ancho_cuerpo_px": round(ancho_cuerpo, 1)}
    return hoja, meta


def hoja_giro(pl, cambios=None, tam=64, cuadros=8, detalle=0.85):
    """Objeto que gira (monedas, gemas, llaves…): una fila de cuadros."""
    pl, C, esq, clips, alto = _figura(pl, cambios, detalle)
    tris = G.triangulos_posados(C, None, None, 0.0)
    enc = None
    imgs = []
    for k in range(cuadros):
        yaw = 2 * math.pi * k / cuadros
        if enc is None:
            enc = G.encuadre_de([tris], (tam, tam), 0.0, 0.2, 0.12)
            r = max(math.hypot(q[0], q[2]) for t_ in tris for q in t_[:3])
            ys = [q[1] for t_ in tris for q in t_[:3]]
            enc = (0.0, (max(ys) + min(ys)) / 2, min(enc[2], tam * 0.78 / max(2 * r, max(ys) - min(ys), 1e-6)))
        imgs.append(G.renderizar(tris, (tam, tam), yaw=yaw, pitch=0.2, encuadre=enc, sombra=False, sobremuestreo=2, contorno=(18, 20, 28)))
    hoja = Image.new("RGBA", (tam * cuadros, tam), (0, 0, 0, 0))
    for i, im in enumerate(imgs):
        hoja.alpha_composite(im, (i * tam, 0))
    return hoja, {"cuadro": [tam, tam], "pivote": [tam / 2, tam / 2], "anims": {"Spin": {"fila": 0, "cuadros": cuadros, "fps": 10, "bucle": True}},
                  "plantilla": pl["id"]}


# ───────────── Ruido periódico (se repite sin costuras) ─────────────
def _ruido(w, h, cx, cy, semilla, octavas=5, pers=0.5):
    """Ruido de valor 2D en [0, 1], periódico en x y en y (cx, cy = celdas de la primera octava)."""
    rng = np.random.default_rng(semilla)
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    tot = np.zeros((h, w))
    amp, norm = 1.0, 0.0
    for o in range(octavas):
        fx, fy = max(1, int(cx * 2 ** o)), max(1, int(cy * 2 ** o))
        g = rng.random((fy, fx))
        px, py = u * fx, v * fy
        x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
        tx, ty = px - x0, py - y0
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        x0, y0 = x0 % fx, y0 % fy
        x1, y1 = (x0 + 1) % fx, (y0 + 1) % fy
        a = g[np.ix_(y0, x0)]
        b = g[np.ix_(y0, x1)]
        c = g[np.ix_(y1, x0)]
        d = g[np.ix_(y1, x1)]
        TX, TY = tx[None, :], ty[:, None]
        tot += amp * ((a * (1 - TX) + b * TX) * (1 - TY) + (c * (1 - TX) + d * TX) * TY)
        norm += amp
        amp *= pers
    return tot / norm


def _ruido1(n, celdas, semilla, octavas=6, pers=0.52):
    return _ruido(n, 1, celdas, 1, semilla, octavas, pers)[0]


def _suave(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _col(h):
    return np.array(_rgb(h), float) / 255.0


def _a_img(rgb, alfa=None):
    rgb = np.clip(rgb, 0, 1)
    if alfa is None:
        alfa = np.ones(rgb.shape[:2])
    arr = np.dstack([rgb, np.clip(alfa, 0, 1)[..., None] if alfa.ndim == 2 else alfa])
    return Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA")


# ───────────── Fondos panorámicos por capas (parallax) ─────────────
def _cielo(W, H, P, hora, estilo, sem):
    ca, ch = _col(P[0]), _col(P[1])
    y = (np.arange(H) + 0.5)[:, None] / H
    t = np.clip(y / 0.8, 0, 1) ** 1.3
    rgb = (ca[None, None, :] * (1 - t[..., None]) + ch[None, None, :] * t[..., None]) * np.ones((1, W, 1))
    yy, xx = np.mgrid[0:H, 0:W]
    rng = np.random.default_rng(sem)
    if estilo == "espacio" or hora == "noche" or estilo == "terror":
        n_est = int(W * H / (700 if estilo == "espacio" else 1400))
        ex, ey = rng.integers(0, W, n_est), rng.integers(0, int(H * (0.95 if estilo == "espacio" else 0.7)), n_est)
        br = rng.random(n_est) ** 3 * 0.9 + 0.1
        est = np.zeros((H, W))
        est[ey, ex] = br
        est = np.maximum(est, np.roll(est, 1, 1) * 0.35)
        rgb += est[..., None] * np.array([0.95, 0.97, 1.0]) * (1 - t[..., None] * 0.7)
    if estilo == "espacio":  # nebulosa y planeta
        neb = _ruido(W, H, 4, 2, sem + 5, 6)
        neb2 = _ruido(W, H, 3, 2, sem + 6, 5)
        m = _suave(0.45, 0.8, neb)
        rgb += m[..., None] * (np.array([0.55, 0.2, 0.75]) * neb2[..., None] + np.array([0.1, 0.35, 0.6]) * (1 - neb2[..., None])) * 0.55
        px_, py_, pr = W * 0.72, H * 0.33, H * 0.2
        d = np.hypot(xx - px_, yy - py_)
        disco = _suave(pr + 1, pr - 1, d)
        luz = np.clip(1 - np.hypot(xx - (px_ - pr * 0.5), yy - (py_ - pr * 0.5)) / (pr * 1.9), 0, 1)
        banda = 0.85 + 0.15 * np.sin((yy - py_) / pr * 9 + _ruido(W, H, 8, 2, sem + 7, 3) * 3)
        pc = np.array([0.8, 0.55, 0.4]) * (0.15 + 0.95 * luz[..., None]) * banda[..., None]
        rgb = rgb * (1 - disco[..., None]) + pc * disco[..., None]
        halo = np.exp(-np.maximum(d - pr, 0) / (pr * 0.18)) * (1 - disco)
        rgb += halo[..., None] * np.array([0.3, 0.45, 0.8]) * 0.5
        return rgb
    # sol o luna con resplandor
    if hora == "noche" or estilo == "terror":
        sx, sy, sr, sc = W * 0.78, H * 0.2, H * 0.07, np.array([0.95, 0.95, 0.88])
    elif hora == "atardecer":
        sx, sy, sr, sc = W * 0.5, H * 0.66, H * 0.12, np.array([1.0, 0.72, 0.4])
    else:
        sx, sy, sr, sc = W * 0.74, H * 0.18, H * 0.055, np.array([1.0, 0.98, 0.9])
    d = np.hypot(xx - sx, yy - sy)
    rgb += (np.exp(-d / (H * 0.25)) * (0.35 if hora != "noche" else 0.18))[..., None] * sc
    disco = _suave(sr + 1.2, sr - 1.2, d)
    if hora == "noche" or estilo == "terror":
        crat = _ruido(W, H, 40, 12, sem + 9, 3)
        sc = sc[None, None, :] * (0.82 + 0.25 * crat[..., None])
    rgb = rgb * (1 - disco[..., None]) + sc * disco[..., None]
    # nubes con volumen (más claras arriba), en una banda del cielo
    if estilo not in ("neon",):
        n = _ruido(W, H, 5, 2, sem + 2, 6, 0.55)
        n_ab = np.roll(n, -int(H * 0.02) - 2, axis=0)
        banda = np.exp(-((y - (0.28 if hora != "atardecer" else 0.35)) / 0.2) ** 2)
        dens = _suave(0.5, 0.72, n) * banda
        luz = np.clip(0.55 + (n - n_ab) * 9, 0, 1)
        if hora == "noche":
            c_luz, c_somb = np.array([0.35, 0.4, 0.55]), np.array([0.12, 0.14, 0.22])
        elif hora == "atardecer":
            c_luz, c_somb = np.array([1.0, 0.72, 0.55]), np.array([0.45, 0.32, 0.45])
        elif estilo == "terror":
            c_luz, c_somb = np.array([0.35, 0.33, 0.42]), np.array([0.12, 0.11, 0.16])
        else:
            c_luz, c_somb = np.array([1.0, 1.0, 1.0]), np.array([0.62, 0.68, 0.8])
        cn = c_somb * (1 - luz[..., None]) + c_luz * luz[..., None]
        rgb = rgb * (1 - dens[..., None] * 0.92) + cn * dens[..., None] * 0.92
    return rgb


def _perfil_montes(W, H, sem, alto_base, alto_var, celdas=4, picos=True):
    n = _ruido1(W, celdas, sem, 7, 0.5)
    if picos:
        r = 1 - np.abs(2 * _ruido1(W, celdas + 1, sem + 11, 6, 0.5) - 1)
        n = 0.45 * n + 0.55 * r ** 1.7
    return H * (alto_base + alto_var * n)


def _capa_relieve(W, H, perfil, color, niebla, bruma, sem, textura=0.12, luz_izq=True, nieve=None):
    yy = np.arange(H)[:, None] + 0.5
    tope = H - perfil[None, :]
    alfa = np.clip(yy - tope + 0.5, 0, 1)
    k_ = max(3, W // 160)
    dh = np.gradient(np.convolve(np.concatenate([perfil[-k_:], perfil, perfil[:k_]]), np.ones(2 * k_ + 1) / (2 * k_ + 1), "same")[k_:-k_])
    sombra = np.clip(0.5 + (dh if luz_izq else -dh) * 0.35, 0.15, 1.0)
    tex = _ruido(W, H, 30, 10, sem + 3, 4)
    base = _col(color)
    prof = np.clip((yy - tope) / (H * 0.35), 0, 1)
    rgb = base[None, None, :] * (0.72 + 0.45 * sombra[None, :, None]) * (1 - textura + 2 * textura * tex[..., None])
    rgb *= (1 - 0.22 * prof[..., None])
    if nieve is not None:
        alto_px = H - yy
        linea = H * nieve + H * 0.04 * (_ruido1(W, 12, sem + 21, 4)[None, :] - 0.5)
        m = _suave(-2, 4, alto_px - linea) * alfa
        cn = np.array([0.93, 0.96, 1.0]) * (0.75 + 0.3 * sombra[None, :, None])
        rgb = rgb * (1 - m[..., None]) + cn * m[..., None]
    nb = _col(niebla)
    f = np.clip(bruma + 0.35 * np.clip((yy - tope) / (H * 0.4), 0, 1), 0, 0.95)
    rgb = rgb * (1 - f[..., None]) + nb * f[..., None]
    return rgb, alfa


def _dup(fn, x, W, margen, *args):
    """Dibuja en x y también del otro lado del borde si hace falta (para que la capa se repita sin costuras)."""
    fn(x, *args)
    if x < margen:
        fn(x + W, *args)
    if x > W - margen:
        fn(x - W, *args)


def _arboles(capa, W, H, perfil, estilo, P, sem, bruma, escala=1.0, densidad=1.0, noche=False):
    import random
    r = random.Random(sem)
    d = ImageDraw.Draw(capa)
    niebla = _rgb(P[6])
    hoja = _mix(_rgb(P[4]), niebla, bruma)
    hoja_l = _mix(hoja, (255, 255, 240), 0.18)
    hoja_o = _mix(hoja, (0, 0, 0), 0.25)
    tronco = _mix((70, 50, 35), niebla, bruma)

    def pino(x, y, h, nevado=False):
        w = h * 0.42
        d.rectangle((x - h * 0.03, y - h * 0.12, x + h * 0.03, y + 2), fill=tronco)
        for k in range(4):
            t0 = y - h * (0.1 + 0.22 * k)
            ww = w * (1 - 0.2 * k)
            d.polygon([(x - ww, t0), (x + ww, t0), (x, t0 - h * 0.34)], fill=hoja_o)
            d.polygon([(x - ww * 0.95, t0 - 1), (x + ww * 0.1, t0 - 1), (x, t0 - h * 0.33)], fill=hoja_l)
            if nevado:
                d.polygon([(x - ww * 0.5, t0 - h * 0.17), (x + ww * 0.5, t0 - h * 0.17), (x, t0 - h * 0.34)], fill=_mix((240, 246, 255), niebla, bruma))

    def redondo(x, y, h, color=None):
        c = color or hoja
        d.rectangle((x - h * 0.05, y - h * 0.45, x + h * 0.05, y + 2), fill=tronco)
        for k in range(6):
            ox, oy, rr = (r.random() - 0.5) * h * 0.5, -h * (0.55 + r.random() * 0.3), h * (0.2 + r.random() * 0.12)
            d.ellipse((x + ox - rr, y + oy - rr, x + ox + rr, y + oy + rr), fill=_mix(c, (0, 0, 0), 0.22))
        for k in range(5):
            ox, oy, rr = (r.random() - 0.7) * h * 0.4, -h * (0.62 + r.random() * 0.28), h * (0.13 + r.random() * 0.1)
            d.ellipse((x + ox - rr, y + oy - rr, x + ox + rr, y + oy + rr), fill=_mix(c, (255, 255, 230), 0.14))

    def palmera(x, y, h):
        pts = [(x + math.sin(k / 6 * 1.2) * h * 0.12, y - h * k / 6) for k in range(7)]
        d.line(pts, fill=tronco, width=max(2, int(h * 0.05)))
        cx_, cy_ = pts[-1]
        for k in range(7):
            a = -math.pi + k * math.pi / 6 + r.random() * 0.2
            px = cx_ + math.cos(a) * h * 0.4
            py = cy_ + math.sin(a) * h * 0.2 + h * 0.12
            d.line([(cx_, cy_), ((cx_ + px) / 2, cy_ - h * 0.08), (px, py)], fill=hoja, width=max(2, int(h * 0.04)))

    def seco(x, y, h):
        def rama(x0, y0, a, l, g):
            if g == 0 or l < 3:
                return
            x1, y1 = x0 + math.cos(a) * l, y0 - math.sin(a) * l
            d.line([(x0, y0), (x1, y1)], fill=tronco, width=max(1, g))
            rama(x1, y1, a + 0.35 + r.random() * 0.3, l * 0.7, g - 1)
            rama(x1, y1, a - 0.35 - r.random() * 0.3, l * 0.68, g - 1)
        rama(x, y, math.pi / 2 + (r.random() - 0.5) * 0.2, h * 0.35, 5)

    def cactus(x, y, h):
        c = _mix((70, 120, 60), niebla, bruma)
        d.rounded_rectangle((x - h * 0.07, y - h, x + h * 0.07, y), radius=int(h * 0.07), fill=c)
        for s in (1, -1):
            yb = y - h * (0.45 + r.random() * 0.25)
            xa, xb = sorted((x + s * h * 0.07, x + s * h * 0.22))
            d.rounded_rectangle((xa, yb - h * 0.05, xb, yb + h * 0.03), radius=int(h * 0.04), fill=c)
            d.rounded_rectangle((x + s * h * 0.16 - h * 0.05, yb - h * 0.3, x + s * h * 0.16 + h * 0.05, yb), radius=int(h * 0.05), fill=c)

    def lapida(x, y, h):
        c = _mix((110, 110, 120), niebla, bruma)
        d.rounded_rectangle((x - h * 0.12, y - h * 0.3, x + h * 0.12, y), radius=int(h * 0.1), fill=c)
        d.rectangle((x - h * 0.02, y - h * 0.26, x + h * 0.02, y - h * 0.1), fill=_mix(c, (0, 0, 0), 0.3))

    def edificio(x, y, h, neon=False):
        w = h * (0.25 + r.random() * 0.25)
        c = _mix((58, 64, 76) if not neon else (30, 26, 60), niebla, bruma)
        d.rectangle((x - w / 2, y - h, x + w / 2, y), fill=c)
        if neon:
            ven, prob = None, 0.3
        elif noche:
            ven, prob = (255, 214, 120), 0.24
        else:  # de día: vidrios que reflejan el cielo, casi ninguna luz
            ven, prob = _mix(_rgb(P[1]), (255, 255, 255), 0.25), 0.42
        for fy in range(int(h / 9)):
            for fx in range(int(w / 7)):
                if r.random() < prob:
                    vx, vy = x - w / 2 + 3 + fx * 7, y - h + 4 + fy * 9
                    col = r.choice([(255, 80, 216), (60, 240, 255), (255, 230, 90)]) if neon else ven
                    d.rectangle((vx, vy, vx + 3, vy + 4), fill=_mix(col, niebla, bruma * 0.5))

    def cristal(x, y, h):
        c = _mix((150, 110, 255), niebla, bruma)
        for k in range(3):
            ox, hh = (k - 1) * h * 0.12, h * (0.6 + 0.4 * (k == 1))
            d.polygon([(x + ox - h * 0.07, y), (x + ox + h * 0.07, y), (x + ox + h * 0.03, y - hh), (x + ox, y - hh - h * 0.12), (x + ox - h * 0.04, y - hh)], fill=c)

    def hongo(x, y, h):
        d.rectangle((x - h * 0.06, y - h * 0.5, x + h * 0.06, y), fill=_mix((235, 225, 210), niebla, bruma))
        d.pieslice((x - h * 0.3, y - h * 0.8, x + h * 0.3, y - h * 0.3), 180, 360, fill=_mix((200, 60, 90), niebla, bruma))

    tipos = {"pinos": [(pino, 0.7), (redondo, 0.3)], "granja": [(redondo, 0.85), (pino, 0.15)], "castillo": [(redondo, 0.7), (pino, 0.3)],
             "dunas": [(cactus, 1.0)], "nevado": [(pino, 1.0)], "playa": [(palmera, 1.0)], "ciudad": [(edificio, 1.0)],
             "neon": [(edificio, 1.0)], "fantasia": [(redondo, 0.5), (hongo, 0.25), (cristal, 0.25)], "terror": [(seco, 0.7), (lapida, 0.3)],
             "espacio": [(cristal, 1.0)], "selva": [(palmera, 0.4), (redondo, 0.6)], "andes": [(pino, 0.5), (redondo, 0.5)],
             "volcan": [(seco, 1.0)]}.get(estilo, [(redondo, 1.0)])
    x = r.random() * 30
    paso = 26 / max(0.2, densidad)
    while x < W:
        fn = r.choices([t[0] for t in tipos], [t[1] for t in tipos])[0]
        h = (40 + r.random() * 70) * escala * (1.35 if fn is edificio else 1.0)
        xi = int(x) % W
        y = H - perfil[xi] + 4
        if fn is pino:
            _dup(lambda xx: pino(xx, y, h, estilo == "nevado"), x, W, h)
        elif fn is edificio:
            _dup(lambda xx: edificio(xx, y, h, estilo == "neon"), x, W, h)
        else:
            _dup(lambda xx: fn(xx, y, h), x, W, h)
        x += paso * (0.4 + r.random() * 1.6) * (2.0 if fn is edificio else 1.0)


def fondo_capas(tema="bosque", hora="dia", ancho=1920, alto=540, semilla=1):
    """→ {"cielo", "lejos", "medio", "cerca", "vista"}: imágenes RGBA del mismo tamaño que se repiten en horizontal."""
    if np is None:
        raise RuntimeError("Para crear fondos hace falta numpy (pip install numpy)")
    W, H = int(ancho), int(alto)
    P = paleta(tema, hora)
    estilo = P[7]
    noche = hora == "noche" or estilo in ("neon", "terror", "espacio")
    if hora == "noche" and estilo not in ("espacio", "terror", "neon"):
        estilo_cielo = estilo
    else:
        estilo_cielo = estilo
    capas = {}
    capas["cielo"] = _a_img(_cielo(W, H, P, hora, estilo_cielo, semilla))
    # lejos: cordillera (o mesas, horizonte de mar, ciudad lejana)
    if estilo in ("playa",):
        perfil = np.full(W, H * 0.36)
        rgb, alfa = _capa_relieve(W, H, perfil, P[2], P[6], 0.25, semilla + 30, textura=0.03)
        yy = np.arange(H)[:, None]
        brillo = (_ruido(W, H, 60, 30, semilla + 31, 3) > 0.72) * np.clip(1 - (yy - (H - perfil[None, :])) / (H * 0.3), 0, 1)
        rgb = rgb + brillo[..., None] * 0.25
        isla = _perfil_montes(W, H, semilla + 32, 0.36, 0.08, 3)
        rgb2, alfa2 = _capa_relieve(W, H, isla, P[4], P[6], 0.55, semilla + 33)
        alfa2 = alfa2 * (isla[None, :] > H * 0.385)
        rgb = rgb * (1 - alfa2[..., None]) + rgb2 * alfa2[..., None]
        alfa = np.maximum(alfa, alfa2)
    elif estilo == "dunas":
        perfil = _perfil_montes(W, H, semilla + 30, 0.34, 0.18, 3, picos=False)
        rgb, alfa = _capa_relieve(W, H, perfil, P[2], P[6], 0.35, semilla + 30, textura=0.05)
    elif estilo in ("ciudad", "neon"):
        perfil = _perfil_montes(W, H, semilla + 30, 0.3, 0.12, 3, picos=False)
        rgb, alfa = _capa_relieve(W, H, perfil, P[2], P[6], 0.5, semilla + 30, textura=0.04)
    else:
        nieve = {"nevado": 0.42, "andes": 0.55, "castillo": 0.66, "pinos": 0.64, "volcan": None}.get(estilo, 0.7 if estilo != "terror" else None)
        perfil = _perfil_montes(W, H, semilla + 30, 0.3, 0.36 if estilo in ("andes", "nevado") else 0.26, 4)
        rgb, alfa = _capa_relieve(W, H, perfil, P[2], P[6], 0.38, semilla + 30, nieve=nieve)
    lejos = _a_img(rgb, alfa)
    if estilo in ("ciudad", "neon"):
        _arboles(lejos, W, H, perfil, estilo, P, semilla + 34, 0.55, escala=1.1, densidad=1.2, noche=noche)
    capas["lejos"] = lejos
    # medio: colinas con árboles (o dunas, playa, ciudad)
    perfil2 = _perfil_montes(W, H, semilla + 40, 0.2 if estilo != "playa" else 0.16, 0.12, 3, picos=False)
    rgb, alfa = _capa_relieve(W, H, perfil2, P[3], P[6], 0.16, semilla + 40, textura=0.1)
    medio = _a_img(rgb, alfa)
    _arboles(medio, W, H, perfil2, estilo, P, semilla + 41, 0.22, escala=1.0, densidad=1.0, noche=noche)
    capas["medio"] = medio
    # cerca: primer plano oscuro (matas, rocas y pasto) — da profundidad
    perfil3 = _perfil_montes(W, H, semilla + 50, 0.08, 0.06, 6, picos=False)
    rgb, alfa = _capa_relieve(W, H, perfil3, P[5], P[6], 0.0, semilla + 50, textura=0.14)
    cerca = _a_img(rgb, alfa)
    d = ImageDraw.Draw(cerca)
    import random
    r = random.Random(semilla + 51)
    c_pasto = _mix(_rgb(P[5]), (255, 255, 230), 0.12)
    c_mata = _mix(_rgb(P[5]), (0, 0, 0), 0.1)
    for _ in range(int(W / 9)):
        x = r.random() * W
        y = H - perfil3[int(x) % W] + 3
        h = 8 + r.random() * 18
        _dup(lambda xx: d.line([(xx, y), (xx + (r.random() - 0.5) * 8, y - h)], fill=c_pasto, width=2), x, W, 10)
    for _ in range(int(W / 220)):
        x = r.random() * W
        y = H - perfil3[int(x) % W] + 6
        rr = 14 + r.random() * 26

        def mata(xx):
            for k in range(4):
                ox, oy, q = (r.random() - 0.5) * rr, -r.random() * rr * 0.6, rr * (0.45 + r.random() * 0.3)
                d.ellipse((xx + ox - q, y + oy - q, xx + ox + q, y + oy + q * 0.8), fill=_mix(c_mata, (255, 255, 230), 0.05 * k))
        _dup(mata, x, W, rr * 2)
    capas["cerca"] = cerca
    vista = capas["cielo"].copy()
    for k in ("lejos", "medio", "cerca"):
        vista.alpha_composite(capas[k])
    capas["vista"] = vista
    return capas


# ───────────── Texturas sin costuras y baldosas (tiles) para el motor 2D ─────────────
def textura(tipo="pasto", tam=256, tema="bosque", semilla=1):
    """Textura que encaja sin costuras: pasto, tierra, piedra, arena, nieve, madera, ladrillo, agua, lava, metal."""
    if np is None:
        raise RuntimeError("Para crear texturas hace falta numpy (pip install numpy)")
    P = paleta(tema)
    n = _ruido(tam, tam, 4, 4, semilla, 6)
    f = _ruido(tam, tam, 32, 32, semilla + 1, 3)
    yy, xx = np.mgrid[0:tam, 0:tam]
    if tipo == "pasto":
        c1, c2 = _col(P[3]), _col(G.mezclar_hex(P[3], "#e8f070", 0.25))
        hebra = _ruido(tam, tam, 64, 16, semilla + 2, 2)
        rgb = c1 * (0.7 + 0.5 * n[..., None]) * (1 - 0.3 * hebra[..., None]) + (c2 - c1) * (f[..., None] > 0.72) * 0.6
    elif tipo in ("tierra", "arena", "nieve"):
        base = {"tierra": "#7a5a3a", "arena": "#d9b878", "nieve": "#eef4fa"}[tipo]
        c = _col(base)
        piedritas = (_ruido(tam, tam, 24, 24, semilla + 3, 2) > 0.74).astype(float)
        rgb = c * (0.78 + 0.4 * n[..., None]) * (1 - 0.08 * f[..., None]) - piedritas[..., None] * 0.12
    elif tipo == "piedra":  # adoquines tipo Voronoi con juntas oscuras
        k = 6
        rng = np.random.default_rng(semilla)
        pts = (np.stack(np.meshgrid(np.arange(k), np.arange(k)), -1).reshape(-1, 2) + rng.random((k * k, 2))) * (tam / k)
        d1 = np.full((tam, tam), 1e9)
        d2 = np.full((tam, tam), 1e9)
        idc = np.zeros((tam, tam), int)
        for i, (px, py) in enumerate(pts):
            for ox in (-tam, 0, tam):
                for oy in (-tam, 0, tam):
                    d = np.hypot(xx - px - ox, yy - py - oy)
                    nuevo = d < d1
                    d2 = np.where(nuevo, d1, np.minimum(d2, d))
                    idc = np.where(nuevo, i, idc)
                    d1 = np.minimum(d1, d)
        junta = _suave(0, 5, d2 - d1)
        tono = (rng.random(k * k)[idc] - 0.5) * 0.18
        c = _col(G.mezclar_hex(P[2], "#9a948a", 0.6))
        rgb = c * (0.75 + 0.35 * n[..., None] + tono[..., None]) * (0.45 + 0.55 * junta[..., None])
    elif tipo == "ladrillo":
        fila = (yy // (tam // 8))
        desf = (fila % 2) * (tam // 8)
        bx = (xx + desf) % (tam // 4)
        by = yy % (tam // 8)
        mortero = ((bx < 3) | (by < 3)).astype(float)
        rng = np.random.default_rng(semilla)
        idb = (fila * 7 + (xx + desf) // (tam // 4)) % 97
        tono = (rng.random(97)[idb] - 0.5) * 0.25
        c = _col("#a0503a")
        rgb = c * (0.8 + tono[..., None] + 0.25 * n[..., None]) * (1 - mortero[..., None]) + _col("#b8b0a0") * mortero[..., None] * (0.8 + 0.2 * f[..., None])
    elif tipo == "madera":
        veta = np.sin((xx / tam * 6 + n * 3) * math.pi * 2) * 0.5 + 0.5
        tabla = ((yy % (tam // 4)) < 3).astype(float)
        c = _col("#9a6a3a")
        rgb = c * (0.75 + 0.3 * veta[..., None] * 0.6 + 0.2 * f[..., None]) * (1 - 0.6 * tabla[..., None])
    elif tipo in ("agua", "lava"):
        c1, c2 = (_col(P[6] if False else "#1e6fa8"), _col("#7fd0ff")) if tipo == "agua" else (_col("#8a1a06"), _col("#ffb13a"))
        ond = _ruido(tam, tam, 6, 6, semilla + 4, 5)
        cres = _suave(0.55, 0.75, ond)
        rgb = c1 * (1 - cres[..., None]) + c2 * cres[..., None]
    else:  # metal
        rayas = _ruido(tam, tam, 64, 2, semilla + 5, 3)
        rgb = _col("#8a9098") * (0.8 + 0.25 * rayas[..., None] + 0.1 * n[..., None])
    return _a_img(rgb)


TILES = ["tope", "tierra", "piedra", "ladrillo", "madera", "pinchos", "agua", "pared", "pasto", "arbol"]


def _obstaculo_cenital(tema, t, semilla, P):
    import random
    r = random.Random(semilla)
    T3 = t * 3
    im = Image.new("RGBA", (T3, T3), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    tipo = {"desierto": "roca", "volcan": "roca", "espacio": "cristal", "futurista": "caja_metal", "ciudad": "jardinera", "zombies": "caja",
            "deportes": "jardinera", "oceano": "palmera", "nieve": "pino_nieve", "andes": "pino", "terror": "arbol_seco"}.get(tema, "arbol")
    c = T3 / 2
    sombra = Image.new("RGBA", (T3, T3), (0, 0, 0, 0))
    ImageDraw.Draw(sombra).ellipse((c - T3 * 0.3 + T3 * 0.07, c - T3 * 0.26 + T3 * 0.09, c + T3 * 0.3 + T3 * 0.07, c + T3 * 0.3 + T3 * 0.09), fill=(0, 0, 0, 70))
    im.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(T3 * 0.04)))  # sombra suave
    if tipo in ("arbol", "pino", "pino_nieve", "arbol_seco"):
        hoja_c = _rgb(P[4]) if tipo != "arbol_seco" else (70, 60, 50)
        if max(hoja_c) < 70:
            hoja_c = _mix(hoja_c, (90, 130, 70), 0.5)
        capas = [(0.44, 0.0, 0.25), (0.34, 0.1, 0.05), (0.24, 0.18, -0.12), (0.13, 0.24, -0.3)]
        for rr, luz, osc in capas:
            for k in range(7 if tipo == "arbol" else 9):
                a = k / (7 if tipo == "arbol" else 9) * 6.283 + r.random() * 0.5
                q = T3 * rr * (0.55 if tipo == "arbol" else 0.35)
                px, py = c + math.cos(a) * T3 * rr * 0.55 - T3 * luz * 0.15, c + math.sin(a) * T3 * rr * 0.55 - T3 * luz * 0.15
                col = _mix(hoja_c, (255, 255, 220) if osc < 0 else (0, 0, 0), abs(osc))
                if tipo == "pino_nieve" and rr < 0.3:
                    col = _mix(col, (240, 246, 255), 0.7)
                if tipo == "arbol_seco":
                    d.line([(c, c), (px, py)], fill=col + (255,), width=max(2, int(T3 * 0.03)))
                else:
                    d.ellipse((px - q, py - q, px + q, py + q), fill=col + (255,))
        if tipo == "arbol_seco":
            d.ellipse((c - T3 * 0.06, c - T3 * 0.06, c + T3 * 0.06, c + T3 * 0.06), fill=(60, 48, 38, 255))
    elif tipo == "roca":
        base = (138, 120, 100) if tema != "volcan" else (70, 56, 52)
        pts = [(c + math.cos(a) * T3 * (0.34 + 0.06 * r.random()), c + math.sin(a) * T3 * (0.3 + 0.06 * r.random())) for a in [k / 9 * 6.283 for k in range(9)]]
        d.polygon(pts, fill=_mix(base, (0, 0, 0), 0.25) + (255,))
        d.polygon([(x - T3 * 0.03, y - T3 * 0.04) for x, y in pts], fill=base + (255,))
        d.polygon([(c + (x - c) * 0.55 - T3 * 0.06, c + (y - c) * 0.55 - T3 * 0.08) for x, y in pts], fill=_mix(base, (255, 255, 240), 0.2) + (255,))
        if tema == "volcan":
            d.line([(c - T3 * 0.15, c), (c + T3 * 0.1, c + T3 * 0.08)], fill=(255, 120, 30, 255), width=max(2, int(T3 * 0.02)))
    elif tipo == "palmera":
        for k in range(7):
            a = k / 7 * 6.283
            ex, ey = c + math.cos(a) * T3 * 0.42, c + math.sin(a) * T3 * 0.42
            d.polygon([(c, c), (ex + math.cos(a + 1.57) * T3 * 0.07, ey + math.sin(a + 1.57) * T3 * 0.07), (ex, ey),
                       (ex - math.cos(a + 1.57) * T3 * 0.07, ey - math.sin(a + 1.57) * T3 * 0.07)], fill=_mix((70, 140, 60), (0, 0, 0), 0.1 * (k % 2)) + (255,))
        d.ellipse((c - T3 * 0.06, c - T3 * 0.06, c + T3 * 0.06, c + T3 * 0.06), fill=(120, 90, 50, 255))
    elif tipo in ("caja", "caja_metal"):
        base = (150, 110, 64) if tipo == "caja" else (96, 104, 120)
        for (ox, oy, w) in ((-0.2, -0.16, 0.34), (0.16, 0.12, 0.3)):
            x0, y0, x1, y1 = c + T3 * (ox - w / 2), c + T3 * (oy - w / 2), c + T3 * (ox + w / 2), c + T3 * (oy + w / 2)
            d.rectangle((x0, y0, x1, y1), fill=base + (255,), outline=_mix(base, (0, 0, 0), 0.45) + (255,), width=max(2, int(T3 * 0.015)))
            if tipo == "caja":
                for k in range(1, 4):
                    yk = y0 + (y1 - y0) * k / 4
                    d.line([(x0, yk), (x1, yk)], fill=_mix(base, (0, 0, 0), 0.3) + (255,), width=max(1, int(T3 * 0.008)))
                d.line([(x0, y0), (x1, y1)], fill=_mix(base, (0, 0, 0), 0.35) + (255,), width=max(2, int(T3 * 0.02)))
            else:
                d.rectangle((x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.45, x1 - (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.55), fill=(60, 240, 255, 255))
    elif tipo == "jardinera":
        d.rectangle((c - T3 * 0.36, c - T3 * 0.36, c + T3 * 0.36, c + T3 * 0.36), fill=(150, 150, 156, 255), outline=(100, 100, 106, 255), width=max(2, int(T3 * 0.03)))
        for k in range(8):
            a, rr = r.random() * 6.283, r.random() * T3 * 0.2
            q = T3 * (0.1 + r.random() * 0.06)
            px, py = c + math.cos(a) * rr, c + math.sin(a) * rr
            d.ellipse((px - q, py - q, px + q, py + q), fill=_mix((70, 130, 60), (255, 255, 220) if k > 4 else (0, 0, 0), 0.15) + (255,))
    else:  # cristal
        for k in range(5):
            a = k / 5 * 6.283 + 0.3
            px, py = c + math.cos(a) * T3 * 0.14, c + math.sin(a) * T3 * 0.14
            d.polygon([(px, py - T3 * 0.18), (px + T3 * 0.09, py), (px, py + T3 * 0.14), (px - T3 * 0.09, py)], fill=_mix((150, 110, 255), (255, 255, 255), 0.15 * (k % 2)) + (255,))
    return im.filter(ImageFilter.GaussianBlur(T3 / 220)).resize((t, t), Image.LANCZOS)


def tileset(tema="bosque", tam=48, semilla=1):
    """Fila de baldosas para el motor 2D (mismo orden que TILES). Colores del tema, con luz de arriba y bordes."""
    if np is None:
        raise RuntimeError("Para crear baldosas hace falta numpy (pip install numpy)")
    P = paleta(tema)
    t = tam
    hoja = Image.new("RGBA", (t * len(TILES), t), (0, 0, 0, 0))
    suelo_tema = {"desierto": "arena", "nieve": "nieve", "oceano": "arena", "espacio": "piedra", "ciudad": "piedra", "futurista": "metal"}.get(tema, "tierra")
    pasto_tema = {"desierto": "arena", "nieve": "nieve", "espacio": "piedra", "ciudad": "piedra", "futurista": "metal", "volcan": "piedra"}.get(tema, "pasto")
    tierra = textura(suelo_tema, t, tema, semilla).convert("RGBA")
    pasto = textura(pasto_tema, t, tema, semilla + 1).convert("RGBA")
    piedra = textura("piedra", t, tema, semilla + 2).convert("RGBA")
    ladr = textura("ladrillo", t, tema, semilla + 3).convert("RGBA")
    madera = textura("madera", t, tema, semilla + 4).convert("RGBA")
    agua = textura("agua" if tema != "volcan" else "lava", t, tema, semilla + 5).convert("RGBA")

    def sombreado(im, arriba=0.12, abajo=0.22):
        a = np.asarray(im).astype(float) / 255
        g = np.linspace(1 + arriba, 1 - abajo, t)[:, None, None]
        a[..., :3] *= g
        return _a_img(a[..., :3], a[..., 3])
    # tope: pasto arriba con borde orgánico (periódico: encaja con la baldosa vecina), briznas y sombra de contacto
    a_t = np.asarray(sombreado(tierra)).astype(float) / 255
    a_p = np.asarray(pasto).astype(float) / 255
    xs_ = np.arange(t)
    rng = np.random.default_rng(semilla)
    fases = rng.random(3) * 6.28
    borde = t * 0.3 + t * (0.045 * np.sin(xs_ / t * 6.283 * 2 + fases[0]) + 0.03 * np.sin(xs_ / t * 6.283 * 5 + fases[1])
                           + 0.02 * np.sin(xs_ / t * 6.283 * 9 + fases[2]))
    for k in range(int(t / 5)):  # briznas que cuelgan sobre la tierra
        x0 = int(rng.integers(0, t))
        largo = t * (0.04 + 0.1 * rng.random())
        for dx in (-1, 0, 1):
            xi = (x0 + dx) % t
            borde[xi] = max(borde[xi], borde[x0] + largo * (1 - 0.5 * abs(dx)))
    yy = np.arange(t)[:, None]
    m = _suave(1.0, -1.0, yy - borde[None, :])
    sombra = np.exp(-np.clip(yy - borde[None, :], 0, None) / (t * 0.09)) * (yy > borde[None, :])
    luz_p = 1.2 - 0.35 * np.clip(yy / (borde[None, :] + 1e-6), 0, 1)
    rgb = a_t[..., :3] * (1 - m[..., None]) + a_p[..., :3] * luz_p[..., None] * m[..., None]
    rgb *= (1 - 0.45 * sombra[..., None])
    rgb[: max(1, t // 24)] = rgb[: max(1, t // 24)] * 1.25 + 0.04
    tope = _a_img(rgb)
    hoja.paste(tope, (0, 0))
    hoja.paste(sombreado(tierra, 0.02, 0.28), (t, 0))
    hoja.paste(sombreado(piedra, 0.05, 0.2), (2 * t, 0))
    hoja.paste(sombreado(ladr, 0.05, 0.15), (3 * t, 0))
    # madera: plataforma (solo la franja de arriba)
    plat = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    tabla = madera.crop((0, 0, t, int(t * 0.34)))
    plat.paste(tabla, (0, 0))
    d = ImageDraw.Draw(plat)
    d.line([(0, 0), (t, 0)], fill=(230, 190, 130, 255), width=2)
    d.line([(0, int(t * 0.34) - 1), (t, int(t * 0.34) - 1)], fill=(60, 36, 18, 255), width=2)
    for x in (t * 0.18, t * 0.82):
        d.ellipse((x - 2, t * 0.14, x + 2, t * 0.14 + 4), fill=(60, 60, 64, 255))
    hoja.alpha_composite(plat, (4 * t, 0))
    # pinchos metálicos
    pin = Image.new("RGBA", (t * 3, t * 3), (0, 0, 0, 0))
    d = ImageDraw.Draw(pin)
    for k in range(4):
        x0 = k * t * 3 / 4
        d.polygon([(x0 + 3, t * 3), (x0 + t * 3 / 8, t * 1.2), (x0 + t * 3 / 4 - 3, t * 3)], fill=(150, 158, 170, 255))
        d.polygon([(x0 + t * 3 / 8, t * 1.2), (x0 + t * 3 / 4 - 3, t * 3), (x0 + t * 3 / 8 + 2, t * 3)], fill=(95, 100, 112, 255))
    hoja.alpha_composite(pin.resize((t, t), Image.LANCZOS), (5 * t, 0))
    ag = np.asarray(agua).astype(float) / 255
    ag[..., 3] = 0.82
    ag[:3, :, :3] = np.array([0.85, 0.95, 1.0]) if tema != "volcan" else np.array([1.0, 0.85, 0.4])
    hoja.alpha_composite(_a_img(ag[..., :3], ag[..., 3]), (6 * t, 0))
    hoja.paste(sombreado(piedra, 0.15, 0.3), (7 * t, 0))
    hoja.paste(pasto, (8 * t, 0))
    # obstáculo visto desde arriba (vista cenital), según el tema: copa de árbol, pino nevado, roca, palmera, cajas, cristal…
    hoja.alpha_composite(_obstaculo_cenital(tema, t, semilla, P), (9 * t, 0))
    return hoja


# ───────────── Crear y guardar (con reutilización: si ya existe idéntico no se vuelve a dibujar) ─────────────
def _obtener(tipo, nombre, ficha, firma, generar, base=None):
    dcat = carpeta_creados(base) / CATEGORIAS[tipo]
    if dcat.exists():
        ya = _buscar(dcat, firma)
        if ya:
            return ya
    res = generar()
    extra = None
    ficha = dict(ficha)
    if tipo == "sprites":
        img, meta = res
        ficha["hoja"] = meta
    elif tipo == "fondo":
        img = res["vista"]
        extra = {k: v for k, v in res.items() if k != "vista"}
    else:
        img = res
    return _guardar(img, tipo, nombre, ficha, firma, base, extra)


def _nom_pl(pl, nombre=None):
    return nombre or _pl(pl)["nombre"]


def crear_retrato(pl, cambios=None, tema=None, enemigo=None, nombre=None, tam=256, base=None):
    pl = _pl(pl)
    firma = _firma("retrato", pl["id"], cambios or {}, tema, enemigo, tam, F.VERSION_FIG)
    return _obtener("retrato", f"Retrato {_nom_pl(pl, nombre)}", {"plantilla": pl["id"], "cambios": cambios or {}, "tema": tema,
                    "rol": pl.get("rol"), "enemigo": bool(pl.get("enemigo") if enemigo is None else enemigo)}, firma,
                    lambda: retrato(pl, cambios, tema, tam, enemigo), base)


def crear_tarjeta(pl, cambios=None, arma=None, nombre=None, tam=256, base=None):
    pl = _pl(pl)
    firma = _firma("tarjeta", pl["id"], cambios or {}, arma, tam, F.VERSION_FIG)
    return _obtener("tarjeta", _nom_pl(pl, nombre), {"plantilla": pl["id"], "cambios": cambios or {}, "arma": arma, "rol": pl.get("rol")},
                    firma, lambda: tarjeta(pl, cambios, tam, arma=arma), base)


def crear_icono(pl, cambios=None, nombre=None, tam=256, fondo=None, base=None):
    pl = _pl(pl)
    firma = _firma("icono", pl["id"], cambios or {}, tam, fondo, F.VERSION_FIG)
    return _obtener("icono", _nom_pl(pl, nombre), {"plantilla": pl["id"], "cambios": cambios or {}, "rol": pl.get("rol"),
                    "tipo_objeto": pl.get("tipo")}, firma, lambda: icono(pl, cambios, tam, fondo), base)


def crear_sprites(pl, cambios=None, vista="lateral", alto_px=112, arma=None, pixel=False, nombre=None, anims=None, base=None):
    pl = _pl(pl)
    firma = _firma("sprites", pl["id"], cambios or {}, vista, alto_px, arma, pixel, anims, F.VERSION_FIG)
    nom = f"{_nom_pl(pl, nombre)} - {'lateral' if vista == 'lateral' else 'cenital'}{' pixel' if pixel else ''}"
    return _obtener("sprites", nom, {"plantilla": pl["id"], "cambios": cambios or {}, "rol": pl.get("rol"), "vista": vista, "arma": arma},
                    firma, lambda: hoja_sprites(pl, cambios, vista, alto_px, arma, pixel, anims=anims), base)


def crear_giro(pl, cambios=None, tam=64, nombre=None, base=None):
    pl = _pl(pl)
    firma = _firma("giro", pl["id"], cambios or {}, tam, F.VERSION_FIG)
    return _obtener("sprites", f"{_nom_pl(pl, nombre)} - giro", {"plantilla": pl["id"], "cambios": cambios or {}, "rol": pl.get("rol"),
                    "vista": "giro"}, firma, lambda: hoja_giro(pl, cambios, tam), base)


def crear_fondo(tema="bosque", hora="dia", ancho=1920, alto=540, semilla=1, nombre=None, base=None):
    firma = _firma("fondo", tema, hora, ancho, alto, semilla)
    nom = nombre or f"Fondo {tema} {hora}"
    return _obtener("fondo", nom, {"tema": tema, "hora": hora, "semilla": semilla, "uso": "parallax: cielo (fijo) · lejos · medio · cerca"},
                    firma, lambda: fondo_capas(tema, hora, ancho, alto, semilla), base)


def crear_textura(tipo="pasto", tema="bosque", tam=256, semilla=1, nombre=None, base=None):
    firma = _firma("textura", tipo, tema, tam, semilla)
    return _obtener("textura", nombre or f"Textura {tipo} {tema}", {"tema": tema, "material": tipo, "sin_costuras": True}, firma,
                    lambda: textura(tipo, tam, tema, semilla), base)


def crear_tiles(tema="bosque", tam=48, semilla=1, nombre=None, base=None):
    firma = _firma("tiles", tema, tam, semilla)
    return _obtener("tiles", nombre or f"Baldosas {tema}", {"tema": tema, "orden": TILES, "tam": tam}, firma,
                    lambda: tileset(tema, tam, semilla), base)


TIPOS_TEXTO = [
    ("fondo", r"\b(fondo|paisaje|panorama|parallax|escenario|cielo)\b"),
    ("textura", r"\b(textura|material|suelo sin costura)\b"),
    ("tiles", r"\b(baldosas?|tiles?|tileset)\b"),
    ("sprites", r"\b(sprites?|hoja de sprites|animaci[oó]n 2d|spritesheet)\b"),
    ("icono", r"\b(icono|ícono|item|ítem|objeto de inventario)\b"),
    ("retrato", r"\b(retrato|avatar|cara|rostro|busto|perfil)\b"),
    ("tarjeta", r"\b(tarjeta|carta|personaje de cuerpo)\b"),
]
HORAS = {"noche": r"noche|nocturn|luna", "atardecer": r"atardecer|ocaso|puesta de sol|amanecer|sunset"}
MATERIALES_TEX = ["pasto", "tierra", "piedra", "arena", "nieve", "madera", "ladrillo", "agua", "lava", "metal"]


def crear_desde_texto(texto, base=None):
    """«retrato de una bruja», «fondo de bosque al atardecer», «sprites de un lobo pixel», «icono de espada», «textura de piedra»…"""
    t = unicodedata.normalize("NFKD", str(texto or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    tipo = next((k for k, rx in TIPOS_TEXTO if re.search(rx, t)), None)
    tema = next((k for k in list(PALETAS) + list(ALIAS_TEMA) if re.search(r"\b" + k, t)), None)
    tema = ALIAS_TEMA.get(tema, tema)
    hora = next((h for h, rx in HORAS.items() if re.search(rx, t)), "dia")
    if tipo == "fondo":
        return crear_fondo(tema or "bosque", hora, base=base)
    if tipo == "textura":
        m = next((x for x in MATERIALES_TEX if x in t), "piedra")
        return crear_textura(m, tema or "bosque", base=base)
    if tipo == "tiles":
        return crear_tiles(tema or "bosque", base=base)
    pl, cambios, _ = F.desde_texto(texto)
    cambios = cambios or {}
    if tipo is None:
        tipo = "icono" if pl["rig"] in ("arma", "objeto") else "retrato"
    if tipo == "icono":
        return crear_icono(pl, cambios, base=base)
    if tipo == "sprites":
        vista = "superior" if re.search(r"cenital|desde arriba|top.?down|superior", t) else "lateral"
        return crear_sprites(pl, cambios, vista, pixel="pixel" in t, base=base)
    if tipo == "tarjeta":
        return crear_tarjeta(pl, cambios, base=base)
    return crear_retrato(pl, cambios, tema=tema, base=base)


# ───────────── Para un juego del Estudio ─────────────
def _cambios_traje(trajes, t, vistos):
    pl = t.get("plantilla") if t.get("plantilla") in F.POR_ID else None
    cambios = {"_general": t["color"]} if pl in vistos and t.get("color") else {}
    return pl, cambios


def _alto_sprite(pl, base=104, minimo=44, maximo=150):
    return int(max(minimo, min(maximo, base * float(pl.get("altura") or 1.8) / 1.8)))


def para_juego(d, p, log=print, base=None):
    """Retratos (diálogos), tarjetas (elegir personaje), iconos (armas y objetos) y, para el motor 2D, hojas de sprites de todos
    los personajes, fondos por capas de cada zona y baldosas de cada tema. Todo queda también en la carpeta 2D."""
    import shutil
    p = Path(p)
    motor = d.get("motor")
    c = d.get("campana") or {}
    tema = d.get("tema") or "bosque"
    gen = d.get("genero")
    idea = d.get("idea") or d.get("descripcion") or ""
    iconos = p / "assets" / "iconos"
    iconos.mkdir(parents=True, exist_ok=True)
    cuenta = {"nuevos": 0, "reusados": 0}

    def usar(info, destino):
        cuenta["reusados" if info.get("reutilizado") else "nuevos"] += 1
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(info["png"], destino)
        return info

    def seguro(fn, que):
        try:
            return fn()
        except Exception as e:  # un diseño que falla no detiene el juego
            log(f"⚠ Diseño 2D ({que}): {str(e)[:140]}")
            return None
    trajes = c.get("trajes") or []
    pl_trajes = {t.get("plantilla") for t in trajes}
    bloques = motor == "voxel"  # en el motor vóxel, los retratos, tarjetas e iconos también en estilo bloques

    def est(pl, cam):
        if bloques and pl in F.POR_ID and F.POR_ID[pl]["rig"] in ("humanoide", "cuadrupedo") and not F.POR_ID[pl].get("bloques"):
            return dict(cam or {}, _estilo="bloques")
        return cam
    PIXEL = {"espada": "espada_pixel", "katana": "espada_pixel", "hacha": "hacha_pixel", "martillo": "hacha_pixel"}
    # retratos de los guías y del jefe (se ven en los diálogos)
    vistos_npc = set()
    for z in c.get("zonas") or []:
        npc = z.get("npc")
        if not npc or npc.get("plantilla") not in F.POR_ID:
            continue
        rol = npc.get("modelo") or "npc"
        if rol in vistos_npc:
            continue
        vistos_npc.add(rol)
        cam = est(npc["plantilla"], {"_general": "#7a4a8a", "pelo": "#e8e8e8"} if npc["plantilla"] in pl_trajes else {})
        npc["cambios"] = cam
        seguro(lambda: usar(crear_retrato(npc["plantilla"], cam, z.get("tema") or tema, False, npc.get("nombre"), base=base), iconos / f"npc_{rol}.png"),
               "retrato del guía")
    if c.get("jefe") and c["jefe"].get("plantilla") in F.POR_ID:
        j = c["jefe"]
        zt = ((c.get("zonas") or [{}])[-1]).get("tema") or tema
        seguro(lambda: usar(crear_retrato(j["plantilla"], est(j["plantilla"], j.get("cambios") or {}), zt, True, j.get("nombre"), base=base), iconos / "jefe.png"),
               "retrato del jefe")
    # tarjetas de los trajes y los iconos de las armas y los objetos
    arma0 = next((a.get("plantilla") for a in c.get("armas") or [] if a.get("plantilla") in F.POR_ID and a.get("tipo") == "cuerpo"), None)
    vistos = set()
    for t in trajes:
        pl, cam = _cambios_traje(trajes, t, vistos)
        if not pl:
            continue
        vistos.add(pl)
        cam = est(pl, cam)
        t["cambios"] = cam
        a0 = PIXEL.get(arma0, arma0) if bloques else arma0
        seguro(lambda: usar(crear_tarjeta(pl, cam, a0, t.get("nombre"), base=base), iconos / f"traje_{t.get('id', 't1')}.png"), "tarjeta")
    for a in c.get("armas") or []:
        if a.get("plantilla") in F.POR_ID:
            apl = PIXEL.get(a["plantilla"], a["plantilla"]) if bloques else a["plantilla"]
            seguro(lambda: usar(crear_icono(apl, {}, a.get("nombre"), base=base), iconos / f"arma_{a['id']}.png"), "icono de arma")
    objetos_pl = []
    for i, o in enumerate(d.get("objetos") or []):
        pl = F.para_rol("coleccionable", o.get("nombre") or "", tema, gen, forma=o.get("forma"))
        cam = {"color": o["color"]} if o.get("color") and pl.get("tipo") in ("gema", "cristal", "diamante", "estrella", "pocion") else {}
        objetos_pl.append((pl, cam))
        seguro(lambda: usar(crear_icono(pl, cam, o.get("nombre"), base=base), iconos / f"objeto_{i}.png"), "icono de objeto")
    if motor == "2d":
        seguro(lambda: _para_motor2d(d, p, c, tema, gen, idea, trajes, arma0, objetos_pl, usar, seguro, log, base), "motor 2D")
    if cuenta["nuevos"] or cuenta["reusados"]:
        log(f"🎨 Diseños 2D: {cuenta['nuevos']} nuevos + {cuenta['reusados']} reutilizados de tu carpeta 2D ({carpeta_creados(base)}): "
            "retratos, tarjetas e iconos" + (", sprites animados, fondos por capas y baldosas." if motor == "2d" else "."))
    return cuenta


def _para_motor2d(d, p, c, tema, gen, idea, trajes, arma0, objetos_pl, usar, seguro, log, base):
    lateral = d.get("camara") != "superior"
    vista = "lateral" if lateral else "superior"
    dd = p / "assets" / "2d"
    dd.mkdir(parents=True, exist_ok=True)
    g = {"version": 1, "escala": 3, "vista": vista, "jugador": {}, "enemigos": [], "objetos": [], "npcs": {}, "jefe": None, "fondos": {},
         "tiles": {}, "orden_tiles": TILES}

    def hoja(info, nombre):
        if not info:
            return None
        usar(info, dd / nombre)
        return {"hoja": f"assets/2d/{nombre}", "meta": info["hoja"]}
    log("🎞 Dibujando los sprites animados de los personajes (desde sus figuras 3D)…")
    lista_t = trajes or [{"id": "_", "plantilla": F.para_rol("jugador", idea, tema, gen)["id"]}]
    vistos = set()
    for t in lista_t:
        pl, cam = _cambios_traje(lista_t, t, vistos)
        pl = pl or F.para_rol("jugador", idea, tema, gen)["id"]
        vistos.add(pl)
        info = seguro(lambda: crear_sprites(pl, cam, vista, 112 if lateral else 80, arma0, base=base), "sprites del jugador")
        h = hoja(info, f"jugador_{t.get('id', '_')}.png")
        if h:
            g["jugador"][t.get("id", "_")] = h
    for i, e in enumerate(d.get("enemigos") or []):
        pl = F.para_rol("enemigo", e.get("nombre") or "", tema, gen, forma=e.get("forma"))
        info = seguro(lambda: crear_sprites(pl, {}, vista, _alto_sprite(pl, 104 if lateral else 80), base=base), "sprites de enemigo")
        g["enemigos"].append(hoja(info, f"enemigo_{i}.png"))
    j = c.get("jefe")
    if j and j.get("plantilla") in F.POR_ID:
        pl = F.POR_ID[j["plantilla"]]
        info = seguro(lambda: crear_sprites(pl, j.get("cambios") or {}, vista, _alto_sprite(pl, 150, 120, 220), base=base), "sprites del jefe")
        g["jefe"] = hoja(info, "jefe.png")
    for z in c.get("zonas") or []:
        npc = z.get("npc")
        if npc and npc.get("plantilla") in F.POR_ID and (npc.get("modelo") or "npc") not in g["npcs"]:
            rol = npc.get("modelo") or "npc"
            info = seguro(lambda: crear_sprites(npc["plantilla"], npc.get("cambios") or {}, vista, 104 if lateral else 80,
                                                anims=[("Idle", 6, 6, True)], base=base), "sprites del guía")
            g["npcs"][rol] = hoja(info, f"npc_{rol}.png")
    for i, (pl, cam) in enumerate(objetos_pl):
        info = seguro(lambda: crear_giro(pl, cam, 48, base=base), "objeto")
        g["objetos"].append(hoja(info, f"objeto_{i}.png"))
    # fondos por capas (vista lateral) y baldosas de cada tema
    zonas = c.get("zonas") or [{"tema": tema, "hora": (d.get("ambiente") or {}).get("hora", "dia")}]
    for k, z in enumerate(zonas):
        zt, zh = z.get("tema") or tema, z.get("hora") or "dia"
        if zh not in ("dia", "noche", "atardecer"):
            zh = "noche" if zh in ("noche", "medianoche") else "dia"
        clave = f"{zt}_{zh}"
        if lateral and clave not in g["fondos"]:
            info = seguro(lambda: crear_fondo(zt, zh, 1920, 540, semilla=(d.get("mundo") or {}).get("semilla", 1) + k, base=base), "fondo")
            if info:
                usar(info, dd / f"fondo_{clave}.png")
                carp = Path(info["png"]).parent
                capas = {}
                for n in ("cielo", "lejos", "medio", "cerca"):
                    if (carp / f"{n}.png").exists():
                        import shutil
                        shutil.copyfile(carp / f"{n}.png", dd / f"fondo_{clave}_{n}.png")
                        capas[n] = f"assets/2d/fondo_{clave}_{n}.png"
                g["fondos"][clave] = capas
        if zt not in g["tiles"]:
            info = seguro(lambda: crear_tiles(zt, 48, base=base), "baldosas")
            if info:
                usar(info, dd / f"tiles_{zt}.png")
                g["tiles"][zt] = f"assets/2d/tiles_{zt}.png"
    d["graficos2d"] = g
    return g
