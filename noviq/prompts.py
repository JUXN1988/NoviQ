# -*- coding: utf-8 -*-
"""✍ Taller de prompts: corrige la ortografía y la sintaxis de lo que el usuario escribe para las IAs y lo convierte en
un prompt profesional (rol, objetivo, contexto, requisitos, restricciones, formato y criterios de aceptación).

- Corrección LOCAL instantánea (sin internet ni IA): abreviaturas de chat («q», «xq», «tmb»), tildes de palabras
  técnicas comunes, nombres propios de tecnología (NVIDIA, Python, JavaScript…), espacios y mayúsculas.
- Acciones con IA (la más rápida que funcione, ver rapida.py): corregir, profesional, estructurar, más específico,
  traducir al inglés, resumir y «prompt de videojuego». Si no hay IA disponible se usa lo local y se avisa.
- Plantillas de prompts profesionales listas para rellenar (opciones rápidas)."""
import re

from . import rapida

# ───────────── Corrección local ─────────────
# Abreviaturas y faltas frecuentes (palabra completa, sin distinguir mayúsculas).
ABREV = {
    "q": "que", "ke": "que", "xq": "porque", "pq": "porque", "porq": "porque", "xk": "porque",
    "tmb": "también", "tb": "también", "tbn": "también", "tambien": "también", "xa": "para",
    "pa": "para", "aser": "hacer", "aserlo": "hacerlo", "acer": "hacer", "haci": "así", "asi": "así", "ase": "hace",
    "nose": "no sé", "osea": "o sea", "enserio": "en serio", "aveces": "a veces", "porfa": "por favor", "xfa": "por favor",
    "xfavor": "por favor", "grax": "gracias", "profecional": "profesional", "profecionales": "profesionales",
    "profesionl": "profesional", "erramienta": "herramienta", "erramientas": "herramientas", "herramietas": "herramientas",
    "instrruciones": "instrucciones", "intrucciones": "instrucciones", "instruciones": "instrucciones",
    "instrruciones.": "instrucciones.", "sisntaxis": "sintaxis", "sintaxys": "sintaxis", "ortografia": "ortografía",
    "ortograficas": "ortográficas", "ortograficos": "ortográficos", "mejoraminto": "mejoramiento", "mejoramineto": "mejoramiento",
    "dicnos": "dignos", "escrien": "escriben", "escriven": "escriben", "rapidas": "rápidas", "rapidos": "rápidos",
    "rapida": "rápida", "rapido": "rápido", "prondt": "prompt", "prontd": "prompt", "pront": "prompt", "promt": "prompt",
    "prom": "prompt", "pron": "prompt", "prons": "prompts", "prondts": "prompts", "prompst": "prompts", "promts": "prompts", "pronts": "prompts",
    "nvidea": "NVIDIA", "nvidia": "NVIDIA", "minecraf": "Minecraft", "maicra": "Minecraft", "minecraft": "Minecraft",
    "javascrip": "JavaScript", "javascript": "JavaScript", "java": "Java", "python": "Python", "piton": "Python",
    "html": "HTML", "css": "CSS", "json": "JSON", "api": "API", "apy": "API", "apis": "APIs", "sql": "SQL", "pdf": "PDF",
    "windows": "Windows", "linux": "Linux", "github": "GitHub", "excel": "Excel", "word": "Word", "powershell": "PowerShell",
    "threejs": "Three.js", "unity": "Unity", "unreal": "Unreal", "godot": "Godot", "omniverse": "Omniverse",
    "audio2face": "Audio2Face", "ia": "IA", "ias": "IAs", "ai": "AI", "cpu": "CPU", "gpu": "GPU", "ram": "RAM",
    "rtx": "RTX", "cuda": "CUDA", "usb": "USB", "wifi": "wifi", "url": "URL", "3d": "3D", "2d": "2D",
    "codigo": "código", "codigos": "códigos", "pagina": "página", "paginas": "páginas", "aplicacion": "aplicación",
    "aplicaciones": "aplicaciones", "funcion": "función", "funciones": "funciones", "boton": "botón", "botones": "botones",
    "menu": "menú", "numero": "número", "numeros": "números", "facil": "fácil", "dificil": "difícil", "grafico": "gráfico",
    "graficos": "gráficos", "grafica": "gráfica", "graficas": "gráficas", "informacion": "información",
    "configuracion": "configuración", "descripcion": "descripción", "opcion": "opción", "tecnologia": "tecnología",
    "tecnologias": "tecnologías", "analisis": "análisis", "musica": "música", "fisica": "física", "logica": "lógica",
    "basico": "básico", "basica": "básica", "automatico": "automático", "automatica": "automática",
    "automaticamente": "automáticamente", "electronico": "electrónico", "diseno": "diseño", "disenos": "diseños",
    "animacion": "animación", "animaciones": "animaciones", "generacion": "generación", "creacion": "creación",
    "version": "versión", "sesion": "sesión", "conexion": "conexión", "seccion": "sección", "solucion": "solución",
    "tambn": "también", "despues": "después", "ademas": "además", "aqui": "aquí", "alli": "allí", "ahi": "ahí",
    "tambie": "también", "facilmente": "fácilmente", "unicamente": "únicamente", "rapidamente": "rápidamente",
    "caracteristicas": "características", "caracteristica": "característica", "busqueda": "búsqueda", "imagen": "imagen",
    "imagenes": "imágenes", "video": "video", "videos": "videos", "archivo": "archivo", "carpeta": "carpeta",
    "vehiculo": "vehículo", "vehiculos": "vehículos", "energia": "energía", "categoria": "categoría",
    "categorias": "categorías", "galeria": "galería", "galerias": "galerías", "inteligencia artifical": "inteligencia artificial",
    "artifical": "artificial", "videojuegos": "videojuegos", "vidiojuego": "videojuego", "vidiojuegos": "videojuegos",
    "jeugo": "juego", "jeugos": "juegos", "pixelados": "pixelados", "procesador": "procesador", "tarjeta": "tarjeta",
    "ejecucion": "ejecución", "compilacion": "compilación", "optimizacion": "optimización", "programacion": "programación",
    "programaciones": "programaciones", "estandar": "estándar", "intenciones": "intenciones", "multilingue": "multilingüe",
    "linguistico": "lingüístico", "pequeno": "pequeño", "pequena": "pequeña", "ano": "año", "anos": "años",
}
# Estas NO se tocan aunque coincidan (código, rutas, palabras en inglés con otro sentido…).
_NO_TOCAR_RX = re.compile(r"`[^`]*`|```.*?```|https?://\S+|[A-Za-z]:\\\S+|\S+\.(?:py|js|html|css|json|md|txt|bat|ps1|exe)\b", re.S)
# «has que» / «has click» → «haz» (imperativo); «hay q» → «hay que»; «a ser» → «a hacer» cuando sigue un infinitivo…
FRASES = [
    (r"\bhas\s+(que|q|click|clic)\b", r"haz \1"), (r"\bhas\s+lo\b", "hazlo"), (r"\bhaslo\b", "hazlo"),
    (r"\bmejora\s+esto\b", "mejora esto"), (r"\bponle\s+erramientas\b", "ponle herramientas"),
    (r"\bno\s+da[ñn]es\s+da[ñn]a\b", "no dañes nada"), (r"\bda[ñn]a\s+de\s+lo\s+que\b", "nada de lo que"),
    (r"\ba\s+menos\s+q\b", "a menos que"), (r"\bpara\s+q\b", "para que"), (r"\bya\s+q\b", "ya que"),
    (r"\bmas\s+(profesional\w*|rápid\w*|rapid\w*|fácil\w*|facil\w*|grande\w*|pequeñ\w*|bonit\w*|clar\w*|simple\w*|complet\w*|específic\w*|especific\w*|potente\w*|real\w*|lent\w*|liviano\w*|pesad\w*)", r"más \1"),
    (r"\bmas\s+de\b", "más de"), (r"\bmas\s+que\b", "más que"), (r"\bmas\s+tarde\b", "más tarde"),
    (r"\bsi\s+no\s+soporta\b", "si no soporta"), (r"\bestoces\b", "entonces"), (r"\bentoces\b", "entonces"),
    (r"\bsen\s+optimizar\b", "sin optimizar"), (r"\bjuego\s+sen\b", "juegos en"),
    (r"\b(los|unos|estos|esos|tus|mis|sus|varios|muchos)\s+prompt\b", r"\1 prompts"),
]


def _caso(orig, nuevo):
    if nuevo[:1].isupper() or nuevo.isupper():
        return nuevo  # nombres propios y siglas (NVIDIA, Python…)
    if orig.isupper() and len(orig) > 1:
        return nuevo.upper()
    if orig[:1].isupper():
        return nuevo[:1].upper() + nuevo[1:]
    return nuevo


def corregir_local(texto):
    """(texto_corregido, lista_de_cambios). Rápido, sin IA; no toca código, rutas ni URLs."""
    if not texto or not texto.strip():
        return texto, []
    cambios = []
    protegidos = {}

    def _proteger(m):
        k = f"⁣{len(protegidos)}⁣"
        protegidos[k] = m.group(0)
        return k
    t = _NO_TOCAR_RX.sub(_proteger, texto)
    for rx, rep in FRASES:
        nuevo = re.sub(rx, rep, t, flags=re.I)
        if nuevo != t:
            cambios.append(rx.replace("\\b", "").replace("\\s+", " ")[:30] + " → " + rep.replace("\\1", "…"))
            t = nuevo

    def _pal(m):
        w = m.group(0)
        rep = ABREV.get(w.lower())
        if rep is None or rep == w:
            return w
        out = _caso(w, rep)
        if out != w:
            cambios.append(f"{w} → {out}")
        return out
    t = re.sub(r"(?<![\w⁣.\-/])[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9]+(?![\w⁣\-/]|\.\w)", _pal, t)
    for rx, rep in FRASES:  # segunda pasada: «mas profecionales» → «más profesionales» ya con la palabra corregida
        t = re.sub(rx, rep, t, flags=re.I)
    # espacios: dobles, antes de puntuación, después de coma/punto
    t2 = re.sub(r"[ \t]{2,}", " ", t)
    t2 = re.sub(r"\s+([,.;:!?])(?=\s|$)", r"\1", t2)
    t2 = re.sub(r"([,;:])(?=[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡])", r"\1 ", t2)
    t2 = re.sub(r"(?m)^(\s*)([a-záéíóúñ])", lambda m: m.group(1) + m.group(2).upper(), t2)  # mayúscula al empezar cada línea
    t2 = re.sub(r"([.!?]\s+)([a-záéíóúñ])", lambda m: m.group(1) + m.group(2).upper(), t2)
    if t2 != t:
        cambios.append("espacios y mayúsculas")
    for k, v in protegidos.items():
        t2 = t2.replace(k, v)
    return t2, list(dict.fromkeys(cambios))


# ───────────── Acciones con IA ─────────────
_REGLAS = ("Responde SOLO con el texto resultante, sin explicaciones, sin comillas y sin frases como «Aquí está». "
           "Conserva TODOS los requisitos, datos, nombres, rutas, números y código del original. No inventes requisitos "
           "nuevos. Escribe en el mismo idioma del original (salvo que se pida traducir).")

ACCIONES = {
    "corregir": {"nombre": "🔤 Corregir", "tokens": 3000, "system":
                 "Eres un corrector profesional de textos. Corrige ortografía, tildes, gramática, puntuación y sintaxis del "
                 "texto del usuario (una instrucción para una IA). NO cambies el significado ni el estilo, NO resumas ni "
                 "agregues contenido; solo deja el texto claro y correcto. Escribe bien los nombres técnicos (NVIDIA, "
                 "Python, JavaScript, Minecraft, prompt…). " + _REGLAS},
    "profesional": {"nombre": "✨ Profesional", "tokens": 4000, "system":
                    "Eres un ingeniero de prompts experto. Convierte la instrucción del usuario en un PROMPT PROFESIONAL para "
                    "una IA con herramientas, bien redactado y sin faltas, con estas secciones en Markdown (omite una sección "
                    "solo si de verdad no aplica): **Rol** (qué experto debe ser la IA), **Objetivo** (una o dos frases), "
                    "**Contexto** (lo que ya existe o se sabe), **Requisitos** (lista numerada y concreta, uno por línea; "
                    "agrupa en subtítulos si hay muchos), **Restricciones** (qué no hacer; si el usuario pidió no romper lo que "
                    "funciona, ponlo aquí), **Entregables y formato** y **Criterios de aceptación** (cómo se comprueba que "
                    "quedó bien). Si falta un dato importante, deja un marcador entre corchetes como [especificar …] en vez "
                    "de inventarlo. " + _REGLAS},
    "estructurar": {"nombre": "🧱 Estructurar", "tokens": 3000, "system":
                    "Reorganiza la instrucción del usuario en una lista clara y ordenada: primero el objetivo en una línea y "
                    "luego los pasos o requisitos numerados, uno por línea, corrigiendo la ortografía. No agregues nada que "
                    "no esté en el original. " + _REGLAS},
    "especifico": {"nombre": "🎯 Más específico", "tokens": 3500, "system":
                   "Haz la instrucción del usuario más específica y sin ambigüedades para una IA: corrige la ortografía, "
                   "concreta lo vago (cantidades, tecnologías, formato, dónde guardar, cómo probar) y marca cada detalle "
                   "que agregues tú como «(suposición: …)» para que el usuario lo revise. " + _REGLAS},
    "ingles": {"nombre": "🌐 Inglés", "tokens": 3000, "system":
               "Translate the user's instruction into clear, natural, professional English for an AI model (fix any spelling "
               "or grammar issues while translating). Reply ONLY with the translation. Keep code, paths, names and numbers "
               "unchanged."},
    "resumir": {"nombre": "✂ Resumir", "tokens": 1500, "system":
                "Resume la instrucción del usuario en la versión más corta posible que conserve TODOS los requisitos, "
                "corrigiendo la ortografía. " + _REGLAS},
    "juego": {"nombre": "🎮 Prompt de juego", "tokens": 3500, "system":
              "Eres diseñador de videojuegos. Convierte la idea del usuario en un prompt profesional para que una IA cree el "
              "juego, con secciones: **Concepto** (una frase), **Género y estilo visual**, **Jugador y controles**, "
              "**Objetivo y cómo se gana/pierde**, **Enemigos/obstáculos**, **Niveles o mundo**, **Recursos visuales y "
              "sonido**, **Rendimiento** (debe funcionar fluido en la PC del usuario) y **Criterios de aceptación**. Hazlo ÉPICO "
              "como los juegos más jugados de su categoría: travesía por zonas con historia, personajes y guías, vistas "
              "panorámicas, selección de trajes y armas, vidas y puntos de control, obstáculos, contratiempos, mejoras, logros y "
              "un jefe final con fases (usa y mejora el borrador del director que viene al final). Corrige la ortografía. " + _REGLAS},
}


def mejorar(texto, accion="profesional", modelo=None, idioma="es"):
    """{"ok", "texto", "modelo", "ms", "local", "cambios", "aviso"}"""
    texto = (texto or "").strip()
    if not texto:
        return {"ok": False, "error": "Escribe algo primero."}
    if accion not in ACCIONES and accion != "local":
        return {"ok": False, "error": f"acción desconocida: {accion}"}
    local, cambios = corregir_local(texto)
    if accion == "local":
        return {"ok": True, "texto": local, "local": True, "cambios": cambios, "modelo": "", "ms": 0}
    a = ACCIONES[accion]
    system = a["system"]
    if idioma == "en" and accion not in ("ingles",):
        system += " If the original is in English, answer in English."
    borrador = _borrador_juego(local) if accion == "juego" else ""
    try:
        entrada = local + (f"\n\n[Borrador del director creativo de Noviq]\n{borrador}" if borrador else "")
        out, m, ms = rapida.responder(system, entrada, preferido=modelo, max_tokens=a["tokens"], limite_seg=60)
        out = re.sub(r"^(aqu[ií] (est[aá]|tienes)[^\n]*:\s*\n)", "", out, flags=re.I).strip()
        if len(out) < max(3, len(local) * 0.25) and accion not in ("resumir",):
            raise RuntimeError("la respuesta de la IA salió demasiado corta")
        return {"ok": True, "texto": out, "modelo": m, "ms": ms, "local": False, "cambios": cambios}
    except RuntimeError as e:
        aviso = f"Ninguna IA respondió ({str(e)[:220]}). Apliqué solo la corrección local."
        if accion == "profesional":
            local = estructura_local(local)
        elif accion == "juego" and borrador:
            local = f"**Idea:** {local}\n\n{borrador}"
            aviso = f"Ninguna IA respondió ({str(e)[:160]}). Te dejo el diseño épico del director creativo de Noviq."
        return {"ok": True, "texto": local, "modelo": "", "ms": 0, "local": True, "cambios": cambios, "aviso": aviso}


def _borrador_juego(idea):
    """Diseño épico local del director creativo (sin IA, en milisegundos) para enriquecer el «prompt de juego»."""
    try:
        from . import director_juegos as DJ
        from . import juegos as JG
        r = JG.planificar(idea, None, None, usar_ia=False)
        return DJ.texto(r["diseno"])[:5000]
    except Exception:
        return ""


def estructura_local(texto):
    """Prompt profesional SIN IA: arma las secciones con las frases del usuario (para cuando no hay IA disponible)."""
    frases = [f.strip(" -•\t") for f in re.split(r"(?<=[.!?])\s+|\n+|(?<=:)\s+(?=\d+\.)", texto) if f.strip(" -•\t")]
    if len(frases) <= 1:
        frases = [f.strip() for f in re.split(r",\s+(?=y\s|que\s|con\s|para\s)", texto) if f.strip()]
    objetivo = frases[0] if frases else texto
    req = frases[1:] if len(frases) > 1 else []
    no = [f for f in req if re.search(r"(?i)\bno (dañ|romp|borr|cambi|toque)|sin romper|no afect", f)]
    req = [f for f in req if f not in no]
    out = ["**Rol:** Eres un desarrollador de software senior, meticuloso y autónomo.", "",
           f"**Objetivo:** {objetivo}", ""]
    if req:
        out += ["**Requisitos:**"] + [f"{i}. {r}" for i, r in enumerate(req, 1)] + [""]
    out += ["**Restricciones:**"] + ([f"- {x}" for x in no] or ["- No rompas lo que ya funciona; haz copia antes de cambiar archivos."]) + [""]
    out += ["**Entregables y formato:** [especificar: archivos, carpeta o formato del resultado]", "",
            "**Criterios de aceptación:** se prueba de verdad (ejecutar / probar_web) y funciona sin errores."]
    return "\n".join(out)


# ───────────── Plantillas (opciones rápidas) ─────────────
PLANTILLAS = [
    {"id": "programa", "icono": "🛠", "nombre": "Crear un programa", "texto":
     "**Rol:** Eres un desarrollador senior de [lenguaje, ej. Python].\n**Objetivo:** Crea un programa que [qué debe hacer].\n"
     "**Requisitos:**\n1. [función principal]\n2. [interfaz: consola / ventana / web]\n3. [datos de entrada y de salida]\n"
     "**Restricciones:** código comentado en español, sin librerías de pago.\n**Entregables:** proyecto en su carpeta con "
     "README e instrucciones para ejecutarlo.\n**Criterios de aceptación:** se ejecuta sin errores y [resultado esperado]."},
    {"id": "arreglar", "icono": "🩺", "nombre": "Arreglar un error", "texto":
     "**Problema:** [qué pasa] cuando [qué haces].\n**Esperado:** [qué debería pasar].\n**Error exacto:** [pega el mensaje o "
     "adjunta una captura].\n**Pasos:** diagnostica primero (diagnosticar / probar_web), encuentra la causa raíz, corrige lo "
     "mínimo y verifica.\n**Restricciones:** no rompas lo que ya funciona; haz copia antes de cambiar."},
    {"id": "juego", "icono": "🎮", "nombre": "Crear un videojuego", "texto":
     "**Idea:** un juego de [género: aventura / plataformas / carreras / disparos / supervivencia] donde [qué hace el "
     "jugador].\n**Estilo visual:** [realista 3D / vóxel estilo Minecraft HD / low poly / 2D pixel art].\n**Objetivo:** "
     "[recoger N objetos / llegar a la meta / sobrevivir N minutos / derrotar enemigos].\n**Enemigos y obstáculos:** "
     "[cuáles].\n**Controles:** WASD / flechas, espacio para saltar, clic para acción.\n**Rendimiento:** fluido en mi PC; "
     "si mi tarjeta no alcanza, usa un estilo más liviano.\n**Criterios de aceptación:** se puede jugar de principio a fin y "
     "probar_web no muestra errores ni fugas de memoria."},
    {"id": "web", "icono": "🌐", "nombre": "Crear una página web", "texto":
     "**Objetivo:** una página web de [tipo: portafolio / negocio / landing] para [quién].\n**Secciones:** [inicio, servicios, "
     "contacto…].\n**Estilo:** [colores, moderno / minimalista], adaptable a celular.\n**Requisitos:** [formulario, galería, "
     "mapa…].\n**Criterios de aceptación:** abre sin errores en la consola y se ve bien en pantalla chica y grande."},
    {"id": "datos", "icono": "📊", "nombre": "Analizar datos", "texto":
     "**Datos:** [archivo adjunto / ruta].\n**Pregunta:** [qué quiero saber].\n**Análisis:** [totales, promedios, tendencias, "
     "comparaciones].\n**Entregables:** [Excel con fórmulas / gráficos PNG / informe corto].\n**Criterios de aceptación:** "
     "los números cuadran con el archivo original."},
    {"id": "automatizar", "icono": "⚙", "nombre": "Automatizar una tarea", "texto":
     "**Tarea repetitiva:** [qué hago a mano].\n**Cada cuánto:** [diario / al iniciar / cada N minutos].\n**Entradas y "
     "salidas:** [carpetas, archivos, correos].\n**Restricciones:** no borrar nada sin confirmar; registrar lo hecho en un log.\n"
     "**Criterios de aceptación:** una prueba real funciona y queda programada."},
    {"id": "explicar", "icono": "🎓", "nombre": "Explicar código o tema", "texto":
     "Explícame [código / archivo / tema] como a un [principiante / técnico], con un ejemplo práctico, los errores comunes y "
     "un resumen final de 3 puntos."},
    {"id": "nvidia", "icono": "🟩", "nombre": "Usar la GPU NVIDIA", "texto":
     "**Objetivo:** que [programa / script / modelo de IA / render / video] use mi tarjeta NVIDIA.\n**Pasos:** revisa mi GPU "
     "con nvidia_ia (info), instala la versión correcta (CUDA / PyTorch / CuPy / NVENC) y demuestra con una prueba que corre "
     "en la GPU y cuánto más rápido va que en CPU.\n**Restricciones:** no cambies drivers sin preguntarme."},
]
# Piezas para añadir con un clic al final del prompt
PIEZAS = [
    {"id": "rol", "nombre": "+ Rol experto", "texto": "Actúa como un experto senior en [área]."},
    {"id": "pasos", "nombre": "+ Paso a paso", "texto": "Trabaja paso a paso: primero el plan con tareas, luego ejecútalo y verifica cada paso."},
    {"id": "formato", "nombre": "+ Formato", "texto": "Entrega el resultado como [archivo .xlsx / .docx / código / lista / tabla]."},
    {"id": "criterios", "nombre": "+ Criterios", "texto": "Criterios de aceptación: [cómo sé que quedó bien]; pruébalo de verdad antes de decir que está listo."},
    {"id": "noromper", "nombre": "+ No romper", "texto": "No rompas lo que ya funciona: haz copia antes de cambiar y cambia solo lo necesario."},
    {"id": "breve", "nombre": "+ Breve", "texto": "Responde de forma breve y directa."},
    {"id": "ejemplos", "nombre": "+ Ejemplos", "texto": "Incluye un ejemplo concreto de entrada y salida."},
]


def plantillas():
    return {"plantillas": PLANTILLAS, "piezas": PIEZAS,
            "acciones": [{"id": k, "nombre": v["nombre"]} for k, v in ACCIONES.items()]}
