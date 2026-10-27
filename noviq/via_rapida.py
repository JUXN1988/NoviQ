# -*- coding: utf-8 -*-
"""⚡ Vía rápida para tareas simples: informarse, buscar en internet, noticias, clima, precios, resumir, traducir,
enviar algo por Telegram o correo, recordar… (no programación).

El problema que resuelve (caso real): «Revisa las noticias de Ecuador y envíalas por Telegram» tardó 5 minutos y
40+ pasos sin terminar: el detector de errores tomó «revisa» como «arregla el proyecto», se diagnosticó la carpeta
_General, la IA recibió un problema de config.json como «punto de partida», armó un plan de 4 tareas con aprobación,
vio el árbol de archivos y se puso a editar .env, .gitignore y scripts en vez de usar sus herramientas.

En una tarea rápida Noviq trabaja como un asistente directo: sin diagnóstico, sin plan del arquitecto ni revisión de
plan, sin el árbol de archivos en las instrucciones, con pocas vueltas y una guía clara de qué herramienta usar."""
import re
import unicodedata

MAX_PASOS = 20


def _norm(t):
    t = unicodedata.normalize("NFKD", str(t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


RAPIDA_RX = re.compile(
    r"\b(noticias?|titulares|novedades|clima|pronostico|temperatura|va a llover|tiempo (?:en|de|hoy|manana)|precio|"
    r"cotizacion|cuanto (?:cuesta|vale|esta)|dolar|euro\b|bitcoin|resultados? del partido|marcador|horario de|"
    r"que es\b|quien (?:es|fue|gano)|cuando (?:es|fue|sale|juega)|donde (?:queda|esta)|busca(?:me|r)?\b|investiga|averigua|"
    r"resume|resumen|resumeme|traduce|traduccion|explica(?:me)?\b|recuerdame|recordatorio|"
    r"(?:envia|enviame|enviala|envialas|envialo|envialos|manda|mandame|mandala|mandalas|comparte)\b[^.]{0,80}\b(?:telegram|correo|mail|email|whatsapp)|"
    r"por (?:telegram|correo|mail|email))")
CODIGO_RX = re.compile(
    r"\b(codigo|programa(?:r|cion)?\b|script|proyecto|app\b|aplicacion|funcion|clase\b|archivo|carpeta|repositorio|repo\b|"
    r"compila|depura|debug|bug|stack ?trace|consola|pagina web|sitio web|landing|juego|videojuego|html|css|javascript|"
    r"typescript|python|java\b|kotlin|flutter|base de datos|sql|endpoint|servidor|backend|frontend|instala(?:r|cion)?\b|"
    r"crea(?:r|me)? (?:un|una) |haz(?:me)? (?:un|una) (?:programa|app|pagina|juego|bot|script|web))")


def es_tarea_rapida(texto):
    """¿Es un pedido de información o de aviso (no de programación)?"""
    n = _norm(texto)
    if not n.strip() or len(n) > 800:
        return False
    return bool(RAPIDA_RX.search(n)) and not CODIGO_RX.search(n)


BLOQUE = """## ⚡ TAREA RÁPIDA (información o aviso, NO programación)
Hazla DIRECTO, como un asistente, en pocos pasos:
- Para informarte usa `buscar_en_internet` (y `leer_pagina_web` solo si necesitas el detalle de 1 o 2 páginas). Prefiere información de HOY o de los últimos días y anota el medio y el enlace de cada dato.
- Para enviar al usuario usa directamente la herramienta `telegram` (accion="avisar", texto=el mensaje completo ya redactado) o `correo`. Para recordatorios, `agenda`.
- NO crees, leas ni edites archivos, scripts, .env, configuraciones ni proyectos. NO revises claves ni la carpeta de trabajo. NO uses actualizar_tareas.
- Si una búsqueda falla, prueba otra consulta o fuente; no te quedes en bucle.
- Al terminar, responde con el resultado en pocas líneas (y confirma si lo enviaste).
"""


# ═════════════ 🎚 Nivel de cada pedido: cada uno recibe SOLO el proceso que necesita ═════════════
# charla  → saludo o pregunta simple: responde directo (máx. 6 pasos).
# rapida  → información o aviso (noticias, clima, buscar, enviar por Telegram…): sin archivos (máx. 20 pasos).
# pequena → cambio o arreglo puntual en código: sin arquitecto ni revisión de plan; localizar → editar → verificar (máx. 30).
# grande  → crear un programa, juego, página o sistema: proceso completo (plan del arquitecto, equipo, pruebas).
# normal  → no está claro: el proceso de siempre.
SALUDO_RX = re.compile(r"^\W*(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|hello|gracias|muchas gracias|ok|okay|vale|"
                       r"perfecto|genial|excelente|que tal|como estas|que puedes hacer|quien eres|que eres|ayuda)\b[\w\s,!.?¿¡]{0,40}$")
PEQUENO_RX = re.compile(r"\b(cambia|cambiale|cambiar|agrega|agregale|anade|anadele|quita|quitale|elimina|borra|renombra|corrige|"
                        r"corregir|arregla|arreglar|ajusta|ponle|pon\b|mueve|actualiza|reemplaza|aumenta|disminuye|sube|baja|"
                        r"modifica|traduce el|traduce la|centra|alinea|oculta|muestra el|muestra la)\b")
CONSTRUIR_RX = re.compile(r"\b(crea|crear|creame|haz|hazme|hacer|desarrolla|construye|programa|implementa|disena|genera|arma|"
                          r"necesito|quiero)\b.{0,40}\b(programa|app|aplicacion|juego|videojuego|pagina|sitio|web|sistema|proyecto|"
                          r"bot|api|tienda|plataforma|script|herramienta|calculadora|dashboard|panel)\b")
UI_RX = re.compile(r"\b(boton|botones|formulario|campo|pantalla|menu|ventana|titulo|encabezado|pie de pagina|color|fuente|"
                   r"icono|imagen|logo|estilo|tamano|margen|login|registro|pagina de|seccion|tabla|columna|lista|enlace|link)\b")
MAX_PASOS_NIVEL = {"charla": 6, "rapida": MAX_PASOS, "pequena": 30}
AVISO_NIVEL = {"charla": "💬 Respuesta directa.", "rapida": "⚡ Vía rápida: tarea de información/aviso, sin tocar archivos.",
               "pequena": "🔧 Cambio puntual: sin plan del arquitecto; localizo, edito y verifico."}


def nivel(texto, arreglo=False):
    """→ 'charla' | 'rapida' | 'pequena' | 'grande' | 'normal'. Solo reglas (instantáneo, sin gastar IA).
    arreglo=True si el pedido es arreglar algo que falla (lo decide agent.pide_arreglo)."""
    n = _norm(texto).strip()
    if not n:
        return "normal"
    if len(n) <= 60 and SALUDO_RX.match(n) and not RAPIDA_RX.search(n) and not CODIGO_RX.search(n):
        return "charla"
    if es_tarea_rapida(texto):
        return "rapida"
    if CONSTRUIR_RX.search(n):
        return "grande"
    if len(n) <= 400 and (arreglo or ((CODIGO_RX.search(n) or UI_RX.search(n)) and PEQUENO_RX.search(n))):
        return "pequena"
    return "normal"


BLOQUES = {
    "rapida": BLOQUE,
    "charla": "## 💬 CHARLA O PREGUNTA SIMPLE\nResponde directo, en pocas líneas. Usa una herramienta solo si de verdad hace falta "
              "(por ejemplo buscar_en_internet para un dato actual). No crees ni edites archivos ni hagas planes.\n",
    "pequena": "## 🔧 CAMBIO PUNTUAL (no es un proyecto nuevo)\n"
               "- NO hagas planes largos ni uses actualizar_tareas (salvo que sean 3 o más partes independientes).\n"
               "- 1) Localiza el lugar con explorar_codigo o buscar_en_archivos; 2) lee SOLO las líneas necesarias; "
               "3) cambia con editar_archivo; 4) verifica UNA vez (diagnosticar, probar_web o ejecutar); 5) responde en pocas "
               "líneas qué cambiaste (archivo y línea).\n"
               "- No toques archivos, claves ni configuraciones que no se pidieron.\n",
}
