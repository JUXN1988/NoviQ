"""
Cliente Python para Noviq Avatar (sin dependencias; solo biblioteca estándar).

    from noviq_avatar import NoviqAvatar
    av = NoviqAvatar()                 # http://127.0.0.1:7777
    av.decir("Hola Gabriel")           # habla con burbuja y boca sincronizada
    av.textear("Enviando el reporte...", esperar=True)
    av.ir("abajo-derecha")
    av.herramientas(["engranaje", "codigo", "lupa"])
    for p in range(0, 101, 10):
        av.progreso(p, "Instalando")

Eventos en vivo (clic sobre el avatar, fin de acciones...) opcionales con:
    pip install websocket-client
    av.escuchar_eventos(lambda nombre, datos: print(nombre, datos))
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from typing import Any, Callable, Iterable, Optional


class NoviqAvatarError(RuntimeError):
    pass


class NoviqAvatar:
    def __init__(self, host: str = "127.0.0.1", puerto: int = 7777, token: str = "", timeout: float = 10.0):
        self.base = f"http://{host}:{puerto}"
        self.token = token
        self.timeout = timeout

    # ------------------------------------------------------------------ núcleo
    def _peticion(self, metodo: str, ruta: str, cuerpo: Any = None, timeout: Optional[float] = None) -> dict:
        datos = None if cuerpo is None else json.dumps(cuerpo).encode("utf-8")
        req = urllib.request.Request(self.base + ruta, data=datos, method=metodo)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("X-Noviq-Token", self.token)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                info = json.loads(e.read().decode("utf-8"))
            except Exception:
                info = {"error": str(e)}
            raise NoviqAvatarError(info.get("error", str(e))) from None
        except urllib.error.URLError as e:
            raise NoviqAvatarError(f"No se pudo conectar con el avatar en {self.base} ({e.reason}). ¿Está abierto?") from None

    def comando(self, cmd: str, esperar: bool = False, **params) -> dict:
        """Envía cualquier comando. Con esperar=True vuelve cuando la animación termina."""
        cuerpo = {"cmd": cmd, **{k: v for k, v in params.items() if v is not None}}
        ruta = "/comando?esperar=1" if esperar else "/comando"
        return self._peticion("POST", ruta, cuerpo, timeout=None if esperar else self.timeout)

    def secuencia(self, pasos: Iterable[dict], esperar: bool = False, repetir: int = 1) -> dict:
        return self.comando("secuencia", esperar=esperar, pasos=list(pasos), repetir=repetir)

    def estado(self) -> dict:
        return self._peticion("GET", "/estado", timeout=self.timeout)

    def disponible(self) -> bool:
        try:
            self.estado()
            return True
        except NoviqAvatarError:
            return False

    # ---------------------------------------------------------------- habla
    def decir(self, texto: str, voz: Optional[bool] = None, esperar: bool = False, **kw) -> dict:
        return self.comando("decir", esperar=esperar, texto=texto, voz=voz, **kw)

    def pensar(self, texto: str = "", esperar: bool = False, **kw) -> dict:
        return self.comando("pensar", esperar=esperar, texto=texto or None, **kw)

    def textear(self, texto: str = "", esperar: bool = False, **kw) -> dict:
        return self.comando("textear", esperar=esperar, texto=texto or None, **kw)

    def mensaje(self, texto: str, duracion: Optional[int] = None, **kw) -> dict:
        return self.comando("mensaje", texto=texto, duracion=duracion, **kw)

    def callar(self) -> dict:
        return self.comando("callar")

    def boca(self, abrir: float) -> dict:
        """Lip-sync externo: envía la amplitud de tu audio (0..1) ~30 veces por segundo."""
        return self.comando("boca", abrir=max(0.0, min(1.0, float(abrir))))

    # -------------------------------------------------------------- acciones
    def reir(self, **kw): return self.comando("reir", **kw)
    def saludar(self, lado: str = "derecha", **kw): return self.comando("saludar", lado=lado, **kw)
    def trabajar(self, duracion: Optional[int] = None, **kw): return self.comando("trabajar", duracion=duracion, **kw)
    def analizar(self, duracion: Optional[int] = None, **kw): return self.comando("analizar", duracion=duracion, **kw)
    def herramientas(self, lista: Optional[list] = None, **kw): return self.comando("herramientas", lista=lista, **kw)
    def herramienta_visor(self, nombre: str = "engranaje", duracion: int = 2500, **kw): return self.comando("herramienta", nombre=nombre, duracion=duracion, **kw)
    def escuchar(self, duracion: Optional[int] = None, **kw): return self.comando("escuchar", duracion=duracion, **kw)
    def aclarar(self, **kw): return self.comando("aclarar", **kw)
    def senalar(self, direccion: str = "derecha", **kw): return self.comando("senalar", direccion=direccion, **kw)
    def asentir(self, **kw): return self.comando("asentir", **kw)
    def negar(self, **kw): return self.comando("negar", **kw)
    def celebrar(self, **kw): return self.comando("celebrar", **kw)
    def sorpresa(self, **kw): return self.comando("sorpresa", **kw)
    def confundido(self, **kw): return self.comando("confundido", **kw)
    def dormir(self, **kw): return self.comando("dormir", **kw)
    def despertar(self, **kw): return self.comando("despertar", **kw)
    def bailar(self, **kw): return self.comando("bailar", **kw)
    def progreso(self, valor: float, etiqueta: Optional[str] = None, **kw): return self.comando("progreso", valor=valor, etiqueta=etiqueta, **kw)
    def detener(self): return self.comando("detener")

    # ---- Avisos, sonidos y oído (v1.1)
    def aviso(self, tipo: str = "info", texto: str = "", voz: Optional[bool] = None, **kw):
        """Mensaje corto con sonido de robot + gesto: exito, error, atencion, permiso, pregunta, info, trabajando, saludo, adios."""
        return self.comando("aviso", tipo=tipo, texto=texto, voz=voz, **kw)
    def sonido(self, nombre: str = "blip", esperar: bool = False): return self.comando("sonido", esperar=esperar, nombre=nombre)
    def sonidos(self, activo: bool = True, volumen: Optional[float] = None): return self.comando("sonidos", activo=activo, volumen=volumen)
    def microfono(self, modo: Optional[str] = None):
        """Sin modo: escucha UNA frase ahora. modo: apagado | palabra | siempre | pulsar."""
        return self.comando("microfono", modo=modo) if modo else self.comando("microfono")
    def configurar(self, **kw): return self.comando("configurar", **kw)

    def charlar(self, texto: str, hablar: bool = True) -> dict:
        """🧠 Conversa con su mente propia (memoria, personalidad, IA y herramientas). Devuelve {"respuesta", "accion", …}."""
        return self._peticion("POST", "/charla", {"texto": texto, "hablar": hablar}, timeout=60)

    # ------------------------------------------------- mente, memoria y ajustes (v2: el avatar es independiente)
    def ajustes(self) -> dict:
        """Sus ajustes (voz, oído, cerebro, personalidad…). Las claves nunca se devuelven."""
        return self._peticion("GET", "/api/ajustes")["ajustes"]
    def cambiar_ajustes(self, **parcial) -> dict:
        """Ej.: cambiar_ajustes(voz={"velocidad": 1.1}, identidad={"personalidad": ["profesor", "tranquilo"]})."""
        return self._peticion("POST", "/api/ajustes", parcial)
    def memoria(self) -> dict: return self._peticion("GET", "/api/memoria")["memoria"]
    def recordar(self, texto: str): return self.comando("recordar", texto=texto)
    def recordatorio(self, texto: str, cuando: str):
        """cuando en palabras: «mañana a las 9», «en 20 minutos», «los lunes a las 7»."""
        return self.comando("recordatorio", esperar=True, texto=texto, cuando=cuando)
    def preguntar(self, texto: str, id: str = "", segundos: int = 30):
        """Pregunta al usuario; la respuesta llega como evento «respuesta» {id, valor: si|no|otro, texto} (escuchar_eventos)."""
        return self.comando("preguntar", esperar=True, texto=texto, id=id or None, segundos=segundos)
    def contar(self, texto: str, app: str = "python"):
        """Le cuentas algo que pasó en tu programa (queda en su memoria de charla)."""
        return self._peticion("POST", "/api/eventos-app", {"app": app, "tipo": "nota", "texto": texto})
    def herramientas_disponibles(self) -> dict: return self._peticion("GET", "/api/herramientas")
    def usar_herramienta(self, nombre: str, **args) -> dict:
        """Ej.: usar_herramienta("buscar_internet", consulta="clima en Quito")."""
        return self._peticion("POST", "/api/herramienta", {"nombre": nombre, "args": args}, timeout=90)
    def hablar_audio(self, texto: str, **op) -> dict:
        """Texto → audio con su voz (base64 en "audio", "formato": mp3|wav)."""
        return self._peticion("POST", "/api/voz/hablar", dict(op, texto=texto), timeout=40)
    def transcribir(self, wav_bytes: bytes, entender: bool = False) -> dict:
        import base64
        return self._peticion("POST", "/api/voz/escuchar", {"audio": base64.b64encode(wav_bytes).decode(), "entender": entender}, timeout=60)

    # ------------------------------------------------------- cara y cuerpo
    def expresion(self, nombre: str, duracion: Optional[int] = None): return self.comando("expresion", valor=nombre, duracion=duracion)
    def mirar(self, direccion: str = "frente", duracion: Optional[int] = None): return self.comando("mirar", direccion=direccion, duracion=duracion)
    def cabeza(self, giro=None, inclinacion=None, rotacion=None, duracion=None):
        return self.comando("cabeza", giro=giro, inclinacion=inclinacion, rotacion=rotacion, duracion=duracion)
    def brazo(self, lado="derecha", hombro=None, codo=None, muneca=None, gesto=None, duracion=None):
        return self.comando("brazo", lado=lado, hombro=hombro, codo=codo, muneca=muneca, gesto=gesto, duracion=duracion)
    def mano(self, gesto: str, lado: str = "derecha", duracion: Optional[int] = None):
        return self.comando("mano", gesto=gesto, lado=lado, duracion=duracion)
    def soltar(self): return self.comando("soltar")

    # ------------------------------------------------------ pantalla / modo
    def mover(self, x, y, duracion: Optional[int] = None, esperar: bool = False): return self.comando("mover", esperar=esperar, x=x, y=y, duracion=duracion)
    def ir(self, lugar: str, esperar: bool = False, **kw): return self.comando("ir", esperar=esperar, a=lugar, **kw)
    def desplazar(self, dx: int = 0, dy: int = 0, esperar: bool = False): return self.comando("desplazar", esperar=esperar, dx=dx, dy=dy)
    def escala(self, valor: float): return self.comando("escala", valor=valor)
    def pasear(self, activo: bool = True): return self.comando("pasear", activo=activo)
    def seguir(self, activo: bool = True): return self.comando("seguir", activo=activo)
    def ocultar(self): return self.comando("ocultar")
    def mostrar(self): return self.comando("mostrar")
    def icono(self): return self.comando("icono")
    def expandir(self): return self.comando("expandir")

    # --------------------------------------------------------------- eventos
    def escuchar_eventos(self, callback: Callable[[str, dict], None], en_hilo: bool = True):
        """Recibe eventos (clic, doble_clic, accion_fin, habla_fin, movimiento_fin...). Requiere websocket-client."""
        try:
            import websocket  # type: ignore
        except ImportError:
            raise NoviqAvatarError("Instala 'websocket-client' para recibir eventos: pip install websocket-client")
        url = self.base.replace("http://", "ws://") + "/ws" + (f"?token={self.token}" if self.token else "")

        def al_mensaje(_ws, msg):
            j = json.loads(msg)
            if j.get("tipo") == "evento":
                callback(j.get("nombre"), j.get("datos", {}))

        app = websocket.WebSocketApp(url, on_message=al_mensaje)
        if en_hilo:
            h = threading.Thread(target=app.run_forever, kwargs={"reconnect": 2}, daemon=True)
            h.start()
            return app
        app.run_forever(reconnect=2)
        return app


if __name__ == "__main__":
    import time

    av = NoviqAvatar()
    if not av.disponible():
        raise SystemExit("El avatar no está abierto. Ejecuta iniciar.bat primero.")
    av.ir("centro", esperar=True)
    av.saludar()
    av.decir("¡Hola! Soy Noviq. Te muestro lo que sé hacer.", esperar=True)
    av.textear("Escribiendo un mensaje en el teclado holográfico...", esperar=True)
    av.pensar("Mmm... ¿qué analizo primero?", esperar=True)
    av.analizar(duracion=4000, esperar=True)
    av.herramientas(["engranaje", "codigo", "lupa", "base_datos", "chip"], esperar=True)
    av.trabajar(duracion=4000, esperar=True)
    for p in range(0, 101, 5):
        av.progreso(p, "Instalando módulos")
        time.sleep(0.12)
    time.sleep(2)
    av.reir(esperar=True)
    av.celebrar(esperar=True)
    av.ir("abajo-derecha", esperar=True)
    av.decir("Listo. Estoy a tus órdenes.")
