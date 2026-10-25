# -*- coding: utf-8 -*-
"""🧭 Director: el agente que dirige el trabajo completo para que NO se quede a medias.

Antes, cuando una IA terminaba su turno sin acabar (se quedó sin herramientas, repitió el mismo informe, se atascó,
entró en bucle, llegó al máximo de pasos o fallaron todas las IAs del respaldo), el programa se detenía y mostraba
«💾 Este trabajo quedó a medias… ▶ Continuar el trabajo». El usuario tenía que pulsar el botón a mano.

Ahora el director revisa por qué terminó cada ciclo y decide solo:
  • terminado / la IA espera una respuesta del usuario / el usuario pulsó Detener → se termina (no gasta nada más).
  • quedó trabajo pendiente → continúa AUTOMÁTICAMENTE, con la misma IA si estaba avanzando (máximo de pasos,
    respuesta cortada) o con la MEJOR IA según el 🏆 evaluador si la anterior no avanzaba (sin herramientas, texto
    repetido, atasco, bucle, errores del servidor).
  • errores del servidor en toda la cadena → espera un poco y reintenta con otra IA que no esté fallando.
Límites de seguridad (para no gastar cuota en vano): máximo de continuaciones por pedido, tiempo máximo, y se
detiene si dos ciclos seguidos no avanzan nada. En ese caso deja todo guardado y explica qué pasó; el botón
«▶ Continuar el trabajo» sigue disponible.

Las decisiones que deben ser fiables (reintentar, cambiar de IA, continuar o parar) las toma este código con datos
medidos; el trabajo inteligente (entender el error, programar, arreglar) lo hace la mejor IA disponible."""
import time

from . import estado as E
from . import evaluador as EV
from .config import CONFIG
from .providers import APIError

DEFAULTS = {"activo": True, "max_continuaciones": 4, "max_minutos": 120, "espera_error_seg": 30}
MOTIVOS = {
    "sin_herramientas": "la IA dejó de usar herramientas con tareas pendientes",
    "repite": "la IA repetía la misma respuesta en vez de avanzar",
    "atascado": "la IA se atascó (varios intentos sin avanzar)",
    "bucle": "la IA repetía las mismas acciones",
    "max_pasos": "se llegó al máximo de pasos seguidos (estaba avanzando)",
    "cortado": "la respuesta se cortó por el límite de tokens",
    "error": "ninguna IA del respaldo respondió",
}
CAMBIAR = {"sin_herramientas", "repite", "atascado", "bucle", "error"}


def cfg():
    return dict(DEFAULTS, **(CONFIG.get("director") or {}))


def _huella(conv):
    """Cuánto se avanzó: herramientas que funcionaron + tareas completadas + archivos tocados."""
    st = conv.get("estado") or {}
    return (int(conv.get("_n_ok") or 0), sum(1 for t in conv.get("tasks") or [] if t.get("estado") == "completada"),
            len(st.get("archivos") or {}))


def mensaje(conv, motivo, prev, nuevo):
    pend = E.pending_tasks(conv)
    quien = ("Tú (" + nuevo + ") tomas el relevo de " + prev + ". ") if nuevo != prev else ""
    return ("[CONTINUACIÓN AUTOMÁTICA] El director de Noviq continúa el trabajo solo porque " + MOTIVOS.get(motivo, motivo)
            + ". " + quien + "NO empieces de cero ni repitas lo ya hecho: el 📋 ESTADO DEL TRABAJO de tus instrucciones es "
            "la fuente de verdad."
            + (f"\nTareas pendientes: {'; '.join(t['contenido'] for t in pend[:8])}." if pend else "")
            + f"\nSiguiente paso: {E.next_step(conv)}"
            + "\nActúa YA con herramientas. Cuando termines una tarea, márcala con marcar_tarea. Si la tarea es un informe o "
              "resumen, escríbelo y márcala como completada. Si de verdad no puedes resolver algo, usa pedir_relevo.")


def push_sistema(conv, content):
    """Agrega un mensaje del programa a la IA sin apilar avisos repetidos ([RELEVO]/[CONTINUAR]/[CONTINUACIÓN…])
    que no llegaron a tener respuesta (antes se acumulaban 4-6 copias del estado completo y gastaban contexto)."""
    msgs = conv["messages"]
    while msgs and msgs[-1].get("role") == "user" and isinstance(msgs[-1].get("content"), str) \
            and msgs[-1]["content"].startswith(("[RELEVO", "[CONTINUACIÓN AUTOMÁTICA]", "[Sistema] No llamaste")):
        msgs.pop()
    msgs.append({"role": "user", "content": content})


def run(conv, emit, stop_ev, once):
    """Ejecuta el agente (`once`) y, si el trabajo quedó a medias, lo continúa automáticamente."""
    c = cfg()
    t0 = time.time()
    ciclos, sin_avance, usados = 0, 0, []
    while True:
        antes = _huella(conv)
        conv.pop("_salida", None)
        err = None
        try:
            once(conv, emit, stop_ev)
        except APIError as e:
            err = e
        finally:
            EV.flush()
        if stop_ev.is_set():
            if err:
                raise err
            return
        sal = conv.get("_salida") or {}
        motivo = "error" if err else sal.get("motivo", "terminado")
        if motivo in ("terminado", "espera_usuario", "detenido"):
            return
        prev = sal.get("modelo") or ((conv.get("estado") or {}).get("modelos") or [conv.get("model") or ""])[-1]
        avanzo = _huella(conv) != antes
        sin_avance = 0 if avanzo else sin_avance + 1
        razon_parar = None
        if not c.get("activo", True):
            razon_parar = "la continuación automática está apagada (⚙ Ajustes)"
        elif ciclos >= int(c.get("max_continuaciones", 4)):
            razon_parar = f"ya continué {ciclos} veces solo en este pedido"
        elif time.time() - t0 > float(c.get("max_minutos", 120)) * 60:
            razon_parar = "se alcanzó el tiempo máximo de trabajo automático"
        elif sin_avance >= 2:
            razon_parar = "dos ciclos seguidos sin ningún avance"
        tipo = EV.tipo_conv(conv)
        nuevo = prev
        if not razon_parar and motivo in CAMBIAR:
            excl = list(usados) + ([m for m in sal.get("cadena") or []] if motivo == "error" else [])
            m, s = EV.mejor(tipo, actual=prev, excluir=excl)
            if not m and motivo == "error":
                m, s = EV.mejor(tipo, actual=None)  # la mejor que no esté en enfriamiento, aunque ya estuviera en la cadena
            if m:
                nuevo = m
            elif motivo != "error":
                nuevo = prev  # no hay otra: la misma IA sigue con una estrategia nueva
            else:
                razon_parar = "no queda ninguna IA que esté respondiendo"
        if razon_parar:
            conv["en_progreso"] = True
            E.save_file(conv)
            emit("notice", {"text": f"🧭 Director: me detengo porque {razon_parar}. Motivo del último corte: "
                                    f"{MOTIVOS.get(motivo, motivo)}. Todo lo hecho está guardado; pulsa «▶ Continuar el trabajo» "
                                    "cuando quieras (o elige otra IA). 🏆 Mejores para esta tarea ahora:\n"
                                    + EV.texto_ranking(tipo, 3)})
            if err:
                raise err
            return
        ciclos += 1
        usados.append(prev)
        if motivo == "error":
            espera = int(c.get("espera_error_seg", 30)) * ciclos
            emit("notice", {"text": f"🧭 Director: ninguna IA respondió ({str(err)[:140]}). Espero {espera} s y continúo con "
                                    f"{nuevo.replace('::', ' · ')}…"})
            for _ in range(espera * 2):
                if stop_ev.is_set():
                    emit("notice", {"text": "Detenido por el usuario."})
                    return
                time.sleep(0.5)
        else:
            emit("notice", {"text": f"🧭 Director: {MOTIVOS.get(motivo, motivo)}. Continúo automáticamente"
                                    + (f" con {nuevo.replace('::', ' · ')} (la mejor valorada para esta tarea)" if nuevo != prev else "")
                                    + f" · ciclo {ciclos}/{int(c.get('max_continuaciones', 4))}."})
        if motivo == "sin_herramientas":
            EV.registrar(prev, "abandono", tipo, detalle=MOTIVOS[motivo])
        conv["_modelo_director"] = nuevo
        push_sistema(conv, mensaje(conv, motivo, prev, nuevo))
        if nuevo != prev:
            emit("model_switch", {"model": nuevo})
        from .server_state import save_conv
        save_conv(conv)
