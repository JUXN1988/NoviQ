# -*- coding: utf-8 -*-
"""🎮 Detector de intenciones multilingüe: ¿el usuario quiere crear un videojuego?

Busca palabras clave de videojuegos en muchos idiomas («juego», «games», «gamers», «crear mundo», «jogo», «jeu»,
«Spiel», «игра», «游戏», «ゲーム», «게임», «لعبة»…), tolera faltas de ortografía («vidiojuego», «jeugo», «gmae») y
evita falsos positivos típicos de programación («juego de caracteres», «game theory»). Devuelve una confianza de 0 a 1
y, además, adivina el género, el estilo gráfico y la temática para que el 🎮 Estudio de juegos arranque ya preparado.

La misma lista (LEXICO) la usa la ventana para detectar mientras el usuario escribe (/api/juegos/lexico)."""
import re
import unicodedata

# Una sola de estas ya indica un videojuego (palabras completas; en escrituras sin espacios se busca el texto).
FUERTES = {
    "es": ["videojuego", "videojuegos", "juego", "juegos", "jueguito", "juegito", "gamer", "gamers", "crear mundo",
           "crear un mundo", "mundo abierto", "motor de juego", "motor de juegos", "estilo minecraft", "tipo minecraft",
           "como minecraft", "juego de plataformas", "juego de rol", "juegos de rol", "plataformero", "shooter", "rpg",
           "mmorpg", "roguelike", "metroidvania", "battle royale", "jeugo", "juegoo", "vidiojuego", "videjuego"],
    "en": ["game", "games", "videogame", "videogames", "video game", "video games", "gamer", "gamers", "gaming",
           "gamedev", "game dev", "open world", "create world", "create a world", "build a world", "game engine",
           "platformer", "gmae", "gaem"],
    "pt": ["jogo", "jogos", "joguinho", "criar mundo", "criar um mundo", "jogo de plataforma"],
    "fr": ["jeu", "jeux", "jeu video", "jeux video", "creer un monde"],
    "it": ["gioco", "giochi", "videogioco", "videogiochi", "creare un mondo"],
    "de": ["spiel", "spiele", "videospiel", "videospiele", "computerspiel", "spielwelt", "welt erschaffen"],
    "nl": ["spel", "spelletje", "computerspel"],
    "pl": ["gra", "gry", "gre", "gra wideo"],
    "tr": ["oyun", "oyunu", "video oyunu"],
    "ru": ["игра", "игру", "игры", "игр", "видеоигра", "создать мир"],
    "uk": ["гра", "гру", "відеогра"],
    "zh": ["游戏", "遊戲", "电子游戏", "創建世界", "创建世界"],
    "ja": ["ゲーム"],
    "ko": ["게임"],
    "ar": ["لعبة", "ألعاب", "العاب"],
    "hi": ["गेम", "खेल"],
    "id": ["permainan"],
    "vi": ["tro choi"],
    "qu": ["pukllay", "pukllana"],   # kichwa / quechua: jugar, juego
}

# Palabras de apoyo: solas no bastan (necesitan un verbo de crear u otra palabra de apoyo).
APOYO = ["niveles del", "personaje", "personajes", "jugador", "jugadores", "enemigo", "enemigos", "puntaje", "vidas",
         "jefe final", "sprite", "sprites", "multijugador", "jugar", "jugable", "misiones", "enemies", "enemy", "boss",
         "npc", "npcs", "multiplayer", "playable", "quest", "minecraft", "roblox", "fortnite", "mario", "zelda", "pokemon",
         "tetris", "pacman", "unity", "unreal", "godot", "phaser", "pixel art", "voxel", "voxeles", "low poly", "lowpoly",
         "fps", "joystick", "gamepad", "control de xbox", "nivel de dificultad", "power up", "power-ups", "respawn",
         "high score", "game over"]

VERBOS = ["crear", "crea", "creame", "cree", "hacer", "haz", "hazme", "hacerme", "programar", "programa", "programame",
          "desarrollar", "desarrolla", "disenar", "disena", "construir", "construye", "armar", "arma", "generar", "genera",
          "quiero", "necesito", "ayudame", "make", "create", "build", "develop", "code", "design", "generate", "want",
          "criar", "fazer", "faca", "creer", "faire", "creare", "fare", "erstellen", "bauen", "programmieren", "machen",
          "maak", "stworz", "yap", "сделать", "создать", "сделай", "создай", "做", "制作", "製作", "作る", "作って", "만들",
          "انشاء", "إنشاء", "اصنع", "बनाओ", "बनाना", "buat", "tao", "rurana", "ruray"]

# Frases que contienen «juego/game» pero NO hablan de videojuegos.
NEGATIVAS = ["juego de caracteres", "juegos de caracteres", "juego de datos", "juegos de datos", "juego de pruebas",
             "juegos de pruebas", "juego de llaves", "juego de herramientas", "juego de sabanas", "juego de ollas",
             "juego de comedor", "juego de sala", "juego de living", "en juego", "hacer juego con", "hace juego con",
             "juego limpio", "juego sucio", "juego de palabras", "juego de luces", "doble juego", "juego de manos",
             "game theory", "game changer", "game-changer", "fair game", "game plan", "name of the game", "ahead of the game",
             "teoria de juegos", "teoria de los juegos", "jeu de caracteres", "jeu de donnees", "jogo de caracteres",
             "zeichensatz", "spiel mit dem feuer", "set de caracteres"]

GENEROS = {
    "plataformas": ["plataforma", "plataformas", "plataformero", "saltar", "salta", "mario", "platformer", "jump", "metroidvania",
                    "side scroller", "lateral", "plateforme", "piattaforme", "jump and run"],
    "carreras": ["carrera", "carreras", "auto", "autos", "carro", "carros", "coche", "coches", "moto", "motos", "kart",
                 "racing", "race", "car", "cars", "vehiculo", "vehiculos", "pista", "circuito", "f1", "rally"],
    "disparos": ["disparo", "disparos", "disparar", "dispara", "shooter", "fps", "pistola", "arma", "armas", "balas", "nave",
                 "naves", "tiro", "shoot", "shooting", "gun", "guns", "laser", "invaders", "bullet"],
    "supervivencia": ["supervivencia", "sobrevivir", "survival", "survive", "zombie", "zombies", "zombis", "oleadas", "waves",
                      "hambre", "refugio", "apocalipsis"],
    "construccion": ["construir", "construccion", "bloques", "minecraft", "sandbox", "crafteo", "craftear", "crafting",
                     "build", "building", "voxel", "cubos", "edificar", "minar", "mining"],
    "puzle": ["puzle", "puzles", "puzzle", "puzzles", "rompecabezas", "acertijo", "tetris", "match 3", "logica", "sokoban"],
    "rpg": ["rpg", "rol", "juego de rol", "mision", "misiones", "quest", "inventario", "hechizo", "hechizos", "mago", "magia",
            "experiencia", "subir de nivel", "mazmorra", "dungeon", "roguelike", "espada", "caballero"],
    "terror": ["terror", "miedo", "horror", "fantasma", "fantasmas", "susto", "embrujada", "embrujado", "scary", "ghost",
               "creepy", "oscuridad", "oscuro"],
    "deportes": ["futbol", "soccer", "football", "basket", "baloncesto", "basketball", "tenis", "tennis", "golf", "voley",
                 "deporte", "deportes", "sports", "penales", "gol"],
    "exploracion": ["explorar", "exploracion", "mundo abierto", "open world", "explore", "descubrir", "viaje", "isla"],
    "aventura": ["aventura", "aventuras", "adventure", "tesoro", "tesoros", "reliquia", "coleccionar", "recolectar",
                 "recoger", "gemas", "monedas"],
}

ESTILOS = {
    "voxel": ["minecraft", "voxel", "voxeles", "cubos", "cubico", "bloques", "pixelado 3d", "pixelados", "estilo cubo",
              "blocky"],
    "pixel2d": ["2d", "pixel art", "pixelart", "8 bits", "8-bit", "8bit", "16 bits", "16-bit", "retro", "arcade", "lateral",
                "side scroller", "sprites", "sprite"],
    "lowpoly": ["low poly", "lowpoly", "caricatura", "cartoon", "animado", "estilizado", "infantil", "colorido", "simple",
                "kawaii", "toon"],
    "realista": ["realista", "realistas", "fotorrealista", "aaa", "alta calidad", "hd", "4k", "ultra", "unreal", "cinematico",
                 "realistic", "photorealistic", "next gen", "rtx", "ray tracing", "graficos buenos"],
}

TEMAS = {
    "medieval": ["medieval", "castillo", "castillos", "caballero", "caballeros", "dragon", "dragones", "espada", "reino",
                 "knight", "castle", "rey", "princesa", "vikingo", "vikingos", "drachen", "ritter", "dragao", "chevalier"],
    "espacio": ["espacio", "espacial", "nave", "naves", "planeta", "planetas", "galaxia", "alien", "aliens", "extraterrestre",
                "asteroide", "asteroides", "space", "spaceship", "estrella", "estrellas", "luna", "marte", "космос", "weltraum",
                "espace", "espaco", "太空"],
    "zombies": ["zombie", "zombies", "zombis", "apocalipsis", "muertos vivientes", "infectados", "undead"],
    "bosque": ["bosque", "selva", "jungla", "amazonia", "amazonas", "arboles", "forest", "jungle", "naturaleza"],
    "desierto": ["desierto", "arena", "piramide", "piramides", "egipto", "desert", "oasis", "cactus"],
    "nieve": ["nieve", "hielo", "invierno", "polar", "artico", "pinguino", "snow", "ice", "winter", "glaciar"],
    "oceano": ["oceano", "mar", "playa", "isla", "islas", "pirata", "piratas", "barco", "submarino", "tiburon", "ocean", "sea",
               "island", "pirate", "galapagos"],
    "ciudad": ["ciudad", "urbano", "calle", "calles", "policia", "edificios", "city", "urban", "street", "barrio"],
    "fantasia": ["magia", "mago", "hechicero", "elfo", "elfos", "hada", "hadas", "unicornio", "fantasia", "fantasy", "magic",
                 "encantado", "reino magico"],
    "terror": ["terror", "miedo", "fantasma", "fantasmas", "horror", "embrujada", "cementerio", "noche oscura"],
    "futurista": ["futurista", "futuro", "cyberpunk", "robot", "robots", "neon", "sci-fi", "scifi", "cibernetico", "mecha"],
    "dinosaurios": ["dinosaurio", "dinosaurios", "jurasico", "t-rex", "trex", "prehistorico", "dino", "dinos"],
    "andes": ["andes", "volcan", "volcanes", "cotopaxi", "chimborazo", "ecuador", "paramo", "montana", "montanas", "llama",
              "llamas", "condor"],
    "granja": ["granja", "campo", "cultivos", "vacas", "gallinas", "farm", "agricultura", "huerto", "rancho"],
    "militar": ["militar", "militares", "base militar", "ejercito", "guerra", "soldado", "soldados", "trinchera", "trincheras", "cuartel",
                "army", "military", "war", "soldier", "soldiers", "comando", "batalla"],
    "deportes": ["estadio", "cancha", "futbol", "soccer", "basket", "tenis"],
}


def normalizar(t):
    """Minúsculas y sin tildes (ñ → n), para comparar sin importar cómo se escribió."""
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


_LAT = re.compile(r"[a-z0-9]")


def _es_latino(p):
    return bool(_LAT.search(p)) and all(ord(c) < 0x250 for c in p)


def _dl1(a, b):
    """True si a y b difieren en como mucho una letra (cambio, falta, sobra o dos letras cruzadas)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        d = [i for i in range(la) if a[i] != b[i]]
        return len(d) == 1 or (len(d) == 2 and d[1] == d[0] + 1 and a[d[0]] == b[d[1]] and a[d[1]] == b[d[0]])
    if la > lb:
        a, b = b, a
    for i in range(len(b)):
        if a == b[:i] + b[i + 1:]:
            return True
    return False


def _buscar(frases, txt, toks, difuso=False):
    """Frases de la lista que aparecen en el texto (palabra completa en escrituras latinas)."""
    hits = []
    for f in frases:
        fn = normalizar(f)
        if _es_latino(fn):
            if " " in fn or "-" in fn or "." in fn:
                if re.search(r"(?<![a-z0-9])" + re.escape(fn) + r"(?![a-z0-9])", txt):
                    hits.append(f)
            elif fn in toks:
                hits.append(f)
            elif difuso and len(fn) >= 7 and any(len(t) >= 6 and _dl1(fn, t) for t in toks):
                hits.append(f + "~")
        elif fn in txt:
            hits.append(f)
    return hits


def _tokens(txt):
    return set(re.findall(r"[a-z0-9ñ]+", txt))


def _mejor(tabla, txt, toks):
    best, bn, todas = None, 0, {}
    for k, pal in tabla.items():
        h = _buscar(pal, txt, toks)
        if h:
            todas[k] = len(h)
        if len(h) > bn:
            best, bn = k, len(h)
    return best, todas


def detectar(texto):
    """{"juego": bool, "confianza": 0-1, "abrir": bool, "palabras": [...], "idiomas": [...],
        "genero": str|None, "estilo": str|None, "tema": str|None}"""
    txt = normalizar(texto)[:4000]
    base = {"juego": False, "confianza": 0.0, "abrir": False, "palabras": [], "idiomas": [], "genero": None,
            "estilo": None, "tema": None}
    if len(txt.strip()) < 3:
        return base
    limpio = txt
    for n in NEGATIVAS:  # se quitan las frases que no hablan de videojuegos
        limpio = re.sub(r"(?<![a-z0-9])" + re.escape(normalizar(n)) + r"(?![a-z0-9])", " ", limpio)
    toks = _tokens(limpio)
    fuertes, idiomas = [], []
    for lang, frases in FUERTES.items():
        h = _buscar(frases, limpio, toks, difuso=True)
        if h:
            fuertes += h
            idiomas.append(lang)
    if any(not h.endswith("~") for h in fuertes):  # «videojuego~» sobra si ya está «videojuegos» exacto
        fuertes = [h for h in fuertes if not h.endswith("~")]
    apoyo = _buscar(APOYO, limpio, toks)
    verbo = bool(_buscar(VERBOS, limpio, toks))
    if fuertes:
        conf = 0.7 + (0.2 if verbo else 0) + 0.05 * min(3, len(apoyo)) + (0.05 if len(fuertes) > 1 else 0)
    elif len(apoyo) >= 3 or (len(apoyo) >= 2 and verbo):
        conf = 0.62
    elif apoyo and verbo:
        conf = 0.35
    else:
        conf = 0.1 * len(apoyo)
    conf = round(min(1.0, conf), 2)
    genero, _ = _mejor(GENEROS, limpio, toks)
    estilo, _ = _mejor(ESTILOS, limpio, toks)
    tema, _ = _mejor(TEMAS, limpio, toks)
    return {"juego": conf >= 0.6, "confianza": conf, "abrir": conf >= 0.7 and (verbo or conf >= 0.8),
            "palabras": list(dict.fromkeys(fuertes + apoyo))[:12], "idiomas": idiomas, "verbo": verbo,
            "genero": genero, "estilo": estilo, "tema": tema}


def lexico():
    """Lo que necesita la ventana para detectar mientras se escribe (misma lógica, en JavaScript)."""
    return {"fuertes": sorted({normalizar(x) for v in FUERTES.values() for x in v}),
            "apoyo": sorted({normalizar(x) for x in APOYO}), "verbos": sorted({normalizar(x) for x in VERBOS}),
            "negativas": sorted({normalizar(x) for x in NEGATIVAS})}
