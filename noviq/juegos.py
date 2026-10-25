# -*- coding: utf-8 -*-
"""🎮 Estudio de juegos de Noviq: de una idea en texto a un juego que funciona, pensado para principiantes.

1. perfil_grafico(): mide la tarjeta (NVIDIA o no), la VRAM y la RAM libre → nivel básico/medio/alto/ultra y el estilo
   recomendado. Si la PC no aguanta 3D realista, sugiere el estilo VÓXEL HD (tipo Minecraft, pixelado pero de alta
   calidad: oclusión ambiental, niebla, ciclo de día y noche) o 2D pixel art.
2. planificar(idea): la IA (la más rápida que funcione) traduce la idea al DISEÑO del juego (género, objetivo, jugador,
   enemigos, objetos, mundo, colores y qué modelos buscar). Si no hay IA, se arma con reglas locales.
3. crear(diseño): crea el proyecto con un MOTOR ya probado y eficiente (Three.js 3D, vóxel o 2D en canvas), el diseño
   en juego.config.js, las reglas personalizables en juego.js, busca y descarga los activos 3D libres que encajan
   con el género y la temática, y deja jugar.bat para abrirlo con doble clic. Después la IA del chat personaliza la
   lógica sobre esa base (sin empezar de cero ni romper el motor)."""
import json
import re
import shutil
import threading
import time
import uuid

from . import intencion as I
from .config import BASE_DIR

PLANTILLAS = BASE_DIR / "static" / "juegos"

ESTILOS = {
    "realista": {"nombre": "🌄 3D realista", "motor": "3d", "min": "medio",
                 "desc": "Modelos y texturas realistas (Poly Haven, Sketchfab), sombras y niebla. Necesita una tarjeta dedicada."},
    "lowpoly": {"nombre": "🎨 3D low poly", "motor": "3d", "min": "medio",
                "desc": "3D colorido y estilizado, muy fluido. Ideal para la mayoría de las PCs."},
    "voxel": {"nombre": "🧊 Vóxel HD (estilo Minecraft)", "motor": "voxel", "min": "basico",
              "desc": "Mundo de bloques pixelados pero de alta calidad (oclusión ambiental, niebla, día y noche). Corre en casi cualquier PC."},
    "pixel2d": {"nombre": "🕹 2D pixel art", "motor": "2d", "min": "basico",
                "desc": "Clásico en 2D (plataformas o vista desde arriba). Lo más liviano: corre en cualquier PC."},
}
NIVELES = ["basico", "medio", "alto", "ultra"]
CALIDAD = {  # lo que usa el motor según el nivel de la PC (el juego además baja la resolución solo si van pocos FPS)
    "basico": {"nivel": "basico", "pixelRatio": 0.85, "sombras": False, "sombraTam": 512, "antialias": False, "distancia": 90,
               "densidad": 0.45, "terreno": 64, "chunks": 3, "fpsObjetivo": 40},
    "medio": {"nivel": "medio", "pixelRatio": 1.0, "sombras": True, "sombraTam": 1024, "antialias": False, "distancia": 140,
              "densidad": 0.7, "terreno": 112, "chunks": 4, "fpsObjetivo": 50},
    "alto": {"nivel": "alto", "pixelRatio": 1.25, "sombras": True, "sombraTam": 2048, "antialias": True, "distancia": 220,
             "densidad": 1.0, "terreno": 160, "chunks": 6, "fpsObjetivo": 55},
    "ultra": {"nivel": "ultra", "pixelRatio": 1.5, "sombras": True, "sombraTam": 4096, "antialias": True, "distancia": 320,
              "densidad": 1.35, "terreno": 224, "chunks": 8, "fpsObjetivo": 58},
}

GENEROS = {
    "aventura": {"nombre": "Aventura", "objetivo": "recolectar", "camara": "tercera", "arma": "espada", "comportamiento": "perseguir"},
    "plataformas": {"nombre": "Plataformas", "objetivo": "llegar", "camara": "tercera", "arma": "saltar", "comportamiento": "patrullar"},
    "carreras": {"nombre": "Carreras", "objetivo": "carrera", "camara": "tercera", "arma": "ninguna", "comportamiento": "rival"},
    "disparos": {"nombre": "Disparos", "objetivo": "derrotar", "camara": "tercera", "arma": "disparo", "comportamiento": "perseguir"},
    "supervivencia": {"nombre": "Supervivencia", "objetivo": "sobrevivir", "camara": "tercera", "arma": "espada", "comportamiento": "perseguir"},
    "construccion": {"nombre": "Construcción (sandbox)", "objetivo": "construir", "camara": "primera", "arma": "espada", "comportamiento": "perseguir"},
    "puzle": {"nombre": "Puzle / recolección", "objetivo": "recolectar", "camara": "tercera", "arma": "ninguna", "comportamiento": "patrullar"},
    "rpg": {"nombre": "Rol (RPG)", "objetivo": "derrotar", "camara": "tercera", "arma": "espada", "comportamiento": "perseguir"},
    "terror": {"nombre": "Terror", "objetivo": "llegar", "camara": "primera", "arma": "ninguna", "comportamiento": "perseguir"},
    "deportes": {"nombre": "Deportes / arcade", "objetivo": "recolectar", "camara": "tercera", "arma": "ninguna", "comportamiento": "patrullar"},
    "exploracion": {"nombre": "Exploración", "objetivo": "recolectar", "camara": "tercera", "arma": "ninguna", "comportamiento": "patrullar"},
}

TEMAS = {  # colores del mundo, decoración y qué buscar en las galerías (en inglés)
    "bosque": {"cielo": "#8ec5ff", "horizonte": "#e3f1ff", "suelo": ["#3f7a2e", "#5c9a3c", "#7a8f4a", "#9aa39a"], "agua": "#2f6f9f",
               "decoracion": [["arbol", 70], ["pino", 40], ["roca", 30], ["arbusto", 40], ["hongo", 15]],
               "enemigo": ["lobo", "#6b6b73"], "objeto": ["gema", "#39e6ff"], "buscar": {"jugador": "adventurer character",
               "enemigo": "wolf", "coleccionable": "gem", "arbol": "tree", "roca": "rock"}, "suelo_tex": "forest ground"},
    "medieval": {"cielo": "#9cc3ff", "horizonte": "#f3e7d3", "suelo": ["#4d7a33", "#6b8f44", "#8b7a5a", "#a8a39a"], "agua": "#35709a",
                 "decoracion": [["arbol", 45], ["torre", 6], ["casa", 10], ["roca", 30], ["caja", 12]],
                 "enemigo": ["esqueleto", "#e8e2d0"], "objeto": ["moneda", "#ffd23f"], "buscar": {"jugador": "knight",
                 "enemigo": "skeleton", "coleccionable": "gold coin", "torre": "castle tower", "arbol": "tree"}, "suelo_tex": "cobblestone"},
    "espacio": {"cielo": "#070b1f", "horizonte": "#2a1f4f", "suelo": ["#4a3f5c", "#6a5a7a", "#8c7aa0", "#b8a8d0"], "agua": None,
                "decoracion": [["cristal", 40], ["roca", 45], ["torre", 4]], "enemigo": ["robot", "#ff4f6d"], "objeto": ["cristal", "#7dffb0"],
                "buscar": {"jugador": "astronaut", "enemigo": "alien", "coleccionable": "crystal", "roca": "asteroid"},
                "suelo_tex": "alien ground", "noche": True},
    "zombies": {"cielo": "#7a8591", "horizonte": "#b3aa96", "suelo": ["#4e5a3a", "#6b6a48", "#7d705a", "#8f8a80"], "agua": "#3b4f4f",
                "decoracion": [["arbol", 30], ["casa", 12], ["caja", 20], ["lapida", 20], ["farola", 10]],
                "enemigo": ["zombie", "#6f9a5a"], "objeto": ["botiquin", "#ff4a4a"], "buscar": {"jugador": "survivor soldier",
                "enemigo": "zombie", "coleccionable": "medkit", "casa": "abandoned house"}, "suelo_tex": "dirt"},
    "desierto": {"cielo": "#a8d4ff", "horizonte": "#fff0cc", "suelo": ["#d9b26f", "#e3c07e", "#c99a5b", "#b88a55"], "agua": "#3a8fb5",
                 "decoracion": [["cactus", 45], ["roca", 35], ["piramide", 3], ["palmera", 10]], "enemigo": ["escorpion", "#8a4b2a"],
                 "objeto": ["moneda", "#ffd23f"], "buscar": {"jugador": "explorer", "enemigo": "scorpion", "coleccionable": "gold coin",
                 "cactus": "cactus", "roca": "desert rock"}, "suelo_tex": "sand"},
    "nieve": {"cielo": "#c9e3ff", "horizonte": "#ffffff", "suelo": ["#e8f0f7", "#ffffff", "#c9d6e3", "#9fb3c8"], "agua": "#7fb3d5",
              "decoracion": [["pino", 60], ["roca", 30], ["cristal", 12]], "enemigo": ["lobo", "#d0d8e0"], "objeto": ["cristal", "#8fd8ff"],
              "buscar": {"jugador": "explorer", "enemigo": "wolf", "coleccionable": "crystal", "pino": "pine tree"}, "suelo_tex": "snow"},
    "oceano": {"cielo": "#7fd0ff", "horizonte": "#e8fbff", "suelo": ["#e8d6a0", "#6db55a", "#4f8f3f", "#8a8a80"], "agua": "#1e90c8",
               "decoracion": [["palmera", 40], ["roca", 25], ["caja", 10], ["arbusto", 20]], "enemigo": ["cangrejo", "#ff6a3d"],
               "objeto": ["moneda", "#ffd23f"], "buscar": {"jugador": "pirate", "enemigo": "crab", "coleccionable": "treasure chest",
               "palmera": "palm tree"}, "suelo_tex": "beach sand", "isla": True},
    "ciudad": {"cielo": "#9ec9ff", "horizonte": "#e8eef5", "suelo": ["#5a5f66", "#6b7078", "#7d838c", "#8f969f"], "agua": None,
               "decoracion": [["edificio", 35], ["farola", 30], ["caja", 15], ["arbol", 20]], "enemigo": ["robot", "#ff4f6d"],
               "objeto": ["moneda", "#ffd23f"], "buscar": {"jugador": "character", "enemigo": "robot", "coleccionable": "coin",
               "edificio": "building"}, "suelo_tex": "asphalt", "plano": True},
    "fantasia": {"cielo": "#b39cff", "horizonte": "#ffd6f5", "suelo": ["#5aa06a", "#7cc47a", "#a38fd0", "#d0c0ff"], "agua": "#5a7fff",
                 "decoracion": [["arbol", 50], ["hongo", 30], ["cristal", 25], ["torre", 3]], "enemigo": ["slime", "#8a5aff"],
                 "objeto": ["estrella", "#fff27a"], "buscar": {"jugador": "wizard", "enemigo": "slime monster", "coleccionable": "star",
                 "hongo": "mushroom"}, "suelo_tex": "fantasy grass"},
    "terror": {"cielo": "#1a1f2b", "horizonte": "#2d2f3a", "suelo": ["#2f3a2a", "#3c4433", "#4a4a42", "#55524d"], "agua": "#1f2d33",
               "decoracion": [["arbol", 50], ["lapida", 30], ["casa", 3], ["farola", 8]], "enemigo": ["fantasma", "#d8e6ff"],
               "objeto": ["llave", "#ffcf4a"], "buscar": {"jugador": "character", "enemigo": "ghost", "coleccionable": "old key",
               "lapida": "gravestone", "casa": "haunted house"}, "suelo_tex": "dark forest ground", "noche": True, "niebla": 0.05},
    "futurista": {"cielo": "#1b1036", "horizonte": "#ff4fd8", "suelo": ["#1e2a44", "#25355a", "#34487a", "#4a63a8"], "agua": None,
                  "decoracion": [["edificio", 30], ["farola", 30], ["cristal", 20]], "enemigo": ["robot", "#ff3b7b"],
                  "objeto": ["cristal", "#3bffe8"], "buscar": {"jugador": "cyberpunk character", "enemigo": "drone robot",
                  "coleccionable": "energy cell", "edificio": "sci-fi building"}, "suelo_tex": "sci-fi floor", "noche": True, "plano": True},
    "dinosaurios": {"cielo": "#a6d8ff", "horizonte": "#f5ffe0", "suelo": ["#4f7f2a", "#6f9a3a", "#8a7a4a", "#8f8a7a"], "agua": "#2f7f8f",
                    "decoracion": [["palmera", 40], ["arbol", 40], ["roca", 30], ["arbusto", 30]], "enemigo": ["dinosaurio", "#5a8f3a"],
                    "objeto": ["huevo", "#fff3d6"], "buscar": {"jugador": "explorer", "enemigo": "dinosaur", "coleccionable": "egg",
                    "palmera": "palm tree"}, "suelo_tex": "jungle ground"},
    "andes": {"cielo": "#8fc4ff", "horizonte": "#eef6ff", "suelo": ["#5b7f3a", "#7a8f4a", "#8a7a66", "#f2f5f8"], "agua": "#3f7fb0",
              "decoracion": [["arbusto", 50], ["roca", 50], ["pino", 20], ["casa", 4]], "enemigo": ["condor", "#3a3a3a"],
              "objeto": ["gema", "#39e6ff"], "buscar": {"jugador": "hiker", "enemigo": "condor", "coleccionable": "gem",
              "roca": "rock"}, "suelo_tex": "grass", "montanoso": True},
    "granja": {"cielo": "#9fd3ff", "horizonte": "#fff9e0", "suelo": ["#5f9a3a", "#7ab04a", "#a08a5a", "#b0a080"], "agua": "#3a8fc0",
               "decoracion": [["arbol", 25], ["casa", 4], ["caja", 20], ["arbusto", 30]], "enemigo": ["zorro", "#e07a2a"],
               "objeto": ["fruta", "#ff5a3a"], "buscar": {"jugador": "farmer", "enemigo": "fox", "coleccionable": "apple",
               "casa": "barn"}, "suelo_tex": "grass", "plano": True},
}
TEMAS["deportes"] = dict(TEMAS["ciudad"], decoracion=[["arbol", 20], ["farola", 12]], plano=True)
TEMAS["militar"] = {"cielo": "#a9c7e0", "horizonte": "#efe6d2", "suelo": ["#6b7a4a", "#8a8a5a", "#a08f6a", "#9a9488"], "agua": None,
                    "decoracion": [["caja", 16], ["roca", 20], ["arbol", 14], ["arbusto", 16], ["sacos_arena", 10], ["bidon", 8], ["barricada", 5],
                                   ["carpa_militar", 3], ["torre_vigia", 2], ["jeep", 2], ["tanque", 1]], "enemigo": ["soldado", "#5a6b3a"],
                    "objeto": ["botiquin", "#ff4a4a"], "buscar": {"jugador": "soldier", "enemigo": "enemy soldier", "coleccionable": "ammo",
                    "caja": "military crate"}, "suelo_tex": "dirt", "plano": True}
MAX_DECORACION = 16
# decoración que dibuja Noviq con sus figuras 3D (militar…): altura real en metros
ALTURA_DECO = {"sacos_arena": 0.75, "bidon": 0.9, "barricada": 1.3, "carpa_militar": 1.4, "torre_vigia": 4.8, "jeep": 1.7, "tanque": 2.3, "alambre": 0.7}
DECO_SIEMPRE = {"sacos_arena": "sacos_arena", "bidon": "bidon", "barricada": "barricada", "carpa_militar": "carpa_militar", "torre_vigia": "torre_vigia",
                "jeep": "jeep", "tanque": "tanque", "alambre": "alambre"}


def _deco(tipo, n):
    e = {"tipo": tipo, "modelo": tipo, "cantidad": n}
    if tipo in ALTURA_DECO:
        e["altura"] = ALTURA_DECO[tipo]
    return e
# decoración que el motor 3D sabe dibujar sin modelo (las demás solo se ponen si hay un modelo para ellas)
DECO_MOTOR = {"arbol", "pino", "palmera", "roca", "arbusto", "cactus", "casa", "torre", "edificio", "cristal", "hongo", "farola", "caja",
              "lapida", "piramide", "ruina", "planta", "flor", "abeto"}


def _norm_color(c, defecto):
    c = str(c or "").strip()
    return c if re.fullmatch(r"#[0-9a-fA-F]{6}", c) else defecto


# ───────────── 1. Perfil gráfico de la PC ─────────────
ESTILOS_EN = {"realista": ("🌄 Realistic 3D", "Realistic models and textures (Poly Haven, Sketchfab), shadows and fog. Needs a dedicated card."),
              "lowpoly": ("🎨 Low poly 3D", "Colorful stylized 3D, very smooth. Ideal for most PCs."),
              "voxel": ("🧊 HD voxel (Minecraft style)", "Pixelated but high-quality block world (ambient occlusion, fog, day and night). Runs on almost any PC."),
              "pixel2d": ("🕹 2D pixel art", "Classic 2D (platformer or top-down). The lightest: runs on any PC.")}
CONSEJO_EN = {"basico": "Your PC doesn't have strong graphics: I recommend 🧊 HD voxel (pixelated Minecraft style, high quality) or 🕹 2D pixel art. Both run smoothly on almost any computer.",
              "medio": "Your PC runs realistic 3D at medium quality (the game adjusts shadows and grass by itself); HD voxel is also very smooth.",
              "alto": "Your card handles realistic 3D with shadows and high-quality models.",
              "ultra": "High-end card: realistic 3D with high-resolution shadows and lots of vegetation."}
GENEROS_EN = {"aventura": "Adventure", "plataformas": "Platformer", "carreras": "Racing", "disparos": "Shooter", "supervivencia": "Survival",
              "construccion": "Building (sandbox)", "puzle": "Puzzle / collecting", "rpg": "Role-playing (RPG)", "terror": "Horror",
              "deportes": "Sports / arcade", "exploracion": "Exploration"}


def perfil_grafico(idioma="es"):
    """Nivel de la PC para juegos y el estilo recomendado (con el motivo en palabras simples)."""
    from . import nvidia as NV
    from . import recursos as R
    try:
        info = NV.info()
    except Exception:
        info = {"hay_nvidia": False, "gpus": [], "principal": None}
    try:
        m = R.medir(max_age=10)
    except Exception:
        m = {"ram_total_gb": 8, "ram_libre_gb": 4}
    gpus = info.get("gpus") or []
    g = info.get("principal") or (gpus[0] if gpus else {})
    nombre = g.get("nombre") or "sin tarjeta dedicada detectada"
    vram = float(g.get("vram_total_gb") or 0)
    integrada = not g or bool(re.search(r"(?i)intel|uhd|iris|radeon\(tm\)|radeon graphics|vega \d+ graphics|basic|llvmpipe|"
                                        r"swiftshader|apple m\d", nombre)) and not g.get("nvidia")
    motivo = []
    if info.get("hay_nvidia"):
        cc = g.get("cc") or 0
        nivel = "ultra" if vram >= 12 and cc >= 8.6 else "alto" if vram >= 8 and cc >= 7.5 else "medio" if vram >= 4 else "basico"
        motivo.append(f"NVIDIA {nombre} con {vram:g} GB de VRAM ({g.get('arquitectura', '?')})")
    elif not integrada and vram >= 8:
        nivel = "alto"
        motivo.append(f"tarjeta dedicada {nombre} con {vram:g} GB")
    elif not integrada and vram >= 3:
        nivel = "medio"
        motivo.append(f"tarjeta dedicada {nombre} con {vram:g} GB")
    else:
        nivel = "basico"
        motivo.append(f"gráficos integrados ({nombre})" if gpus else "no se detectó una tarjeta gráfica dedicada")
    libre = float(m.get("ram_libre_gb") or 4)
    if libre < 3 and nivel != "basico":
        nivel = NIVELES[NIVELES.index(nivel) - 1]
        motivo.append(f"poca RAM libre ahora ({libre:g} GB): se baja un nivel")
    elif libre < 3:
        motivo.append(f"poca RAM libre ahora ({libre:g} GB)")
    rec = {"ultra": "realista", "alto": "realista", "medio": "realista", "basico": "voxel"}[nivel]  # mundos realistas siempre que la PC aguante
    estilos = {}
    for k, e in ESTILOS.items():
        ok = NIVELES.index(nivel) >= NIVELES.index(e["min"])
        estilos[k] = {"nombre": e["nombre"], "desc": e["desc"], "ok": ok,
                      "aviso": "" if ok else f"tu PC podría ir lenta con este estilo (recomendado desde nivel {e['min']}); "
                                            "el juego bajará la calidad solo si hace falta"}
    consejo = {"basico": "Tu PC no tiene gráficos potentes: te recomiendo 🧊 Vóxel HD (estilo Minecraft pixelado pero de alta "
                         "calidad) o 🕹 2D pixel art. Van fluidos en casi cualquier equipo.",
               "medio": "Tu PC mueve 3D realista con calidad media (el juego ajusta sombras y hierba solo); el vóxel HD también va muy fluido.",
               "alto": "Tu tarjeta aguanta 3D realista con sombras y modelos de alta calidad.",
               "ultra": "Tu tarjeta es de gama alta: 3D realista con sombras de alta resolución y mucha vegetación."}[nivel]
    if info.get("hay_nvidia") and (g or {}).get("dlss"):
        consejo += (" (Tu RTX también soporta DLSS y trazado de rayos, pero eso solo se usa en Unreal/Unity; los juegos web usan "
                    "tu GPU mediante WebGL.)")
    if idioma == "en":
        for k, (n, dsc) in ESTILOS_EN.items():
            estilos[k].update(nombre=n, desc=dsc, aviso="" if estilos[k]["ok"] else "your PC may be slow with this style; the game lowers quality by itself if needed")
        consejo = CONSEJO_EN[nivel] + (" (Your RTX also supports DLSS and ray tracing, but only Unreal/Unity use them; web games use your GPU through WebGL.)"
                                       if info.get("hay_nvidia") and (g or {}).get("dlss") else "")
        nombre = nombre.replace("sin tarjeta dedicada detectada", "no dedicated card detected")
    return {"nivel": nivel, "recomendado": rec, "estilos": estilos, "gpu": nombre, "vram_gb": vram, "nvidia": bool(info.get("hay_nvidia")),
            "ram_libre_gb": libre, "ram_total_gb": m.get("ram_total_gb"), "motivo": "; ".join(motivo), "consejo": consejo,
            "calidad": CALIDAD[nivel], "clave_nvidia": bool(info.get("clave_nvidia"))}


# ───────────── 2. Diseño del juego (GDD) ─────────────
def _nombre_de(idea):
    pal = [p for p in re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]{4,}", idea or "") if I.normalizar(p) not in
           {"quiero", "crear", "hacer", "juego", "juegos", "videojuego", "donde", "tipo", "estilo", "sobre", "para", "como", "necesito",
            "hazme", "creame", "game", "make", "create", "with", "that", "este", "esta", "unos", "unas", "tenga", "haya", "pueda"}]
    return "_".join(p.capitalize() for p in pal[:3]) or "Mi_Juego"


# palabras de la idea → forma del enemigo / del objeto que usa el motor (para que el diseño sin IA también respete la idea)
FORMAS_ENEMIGO = {
    "zombie": ["zombie", "zombies", "zombi", "zombis", "muertos vivientes", "infectados"], "esqueleto": ["esqueleto", "esqueletos", "skeleton", "skeletons"],
    "slime": ["slime", "slimes", "baba", "babas", "gelatina", "gelatinas"], "robot": ["robot", "robots", "drone", "drones", "droide", "droides"],
    "fantasma": ["fantasma", "fantasmas", "ghost", "ghosts", "espiritu", "espiritus", "espectro", "espectros"],
    "dinosaurio": ["dinosaurio", "dinosaurios", "dino", "dinos", "trex", "raptor", "raptores"], "escorpion": ["escorpion", "escorpiones", "scorpion"],
    "cangrejo": ["cangrejo", "cangrejos", "crab", "crabs"], "condor": ["condor", "condores"], "zorro": ["zorro", "zorros", "fox"],
    "lobo": ["lobo", "lobos", "wolf", "wolves"], "alien": ["alien", "aliens", "extraterrestre", "extraterrestres", "marciano", "marcianos"],
    "oso": ["oso", "osos", "bear", "bears"], "bruja": ["bruja", "brujas", "witch"], "demonio": ["demonio", "demonios", "demon", "demons"],
    "soldado": ["soldado", "soldados", "soldier", "soldiers", "guardia", "guardias", "militar", "militares", "ejercito"],
    "mercenario": ["mercenario", "mercenarios", "rebelde", "rebeldes", "guerrillero", "guerrilleros", "insurgente", "insurgentes"]}
FORMAS_OBJETO = {
    "gema": ["gema", "gemas", "gem", "gems", "joya", "joyas", "diamante", "diamantes"], "moneda": ["moneda", "monedas", "coin", "coins"],
    "estrella": ["estrella", "estrellas", "star", "stars"], "cristal": ["cristal", "cristales", "crystal", "crystals"],
    "fruta": ["fruta", "frutas", "manzana", "manzanas", "apple", "apples"], "llave": ["llave", "llaves", "key", "keys"],
    "huevo": ["huevo", "huevos", "egg", "eggs"], "botiquin": ["botiquin", "botiquines", "medkit", "medkits"],
    "cofre": ["cofre", "cofres", "chest", "chests", "tesoro", "tesoros", "treasure"], "calabaza": ["calabaza", "calabazas", "pumpkin", "pumpkins"]}
COLOR_OBJETO = {"gema": "#39e6ff", "moneda": "#ffd23f", "estrella": "#fff27a", "cristal": "#7dffb0", "fruta": "#ff5a3a", "llave": "#ffcf4a",
                "huevo": "#fff3d6", "botiquin": "#ff4a4a", "cofre": "#ffd23f", "calabaza": "#ff8a1f"}


def _plural(p):
    return p + ("s" if p[-1:] in "aeiou" else "es")


def _leer_idea(d, idea):
    """Ajusta el diseño base a lo que dice la idea: qué enemigos, qué se recoge y cuántos (sin IA)."""
    txt = I.normalizar(idea or "")
    toks = re.findall(r"[a-z0-9]+", txt)

    def forma_de(tabla):
        for i, t in enumerate(toks):
            for f, ps in tabla.items():
                if t in ps:
                    return f, i
        return None, -1
    fe, _ = forma_de(FORMAS_ENEMIGO)
    if fe and d["enemigos"]:
        e = d["enemigos"][0]
        e.update(forma=fe, nombre=fe.capitalize())
    fo, _ = forma_de(FORMAS_OBJETO)
    if fo and d["objetos"]:
        o = d["objetos"][0]
        o.update(forma=fo, nombre=fo.capitalize(), color=COLOR_OBJETO.get(fo, o.get("color")), efecto="vida" if fo == "botiquin" else "puntos")
    obj = d["objetivo"]
    # la misión que pide la idea manda sobre la del género («recoge 15 calabazas», «derrota a 20 zombies», «sobrevive 3 minutos»)
    todas_obj = {w for ps in FORMAS_OBJETO.values() for w in ps}
    m = re.search(r"\b(recog|recolect|junt|colecc|busc|encuentr|consig|atrap|salv|collect|gather|find)[a-z]*\s+(?:las?\s+|los\s+)?(\d{1,3})\s+([a-z]+)", txt)
    if m and m.group(3) in todas_obj and d["objetos"]:
        obj["tipo"] = "recolectar"
    elif re.search(r"\b(derrot|mata|matar|elimin|destru|vence|acaba|kill|defeat)[a-z]*\s+(?:a\s+)?\d{1,3}\b", txt) and d["enemigos"]:
        obj["tipo"] = "derrotar"
    elif re.search(r"\b(sobreviv|resist|aguant|surviv)[a-z]*\s+\d{1,3}\s+(minuto|segundo|min)", txt):
        obj["tipo"] = "sobrevivir"
    for m in re.finditer(r"(\d{1,3})\s+([a-z]+)", txt):
        n, w = int(m.group(1)), m.group(2)
        if w.startswith(("minuto", "min")) and obj["tipo"] == "sobrevivir":
            obj["cantidad"] = max(30, min(3600, n * 60))
            obj["texto"] = f"Sobrevive {n} minuto{'s' if n != 1 else ''}"
        elif w.startswith("segundo") and obj["tipo"] == "sobrevivir":
            obj["cantidad"] = max(20, min(3600, n))
            obj["texto"] = f"Sobrevive {n} segundos"
        elif w.startswith(("vuelta", "lap")) and obj["tipo"] == "carrera":
            obj["cantidad"] = max(1, min(10, n))
            obj["texto"] = f"Gana la carrera de {obj['cantidad']} vuelta{'s' if obj['cantidad'] != 1 else ''}"
        elif any(w in ps for ps in FORMAS_OBJETO.values()) and obj["tipo"] == "recolectar" and d["objetos"]:
            obj["cantidad"] = max(1, min(80, n))
            d["objetos"][0]["cantidad"] = obj["cantidad"]
            obj["texto"] = f"Recoge {obj['cantidad']} {_plural(d['objetos'][0]['forma'])}"
        elif (w.startswith(("rival", "enemigo", "oponente")) or any(w in ps for ps in FORMAS_ENEMIGO.values())) and d["enemigos"]:
            d["enemigos"][0]["cantidad"] = max(1, min(20, n))
            if obj["tipo"] == "derrotar":
                obj["cantidad"] = max(1, min(200, n))
                obj["texto"] = f"Derrota a {obj['cantidad']} enemigos"
    if obj["tipo"] == "recolectar" and d["objetos"] and not re.search(r"\d", obj["texto"] or ""):
        obj["texto"] = f"Recoge {obj['cantidad']} {_plural(d['objetos'][0]['forma'])}"
    elif obj["tipo"] == "recolectar" and d["objetos"] and fo:
        obj["texto"] = f"Recoge {obj['cantidad']} {_plural(fo)}"
    return d


def plan_local(idea, estilo=None, genero=None, perfil=None):
    """Diseño armado con reglas (sin IA): sirve de base y de respaldo."""
    det = I.detectar(idea or "")
    perfil = perfil or {"nivel": "medio", "recomendado": "lowpoly"}
    genero = genero if genero in GENEROS else det.get("genero") if det.get("genero") in GENEROS else "aventura"
    tema = det.get("tema") if det.get("tema") in TEMAS else {"carreras": "ciudad", "disparos": "espacio", "supervivencia": "zombies",
                                                              "terror": "terror", "construccion": "bosque", "deportes": "deportes",
                                                              "rpg": "medieval"}.get(genero, "bosque")
    estilo = estilo if estilo in ESTILOS else det.get("estilo") if det.get("estilo") in ESTILOS else perfil.get("recomendado", "lowpoly")
    if genero == "construccion" and not (estilo in ESTILOS and estilo == (det.get("estilo") or estilo)):
        estilo = "voxel"
    t, g = TEMAS[tema], GENEROS[genero]
    obj_tipo = g["objetivo"]
    cant = {"recolectar": 12, "derrotar": 10, "sobrevivir": 180, "llegar": 1, "carrera": 3, "construir": 30}[obj_tipo]
    textos = {"recolectar": f"Recoge {cant} {_plural(t['objeto'][0])}", "derrotar": f"Derrota a {cant} enemigos",
              "sobrevivir": f"Sobrevive {cant // 60} minutos", "llegar": "Llega a la meta", "carrera": f"Gana la carrera de {cant} vueltas",
              "construir": f"Coloca {cant} bloques para construir tu refugio"}
    motor = ESTILOS[estilo]["motor"]
    camara = "lateral" if motor == "2d" and genero in ("plataformas", "aventura", "carreras", "deportes") else \
        "superior" if motor == "2d" else ("primera" if motor == "voxel" else g["camara"])
    return _leer_idea({
        "titulo": _nombre_de(idea).replace("_", " "), "idea": (idea or "").strip()[:1500],
        "descripcion": (idea or "").strip()[:220], "genero": genero, "estilo": estilo, "motor": motor, "camara": camara, "tema": tema,
        "ambiente": {"cielo": t["cielo"], "horizonte": t["horizonte"], "suelo": t["suelo"], "agua": t["agua"],
                     "hora": "noche" if t.get("noche") else "dia", "niebla": t.get("niebla", 0.012), "clima": "despejado"},
        "mundo": {"tamano": 160 if motor != "2d" else 120, "relieve": 0.15 if t.get("plano") else 0.85 if t.get("montanoso") else 0.45,
                  "semilla": int(time.time()) % 100000, "isla": bool(t.get("isla"))},
        "jugador": {"nombre": "Jugador", "modelo": "jugador", "color": "#3fa9f5", "velocidad": 7 if genero != "carreras" else 26,
                    "salto": 8, "vida": 100, "arma": g["arma"]},
        "objetivo": {"tipo": obj_tipo, "cantidad": cant, "tiempo": 0, "texto": textos[obj_tipo]},
        "enemigos": [] if genero in ("puzle", "exploracion") else [{
            "nombre": t["enemigo"][0].capitalize(), "modelo": "enemigo", "forma": t["enemigo"][0], "color": t["enemigo"][1],
            "cantidad": 8 if genero != "carreras" else 4, "velocidad": 3.2 if genero != "carreras" else 22, "danio": 12, "vida": 30,
            "comportamiento": g["comportamiento"]}],
        "objetos": [{"nombre": t["objeto"][0].capitalize(), "modelo": "coleccionable", "forma": t["objeto"][0], "color": t["objeto"][1],
                     "cantidad": cant if obj_tipo == "recolectar" else 10, "valor": 10, "efecto": "vida" if t["objeto"][0] == "botiquin" else "puntos"}],
        "decoracion": [_deco(d, n) for d, n in t["decoracion"]],
        "activos": dict(t.get("buscar") or {}), "textura_suelo": t.get("suelo_tex", "grass"),
        "musica": True, "controles": {},
    }, idea)


SCHEMA_IA = """Responde SOLO con un objeto JSON (sin texto antes ni después) con esta forma:
{"titulo": "nombre corto y atractivo del juego",
 "descripcion": "1-2 frases que se muestran en la pantalla de inicio",
 "genero": "aventura|plataformas|carreras|disparos|supervivencia|construccion|puzle|rpg|terror|deportes|exploracion",
 "estilo": "realista|lowpoly|voxel|pixel2d",
 "tema": "bosque|medieval|espacio|zombies|desierto|nieve|oceano|ciudad|fantasia|terror|futurista|dinosaurios|andes|granja|militar",
 "objetivo": {"tipo": "recolectar|llegar|sobrevivir|derrotar|carrera|construir", "cantidad": 10, "texto": "misión que ve el jugador"},
 "jugador": {"nombre": "…", "velocidad": 7, "salto": 8, "vida": 100, "arma": "espada|disparo|saltar|ninguna"},
 "enemigos": [{"nombre": "…", "forma": "lobo|esqueleto|zombie|slime|robot|fantasma|dinosaurio|escorpion|cangrejo|condor|zorro|alien|oso|bruja|demonio|soldado", "cantidad": 8,
               "velocidad": 3, "danio": 12, "vida": 30, "comportamiento": "perseguir|patrullar|rival", "color": "#rrggbb"}],
 "objetos": [{"nombre": "…", "forma": "gema|moneda|estrella|cristal|fruta|llave|huevo|botiquin|cofre|calabaza", "cantidad": 10, "valor": 10,
              "efecto": "puntos|vida|velocidad", "color": "#rrggbb"}],
 "decoracion": [{"tipo": "arbol|pino|palmera|roca|cactus|casa|torre|edificio|cristal|hongo|farola|caja|lapida|arbusto|piramide", "cantidad": 40}],
 "ambiente": {"hora": "dia|atardecer|noche", "clima": "despejado|niebla|lluvia|nieve"},
 "mundo": {"tamano": 160, "relieve": 0.5},
 "activos": {"jugador": "búsqueda EN INGLÉS de 1-3 palabras para el modelo 3D", "enemigo": "…", "coleccionable": "…", "arbol": "…"},
 "reglas_extra": ["mecánicas especiales que la idea pide y que habrá que programar (en español, concretas)"]}
Reglas: respeta TODO lo que pide la idea; si la idea no dice algo, elige lo más divertido para un principiante. El estilo por defecto es «realista» (mundo realista) salvo que la idea pida otro o la PC no aguante.
Cantidades razonables (enemigos ≤ 20, objetos ≤ 40, decoración ≤ 120 por tipo). No inventes estilos, géneros ni formas fuera de las listas."""


def normalizar(d, base):
    """Mezcla lo que devolvió la IA con la base local y valida tipos/rangos (una IA pequeña puede equivocarse)."""
    out = json.loads(json.dumps(base))
    d = d if isinstance(d, dict) else {}
    for k in ("titulo", "descripcion"):
        if isinstance(d.get(k), str) and d[k].strip():
            out[k] = d[k].strip()[:120 if k == "titulo" else 300]
    if d.get("genero") in GENEROS:
        out["genero"] = d["genero"]
    if d.get("estilo") in ESTILOS and not base.get("_estilo_fijo"):
        out["estilo"] = d["estilo"]
    if d.get("tema") in TEMAS and d.get("tema") != out["tema"]:
        t = TEMAS[d["tema"]]
        out["tema"] = d["tema"]
        out["ambiente"].update(cielo=t["cielo"], horizonte=t["horizonte"], suelo=t["suelo"], agua=t["agua"],
                               hora="noche" if t.get("noche") else "dia", niebla=t.get("niebla", 0.012))
        out["decoracion"] = [_deco(x, n) for x, n in t["decoracion"]]
        out["activos"] = dict(t.get("buscar") or {})
        out["textura_suelo"] = t.get("suelo_tex", "grass")
        out["mundo"]["relieve"] = 0.15 if t.get("plano") else 0.85 if t.get("montanoso") else out["mundo"]["relieve"]
    o = d.get("objetivo") or {}
    if o.get("tipo") in ("recolectar", "llegar", "sobrevivir", "derrotar", "carrera", "construir", "campana"):
        out["objetivo"]["tipo"] = o["tipo"]
    for k, lo, hi in (("cantidad", 1, 600),):
        try:
            out["objetivo"][k] = int(max(lo, min(hi, float(o.get(k, out["objetivo"][k])))))
        except (TypeError, ValueError):
            pass
    if isinstance(o.get("texto"), str) and o["texto"].strip():
        out["objetivo"]["texto"] = o["texto"].strip()[:140]
    jg = d.get("jugador") or {}
    for k, lo, hi in (("velocidad", 2, 60), ("salto", 3, 20), ("vida", 10, 1000)):
        try:
            out["jugador"][k] = max(lo, min(hi, float(jg.get(k, out["jugador"][k]))))
        except (TypeError, ValueError):
            pass
    if isinstance(jg.get("nombre"), str) and jg["nombre"].strip():
        out["jugador"]["nombre"] = jg["nombre"].strip()[:40]
    if jg.get("arma") in ("espada", "disparo", "saltar", "ninguna"):
        out["jugador"]["arma"] = jg["arma"]

    def _lista(v, defecto, campos, maxn):
        if not isinstance(v, list):
            return defecto
        res = []
        for i, x in enumerate(v[:4]):
            if not isinstance(x, dict):
                continue
            e = dict(defecto[min(i, len(defecto) - 1)]) if defecto else {}
            for c, (tipo, lo, hi) in campos.items():
                if c in x:
                    try:
                        e[c] = tipo(max(lo, min(hi, float(x[c])))) if tipo in (int, float) else str(x[c])[:40]
                    except (TypeError, ValueError):
                        pass
            if x.get("color"):
                e["color"] = _norm_color(x["color"], e.get("color", "#cccccc"))
            e["modelo"] = e.get("modelo") or ("enemigo" if i == 0 else f"enemigo{i + 1}")
            res.append(e)
        return res or defecto
    ecampos = {"nombre": (str, 0, 0), "forma": (str, 0, 0), "cantidad": (int, 0, 40), "velocidad": (float, 0.5, 60),
               "danio": (int, 0, 100), "vida": (int, 1, 1000), "comportamiento": (str, 0, 0)}
    if out["genero"] in ("puzle", "exploracion") and not d.get("enemigos"):
        out["enemigos"] = []
    else:
        out["enemigos"] = _lista(d.get("enemigos"), out["enemigos"] or [{"nombre": "Enemigo", "modelo": "enemigo", "forma": "slime",
                                                                          "color": "#8a5aff", "cantidad": 8, "velocidad": 3, "danio": 10,
                                                                          "vida": 30, "comportamiento": "perseguir"}], ecampos, 40)
        for i, e in enumerate(out["enemigos"]):
            e["modelo"] = "enemigo" if i == 0 else f"enemigo{i + 1}"
            if e.get("comportamiento") not in ("perseguir", "patrullar", "rival"):
                e["comportamiento"] = "perseguir"
    out["objetos"] = _lista(d.get("objetos"), out["objetos"], {"nombre": (str, 0, 0), "forma": (str, 0, 0), "cantidad": (int, 0, 80),
                                                                  "valor": (int, 0, 1000), "efecto": (str, 0, 0)}, 80)
    for i, e in enumerate(out["objetos"]):
        e["modelo"] = "coleccionable" if i == 0 else f"coleccionable{i + 1}"
        if e.get("efecto") not in ("puntos", "vida", "velocidad"):
            e["efecto"] = "puntos"
    if isinstance(d.get("decoracion"), list) and d["decoracion"]:
        dec = []
        for x in d["decoracion"][:MAX_DECORACION]:
            if isinstance(x, dict) and x.get("tipo"):
                tipo = re.sub(r"[^a-z_]", "", I.normalizar(str(x["tipo"])))[:24]
                if not tipo:
                    continue
                try:
                    n = int(max(0, min(160, float(x.get("cantidad", 30)))))
                except (TypeError, ValueError):
                    n = 30
                e = {"tipo": tipo, "modelo": tipo, "cantidad": n}
                if re.fullmatch(r"[a-z][a-z0-9_]{0,30}", str(x.get("modelo") or "")):
                    e["modelo"] = x["modelo"]
                try:
                    if x.get("altura") is not None and 0.1 <= float(x["altura"]) <= 60:
                        e["altura"] = round(float(x["altura"]), 2)
                except (TypeError, ValueError):
                    pass
                dec.append(e)
        out["decoracion"] = dec or out["decoracion"]
    amb = d.get("ambiente") or {}
    if amb.get("hora") in ("dia", "atardecer", "noche"):
        out["ambiente"]["hora"] = amb["hora"]
    if amb.get("clima") in ("despejado", "niebla", "lluvia", "nieve"):
        out["ambiente"]["clima"] = amb["clima"]
    mu = d.get("mundo") or {}
    for k, lo, hi in (("tamano", 60, 400), ("relieve", 0, 1)):
        try:
            out["mundo"][k] = max(lo, min(hi, float(mu.get(k, out["mundo"][k]))))
        except (TypeError, ValueError):
            pass
    if isinstance(d.get("activos"), dict):
        for k, v in d["activos"].items():
            if isinstance(v, str) and v.strip() and re.fullmatch(r"[a-z0-9]+", k):
                out["activos"][k] = v.strip()[:40]
    if isinstance(d.get("reglas_extra"), list):
        out["reglas_extra"] = [str(x)[:200] for x in d["reglas_extra"][:8] if str(x).strip()]
    out["motor"] = ESTILOS[out["estilo"]]["motor"]
    if out["motor"] == "2d" and out["camara"] not in ("lateral", "superior"):
        out["camara"] = "lateral" if out["genero"] in ("plataformas", "aventura", "carreras", "deportes") else "superior"
    elif out["motor"] != "2d" and out["camara"] in ("lateral", "superior"):
        out["camara"] = "primera" if out["motor"] == "voxel" else "tercera"
    if out["genero"] == "carreras":
        out["objetivo"]["tipo"] = "carrera"
        out["objetivo"]["cantidad"] = int(min(10, max(1, out["objetivo"]["cantidad"])))
        for e in out["enemigos"]:
            e["comportamiento"] = "rival"
    return out


def planificar(idea, estilo=None, genero=None, usar_ia=True, perfil=None, epico=True):
    """{"diseno": GDD, "modelo": ia usada, "ms", "aviso", "director": {puntaje, completado…}}. epico=False: solo el diseño básico."""
    perfil = perfil or perfil_grafico()
    base = plan_local(idea, estilo, genero, perfil)
    if estilo in ESTILOS:
        base["_estilo_fijo"] = True
    res = {"diseno": base, "modelo": "", "ms": 0, "aviso": "", "perfil": perfil}
    if usar_ia:
        from . import rapida
        pista = (f"\nPC del jugador: nivel {perfil['nivel']} ({perfil['motivo']}); estilo recomendado: {perfil['recomendado']}."
                 + (f" El usuario eligió el estilo «{estilo}»." if estilo in ESTILOS else "")
                 + (f" El usuario eligió el género «{genero}»." if genero in GENEROS else ""))
        try:
            txt, m, ms = rapida.responder("Eres un diseñador de videojuegos para principiantes. Conviertes una idea en el diseño "
                                          "concreto de un juego pequeño, divertido y que se pueda terminar.\n" + SCHEMA_IA,
                                          f"IDEA DEL JUEGO:\n{idea}{pista}", max_tokens=2500, limite_seg=60)
            d = rapida.json_de(txt)
            if not d:
                raise RuntimeError("la IA no devolvió un JSON válido")
            res.update(diseno=normalizar(d, base), modelo=m, ms=ms)
        except Exception as e:
            res["aviso"] = f"Diseño hecho sin IA ({str(e)[:160]}). Puedes ajustarlo y la IA del chat lo completará."
    res["diseno"].pop("_estilo_fijo", None)
    d = res["diseno"]
    # si la tarjeta no aguanta el estilo que eligió la IA (y el usuario no pidió uno), se usa el recomendado para su PC:
    # en PCs sin gráficos potentes eso es vóxel HD (estilo Minecraft pixelado de alta calidad) o 2D pixel art
    if estilo not in ESTILOS and not I.detectar(idea).get("estilo") and not perfil["estilos"].get(d["estilo"], {}).get("ok", True):
        antes = d["estilo"]
        rec = perfil["recomendado"]
        d.update(estilo=rec, motor=ESTILOS[rec]["motor"])
        if d["motor"] == "2d":
            d["camara"] = "lateral" if d["genero"] in ("plataformas", "aventura", "carreras", "deportes") else "superior"
        elif d["camara"] in ("lateral", "superior"):
            d["camara"] = "primera" if d["motor"] == "voxel" else "tercera"
        res["aviso"] = (res["aviso"] + " " if res["aviso"] else "") + (
            f"Tu PC es nivel «{perfil['nivel']}»: cambié el estilo «{antes}» por «{rec}» ({ESTILOS[rec]['nombre']}) para que vaya fluido. "
            "Si igual quieres el otro, elígelo arriba.")
    d["calidad"] = dict(perfil["calidad"])
    # 🎬 director creativo: de la idea simple a un juego épico (travesía, historia, trajes, armas, jefe, obstáculos…)
    if epico:
        from . import director_juegos as DJ
        try:
            d2, inf = DJ.dirigir(d, idea, perfil, usar_ia=usar_ia)
            res["diseno"] = d = d2
            res["director"] = {k: inf.get(k) for k in ("puntaje", "completado", "modelo", "ms", "seg")}
            if inf.get("aviso"):
                res["aviso"] = (res["aviso"] + " " if res["aviso"] else "") + inf["aviso"]
        except Exception as e:  # nunca deja al usuario sin diseño
            import traceback
            traceback.print_exc()
            res["aviso"] = (res["aviso"] + " " if res["aviso"] else "") + f"(El director creativo falló: {str(e)[:120]}; queda el diseño básico.)"
    _con_biblioteca(d, res)
    return res


def _con_biblioteca(d, res):
    """📁 Tu carpeta 3D: modelos para cada rol del juego + decoración extra que encaje con la temática."""
    if d.get("motor") != "3d":
        return
    try:
        from . import biblioteca3d as B
        s = B.sugerir(d)
    except Exception as e:
        res["aviso"] = (res.get("aviso", "") + f" (No pude leer tu carpeta 3D: {str(e)[:120]})").strip()
        return
    if not s["asignados"]:
        return
    tipos = {x.get("tipo") for x in d.get("decoracion") or []}
    for x in s["extras"]:
        if x["tipo"] not in tipos and len(d["decoracion"]) < MAX_DECORACION:
            d["decoracion"].append(x)
            tipos.add(x["tipo"])
    d.setdefault("activos", {})
    for rol, q in s["consultas"].items():
        d["activos"].setdefault(rol, q)  # así el Estudio muestra una fila (con tus modelos primero) para cada rol
    d["locales"] = {rol: lst[0]["id"] for rol, lst in s["asignados"].items()}
    res["biblioteca"] = {"roles": sorted(d["locales"]), "extras": [x["tipo"] for x in s["extras"]]}


# ───────────── 3. Crear el proyecto ─────────────
TRABAJOS = {}  # id → {"estado", "log", "resultado"}


def _copiar(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def config_js(d):
    limpio = {k: v for k, v in d.items() if not k.startswith("_") and k not in ("idea",)}
    return ("/* 🎮 Diseño del juego (lo generó el Estudio de juegos de Noviq a partir de tu idea).\n"
            "   Puedes cambiar números, colores y textos aquí: el motor los lee al iniciar. */\n"
            f"window.JUEGO = {json.dumps(limpio, ensure_ascii=False, indent=2)};\n")


SERVIDOR_PY = '''# Servidor local mínimo para jugar (lo usa jugar.bat). Uso: python servidor.py
import http.server, socketserver, webbrowser, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".glb": "model/gltf-binary"}
    def log_message(self, *a): pass
for p in range(PUERTO, PUERTO + 20):
    try:
        with socketserver.TCPServer(("127.0.0.1", p), H) as s:
            print(f"Juego en http://127.0.0.1:{p}  (cierra esta ventana para terminar)")
            webbrowser.open(f"http://127.0.0.1:{p}/index.html")
            s.serve_forever()
    except OSError:
        continue
'''

SERVIDOR_PS1 = r'''# Servidor local mínimo en PowerShell (si no tienes Python). Lo usa jugar.bat.
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$puerto = 8765
$l = New-Object System.Net.HttpListener
while ($true) { try { $l.Prefixes.Clear(); $l.Prefixes.Add("http://127.0.0.1:$puerto/"); $l.Start(); break } catch { $puerto++ } }
Write-Host "Juego en http://127.0.0.1:$puerto  (cierra esta ventana para terminar)"
Start-Process "http://127.0.0.1:$puerto/index.html"
$tipos = @{".html"="text/html; charset=utf-8";".js"="text/javascript; charset=utf-8";".css"="text/css";".json"="application/json";
  ".png"="image/png";".jpg"="image/jpeg";".jpeg"="image/jpeg";".glb"="model/gltf-binary";".wav"="audio/wav";".mp3"="audio/mpeg";".ogg"="audio/ogg"}
while ($l.IsListening) {
  $c = $l.GetContext(); $ruta = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if ($ruta -eq '') { $ruta = 'index.html' }
  $f = Join-Path $raiz $ruta
  if ((Test-Path $f -PathType Leaf) -and ((Resolve-Path $f).Path.StartsWith($raiz))) {
    $b = [IO.File]::ReadAllBytes($f); $e = [IO.Path]::GetExtension($f).ToLower()
    if ($tipos.ContainsKey($e)) { $c.Response.ContentType = $tipos[$e] }
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
'''

JUGAR_BAT = '''@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Jugar
rem Python del sistema si existe (se prueba de verdad: el acceso directo de la Microsoft Store no cuenta)
py -c "import sys" >nul 2>nul && (py servidor.py & goto :eof)
python -c "import sys" >nul 2>nul && (python servidor.py & goto :eof)
rem sin Python: mini servidor de PowerShell (viene con Windows)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
'''


def _readme(d, perfil):
    obj = d["objetivo"]
    return f"""# {d['titulo']}

{d.get('descripcion', '')}

Creado con el **🎮 Estudio de juegos de Noviq** · estilo **{ESTILOS[d['estilo']]['nombre']}** · género **{GENEROS[d['genero']]['nombre']}**
· tema **{d['tema']}** · calidad para tu PC: **{perfil.get('nivel', '?')}**.

## Cómo jugar
- **Doble clic en `jugar.bat`** (abre el juego en tu navegador con un mini servidor local). También puedes abrir `index.html`.
- Objetivo: **{obj.get('texto', '')}**
- Controles: WASD o flechas para moverte · Espacio para saltar · Shift para correr · clic o E para la acción ·
  Esc o P para pausa · M para la música · F3 para ver los FPS.

## Archivos
| Archivo | Qué es |
|---|---|
| `juego.config.js` | **El diseño**: títulos, colores, cantidades, velocidades… Cámbialo sin miedo. |
| `juego.js` | **Las reglas propias** de tu juego (ganchos: al iniciar, al recoger, al ganar…). Aquí se programan las mecánicas nuevas. |
| `motor*.js`, `comun.js` | El motor del Estudio (probado y optimizado). No hace falta tocarlo. |
| `assets/` | Modelos 3D, texturas y créditos descargados (`activos.js`). |
| `CREDITOS.md` | Autores y licencias de los recursos gratuitos usados. |

## Rendimiento
El juego mide los FPS y, si tu PC va justa, baja la resolución y las sombras solo. Todo lo pesado se crea una vez y se
reutiliza (sin fugas de memoria).
"""


def _instrucciones(d):
    return (f"Juego creado con el 🎮 Estudio de juegos de Noviq (motor {d['motor']}, estilo {d['estilo']}). REGLAS: NO reescribas "
            "motor*.js ni comun.js (motor probado y optimizado). Cambia los datos en juego.config.js (window.JUEGO) y programa las "
            "mecánicas propias en juego.js usando los ganchos de window.REGLAS (alIniciar, alActualizar, alRecoger, alDerrotar, "
            "alDanio, alGanar, alPerder) y la API window.J (ver comentarios de juego.js). Modelos: assets/activos.js "
            "(ACTIVOS.modelos[rol]); nuevos con buscar_activos_3d + descargar_activo o nvidia_ia modelo_3d/textura. PRUEBA con "
            "probar_web (ruta 'index.html?prueba=1', acciones de teclado) y lee el estado con evaluar_js 'estadoJuego()'. "
            "Nunca crees geometrías/materiales dentro del bucle.")


def crear(diseno, nombre=None, activos=None, buscar_auto=True, emit=None, perfil=None, sin_modelo=None, usar_carpeta=True):
    """Crea el proyecto del juego. activos: [{"fuente","id","tipo","rol",...}] ya elegidos en la galería.
    usar_carpeta: los roles sin elegir se llenan con los modelos de TU carpeta 3D que encajan (sin_modelo = roles que el
    usuario quiere con las formas del motor). buscar_auto: lo que falte se busca y descarga de las galerías de internet."""
    from . import activos as A
    from . import tools as T
    from .config import project_path
    log = (lambda t: emit(t)) if emit else (lambda t: None)
    perfil = perfil or perfil_grafico()
    d = normalizar(diseno, plan_local(diseno.get("idea") or diseno.get("descripcion") or "", diseno.get("estilo"),
                                      diseno.get("genero"), perfil))
    d["calidad"] = dict(CALIDAD.get((diseno.get("calidad") or {}).get("nivel") or perfil["nivel"], CALIDAD["medio"]))
    _campana_de(diseno, d, perfil, log)
    nombre = T.safe_name(nombre or d["titulo"].replace(" ", "_"))
    base, n = nombre, 2
    while project_path(nombre).exists():
        nombre, n = f"{base}_{n}", n + 1
    p, plog = T.create_project(nombre, "juego", d.get("descripcion", ""), _instrucciones(d))
    log(f"🗂 Proyecto creado: {p}")
    motor = d["motor"]
    for f in (PLANTILLAS / "lib").iterdir():
        if f.is_file() and (motor != "2d" or f.name == "THREE_LICENSE.txt"):
            _copiar(f, p / "lib" / f.name)
    for f in (PLANTILLAS / "comun").iterdir():
        if f.is_file():
            _copiar(f, p / f.name)
    for f in (PLANTILLAS / motor).iterdir():
        if f.is_file():
            _copiar(f, p / f.name)
    (p / "servidor.py").write_text(SERVIDOR_PY, encoding="utf-8")
    (p / "servidor.ps1").write_text(SERVIDOR_PS1, encoding="utf-8-sig")
    (p / "jugar.bat").write_text(JUGAR_BAT.replace("\n", "\r\n"), encoding="utf-8", newline="")  # CRLF exacto también en Windows
    A.escribir(p, A.manifiesto(p))  # activos.js vacío (el juego arranca aunque no haya modelos)
    log(f"🧩 Motor «{motor}» instalado ({ESTILOS[d['estilo']]['nombre']}) con calidad «{d['calidad']['nivel']}».")
    descargados, errores = [], []
    elegidos = [dict(x, _explicito=True) for x in (activos or []) if isinstance(x, dict)] if motor == "3d" else []  # vóxel y 2D no usan modelos
    sin_modelo = {str(x) for x in (sin_modelo or [])}
    if motor == "3d" and usar_carpeta:
        elegidos = _usar_carpeta(d, elegidos, sin_modelo, log)
        # personajes que se mueven: los de tu carpeta que NO traen animaciones se reemplazan por figuras propias animadas
        antes = len(elegidos)
        con_trajes = bool((d.get("campana") or {}).get("trajes"))  # los trajes del director se crean a medida (mismo estilo)
        elegidos = [x for x in elegidos if x.get("_explicito") or not _rol_personaje(x.get("rol")) or (_animado(x) and not (con_trajes and x.get("rol") == "jugador"))]
        if len(elegidos) < antes:
            log(f"🧍 {antes - len(elegidos)} personaje(s) de tu carpeta no tienen animaciones: Noviq crea los suyos, totalmente animados.")
    if buscar_auto and motor == "3d":
        cubiertos = {x.get("rol") for x in elegidos} | sin_modelo
        roles = [(r, q) for r, q in (d.get("activos") or {}).items() if r not in cubiertos and not _rol_personaje(r) and
                 (re.match(r"(coleccionable)", r) or r in (TEMAS.get(d["tema"], {}).get("buscar") or {}))]
        # en la PC básica se bajan pocos modelos (el motor dibuja bien sin ellos)
        max_roles = 2 if perfil["nivel"] == "basico" else 5
        n_online = 0
        for rol, q in roles[:8]:
            if n_online >= max_roles:
                break
            try:
                r = A.buscar(q, "modelo", estilo=d["estilo"], nivel=perfil["nivel"], limite=4,
                             fuentes=["polyhaven", "polypizza", "sketchfab"] if d["estilo"] == "realista" else ["polypizza", "sketchfab", "polyhaven"])
                cand = [x for x in r["resultados"] if x["fuente"] in ("polyhaven", "polypizza") or
                        (x["fuente"] == "sketchfab" and A._clave("sketchfab"))]
                if rol in ("jugador", "enemigo") and not any(x["fuente"] != "polyhaven" for x in cand):
                    cand = []  # Poly Haven casi no tiene personajes: mejor el personaje del motor que una estatua
                if cand:
                    cand[0]["rol"] = rol
                    elegidos.append(cand[0])
                    n_online += 1
            except Exception as e:
                errores.append(f"{rol}: {str(e)[:100]}")
    for it in elegidos[:40]:
        rol = it.get("rol") or ""
        try:
            if it.get("fuente") == "local":
                log(f"📁 Copiando «{it.get('nombre')}» de tu carpeta 3D ({it.get('paquete') or 'local'}) para «{rol or 'modelo'}»…")
            else:
                log(f"⬇ Descargando {it.get('nombre')} ({it.get('fuente')}, {it.get('licencia')}) para «{rol or it.get('tipo')}»…")
            ent = A.descargar(it, p, rol=rol or None)
            descargados.append(ent)
        except Exception as e:
            errores.append(f"{it.get('nombre')}: {str(e)[:140]}")
            log(f"⚠ No se pudo usar {it.get('nombre')}: {str(e)[:140]}")
    if descargados:
        n_loc = sum(1 for x in descargados if x.get("fuente") == "local")
        log(f"🧱 {len(descargados)} modelo(s) listos ({n_loc} de tu carpeta 3D), con sus créditos en CREDITOS.md.")
    # 🧍 figuras 3D propias (animadas) para todo lo que falte: trajes, enemigos, jefe, guías, armas, objetos y decoración
    if motor in ("3d", "voxel"):  # vóxel: las mismas figuras pero en estilo BLOQUES (pixel art 3D), también animadas
        try:
            creados = _figuras(d, p, {x.get("rol") for x in descargados if x.get("tipo") == "modelo"}, sin_modelo, perfil, log)
            descargados += creados
        except Exception as e:
            import traceback
            traceback.print_exc()
            errores.append(f"figuras 3D: {str(e)[:160]}")
            log(f"⚠ No se pudieron crear las figuras 3D: {str(e)[:160]} (el motor dibuja formas propias)")
    try:
        _iconos_2d(d, p, log)
    except Exception as e:
        log(f"⚠ Iconos 2D: {str(e)[:140]}")
    _zonas_mundo(d, {x.get("rol") for x in descargados if x.get("tipo") == "modelo"})
    # decoración que el motor no sabe dibujar y que se quedó sin modelo → fuera (si no, saldrían rocas)
    con_modelo = {x.get("rol") for x in descargados if x.get("tipo") == "modelo"}
    d["decoracion"] = [x for x in d.get("decoracion") or [] if x.get("modelo") in con_modelo or x.get("tipo") in DECO_MOTOR]
    d.pop("locales", None)
    (p / "juego.config.js").write_text(config_js(d), encoding="utf-8")
    (p / "README.md").write_text(_readme(d, perfil), encoding="utf-8")
    (p / "diseno.json").write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
    mensaje = _mensaje_ia(d, p, descargados, errores)
    return {"ok": True, "proyecto": p.name, "ruta": str(p), "index": str(p / "index.html"), "diseno": d, "activos": descargados,
            "errores": errores, "mensaje_ia": mensaje, "log": plog}


ROLES_PERSONAJE = re.compile(r"^(jugador(_\d+)?|enemigo\d*|jefe|npc(_\d+)?)$")


def _rol_personaje(rol):
    return bool(ROLES_PERSONAJE.match(str(rol or "")))


def _animado(item):
    if item.get("fuente") != "local":
        return bool(item.get("animado"))
    try:
        from . import biblioteca3d as B
        m = B.por_id(item.get("id") or "") or {}
        return len(m.get("animaciones") or []) >= 2
    except Exception:
        return False


def _campana_de(diseno, d, perfil, log):
    """La campaña del diseño (la del 🎬 director, validada). Si no viene (p. ej. desde el chat), el director arma una."""
    from . import director_juegos as DJ
    idea = diseno.get("idea") or d.get("idea") or d.get("descripcion") or ""
    c = diseno.get("campana")
    try:
        if isinstance(c, dict) and isinstance(c.get("zonas"), list) and c["zonas"]:
            borrador = DJ.expandir(json.loads(json.dumps(d)), idea, perfil)["campana"]
            d["campana"] = DJ.normalizar_campana(c, borrador, d)
            if isinstance(c.get("calidad"), dict):
                d["campana"]["calidad"] = c["calidad"]
            if (diseno.get("objetivo") or {}).get("tipo") == "campana":
                d["objetivo"] = dict(diseno["objetivo"])
            d, ev, hecho = DJ.completar(d, idea, perfil)
            if hecho:
                log(f"🎬 El director completó: {', '.join(hecho)} (calidad {ev['puntaje']}/100).")
        elif d.get("motor") in ("3d", "voxel", "2d") and diseno.get("epico", True) is not False:
            d2, inf = DJ.dirigir(d, idea, perfil, usar_ia=False)
            d.update(d2)
            log(f"🎬 Director creativo: travesía de {len(d['campana']['zonas'])} zonas, calidad {inf['puntaje']}/100.")
    except Exception as e:
        import traceback
        traceback.print_exc()
        log(f"⚠ Director creativo: {str(e)[:160]} (se juega el diseño básico)")
        d.pop("campana", None)


def _zonas_mundo(d, con_modelo):
    """Colores (cielo, suelo, niebla) y decoración de cada zona según su bioma."""
    c = d.get("campana")
    if not c:
        return
    extras = [x for x in d.get("decoracion") or [] if x.get("tipo") not in DECO_MOTOR or x.get("modelo") in con_modelo]
    for z in c.get("zonas") or []:
        t = TEMAS.get(z.get("tema")) or TEMAS.get(d.get("tema")) or TEMAS["bosque"]
        z["paleta"] = {"cielo": t["cielo"], "horizonte": t["horizonte"], "suelo": t["suelo"], "agua": t["agua"], "niebla": t.get("niebla", 0.012)}
        deco = [_deco(x, n) for x, n in t["decoracion"] if x in DECO_MOTOR or x in con_modelo]
        if z.get("tema") == d.get("tema"):
            tipos = {x["tipo"] for x in deco}
            deco += [dict(x) for x in extras if x.get("tipo") not in tipos]
        z["decoracion"] = deco[:MAX_DECORACION]


DECO_FIGURA = {"arbol": "arbol", "pino": "pino", "arbusto": "arbusto", "roca": "roca", "lapida": "lapida", "barril": "barril", "caja": "caja"}


def _figuras(d, p, cubiertos, sin_modelo, perfil, log):
    """Crea (o reutiliza de la carpeta 3D) las figuras que el juego necesita y no tiene modelo: todas ANIMADAS."""
    from . import activos as A
    from . import figuras3d as F
    c = d.get("campana") or {}
    tema, gen = d.get("tema"), d.get("genero")
    nivel = (d.get("calidad") or {}).get("nivel") or perfil.get("nivel") or "medio"
    detalle = {"basico": 0.6, "medio": 0.85, "alto": 1.0, "ultra": 1.25}.get(nivel, 1.0)
    pedidos = []  # (rol, plantilla, cambios, icono)
    voxel = d.get("motor") == "voxel"
    if gen != "carreras":
        trajes = c.get("trajes") or [{"id": "t1", "modelo": "jugador", "plantilla": F.para_rol("jugador", d.get("idea") or "", tema, gen)["id"]}]
        vistos = set()
        for t in trajes:
            pl = t.get("plantilla") if t.get("plantilla") in F.POR_ID else F.para_rol("jugador", "", tema, gen)["id"]
            cambios = {"_general": t["color"]} if pl in vistos and t.get("color") else {}
            vistos.add(pl)
            pedidos.append((t.get("modelo") or "jugador", pl, cambios, f"traje_{t.get('id', 't1')}"))
        for i, e in enumerate(d.get("enemigos") or []):
            if e.get("comportamiento") == "rival":
                continue
            pl = F.para_rol("enemigo", e.get("nombre") or "", tema, gen, forma=e.get("forma"))
            pedidos.append((e.get("modelo") or ("enemigo" if i == 0 else f"enemigo{i + 1}"), pl["id"], {}, None))
        if c.get("jefe"):
            pedidos.append(("jefe", c["jefe"]["plantilla"], dict(c["jefe"].get("cambios") or {}), "jefe"))
        roles_npc = {}
        for z in c.get("zonas") or []:
            if z.get("npc"):
                pl = z["npc"].get("plantilla") if z["npc"].get("plantilla") in F.POR_ID else "aldeano"
                if pl not in roles_npc:
                    roles_npc[pl] = "npc" if not roles_npc else f"npc_{len(roles_npc) + 1}"
                z["npc"]["modelo"] = roles_npc[pl]
        pl_trajes = {t.get("plantilla") for t in trajes}
        for pl, rol in roles_npc.items():  # el guía no puede ser igual a un traje del jugador
            pedidos.append((rol, pl, {"_general": "#7a4a8a", "pelo": "#e8e8e8"} if pl in pl_trajes else {}, f"npc_{rol}"))
        for a in c.get("armas") or []:
            if a.get("plantilla") in F.POR_ID:
                pedidos.append((a.get("modelo") or f"arma_{a['id']}", a["plantilla"], {}, f"arma_{a['id']}"))
        pedidos.append(("fogata", "fogata", {}, None))
    for i, o in enumerate(d.get("objetos") or []):
        if voxel:
            break
        pl = F.para_rol("coleccionable", o.get("nombre") or "", tema, gen, forma=o.get("forma"))
        cam = {"color": o["color"]} if o.get("color") and pl["tipo"] in ("gema", "cristal", "diamante", "estrella", "pocion") else {}
        pedidos.append((o.get("modelo") or ("coleccionable" if i == 0 else f"coleccionable{i + 1}"), pl["id"], cam, f"objeto_{i}"))
    if voxel:  # todo en bloques; las armas, en su versión pixel cuando existe
        PIXEL = {"espada": "espada_pixel", "katana": "espada_pixel", "hacha": "hacha_pixel", "martillo": "hacha_pixel"}
        nuevos_p = []
        for rol, pl, cambios, icono in pedidos:
            if rol == "fogata":
                continue
            rig = F.POR_ID[pl]["rig"] if pl in F.POR_ID else ""
            if rig in ("humanoide", "cuadrupedo") and not F.POR_ID[pl].get("bloques"):
                cambios = dict(cambios, _estilo="bloques")
            if rig == "arma" and pl in PIXEL:
                pl = PIXEL[pl]
            nuevos_p.append((rol, pl, cambios, icono))
        pedidos = nuevos_p
    tipos_tema = {x[0] for z in c.get("zonas") or [] for x in (TEMAS.get(z.get("tema")) or {}).get("decoracion", [])}
    tipos_tema |= {x[0] for x in (TEMAS.get(tema) or {}).get("decoracion", [])}
    if not voxel:  # escenario propio (militar: sacos de arena, tanques, torres…): en cualquier calidad, son figuras livianas
        for tipo in sorted(tipos_tema & set(DECO_SIEMPRE)):
            pedidos.append((tipo, DECO_SIEMPRE[tipo], {}, None))
    if nivel in ("alto", "ultra") and not voxel:  # decoración más realista que la del motor
        tipos = set(tipos_tema)
        for tipo in sorted(tipos & set(DECO_FIGURA)):
            pl = DECO_FIGURA[tipo]
            if tipo == "arbol" and tema in ("granja", "terror"):
                pl = "arbol_otono"
            pedidos.append((tipo, pl, {}, None))
    nuevos, lista = [], []
    iconos = p / "assets" / "iconos"
    iconos.mkdir(parents=True, exist_ok=True)
    creadas = reusadas = 0
    for rol, pl, cambios, icono in pedidos:
        if rol in sin_modelo:
            continue
        if rol in cubiertos:
            continue
        info = F.guardar(pl, cambios, detalle, descripcion=d.get("titulo") or "")
        if info.get("reutilizado"):
            reusadas += 1
        else:
            creadas += 1
        lista.append((info, rol))
        if icono and info.get("miniatura_png"):
            shutil.copyfile(info["miniatura_png"], iconos / f"{icono}.png")
        cubiertos = cubiertos | {rol}
    if lista:
        m = A.manifiesto(p)
        for info, rol in lista:
            ent = F.a_proyecto(info, p, rol, registrar=False)
            m["lista"] = [x for x in m.get("lista") or [] if not (x.get("rol") == rol and x.get("tipo") == "modelo")] + [ent]
            nuevos.append(ent)
        A.escribir(p, m)
        log(f"🧍 Figuras 3D animadas: {creadas} nuevas + {reusadas} reutilizadas de tu carpeta 3D (Noviq Creados), "
            f"con sus iconos para elegir personaje y arma.")
    return nuevos


def _iconos_2d(d, p, log):
    """Retratos e iconos en 2D para los menús (y guardados en la carpeta 2D para reutilizarlos)."""
    try:
        from . import figuras2d as F2
    except ImportError:
        return
    F2.para_juego(d, p, log)


def _usar_carpeta(d, elegidos, sin_modelo, log):
    """Llena con los modelos de tu carpeta 3D los roles que no se eligieron en la galería y reparte la decoración entre
    las variantes del mismo modelo (ej. 4 árboles distintos del mismo paquete) para que el mundo no se vea repetido."""
    from . import biblioteca3d as B
    try:
        s = B.sugerir(d)
        todos = [m for m in B.indice()["modelos"] if not m.get("no_soportado")]
    except Exception as e:
        log(f"⚠ No pude leer tu carpeta 3D: {str(e)[:140]}")
        return elegidos
    if not s["asignados"] and not any(x.get("fuente") == "local" for x in elegidos):
        return elegidos
    tipos = {x.get("tipo") for x in d["decoracion"]}
    for x in s["extras"]:  # (desde el chat: el diseño todavía no tenía la decoración extra)
        if x["tipo"] not in tipos and len(d["decoracion"]) < MAX_DECORACION:
            d["decoracion"].append(dict(x))
            tipos.add(x["tipo"])
    ya = {x.get("rol") for x in elegidos if x.get("rol")}
    roles_deco = {x.get("modelo") for x in d["decoracion"]}
    for rol, lista in s["asignados"].items():
        if rol in ya or rol in sin_modelo:
            continue
        if B.DECORACION & {B._rol_base(rol)} and rol not in roles_deco:
            continue
        elegidos.append(B.item_activo(lista[0], rol))
    # variantes y altura de la decoración que viene de la carpeta
    for it in list(elegidos):
        if it.get("fuente") != "local":
            continue
        rol = it.get("rol")
        ent = next((x for x in d["decoracion"] if x.get("modelo") == rol), None)
        m = B.por_id(it.get("id") or "")
        if not ent or not m:
            continue
        ent["altura"] = m.get("altura") or ent.get("altura")
        usados = {e.get("id") for e in elegidos if e is not it}
        vs = [m] + [v for v in B._variantes(m, todos, tema=d.get("tema"))[1:] if v["id"] not in usados]
        if len(vs) > 1 and ent.get("cantidad", 0) >= 4:
            total, n = ent["cantidad"], len(vs)
            ent["cantidad"] = max(1, round(total / n))
            for k, v in enumerate(vs[1:], start=2):
                r2 = f"{rol}_{k}"
                d["decoracion"].append({"tipo": ent["tipo"], "modelo": r2, "cantidad": max(1, round(total / n)),
                                        "altura": v.get("altura") or ent["altura"]})
                elegidos.append(B.item_activo(v, r2))
    n = sum(1 for x in elegidos if x.get("fuente") == "local")
    if n:
        log(f"📁 Tu carpeta 3D ({B.carpeta()}): {n} modelo(s) encajan con este juego.")
    return elegidos


def _mensaje_ia(d, p, descargados, errores):
    extra = "\n".join(f"- {x}" for x in d.get("reglas_extra") or [])
    return (f"[🎮 Estudio de juegos] Ya creé la BASE JUGABLE de «{d['titulo']}» en {p} (motor {d['motor']}, estilo {d['estilo']}, "
            f"género {d['genero']}, objetivo: {d['objetivo']['texto']}). Modelos (de la carpeta 3D del usuario o descargados): "
            f"{', '.join((x.get('rol') or x['nombre']) for x in descargados) or 'ninguno (el motor dibuja formas propias)'}"
            + (f". Problemas con activos: {'; '.join(errores[:3])}" if errores else "") + ".\n\n"
            f"IDEA ORIGINAL DEL USUARIO:\n{d.get('idea') or d.get('descripcion')}\n\n"
            "Tu trabajo ahora (sin empezar de cero):\n"
            "1. Prueba la base con probar_web (ruta 'index.html?prueba=1', acciones: teclas W/Espacio unos segundos, "
            "evaluar_js 'JSON.stringify(estadoJuego())').\n"
            "2. Programa en juego.js (ganchos de window.REGLAS) las mecánicas de la idea que la base todavía no tiene"
            + (f":\n{extra}\n" if extra else ".\n") +
            "3. Ajusta juego.config.js si hace falta (textos, cantidades, colores).\n"
            "4. Vuelve a probar con probar_web y revisa que no haya errores ni fugas; al final resume al usuario cómo jugar "
            "(doble clic en jugar.bat).")


def crear_en_segundo_plano(diseno, nombre=None, activos=None, buscar_auto=True, sin_modelo=None):
    jid = uuid.uuid4().hex[:10]
    job = {"estado": "trabajando", "log": [], "resultado": None, "t": time.time()}
    TRABAJOS[jid] = job

    def run():
        try:
            job["resultado"] = crear(diseno, nombre, activos, buscar_auto, emit=lambda t: job["log"].append(t), sin_modelo=sin_modelo)
            job["estado"] = "listo"
        except Exception as e:
            import traceback
            traceback.print_exc()
            job["resultado"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            job["estado"] = "error"
    threading.Thread(target=run, daemon=True, name="estudio-juegos").start()
    for k in [k for k, v in TRABAJOS.items() if time.time() - v["t"] > 3600]:
        TRABAJOS.pop(k, None)
    return jid
