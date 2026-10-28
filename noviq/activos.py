# -*- coding: utf-8 -*-
"""🧱 Buscador y galería de activos 3D libres para los juegos (y cualquier proyecto).

Fuentes:
- 📁 Tu carpeta 3D (biblioteca3d.py, por defecto <Noviq>/docs/3D): los modelos que ya descargaste. Van PRIMERO.
Galerías (todas legales y gratuitas):
- Poly Haven (CC0, sin clave): modelos realistas escaneados, texturas PBR y cielos HDRI. «Powered by Poly Haven».
- ambientCG (CC0, sin clave): materiales/texturas PBR y HDRI.
- Sketchfab (solo licencias libres CC0 / CC-BY, buscar sin clave; descargar requiere tu token gratuito de sketchfab.com).
- Poly Pizza (low poly, CC0 / CC-BY; necesita una clave gratuita de poly.pizza).
- Paquetes recomendados CC0 (Kenney, Quaternius) con su enlace para descargarlos.

La IA (o el 🎮 Estudio) busca según el género y la temática del juego, preselecciona lo que mejor encaja con el estilo
y con la tarjeta gráfica (cantidad de polígonos), y descarga todo al proyecto en formato .glb (un solo archivo por
modelo: los .gltf de Poly Haven se empaquetan en .glb), anotando licencia y autor en CREDITOS.md y en el juego."""
import base64
import hashlib
import json
import re
import shutil
import struct
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from .config import DATA_DIR

UA = {"User-Agent": "Noviq/4.3 (estudio de juegos; https://github.com/JUXN1988/NoviQ)"}
CACHE = DATA_DIR / "activos_cache"
_lock = threading.Lock()

FUENTES = {
    "local": {"nombre": "Tu carpeta 3D", "web": "", "licencia": "la del paquete", "clave": None, "tipos": ["modelo"], "estilo": "todos",
              "nota": "los modelos .glb/.gltf que guardaste en la carpeta estándar (por defecto docs/3D)"},
    "polyhaven": {"nombre": "Poly Haven", "web": "https://polyhaven.com", "licencia": "CC0", "clave": None,
                  "tipos": ["modelo", "textura", "hdri"], "estilo": "realista"},
    "ambientcg": {"nombre": "ambientCG", "web": "https://ambientcg.com", "licencia": "CC0", "clave": None,
                  "tipos": ["textura", "hdri"], "estilo": "realista"},
    "sketchfab": {"nombre": "Sketchfab", "web": "https://sketchfab.com", "licencia": "CC0 / CC-BY", "clave": "sketchfab",
                  "tipos": ["modelo"], "estilo": "todos", "clave_url": "https://sketchfab.com/settings/password",
                  "nota": "buscar no necesita clave; para descargar pega tu API token (gratis) en ⚙ Ajustes → Juegos"},
    "polypizza": {"nombre": "Poly Pizza", "web": "https://poly.pizza", "licencia": "CC0 / CC-BY", "clave": "polypizza",
                  "tipos": ["modelo"], "estilo": "lowpoly", "clave_url": "https://poly.pizza/settings/api",
                  "nota": "necesita una clave gratuita de poly.pizza"},
}

PAQUETES = [  # CC0, sin API: se enlazan para que el usuario (o el agente navegador) los descargue
    {"nombre": "Kenney · Nature Kit", "url": "https://kenney.nl/assets/nature-kit", "estilo": "lowpoly", "temas": ["bosque", "naturaleza"]},
    {"nombre": "Kenney · Castle Kit", "url": "https://kenney.nl/assets/castle-kit", "estilo": "lowpoly", "temas": ["medieval"]},
    {"nombre": "Kenney · Space Kit", "url": "https://kenney.nl/assets/space-kit", "estilo": "lowpoly", "temas": ["espacio"]},
    {"nombre": "Kenney · Racing Kit", "url": "https://kenney.nl/assets/racing-kit", "estilo": "lowpoly", "temas": ["carreras", "ciudad"]},
    {"nombre": "Kenney · Pirate Kit", "url": "https://kenney.nl/assets/pirate-kit", "estilo": "lowpoly", "temas": ["oceano"]},
    {"nombre": "Kenney · Platformer Kit", "url": "https://kenney.nl/assets/platformer-kit", "estilo": "lowpoly", "temas": ["plataformas"]},
    {"nombre": "Kenney · Pixel Platformer (2D)", "url": "https://kenney.nl/assets/pixel-platformer", "estilo": "pixel2d", "temas": ["plataformas"]},
    {"nombre": "Kenney · Voxel Pack", "url": "https://kenney.nl/assets/voxel-pack", "estilo": "voxel", "temas": ["construccion"]},
    {"nombre": "Quaternius · Ultimate Animated Characters", "url": "https://quaternius.com/packs/ultimatedanimatedcharacter.html",
     "estilo": "lowpoly", "temas": ["personajes"]},
    {"nombre": "Quaternius · Ultimate Monsters", "url": "https://quaternius.com/packs/ultimatemonsters.html", "estilo": "lowpoly",
     "temas": ["fantasia", "terror"]},
    {"nombre": "Quaternius · Zombie Apocalypse Kit", "url": "https://quaternius.com/packs/zombieapocalypsekit.html",
     "estilo": "lowpoly", "temas": ["zombies"]},
    {"nombre": "Mixamo (Adobe) · personajes y animaciones", "url": "https://www.mixamo.com", "estilo": "realista",
     "temas": ["personajes"], "nota": "gratis con cuenta de Adobe; se descarga a mano en FBX"},
]

# Español → inglés para buscar en las galerías (están en inglés)
ES_EN = {
    "arbol": "tree", "arboles": "trees", "roca": "rock", "rocas": "rocks", "piedra": "stone", "piedras": "stones",
    "casa": "house", "casas": "houses", "castillo": "castle", "torre": "tower", "puente": "bridge", "muro": "wall",
    "pared": "wall", "puerta": "door", "ventana": "window", "mesa": "table", "silla": "chair", "cama": "bed", "barril": "barrel",
    "caja": "crate", "cofre": "chest", "tesoro": "treasure", "moneda": "coin", "monedas": "coins", "gema": "gem", "gemas": "gems",
    "cristal": "crystal", "espada": "sword", "escudo": "shield", "arco": "bow", "flecha": "arrow", "pistola": "pistol",
    "rifle": "rifle", "caballero": "knight", "guerrero": "warrior", "soldado": "soldier", "mago": "wizard", "bruja": "witch",
    "dragon": "dragon", "zombie": "zombie", "zombi": "zombie", "esqueleto": "skeleton", "fantasma": "ghost", "robot": "robot",
    "nave": "spaceship", "naves": "spaceships", "planeta": "planet", "asteroide": "asteroid", "cohete": "rocket",
    "auto": "car", "carro": "car", "coche": "car", "camion": "truck", "moto": "motorcycle", "avion": "airplane", "barco": "boat",
    "perro": "dog", "gato": "cat", "caballo": "horse", "vaca": "cow", "lobo": "wolf", "oso": "bear", "pajaro": "bird",
    "pez": "fish", "tiburon": "shark", "dinosaurio": "dinosaur", "llama": "llama", "condor": "condor", "tortuga": "turtle",
    "iguana": "iguana", "cactus": "cactus", "palmera": "palm tree", "flor": "flower", "flores": "flowers", "pasto": "grass",
    "hierba": "grass", "cesped": "grass", "tierra": "dirt", "arena": "sand", "nieve": "snow", "hielo": "ice", "agua": "water",
    "lava": "lava", "madera": "wood", "ladrillo": "brick", "ladrillos": "bricks", "metal": "metal", "oxido": "rust",
    "baldosa": "tiles", "piso": "floor", "suelo": "ground", "asfalto": "asphalt", "camino": "path", "calle": "road",
    "cielo": "sky", "atardecer": "sunset", "noche": "night", "bosque": "forest", "montana": "mountain", "volcan": "volcano",
    "cueva": "cave", "desierto": "desert", "playa": "beach", "isla": "island", "ciudad": "city", "edificio": "building",
    "farola": "street lamp", "lampara": "lamp", "antorcha": "torch", "fuego": "fire", "hongo": "mushroom", "hongos": "mushrooms",
    "personaje": "character", "persona": "person", "hombre": "man", "mujer": "woman", "nino": "kid", "animal": "animal",
    "vehiculo": "vehicle", "arma": "weapon", "armas": "weapons", "mueble": "furniture", "planta": "plant", "plantas": "plants",
    "tronco": "log", "valla": "fence", "cerca": "fence", "pozo": "well", "molino": "windmill", "granja": "farm",
    "tractor": "tractor", "estatua": "statue", "columna": "column", "templo": "temple", "piramide": "pyramid",
    "calavera": "skull", "hueso": "bone", "pocion": "potion", "llave": "key", "bandera": "flag", "meta": "finish line",
    "arbusto": "bush", "arbustos": "bushes", "helecho": "fern", "pino": "pine tree", "abeto": "fir tree",
}


def _norm(t):
    import unicodedata
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def a_ingles(consulta):
    """Traduce palabra a palabra lo conocido (las galerías buscan en inglés)."""
    pal = re.findall(r"[a-z0-9ñ]+", _norm(consulta))
    out = [ES_EN.get(p, ES_EN.get(p.rstrip("s"), p)) for p in pal if p not in ("de", "del", "la", "el", "los", "las", "un", "una", "con", "y")]
    return " ".join(out) or consulta


# ───────────── Caché ─────────────
def _cache_get(clave, max_age=86400):
    f = CACHE / (hashlib.md5(clave.encode()).hexdigest() + ".json")
    try:
        if f.exists() and time.time() - f.stat().st_mtime < max_age:
            return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _cache_set(clave, valor):
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / (hashlib.md5(clave.encode()).hexdigest() + ".json")).write_text(json.dumps(valor), encoding="utf-8")
    except Exception:
        pass


def _get(url, params=None, headers=None, timeout=25):
    h = dict(UA)
    h.update(headers or {})
    r = requests.get(url, params=params, headers=h, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _clave(fuente):
    k = FUENTES.get(fuente, {}).get("clave")
    if not k:
        return None
    from . import vault
    ks = vault.get_keys(k)
    return ks[0] if ks else None


def _puntaje(consulta, textos):
    """Qué tanto coincide la búsqueda con el nombre/etiquetas (0-1)."""
    q = set(re.findall(r"[a-z0-9]+", _norm(consulta)))
    if not q:
        return 0.5
    txt = " ".join(_norm(t) for t in textos if t)
    toks = set(re.findall(r"[a-z0-9]+", txt))
    hit = sum(1 for w in q if w in toks or any(t.startswith(w) for t in toks if len(w) >= 4))
    return hit / len(q)


# ───────────── Poly Haven ─────────────
_PH_TIPOS = {"modelo": "models", "textura": "textures", "hdri": "hdris"}


def _polyhaven(consulta, tipo, limite):
    t = _PH_TIPOS.get(tipo, "models")
    lista = _cache_get("ph_" + t)
    if lista is None:
        lista = _get("https://api.polyhaven.com/assets", {"t": t})
        _cache_set("ph_" + t, lista)
    out = []
    for aid, a in (lista or {}).items():
        s = _puntaje(consulta, [aid, a.get("name"), " ".join(a.get("tags") or []), " ".join(a.get("categories") or [])])
        if s <= 0:
            continue
        out.append({"fuente": "polyhaven", "id": aid, "nombre": a.get("name") or aid, "tipo": tipo, "licencia": "CC0",
                    "autor": ", ".join((a.get("authors") or {}).keys()) or "Poly Haven",
                    "miniatura": a.get("thumbnail_url") or f"https://cdn.polyhaven.com/asset_img/thumbs/{aid}.png?width=256&height=256",
                    "url": f"https://polyhaven.com/a/{aid}", "caras": a.get("polycount"), "relevancia": s,
                    "descargas": a.get("download_count", 0), "estilo": "realista"})
    out.sort(key=lambda x: (-x["relevancia"], -(x["descargas"] or 0)))
    return out[:limite]


# ───────────── ambientCG ─────────────
def _ambientcg(consulta, tipo, limite):
    tipo_acg = {"textura": "Material", "hdri": "HDRI"}.get(tipo)
    if not tipo_acg:
        return []
    clave = f"acg_{tipo_acg}_{consulta}_{limite}"
    d = _cache_get(clave)
    if d is None:
        d = _get("https://ambientcg.com/api/v2/full_json", {"type": tipo_acg, "q": consulta, "limit": limite,
                                                            "include": "downloadData,imageData,tagData", "sort": "Popular"})
        _cache_set(clave, d)
    out = []
    for a in d.get("foundAssets") or []:
        prev = a.get("previewImage") or {}
        zips = (((a.get("downloadFolders") or {}).get("default") or {}).get("downloadFiletypeCategories") or {}).get("zip") or {}
        descargas = {x.get("attribute"): x.get("downloadLink") or x.get("fullDownloadPath") for x in zips.get("downloads") or []}
        out.append({"fuente": "ambientcg", "id": a.get("assetId"), "nombre": a.get("displayName") or a.get("assetId"),
                    "tipo": tipo, "licencia": "CC0", "autor": "ambientCG", "url": f"https://ambientcg.com/view?id={a.get('assetId')}",
                    "miniatura": prev.get("256-PNG") or prev.get("256-JPG-FFFFFF") or next(iter(prev.values()), ""),
                    "relevancia": max(0.4, _puntaje(consulta, [a.get("assetId"), a.get("displayName"), " ".join(a.get("tags") or [])])),
                    "archivos": {k: v for k, v in descargas.items() if k and k.startswith(("1K", "2K"))}, "estilo": "realista"})
    return out[:limite]


# ───────────── Sketchfab ─────────────
def _sketchfab(consulta, tipo, limite, solo_cc0=False, max_caras=None):
    if tipo != "modelo":
        return []
    params = {"type": "models", "q": consulta, "downloadable": "true", "count": min(24, limite * 2),
              "license": "cc0" if solo_cc0 else "by,cc0", "sort_by": "-likeCount"}
    if max_caras:
        params["max_face_count"] = int(max_caras)
    clave = "sf_" + json.dumps(params, sort_keys=True)
    d = _cache_get(clave, 6 * 3600)
    if d is None:
        d = _get("https://api.sketchfab.com/v3/search", params)
        _cache_set(clave, d)
    out = []
    for m in d.get("results") or []:
        lic = ((m.get("license") or {}).get("label") or "")
        if lic and not re.search(r"(?i)cc0|public domain|attribution(?!.*(nc|noncommercial|nd|noderiv))", lic):
            continue  # solo licencias que permiten usarlo en tu juego (incluso vendiéndolo)
        imgs = sorted(((m.get("thumbnails") or {}).get("images") or []), key=lambda i: abs((i.get("width") or 0) - 256))
        out.append({"fuente": "sketchfab", "id": m.get("uid"), "nombre": m.get("name"), "tipo": "modelo",
                    "licencia": "CC0" if re.search(r"(?i)cc0|public domain", lic) else "CC-BY 4.0",
                    "autor": (m.get("user") or {}).get("username", ""), "url": m.get("viewerUrl"),
                    "miniatura": imgs[0].get("url") if imgs else "", "caras": m.get("faceCount"),
                    "animado": bool(m.get("animationCount")), "relevancia": max(0.3, _puntaje(consulta, [m.get("name"), " ".join(
                        t.get("name", "") for t in m.get("tags") or [])])), "estilo": "todos"})
    return out[:limite]


# ───────────── Poly Pizza ─────────────
def _polypizza(consulta, tipo, limite, solo_cc0=False):
    if tipo != "modelo":
        return []
    k = _clave("polypizza")
    if not k:
        return []
    clave = f"pp_{consulta}_{limite}"
    d = _cache_get(clave, 6 * 3600)
    if d is None:
        d = _get(f"https://api.poly.pizza/v1/search/{requests.utils.quote(consulta)}", {"limit": min(32, limite * 2)},
                 headers={"X-Auth-Token": k})
        _cache_set(clave, d)
    out = []
    for m in d.get("results") or []:
        lic = str(m.get("Licence") or m.get("License") or "")
        if solo_cc0 and "0" not in lic:
            continue
        cr = m.get("Creator") or {}
        out.append({"fuente": "polypizza", "id": m.get("ID"), "nombre": m.get("Title"), "tipo": "modelo",
                    "licencia": "CC0" if "0" in lic else "CC-BY 3.0", "autor": cr.get("Username", ""),
                    "url": f"https://poly.pizza/m/{m.get('ID')}", "miniatura": m.get("Thumbnail"), "glb": m.get("Download"),
                    "caras": m.get("Tri Count") or m.get("TriCount"), "animado": bool(m.get("Animated")),
                    "relevancia": max(0.4, _puntaje(consulta, [m.get("Title"), " ".join(m.get("Tags") or [])])), "estilo": "lowpoly"})
    return out[:limite]


# ───────────── Tu carpeta 3D ─────────────
def _local(consulta, tipo, limite, rol=None, tema=None, genero=None, solo_cc0=False):
    if tipo != "modelo":
        return []
    from . import biblioteca3d as B
    out = []
    for m in B.buscar(consulta, limite=limite * 2, rol=rol, tema=tema, genero=genero):
        if solo_cc0 and re.search(r"(?i)cc[- ]?by", m.get("licencia") or ""):
            continue
        out.append(B.item_activo(m))
    return out[:limite]


BUSCADORES = {"local": _local, "polyhaven": _polyhaven, "ambientcg": _ambientcg, "sketchfab": _sketchfab, "polypizza": _polypizza}
MAX_CARAS = {"basico": 15000, "medio": 60000, "alto": 250000, "ultra": 600000}


def buscar(consulta, tipo="modelo", fuentes=None, estilo=None, nivel=None, limite=12, solo_cc0=False, rol=None, tema=None, genero=None):
    """Busca en tu carpeta 3D y en varias galerías a la vez. Devuelve {"resultados": [...], "errores": {...}, "consulta_en": str}.
    rol/tema/genero ayudan a elegir de tu carpeta lo que encaja con el juego (ej. rol «enemigo» en un juego de zombies)."""
    q = a_ingles(consulta)
    if estilo == "voxel" and tipo == "modelo" and "voxel" not in q:
        q = "voxel " + q
    elif estilo == "lowpoly" and tipo == "modelo" and "low" not in q:
        q = "low poly " + q
    fuentes = [f for f in (fuentes or list(BUSCADORES)) if f in BUSCADORES and tipo in FUENTES[f]["tipos"]]
    max_caras = MAX_CARAS.get(nivel or "", None)
    res, errores = [], {}

    def uno(f):
        try:
            if f == "local":
                return f, _local(consulta, tipo, limite, rol, tema, genero, solo_cc0)
            if f == "sketchfab":
                return f, _sketchfab(q, tipo, limite, solo_cc0, max_caras)
            if f == "polypizza":
                return f, _polypizza(re.sub(r"^(low poly|voxel)\s+", "", q), tipo, limite, solo_cc0)
            return f, BUSCADORES[f](re.sub(r"^(low poly|voxel)\s+", "", q) if f in ("polyhaven", "ambientcg") else q, tipo, limite)
        except requests.HTTPError as e:
            return f, f"respondió {e.response.status_code if e.response is not None else '?'}"
        except requests.RequestException as e:
            return f, f"sin conexión ({type(e).__name__})"
        except Exception as e:
            return f, f"{type(e).__name__}: {e}"[:160]
    with ThreadPoolExecutor(max_workers=5) as ex:
        for f, r in ex.map(uno, fuentes):
            if isinstance(r, str):
                errores[f] = r
            else:
                res += r
    for r in res:  # preferencias: estilo del juego y polígonos que aguante la tarjeta
        bonus = 0.0
        if estilo and r.get("estilo") in (estilo, "todos"):
            bonus += 0.15
        if estilo == "realista" and r["fuente"] == "polyhaven":
            bonus += 0.1
        if estilo in ("lowpoly", "voxel") and r["fuente"] == "polypizza":
            bonus += 0.1
        if max_caras and r.get("caras") and r["caras"] > max_caras:
            bonus -= 0.5
        if r.get("licencia") == "CC0":
            bonus += 0.05
        if r["fuente"] == "local":  # lo que ya tienes en tu carpeta va primero (no hay que descargar nada)
            bonus += 0.4
        r["puntaje"] = round(r.get("relevancia", 0.5) + bonus, 3)
    res.sort(key=lambda r: -r["puntaje"])
    return {"resultados": res[: max(limite, 4) * 2], "errores": errores, "consulta_en": q,
            "sin_clave": [f for f in fuentes if FUENTES[f].get("clave") and not _clave(f)]}


def paquetes(estilo=None, tema=None, genero=None):
    out = []
    for p in PAQUETES:
        s = (1 if estilo and p["estilo"] == estilo else 0) + (1 if tema and tema in p["temas"] else 0) + \
            (1 if genero and genero in p["temas"] else 0)
        out.append(dict(p, puntaje=s))
    return sorted(out, key=lambda p: -p["puntaje"])[:6]


# ───────────── Descargas ─────────────
def _bajar(url, dest, headers=None, max_mb=150):
    h = dict(UA)
    h.update(headers or {})
    with requests.get(url, headers=h, stream=True, timeout=120) as r:
        r.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        n = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                n += len(chunk)
                if n > max_mb * 1048576:
                    raise RuntimeError(f"el archivo pasa de {max_mb} MB (demasiado pesado para un juego fluido)")
                f.write(chunk)
    return dest


def gltf_a_glb(gltf_path, glb_path):
    """Empaqueta un .gltf con sus .bin y texturas en UN solo .glb (así funciona también sin servidor)."""
    gltf_path = Path(gltf_path)
    base = gltf_path.parent
    g = json.loads(gltf_path.read_text(encoding="utf-8"))
    blob = bytearray()
    offsets = []

    def pad4():
        while len(blob) % 4:
            blob.append(0)
    for b in g.get("buffers") or []:
        pad4()
        offsets.append(len(blob))
        uri = b.get("uri", "")
        if uri.startswith("data:"):
            blob.extend(base64.b64decode(uri.split(",", 1)[1]))
        else:
            blob.extend((base / requests.utils.unquote(uri)).read_bytes())
    for bv in g.get("bufferViews") or []:
        bv["byteOffset"] = bv.get("byteOffset", 0) + offsets[bv.get("buffer", 0)]
        bv["buffer"] = 0
    g.setdefault("bufferViews", [])
    for img in g.get("images") or []:
        uri = img.get("uri")
        if not uri:
            continue
        if uri.startswith("data:"):
            mime = uri[5:].split(";")[0]
            data = base64.b64decode(uri.split(",", 1)[1])
        else:
            p = base / requests.utils.unquote(uri)
            data = p.read_bytes()
            mime = "image/png" if p.suffix.lower() == ".png" else "image/webp" if p.suffix.lower() == ".webp" else "image/jpeg"
        pad4()
        g["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        img.pop("uri", None)
        img["bufferView"] = len(g["bufferViews"]) - 1
        img["mimeType"] = mime
    pad4()
    g["buffers"] = [{"byteLength": len(blob)}]
    js = json.dumps(g, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(glb_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(js), b"JSON"))
        f.write(js)
        f.write(struct.pack("<I4s", len(blob), b"BIN\x00"))
        f.write(blob)
    return Path(glb_path)


def _slug(t):
    return re.sub(r"[^\w\-]+", "_", _norm(t or "activo")).strip("_")[:40] or "activo"


def descargar(item, proyecto_dir, rol=None, resolucion="1k"):
    """Descarga un resultado de buscar() al proyecto. Devuelve la entrada del manifiesto."""
    proyecto_dir = Path(proyecto_dir)
    fuente, aid, tipo = item.get("fuente"), item.get("id"), item.get("tipo", "modelo")
    nombre = _slug(rol or item.get("nombre") or aid)
    ent = {"id": aid, "fuente": fuente, "nombre": item.get("nombre") or aid, "tipo": tipo, "rol": rol or "",
           "licencia": item.get("licencia", "CC0"), "autor": item.get("autor", ""), "url": item.get("url", ""),
           "fecha": time.strftime("%Y-%m-%d")}
    if tipo == "modelo":
        dest = proyecto_dir / "assets" / "modelos" / f"{nombre}.glb"
        if fuente == "local":
            from . import biblioteca3d as B
            src = B.ruta_de(aid)
            m = B.por_id(aid) or {}
            ent.update(licencia=item.get("licencia") or m.get("licencia") or "ver el paquete",
                       autor=item.get("autor") or m.get("autor") or "", url=item.get("url") or m.get("url") or "",
                       paquete=m.get("paquete") or item.get("paquete") or "", nombre=m.get("nombre") or ent["nombre"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            if src.suffix.lower() == ".gltf":
                gltf_a_glb(src, dest)
            else:
                shutil.copyfile(src, dest)
        elif fuente == "polyhaven":
            files = _get(f"https://api.polyhaven.com/files/{aid}")
            gl = ((files.get("gltf") or {}).get(resolucion) or next(iter((files.get("gltf") or {}).values()), {})).get("gltf")
            if not gl:
                raise RuntimeError("ese modelo de Poly Haven no tiene versión glTF")
            with tempfile.TemporaryDirectory() as td:
                td = Path(td)
                main = _bajar(gl["url"], td / Path(gl["url"]).name)
                for rel, f in (gl.get("include") or {}).items():
                    _bajar(f["url"], td / rel)
                dest.parent.mkdir(parents=True, exist_ok=True)
                gltf_a_glb(main, dest)
        elif fuente == "polypizza":
            _bajar(item.get("glb") or "", dest)
        elif fuente == "sketchfab":
            tok = _clave("sketchfab")
            if not tok:
                raise RuntimeError("para descargar de Sketchfab pega tu API token gratuito en ⚙ Ajustes → Juegos "
                                   "(sketchfab.com → Settings → Password & API)")
            d = requests.get(f"https://api.sketchfab.com/v3/models/{aid}/download", headers={"Authorization": f"Token {tok}", **UA},
                             timeout=30)
            if d.status_code in (401, 403):
                raise RuntimeError("Sketchfab rechazó el token (revísalo en ⚙ Ajustes → Juegos)")
            d.raise_for_status()
            d = d.json()
            if (d.get("glb") or {}).get("url"):
                _bajar(d["glb"]["url"], dest)
            elif (d.get("gltf") or {}).get("url"):
                with tempfile.TemporaryDirectory() as td:
                    z = _bajar(d["gltf"]["url"], Path(td) / "m.zip")
                    with zipfile.ZipFile(z) as zf:
                        zf.extractall(Path(td) / "x")
                    g = next(iter((Path(td) / "x").rglob("*.gltf")), None)
                    if not g:
                        raise RuntimeError("el paquete de Sketchfab no trae .gltf")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    gltf_a_glb(g, dest)
            else:
                raise RuntimeError("Sketchfab no ofrece descarga glTF para ese modelo")
        else:
            raise RuntimeError(f"no sé descargar modelos de {fuente}")
        if dest.read_bytes()[:4] != b"glTF":
            raise RuntimeError("lo descargado no es un modelo .glb válido")
        ent.update(archivo=dest.relative_to(proyecto_dir).as_posix(), bytes=dest.stat().st_size)
    elif tipo == "textura":
        carpeta = proyecto_dir / "assets" / "texturas" / nombre
        carpeta.mkdir(parents=True, exist_ok=True)
        mapas = {}
        if fuente == "polyhaven":
            files = _get(f"https://api.polyhaven.com/files/{aid}")
            for clave, mapa in (("Diffuse", "color"), ("nor_gl", "normal"), ("Rough", "rugosidad"), ("AO", "oclusion")):
                f = ((files.get(clave) or {}).get(resolucion) or {}).get("jpg") or ((files.get(clave) or {}).get(resolucion) or {}).get("png")
                if f and f.get("url"):
                    ext = Path(f["url"]).suffix or ".jpg"
                    mapas[mapa] = _bajar(f["url"], carpeta / f"{mapa}{ext}").relative_to(proyecto_dir).as_posix()
        elif fuente == "ambientcg":
            arch = item.get("archivos") or {}
            url = arch.get("1K-JPG") or arch.get("1K-PNG") or next(iter(arch.values()), None)
            if not url:
                raise RuntimeError("esa textura no tiene descarga de 1K")
            with tempfile.TemporaryDirectory() as td:
                z = _bajar(url, Path(td) / "t.zip")
                with zipfile.ZipFile(z) as zf:
                    for n in zf.namelist():
                        low = n.lower()
                        mapa = ("color" if "_color" in low else "normal" if "_normalgl" in low else "rugosidad" if "_roughness" in low
                                else "oclusion" if "_ambientocclusion" in low else None)
                        if mapa and low.endswith((".jpg", ".png")):
                            p = carpeta / (mapa + Path(n).suffix.lower())
                            p.write_bytes(zf.read(n))
                            mapas[mapa] = p.relative_to(proyecto_dir).as_posix()
        if not mapas:
            raise RuntimeError("no se encontraron los mapas de la textura")
        ent.update(mapas=mapas, carpeta=carpeta.relative_to(proyecto_dir).as_posix())
    elif tipo == "hdri":
        if fuente != "polyhaven":
            raise RuntimeError("los cielos HDRI se descargan de Poly Haven")
        files = _get(f"https://api.polyhaven.com/files/{aid}")
        f = ((files.get("tonemapped") or {}).get("url")) if isinstance(files.get("tonemapped"), dict) else None
        dest = proyecto_dir / "assets" / "cielos" / f"{nombre}.jpg"
        if f:
            _bajar(f, dest)
        else:  # vista previa en JPG (liviana, sirve de cielo de fondo en WebGL)
            _bajar(f"https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/{aid}.jpg", dest)
        ent.update(archivo=dest.relative_to(proyecto_dir).as_posix())
    registrar(proyecto_dir, ent)
    return ent


# ───────────── Manifiesto del proyecto (assets/activos.json + activos.js + CREDITOS.md) ─────────────
EMBEBER_MAX = 12 * 1048576  # hasta 12 MB de modelos se incluyen también dentro de un .js para jugar con doble clic


def manifiesto(proyecto_dir):
    f = Path(proyecto_dir) / "assets" / "activos.json"
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return {"lista": []}


def registrar(proyecto_dir, ent):
    with _lock:
        proyecto_dir = Path(proyecto_dir)
        m = manifiesto(proyecto_dir)
        lista = [x for x in m.get("lista") or [] if not (x.get("rol") and x.get("rol") == ent.get("rol") and x.get("tipo") == ent.get("tipo"))
                 and not (x.get("archivo") and x.get("archivo") == ent.get("archivo"))]
        lista.append(ent)
        m["lista"] = lista
        escribir(proyecto_dir, m)


def escribir(proyecto_dir, m):
    proyecto_dir = Path(proyecto_dir)
    (proyecto_dir / "assets").mkdir(parents=True, exist_ok=True)
    (proyecto_dir / "assets" / "activos.json").write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    modelos = {x["rol"] or Path(x["archivo"]).stem: x["archivo"] for x in m["lista"] if x.get("tipo") == "modelo" and x.get("archivo")}
    texturas = {x["rol"] or x["nombre"]: x.get("mapas") for x in m["lista"] if x.get("tipo") == "textura" and x.get("mapas")}
    cielos = [x["archivo"] for x in m["lista"] if x.get("tipo") == "hdri" and x.get("archivo")]
    creditos = [{k: x.get(k) for k in ("nombre", "autor", "licencia", "fuente", "url", "rol")} for x in m["lista"]]
    js = ("/* Generado por Noviq: activos descargados (modelos, texturas, cielos) y sus créditos. No lo edites a mano. */\n"
          f"window.ACTIVOS = {json.dumps({'modelos': modelos, 'texturas': texturas, 'cielos': cielos, 'creditos': creditos}, ensure_ascii=False, indent=1)};\n")
    (proyecto_dir / "assets" / "activos.js").write_text(js, encoding="utf-8")
    # para jugar con doble clic (file://) el navegador no deja leer archivos: los modelos pequeños van también dentro de un .js
    total, emb = 0, {}
    for rol, rel in modelos.items():
        p = proyecto_dir / rel
        if p.exists() and total + p.stat().st_size <= EMBEBER_MAX:
            total += p.stat().st_size
            emb[rel] = base64.b64encode(p.read_bytes()).decode()
    (proyecto_dir / "assets" / "activos_datos.js").write_text(
        "/* Copia de los modelos para abrir el juego con doble clic (sin servidor). Generado por Noviq. */\n"
        f"window.ACTIVOS_DATOS = {json.dumps(emb)};\n", encoding="utf-8")
    lineas = ["# Créditos de los recursos", "", "Recursos gratuitos usados en este juego (descargados por Noviq). Las licencias "
              "CC0 no exigen crédito; las CC-BY sí: este archivo y la pantalla de créditos del juego lo cumplen.", ""]
    for x in m["lista"]:
        fuente_n = FUENTES.get(x.get("fuente"), {}).get("nombre", x.get("fuente"))
        if x.get("fuente") == "local" and x.get("paquete"):
            fuente_n = f"paquete «{x['paquete']}» de tu carpeta 3D"
        elif x.get("fuente") == "noviq":
            fuente_n = "figura 3D creada por Noviq (también está en tu carpeta 3D › Noviq Creados)"
        lineas.append(f"- **{x.get('nombre')}** ({x.get('tipo')}{', rol: ' + x['rol'] if x.get('rol') else ''}) — "
                      f"{x.get('autor') or 'autor desconocido'} · {x.get('licencia')} · {fuente_n}"
                      + (f" · {x['url']}" if x.get("url") else ""))
    if any(x.get("fuente") == "polyhaven" for x in m["lista"]):
        lineas += ["", "Modelos, texturas y cielos de Poly Haven (polyhaven.com), CC0."]
    (proyecto_dir / "CREDITOS.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")


def probar():
    """¿Responde cada galería? (para ⚙ Ajustes → Juegos)"""
    out = {}
    for f, fn in BUSCADORES.items():
        t0 = time.time()
        if f == "local":
            try:
                from . import biblioteca3d as B
                d = B.indice(forzar=True)
                out[f] = {"ok": bool(d["modelos"]), "n": len(d["modelos"]), "ms": int((time.time() - t0) * 1000), "descarga": True,
                          **({} if d["modelos"] else {"error": f"no hay modelos .glb/.gltf en {d['carpeta']}"})}
            except Exception as e:
                out[f] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}"}
            continue
        try:
            if FUENTES[f].get("clave") and not _clave(f) and f == "polypizza":
                out[f] = {"ok": False, "error": "falta la clave gratuita", "clave_url": FUENTES[f].get("clave_url")}
                continue
            r = fn("tree" if f != "ambientcg" else "grass", "modelo" if f in ("polyhaven", "sketchfab", "polypizza") else "textura", 3)
            out[f] = {"ok": bool(r), "n": len(r), "ms": int((time.time() - t0) * 1000),
                      "descarga": bool(_clave(f)) if FUENTES[f].get("clave") else True}
        except Exception as e:
            out[f] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}", "ms": int((time.time() - t0) * 1000)}
    return out
