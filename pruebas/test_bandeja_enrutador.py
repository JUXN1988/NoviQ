# -*- coding: utf-8 -*-
"""Pruebas de la 📥 bandeja de peticiones en caliente y del 🧭 enrutador de pedidos.

Se ejecutan con una carpeta de datos temporal (NOVIQ_DATOS), así que no tocan tus conversaciones reales:
    python -m pytest -q pruebas/test_bandeja_enrutador.py
"""
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="noviq_test_")
os.environ.setdefault("NOVIQ_DATOS", _TMP)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from noviq import bandeja as BJ  # noqa: E402
from noviq import enrutador as ENR  # noqa: E402
from noviq.config import CONV_DIR  # noqa: E402


def _conv(cid, title, pedidos=(), tareas=(), project=None, edad_seg=60, n_user=3):
    c = {"id": cid, "title": title, "project": project, "updated": time.time() - edad_seg, "messages": [],
         "display": [{"type": "user", "text": p} for p in list(pedidos)[:n_user]] or [{"type": "user", "text": title}] * n_user,
         "tasks": [{"contenido": t, "estado": "pendiente"} for t in tareas],
         "estado": {"pedidos": [{"t": "10:00", "texto": p} for p in pedidos]}}
    CONV_DIR.mkdir(parents=True, exist_ok=True)
    p = CONV_DIR / f"{cid}.json"
    p.write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")
    os.utime(p, (time.time() - edad_seg, time.time() - edad_seg))
    return c


@pytest.fixture(autouse=True)
def limpio():
    for p in CONV_DIR.glob("*.json"):
        p.unlink()
    ENR._CACHE.clear()
    for cid in list(BJ._BANDEJA):
        BJ.tomar(cid)
    ENR.registrar_ocupados(lambda: set())
    yield


# ───────────── 📥 bandeja ─────────────
def test_bandeja_encolar_tomar_y_quitar():
    a = BJ.agregar("c1", "agrega un botón de exportar")
    b = BJ.agregar("c1", "y que sea azul")
    assert BJ.pendientes("c1") == 2
    assert BJ.quitar("c1", b["id"]) is True
    assert [x["texto"] for x in BJ.ver("c1")] == ["agrega un botón de exportar"]
    assert BJ.tomar("c1")[0]["id"] == a["id"]
    assert BJ.pendientes("c1") == 0
    assert BJ.agregar("c1", "   ") is None          # nada que encolar
    assert BJ.agregar(None, "hola") is None


def test_bandeja_se_guarda_en_disco():
    BJ.agregar("c2", "pedido que no se debe perder")
    d = json.loads(BJ._ARCHIVO.read_text(encoding="utf-8"))
    assert d["c2"][0]["texto"] == "pedido que no se debe perder"
    BJ.tomar("c2")
    assert "c2" not in json.loads(BJ._ARCHIVO.read_text(encoding="utf-8"))


def test_bandeja_limite_por_conversacion():
    for i in range(BJ.MAX_ITEMS + 5):
        BJ.agregar("c3", f"pedido {i}")
    assert BJ.pendientes("c3") == BJ.MAX_ITEMS
    assert BJ.ver("c3")[-1]["texto"] == f"pedido {BJ.MAX_ITEMS + 4}"


def test_inyectar_en_curso_integra_al_plan():
    conv = {"id": "c4", "messages": [{"role": "user", "content": "haz una calculadora"}], "display": [],
            "tasks": [{"contenido": "crear la interfaz", "estado": "completada"}, {"contenido": "sumar y restar", "estado": "en_progreso"}]}
    BJ.agregar("c4", "agrega también la división")
    eventos = []
    n = BJ.inyectar(conv, lambda k, p: eventos.append((k, p)), en_curso=True)
    assert n == 1
    ultimo = conv["messages"][-1]
    assert ultimo["role"] == "user"
    assert "NUEVA PETICIÓN" in ultimo["content"] and "agrega también la división" in ultimo["content"]
    assert "actualizar_tareas" in ultimo["content"] and "[completada] crear la interfaz" in ultimo["content"]
    assert conv["display"][-1]["type"] == "user" and conv["display"][-1]["en_caliente"] is True
    assert [k for k, _ in eventos] == ["inbox_tomado", "notice"]
    assert conv["estado"]["pedidos"][-1]["texto"] == "agrega también la división"
    assert BJ.pendientes("c4") == 0


def test_inyectar_turno_nuevo_es_pedido_normal():
    conv = {"id": "c5", "messages": [], "display": []}
    BJ.agregar("c5", "ahora hazlo en inglés", archivos=["C:/x/notas.txt"])
    BJ.inyectar(conv, lambda *a: None, en_curso=False)
    txt = conv["messages"][-1]["content"]
    assert txt.startswith("ahora hazlo en inglés") and "notas.txt" in txt and "NUEVA PETICIÓN" not in txt


def test_inyectar_con_imagenes():
    conv = {"id": "c6", "messages": [], "display": []}
    BJ.agregar("c6", "mira esta captura", imagenes=["data:image/png;base64,AAA"])
    BJ.inyectar(conv, lambda *a: None, en_curso=True)
    content = conv["messages"][-1]["content"]
    assert isinstance(content, list) and content[1]["type"] == "image_url"


# ───────────── 🧭 enrutador ─────────────
PROYECTOS = ["juego-naves", "Tienda Online", "calculadora_impuestos"]


def test_nueva_conversacion_explicita_quita_la_frase():
    _conv("a1", "Calculadora", ["haz una calculadora"])
    d = ENR.decidir("Nueva conversación: hazme un juego de memoria con cartas", conv_actual="a1", modo="ventana",
                    usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "nueva" and d["conv"] is None
    assert d["texto"].lower().startswith("hazme un juego de memoria")
    assert ENR.preparar_texto(d, "Nueva conversación: hazme…").lower().startswith("hazme un juego")


def test_otro_tema_abre_conversacion_nueva():
    d = ENR.decidir("Otro tema, ¿cómo instalo Python 3.12 en Windows?", usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "nueva"


def test_proyecto_nuevo_con_nombre():
    d = ENR.decidir("Crea un proyecto nuevo llamado Agenda Escolar para anotar tareas", usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "nueva" and d["nuevo_proyecto"] is True
    assert d["nombre_proyecto"] == "Agenda Escolar"
    assert "crear_proyecto" in ENR.preparar_texto(d, "Crea un proyecto nuevo llamado Agenda Escolar")


def test_proyecto_nombrado_sin_tildes_ni_guiones():
    d = ENR.decidir("en el juego naves agrega un jefe final que dispare láser", usar_ia=False, proyectos=PROYECTOS)
    assert d["proyecto"] == "juego-naves"
    d = ENR.decidir("revisa la tienda online, el carrito no suma bien", usar_ia=False, proyectos=PROYECTOS)
    assert d["proyecto"] == "Tienda Online"


def test_buscar_proyecto_prefiere_el_nombre_mas_largo():
    nombre, _ = ENR.buscar_proyecto("abre juego naves 2 por favor", ["juego", "juego naves 2"])
    assert nombre == "juego naves 2"


def test_respuesta_corta_sigue_la_misma_conversacion():
    _conv("b1", "Calculadora de impuestos", ["haz una calculadora de impuestos con IVA y renta"])
    for t in ("sí, dale", "y que también calcule el descuento", "eso no, mejor en verde"):
        d = ENR.decidir(t, conv_actual="b1", modo="auto", usar_ia=False, proyectos=PROYECTOS)
        assert d["accion"] == "misma" and d["conv"] == "b1", t


def test_mismo_tema_largo_sigue_la_misma():
    _conv("b2", "Página del clima", ["haz una página web que muestre el clima de Quito con gráficos"])
    d = ENR.decidir("en la página del clima agrega el pronóstico de los próximos cinco días", conv_actual="b2",
                    modo="auto", usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "misma"


def test_conversacion_trabajando_va_a_la_bandeja():
    _conv("b3", "Calculadora de impuestos", ["haz una calculadora de impuestos"])
    ENR.registrar_ocupados(lambda: {"b3"})
    d = ENR.decidir("y que también exporte a PDF", conv_actual="b3", modo="auto", usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "en_caliente" and d["conv"] == "b3"


def test_continuar_retoma_otra_conversacion_por_tema():
    _conv("c1", "Calculadora de impuestos", ["haz una calculadora de impuestos"])
    _conv("c2", "Login con Google", ["agrega inicio de sesión con Google a la app de notas"], edad_seg=3 * 86400)
    d = ENR.decidir("sigue con lo del login con Google", conv_actual="c1", modo="auto", usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "continuar" and d["conv"] == "c2"


def test_tema_igual_a_otra_conversacion_en_modo_auto():
    _conv("d1", "Calculadora de impuestos", ["haz una calculadora de impuestos"])
    _conv("d2", "Página del clima de Quito", ["haz una página web que muestre el clima de Quito con gráficos"])
    d = ENR.decidir("la página del clima de Quito no muestra los gráficos", conv_actual="d1", modo="auto",
                    usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "continuar" and d["conv"] == "d2"


def test_referencia_que_nombra_otro_tema_no_se_pega_a_la_actual():
    _conv("k1", "Calculadora de impuestos", ["haz una calculadora de impuestos"])
    _conv("k2", "Login de la app de notas", ["agrega login con usuario y contraseña a la app de notas", "el login falla con error 500"])
    d = ENR.decidir("corrige el error del login de la app de notas", conv_actual="k1", modo="auto", usar_ia=False, proyectos=PROYECTOS)
    assert d["conv"] != "k1"
    assert d["accion"] == "continuar" and d["conv"] == "k2"


def test_tema_distinto_en_modo_auto_abre_nueva():
    _conv("e1", "Calculadora de impuestos", ["haz una calculadora de impuestos"])
    d = ENR.decidir("búscame recetas de pan integral sin gluten para el fin de semana", conv_actual="e1", modo="auto",
                    usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "nueva" and d["conv"] is None


def test_ventana_nunca_cambia_de_chat_sin_pedirlo_pero_sugiere():
    _conv("f1", "Calculadora de impuestos", ["haz una calculadora de impuestos", "agrega el IVA"], n_user=3)
    d = ENR.decidir("búscame recetas de pan integral sin gluten para el fin de semana", conv_actual="f1", modo="ventana",
                    usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "misma" and d["conv"] == "f1" and d["sugerencia"] == "nueva"


def test_ventana_proyecto_distinto_sugiere_ese_proyecto():
    _conv("g1", "Calculadora", ["haz una calculadora"], project="calculadora_impuestos")
    d = ENR.decidir("en la tienda online agrega pago con tarjeta y envío a domicilio", conv_actual="g1", modo="ventana",
                    usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "misma" and d["sugerencia"] == "proyecto:Tienda Online"


def test_modo_auto_proyecto_distinto_se_va_a_ese_proyecto():
    _conv("h1", "Calculadora", ["haz una calculadora"], project="calculadora_impuestos")
    d = ENR.decidir("en la tienda online agrega pago con tarjeta", conv_actual="h1", modo="auto",
                    usar_ia=False, proyectos=PROYECTOS)
    assert d["accion"] == "nueva" and d["proyecto"] == "Tienda Online"


def test_chat_nuevo_en_ventana_detecta_el_proyecto():
    d = ENR.decidir("en calculadora impuestos corrige el redondeo de centavos", modo="ventana", usar_ia=False,
                    proyectos=PROYECTOS)
    assert d["accion"] == "nueva" and d["proyecto"] == "calculadora_impuestos"


def test_enrutador_apagado_no_cambia_nada():
    _conv("i1", "Calculadora", ["haz una calculadora"])
    from noviq.config import CONFIG
    viejo = CONFIG.get("enrutador")
    CONFIG["enrutador"] = {"activo": False}
    try:
        d = ENR.decidir("nueva conversación: otra cosa", conv_actual="i1", usar_ia=False, proyectos=PROYECTOS)
        assert d["accion"] == "misma" and d["conv"] == "i1"
    finally:
        if viejo is None:
            CONFIG.pop("enrutador", None)
        else:
            CONFIG["enrutador"] = viejo


# ───────────── integración con el servidor (sin IA real) ─────────────
def test_servidor_encola_en_vez_de_rechazar_y_arranca_el_turno_siguiente(monkeypatch):
    import app as APP
    from noviq.server_state import load_conv
    soltar = threading.Event()
    llamadas = []

    def agente_falso(conv, emit, stop_ev):
        llamadas.append({"bandeja_turno_nuevo": conv.get("_bandeja_turno_nuevo", False)})
        if conv.pop("_bandeja_turno_nuevo", False):
            BJ.inyectar(conv, emit, en_curso=False)
        if len(llamadas) == 1:
            soltar.wait(10)       # el primer turno «trabaja» hasta que la prueba lo suelte
        conv["display"].append({"type": "assistant", "text": f"turno {len(llamadas)} listo"})
    monkeypatch.setattr(APP, "run_agent", agente_falso)
    monkeypatch.setattr(APP.AV, "evento", lambda *a, **k: None)
    monkeypatch.setattr(APP.AV, "fin_trabajo", lambda *a, **k: None)
    monkeypatch.setattr(APP, "_fin_trabajo", lambda *a, **k: None)
    cli = APP.app.test_client()
    h = {"X-Token": APP.TOKEN} if hasattr(APP, "TOKEN") else {}
    cid = "prueba_cola_1"
    r1 = cli.post("/api/chat", json={"conversation_id": cid, "text": "haz una calculadora", "sin_enrutar": True}, headers=h)
    assert r1.status_code == 200
    t0 = time.time()
    while cid not in APP.RUNNING and time.time() - t0 < 5:
        time.sleep(0.02)
    assert cid in APP.RUNNING
    # antes: 409 «Esta conversación ya está trabajando» · ahora: 202 encolado
    r2 = cli.post("/api/chat", json={"conversation_id": cid, "text": "agrega también la división", "sin_enrutar": True}, headers=h)
    assert r2.status_code == 202 and r2.get_json()["encolado"] is True
    assert BJ.pendientes(cid) == 1
    r3 = cli.post(f"/api/conversations/{cid}/bandeja", json={"text": "y que sea azul"}, headers=h)
    assert r3.status_code == 202 and BJ.pendientes(cid) == 2
    soltar.set()                     # termina el primer turno con 2 pedidos en cola → arranca solo el siguiente
    t0 = time.time()
    while (len(llamadas) < 2 or cid in APP.RUNNING) and time.time() - t0 < 10:
        time.sleep(0.05)
    assert len(llamadas) == 2 and llamadas[1]["bandeja_turno_nuevo"] is True
    assert BJ.pendientes(cid) == 0
    conv = load_conv(cid)
    textos = [x.get("text") for x in conv["display"] if x.get("type") == "user"]
    assert "agrega también la división" in textos and "y que sea azul" in textos
    assert conv["display"][-1]["text"] == "turno 2 listo"
    # regenerar mientras trabaja sigue sin estar permitido
    APP.RUNNING.add(cid)
    try:
        r4 = cli.post("/api/chat", json={"conversation_id": cid, "regenerate": True}, headers=h)
        assert r4.status_code == 409
    finally:
        APP.RUNNING.discard(cid)


def test_agente_integra_la_peticion_antes_de_terminar(monkeypatch):
    """El agente iba a terminar (respuesta sin herramientas) pero llegó un pedido en caliente: lo integra y sigue."""
    from noviq import agent as AG
    from noviq import cerebro as CB
    vistas = []

    def stream_falso(model_id, msgs, tools, emit, stop_ev, **kw):
        vistas.append([m.get("content") for m in msgs if m.get("role") == "user"])
        if len(vistas) == 1:
            BJ.agregar("ag1", "agrega también un modo oscuro")    # el usuario escribe mientras la IA responde
            return "Listo, la calculadora funciona.", "", [], "stop"
        return "Agregué el modo oscuro.", "", [], "stop"
    monkeypatch.setattr(AG, "stream_chat", stream_falso)
    monkeypatch.setattr(AG, "auto_diagnostico", lambda *a, **k: None)
    monkeypatch.setattr(CB, "plan", lambda *a, **k: False)
    monkeypatch.setattr(AG, "fallback_chain", lambda conv, first=None: ["prueba::modelo"])
    monkeypatch.setattr(AG.EV, "modelo_inicial", lambda conv, want: ("prueba::modelo", None))
    monkeypatch.setattr(AG.EV, "registrar", lambda *a, **k: None)
    conv = {"id": "ag1", "title": "calc", "model": "prueba::modelo", "project": None, "tasks": [], "allowed_tools": [],
            "messages": [{"role": "user", "content": "haz una calculadora"}], "display": []}
    AG._run_once(conv, lambda *a: None, threading.Event())
    assert len(vistas) == 2, "debió hacer una segunda llamada con la petición integrada"
    assert any("agrega también un modo oscuro" in str(c) for c in vistas[1])
    assert BJ.pendientes("ag1") == 0
    assert any(d.get("en_caliente") for d in conv["display"] if d.get("type") == "user")


# ───────────── 🏷 títulos automáticos ─────────────
def test_titulo_ia(monkeypatch):
    import app as APP
    from noviq import rapida as R
    from noviq.server_state import load_conv, new_conv, save_conv
    respuestas = iter(["Juego de naves con jefe final\n", "«Tienda: pago con tarjeta».", "Esto no es un título porque es larguísimo y tiene demasiadas palabras", "Otro"])
    monkeypatch.setattr(R, "responder", lambda *a, **k: (next(respuestas), "x::y", 5))
    texto = "hazme un juego de naves espaciales con un jefe final que dispare láser"
    c = new_conv("t1"); c["title"] = texto[:60]; save_conv(c)
    APP._titulo_ia("t1", c["title"], texto)
    assert load_conv("t1")["title"] == "Juego de naves con jefe final"
    c = new_conv("t2"); c["title"] = "🎙 [Tienda] agrega pago con tarjeta y envío"; save_conv(c)
    APP._titulo_ia("t2", c["title"], "agrega pago con tarjeta y envío a domicilio en la tienda")
    assert load_conv("t2")["title"] == "🎙 [Tienda] Tienda: pago con tarjeta"
    c = new_conv("t3"); c["title"] = "¿cómo instalo python en windows y lo agrego al path?"; save_conv(c)
    APP._titulo_ia("t3", c["title"], c["title"])
    assert load_conv("t3")["title"] == "¿cómo instalo python en windows y lo agrego al path?"   # respuesta inválida: no cambia
    c = new_conv("t4"); c["title"] = "Título que el usuario cambió a mano"; save_conv(c)
    APP._titulo_ia("t4", "otro título automático", "un pedido bastante largo para que se intente titular")
    assert load_conv("t4")["title"] == "Título que el usuario cambió a mano"


# ───────────── ⚡ vía rápida (caso real: noticias por Telegram) ─────────────
NOTICIAS = ("Revisa las noticias sobre el Ecuador: las 5 más relevantes a nivel nacional y las 3 más relevantes en "
            "Santo Domingo de los Colorados, y envíalas por Telegram.")


def test_noticias_por_telegram_es_tarea_rapida_y_no_arreglo():
    from noviq import via_rapida as VRP
    from noviq.agent import pide_arreglo
    assert VRP.es_tarea_rapida(NOTICIAS)
    assert not pide_arreglo(NOTICIAS)           # antes «revisa» disparaba el diagnóstico del proyecto


def test_tareas_rapidas_y_de_programacion():
    from noviq import via_rapida as VRP
    rapidas = ["¿Qué clima hará mañana en Quito?", "Búscame el precio del dólar hoy", "Resume las noticias de tecnología",
               "Mándame por correo los resultados del partido de Ecuador", "Recuérdame llamar a Ana a las 5"]
    codigo = ["Crea una página web de recetas", "Revisa el código del login, no funciona", "busca el error en mi juego de naves",
              "Haz un script en Python que descargue noticias", "Resume el archivo informe.docx de mi proyecto"]
    for t in rapidas:
        assert VRP.es_tarea_rapida(t), t
    for t in codigo:
        assert not VRP.es_tarea_rapida(t), t


def test_pide_arreglo_sigue_detectando_fallas_reales():
    from noviq.agent import pide_arreglo
    for t in ("Revisa por qué mi juego no carga", "el login no funciona, arréglalo", "corrige el código de la calculadora",
              "me sale un error en la consola"):
        assert pide_arreglo(t), t
    for t in ("Revisa mi correo y dime lo importante", "corrige la ortografía de este texto: hola komo estas"):
        assert not pide_arreglo(t), t


def test_prompt_de_tarea_rapida_sin_arbol_de_archivos(monkeypatch):
    from noviq import agent as AG
    from noviq import tools as T
    monkeypatch.setattr(T, "project_info", lambda n: {"tipo": "general", "descripcion": ""})
    monkeypatch.setattr(AG, "project_tree", lambda p, limit=80: "config.json\nenviar_telegram.py")
    conv = {"id": "r1", "project": "_General", "messages": [{"role": "user", "content": NOTICIAS}], "tasks": [], "_rapida": True}
    s = AG.system_prompt(conv)
    assert "TAREA RÁPIDA" in s and "enviar_telegram.py" not in s and "Archivos del proyecto" not in s
    conv["_rapida"] = False
    assert "enviar_telegram.py" in AG.system_prompt(conv)


def test_tarea_rapida_sin_plan_ni_diagnostico(monkeypatch):
    from noviq import agent as AG
    from noviq import cerebro as CB
    conv = {"id": "r2", "project": "_General", "_rapida": True, "tasks": [],
            "messages": [{"role": "user", "content": NOTICIAS}], "display": []}
    assert CB.needs_plan(conv) is None
    llamado = []
    monkeypatch.setattr(AG, "diagnostico_texto", lambda *a, **k: llamado.append(1) or ("x", 1))
    AG.auto_diagnostico(conv, lambda *a: None, threading.Event())
    assert not llamado


def test_niveles_de_pedido():
    from noviq import via_rapida as VRP
    from noviq.agent import pide_arreglo
    casos = {
        "hola, ¿qué tal?": "charla", "gracias": "charla", "¿qué puedes hacer?": "charla",
        NOTICIAS: "rapida", "¿Qué clima hará mañana en Quito?": "rapida",
        "Crea una página web de recetas con buscador": "grande", "hazme un juego de naves en 3D": "grande",
        "Necesito una app para controlar mis gastos": "grande",
        "cambia el color del botón de guardar a verde en la página de login": "pequena",
        "el juego de naves no carga, arréglalo": "pequena",
        "agrega un campo de teléfono al formulario de la app": "pequena",
        "explícame cómo funciona la recursividad con un ejemplo en python": "normal",
    }
    for t, esperado in casos.items():
        assert VRP.nivel(t, arreglo=pide_arreglo(t)) == esperado, (t, VRP.nivel(t, arreglo=pide_arreglo(t)))


def test_cambio_puntual_sin_plan_y_con_guia(monkeypatch):
    from noviq import agent as AG
    from noviq import cerebro as CB
    from noviq import tools as T
    monkeypatch.setattr(T, "project_info", lambda n: {"tipo": "web", "descripcion": ""})
    monkeypatch.setattr(AG, "project_tree", lambda p, limit=80: "index.html")
    conv = {"id": "p1", "project": "tienda", "_nivel": "pequena", "tasks": [],
            "messages": [{"role": "user", "content": "cambia el color del botón de guardar a verde en la página de login"}]}
    assert CB.needs_plan(conv) is None
    s = AG.system_prompt(conv)
    assert "CAMBIO PUNTUAL" in s and "index.html" in s     # en un cambio puntual SÍ ve los archivos del proyecto


@pytest.mark.parametrize("pedido", [NOTICIAS, "hola", "cambia el color del botón de guardar a verde en la página de login",
                                    "Crea una página web de recetas"])
def test_ciclo_del_agente_corre_en_todos_los_niveles(monkeypatch, pedido):
    """El ciclo completo (run_agent → director → _run_once) debe correr en cada nivel sin errores (antes, la vía rápida
    caía con UnboundLocalError porque otro import usaba el nombre «VR»)."""
    from noviq import agent as AG
    from noviq import cerebro as CB
    monkeypatch.setattr(AG, "stream_chat", lambda *a, **k: ("Listo.", "", [], "stop"))
    monkeypatch.setattr(CB, "plan", lambda *a, **k: False)
    monkeypatch.setattr(AG, "fallback_chain", lambda conv, first=None: ["prueba::modelo"])
    monkeypatch.setattr(AG.EV, "modelo_inicial", lambda conv, want: ("prueba::modelo", None))
    monkeypatch.setattr(AG.EV, "registrar", lambda *a, **k: None)
    conv = {"id": "lv", "title": "x", "model": "prueba::modelo", "project": None, "tasks": [], "allowed_tools": [],
            "messages": [{"role": "user", "content": pedido}], "display": []}
    AG.run_agent(conv, lambda *a: None, threading.Event())
    assert conv["display"][-1]["text"] == "Listo."
