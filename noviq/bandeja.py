# -*- coding: utf-8 -*-
"""📥 Bandeja de peticiones en caliente: lo que pides MIENTRAS la IA o los agentes están trabajando.

Antes, si una conversación estaba trabajando, cualquier mensaje nuevo se rechazaba («Esta conversación ya está
trabajando», error 409) y había que esperar o detener el trabajo. Ahora el mensaje entra en esta bandeja y:

  • el agente lo integra en el SIGUIENTE paso (sin detener ni perder lo que está haciendo): si corrige el rumbo, ajusta
    lo que hace; si es algo adicional, lo agrega al plan (actualizar_tareas conservando lo ya completado); si es una
    pregunta, la responde y sigue;
  • si el agente ya iba a terminar, antes de terminar revisa la bandeja y continúa con lo nuevo;
  • si el trabajo terminó justo antes de leerlo, el programa arranca solo un turno nuevo con lo pendiente.

Idea inspirada en el «steering» de DeepSeek Harness (dsh-agent-loop, licencia MIT): los mensajes del usuario se encolan
y se integran entre pasos del agente. La implementación es propia de Noviq.

La bandeja vive en memoria (por id de conversación) y se copia a datos/bandeja.json para que nada se pierda si el
programa se cierra antes de integrarla."""
import json
import threading
import time
import uuid

from .config import DATA_DIR

LOCK = threading.RLock()       # también lo usa app.py para que «¿está trabajando?» y «encolar/terminar» sean atómicos
_ARCHIVO = DATA_DIR / "bandeja.json"
_BANDEJA = {}                  # cid → [{"id", "texto", "imagenes", "archivos", "origen", "t"}]
MAX_ITEMS = 20                 # por conversación (evita que un bucle externo llene la bandeja)
MAX_TEXTO = 8000


def _guardar():
    try:
        _ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
        tmp = _ARCHIVO.with_suffix(".tmp")
        tmp.write_text(json.dumps({k: v for k, v in _BANDEJA.items() if v}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_ARCHIVO)
    except Exception:
        pass   # la bandeja en memoria sigue funcionando aunque no se pueda escribir el archivo


def _cargar():
    try:
        d = json.loads(_ARCHIVO.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            for k, v in d.items():
                if isinstance(v, list):
                    _BANDEJA[str(k)] = [x for x in v if isinstance(x, dict) and x.get("texto") is not None][:MAX_ITEMS]
    except Exception:
        pass


_cargar()


def agregar(cid, texto, imagenes=None, archivos=None, origen="ventana"):
    """Encola una petición para la conversación `cid`. → el elemento creado (o None si no había nada que encolar)."""
    texto = str(texto or "").strip()[:MAX_TEXTO]
    imagenes = [u for u in (imagenes or []) if isinstance(u, str)][:8]
    archivos = [str(a) for a in (archivos or [])][:20]
    if not cid or not (texto or imagenes or archivos):
        return None
    it = {"id": uuid.uuid4().hex[:12], "texto": texto, "imagenes": imagenes, "archivos": archivos,
          "origen": str(origen or "ventana")[:20], "t": time.time()}
    with LOCK:
        lst = _BANDEJA.setdefault(cid, [])
        if len(lst) >= MAX_ITEMS:
            lst.pop(0)
        lst.append(it)
        _guardar()
    return it


def pendientes(cid):
    with LOCK:
        return len(_BANDEJA.get(cid) or [])


def ver(cid):
    with LOCK:
        return [dict(x) for x in _BANDEJA.get(cid) or []]


def tomar(cid):
    """Saca y devuelve TODO lo pendiente de la conversación (en orden de llegada)."""
    with LOCK:
        lst = _BANDEJA.pop(cid, None) or []
        if lst:
            _guardar()
        return lst


def quitar(cid, item_id):
    """El usuario se arrepintió antes de que la IA lo leyera. → True si lo quitó."""
    with LOCK:
        lst = _BANDEJA.get(cid) or []
        n = len(lst)
        lst[:] = [x for x in lst if x.get("id") != item_id]
        if len(lst) != n:
            if not lst:
                _BANDEJA.pop(cid, None)
            _guardar()
            return True
        return False


def _plan_txt(conv):
    tareas = conv.get("tasks") or []
    if not tareas:
        return ""
    lineas = [f"{i + 1}. [{t.get('estado', 'pendiente')}] {t.get('contenido', '')}" for i, t in enumerate(tareas[:25])]
    return "\nPlan actual:\n" + "\n".join(lineas)


def mensaje_integracion(conv, items):
    """Mensaje para la IA cuando llega una petición en pleno trabajo."""
    pedidos = "\n".join(f"«{x['texto']}»" + (f" (adjuntó: {', '.join(x['archivos'])})" if x.get("archivos") else "")
                        for x in items if x.get("texto") or x.get("archivos"))
    varios = len(items) > 1
    return ("[📥 NUEVA" + ("S PETICIONES" if varios else " PETICIÓN") + " DEL USUARIO MIENTRAS TRABAJABAS]\n"
            + (pedidos or "(el usuario adjuntó imágenes)") + "\n\n"
            "Intégra" + ("las" if varios else "la") + " AHORA, sin empezar de cero ni perder lo ya hecho:\n"
            "1. Si corrige o cambia lo que estás haciendo, ajusta el rumbo de inmediato (lo nuevo manda: el usuario cambió de idea).\n"
            "2. Si es algo adicional, agrégalo al plan: llama a actualizar_tareas con la lista COMPLETA (conserva las tareas "
            "completadas con su estado y coloca lo nuevo donde corresponda por prioridad y dependencias).\n"
            "3. Si es una pregunta, respóndela en una o dos frases y sigue con el trabajo.\n"
            "4. Si no tiene relación con este trabajo, dilo en una frase, termina lo actual y luego atiéndelo."
            + _plan_txt(conv))


def inyectar(conv, emit, en_curso=True):
    """Pasa lo pendiente de la bandeja a la conversación (mensajes para la IA + burbujas para la ventana).
    en_curso=True: llega en medio del trabajo (mensaje de integración con el plan).
    en_curso=False: el trabajo ya había terminado (se trata como un pedido normal del usuario).
    → número de peticiones integradas."""
    items = tomar(conv.get("id"))
    if not items:
        return 0
    from . import estado as E
    for x in items:
        if x.get("texto"):
            E.record_user(conv, x["texto"])
        conv.setdefault("display", []).append({"type": "user", "text": x.get("texto") or "", "images": x.get("imagenes") or [],
                                               "files": x.get("archivos") or [], "msg_index": len(conv.get("messages") or []),
                                               "en_caliente": bool(en_curso)})
    imagenes = [u for x in items for u in (x.get("imagenes") or [])][:8]
    if en_curso:
        texto = mensaje_integracion(conv, items)
    else:
        texto = "\n\n".join((x.get("texto") or "") + (("\n\n[Archivos adjuntos por el usuario: " + ", ".join(x["archivos"])
                                                         + " — léelos con leer_archivo]") if x.get("archivos") else "")
                            for x in items).strip() or "Describe estas imágenes."
    content = ([{"type": "text", "text": texto}] + [{"type": "image_url", "image_url": {"url": u}} for u in imagenes]) \
        if imagenes else texto
    conv.setdefault("messages", []).append({"role": "user", "content": content})
    try:
        emit("inbox_tomado", {"items": [{"id": x["id"], "texto": x.get("texto") or "", "imagenes": x.get("imagenes") or [],
                                         "archivos": x.get("archivos") or []} for x in items], "en_curso": bool(en_curso)})
        if en_curso:
            emit("notice", {"text": "📥 Integré tu nueva petición en el trabajo en curso: «"
                                    + "», «".join((x.get("texto") or "🖼")[:80] for x in items[:3]) + "»."})
    except Exception:
        pass
    return len(items)
