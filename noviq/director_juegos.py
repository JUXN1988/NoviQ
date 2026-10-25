# -*- coding: utf-8 -*-
"""🎬 Director creativo del Estudio de juegos: convierte una idea corta («juego de recoger calabazas») en un diseño ÉPICO,
completo y sin huecos, como el de los juegos más jugados de cada categoría.

Cómo trabaja (en este orden):
1. Lee la idea: qué se recoge, contra qué se pelea, en qué mundo, qué género y qué estilo (el usuario manda).
2. BORRADOR LOCAL (siempre, sin IA): arma una travesía de zonas que sube de dificultad, con historia, protagonista con
   TRAJES para elegir, ARMAS para elegir, vidas y puntos de control, obstáculos, contratiempos, potenciadores, mejoras entre
   zonas, NPC con diálogos, miradores con vista panorámica, jefe final con fases y logros. Usa la base de PATRONES de los
   juegos más jugados de cada género (lo que los hace adictivos) y el vocabulario que el motor sabe jugar.
3. IA (si hay): la IA más rápida recibe la idea + los patrones del género + el borrador + los mejores diseños aprobados antes
   (ejemplos) y lo hace más creativo y fiel a la idea (nombres, historia, diálogos, qué enemigos, qué armas).
4. NORMALIZA todo contra el vocabulario del motor (una IA pequeña puede inventar cosas que el juego no sabe hacer).
5. RÚBRICA: revisa 16 puntos de calidad (zonas, dificultad creciente, jefe con fases, trajes, armas, vidas, obstáculos,
   contratiempos, mejoras, NPC, miradores, logros, tutorial, fidelidad a la idea…) y COMPLETA solo lo que falte.
6. APRENDE: los diseños que el usuario aprueba (al crear el juego) o califica con 👍 quedan como ejemplos para los próximos
   (aprendizaje por ejemplos; no se re-entrena ningún modelo)."""
import hashlib
import json
import random
import re
import time

from .config import DATA_DIR

# ───────────── Vocabulario que el motor sabe jugar (no inventar fuera de esto) ─────────────
OBSTACULOS = {
    "pinchos": "Trampas de pinchos que salen del suelo cada pocos segundos",
    "tronco": "Troncos que ruedan cuesta abajo por el camino",
    "lodo": "Charcos de lodo que te frenan",
    "fuego": "Zonas de fuego que queman si las pisas",
    "rocas": "Rocas que caen desde lo alto (mira la sombra en el suelo)",
    "pendulo": "Hachas-péndulo que barren el camino",
    "trampa": "Trampas para osos que te inmovilizan un momento",
    "zarzas": "Zarzas con espinas que frenan y lastiman",
    "hielo": "Placas de hielo resbaladizas",
}
CONTRATIEMPOS = {
    "tormenta": "Se desata una tormenta: lluvia, viento, relámpagos y poca visibilidad",
    "noche": "Anochece de golpe: todo se oscurece y los enemigos se vuelven más agresivos",
    "emboscada": "¡Emboscada! Aparece una oleada de enemigos alrededor",
    "ladron": "Un ladrón roba parte de lo que llevas y huye: atrápalo para recuperarlo",
    "derrumbe": "Un derrumbe: caen rocas y el camino se cierra un momento",
    "niebla": "Una niebla espesa cubre la zona",
}
POTENCIADORES = {"iman": "🧲 Imán: atrae lo que recoges", "escudo": "🛡 Escudo: invencible por unos segundos", "turbo": "⚡ Turbo: más velocidad",
                 "curacion": "❤ Curación: recupera vida", "vida_extra": "💚 Vida extra", "furia": "🔥 Furia: daño doble"}
MEJORAS = {"doble_salto": "Doble salto", "danio_extra": "+25 % de daño", "vida_max": "+25 de vida máxima", "velocidad": "+12 % de velocidad",
           "cadencia": "Atacas más rápido", "iman_permanente": "Imán permanente pequeño", "alcance": "+30 % de alcance", "regeneracion": "Regeneras vida lentamente"}
HABILIDADES_JEFE = {"embestida": "Embiste en línea recta (esquívalo de lado)", "proyectiles": "Lanza proyectiles en abanico",
                    "invocar": "Invoca esbirros", "onda": "Golpea el suelo: onda expansiva (salta para esquivarla)", "salto": "Salta y cae sobre ti"}
LOGROS_TIPOS = {"recoger_todo", "sin_danio_zona", "derrotar", "miradores", "jefe", "rapido", "sin_morir", "coleccionista"}
TIPOS_ARMA = {"cuerpo", "disparo", "magia"}
PROYECTILES = {"bala", "flecha", "piedra", "fuego", "magia", "laser"}

# ───────────── Patrones de los juegos más jugados, por género ─────────────
PATRONES = {
    "aventura": {"referentes": ["The Legend of Zelda: Breath of the Wild", "Uncharted", "Tomb Raider", "Hollow Knight", "Minecraft Dungeons"],
                 "bucle": "explorar → descubrir → enfrentar → recompensa → mejorar el equipo → llegar más lejos",
                 "pilares": ["un mundo que invita a mirar el horizonte (miradores y vistas panorámicas)", "curiosidad recompensada: secretos y coleccionables",
                             "combate simple pero con esquiva y ritmo", "progresión visible: zonas nuevas, armas y trajes que se desbloquean",
                             "un jefe final memorable con fases"],
                 "ritmo": "alternar calma (explorar) y tensión (peligros, emboscadas), subir la dificultad por zonas"},
    "plataformas": {"referentes": ["Super Mario Odyssey", "Celeste", "Crash Bandicoot", "Rayman Legends", "Ori"],
                    "bucle": "saltar → superar un desafío → punto de control → desafío más difícil",
                    "pilares": ["controles precisos (salto variable, tiempo de gracia)", "desafíos que enseñan una idea y luego la complican",
                                "puntos de control frecuentes para no frustrar", "coleccionables escondidos fuera del camino", "jefe que pone a prueba lo aprendido"],
                    "ritmo": "enseñar → practicar → combinar → examen final"},
    "disparos": {"referentes": ["Fortnite", "Call of Duty", "Halo", "DOOM", "Borderlands"],
                 "bucle": "entrar en combate → cubrirse/moverse → derrotar oleadas → recoger munición y mejoras → oleada más dura",
                 "pilares": ["armas con sensaciones distintas (cadencia, daño, alcance)", "enemigos variados que obligan a cambiar de arma",
                             "movimiento constante", "botín y mejoras entre oleadas", "jefe con puntos débiles y fases"],
                 "ritmo": "oleadas que crecen con pausas cortas para reabastecerse"},
    "supervivencia": {"referentes": ["Minecraft", "Valheim", "The Forest", "Subnautica", "Don't Starve"],
                      "bucle": "reunir recursos → prepararse → resistir la noche/amenaza → progresar",
                      "pilares": ["tensión del tiempo (la noche llega)", "recursos escasos que obligan a decidir", "amenazas que escalan",
                                  "refugios/puntos de control seguros", "un gran peligro final"],
                      "ritmo": "día tranquilo → anochecer tenso → noche peligrosa → amanecer (recompensa)"},
    "carreras": {"referentes": ["Mario Kart", "Forza Horizon", "Need for Speed", "Trackmania"],
                 "bucle": "correr → adelantar → usar turbos y atajos → ganar la copa → desbloquear vehículos",
                 "pilares": ["sensación de velocidad", "rivales que pelean la posición", "potenciadores en la pista", "copas que suben de dificultad",
                             "vehículos y colores para elegir"],
                 "ritmo": "copas de 3 carreras con rivales cada vez más rápidos"},
    "rpg": {"referentes": ["The Witcher 3", "Skyrim", "Elden Ring", "Diablo", "Final Fantasy"],
            "bucle": "misión → explorar → combatir → botín → subir de nivel → misión mayor",
            "pilares": ["historia con personajes y diálogos", "clases/trajes con estadísticas distintas", "armas con estilos de combate",
                        "mejoras que se eligen", "jefes épicos"],
            "ritmo": "aldea segura → tierras salvajes → mazmorra → jefe"},
    "terror": {"referentes": ["Resident Evil", "Outlast", "Five Nights at Freddy's", "Silent Hill", "Phasmophobia"],
               "bucle": "avanzar en la oscuridad → encontrar llaves → evitar o enfrentar a la amenaza → escapar",
               "pilares": ["luz limitada (linterna)", "sonido y niebla que generan tensión", "recursos escasos", "sustos bien espaciados",
                           "una amenaza principal que persigue"],
               "ritmo": "calma inquietante → tensión creciente → persecución → alivio breve"},
    "exploracion": {"referentes": ["Journey", "No Man's Sky", "Subnautica", "Firewatch", "Outer Wilds"],
                    "bucle": "ver algo a lo lejos → viajar → descubrir → vista panorámica → siguiente horizonte",
                    "pilares": ["paisajes y vistas que dan ganas de explorar", "descubrimientos y secretos", "pocos combates, más atmósfera",
                                "historia contada por el entorno", "un destino final espectacular"],
                    "ritmo": "viaje contemplativo con momentos de peligro"},
    "puzle": {"referentes": ["Portal", "Pikmin", "Zelda (santuarios)", "Captain Toad"],
              "bucle": "observar → probar → resolver → recompensa → puzle más complejo",
              "pilares": ["reglas claras", "cada zona agrega una idea nueva", "recompensas por resolver rápido", "ayudas si te atascas",
                          "un desafío final que combina todo"],
              "ritmo": "fácil → combina → sorpresa → final"},
    "construccion": {"referentes": ["Minecraft", "Terraria", "Fortnite (construir)", "Dragon Quest Builders"],
                     "bucle": "recolectar → construir → defender → ampliar",
                     "pilares": ["libertad creativa", "metas de construcción claras", "amenazas nocturnas", "materiales nuevos por zona",
                                 "una gran obra final"],
                     "ritmo": "construir de día, defender de noche"},
    "deportes": {"referentes": ["Rocket League", "FIFA", "NBA 2K", "Mario Strikers"],
                 "bucle": "partido → jugada → gol/punto → torneo",
                 "pilares": ["controles de respuesta inmediata", "rivales con estilos", "torneo por rondas", "trajes/equipos para elegir",
                             "celebraciones y repeticiones"],
                 "ritmo": "rondas cortas cada vez más difíciles"},
}
PATRONES["supervivencia"]["obstaculos"] = ["trampa", "fuego", "zarzas"]

# ───────────── Mundos: zonas de la travesía por temática (sub-temática = colores y decoración del motor) ─────────────
ZONAS_TEMA = {
    "granja": [("Granja del Valle", "granja", "dia", "despejado"), ("Maizal de los Susurros", "granja", "atardecer", "niebla"),
               ("Bosque de los Cuervos", "bosque", "atardecer", "despejado"), ("Cementerio Olvidado", "terror", "noche", "niebla"),
               ("Colina del Rey Calabaza", "terror", "noche", "lluvia")],
    "terror": [("Aldea Silenciosa", "granja", "atardecer", "niebla"), ("Bosque Susurrante", "bosque", "noche", "niebla"),
               ("Cementerio de las Ánimas", "terror", "noche", "niebla"), ("Mansión Embrujada", "terror", "noche", "lluvia"),
               ("Cripta del Fin", "terror", "noche", "despejado")],
    "bosque": [("Claro del Amanecer", "bosque", "dia", "despejado"), ("Selva Profunda", "bosque", "dia", "lluvia"),
               ("Río de las Cascadas", "bosque", "atardecer", "despejado"), ("Ruinas Cubiertas de Musgo", "fantasia", "atardecer", "niebla"),
               ("Corazón del Bosque", "bosque", "noche", "despejado")],
    "medieval": [("Aldea del Reino", "medieval", "dia", "despejado"), ("Camino Real", "bosque", "dia", "despejado"),
                 ("Montañas del Norte", "nieve", "atardecer", "nieve"), ("Fortaleza en Ruinas", "medieval", "atardecer", "niebla"),
                 ("Guarida del Dragón", "medieval", "noche", "despejado")],
    "fantasia": [("Pradera Encantada", "fantasia", "dia", "despejado"), ("Bosque de las Hadas", "fantasia", "atardecer", "despejado"),
                 ("Lago de Cristal", "fantasia", "atardecer", "niebla"), ("Torre del Hechicero", "medieval", "noche", "despejado"),
                 ("Trono de las Sombras", "terror", "noche", "lluvia")],
    "espacio": [("Base Lunar", "espacio", "noche", "despejado"), ("Cráteres de Cristal", "espacio", "noche", "despejado"),
                ("Planeta Rojo", "desierto", "atardecer", "despejado"), ("Estación Abandonada", "futurista", "noche", "niebla"),
                ("Nave Nodriza", "futurista", "noche", "despejado")],
    "futurista": [("Distrito Neón", "futurista", "noche", "lluvia"), ("Autopista Suspendida", "ciudad", "noche", "despejado"),
                  ("Fábrica de Drones", "futurista", "noche", "niebla"), ("Laboratorio Secreto", "futurista", "noche", "despejado"),
                  ("Torre Central", "futurista", "noche", "lluvia")],
    "zombies": [("Refugio", "zombies", "dia", "despejado"), ("Pueblo Abandonado", "zombies", "atardecer", "despejado"),
                ("Ciudad en Ruinas", "ciudad", "atardecer", "niebla"), ("Hospital", "zombies", "noche", "lluvia"),
                ("Laboratorio del Virus", "futurista", "noche", "niebla")],
    "militar": [("Campamento Base", "militar", "dia", "despejado"), ("Trincheras", "militar", "dia", "niebla"),
                ("Puente Destruido", "militar", "atardecer", "despejado"), ("Ciudad Ocupada", "ciudad", "atardecer", "lluvia"),
                ("Cuartel Enemigo", "militar", "noche", "despejado")],
    "desierto": [("Oasis", "desierto", "dia", "despejado"), ("Dunas Infinitas", "desierto", "dia", "despejado"),
                 ("Cañón del Escorpión", "desierto", "atardecer", "despejado"), ("Templo Enterrado", "desierto", "atardecer", "niebla"),
                 ("Pirámide del Faraón", "desierto", "noche", "despejado")],
    "nieve": [("Aldea Nevada", "nieve", "dia", "despejado"), ("Bosque de Pinos", "nieve", "dia", "nieve"),
              ("Lago Congelado", "nieve", "atardecer", "despejado"), ("Paso de la Montaña", "nieve", "atardecer", "nieve"),
              ("Cueva del Yeti", "nieve", "noche", "nieve")],
    "oceano": [("Playa del Náufrago", "oceano", "dia", "despejado"), ("Selva de la Isla", "bosque", "dia", "lluvia"),
               ("Arrecife de Coral", "oceano", "atardecer", "despejado"), ("Barco Fantasma", "terror", "noche", "niebla"),
               ("Isla del Tesoro", "oceano", "atardecer", "despejado")],
    "ciudad": [("Barrio Central", "ciudad", "dia", "despejado"), ("Parque de la Ciudad", "bosque", "dia", "despejado"),
               ("Zona Industrial", "ciudad", "atardecer", "niebla"), ("Azoteas", "ciudad", "noche", "despejado"),
               ("Torre del Villano", "futurista", "noche", "lluvia")],
    "dinosaurios": [("Campamento Científico", "dinosaurios", "dia", "despejado"), ("Selva Jurásica", "dinosaurios", "dia", "lluvia"),
                    ("Volcán Humeante", "desierto", "atardecer", "niebla"), ("Pantano Prehistórico", "dinosaurios", "atardecer", "niebla"),
                    ("Valle del T-Rex", "dinosaurios", "noche", "despejado")],
    "andes": [("Pueblo Andino", "andes", "dia", "despejado"), ("Páramo de los Frailejones", "andes", "dia", "niebla"),
              ("Laguna Sagrada", "andes", "atardecer", "despejado"), ("Faldas del Volcán", "nieve", "atardecer", "nieve"),
              ("Cumbre del Cóndor", "nieve", "atardecer", "despejado")],
    "deportes": [("Cancha del Barrio", "deportes", "dia", "despejado"), ("Estadio Regional", "deportes", "atardecer", "despejado"),
                 ("Torneo Nacional", "deportes", "noche", "despejado"), ("Copa Internacional", "deportes", "noche", "lluvia"),
                 ("Gran Final", "deportes", "noche", "despejado")],
}
ZONAS_TEMA["exploracion"] = ZONAS_TEMA["bosque"]

# armas por temática: (plantilla, nombre, tipo, proyectil)
ARMAS_TEMA = {
    "granja": [("hoz", "Hoz afilada", "cuerpo", None), ("tirachinas", "Tirachinas de roble", "disparo", "piedra"), ("antorcha", "Antorcha", "cuerpo", "fuego"),
               ("guadana", "Guadaña del segador", "cuerpo", None)],
    "terror": [("antorcha", "Antorcha sagrada", "cuerpo", "fuego"), ("ballesta", "Ballesta de plata", "disparo", "flecha"), ("guadana", "Guadaña", "cuerpo", None)],
    "bosque": [("arco", "Arco del bosque", "disparo", "flecha"), ("hacha", "Hacha de leñador", "cuerpo", None), ("tirachinas", "Honda", "disparo", "piedra")],
    "medieval": [("espada", "Espada del reino", "cuerpo", None), ("arco", "Arco largo", "disparo", "flecha"), ("martillo", "Martillo de guerra", "cuerpo", None),
                 ("baculo", "Báculo de fuego", "magia", "fuego")],
    "fantasia": [("baculo", "Báculo arcano", "magia", "magia"), ("espada", "Espada rúnica", "cuerpo", None), ("arco", "Arco élfico", "disparo", "flecha"),
                 ("varita", "Varita de estrellas", "magia", "magia")],
    "espacio": [("blaster", "Bláster de plasma", "disparo", "laser"), ("rifle", "Rifle de pulsos", "disparo", "laser"), ("katana", "Espada de energía", "cuerpo", None)],
    "futurista": [("blaster", "Bláster neón", "disparo", "laser"), ("katana", "Katana de plasma", "cuerpo", None), ("rifle", "Rifle de riel", "disparo", "laser")],
    "zombies": [("pistola", "Pistola", "disparo", "bala"), ("escopeta", "Escopeta", "disparo", "bala"), ("hacha", "Hacha de bombero", "cuerpo", None),
                ("rifle", "Rifle", "disparo", "bala")],
    "militar": [("rifle", "Rifle de asalto", "disparo", "bala"), ("pistola", "Pistola", "disparo", "bala"), ("escopeta", "Escopeta", "disparo", "bala")],
    "desierto": [("lanza", "Lanza del oasis", "cuerpo", None), ("arco", "Arco del desierto", "disparo", "flecha"), ("pistola", "Revólver", "disparo", "bala")],
    "nieve": [("hacha", "Hacha de hielo", "cuerpo", None), ("arco", "Arco del norte", "disparo", "flecha"), ("lanza", "Lanza ártica", "cuerpo", None)],
    "oceano": [("espada", "Sable pirata", "cuerpo", None), ("pistola", "Pistola de chispa", "disparo", "bala"), ("tirachinas", "Honda de coco", "disparo", "piedra")],
    "ciudad": [("pistola", "Pistola", "disparo", "bala"), ("martillo", "Mazo", "cuerpo", None), ("blaster", "Aturdidor", "disparo", "laser")],
    "dinosaurios": [("lanza", "Lanza de sílex", "cuerpo", None), ("rifle", "Rifle tranquilizante", "disparo", "bala"), ("tirachinas", "Honda", "disparo", "piedra")],
    "andes": [("tirachinas", "Huaraca (honda andina)", "disparo", "piedra"), ("lanza", "Lanza de chonta", "cuerpo", None), ("baculo", "Vara del Yachak", "magia", "magia")],
    "deportes": [("tirachinas", "Lanzador de balones", "disparo", "piedra")],
}
ARMAS_TEMA["exploracion"] = ARMAS_TEMA["bosque"]
# trajes por temática: (plantilla, nombre, rasgo)
TRAJES_TEMA = {
    "granja": [("granjera", "Granjera", "equilibrada"), ("granjero", "Granjero Fuerte", "resistente"), ("cazador", "Cazadora del Maizal", "rapida"),
               ("exploradora", "Exploradora Otoñal", "saltarina")],
    "terror": [("cazafantasmas", "Cazafantasmas", "equilibrada"), ("superviviente", "Superviviente", "resistente"), ("cazador", "Cazador Nocturno", "rapida")],
    "bosque": [("exploradora", "Exploradora", "equilibrada"), ("cazador", "Guardabosques", "rapida"), ("explorador", "Explorador", "resistente")],
    "medieval": [("caballero", "Caballero", "resistente"), ("guerrera", "Guerrera", "equilibrada"), ("cazador", "Arquero", "rapida"), ("mago", "Mago", "saltarina")],
    "fantasia": [("mago", "Mago", "equilibrada"), ("guerrera", "Paladina", "resistente"), ("heroe_chibi", "Héroe Mini", "saltarina"), ("cazador", "Elfo", "rapida")],
    "espacio": [("astronauta", "Astronauta", "equilibrada"), ("cyberpunk", "Piloto Estelar", "rapida"), ("soldado", "Marine Espacial", "resistente")],
    "futurista": [("cyberpunk", "Agente Neón", "rapida"), ("soldado", "Soldado del Futuro", "resistente"), ("astronauta", "Explorador Orbital", "equilibrada")],
    "zombies": [("superviviente", "Superviviente", "equilibrada"), ("soldado", "Soldado", "resistente"), ("deportista", "Atleta", "rapida")],
    "militar": [("soldado_camuflado", "Soldado", "equilibrada"), ("comando", "Comando", "rapida"), ("francotirador", "Francotirador", "saltarina"),
                ("medico_militar", "Médico de campo", "resistente")],
    "desierto": [("explorador", "Explorador", "equilibrada"), ("exploradora", "Arqueóloga", "rapida"), ("guerrera", "Guerrera del Oasis", "resistente")],
    "nieve": [("vikingo", "Vikingo", "resistente"), ("exploradora", "Exploradora Polar", "equilibrada"), ("cazador", "Cazador", "rapida")],
    "oceano": [("pirata", "Pirata", "equilibrada"), ("exploradora", "Náufraga", "rapida"), ("caballero", "Capitán", "resistente")],
    "ciudad": [("deportista", "Deportista", "rapida"), ("superviviente", "Héroe Urbano", "equilibrada"), ("cyberpunk", "Hacker", "saltarina")],
    "dinosaurios": [("explorador", "Paleontólogo", "equilibrada"), ("exploradora", "Exploradora", "rapida"), ("soldado", "Guardabosques", "resistente")],
    "andes": [("explorador", "Andinista", "equilibrada"), ("exploradora", "Chagra", "rapida"), ("sabio", "Yachak", "saltarina")],
    "deportes": [("deportista", "Deportista", "equilibrada"), ("heroe_chibi", "Mini Estrella", "rapida"), ("superviviente", "Veterano", "resistente")],
}
TRAJES_TEMA["exploracion"] = TRAJES_TEMA["bosque"]
RASGOS = {"equilibrada": {"vida": 1.0, "velocidad": 1.0, "salto": 1.0, "texto": "Equilibrado en todo"},
          "resistente": {"vida": 1.35, "velocidad": 0.92, "salto": 0.95, "texto": "+35 % de vida, algo más lento"},
          "rapida": {"vida": 0.85, "velocidad": 1.18, "salto": 1.05, "texto": "+18 % de velocidad, menos vida"},
          "saltarina": {"vida": 0.95, "velocidad": 1.02, "salto": 1.3, "texto": "Salta mucho más alto"}}
COLORES_TRAJE = ["#c0392b", "#2f6fd0", "#3f9a3a", "#8a4ac0", "#e8a030", "#1f8a8a"]
# jefe por temática: (plantilla, nombre, cambios)
JEFES = {"granja": ("rey_calabaza", "Rey Calabaza", {}), "terror": ("reina_bruja", "Reina Bruja", {}), "bosque": ("arana_reina", "Araña Reina del Bosque", {}),
         "medieval": ("dragon", "Dragón Carmesí", {}), "fantasia": ("rey_esqueleto", "Rey Nigromante", {}), "espacio": ("robot_gigante", "Mecha Titán", {}),
         "futurista": ("robot_gigante", "Guardián Omega", {}), "zombies": ("zombie", "Zombi Colosal", {"_escala": 1.0, "complexion": "enorme"}),
         "militar": ("comandante_enemigo", "Comandante Hierro", {}), "desierto": ("golem_gigante", "Gólem de Arena", {"camisa": "#c9a56a", "metal": "#a8864a"}),
         "nieve": ("yeti", "Yeti Ancestral", {}), "oceano": ("cangrejo", "Cangrejo Colosal", {}), "ciudad": ("robot_gigante", "Robot Destructor", {}),
         "dinosaurios": ("trex", "T-Rex Alfa", {}), "andes": ("golem_gigante", "Guardián del Volcán", {"luz": "#ff5a1a"}),
         "deportes": ("deportista", "Campeón Invicto", {"camisa": "#e8c040"}), "exploracion": ("golem_gigante", "Guardián Antiguo", {})}
# enemigos típicos por temática: (forma para el motor, plantilla, nombre)
ENEMIGOS_TEMA = {
    "granja": [("cuervo", "cuervo", "Cuervos ladrones"), ("espantapajaros", "espantapajaros", "Espantapájaros vivientes"), ("calabaza", "calabaza_saltarina", "Calabazas saltarinas")],
    "terror": [("fantasma", "fantasma", "Fantasmas"), ("esqueleto", "esqueleto", "Esqueletos"), ("murcielago", "murcielago", "Murciélagos")],
    "bosque": [("lobo", "lobo", "Lobos"), ("arana", "arana", "Arañas"), ("jabali", "jabali", "Jabalíes")],
    "medieval": [("esqueleto", "esqueleto", "Esqueletos"), ("goblin", "goblin", "Goblins"), ("caballero", "caballero_oscuro", "Caballeros oscuros")],
    "fantasia": [("slime", "slime", "Slimes"), ("goblin", "goblin", "Goblins"), ("murcielago", "murcielago", "Murciélagos")],
    "espacio": [("alien", "alien", "Alienígenas"), ("dron", "dron", "Drones"), ("robot", "robot", "Robots")],
    "futurista": [("dron", "dron", "Drones"), ("robot", "robot", "Robots"), ("soldado", "soldado_enemigo", "Mercenarios")],
    "zombies": [("zombie", "zombie", "Zombis"), ("arana", "arana", "Arañas mutantes"), ("perro", "perro", "Perros infectados")],
    "militar": [("soldado", "soldado_enemigo", "Soldados enemigos"), ("mercenario", "mercenario", "Mercenarios"), ("dron", "dron", "Drones de ataque")],
    "desierto": [("escorpion", "escorpion", "Escorpiones"), ("momia", "momia", "Momias"), ("serpiente", "serpiente", "Serpientes")],
    "nieve": [("lobo", "lobo", "Lobos blancos"), ("yeti", "yeti", "Yetis jóvenes"), ("murcielago", "murcielago", "Murciélagos de hielo")],
    "oceano": [("cangrejo", "cangrejo", "Cangrejos"), ("esqueleto", "esqueleto", "Piratas esqueleto"), ("serpiente", "serpiente", "Serpientes marinas")],
    "ciudad": [("robot", "robot", "Robots"), ("bandido", "bandido", "Bandidos"), ("dron", "dron", "Drones")],
    "dinosaurios": [("dinosaurio", "raptor", "Raptores"), ("serpiente", "serpiente", "Serpientes"), ("abeja", "abeja", "Insectos gigantes")],
    "andes": [("condor", "condor", "Cóndores"), ("zorro", "zorro", "Zorros"), ("golem", "golem", "Gólems de lava")],
    "deportes": [("bandido", "bandido", "Rivales")],
}
ENEMIGOS_TEMA["exploracion"] = ENEMIGOS_TEMA["bosque"]
COLOR_FORMA = {"cuervo": "#1a1a22", "espantapajaros": "#c8a672", "calabaza": "#ff7a1a", "fantasma": "#e8f0ff", "esqueleto": "#efe8d6", "murcielago": "#3a2a2e",
               "lobo": "#6b6b73", "arana": "#2a2226", "jabali": "#4a3a30", "goblin": "#8ab04a", "caballero": "#3a3a44", "slime": "#5ad05a",
               "alien": "#a8b8a0", "dron": "#e8ecf0", "robot": "#c8ccd2", "soldado": "#4a4a52", "mercenario": "#5a4a3a", "zombie": "#8fa47a", "perro": "#8a6a4a",
               "escorpion": "#8a4b2a", "momia": "#d8c8a0", "serpiente": "#4a8a3a", "yeti": "#f0f4f8", "cangrejo": "#e0502a", "bandido": "#6a5a4a",
               "dinosaurio": "#5a8f3a", "abeja": "#f0c020", "condor": "#1a1a1a", "zorro": "#d8702a", "golem": "#8a847a"}
VOLADORES = {"cuervo", "murcielago", "condor", "dron", "abeja", "fantasma"}
NPC_TEMA = {"granja": ("abuela", "Abuela Rosa"), "terror": ("sabio", "El Guardián del Faro"), "medieval": ("aldeano", "Herrero Tomás"),
            "fantasia": ("sabio", "Maestra Lúmina"), "espacio": ("astronauta", "Comandante Vega"), "futurista": ("cyberpunk", "Nova, la informante"),
            "zombies": ("superviviente", "Doc Ramírez"), "militar": ("general", "General Ortiz"), "desierto": ("mercader", "Mercader Farid"),
            "nieve": ("vikingo", "Anciano Bjorn"), "oceano": ("pirata", "Capitana Morgana"), "ciudad": ("deportista", "Leo, el mensajero"),
            "dinosaurios": ("explorador", "Dra. Grant"), "andes": ("sabio", "Taita Inti"), "bosque": ("cazador", "Guardabosques Elena"),
            "deportes": ("deportista", "Entrenador Díaz"), "exploracion": ("explorador", "Cartógrafo Iván")}
# obstáculos y contratiempos que encajan con cada sub-temática
OBST_TEMA = {"granja": ["lodo", "tronco", "trampa", "zarzas"], "bosque": ["tronco", "zarzas", "trampa", "rocas"], "terror": ["zarzas", "pendulo", "fuego", "trampa"],
             "medieval": ["pendulo", "pinchos", "fuego", "rocas"], "fantasia": ["pinchos", "fuego", "zarzas", "pendulo"], "espacio": ["rocas", "fuego", "pinchos"],
             "futurista": ["pinchos", "fuego", "pendulo"], "zombies": ["fuego", "trampa", "pinchos"], "militar": ["trampa", "fuego", "rocas"],
             "desierto": ["pinchos", "rocas", "fuego", "pendulo"], "nieve": ["hielo", "rocas", "tronco"], "oceano": ["pinchos", "tronco", "rocas"],
             "ciudad": ["pinchos", "fuego", "trampa"], "dinosaurios": ["lodo", "rocas", "fuego", "tronco"], "andes": ["rocas", "hielo", "lodo", "tronco"],
             "deportes": ["lodo", "pinchos"]}
CONTRA_TEMA = {"granja": ["ladron", "tormenta", "noche", "emboscada"], "terror": ["niebla", "emboscada", "noche", "tormenta"],
               "bosque": ["tormenta", "emboscada", "derrumbe", "noche"], "medieval": ["emboscada", "derrumbe", "tormenta", "noche"],
               "fantasia": ["niebla", "emboscada", "tormenta", "noche"], "espacio": ["derrumbe", "emboscada", "niebla"],
               "futurista": ["emboscada", "tormenta", "niebla"], "zombies": ["noche", "emboscada", "ladron", "tormenta"],
               "militar": ["emboscada", "derrumbe", "niebla"], "desierto": ["tormenta", "derrumbe", "ladron", "noche"],
               "nieve": ["tormenta", "derrumbe", "noche", "niebla"], "oceano": ["tormenta", "ladron", "niebla", "emboscada"],
               "ciudad": ["ladron", "emboscada", "noche"], "dinosaurios": ["derrumbe", "emboscada", "tormenta"],
               "andes": ["niebla", "derrumbe", "tormenta", "noche"], "deportes": ["tormenta", "noche"]}
TEXTO_CONTRA = {
    "ladron": "¡{enemigo} te roba parte de lo que llevas y huye! Atrápalo para recuperarlo.",
    "tormenta": "Se desata una tormenta: lluvia, viento y relámpagos. Busca refugio y no pierdas el camino.",
    "noche": "Cae la noche de golpe: enciende la linterna, los enemigos se vuelven más agresivos.",
    "emboscada": "¡Emboscada! Una oleada de {enemigo} sale de todas partes.",
    "derrumbe": "¡Derrumbe! Caen rocas desde lo alto: mira las sombras y esquívalas.",
    "niebla": "Una niebla espesa lo cubre todo: guíate por la brújula.",
}
OBJETO_TEMA = {"calabaza": "granja", "huevo": "dinosaurios", "cofre": "oceano", "cristal": "fantasia", "estrella": "fantasia", "llave": "terror",
               "botiquin": "zombies", "fruta": "granja", "gema": "bosque", "moneda": "medieval"}
ENEMIGO_TEMA = {"zombie": "zombies", "esqueleto": "terror", "fantasma": "terror", "robot": "futurista", "alien": "espacio", "dinosaurio": "dinosaurios",
                "escorpion": "desierto", "cangrejo": "oceano", "condor": "andes", "lobo": "bosque", "slime": "fantasia", "soldado": "militar",
                "bruja": "terror", "demonio": "terror", "oso": "bosque", "zorro": "granja"}

EJEMPLOS = DATA_DIR / "director_ejemplos.json"


def _n(t):
    import unicodedata
    t = unicodedata.normalize("NFKD", str(t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def _plural(p):
    return p + ("s" if p[-1:] in "aeiou" else "es")


# ════════════════════════════════ 1. BORRADOR LOCAL (siempre completo) ════════════════════════════════
def expandir(d, idea="", perfil=None):
    """Agrega d["campana"] completa al diseño base (el de juegos.plan_local/normalizar). Sin IA, determinista."""
    idea = idea or d.get("idea") or d.get("descripcion") or ""
    rnd = random.Random(int(hashlib.md5(_n(idea).encode()).hexdigest()[:8], 16))
    gen = d.get("genero") or "aventura"
    tema = _tema_campana(d, idea)
    nivel = (perfil or {}).get("nivel") or (d.get("calidad") or {}).get("nivel") or "medio"
    n_zonas = 5 if nivel in ("alto", "ultra") else 4
    if gen in ("carreras", "deportes"):
        n_zonas = 3
    objeto = (d.get("objetos") or [{}])[0]
    forma_obj = objeto.get("forma") or "gema"
    nom_obj = _plural(forma_obj)
    # la temática de la travesía manda en el mundo (colores y decoración de la zona 1 y de los menús)
    if tema != d.get("tema"):
        from . import juegos as JG
        t = JG.TEMAS.get(tema) or JG.TEMAS.get(ZONAS_TEMA.get(tema, [("", "bosque")])[0][1]) or JG.TEMAS["bosque"]
        d["tema"] = tema if tema in JG.TEMAS else d.get("tema")
        d.setdefault("ambiente", {}).update(cielo=t["cielo"], horizonte=t["horizonte"], suelo=t["suelo"], agua=t["agua"])
        d["decoracion"] = [{"tipo": x, "modelo": x, "cantidad": n} for x, n in t["decoracion"]]
    # enemigos: los que pide la idea primero y luego los de la temática (hasta 3 tipos)
    enemigos = list(d.get("enemigos") or [])
    if not _idea_nombra_enemigo(idea):
        enemigos = []
    nombres_tema = {f: n for lst in ENEMIGOS_TEMA.values() for f, _p, n in lst}
    for e in enemigos:  # «Condor» → «Cóndores»
        if e.get("forma") in nombres_tema and _n(e.get("nombre")) == _n(e.get("forma")):
            e["nombre"] = nombres_tema[e["forma"]]
    if gen not in ("puzle", "exploracion", "carreras", "deportes") or enemigos:
        formas = {e.get("forma") for e in enemigos}
        vecinos = [x for z in (ZONAS_TEMA.get(tema) or []) for x in ENEMIGOS_TEMA.get(z[1], [])]
        for forma, _pl, nombre in list(ENEMIGOS_TEMA.get(tema, ENEMIGOS_TEMA["bosque"])) + vecinos:
            if len(enemigos) >= 3:
                break
            if forma in formas or forma == forma_obj:
                continue
            enemigos.append({"nombre": nombre, "modelo": f"enemigo{len(enemigos) + 1}" if enemigos else "enemigo", "forma": forma,
                             "color": COLOR_FORMA.get(forma, "#8a5aff"), "cantidad": 6, "velocidad": 3.4 if forma not in VOLADORES else 4.2,
                             "danio": 10, "vida": 30, "comportamiento": "perseguir"})
            formas.add(forma)
        for i, e in enumerate(enemigos):
            e["modelo"] = "enemigo" if i == 0 else f"enemigo{i + 1}"
            e.setdefault("color", COLOR_FORMA.get(e.get("forma"), "#8a5aff"))
    d["enemigos"] = enemigos
    zonas_base = list(ZONAS_TEMA.get(tema) or ZONAS_TEMA["bosque"])
    zonas_base = zonas_base[:n_zonas - 1] + [zonas_base[-1]]
    obst_pool = list(OBST_TEMA.get(tema) or ["pinchos", "tronco", "rocas"])
    contra_pool = list(CONTRA_TEMA.get(tema) or ["tormenta", "emboscada", "noche"])
    rnd.shuffle(contra_pool)
    obj_tipo = {"disparos": "derrotar", "supervivencia": "sobrevivir", "plataformas": "llegar", "carreras": "carrera", "terror": "recolectar",
                "construccion": "construir", "deportes": "recolectar"}.get(gen, "recolectar")
    zonas = []
    total_obj = 0
    pedido = _cantidad_pedida(idea, forma_obj)
    reparto = None
    if pedido and obj_tipo == "recolectar":  # «recoge 20 gemas» → 20 repartidas entre las zonas (cada vez más)
        n = len(zonas_base) - (1 if gen not in ("carreras", "deportes") else 0)
        pesos = [1 + 0.35 * k for k in range(n)]
        reparto = [max(1, round(pedido * w / sum(pesos))) for w in pesos]
        reparto[-1] += pedido - sum(reparto)
    for i, (nombre, subtema, hora, clima) in enumerate(zonas_base):
        final = i == len(zonas_base) - 1
        f = i / max(1, len(zonas_base) - 1)  # 0 → 1: sube la dificultad
        carrera_final = final and gen in ("carreras", "deportes")
        if final and not carrera_final:
            ob = {"tipo": "jefe", "cantidad": 1, "texto": f"Derrota {_al(JEFES.get(tema, JEFES['granja'])[1])}"}
        elif carrera_final and obj_tipo == "carrera":
            ob = {"tipo": "carrera", "cantidad": 3, "texto": "Gran final: gana la carrera de 3 vueltas"}
        elif obj_tipo == "recolectar":
            cant = reparto[i] if reparto else 6 + i * 2
            ob = {"tipo": "recolectar", "cantidad": cant, "texto": f"Recoge {cant} {nom_obj}"}
            total_obj += cant
        elif obj_tipo == "derrotar":
            cant = 6 + i * 4
            ob = {"tipo": "derrotar", "cantidad": cant, "texto": f"Derrota a {cant} enemigos"}
        elif obj_tipo == "sobrevivir":
            cant = 45 + i * 20
            ob = {"tipo": "sobrevivir", "cantidad": cant, "texto": f"Resiste {cant} segundos"}
        elif obj_tipo == "carrera":
            cant = 2 + (i >= 1)
            ob = {"tipo": "carrera", "cantidad": cant, "texto": f"Gana la carrera de {cant} vueltas"}
        elif obj_tipo == "construir":
            cant = 15 + i * 10
            ob = {"tipo": "construir", "cantidad": cant, "texto": f"Coloca {cant} bloques"}
        else:
            ob = {"tipo": "llegar", "cantidad": 1, "texto": "Llega a la bandera del final de la zona"}
        n_obst = 0 if i == 0 else (1 if final else min(3, 1 + i))
        obst = [obst_pool[(i + k) % len(obst_pool)] for k in range(n_obst)] if gen not in ("carreras", "deportes") else []
        contra = None
        if gen in ("carreras", "deportes"):
            contra_pool = ["tormenta", "noche", "niebla"]
        if i >= 1 and (not final or gen in ("carreras", "deportes")):
            tipo_c = contra_pool[(i - 1) % len(contra_pool)]
            en_nom = (enemigos[min(len(enemigos) - 1, 1)]["nombre"] if enemigos else "un bandido").lower()
            contra = {"tipo": tipo_c, "texto": TEXTO_CONTRA[tipo_c].format(enemigo=en_nom).replace("¡un ", "¡Un "), "momento": round(0.4 + 0.2 * rnd.random(), 2)}
        mezcla = []
        for k, e in enumerate(enemigos):
            if k <= i:  # cada zona suma un tipo de enemigo nuevo
                mezcla.append({"ref": k, "cantidad": max(1, round((3 + i * 1.6) * (1 if k == 0 else 0.7)))})
        zonas.append({"id": f"z{i + 1}", "nombre": nombre, "tema": subtema, "hora": hora, "clima": clima,
                      "descripcion": _desc_zona(nombre, i, final, tema), "objetivo": ob, "enemigos": mezcla if gen not in ("puzle", "exploracion") or i > 0 else [],
                      "obstaculos": obst, "contratiempo": contra, "mirador": not final, "dificultad": round(0.8 + 0.35 * f * (len(zonas_base) - 1) / 2, 2),
                      "musica": "calma" if i == 0 else ("tension" if final or hora == "noche" else "aventura"),
                      "potenciadores": (["curacion"] if i == 0 else ["iman", "escudo", "turbo", "furia", "vida_extra"][(i - 1) % 5:(i - 1) % 5 + 2]),
                      "consejo": _consejo(i, gen, d)})
    # protagonista y trajes
    trajes = []
    for k, (pl, nombre, rasgo) in enumerate(TRAJES_TEMA.get(tema) or TRAJES_TEMA["bosque"]):
        r = RASGOS[rasgo]
        trajes.append({"id": f"t{k + 1}", "nombre": nombre, "plantilla": pl, "rasgo": rasgo, "descripcion": r["texto"], "vida": r["vida"],
                       "velocidad": r["velocidad"], "salto": r["salto"], "color": COLORES_TRAJE[k % len(COLORES_TRAJE)],
                       "desbloqueo": 0 if k == 0 else [0, 150, 400, 800][min(k, 3)], "modelo": "jugador" if k == 0 else f"jugador_{k + 1}"})
    trajes[0]["desbloqueo"] = 0
    if len(trajes) > 1:
        trajes[1]["desbloqueo"] = 0  # dos para elegir desde el principio
    armas = []
    if gen not in ("carreras", "puzle", "exploracion", "deportes"):
        for k, (pl, nombre, tipo, proy) in enumerate(ARMAS_TEMA.get(tema) or ARMAS_TEMA["bosque"]):
            base_d = {"cuerpo": 24, "disparo": 14, "magia": 18}[tipo]
            armas.append({"id": pl, "nombre": nombre, "tipo": tipo, "plantilla": pl, "proyectil": proy if tipo != "cuerpo" else None,
                          "danio": base_d + (4 if k >= 2 else 0), "alcance": {"cuerpo": 2.7, "disparo": 30, "magia": 22}[tipo] * (1.35 if pl in ("lanza", "guadana") else 1),
                          "cadencia": {"cuerpo": 0.42, "disparo": 0.3, "magia": 0.7}[tipo] * (1.4 if pl in ("martillo", "guadana", "escopeta") else 1),
                          "desbloqueo": 0 if k < 2 else (1 if k == 2 else 2), "modelo": f"arma_{pl}",
                          "descripcion": {"cuerpo": "Cuerpo a cuerpo: golpe en arco", "disparo": "A distancia: dispara " + (proy or "proyectiles"),
                                          "magia": "Magia: proyectil que busca al enemigo"}[tipo]})
    jpl, jnom, jcamb = JEFES.get(tema, JEFES["granja"])
    jefe = {"nombre": jnom, "plantilla": jpl, "cambios": jcamb, "forma": _forma_de_plantilla(jpl), "vida": 700 if nivel != "basico" else 500,
            "danio": 18, "velocidad": 3.4, "altura": 4.2 if jpl not in ("cangrejo", "arana_reina") else 2.6, "modelo": "jefe",
            "fases": [{"umbral": 1.0, "habilidad": "embestida"}, {"umbral": 0.66, "habilidad": "proyectiles"}, {"umbral": 0.33, "habilidad": "invocar"}],
            "dialogo": [f"¿Creíste que podías llegar hasta aquí? Soy {_el(jnom).lower()}.", "¡Nadie cruza mis tierras y vive para contarlo!"]}
    if gen in ("plataformas",):
        jefe["fases"][1]["habilidad"] = "salto"
    if gen in ("carreras", "deportes"):
        jefe = None
    npl, nnom = NPC_TEMA.get(tema, NPC_TEMA["bosque"])
    zonas[0]["npc"] = {"nombre": nnom, "plantilla": npl, "modelo": "npc",
                       "dialogo": _dialogo_npc(nnom, d, zonas, jefe, nom_obj, gen)}
    if len(zonas) > 2:
        zonas[len(zonas) // 2]["npc"] = {"nombre": nnom, "plantilla": npl, "modelo": "npc",
                                         "dialogo": [f"¡Llegaste hasta {zonas[len(zonas) // 2]['nombre']}! Pocos lo logran.",
                                                     "Te guardé una mejora: elígela sabiamente.",
                                                     f"Más adelante está {zonas[-1]['nombre']}. Prepárate."]}
    historia = _historia(d, idea, tema, zonas, jefe, nom_obj, gen)
    logros = [{"id": "coleccionista", "nombre": "Coleccionista", "descripcion": f"Recoge todos los {nom_obj} de una zona", "tipo": "recoger_todo", "valor": 1},
              {"id": "intocable", "nombre": "Intocable", "descripcion": "Termina una zona sin recibir daño", "tipo": "sin_danio_zona", "valor": 1},
              {"id": "cazador", "nombre": "Cazador", "descripcion": "Derrota a 25 enemigos", "tipo": "derrotar", "valor": 25},
              {"id": "mirador", "nombre": "Ojo de águila", "descripcion": "Visita todos los miradores", "tipo": "miradores", "valor": len([z for z in zonas if z["mirador"]])},
              {"id": "leyenda", "nombre": "Leyenda", "descripcion": f"Derrota {_al(jefe['nombre']) if jefe else 'al campeón'}", "tipo": "jefe", "valor": 1},
              {"id": "inmortal", "nombre": "Inmortal", "descripcion": "Completa la travesía sin perder una vida", "tipo": "sin_morir", "valor": 1},
              {"id": "veloz", "nombre": "Veloz", "descripcion": "Termina una zona en menos de 90 segundos", "tipo": "rapido", "valor": 90}]
    if gen in ("carreras", "deportes"):
        logros = [x for x in logros if x["tipo"] not in ("jefe", "derrotar", "miradores")]
    c = {"version": 1, "tema": tema, "historia": historia, "vidas": 3, "dificultad": "normal", "trajes": trajes, "armas": armas, "zonas": zonas,
         "jefe": jefe, "potenciadores": ["curacion", "iman", "escudo", "turbo", "furia", "vida_extra"],
         "mejoras": ["doble_salto", "danio_extra", "vida_max", "velocidad", "cadencia", "iman_permanente", "alcance", "regeneracion"],
         "logros": logros, "vistas": {"intro": True, "miradores": True, "zona": True}, "referentes": PATRONES.get(gen, PATRONES["aventura"])["referentes"][:3],
         "bucle": PATRONES.get(gen, PATRONES["aventura"])["bucle"]}
    d["campana"] = c
    # objetivo global = la travesía completa
    d["objetivo"] = {"tipo": "campana", "cantidad": len(zonas), "tiempo": 0,
                     "texto": (f"Cruza {len(zonas)} zonas y derrota {_al(jefe['nombre'])}" if jefe else f"Gana las {len(zonas)} competencias")}
    if obj_tipo == "recolectar" and d.get("objetos"):
        d["objetos"][0]["cantidad"] = max(total_obj, d["objetos"][0].get("cantidad") or 0)
    d.setdefault("jugador", {})["vidas"] = 3
    if armas:
        d["jugador"]["arma"] = {"cuerpo": "espada", "disparo": "disparo", "magia": "disparo"}[armas[0]["tipo"]]
    return d


def _idea_nombra_enemigo(idea):
    from . import juegos as JG
    t = _n(idea)
    return any(re.search(r"\b" + re.escape(p) + r"\b", t) for ps in JG.FORMAS_ENEMIGO.values() for p in ps)


FEMENINO = {"calabaza", "gema", "moneda", "estrella", "fruta", "llave", "reliquia", "pocion", "manzana", "bateria", "municion", "pluma", "perla"}


def _art(forma):
    return "las" if forma in FEMENINO else "los"


def _cantidad_pedida(idea, forma):
    from . import juegos as JG
    t = _n(idea)
    for m in re.finditer(r"(\d{1,3})\s+([a-z]+)", t):
        if m.group(2) in (JG.FORMAS_OBJETO.get(forma) or []):
            return max(1, min(300, int(m.group(1))))
    return None


FEMENINO_JEFE = ("reina", "arana", "bruja", "dama", "serpiente", "hidra", "bestia")


def _al(nombre):
    return ("a la " if _n(nombre).split(" ")[0] in FEMENINO_JEFE else "al ") + nombre


def _el(nombre):
    return ("La " if _n(nombre).split(" ")[0] in FEMENINO_JEFE else "El ") + nombre


def _tema_campana(d, idea):
    t = _n(idea)
    tema = d.get("tema") or "bosque"
    obj = ((d.get("objetos") or [{}])[0] or {}).get("forma")
    from . import intencion as I
    det = I.detectar(idea or "")
    if det.get("tema"):
        return det["tema"] if det["tema"] in ZONAS_TEMA else tema
    for e in d.get("enemigos") or []:
        if e.get("forma") in ENEMIGO_TEMA and re.search(r"\b" + re.escape(e["forma"][:5]), t):
            return ENEMIGO_TEMA[e["forma"]]
    if obj in OBJETO_TEMA and re.search(r"\b" + re.escape(obj[:5]), t):
        return OBJETO_TEMA[obj]
    return tema if tema in ZONAS_TEMA else "bosque"


def _forma_de_plantilla(pl):
    from . import figuras3d as F
    inv = {v: k for k, v in F.FORMA_A_PLANTILLA.items() if v}
    return inv.get(pl, "humano")


def _desc_zona(nombre, i, final, tema):
    if final:
        return f"El final de la travesía. En {nombre} espera el jefe: todo lo aprendido se pone a prueba."
    return ["Un lugar tranquilo para aprender a moverte, conocer a tu guía y encontrar lo primero.",
            "El camino se complica: aparecen obstáculos y nuevos enemigos.",
            "La mitad del viaje: vistas increíbles, peligros serios y un contratiempo inesperado.",
            "Casi al final: la noche y los enemigos no dan tregua.",
            "El último tramo antes de la guarida del jefe."][min(i, 4)]


def _consejo(i, gen, d):
    arma = (d.get("jugador") or {}).get("arma")
    base = ["Muévete con WASD, salta con Espacio y habla con los personajes con E.",
            "Esquiva los obstáculos: fíjate en su ritmo antes de pasar.",
            "Sube a los miradores (✦) para ver la zona y ganar puntos.",
            "Usa los potenciadores en el momento justo.",
            "En el jefe: aprende sus movimientos y ataca después de que falle."]
    if i == 0 and arma in ("espada", "disparo"):
        return base[0] + " Ataca con clic o E; cambia de arma con Q o 1-3."
    return base[min(i, 4)]


def _dialogo_npc(nombre, d, zonas, jefe, nom_obj, gen):
    obj = zonas[0]["objetivo"]["texto"].lower()
    lineas = [f"¡Hola, viajero! Soy {nombre}. Te estaba esperando.",
              (f"{_el(jefe['nombre'])} amenaza toda la región. " if jefe else "") + f"Para empezar: {obj}.",
              f"Tu travesía cruza {len(zonas)} zonas: " + ", ".join(z["nombre"] for z in zonas) + ".",
              "Cuidado con los contratiempos: el clima y los enemigos pueden cambiar en cualquier momento. ¡Suerte!"]
    return lineas


def _historia(d, idea, tema, zonas, jefe, nom_obj, gen):
    titulo = d.get("titulo") or "La travesía"
    if jefe:
        premisa = f"{_el(jefe['nombre'])} ha sembrado el caos. Solo tú puedes cruzar {zonas[0]['nombre']} hasta {zonas[-1]['nombre']} y detenerlo."
    else:
        premisa = f"Una competencia legendaria: gana en {', '.join(z['nombre'] for z in zonas)}."
    if gen in ("aventura", "exploracion", "puzle", "terror", "rpg") and nom_obj:
        forma = ((d.get("objetos") or [{}])[0] or {}).get("forma") or ""
        premisa += f" Por el camino, {_art(forma)} {nom_obj} son la clave de todo."
    intro = [titulo.upper(), premisa, f"Tu viaje empieza en {zonas[0]['nombre']}."]
    final = [f"¡Lo lograste! {(_el(jefe['nombre']) + ' ha caído') if jefe else 'Eres el campeón'}.",
             f"Las {len(zonas)} zonas vuelven a estar en paz gracias a ti.", "FIN — gracias por jugar"]
    return {"premisa": premisa, "intro": intro, "final": final, "derrota": "Te quedaste sin vidas… pero toda leyenda vuelve a intentarlo."}


# ════════════════════════════════ 2. NORMALIZAR (vocabulario del motor) ════════════════════════════════
def _txt(v, n=160, defecto=""):
    return str(v).strip()[:n] if isinstance(v, (str, int, float)) and str(v).strip() else defecto


def _num(v, lo, hi, defecto):
    try:
        x = float(v)
        if x != x:
            return defecto
        return max(lo, min(hi, x))
    except (TypeError, ValueError):
        return defecto


def normalizar_campana(ia, borrador, d):
    """Mezcla la campaña de la IA con el borrador: todo lo inválido o faltante se queda con lo del borrador."""
    from . import figuras3d as F
    from . import juegos as JG
    b = json.loads(json.dumps(borrador))
    if not isinstance(ia, dict):
        return b
    out = b
    h = ia.get("historia") if isinstance(ia.get("historia"), dict) else {}
    if h:
        out["historia"]["premisa"] = _txt(h.get("premisa"), 400, b["historia"]["premisa"])
        for k in ("intro", "final"):
            if isinstance(h.get(k), list) and [x for x in h[k] if _txt(x)]:
                out["historia"][k] = [_txt(x, 220) for x in h[k] if _txt(x)][:6]
        out["historia"]["derrota"] = _txt(h.get("derrota"), 200, b["historia"]["derrota"])
    out["vidas"] = int(_num(ia.get("vidas"), 1, 9, b["vidas"]))
    # trajes
    if isinstance(ia.get("trajes"), list) and ia["trajes"]:
        tr = []
        for k, t in enumerate(ia["trajes"][:5]):
            if not isinstance(t, dict):
                continue
            base = b["trajes"][min(k, len(b["trajes"]) - 1)] if b["trajes"] else {}
            pl = t.get("plantilla") if t.get("plantilla") in F.POR_ID and F.POR_ID[t["plantilla"]]["rig"] == "humanoide" else base.get("plantilla", "explorador")
            rasgo = t.get("rasgo") if t.get("rasgo") in RASGOS else base.get("rasgo", "equilibrada")
            r = RASGOS[rasgo]
            tr.append({"id": f"t{k + 1}", "nombre": _txt(t.get("nombre"), 40, base.get("nombre", f"Traje {k + 1}")), "plantilla": pl, "rasgo": rasgo,
                       "descripcion": _txt(t.get("descripcion"), 120, r["texto"]), "vida": _num(t.get("vida"), 0.6, 1.8, r["vida"]),
                       "velocidad": _num(t.get("velocidad"), 0.7, 1.5, r["velocidad"]), "salto": _num(t.get("salto"), 0.7, 1.6, r["salto"]),
                       "color": JG._norm_color(t.get("color"), base.get("color", COLORES_TRAJE[k % 6])),
                       "desbloqueo": int(_num(t.get("desbloqueo"), 0, 5000, base.get("desbloqueo", 0) if k > 1 else 0)),
                       "modelo": "jugador" if k == 0 else f"jugador_{k + 1}"})
        if tr:
            tr[0]["desbloqueo"] = 0
            out["trajes"] = tr
    # armas
    if isinstance(ia.get("armas"), list) and b["armas"]:
        ar = []
        for k, a in enumerate(ia["armas"][:4]):
            if not isinstance(a, dict):
                continue
            pl = a.get("plantilla") if a.get("plantilla") in F.POR_ID and F.POR_ID[a["plantilla"]]["rig"] == "arma" else None
            if not pl:
                pl = F.ARMA_A_PLANTILLA.get(_n(a.get("id") or ""), None) or b["armas"][min(k, len(b["armas"]) - 1)]["plantilla"]
            tipo = a.get("tipo") if a.get("tipo") in TIPOS_ARMA else ("disparo" if pl in ("arco", "ballesta", "tirachinas", "pistola", "rifle", "escopeta", "blaster")
                                                                    else "magia" if pl in ("baculo", "varita") else "cuerpo")
            proy = a.get("proyectil") if a.get("proyectil") in PROYECTILES else ({"arco": "flecha", "ballesta": "flecha", "tirachinas": "piedra", "blaster": "laser"}
                                                                                .get(pl, "bala" if tipo == "disparo" else "magia" if tipo == "magia" else None))
            ar.append({"id": pl if pl not in [x["id"] for x in ar] else f"{pl}{k}", "nombre": _txt(a.get("nombre"), 40, pl.capitalize()), "tipo": tipo, "plantilla": pl,
                       "proyectil": proy if tipo != "cuerpo" else None, "danio": _num(a.get("danio"), 5, 80, 22),
                       "alcance": _num(a.get("alcance"), 1.5, 60, 2.7 if tipo == "cuerpo" else 28), "cadencia": _num(a.get("cadencia"), 0.12, 2.0, 0.45),
                       "desbloqueo": int(_num(a.get("desbloqueo"), 0, 4, 0 if k < 2 else k - 1)), "modelo": f"arma_{pl}",
                       "descripcion": _txt(a.get("descripcion"), 120, "")})
        if ar:
            ar[0]["desbloqueo"] = 0
            out["armas"] = ar
    # zonas
    temas = set(JG.TEMAS)
    if isinstance(ia.get("zonas"), list) and len(ia["zonas"]) >= 2:
        zs = []
        n_en = len(d.get("enemigos") or [])
        for k, z in enumerate(ia["zonas"][:6]):
            if not isinstance(z, dict):
                continue
            base = b["zonas"][min(k, len(b["zonas"]) - 1)]
            final = k == min(len(ia["zonas"]), 6) - 1
            ob = z.get("objetivo") if isinstance(z.get("objetivo"), dict) else {}
            tipo_o = ob.get("tipo") if ob.get("tipo") in ("recolectar", "derrotar", "sobrevivir", "llegar", "carrera", "construir", "jefe") else base["objetivo"]["tipo"]
            if final and b.get("jefe"):
                tipo_o = "jefe"
            elif tipo_o == "jefe":
                tipo_o = base["objetivo"]["tipo"] if base["objetivo"]["tipo"] != "jefe" else "recolectar"
            cant = int(_num(ob.get("cantidad"), 1, 300, base["objetivo"]["cantidad"] if base["objetivo"]["tipo"] == tipo_o else 8))
            mezcla = []
            for m in z.get("enemigos") or []:
                if isinstance(m, dict) and isinstance(m.get("ref"), int) and 0 <= m["ref"] < n_en:
                    mezcla.append({"ref": m["ref"], "cantidad": int(_num(m.get("cantidad"), 0, 25, 3))})
            ct = z.get("contratiempo") if isinstance(z.get("contratiempo"), dict) else None
            if ct and ct.get("tipo") in CONTRATIEMPOS:
                ct = {"tipo": ct["tipo"], "texto": _txt(ct.get("texto"), 200, CONTRATIEMPOS[ct["tipo"]]), "momento": _num(ct.get("momento"), 0.15, 0.85, 0.5)}
            else:
                ct = base.get("contratiempo") if not final else None
            npc = z.get("npc") if isinstance(z.get("npc"), dict) else None
            if npc and isinstance(npc.get("dialogo"), list) and npc["dialogo"]:
                pl = npc.get("plantilla") if npc.get("plantilla") in F.POR_ID and F.POR_ID[npc["plantilla"]]["rig"] == "humanoide" else (base.get("npc") or {}).get("plantilla", "aldeano")
                npc = {"nombre": _txt(npc.get("nombre"), 40, "Guía"), "plantilla": pl, "modelo": "npc", "dialogo": [_txt(x, 220) for x in npc["dialogo"] if _txt(x)][:6]}
            else:
                npc = base.get("npc")
            zs.append({"id": f"z{k + 1}", "nombre": _txt(z.get("nombre"), 50, base["nombre"]), "tema": z.get("tema") if z.get("tema") in temas else base["tema"],
                       "hora": z.get("hora") if z.get("hora") in ("dia", "atardecer", "noche") else base["hora"],
                       "clima": z.get("clima") if z.get("clima") in ("despejado", "niebla", "lluvia", "nieve") else base["clima"],
                       "descripcion": _txt(z.get("descripcion"), 240, base["descripcion"]),
                       "objetivo": {"tipo": tipo_o, "cantidad": 1 if tipo_o == "jefe" else cant,
                                    "texto": _txt(ob.get("texto"), 120, base["objetivo"]["texto"] if base["objetivo"]["tipo"] == tipo_o else f"{tipo_o} {cant}")},
                       "enemigos": mezcla or base["enemigos"], "obstaculos": [o for o in (z.get("obstaculos") or []) if o in OBSTACULOS][:4] or base["obstaculos"],
                       "contratiempo": ct, "mirador": bool(z.get("mirador", base["mirador"])) and not final, "dificultad": _num(z.get("dificultad"), 0.5, 2.5, base["dificultad"]),
                       "musica": z.get("musica") if z.get("musica") in ("calma", "aventura", "tension") else base["musica"],
                       "potenciadores": [p for p in (z.get("potenciadores") or []) if p in POTENCIADORES][:3] or base["potenciadores"],
                       "consejo": _txt(z.get("consejo"), 160, base["consejo"]), **({"npc": npc} if npc else {})})
        if len(zs) >= 2:
            out["zonas"] = zs
    # jefe
    if isinstance(ia.get("jefe"), dict) and b.get("jefe"):
        j = ia["jefe"]
        pl = j.get("plantilla") if j.get("plantilla") in F.POR_ID and F.POR_ID[j["plantilla"]]["rig"] != "arma" and F.POR_ID[j["plantilla"]]["rig"] != "objeto" \
            and F.POR_ID[j["plantilla"]]["rig"] != "escenario" else b["jefe"]["plantilla"]
        fases = [{"umbral": _num(f.get("umbral"), 0.05, 1.0, 1.0), "habilidad": f.get("habilidad")} for f in (j.get("fases") or [])
                 if isinstance(f, dict) and f.get("habilidad") in HABILIDADES_JEFE][:4]
        out["jefe"] = dict(b["jefe"], nombre=_txt(j.get("nombre"), 50, b["jefe"]["nombre"]), plantilla=pl, forma=_forma_de_plantilla(pl),
                           cambios=b["jefe"]["cambios"] if pl == b["jefe"]["plantilla"] else {},
                           vida=_num(j.get("vida"), 150, 3000, b["jefe"]["vida"]), danio=_num(j.get("danio"), 5, 60, b["jefe"]["danio"]),
                           fases=sorted(fases, key=lambda f: -f["umbral"]) or b["jefe"]["fases"],
                           dialogo=[_txt(x, 200) for x in (j.get("dialogo") or []) if _txt(x)][:4] or b["jefe"]["dialogo"])
        out["jefe"]["fases"][0]["umbral"] = 1.0
    if isinstance(ia.get("logros"), list):
        lg = []
        for x in ia["logros"][:10]:
            if isinstance(x, dict) and x.get("tipo") in LOGROS_TIPOS:
                lg.append({"id": re.sub(r"[^a-z0-9_]", "", _n(x.get("id") or x.get("nombre") or "logro"))[:24] or f"l{len(lg)}",
                           "nombre": _txt(x.get("nombre"), 40, "Logro"), "descripcion": _txt(x.get("descripcion"), 120, ""), "tipo": x["tipo"],
                           "valor": int(_num(x.get("valor"), 1, 999, 1))})
        if len(lg) >= 3:
            out["logros"] = lg
    return out


# ════════════════════════════════ 3. RÚBRICA DE CALIDAD + AUTOCOMPLETAR ════════════════════════════════
RUBRICA = [  # (id, peso, descripción)
    ("zonas", 10, "Travesía de al menos 3 zonas con nombre y objetivo propio"),
    ("dificultad", 7, "La dificultad sube de zona en zona (más enemigos y peligros)"),
    ("historia", 7, "Historia con premisa, introducción y final"),
    ("jefe", 8, "Jefe final con al menos 2 fases de ataque"),
    ("trajes", 7, "Al menos 3 trajes/personajes para elegir con rasgos distintos"),
    ("armas", 7, "Al menos 2 armas para elegir (si el género tiene combate)"),
    ("vidas", 6, "Vidas y puntos de control para no empezar de cero"),
    ("obstaculos", 7, "Al menos 3 tipos de obstáculos repartidos en las zonas"),
    ("contratiempos", 6, "Al menos 2 contratiempos que cambian la partida"),
    ("potenciadores", 5, "Potenciadores en el mundo y mejoras para elegir entre zonas"),
    ("npc", 5, "Al menos un personaje con diálogos que guía al jugador"),
    ("vistas", 5, "Vistas panorámicas: vuelo de presentación y miradores"),
    ("logros", 5, "Al menos 4 logros"),
    ("tutorial", 4, "La primera zona enseña los controles (sin peligros fuertes)"),
    ("enemigos", 5, "Variedad de enemigos (2 o más tipos) si el género tiene combate"),
    ("idea", 6, "Respeta la idea del usuario (lo que se recoge, contra quién y dónde)"),
]


def evaluar(d, idea=""):
    """→ {"puntaje": 0-100, "fallas": [ids], "detalle": {id: bool}}"""
    c = d.get("campana") or {}
    gen = d.get("genero")
    combate = gen not in ("carreras", "puzle", "exploracion", "deportes")
    zs = c.get("zonas") or []
    ok = {}
    ok["zonas"] = len(zs) >= 3 and all(z.get("nombre") and (z.get("objetivo") or {}).get("tipo") for z in zs)
    difs = [z.get("dificultad", 1) for z in zs]
    ok["dificultad"] = len(difs) >= 2 and difs[-1] > difs[0] and sum(1 for a, b in zip(difs, difs[1:]) if b < a) == 0
    h = c.get("historia") or {}
    ok["historia"] = bool(h.get("premisa") and len(h.get("intro") or []) >= 2 and h.get("final"))
    j = c.get("jefe")
    ok["jefe"] = (not combate and gen in ("carreras", "deportes")) or bool(j and len(j.get("fases") or []) >= 2)
    ok["trajes"] = len(c.get("trajes") or []) >= 3 and len({t.get("rasgo") for t in c.get("trajes") or []}) >= 2
    ok["armas"] = (not combate) or len(c.get("armas") or []) >= 2
    ok["vidas"] = (c.get("vidas") or 0) >= 2
    ok["obstaculos"] = gen in ("carreras", "deportes") or len({o for z in zs for o in z.get("obstaculos") or []}) >= 3
    ok["contratiempos"] = sum(1 for z in zs if z.get("contratiempo")) >= min(2, max(1, len(zs) - 1))
    ok["potenciadores"] = len(c.get("potenciadores") or []) >= 3 and len(c.get("mejoras") or []) >= 3
    ok["npc"] = any((z.get("npc") or {}).get("dialogo") for z in zs)
    ok["vistas"] = bool((c.get("vistas") or {}).get("intro")) and sum(1 for z in zs if z.get("mirador")) >= 2
    ok["logros"] = len(c.get("logros") or []) >= 4
    ok["tutorial"] = bool(zs) and len(zs[0].get("obstaculos") or []) <= 1 and bool(zs[0].get("consejo"))
    ok["enemigos"] = (not combate) or len(d.get("enemigos") or []) >= 2
    ok["idea"] = _fiel_a_idea(d, idea)
    total = sum(p for _, p, _ in RUBRICA)
    puntos = sum(p for k, p, _ in RUBRICA if ok.get(k))
    return {"puntaje": round(100 * puntos / total), "fallas": [k for k, _, _ in RUBRICA if not ok.get(k)], "detalle": ok}


def _fiel_a_idea(d, idea):
    t = _n(idea)
    from . import juegos as JG
    for f, ps in JG.FORMAS_OBJETO.items():
        if any(re.search(r"\b" + re.escape(p) + r"\b", t) for p in ps):
            if not any(o.get("forma") == f for o in d.get("objetos") or []):
                return False
    for f, ps in JG.FORMAS_ENEMIGO.items():
        if any(re.search(r"\b" + re.escape(p) + r"\b", t) for p in ps):
            if not any(e.get("forma") == f for e in d.get("enemigos") or []):
                return False
    return True


def completar(d, idea="", perfil=None):
    """Arregla lo que la rúbrica encontró mal con piezas del borrador local (lo bueno de la IA se conserva)."""
    ev = evaluar(d, idea)
    if not ev["fallas"]:
        return d, ev, []
    ref = expandir(json.loads(json.dumps({k: v for k, v in d.items() if k != "campana"})), idea, perfil)["campana"]
    c = d.setdefault("campana", {})
    hecho = []
    for f in ev["fallas"]:
        if f in ("zonas", "dificultad"):
            if len(c.get("zonas") or []) < 3:
                c["zonas"] = ref["zonas"]
            difs = [0.8 + 0.3 * i for i in range(len(c["zonas"]))]
            for z, dv in zip(c["zonas"], difs):
                z["dificultad"] = round(dv, 2)
        elif f == "historia":
            c["historia"] = ref["historia"]
        elif f == "jefe" and ref.get("jefe"):
            c["jefe"] = dict(ref["jefe"], **{k: v for k, v in (c.get("jefe") or {}).items() if k in ("nombre", "dialogo") and v})
            if len(c["jefe"].get("fases") or []) < 2:
                c["jefe"]["fases"] = ref["jefe"]["fases"]
        elif f == "trajes":
            c["trajes"] = (c.get("trajes") or []) + [t for t in ref["trajes"] if t["plantilla"] not in {x["plantilla"] for x in c.get("trajes") or []}]
            c["trajes"] = c["trajes"][:4]
            for k, t in enumerate(c["trajes"]):
                t["modelo"] = "jugador" if k == 0 else f"jugador_{k + 1}"
                t["id"] = f"t{k + 1}"
        elif f == "armas":
            c["armas"] = (c.get("armas") or []) + [a for a in ref["armas"] if a["plantilla"] not in {x["plantilla"] for x in c.get("armas") or []}]
            c["armas"] = c["armas"][:4]
        elif f == "vidas":
            c["vidas"] = 3
        elif f == "obstaculos":
            for z, rz in zip(c.get("zonas") or [], ref["zonas"]):
                if not z.get("obstaculos"):
                    z["obstaculos"] = rz["obstaculos"]
            pool = list(OBST_TEMA.get(ref.get("tema"), ["pinchos", "tronco", "rocas"]))
            k = 0
            while len({o for z in c["zonas"] for o in z.get("obstaculos") or []}) < 3 and k < 10:
                z = c["zonas"][1 + k % max(1, len(c["zonas"]) - 1)] if len(c["zonas"]) > 1 else c["zonas"][0]
                o = pool[k % len(pool)]
                if o not in z.setdefault("obstaculos", []):
                    z["obstaculos"].append(o)
                k += 1
        elif f == "contratiempos":
            for z, rz in zip(c.get("zonas") or [], ref["zonas"]):
                if not z.get("contratiempo") and rz.get("contratiempo"):
                    z["contratiempo"] = rz["contratiempo"]
        elif f == "potenciadores":
            c["potenciadores"] = ref["potenciadores"]
            c["mejoras"] = ref["mejoras"]
        elif f == "npc":
            c["zonas"][0]["npc"] = ref["zonas"][0].get("npc")
        elif f == "vistas":
            c["vistas"] = {"intro": True, "miradores": True, "zona": True}
            for z in c["zonas"][:-1]:
                z["mirador"] = True
        elif f == "logros":
            c["logros"] = (c.get("logros") or []) + ref["logros"]
            c["logros"] = list({x["id"]: x for x in c["logros"]}.values())[:8]
        elif f == "tutorial":
            z0 = c["zonas"][0]
            z0["obstaculos"] = (z0.get("obstaculos") or [])[:1]
            z0["consejo"] = z0.get("consejo") or ref["zonas"][0]["consejo"]
        elif f == "enemigos":
            pass  # expandir() (al recalcular ref) ya agregó enemigos a d
        elif f == "idea":
            from . import juegos as JG
            base = JG._leer_idea(json.loads(json.dumps(d)), idea)
            if base.get("objetos"):
                d["objetos"][0].update({k: base["objetos"][0][k] for k in ("forma", "nombre", "color") if k in base["objetos"][0]})
            if base.get("enemigos") and d.get("enemigos"):
                d["enemigos"][0].update({k: base["enemigos"][0][k] for k in ("forma", "nombre") if k in base["enemigos"][0]})
        hecho.append(f)
    if "enemigos" in ev["fallas"]:
        d["enemigos"] = expandir(json.loads(json.dumps({k: v for k, v in d.items() if k != "campana"})), idea, perfil)["enemigos"]
    ev2 = evaluar(d, idea)
    return d, ev2, hecho


# ════════════════════════════════ 4. IA + EJEMPLOS APRENDIDOS ════════════════════════════════
def _esquema_ia():
    return ("Devuelve SOLO un objeto JSON (sin texto antes ni después) con la MISMA forma del BORRADOR: "
            '{"historia": {"premisa", "intro": [...], "final": [...], "derrota"}, "vidas", "trajes": [{"nombre", "plantilla", "rasgo", "descripcion", "color", "desbloqueo"}], '
            '"armas": [{"nombre", "plantilla", "tipo", "proyectil", "danio", "alcance", "cadencia", "desbloqueo", "descripcion"}], '
            '"zonas": [{"nombre", "tema", "hora", "clima", "descripcion", "objetivo": {"tipo", "cantidad", "texto"}, "enemigos": [{"ref", "cantidad"}], '
            '"obstaculos": [...], "contratiempo": {"tipo", "texto", "momento"}, "mirador", "dificultad", "musica", "potenciadores": [...], "consejo", '
            '"npc": {"nombre", "plantilla", "dialogo": [...]}}], "jefe": {"nombre", "plantilla", "vida", "danio", "fases": [{"umbral", "habilidad"}], "dialogo": [...]}, '
            '"logros": [{"id", "nombre", "descripcion", "tipo", "valor"}]}.\n'
            "VOCABULARIO PERMITIDO (el motor solo sabe jugar esto):\n"
            f"- obstaculos: {', '.join(OBSTACULOS)}\n- contratiempo.tipo: {', '.join(CONTRATIEMPOS)}\n- potenciadores: {', '.join(POTENCIADORES)}\n"
            f"- jefe.fases[].habilidad: {', '.join(HABILIDADES_JEFE)}\n- logros[].tipo: {', '.join(sorted(LOGROS_TIPOS))}\n"
            "- zonas[].hora: dia|atardecer|noche · clima: despejado|niebla|lluvia|nieve · musica: calma|aventura|tension\n"
            "- zonas[].objetivo.tipo: recolectar|derrotar|sobrevivir|llegar|carrera|construir|jefe (la ÚLTIMA zona es 'jefe')\n"
            "- zonas[].tema: " + ", ".join(sorted(ZONAS_TEMA)) + "\n"
            "- armas[].tipo: cuerpo|disparo|magia · proyectil: " + ", ".join(sorted(PROYECTILES)) + "\n"
            "- zonas[].enemigos[].ref: índice (0, 1, 2…) de la lista ENEMIGOS del diseño\n")


def _plantillas_txt():
    from . import figuras3d as F
    por = {}
    for pl in F.PLANTILLAS:
        por.setdefault(pl["cat"], []).append(pl["id"])
    return "; ".join(f"{k}: {', '.join(v)}" for k, v in por.items() if k in ("Personajes", "NPC", "Jefes", "Armas", "Enemigos", "Criaturas", "Voladores"))


def ejemplos(genero=None, n=1):
    try:
        datos = json.loads(EJEMPLOS.read_text(encoding="utf-8"))
    except Exception:
        return []
    lst = [x for x in datos.get("ejemplos") or [] if not genero or x.get("genero") == genero] or datos.get("ejemplos") or []
    lst.sort(key=lambda x: (-(x.get("votos", 0)), -x.get("puntaje", 0), -x.get("t", 0)))
    return lst[:n]


def aprender(d, idea, votos=1):
    """Guarda un diseño aprobado por el usuario como ejemplo para los próximos (máx. 40, sin repetir la misma idea)."""
    c = d.get("campana")
    if not c:
        return False
    try:
        datos = json.loads(EJEMPLOS.read_text(encoding="utf-8"))
    except Exception:
        datos = {"ejemplos": []}
    clave = hashlib.md5(_n(idea).encode()).hexdigest()[:10]
    lst = [x for x in datos.get("ejemplos") or [] if x.get("clave") != clave]
    compacto = {"historia": c.get("historia"), "trajes": [{k: t.get(k) for k in ("nombre", "plantilla", "rasgo")} for t in c.get("trajes") or []],
                "armas": [{k: a.get(k) for k in ("nombre", "plantilla", "tipo")} for a in c.get("armas") or []],
                "zonas": [{k: z.get(k) for k in ("nombre", "tema", "hora", "clima", "objetivo", "obstaculos", "contratiempo")} for z in c.get("zonas") or []],
                "jefe": {k: (c.get("jefe") or {}).get(k) for k in ("nombre", "plantilla", "fases")} if c.get("jefe") else None}
    anterior = next((x for x in datos.get("ejemplos") or [] if x.get("clave") == clave), {})
    lst.append({"clave": clave, "idea": idea[:300], "genero": d.get("genero"), "tema": c.get("tema"), "titulo": d.get("titulo"),
                "puntaje": (c.get("calidad") or {}).get("puntaje", 0), "votos": anterior.get("votos", 0) + votos, "t": int(time.time()), "campana": compacto})
    lst.sort(key=lambda x: (-(x.get("votos", 0)), -x.get("t", 0)))
    datos["ejemplos"] = lst[:40]
    try:
        EJEMPLOS.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        return False
    return True


def dirigir(d, idea, perfil=None, usar_ia=True, limite_seg=75):
    """Diseño base → diseño ÉPICO. → (diseño, informe {"puntaje", "completado", "modelo", "ms", "aviso", "rubrica"})"""
    t0 = time.time()
    d = expandir(d, idea, perfil)
    borrador = d["campana"]
    info = {"modelo": "", "ms": 0, "aviso": "", "completado": []}
    if usar_ia:
        from . import rapida
        gen = d.get("genero") or "aventura"
        pat = PATRONES.get(gen, PATRONES["aventura"])
        ejs = ejemplos(gen, 1)
        sistema = ("Eres el DIRECTOR CREATIVO de un estudio de videojuegos de primer nivel. Tu trabajo: convertir una idea simple en un juego ÉPICO, "
                   "con vida y adictivo, aunque los gráficos sean sencillos. Piensa como los diseñadores de " + ", ".join(pat["referentes"]) + ".\n"
                   f"BUCLE DEL GÉNERO ({gen}): {pat['bucle']}.\nPILARES: " + "; ".join(pat["pilares"]) + f".\nRITMO: {pat['ritmo']}.\n"
                   "REGLAS: 1) Respeta TODO lo que pide la idea (lo que se recoge, contra quién, dónde). 2) Mejora el BORRADOR: nombres evocadores, historia "
                   "con gancho, diálogos con personalidad, contratiempos sorprendentes, armas y trajes que se sientan distintos. 3) La dificultad sube por "
                   "zonas; la primera enseña los controles. 4) Escribe en español, frases cortas. 5) No inventes nada fuera del vocabulario.\n"
                   "PLANTILLAS 3D DISPONIBLES (para trajes, NPC, jefe y armas): " + _plantillas_txt() + "\n" + _esquema_ia())
        enemigos = [{"ref": i, "nombre": e.get("nombre"), "forma": e.get("forma")} for i, e in enumerate(d.get("enemigos") or [])]
        usuario = (f"IDEA DEL USUARIO:\n{idea}\n\nDISEÑO BASE: título «{d.get('titulo')}», género {gen}, estilo {d.get('estilo')}, tema {borrador.get('tema')}, "
                   f"coleccionable principal: {((d.get('objetos') or [{}])[0]).get('nombre')}.\nENEMIGOS: {json.dumps(enemigos, ensure_ascii=False)}\n\n"
                   + (f"EJEMPLO DE UN DISEÑO QUE AL USUARIO LE GUSTÓ (inspírate en su nivel, no lo copies):\n{json.dumps(ejs[0]['campana'], ensure_ascii=False)[:2500]}\n\n" if ejs else "")
                   + f"BORRADOR (mejóralo y devuélvelo completo):\n{json.dumps(_para_ia(borrador), ensure_ascii=False)}")
        try:
            txt, m, ms = rapida.responder(sistema, usuario, max_tokens=6000, limite_seg=limite_seg)
            ia = rapida.json_de(txt)
            if not isinstance(ia, dict):
                raise RuntimeError("la IA no devolvió un JSON válido")
            d["campana"] = normalizar_campana(ia.get("campana") if isinstance(ia.get("campana"), dict) else ia, borrador, d)
            info.update(modelo=m, ms=ms)
        except Exception as e:
            info["aviso"] = f"El director usó su borrador propio (la IA no respondió bien: {str(e)[:140]})."
    d, ev, hecho = completar(d, idea, perfil)
    d["campana"]["calidad"] = {"puntaje": ev["puntaje"], "completado": hecho, "detalle": ev["detalle"],
                               "revisado": [desc for _, _, desc in RUBRICA]}
    # la cantidad total de coleccionables alcanza para todas las zonas
    tot = sum(z["objetivo"]["cantidad"] for z in d["campana"]["zonas"] if z["objetivo"]["tipo"] == "recolectar")
    if tot and d.get("objetos"):
        d["objetos"][0]["cantidad"] = max(tot, 1)
    info.update(puntaje=ev["puntaje"], completado=hecho, rubrica=ev["detalle"], seg=round(time.time() - t0, 1))
    return d, info


def _para_ia(c):
    """El borrador sin los campos internos (más corto para la IA)."""
    x = json.loads(json.dumps(c))
    for k in ("referentes", "bucle", "calidad", "version", "tema", "vistas", "potenciadores", "mejoras"):
        x.pop(k, None)
    for t in x.get("trajes") or []:
        for k in ("id", "vida", "velocidad", "salto", "modelo"):
            t.pop(k, None)
    for a in x.get("armas") or []:
        for k in ("id", "modelo"):
            a.pop(k, None)
    for z in x.get("zonas") or []:
        z.pop("id", None)
        if z.get("npc"):
            z["npc"].pop("modelo", None)
    if x.get("jefe"):
        for k in ("modelo", "cambios", "forma", "altura", "velocidad"):
            x["jefe"].pop(k, None)
    return x


# ════════════════════════════════ 5. TEXTO: el «prompt épico» ════════════════════════════════
def texto(d):
    """Resumen legible del diseño épico (para el chat, el taller de prompts y el README)."""
    c = d.get("campana") or {}
    L = [f"# 🎮 {d.get('titulo')}", "", f"**Género:** {d.get('genero')} · **Estilo:** {d.get('estilo')} (mundo {c.get('tema')}) · "
         f"**Inspirado en:** {', '.join(c.get('referentes') or [])}", "", f"**Historia:** {(c.get('historia') or {}).get('premisa', '')}", "",
         f"**Bucle de juego:** {c.get('bucle', '')}", "", f"**Vidas:** {c.get('vidas')} con puntos de control · **Objetivo:** {(d.get('objetivo') or {}).get('texto')}", ""]
    if c.get("trajes"):
        L += ["## 👕 Trajes para elegir"] + [f"- **{t['nombre']}** — {t['descripcion']}" + (f" (se desbloquea con {t['desbloqueo']} puntos)" if t.get("desbloqueo") else "")
                                             for t in c["trajes"]] + [""]
    if c.get("armas"):
        L += ["## ⚔ Armas para elegir"] + [f"- **{a['nombre']}** ({a['tipo']}) — daño {int(a['danio'])}" + (f", dispara {a['proyectil']}" if a.get("proyectil") else "")
                                          + (f" · se desbloquea en la zona {a['desbloqueo'] + 1}" if a.get("desbloqueo") else "") for a in c["armas"]] + [""]
    L.append("## 🗺 Travesía")
    for i, z in enumerate(c.get("zonas") or []):
        L.append(f"{i + 1}. **{z['nombre']}** ({z['hora']}, {z['clima']}) — {z['objetivo']['texto']}. {z.get('descripcion', '')}")
        if z.get("obstaculos"):
            L.append(f"   - Obstáculos: {', '.join(z['obstaculos'])}")
        if z.get("contratiempo"):
            L.append(f"   - Contratiempo: {z['contratiempo']['texto']}")
        if z.get("npc"):
            L.append(f"   - {z['npc']['nombre']}: «{(z['npc'].get('dialogo') or [''])[0]}»")
        if z.get("mirador"):
            L.append("   - ✦ Mirador con vista panorámica")
    j = c.get("jefe")
    if j:
        L += ["", f"## 👑 Jefe final: {j['nombre']}", "Fases: " + " → ".join(f"{HABILIDADES_JEFE.get(f['habilidad'], f['habilidad'])} (desde {int(f['umbral'] * 100)} % de vida)"
                                                                           for f in j.get("fases") or [])]
    if d.get("enemigos"):
        L += ["", "## 👾 Enemigos"] + [f"- {e['nombre']} ({e.get('forma')})" for e in d["enemigos"]]
    L += ["", "## ✨ Potenciadores y mejoras", ", ".join(POTENCIADORES.get(p, p) for p in c.get("potenciadores") or []),
          "Mejoras entre zonas: " + ", ".join(MEJORAS.get(m, m) for m in c.get("mejoras") or [])]
    if c.get("logros"):
        L += ["", "## 🏆 Logros"] + [f"- **{x['nombre']}**: {x['descripcion']}" for x in c["logros"]]
    q = c.get("calidad") or {}
    if q:
        L += ["", f"**Revisión de calidad del director:** {q.get('puntaje')}/100" + (f" (completó: {', '.join(q.get('completado') or [])})" if q.get("completado") else "")]
    return "\n".join(L)
