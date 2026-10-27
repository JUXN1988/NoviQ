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
