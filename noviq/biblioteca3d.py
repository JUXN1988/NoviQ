# -*- coding: utf-8 -*-
"""📁 Biblioteca 3D local: la CARPETA ESTÁNDAR donde guardas tus modelos 3D para los juegos.

Por defecto es <carpeta de Noviq>/docs/3D (se puede cambiar en el 🎮 Estudio → «Tus modelos 3D» o en ⚙ Ajustes → Juegos).
Pon ahí paquetes completos (Kenney, Quaternius, KayKit, Poly Pizza…), cada uno en su subcarpeta. Lo que hace Noviq solo:
- Descomprime los .zip que traigan modelos .glb/.gltf (una sola vez, a una carpeta con el mismo nombre).
- Lee cada modelo SIN cargarlo entero (polígonos, animaciones, esqueleto, extensiones que el motor no soporta).
- Lo clasifica según su nombre: personaje, animal, vehículo, arma, coleccionable, árbol, roca, casa, edificio, farola,
  señal, caja, barril, valla, banco, lápida, calabaza… (los mismos «roles» que usa el motor del juego).
- Deduce las temáticas de cada paquete (ciudad, terror, zombies, disparos, granja…) por los nombres de sus modelos.
- sugerir(diseño): elige, para el juego que se quiere hacer, el mejor modelo de la carpeta para cada rol (jugador,
  enemigos, objetos, decoración y arma) y agrega decoración extra que encaje con la temática (autos en la ciudad,
  lápidas y calabazas en el terror, barriles y barreras en los de disparos…), con variantes para que no se repitan.

Formatos: el motor usa .glb/.gltf. Los .fbx/.obj/.blend se ignoran (si un paquete solo trae esos, expórtalos a .glb con
Blender: Archivo → Exportar → glTF 2.0).
Opcional: un _info.json en la carpeta de cada paquete con {"autor", "licencia", "fuente", "url", "temas": [...]}."""
import hashlib
import json
import os
import re
import shutil
import struct
import threading
import time
import unicodedata
import zipfile
from pathlib import Path

from .config import BASE_DIR, CONFIG, DATA_DIR, FROZEN

VERSION = 7
EXT_MODELO = {".glb", ".gltf"}
EXT_OTROS = {".fbx", ".obj", ".blend", ".dae", ".3ds", ".stl", ".max", ".ma", ".mb", ".usdz", ".ply", ".x3d"}
NO_SOPORTADAS = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"}
INDICE = DATA_DIR / "biblioteca3d.json"
MINIS = DATA_DIR / "biblioteca3d_mini"
MAX_JSON = 64 * 1048576
MAX_ARCHIVOS = 60000
MAX_MODELOS = 6000
_lock = threading.RLock()
_mem = {"t": 0.0, "carpeta": None, "datos": None, "zips": {}}

LEEME = """📁 Carpeta estándar de modelos 3D de Noviq
============================================

Todo lo que pongas aquí lo usa el 🎮 Estudio de juegos (y la IA del chat) según el juego que quieras hacer.

• Formatos: .glb o .gltf (los que usa el motor). Los .zip con .glb/.gltf se descomprimen solos.
  Los .fbx / .obj / .blend se ignoran: si un paquete solo trae esos, expórtalo a .glb con Blender (Archivo → Exportar → glTF 2.0).
• Organiza por paquete: una subcarpeta por paquete (ej. «Toon Shooter Game Kit», «Halloween Bits», «City Pack»).
• Los nombres de archivo importan: «Tree.glb», «Character Soldier.glb», «Gravestone.glb»… así Noviq sabe qué es cada modelo
  (árbol, personaje, lápida…) y en qué juegos encaja.
• Opcional: un archivo _info.json dentro de cada paquete con el autor y la licencia, por ejemplo:
  {"autor": "Quaternius", "licencia": "CC0", "fuente": "poly.pizza", "url": "https://poly.pizza", "temas": ["zombies"]}
• Después de agregar modelos pulsa «🔄 Volver a escanear» en el Estudio (o simplemente vuelve a abrirlo).

Galerías gratuitas recomendadas (CC0): kenney.nl · quaternius.com · kaylousberg.itch.io · poly.pizza
"""

# ───────────── Clasificación por nombre ─────────────
# rol → frases (inglés y español) que lo identifican. Las frases de varias palabras se prueban primero y «consumen» sus
# palabras (así «Gas Tank» es un barril y no un tanque, y «Traffic Light» es una señal y no una farola).
ROLES = {
    "personaje": ["character", "adventurer", "man", "woman", "person", "people", "soldier", "hazmat", "enemy", "zombie", "zombi",
                  "skeleton", "knight", "wizard", "witch", "girl", "boy", "hero", "heroine", "ninja", "pirate", "astronaut",
                  "farmer", "villager", "npc", "player", "survivor", "human", "robot", "alien", "monster", "ghost", "orc",
                  "goblin", "viking", "cowboy", "policeman", "worker", "businessman", "chef", "doctor", "king", "queen",
                  "princess", "mage", "warrior", "archer", "casual", "suit", "punk", "swat", "mannequin", "personaje",
                  "hombre", "mujer", "soldado", "caballero", "mago", "bruja", "esqueleto", "fantasma", "guerrero", "vampire",
                  "demon", "mummy", "yeti", "bandit"],
    "animal": ["dog", "cat", "horse", "cow", "pig", "sheep", "chicken", "wolf", "bear", "fox", "deer", "bird", "eagle", "condor",
               "llama", "alpaca", "fish", "shark", "dinosaur", "dino", "trex", "raptor", "spider", "scorpion", "crab", "snake",
               "frog", "rabbit", "duck", "penguin", "monkey", "bat", "slime", "perro", "gato", "caballo", "vaca", "lobo", "oso",
               "zorro", "dinosaurio", "arana", "escorpion", "cangrejo", "serpiente", "murcielago"],
    "vehiculo": ["police car", "sports car", "pickup truck", "broken car", "race car", "car", "suv", "van", "truck", "bus",
                 "pickup", "taxi", "jeep", "motorcycle", "motorbike", "bicycle", "bike", "tractor", "kart", "tank", "ambulance",
                 "firetruck", "auto", "carro", "coche", "camion", "moto", "bicicleta", "tanque", "spaceship", "boat", "ship"],
    "arma": ["rocket launcher", "grenade launcher", "short cannon", "ak47", "pistol", "revolver", "shotgun", "sniper", "smg",
             "rifle", "uzi", "gun", "cannon", "knife", "sword", "axe", "bow", "spear", "hammer", "mace", "dagger", "pistola",
             "espada", "hacha", "arco", "cuchillo", "escopeta"],
    "coleccionable": ["first aid", "gas can", "fire grenade", "health", "medkit", "key", "coin", "coins", "gem", "gems", "diamond",
                      "star", "heart", "potion", "treasure", "chest", "ammo", "egg", "apple", "banana", "fruit", "grenade",
                      "battery", "trophy", "llave", "moneda", "gema", "estrella", "corazon", "pocion", "cofre", "huevo", "fruta",
                      "botiquin", "municion"],
    "pino": ["autumn pine", "pine tree", "pine", "fir", "spruce", "pino", "abeto"],
    "palmera": ["palm tree", "palm", "palmera"],
    "arbol": ["small dead tree", "tree dead large deco", "dead tree", "tree", "oak", "birch", "willow", "arbol"],
    "arbusto": ["planter & bushes", "planter", "flower pot", "bush", "bushes", "shrub", "hedge", "plant", "flower", "flowers",
                "fern", "grass", "arbusto", "planta", "flor", "maceta"],
    "roca": ["rock", "rocks", "stone", "stones", "boulder", "cliff", "roca", "rocas", "piedra"],
    "hongo": ["mushroom", "mushrooms", "hongo", "seta"],
    "cactus": ["cactus"],
    "cristal": ["crystal", "crystals", "cristal"],
    "casa": ["house", "hut", "cabin", "cottage", "barn", "home", "crypt", "mausoleum", "shrine", "greenhouse", "tent", "casa",
             "cabana", "granero", "cripta"],
    "edificio": ["big building", "building red corner", "building", "skyscraper", "apartment", "office", "shop", "store", "edificio"],
    "torre": ["tower", "castle", "lighthouse", "torre", "castillo"],
    "farola": ["post lantern", "street light", "street lamp", "lamp post", "streetlight", "lamppost", "farola"],
    "senal": ["bus stop sign", "stop sign", "traffic light", "bus stop", "billboard", "sign", "signpost", "semaforo", "letrero"],
    "urbano": ["fire hydrant", "power box", "trash can", "trash bag", "trah bag", "mailbox", "hydrant", "atm", "cajero",
               "phone booth", "vending machine", "buzon"],
    "cono": ["traffic cone", "cone", "cono"],
    "caja": ["cardboard boxes", "pallet broken", "crate", "crates", "box", "boxes", "pallet", "caja", "cajas"],
    "barril": ["exploding barrel spil", "exploding barrel", "water tank floor", "water tank", "gas tank", "barrel", "barrels",
               "tires", "tire", "barril", "llantas"],
    "contenedor": ["shipping container structure", "shipping container", "container small", "trash container open", "trash container",
                   "dumpster", "container", "contenedor"],
    "escombros": ["debris pile", "debris papers", "sack trench small", "sack trench", "wood planks", "debris", "rubble", "sandbags",
                  "planks", "pipes", "escombros"],
    "valla": ["damaged iron fence", "broken fence pillar", "iron fence", "metal fence", "fence broken", "fence gate", "fence pillar",
              "fence long", "fence piece", "fence end", "barrier fixed", "barrier large", "barrier single", "barrier trash",
              "brick wall", "arch gate", "fence", "barrier", "wall", "gate", "arch", "pillar", "post", "valla", "muro", "reja",
              "barrera"],
    "banco": ["sofa small", "bench", "sofa", "chair", "armchair", "banco", "silla"],
    "lapida": ["damaged grave", "grave marker", "gravemarker", "gravestone", "tombstone", "grave", "lapida", "tumba"],
    "calabaza": ["pumpkin orange jacko", "small pumpkin", "yellow pumpkin", "jackolantern", "jack o lantern", "pumpkin", "calabaza"],
    "ataud": ["coffin", "ataud"],
    "hueso": ["post with skull", "ribcage", "skull", "bones", "bone", "calavera", "hueso"],
    "vela": ["hanging lantern", "plaque candles", "candle melted", "skull candle", "candles", "candle", "lantern", "torch", "vela",
             "linterna", "antorcha"],
    "trampa": ["bear trap", "landmine", "spikes", "trap", "mina", "trampa"],
    "pared": ["rock band poster", "yellow post it", "post it", "poster", "fire exit", "roof exit", "washing line", "air conditioner",
              "graffiti", "window", "door"],
    "suelo": ["cobblestone tile", "dirt floor tile", "floor dirt small", "floor tile", "floor hole", "manhole cover", "road bits",
              "tile", "path", "floor", "road", "manhole", "plaque"],
}
# roles secundarios (un modelo también sirve para esto)
SECUNDARIOS = {"calabaza": ["coleccionable"], "hueso": ["coleccionable"], "cristal": ["coleccionable"], "coleccionable": [],
               "arma": ["coleccionable"], "vela": ["coleccionable"], "trampa": ["escombros"]}
# decoración que va bien en casi cualquier juego (si no, solo se usa cuando la temática del paquete encaja)
GENERICOS = {"arbol", "pino", "palmera", "arbusto", "roca", "hongo", "cactus", "cristal", "caja", "barril", "valla", "banco", "farola"}
# palabras de objetos modernos: aunque sean «genéricos» (barril, caja, farola…) solo van en juegos de su temática
MODERNO = {"exploding", "gas", "tank", "tires", "tire", "cardboard", "pallet", "sofa", "barrier", "metal", "street", "traffic", "trash",
           "container", "shipping", "water", "planter", "pot", "concrete", "plastic"}
# roles que el motor 3D usa como decoración (las demás cosas se usan como personajes, objetos o armas)
DECORACION = {"arbol", "pino", "palmera", "arbusto", "roca", "hongo", "cactus", "cristal", "casa", "edificio", "torre", "farola",
              "senal", "urbano", "cono", "caja", "barril", "contenedor", "escombros", "valla", "banco", "lapida", "calabaza", "ataud",
              "hueso", "vela", "vehiculo"}
# altura (metros) con la que el motor dibuja cada rol de decoración; algunas palabras la ajustan
ALTURA = {"arbol": 6, "pino": 7, "palmera": 7, "arbusto": 1.2, "roca": 1.4, "hongo": 1.4, "cactus": 2.8, "cristal": 2.2, "casa": 5,
          "edificio": 15, "torre": 13, "farola": 4.2, "senal": 2.8, "urbano": 1.1, "cono": 0.75, "caja": 1.0, "barril": 1.1,
          "contenedor": 2.4, "escombros": 0.8, "valla": 1.3, "banco": 1.0, "lapida": 1.3, "calabaza": 0.7, "ataud": 0.8,
          "hueso": 0.6, "vela": 0.6, "vehiculo": 1.7, "personaje": 1.8, "animal": 1.2, "coleccionable": 1.1, "arma": 0.7,
          "trampa": 0.4, "suelo": 0.2, "pared": 1.0, "otro": 1.5}
ALTURA_PAL = {"bus": 3.3, "truck": 2.8, "pickup": 2.0, "bicycle": 1.1, "bike": 1.1, "motorcycle": 1.3, "tank": 2.6, "van": 2.2,
              "big": 22, "billboard": 5.5, "traffic light": 4.6, "stop sign": 2.6, "bus stop": 2.8, "post lantern": 3.2,
              "dumpster": 1.5, "shipping container": 2.6, "trash container": 1.4, "water tank": 3.2, "gas tank": 1.6, "tires": 0.8,
              "crypt": 4.5, "shrine": 2.2, "greenhouse": 3.2, "small dead tree": 2.6, "dead tree": 5.5, "tree dead large": 6.5,
              "brick wall": 2.2, "arch gate": 3.6, "arch": 3.4, "pillar": 2.2, "iron fence": 1.7, "barrier large": 1.2,
              "small pumpkin": 0.45, "jackolantern": 0.7, "sofa": 0.9, "planter": 1.0, "flower pot": 0.7, "container small": 2.2,
              "sack trench": 1.0, "wood planks": 0.5, "pipes": 0.9, "debris papers": 0.15, "ribcage": 0.7, "post with skull": 1.6,
              "hanging lantern": 0.5, "shipping container structure": 3.0}

# temáticas del Estudio (juegos.TEMAS) según palabras del nombre del modelo o del paquete
TEMA_PAL = {
    "terror": ["halloween", "grave", "gravestone", "gravemarker", "tombstone", "crypt", "coffin", "skull", "pumpkin", "jackolantern",
               "ghost", "candle", "candles", "bone", "ribcage", "shrine", "dead", "spooky", "haunted", "witch", "horror", "cemetery",
               "graveyard", "mausoleum", "vampire", "mummy"],
    "zombies": ["zombie", "zombi", "hazmat", "apocalypse", "survivor", "survival", "barrier", "sack", "trench", "debris", "broken",
                "landmine", "trap", "shooter"],
    "disparos": ["shooter", "gun", "guns", "pistol", "rifle", "ak47", "sniper", "smg", "shotgun", "revolver", "grenade", "launcher",
                 "cannon", "tank", "soldier", "military", "army", "ammo", "weapon", "weapons", "war"],
    "ciudad": ["city", "street", "car", "bus", "taxi", "building", "traffic", "police", "road", "mailbox", "hydrant", "manhole",
               "billboard", "suv", "van", "pickup", "motorcycle", "bicycle", "urban", "town", "dumpster", "stop", "sidewalk"],
    "futurista": ["robot", "scifi", "sci", "cyber", "cyberpunk", "neon", "future", "futuristic", "mech", "drone", "laser"],
    "espacio": ["space", "astronaut", "alien", "planet", "spaceship", "asteroid", "satellite", "ufo"],
    "medieval": ["castle", "knight", "medieval", "sword", "shield", "tower", "king", "dungeon", "viking", "catapult"],
    "fantasia": ["fantasy", "magic", "wizard", "potion", "dragon", "fairy", "elf", "mushroom", "crystal", "slime"],
    "granja": ["farm", "barn", "tractor", "hay", "cow", "chicken", "pig", "sheep", "greenhouse", "crop", "windmill", "farmer"],
    "bosque": ["forest", "nature", "tree", "pine", "bush", "log", "fern", "woods"],
    "oceano": ["pirate", "ship", "boat", "palm", "chest", "treasure", "anchor", "island", "beach", "shark", "crab"],
    "desierto": ["cactus", "desert", "pyramid", "camel", "sand"],
    "nieve": ["snow", "ice", "winter", "igloo", "penguin", "snowman", "christmas"],
    "dinosaurios": ["dinosaur", "dino", "trex", "raptor", "prehistoric", "jurassic"],
    "deportes": ["ball", "soccer", "football", "basketball", "goal", "stadium", "sport", "sports", "tennis"],
    "andes": ["llama", "alpaca", "condor", "mountain", "andes"],
}
TEMA_AFIN = {"militar": {"disparos": 1.0, "zombies": 0.7}, "zombies": {"disparos": 0.8, "ciudad": 0.6, "terror": 0.6}, "disparos": {"zombies": 0.8, "ciudad": 0.5, "futurista": 0.4},
             "terror": {"zombies": 0.5}, "ciudad": {"deportes": 0.6, "futurista": 0.4, "zombies": 0.4},
             "futurista": {"ciudad": 0.5, "disparos": 0.5, "espacio": 0.4}, "deportes": {"ciudad": 0.8}, "granja": {"bosque": 0.4},
             "bosque": {"granja": 0.3, "andes": 0.4, "fantasia": 0.3}, "andes": {"bosque": 0.5}, "fantasia": {"bosque": 0.4, "medieval": 0.4},
             "medieval": {"fantasia": 0.4}, "espacio": {"futurista": 0.5}, "supervivencia": {"zombies": 1.0}}
# palabras que marcan a un personaje como enemigo
ENEMIGO_PAL = {"enemy", "zombie", "zombi", "skeleton", "monster", "ghost", "orc", "goblin", "alien", "demon", "vampire", "mummy",
               "bandit", "robot", "yeti", "villain", "enemigo", "esqueleto", "fantasma", "slime", "witch", "bruja"}
# otras formas de buscar cada palabra (inglés ↔ español y sinónimos)
SINONIMOS = {
    "health": ["medkit", "botiquin", "vida", "salud", "firstaid", "heal"], "key": ["llave", "llaves"], "coin": ["moneda", "monedas", "gold", "oro"],
    "gem": ["gema", "gemas", "jewel", "joya"], "diamond": ["diamante", "gem", "gema"], "crystal": ["cristal", "gem", "gema"],
    "star": ["estrella"], "heart": ["corazon", "vida"], "egg": ["huevo"], "apple": ["manzana", "fruta", "fruit"], "chest": ["cofre", "treasure", "tesoro"],
    "tree": ["arbol", "arboles"], "pine": ["pino", "tree", "arbol"], "palm": ["palmera"], "rock": ["roca", "piedra", "stone"],
    "rocks": ["rock", "roca", "rocas", "piedras"], "bush": ["arbusto"], "grave": ["tumba", "lapida", "tombstone", "gravestone"],
    "gravestone": ["lapida", "tombstone", "grave", "tumba"], "coffin": ["ataud"], "pumpkin": ["calabaza"], "skull": ["calavera", "craneo"],
    "bone": ["hueso"], "candle": ["vela"], "lantern": ["linterna", "farol", "lamp", "lampara"], "car": ["auto", "carro", "coche", "vehicle", "vehiculo"],
    "police": ["policia"], "bus": ["autobus", "bus"], "truck": ["camion"], "soldier": ["soldado", "survivor", "army", "military", "militar"],
    "enemy": ["enemigo", "villain"], "adventurer": ["aventurero", "explorer", "explorador", "hiker", "hero", "heroe"],
    "man": ["hombre", "person", "persona", "civilian"], "woman": ["mujer", "person", "persona"], "character": ["personaje"],
    "zombie": ["zombi", "zombis", "zombies"], "building": ["edificio", "edificios"], "house": ["casa"], "crypt": ["cripta", "mausoleum", "tomb", "haunted"],
    "bench": ["banco"], "fence": ["valla", "cerca", "reja"], "barrel": ["barril"], "crate": ["caja", "box"], "box": ["caja", "crate"],
    "pistol": ["pistola", "gun", "arma"], "revolver": ["pistola", "gun", "arma"], "rifle": ["gun", "arma"], "ak47": ["rifle", "gun", "arma"],
    "smg": ["gun", "arma", "metralleta"], "shotgun": ["escopeta", "gun", "arma"], "sniper": ["francotirador", "rifle", "gun"],
    "knife": ["cuchillo", "arma"], "sword": ["espada", "arma"], "tank": ["tanque"], "hazmat": ["survivor", "cientifico", "scientist"],
    "grenade": ["granada"], "street": ["calle"], "light": ["luz", "lamp"], "sign": ["senal", "letrero"], "cone": ["cono"],
    "dumpster": ["contenedor", "basura", "trash"], "container": ["contenedor"], "debris": ["escombros"], "tires": ["llantas", "neumaticos"],
    "motorcycle": ["moto"], "bicycle": ["bicicleta", "bici"], "sports": ["deportivo", "racing", "race", "carrera"], "shrine": ["altar", "templo"],
    "ribcage": ["costillas", "hueso", "bone"], "wall": ["muro", "pared"], "gate": ["puerta", "reja"], "dead": ["muerto", "seco", "spooky"],
}
STOP = {"de", "del", "la", "el", "los", "las", "un", "una", "con", "y", "en", "para", "the", "a", "of", "and", "with", "low", "poly",
        "lowpoly", "voxel", "model", "modelo", "3d", "glb", "gltf", "stylized"}


def _norm(t):
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _palabras(t):
    t = re.sub(r"([a-z])([A-Z])", r"\1 \2", t or "")
    t = t.replace("&", " & ")
    return re.findall(r"[a-z0-9&]+", _norm(t))


_HASH = re.compile(r"^(.*?)[-_ ]([A-Za-z0-9]{10})$")


def _base_y_variante(stem):
    """«Autumn pine-8wkRed6jU9» → («Autumn pine», «8wkRed6jU9»): Poly Pizza agrega un código a los modelos repetidos."""
    m = _HASH.match(stem)
    if m and re.search(r"[A-Z]", m.group(2)) and re.search(r"[a-z0-9]", m.group(2)) and m.group(1).strip():
        return m.group(1).strip(), m.group(2)
    return stem.strip(), ""


def limpiar_paquete(n):
    n = re.sub(r"(?i)\.undefined", "", n or "")
    n = re.sub(r"(?i)[-_ .]+(glb|gltf|zip|fbx|obj|models?)$", "", n)
    return n.strip(" -_.") or "Mis modelos"


def _roles_de(pal):
    """Roles del modelo según sus palabras (el primero es el principal)."""
    txt = " " + " ".join(pal) + " "
    frases = sorted(((f, r) for r, fs in ROLES.items() for f in fs), key=lambda x: -len(x[0].split()))
    roles, consumido = [], txt
    for f, r in frases:
        pat = " " + f + " "
        if pat in consumido:
            consumido = consumido.replace(pat, " | ")
            if r not in roles:
                roles.append(r)
    # prioridad: lo que el modelo ES (personaje, vehículo…) antes que lo que lleva (un «Skull Candle» es una vela)
    orden = ["personaje", "animal", "vehiculo", "arma", "pared", "suelo"]
    roles.sort(key=lambda r: (orden.index(r) if r in orden else 9))
    for r in list(roles):
        for s in SECUNDARIOS.get(r, []):
            if s not in roles:
                roles.append(s)
    if len(roles) > 1 and roles[0] == "suelo":
        roles = roles[1:] + ["suelo"]
    return roles or ["otro"]


def _temas_de(pal):
    s = set(pal) | {" ".join(pal)}
    out = []
    for t, ps in TEMA_PAL.items():
        if any(p in s for p in ps):
            out.append(t)
    if "dead" in s and "bosque" in out:  # un árbol seco no es de bosque
        out.remove("bosque")
    return out


def _altura(rol, pal):
    txt = " " + " ".join(pal) + " "
    best = None
    for f, h in sorted(ALTURA_PAL.items(), key=lambda x: -len(x[0])):
        if " " + f + " " in txt:
            best = h
            break
    if rol == "edificio" and best is None:
        return ALTURA["edificio"]
    if best is not None and (rol in ("vehiculo", "senal", "farola", "contenedor", "barril", "casa", "arbol", "valla", "calabaza",
                                     "banco", "arbusto", "escombros", "hueso", "vela", "edificio")):
        return best
    return ALTURA.get(rol, 1.5)


# ───────────── Carpeta ─────────────
def carpeta_defecto():
    if FROZEN:  # programa instalado: la carpeta del programa es temporal, se usa Documentos
        return Path.home() / "Documents" / "Noviq" / "3D"
    return BASE_DIR / "docs" / "3D"


def carpeta(crear=True):
    c = str((CONFIG.get("juegos") or {}).get("carpeta_3d") or "").strip().strip('"').strip("'")
    p = Path(os.path.expandvars(c)).expanduser() if c else carpeta_defecto()
    if crear:
        try:
            p.mkdir(parents=True, exist_ok=True)
            leeme = p / "LEEME.txt"
            if not leeme.exists():
                leeme.write_text(LEEME, encoding="utf-8")
        except OSError:
            pass
    return p


def cambiar_carpeta(ruta):
    """Guarda la carpeta elegida («» = la estándar) y la escanea."""
    from .config import save_config
    ruta = str(ruta or "").strip().strip('"')
    if ruta:
        p = Path(os.path.expandvars(ruta)).expanduser()
        if p.exists() and not p.is_dir():
            raise ValueError("esa ruta es un archivo, no una carpeta")
        p.mkdir(parents=True, exist_ok=True)
        if p.resolve() == carpeta_defecto().resolve():
            ruta = ""
    j = dict(CONFIG.get("juegos") or {})
    j["carpeta_3d"] = ruta
    CONFIG["juegos"] = j
    save_config()
    _mem.update(t=0.0, datos=None)
    return indice(forzar=True)


# ───────────── Lectura de modelos (solo la cabecera JSON: no se carga la geometría) ─────────────
def _leer_gltf(p):
    try:
        if p.suffix.lower() == ".gltf":
            if p.stat().st_size > MAX_JSON:
                return None
            return json.loads(p.read_text(encoding="utf-8", errors="replace"))
        with open(p, "rb") as f:
            cab = f.read(20)
            if len(cab) < 20 or cab[:4] != b"glTF":
                return None
            ln, tipo = struct.unpack("<I4s", cab[12:20])
            if tipo != b"JSON" or ln > MAX_JSON:
                return None
            return json.loads(f.read(ln).decode("utf-8", "replace"))
    except Exception:
        return None


def _analizar(js):
    acc = js.get("accessors") or []
    tris = 0
    for m in js.get("meshes") or []:
        for pr in m.get("primitives") or []:
            modo = pr.get("mode", 4)
            if modo not in (4, 5, 6):
                continue
            try:
                n = acc[pr["indices"]]["count"] if "indices" in pr else acc[pr["attributes"]["POSITION"]]["count"]
            except (KeyError, IndexError, TypeError):
                n = 0
            tris += n // 3 if modo == 4 else max(0, n - 2)
    anims = [str(a.get("name") or f"anim{i + 1}") for i, a in enumerate(js.get("animations") or [])]
    req = set(js.get("extensionsRequired") or [])
    prims = sum(len(m.get("primitives") or []) for m in js.get("meshes") or [])
    return {"caras": tris, "animaciones": anims[:40], "esqueleto": bool(js.get("skins")), "texturas": len(js.get("images") or []),
            "mallas": len(js.get("meshes") or []), "piezas": prims, "no_soportado": sorted(req & NO_SOPORTADAS)}


def _info_paquete(dirp):
    """Autor y licencia del paquete: _info.json, o se deducen de un License.txt (Kenney, Quaternius, KayKit…)."""
    info = {}
    try:
        f = dirp / "_info.json"
        if f.is_file():
            d = json.loads(f.read_text(encoding="utf-8-sig"))
            if isinstance(d, dict):
                info = {k: d[k] for k in ("autor", "licencia", "fuente", "url", "temas", "nota") if d.get(k)}
    except Exception:
        pass
    if not info.get("licencia") or not info.get("autor"):
        try:
            for f in list(dirp.glob("*.txt"))[:6] + list(dirp.glob("*.md"))[:3]:
                if not re.search(r"(?i)licen|readme|leeme|credit", f.name) or f.stat().st_size > 200000:
                    continue
                t = f.read_text(encoding="utf-8", errors="replace")
                tl = t.lower()
                if not info.get("licencia"):
                    if re.search(r"cc0|creative commons zero|public domain|dominio p", tl):
                        info["licencia"] = "CC0"
                    elif re.search(r"cc[- ]by|attribution", tl):
                        info["licencia"] = "CC-BY"
                if not info.get("autor"):
                    for a in ("Kenney", "Quaternius", "Kay Lousberg", "KayKit", "Poly Pizza", "Sketchfab"):
                        if a.lower() in tl:
                            info["autor"] = a
                            break
        except Exception:
            pass
    return info


def _ficha_noviq(p):
    f = p.with_name(p.stem + ".noviq.json")
    try:
        if f.is_file() and f.stat().st_size < 200000:
            d = json.loads(f.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else None
    except Exception:
        pass
    return None


def _descomprimir_zips(raiz, informe):
    """Descomprime (una sola vez) los .zip que traen modelos .glb/.gltf, en una carpeta con el mismo nombre."""
    vistos = _mem["zips"]
    for z in list(raiz.glob("*.zip")) + list(raiz.glob("*/*.zip")):
        try:
            st = z.stat()
            clave = (str(z), st.st_mtime, st.st_size)
            destino = z.with_suffix("")
            if destino.exists():
                continue
            if vistos.get(str(z)) == clave:
                informe["zips_sin_modelos"].append(z.name)
                continue
            with zipfile.ZipFile(z) as zf:
                infos = [i for i in zf.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX")]
                if not any(Path(i.filename).suffix.lower() in EXT_MODELO for i in infos):
                    vistos[str(z)] = clave
                    informe["zips_sin_modelos"].append(z.name)
                    continue
                if sum(i.file_size for i in infos) > 2 * 1024 ** 3:
                    informe["errores"].append(f"{z.name}: pasa de 2 GB descomprimido (descomprímelo a mano)")
                    continue
                base = destino.resolve()
                for i in infos:
                    dst = (destino / i.filename).resolve()
                    if base not in dst.parents:  # nada fuera de la carpeta (zip slip)
                        continue
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(i) as s, open(dst, "wb") as d:
                        shutil.copyfileobj(s, d)
            informe["zips"].append(z.name)
        except (zipfile.BadZipFile, OSError, RuntimeError) as e:
            informe["errores"].append(f"{z.name}: {type(e).__name__}: {str(e)[:120]}")


def _escanear(raiz, viejo=None):
    informe = {"zips": [], "zips_sin_modelos": [], "errores": []}
    _descomprimir_zips(raiz, informe)
    cache = {m["id"]: m for m in ((viejo or {}).get("modelos") or [])}
    modelos, ignorados, infos = [], {}, {}
    con_glb = set()
    otros = []
    vistos = 0
    for dirpath, dirnames, files in os.walk(raiz):
        prof = len(Path(dirpath).relative_to(raiz).parts)
        dirnames[:] = [] if prof >= 6 else sorted(d for d in dirnames if not d.startswith((".", "_")) and d not in ("__MACOSX", "node_modules"))
        vistos += len(files)
        if vistos > MAX_ARCHIVOS or len(modelos) >= MAX_MODELOS:  # por si eligen una carpeta enorme (ej. todo el disco)
            informe["errores"].append(f"la carpeta es muy grande: se leyeron solo los primeros {len(modelos)} modelos")
            break
        for fn in sorted(files):
            p = Path(dirpath) / fn
            ext = p.suffix.lower()
            if ext in EXT_OTROS:
                otros.append(p)
                continue
            if ext not in EXT_MODELO:
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            rel = p.relative_to(raiz)
            rid = rel.as_posix()
            partes = rel.parts
            paq_dir = partes[0] if len(partes) > 1 else ""
            paquete = limpiar_paquete(paq_dir) if paq_dir else "Sueltos"
            base, var = _base_y_variante(p.stem)
            con_glb.add(paquete)
            viejo_m = cache.get(rid)
            if viejo_m and viejo_m.get("bytes") == st.st_size and viejo_m.get("mtime") == int(st.st_mtime) and viejo_m.get("v") == VERSION:
                m = dict(viejo_m)
            else:
                js = _leer_gltf(p)
                if js is None:
                    informe["errores"].append(f"{rid}: no es un glTF/GLB válido")
                    continue
                pal = _palabras(base)
                sub = [w for d in partes[1:-1] for w in _palabras(limpiar_paquete(d))]
                roles = _roles_de(pal)
                if roles == ["otro"] and sub:
                    roles = _roles_de(sub)
                enemigo = bool(set(pal) & ENEMIGO_PAL) or (roles[0] == "animal")
                m = {"id": rid, "h": hashlib.md5(rid.encode("utf-8")).hexdigest()[:16], "nombre": base, "variante": var,
                     "paquete": paquete, "bytes": st.st_size, "mtime": int(st.st_mtime), "v": VERSION,
                     "rol": roles[0], "roles": roles, "enemigo": enemigo, "altura": _altura(roles[0], pal),
                     "palabras": pal, "sub": sub, "temas_propios": _temas_de(pal + sub), **_analizar(js)}
            m["ruta"] = str(p)
            m["paquete"] = paquete
            m["_paq_dir"] = paq_dir
            ficha = _ficha_noviq(p)  # figuras creadas por Noviq: su ficha dice exactamente qué son
            if ficha:
                m.update(rol=ficha.get("rol") or m["rol"], roles=ficha.get("roles") or m["roles"], enemigo=bool(ficha.get("enemigo")),
                         altura=ficha.get("altura") or m["altura"], temas_propios=list(ficha.get("temas") or m.get("temas_propios") or []),
                         creado_noviq=True, categoria=ficha.get("categoria"), plantilla=ficha.get("plantilla"))
                if ficha.get("etiquetas"):
                    m["palabras"] = list(dict.fromkeys((m.get("palabras") or []) + [w for w in ficha["etiquetas"] if isinstance(w, str)][:30]))
            modelos.append(m)
    for p in otros:  # .fbx/.obj de paquetes que NO traen su versión .glb (los demás son copias del mismo modelo)
        rel = p.relative_to(raiz)
        paq = limpiar_paquete(rel.parts[0]) if len(rel.parts) > 1 else "Sueltos"
        if paq not in con_glb:
            ignorados[p.suffix.lower()] = ignorados.get(p.suffix.lower(), 0) + 1
    # temáticas e info de cada paquete
    paquetes = {}
    for m in modelos:
        paquetes.setdefault(m["paquete"], {"n": 0, "votos": {}, "dir": m["_paq_dir"], "roles": {}})
        pq = paquetes[m["paquete"]]
        pq["n"] += 1
        pq["roles"][m["rol"]] = pq["roles"].get(m["rol"], 0) + 1
        for t in m["temas_propios"]:
            pq["votos"][t] = pq["votos"].get(t, 0) + 1
    for nombre, pq in paquetes.items():
        info = _info_paquete(raiz / pq["dir"]) if pq["dir"] else {}
        pal_paq = _palabras(nombre)
        temas = set(_temas_de(pal_paq))
        umbral = max(2, pq["n"] * 0.12)
        temas |= {t for t, v in pq["votos"].items() if v >= umbral and t != "bosque"}
        if isinstance(info.get("temas"), list):
            temas |= {str(t) for t in info["temas"]}
        pq.update(temas=sorted(temas), licencia=info.get("licencia") or "", autor=info.get("autor") or "",
                  fuente=info.get("fuente") or "", url=info.get("url") or "", nota=info.get("nota") or "")
        infos[nombre] = pq
    for m in modelos:
        pq = paquetes[m["paquete"]]
        m["temas"] = sorted(set(m["temas_propios"]) | set(pq["temas"]))
        m["temas_paquete"] = list(pq["temas"])
        m["tematico"] = not (m["rol"] in GENERICOS and "dead" not in m["palabras"] and not (set(m["palabras"]) & MODERNO))
        m["licencia"] = pq["licencia"] or "ver el paquete"
        m["autor"] = pq["autor"] or m["paquete"]
        m["fuente_origen"] = pq["fuente"]
        m["url"] = pq["url"]
        et = set(m["palabras"]) | set(m["sub"]) | set(_palabras(m["paquete"])) | set(m["roles"])
        for w in list(et):
            et |= set(SINONIMOS.get(w, []))
        m["etiquetas"] = sorted(et)
        m.pop("_paq_dir", None)
    out_paq = {k: {x: v[x] for x in ("n", "temas", "licencia", "autor", "fuente", "url", "nota", "roles")} for k, v in infos.items()}
    return {"version": VERSION, "carpeta": str(raiz), "escaneado": int(time.time()), "modelos": modelos, "paquetes": out_paq,
            "ignorados": ignorados, **informe}


def indice(forzar=False, max_age=8):
    """Índice de la carpeta (se reescanea solo si cambió algo; lo ya leído se reutiliza)."""
    with _lock:
        raiz = carpeta()
        d = _mem["datos"]
        if not forzar and d and _mem["carpeta"] == str(raiz) and time.time() - _mem["t"] < max_age:
            return d
        viejo = None if forzar else (d or _cargar_disco())
        if viejo and viejo.get("carpeta") != str(raiz):
            viejo = None
        try:
            d = _escanear(raiz, viejo)
        except Exception as e:  # nunca rompe el Estudio: sin biblioteca se usan las galerías de internet
            d = {"version": VERSION, "carpeta": str(raiz), "modelos": [], "paquetes": {}, "ignorados": {}, "zips": [],
                 "zips_sin_modelos": [], "errores": [f"{type(e).__name__}: {e}"]}
        firma = hashlib.md5(json.dumps([(m["id"], m["bytes"], m["mtime"]) for m in d["modelos"]]).encode()).hexdigest()
        cambio = firma != _mem.get("firma") or forzar
        _mem.update(t=time.time(), carpeta=str(raiz), datos=d, firma=firma)
        if cambio:  # el índice en disco solo se reescribe si algo cambió
            try:
                INDICE.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass
        return d


def _cargar_disco():
    try:
        return json.loads(INDICE.read_text(encoding="utf-8"))
    except Exception:
        return None


def por_id(mid):
    for m in indice()["modelos"]:
        if m["id"] == mid or m["h"] == mid:
            return m
    return None


def ruta_de(mid):
    """Ruta segura de un modelo de la biblioteca (siempre dentro de la carpeta)."""
    m = por_id(mid)
    if not m:
        raise RuntimeError(f"el modelo «{mid}» ya no está en la carpeta 3D (vuelve a escanear)")
    raiz = carpeta().resolve()
    p = Path(m["ruta"]).resolve()
    if raiz not in p.parents or not p.is_file():
        raise RuntimeError("ese modelo está fuera de la carpeta 3D")
    return p


def miniatura_url(m):
    return f"/api/juegos/biblioteca/mini/{m['h']}.png" if (MINIS / f"{m['h']}.png").exists() else ""


def guardar_miniatura(h, datos_png):
    if not re.fullmatch(r"[0-9a-f]{16}", h or "") or not datos_png or len(datos_png) > 600_000 or datos_png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("miniatura inválida")
    MINIS.mkdir(parents=True, exist_ok=True)
    (MINIS / f"{h}.png").write_bytes(datos_png)
    return f"/api/juegos/biblioteca/mini/{h}.png"


def resumen_publico(d=None):
    """Lo que ve la ventana (sin rutas internas de más)."""
    d = d or indice()
    mods = []
    for m in d["modelos"]:
        mods.append({k: m.get(k) for k in ("id", "h", "nombre", "variante", "paquete", "rol", "roles", "temas", "caras", "esqueleto",
                                          "bytes", "ruta", "licencia", "autor", "altura", "enemigo", "no_soportado", "creado_noviq", "categoria")}
                    | {"animaciones": len(m.get("animaciones") or []), "miniatura": miniatura_url(m)})
    return {"carpeta": d["carpeta"], "defecto": str(carpeta_defecto()), "es_defecto": Path(d["carpeta"]) == carpeta_defecto(),
            "modelos": mods, "paquetes": d.get("paquetes") or {}, "ignorados": d.get("ignorados") or {},
            "zips": d.get("zips") or [], "zips_sin_modelos": d.get("zips_sin_modelos") or [], "errores": (d.get("errores") or [])[:20],
            "escaneado": d.get("escaneado")}


# ───────────── Búsqueda y elección para un juego ─────────────
def _tokens_consulta(consulta):
    toks = set(_palabras(consulta))
    try:
        from .activos import a_ingles
        toks |= set(_palabras(a_ingles(consulta)))
    except Exception:
        pass
    return {t for t in toks if t not in STOP and len(t) > 1}


def _relevancia(q, m):
    if not q:
        return 0.0
    et = m.get("etiquetas") or []
    hit = 0
    for w in q:
        if w in et or (w.endswith("s") and w[:-1] in et) or (w + "s") in et or \
                (len(w) >= 4 and any(e.startswith(w) or (len(e) >= 4 and w.startswith(e)) for e in et)):
            hit += 1
    return hit / len(q)


def _rol_base(rol):
    return re.sub(r"(_v?\d+|\d+)$", "", rol or "")


NO_AUTO = {"bicycle", "bike", "motorcycle", "motorbike", "tank", "broken", "bus", "tractor", "truck", "boat", "ship", "spaceship"}


def _es_auto(m):
    """¿Sirve para correr una carrera? (autos: no bicicletas, tanques, buses ni autos rotos)"""
    return m["rol"] == "vehiculo" and 1.2 <= (m.get("altura") or 1.7) <= 2.3 and not (set(m.get("palabras") or []) & NO_AUTO)


def ajuste_rol(rol, m, genero=None):
    """0-1: qué tan bien sirve el modelo para ese rol del juego."""
    rb = _rol_base(rol)
    if not rb:
        return 0.0
    principal = m["rol"]
    carreras = genero == "carreras"
    if rb == "jugador":
        if carreras:
            return 1.0 if _es_auto(m) else 0.0
        if principal == "personaje":
            return 0.35 if m.get("enemigo") else 1.0
        return 0.25 if principal == "animal" else 0.0
    if rb == "enemigo":
        if carreras:
            return 1.0 if _es_auto(m) else 0.0
        if principal in ("personaje", "animal"):
            return 1.0 if m.get("enemigo") else 0.3
        return 0.0
    if rb in ("coleccionable", "meta"):
        if m.get("esqueleto"):
            return 0.0
        return 1.0 if principal == "coleccionable" else 0.7 if "coleccionable" in m["roles"] else 0.0
    if rb == "arma":
        return 1.0 if principal == "arma" else 0.0
    if m.get("esqueleto") and principal not in ("personaje", "animal"):
        return 0.0
    if rb == principal:
        return 1.0
    return 0.6 if rb in m["roles"] else 0.0


def ajuste_tema(tema, m, genero=None):
    ts = set(m.get("temas") or [])
    best = 0.0
    for t in [x for x in (tema, genero) if x]:
        if t in ts:
            return 1.0
        for a, v in (TEMA_AFIN.get(t) or {}).items():
            if a in ts:
                best = max(best, v)
    return best


def buscar(consulta, limite=12, rol=None, tema=None, genero=None):
    """Modelos de la carpeta para una búsqueda (y/o un rol del juego), del más al menos adecuado."""
    q = _tokens_consulta(consulta or "")
    res = []
    for m in indice()["modelos"]:
        if m.get("no_soportado"):
            continue
        rel = _relevancia(q, m)
        rf = ajuste_rol(rol, m, genero) if rol else 0.0
        if rol and _rol_base(rol) not in ("jugador", "enemigo", "coleccionable", "arma", "meta") and rf == 0 and rel < 0.99:
            continue
        if rel <= 0 and rf <= 0:
            continue
        tf = ajuste_tema(tema, m, genero)
        if rol and m.get("tematico") and rf > 0 and rel == 0 and tf == 0 and _rol_base(rol) not in ("jugador",):
            continue
        p = 0.55 * rel + 0.3 * rf + 0.15 * tf + (0.03 if not m.get("variante") else 0)
        res.append((p, m))
    res.sort(key=lambda x: (-x[0], x[1].get("variante") or "", x[1]["nombre"]))
    return [dict(m, puntaje_local=round(p, 3)) for p, m in res[:limite]]


def item_activo(m, rol=None, puntaje=None):
    """El modelo en el formato de resultados de activos.buscar() (para la galería del Estudio y descargar())."""
    return {"fuente": "local", "id": m["id"], "nombre": m["nombre"] + (f" ({m['variante'][:4]})" if m.get("variante") else ""),
            "tipo": "modelo", "licencia": m.get("licencia") or "ver el paquete", "autor": m.get("autor") or m.get("paquete"),
            "miniatura": miniatura_url(m), "h": m["h"], "url": m.get("url") or "", "caras": m.get("caras"),
            "animado": bool(m.get("animaciones")), "relevancia": puntaje if puntaje is not None else m.get("puntaje_local", 0.5),
            "estilo": "todos", "paquete": m.get("paquete"), "rol_local": m.get("rol"), "ruta": m.get("ruta"),
            **({"rol": rol} if rol else {})}


# decoración extra que se agrega sola si la carpeta la tiene y encaja con la temática o el género
EXTRAS_TEMA = {
    "ciudad": ["vehiculo", "farola", "senal", "banco", "urbano", "cono", "contenedor", "arbusto", "arbol"],
    "terror": ["lapida", "calabaza", "vela", "ataud", "hueso", "valla", "farola", "arbol"],
    "zombies": ["vehiculo", "barril", "valla", "contenedor", "escombros", "caja", "lapida", "farola"],
    "militar": ["valla", "barril", "contenedor", "escombros", "vehiculo", "caja", "farola"],
    "futurista": ["contenedor", "barril", "senal", "farola"],
    "granja": ["valla", "calabaza", "caja", "barril", "banco", "arbusto"],
    "medieval": ["barril", "caja", "valla", "banco"],
    "bosque": ["arbusto", "roca", "pino", "hongo"],
    "desierto": ["barril", "caja", "roca"],
    "oceano": ["barril", "caja", "palmera"],
    "deportes": ["banco", "cono", "senal", "farola"],
    "espacio": ["contenedor", "barril"],
    "fantasia": ["hongo", "cristal", "arbusto"],
    "nieve": ["pino", "roca"],
    "andes": ["roca", "arbusto"],
    "dinosaurios": ["palmera", "roca", "arbusto"],
}
EXTRAS_GENERO = {"disparos": ["barril", "valla", "contenedor", "escombros", "caja"], "supervivencia": ["barril", "valla", "escombros", "caja"],
                 "carreras": ["cono", "senal", "farola"], "terror": ["lapida", "vela"]}
CANTIDAD = {"vehiculo": 10, "farola": 16, "senal": 10, "banco": 10, "urbano": 12, "cono": 16, "contenedor": 7, "arbusto": 30,
            "arbol": 30, "lapida": 30, "calabaza": 18, "vela": 12, "ataud": 5, "hueso": 12, "valla": 16, "barril": 14,
            "escombros": 12, "caja": 14, "roca": 30, "pino": 30, "hongo": 15, "cristal": 15, "palmera": 25, "casa": 8, "edificio": 25}
CONSULTA_EN = {"vehiculo": "car", "farola": "street light", "senal": "sign", "banco": "bench", "urbano": "street props", "cono": "traffic cone",
               "contenedor": "container", "arbusto": "bush", "arbol": "tree", "lapida": "gravestone", "calabaza": "pumpkin", "vela": "candle",
               "ataud": "coffin", "hueso": "bones", "valla": "fence", "barril": "barrel", "escombros": "debris", "caja": "crate",
               "roca": "rock", "pino": "pine tree", "hongo": "mushroom", "cristal": "crystal", "palmera": "palm tree", "casa": "house",
               "edificio": "building", "torre": "tower", "arma": "pistol", "jugador": "character", "enemigo": "enemy", "coleccionable": "item"}


def _mejor(cands):
    cands.sort(key=lambda x: (-x[0], x[1].get("variante") or "", x[1]["nombre"]))
    return cands[0][1] if cands else None


# decoración que se ve mejor variada: se mezclan distintos modelos del mismo rol y paquete (edificios, autos, lápidas…)
VARIEDAD = {"edificio", "vehiculo", "lapida", "calabaza", "casa", "valla", "caja", "barril", "contenedor", "escombros", "arbusto", "roca",
            "banco", "senal", "urbano", "hueso", "vela"}


def _variantes(m, todos, maximo=3, tema=None):
    """Otras versiones del mismo modelo en el mismo paquete (Poly Pizza las nombra «Tree», «Tree-XXXXXXXXXX»…) y, para la
    decoración que se ve mejor variada, otros modelos del mismo rol y paquete (ej. distintos edificios o autos)."""
    out = [m]
    ok = lambda x: x is not m and x["paquete"] == m["paquete"] and not x.get("no_soportado") and not x.get("esqueleto")
    for x in todos:
        if len(out) >= maximo:
            break
        if ok(x) and _norm(x["nombre"]) == _norm(m["nombre"]):
            out.append(x)
    if m["rol"] in VARIEDAD:
        maximo = max(maximo, 4)
        vistos = {_norm(x["nombre"]) for x in out}
        h0 = m.get("altura") or 1
        for x in sorted(todos, key=lambda x: (round(abs((x.get("altura") or 1) - h0), 1), x.get("variante") or "", x["nombre"])):
            if len(out) >= maximo:
                break
            if ok(x) and x["rol"] == m["rol"] and _norm(x["nombre"]) not in vistos and x.get("tematico") == m.get("tematico") \
                    and abs((x.get("altura") or 1) - (m.get("altura") or 1)) <= max(1.0, (m.get("altura") or 1) * 0.8) \
                    and (not tema or ajuste_tema(tema, x) >= ajuste_tema(tema, m) - 0.1):
                out.append(x)
                vistos.add(_norm(x["nombre"]))
    return out


def sugerir(d, extras=True, max_extras=6):
    """Para un diseño de juego (juegos.planificar): el mejor modelo de la carpeta para cada rol.
    → {"asignados": {rol: [modelo, variantes…]}, "extras": [decoración nueva], "consultas": {rol: búsqueda}}"""
    todos = [m for m in indice()["modelos"] if not m.get("no_soportado")]
    if not todos or d.get("motor") != "3d":
        return {"asignados": {}, "extras": [], "consultas": {}}
    tema, genero = d.get("tema"), d.get("genero")
    activos = d.get("activos") or {}
    nivel = (d.get("calidad") or {}).get("nivel") or "medio"
    n_enemigos = max([int(e.get("cantidad") or 0) for e in d.get("enemigos") or []] + [1])
    limite_piezas = {"basico": 250, "medio": 700, "alto": 2500, "ultra": 5000}.get(nivel, 700)  # dibujos por cuadro que aguanta la PC
    asig, usados = {}, set()

    def elegir(rol, consulta, exigir_texto=False, evitar=()):
        q = _tokens_consulta(consulta)
        cands = []
        for m in todos:
            if m["id"] in evitar:
                continue
            rf = ajuste_rol(rol, m, genero)
            if rf <= 0:
                continue
            rel = _relevancia(q, m)
            tf = ajuste_tema(tema, m, genero)
            rb = _rol_base(rol)
            if rb == "enemigo" and genero != "carreras" and not (rel > 0 or (rf >= 1 and ajuste_tema(tema, m) >= 0.8)):
                continue  # un enemigo solo si lo pide la idea o si es de la misma temática (no un soldado como fantasma)
            if rb in ("coleccionable", "meta") and rel <= 0:
                continue
            if exigir_texto and rel <= 0:
                continue
            if rb in DECORACION and m.get("tematico") and tf <= 0:
                continue  # (una maceta de ciudad no va en los Andes aunque se llame «bushes»)
            if rb == "enemigo" and genero != "carreras" and (m.get("piezas") or 0) * n_enemigos > limite_piezas:
                continue
            anim = 0.15 if (rb in ("jugador", "enemigo") and len(m.get("animaciones") or []) >= 2) else 0
            sports = 0.2 if (rb == "jugador" and genero == "carreras" and "sports" in m["palabras"]) else 0
            if rb in DECORACION:  # en la decoración manda la temática (el nombre en inglés solo desempata)
                p = 0.6 * tf + 0.12 * rel + 0.25 * rf
            else:
                p = 0.45 * tf + 0.35 * rel + 0.25 * rf
            paq = 0.1 if tema in (m.get("temas_paquete") or []) else 0  # el paquete hecho para esa temática gana los empates
            cands.append((p + anim + sports + paq + (0.05 if not m.get("tematico") else 0) - (0.05 if m.get("variante") else 0), m))
        return _mejor(cands)

    m = elegir("jugador", activos.get("jugador") or "character")
    if m:
        asig["jugador"] = [m]
        usados.add(m["id"])
    for i, e in enumerate(d.get("enemigos") or []):
        rol = e.get("modelo") or ("enemigo" if i == 0 else f"enemigo{i + 1}")
        m = elegir(rol, f"{e.get('forma', '')} {e.get('nombre', '')} {activos.get(rol, '')}", evitar=usados)
        if m:
            asig[rol] = [m]
            usados.add(m["id"])
    for i, o in enumerate(d.get("objetos") or []):
        rol = o.get("modelo") or ("coleccionable" if i == 0 else f"coleccionable{i + 1}")
        m = elegir(rol, f"{o.get('forma', '')} {o.get('nombre', '')} {activos.get(rol, '')}")
        if m:
            asig[rol] = [m]
    arma = (d.get("jugador") or {}).get("arma")
    if arma in ("disparo", "espada") and genero != "carreras":
        m = elegir("arma", "pistol revolver gun" if arma == "disparo" else "sword knife axe", exigir_texto=True)
        if m:
            asig["arma"] = [m]
    ya = set()
    for x in d.get("decoracion") or []:
        tipo = x.get("tipo")
        rol = x.get("modelo") or tipo
        if not tipo or tipo in ya:
            continue
        ya.add(tipo)
        m = elegir(tipo, f"{activos.get(tipo, '')} {CONSULTA_EN.get(tipo, tipo)}")
        if m:
            asig[rol] = _variantes(m, todos, tema=tema)
    formas_obj = {o.get("forma") for o in d.get("objetos") or []}
    nuevos = []
    if extras:
        cand = list(dict.fromkeys((EXTRAS_TEMA.get(tema) or []) + (EXTRAS_GENERO.get(genero) or [])))
        for tipo in cand:
            if len(nuevos) >= max_extras or len(ya) + len(nuevos) >= 12:
                break
            if tipo in ya or tipo in formas_obj:  # (si se recogen calabazas, no se decora con calabazas)
                continue
            m = elegir(tipo, CONSULTA_EN.get(tipo, tipo))
            if not m:
                continue
            if m.get("tematico") and ajuste_tema(tema, m, genero) <= 0:
                continue
            ya.add(tipo)
            asig[tipo] = _variantes(m, todos, tema=tema)
            nuevos.append({"tipo": tipo, "modelo": tipo, "cantidad": CANTIDAD.get(tipo, 12), "altura": m.get("altura") or ALTURA.get(tipo, 2)})
    consultas = {rol: (activos.get(rol) or CONSULTA_EN.get(_rol_base(rol)) or (lst[0]["nombre"])) for rol, lst in asig.items()}
    return {"asignados": asig, "extras": nuevos, "consultas": consultas}
