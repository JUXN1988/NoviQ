# -*- coding: utf-8 -*-
"""🟩 Herramientas NVIDIA de Noviq (para juegos Y para programación en general).

- info(): qué tarjeta tienes (arquitectura, VRAM, capacidad CUDA, RT/Tensor cores, DLSS, NVENC), qué hay instalado
  (CUDA Toolkit, ffmpeg con NVENC, Ollama, Blender, Unreal Engine, apps de NVIDIA/Omniverse) y cómo aprovecharlo.
- consejos(tema): cómo usar la GPU en PyTorch, CuPy, video (NVENC), IA local, juegos web, Unreal/DLSS, Omniverse/USD.
- textura(): texturas PBR sin costuras con IA (FLUX de build.nvidia.com) + mapa normal calculado en tu PC.
- modelo_3d(): modelos 3D (.glb) desde un texto con Microsoft TRELLIS en build.nvidia.com.
- cara_voz(): animación facial desde una voz (.wav) con NVIDIA Audio2Face-3D (API en la nube, cliente oficial).

Todo usa la misma API key de NVIDIA que ya guardaste en ⚙ Ajustes (bóveda cifrada)."""
import base64
import io
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import requests

from .config import CONFIG, IS_WINDOWS, NO_WINDOW

GENAI = os.environ.get("NVIDIA_IMAGE_BASE", "https://ai.api.nvidia.com/v1/genai")
_cache = {"info": None, "t": 0}

ARQ = [  # (capacidad CUDA mínima, nombre, generación)
    (12.0, "Blackwell", "RTX 50"), (10.0, "Blackwell", "centro de datos"), (9.0, "Hopper", "centro de datos"),
    (8.9, "Ada Lovelace", "RTX 40"), (8.6, "Ampere", "RTX 30"), (8.0, "Ampere", "A100"), (7.5, "Turing", "RTX 20 / GTX 16"),
    (7.0, "Volta", "Titan V"), (6.0, "Pascal", "GTX 10"), (5.0, "Maxwell", "GTX 900"), (3.0, "Kepler", "GTX 600/700"),
]


def _cc_por_nombre(nombre):
    n = (nombre or "").upper()
    for rx, cc in ((r"RTX\s*50\d\d", 12.0), (r"RTX\s*40\d\d|RTX\s*\d+\s*ADA|L40", 8.9), (r"RTX\s*30\d\d|RTX\s*A\d{4}|A40|A10\b", 8.6),
                   (r"A100", 8.0), (r"RTX\s*20\d\d|GTX\s*16\d\d|QUADRO RTX|T4\b|TITAN RTX", 7.5), (r"GTX\s*10\d\d|TITAN X", 6.1),
                   (r"GTX\s*9\d\d", 5.2)):
        if re.search(rx, n):
            return cc
    return None


def _arq(cc):
    for mn, nombre, gen in ARQ:
        if cc is not None and cc >= mn:
            return nombre, gen
    return "desconocida", ""


def _run(cmd, timeout=8):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=NO_WINDOW)
        return (r.stdout or "") + (r.stderr or "")
    except Exception:
        return ""


def _smi():
    smi = shutil.which("nvidia-smi")
    if not smi and IS_WINDOWS:
        c = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
        smi = str(c) if c.exists() else None
    return smi


def _apps():
    """Programas útiles instalados (NVIDIA, Omniverse, motores de juego, Blender)."""
    out = []
    if not IS_WINDOWS:
        for n, exe in (("Blender", "blender"), ("Godot", "godot"), ("Ollama", "ollama"), ("ffmpeg", "ffmpeg")):
            if shutil.which(exe):
                out.append({"nombre": n, "ruta": shutil.which(exe)})
        return out
    pf = [Path(os.environ.get(k, "")) for k in ("ProgramFiles", "ProgramFiles(x86)") if os.environ.get(k)]
    la = Path(os.environ.get("LOCALAPPDATA", ""))
    cands = []
    for b in pf:
        cands += [(b / "NVIDIA Corporation" / n, n) for n in ("NVIDIA Canvas", "NVIDIA Broadcast", "NVIDIA app", "ChatRTX",
                                                              "NVIDIA Omniverse", "Audio2Face")]
        cands += [(p, p.name) for p in (b / "Epic Games").glob("UE_5*")] if (b / "Epic Games").exists() else []
        cands += [(p, p.name) for p in (b / "Blender Foundation").glob("Blender*")] if (b / "Blender Foundation").exists() else []
        cands += [(b / "NVIDIA GPU Computing Toolkit" / "CUDA", "CUDA Toolkit")]
        cands += [(b / "Ollama", "Ollama")]
    if la.name:
        cands += [(la / "Programs" / "Ollama", "Ollama"), (la / "NVIDIA" / "ChatRTX", "ChatRTX")]
        ov = la / "ov" / "pkg"
        if ov.exists():
            cands += [(p, "Omniverse · " + p.name) for p in ov.iterdir() if p.is_dir()]
    vistos = set()
    for p, n in cands:
        try:
            if p.exists() and n not in vistos:
                vistos.add(n)
                out.append({"nombre": n, "ruta": str(p)})
        except OSError:
            pass
    return out


def info(max_age=120):
    """Todo lo que Noviq sabe de tu GPU NVIDIA y de las herramientas para aprovecharla."""
    if _cache["info"] and time.time() - _cache["t"] < max_age:
        return _cache["info"]
    from . import recursos as R
    from . import vault
    gpus = [dict(g) for g in (R.gpu_info(max_age=30) or [])]
    smi = _smi()
    driver = cuda = ""
    if smi:
        head = _run([smi])
        m = re.search(r"CUDA Version:\s*([\d.]+)", head)
        cuda = m.group(1) if m else ""
        q = _run([smi, "--query-gpu=name,compute_cap,driver_version", "--format=csv,noheader"])
        for i, line in enumerate(l for l in q.splitlines() if l.strip()):
            p = [x.strip() for x in line.split(",")]
            if i < len(gpus) and len(p) >= 3:
                try:
                    gpus[i]["cc"] = float(p[1])
                except ValueError:
                    pass
                driver = p[2]
    for g in gpus:
        if not g.get("nvidia"):
            continue
        cc = g.get("cc") or _cc_por_nombre(g.get("nombre"))
        g["cc"] = cc
        arq, gen = _arq(cc)
        rtx = "RTX" in (g.get("nombre") or "").upper() and (cc or 0) >= 7.5
        g.update({"arquitectura": arq, "generacion": gen, "rt_cores": rtx, "tensor_cores": (cc or 0) >= 7.0 and "GTX 16" not in g.get("nombre", ""),
                  "dlss": rtx, "dlss_generacion_frames": rtx and (cc or 0) >= 8.9, "dlss_multi_frame": rtx and (cc or 0) >= 12.0,
                  "nvenc_av1": (cc or 0) >= 8.9, "nvenc": (cc or 0) >= 5.0})
    nv = next((g for g in gpus if g.get("nvidia")), None)
    nvcc = shutil.which("nvcc") or (str(Path(os.environ["CUDA_PATH"]) / "bin" / ("nvcc.exe" if IS_WINDOWS else "nvcc"))
                                    if os.environ.get("CUDA_PATH") else None)
    toolkit = ""
    if nvcc and Path(nvcc).exists():
        m = re.search(r"release\s+([\d.]+)", _run([nvcc, "--version"]))
        toolkit = m.group(1) if m else "instalado"
    ff = shutil.which("ffmpeg")
    nvenc = []
    if ff and nv:
        enc = _run([ff, "-hide_banner", "-encoders"], timeout=6)
        nvenc = sorted(set(re.findall(r"\b(h264_nvenc|hevc_nvenc|av1_nvenc)\b", enc)))
    cc = (nv or {}).get("cc") or 0
    res = {"hay_nvidia": bool(nv), "gpus": gpus, "principal": nv, "driver": driver, "cuda_driver": cuda, "cuda_toolkit": toolkit,
           "ffmpeg": bool(ff), "ffmpeg_nvenc": nvenc, "apps": _apps(), "clave_nvidia": bool(vault.get_keys("nvidia")),
           "pytorch_indice": ("cu128" if cc >= 12.0 else "cu126") if nv else "cpu",
           "t": time.strftime("%Y-%m-%d %H:%M")}
    _cache.update(info=res, t=time.time())
    return res


def resumen(i=None):
    i = i or info()
    if not i["hay_nvidia"]:
        g = (i["gpus"] or [{}])[0].get("nombre") or "no se detectó tarjeta dedicada"
        return (f"🖥 GPU: {g} (sin tarjeta NVIDIA). Juegos: usa estilos livianos (vóxel HD o 2D pixel art). Programas: todo "
                "funciona en CPU; las herramientas de IA en la nube de NVIDIA (imágenes, texturas, 3D) igual funcionan con tu clave.")
    g = i["principal"]
    feats = [x for x, ok in (("RT cores (trazado de rayos)", g.get("rt_cores")), ("Tensor cores (IA)", g.get("tensor_cores")),
                             ("DLSS", g.get("dlss")), ("DLSS generación de frames", g.get("dlss_generacion_frames")),
                             ("DLSS 4 multi-frame", g.get("dlss_multi_frame")), ("NVENC AV1", g.get("nvenc_av1"))) if ok]
    apps = ", ".join(a["nombre"] for a in i["apps"][:10]) or "ninguna detectada"
    return (f"🟩 {g.get('nombre')} · {g.get('vram_total_gb', '?')} GB VRAM ({g.get('vram_libre_gb', '?')} GB libres) · "
            f"{g.get('arquitectura')} ({g.get('generacion')}), CUDA {g.get('cc') or '?'} · driver {i['driver'] or '?'} "
            f"(CUDA {i['cuda_driver'] or '?'})\nFunciones: {', '.join(feats) or 'básicas'}\n"
            f"CUDA Toolkit: {i['cuda_toolkit'] or 'no instalado (no hace falta para PyTorch/CuPy)'} · ffmpeg NVENC: "
            f"{', '.join(i['ffmpeg_nvenc']) or ('ffmpeg sin NVENC' if i['ffmpeg'] else 'ffmpeg no instalado')}\n"
            f"Programas detectados: {apps}\nAPI de NVIDIA (imágenes, texturas, 3D, Audio2Face): "
            f"{'✔ clave guardada' if i['clave_nvidia'] else '✖ falta la clave en ⚙ Ajustes'}")


CONSEJOS = {
    "pytorch": "PyTorch con tu GPU: `pip install torch torchvision --index-url https://download.pytorch.org/whl/{idx}` y prueba "
               "`python -c \"import torch;print(torch.cuda.is_available(), torch.cuda.get_device_name(0))\"`. En código: "
               "`dev = 'cuda' if torch.cuda.is_available() else 'cpu'` y `modelo.to(dev)`. Para inferencia usa `torch.autocast('cuda', dtype=torch.float16)`.",
    "cupy": "Cálculo numérico en la GPU: `pip install cupy-cuda12x` y usa `import cupy as cp` como si fuera numpy (cp.asarray, "
            "cp.asnumpy para volver). Numba: `@cuda.jit`. Para modelos ONNX: `pip install onnxruntime-gpu`.",
    "video": "Video por hardware (NVENC, casi sin usar CPU): `ffmpeg -hwaccel cuda -i entrada.mp4 -c:v h264_nvenc -preset p5 -cq 23 "
             "salida.mp4` (hevc_nvenc para H.265; av1_nvenc en RTX 40/50). Para decodificar usa `-hwaccel cuda`.",
    "ia_local": "IA local: Ollama y LM Studio usan la GPU solos. Con {vram} GB de VRAM caben modelos de ~{param}B parámetros "
                "cuantizados (Q4). Noviq ajusta el contexto según la VRAM libre (⚙ Ajustes → IA local).",
    "juegos_web": "Juegos web (Three.js/WebGL): el navegador usa tu GPU mediante ANGLE/Direct3D. Reglas de rendimiento: "
                  "geometrías/materiales creados UNA vez, InstancedMesh para objetos repetidos, sombras solo del sol, "
                  "pixelRatio ≤ 1.5, niebla para recortar la distancia de dibujo, y dispose() de lo que se quita.",
    "unreal": "DLSS, generación de frames y trazado de rayos real (RTX) se usan en Unreal Engine 5 con el plugin oficial "
              "«NVIDIA DLSS» (Fab / developer.nvidia.com/rtx/dlss) y en Unity con NVIDIA DLSS (HDRP). Los juegos web no pueden "
              "usar DLSS. Audio2Face tiene plugin oficial para UE 5.5/5.6 (código abierto desde 2025).",
    "omniverse": "Omniverse: el Launcher se retiró en 2025; ahora se usan las apps Kit (USD Composer/Explorer) y el formato "
                 "OpenUSD. Para llevar un juego a Omniverse exporta los modelos a .usd (Blender: Archivo → Exportar → USD) o "
                 "usa `pip install usd-core` en Python. Poly Haven ofrece muchos modelos directamente en USD.",
    "audio2face": "Audio2Face-3D convierte una voz (.wav 16-bit) en animación facial (blendshapes ARKit en CSV). Noviq usa la "
                  "API en la nube con tu clave (nvidia_ia accion='cara_voz'). Para usarlo en un motor: plugin de Unreal "
                  "Engine 5 o importar el CSV como curvas de animación.",
}


def consejos(tema="todo", i=None):
    i = i or info()
    vram = ((i.get("principal") or {}).get("vram_total_gb") or 0)
    param = 7 if vram < 10 else 14 if vram < 14 else 30 if vram < 20 else 70
    temas = list(CONSEJOS) if tema in ("", "todo", None) else [t for t in CONSEJOS if t == tema or tema in t]
    if not temas:
        return "Temas: " + ", ".join(CONSEJOS)
    return "\n\n".join(f"**{t}**: " + CONSEJOS[t].format(idx=i.get("pytorch_indice", "cu126"), vram=vram, param=param)
                       for t in temas)


# ───────────── API de IA generativa de NVIDIA (build.nvidia.com) ─────────────
def _claves():
    from . import vault
    return vault.get_keys("nvidia")


def genai(modelo, payload, timeout=300, accept="application/json"):
    """POST a ai.api.nvidia.com/v1/genai/<modelo> probando cada clave. Devuelve (bytes|dict, content_type)."""
    keys = _claves()
    if not keys:
        raise RuntimeError("falta la API key de NVIDIA (⚙ Ajustes → Proveedores → NVIDIA). Consíguela gratis en build.nvidia.com")
    url = f"{GENAI}/{modelo}"
    r, ultimo = None, ""
    try:
        from .providers import clave_actual
        start = clave_actual("nvidia") % len(keys)
    except Exception:
        start = 0
    for k in keys[start:] + keys[:start]:
        try:
            r = requests.post(url, headers={"Authorization": f"Bearer {k}", "Accept": accept}, json=payload, timeout=timeout)
        except requests.RequestException as e:
            ultimo = f"sin conexión ({type(e).__name__})"
            continue
        if r.status_code == 202:  # trabajo asíncrono (NVCF): se consulta hasta que termine
            rid = r.headers.get("NVCF-REQID") or r.headers.get("nvcf-reqid")
            t0 = time.time()
            while rid and r.status_code == 202 and time.time() - t0 < timeout:
                time.sleep(2)
                r = requests.get(f"https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/{rid}",
                                 headers={"Authorization": f"Bearer {k}", "Accept": accept}, timeout=60)
        if r.status_code in (401, 403, 429):
            ultimo = f"{r.status_code}: {r.text[:200]}"
            continue
        break
    if r is None:
        raise RuntimeError(ultimo or "no se pudo conectar con NVIDIA")
    if r.status_code != 200:
        raise RuntimeError(f"NVIDIA respondió {r.status_code}: {r.text[:500]}")
    ct = r.headers.get("Content-Type", "")
    if "json" in ct:
        return r.json(), ct
    return r.content, ct


def _b64_de(d):
    if isinstance(d, dict):
        arts = d.get("artifacts")
        if isinstance(arts, list) and arts:
            a = arts[0]
            if a.get("finishReason") == "CONTENT_FILTERED":
                raise RuntimeError("el filtro de contenido de NVIDIA bloqueó el pedido; reescríbelo con otras palabras")
            return a.get("base64")
        return d.get("image") or d.get("b64_json") or ((d.get("data") or [{}])[0] or {}).get("b64_json") or d.get("glb")
    return None


def imagen(prompt, ancho=1024, alto=1024, modelo=None, seed=0):
    """Bytes de una imagen generada con FLUX (u otro modelo de imágenes de build.nvidia.com)."""
    modelo = modelo or CONFIG.get("image_model") or "black-forest-labs/flux.1-schnell"
    if "schnell" in modelo:
        payload = {"prompt": prompt, "width": ancho, "height": alto, "seed": seed, "steps": 4}
    elif "flux" in modelo:
        payload = {"prompt": prompt, "mode": "base", "cfg_scale": 3.5, "width": ancho, "height": alto, "seed": seed, "steps": 30}
    else:
        payload = {"prompt": prompt, "width": ancho, "height": alto, "seed": seed}
    try:
        d, _ = genai(modelo, payload, timeout=240)
    except RuntimeError as e:
        if " 422" in str(e) or " 400" in str(e):
            d, _ = genai(modelo, {"prompt": prompt}, timeout=240)
        else:
            raise
    b64 = _b64_de(d) if isinstance(d, dict) else None
    if isinstance(d, bytes):
        return d
    if not b64:
        raise RuntimeError("respuesta sin imagen: " + json.dumps(d)[:300])
    return base64.b64decode(b64)


def _sin_costuras(im):
    """Hace una imagen repetible (tileable): se desplaza media imagen y la cruz central se funde con la original."""
    from PIL import Image
    w, h = im.size
    desplazada = Image.new(im.mode, (w, h))
    desplazada.paste(im.crop((w // 2, h // 2, w, h)), (0, 0))
    desplazada.paste(im.crop((0, h // 2, w // 2, h)), (w - w // 2, 0))
    desplazada.paste(im.crop((w // 2, 0, w, h // 2)), (0, h - h // 2))
    desplazada.paste(im.crop((0, 0, w // 2, h // 2)), (w - w // 2, h - h // 2))
    # máscara: 255 cerca de la cruz central (donde la imagen desplazada tiene la costura), 0 en los bordes
    from PIL import ImageChops
    banda = max(8, w // 6)
    fila = [int(255 * max(0.0, 1 - abs(x - w / 2) / banda)) for x in range(w)]
    col = [int(255 * max(0.0, 1 - abs(y - h / 2) / banda)) for y in range(h)]
    mh = Image.new("L", (w, 1))
    mh.putdata(fila)
    mv = Image.new("L", (1, h))
    mv.putdata(col)
    mask = ImageChops.lighter(mh.resize((w, h)), mv.resize((w, h)))
    return Image.composite(im, desplazada, mask)


def _mapa_normal(im, fuerza=2.0):
    """Mapa normal (formato OpenGL, verde hacia arriba) a partir del brillo, repitiendo los bordes."""
    from PIL import Image, ImageFilter
    g = im.convert("L")
    w, h = g.size
    big = Image.new("L", (w + 2, h + 2))
    for dx, dy in ((0, 0), (-w, 0), (w, 0), (0, -h), (0, h), (-w, -h), (w, h), (-w, h), (w, -h)):
        big.paste(g, (1 + dx, 1 + dy))
    sx = big.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], scale=8 / fuerza, offset=128)).crop((1, 1, w + 1, h + 1))
    sy = big.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], scale=8 / fuerza, offset=128)).crop((1, 1, w + 1, h + 1))
    r = sx.point(lambda v: 255 - v)
    b = Image.new("L", (w, h), 235)
    return Image.merge("RGB", (r, sy.point(lambda v: 255 - v), b))


def textura(descripcion, carpeta, nombre="textura", sin_costuras=True, mapa_normal=True, tam=1024, seed=0):
    """Genera una textura PBR repetible con IA. Devuelve {"color", "normal", "carpeta", "prompt"}."""
    from PIL import Image
    prompt = (f"seamless tileable texture of {descripcion}, top-down orthographic view, flat even lighting, no shadows, "
              "no perspective, no objects on top, highly detailed surface, game PBR albedo texture")
    raw = imagen(prompt, tam, tam, seed=seed)
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.size[0] > 1024 and tam <= 1024:
        im = im.resize((1024, 1024), Image.LANCZOS)
    if sin_costuras:
        im = _sin_costuras(im)
    carpeta = Path(carpeta) / re.sub(r"[^\w\-]+", "_", nombre)[:40]
    carpeta.mkdir(parents=True, exist_ok=True)
    out = {"carpeta": str(carpeta), "prompt": prompt}
    fc = carpeta / "color.jpg"
    im.save(fc, quality=90)
    out["color"] = str(fc)
    if mapa_normal:
        fn = carpeta / "normal.jpg"
        _mapa_normal(im).save(fn, quality=92)
        out["normal"] = str(fn)
    return out


def modelo_3d(descripcion, carpeta, nombre="modelo", sin_textura=False, seed=0):
    """Modelo 3D .glb desde un texto (Microsoft TRELLIS en build.nvidia.com). La descripción debe ser corta y en inglés."""
    prompt = re.sub(r"\s+", " ", descripcion).strip()[:77]
    payload = {"mode": "text", "prompt": prompt, "seed": seed, "samples": 1, "output_format": "glb", "no_texture": bool(sin_textura)}
    d, ct = genai("microsoft/trellis", payload, timeout=420)
    data = d if isinstance(d, bytes) else None
    if data is None:
        b64 = _b64_de(d)
        if not b64:
            raise RuntimeError("TRELLIS no devolvió un modelo: " + json.dumps(d)[:300])
        data = base64.b64decode(b64)
    if data[:4] != b"glTF":
        raise RuntimeError("TRELLIS devolvió un archivo que no es .glb (" + (ct or "?") + ")")
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    f = carpeta / (re.sub(r"[^\w\-]+", "_", nombre)[:40] + ".glb")
    f.write_bytes(data)
    return {"glb": str(f), "bytes": len(data), "prompt": prompt}


# ───────────── Audio2Face-3D (voz → animación facial) ─────────────
A2F_FUNCIONES = {"mark": "8efc55f5-6f00-424e-afe9-26212cd2c630", "claire": "0961a6da-fb9e-4f2e-8491-247e5fd7bf8d",
                 "james": "9327c39f-a361-4e02-bd72-e11b4c9b7b5e"}
A2F_REPO = "https://github.com/NVIDIA/Audio2Face-3D-Samples"


def cara_voz(wav, carpeta_salida, personaje="mark", herramientas=None, emit=None):
    """Envía una voz .wav (PCM 16-bit) a Audio2Face-3D y guarda los blendshapes (CSV) en carpeta_salida.
    Usa el cliente oficial de NVIDIA (se descarga una vez en Noviq_Proyectos/_Herramientas)."""
    from .config import projects_root, python_exe
    log = (lambda t: emit(t)) if emit else (lambda t: None)
    wav = Path(wav)
    if not wav.exists() or wav.suffix.lower() != ".wav":
        raise RuntimeError("necesito un archivo .wav (PCM 16-bit, mono). Conviértelo con: ffmpeg -i voz.mp3 -ac 1 -ar 16000 -sample_fmt s16 voz.wav")
    keys = _claves()
    if not keys:
        raise RuntimeError("falta la API key de NVIDIA (⚙ Ajustes)")
    fid = A2F_FUNCIONES.get((personaje or "mark").lower(), personaje)
    base = Path(herramientas) if herramientas else projects_root() / "_Herramientas"
    repo = base / "Audio2Face-3D-Samples"
    git = shutil.which("git")
    if not repo.exists():
        if not git:
            raise RuntimeError("falta git para descargar el cliente oficial (instálalo con instalar_herramienta git)")
        base.mkdir(parents=True, exist_ok=True)
        log("⬇ Descargando el cliente oficial de Audio2Face-3D (una sola vez)…")
        r = subprocess.run([git, "clone", "--depth", "1", A2F_REPO, str(repo)], capture_output=True, text=True, timeout=600,
                           creationflags=NO_WINDOW)
        if r.returncode:
            raise RuntimeError("no pude descargar el cliente: " + (r.stderr or r.stdout)[-400:])
    cli = next(iter(repo.rglob("nim_a2f_3d_client.py")), None)
    if not cli:
        raise RuntimeError(f"no encontré nim_a2f_3d_client.py en {repo}; revisa el repositorio {A2F_REPO}")
    d = cli.parent
    py = python_exe() or "python"
    venv = d / ".venv"
    vpy = venv / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
    if not vpy.exists():
        log("🐍 Preparando el entorno del cliente (una sola vez)…")
        subprocess.run([py, "-m", "venv", str(venv)], capture_output=True, timeout=300, creationflags=NO_WINDOW)
        whl = sorted(repo.rglob("*.whl"))
        reqs = [str(p) for p in (d / "requirements.txt",) if p.exists()]
        for args in ([str(w) for w in whl[:2]], ["-r", reqs[0]] if reqs else []):
            if args:
                r = subprocess.run([str(vpy), "-m", "pip", "install", *args], capture_output=True, text=True, timeout=900,
                                   creationflags=NO_WINDOW)
                if r.returncode:
                    raise RuntimeError("pip falló: " + (r.stderr or r.stdout)[-500:])
    cfg = next(iter(sorted(d.rglob("config*.yml")) + sorted(d.rglob("*.yaml")) + sorted(repo.rglob("config*.yml"))), None)
    if not cfg:
        raise RuntimeError("no encontré el archivo de configuración .yml del cliente")
    antes = {p: p.stat().st_mtime for p in d.rglob("*") if p.is_file()}
    log(f"🙂 Audio2Face-3D ({personaje}) procesando {wav.name}…")
    r = subprocess.run([str(vpy), str(cli), str(wav), str(cfg), "--apikey", keys[0], "--function-id", fid],
                       cwd=str(d), capture_output=True, text=True, timeout=900, creationflags=NO_WINDOW)
    if r.returncode:
        raise RuntimeError("Audio2Face-3D falló: " + (r.stderr or r.stdout)[-600:])
    nuevos = [p for p in d.rglob("*") if p.is_file() and p.suffix.lower() in (".csv", ".json", ".wav")
              and (p not in antes or p.stat().st_mtime > antes[p]) and ".venv" not in p.parts]
    dest = Path(carpeta_salida)
    dest.mkdir(parents=True, exist_ok=True)
    copiados = []
    for p in nuevos:
        q = dest / f"{wav.stem}_{p.name}"
        shutil.copy2(p, q)
        copiados.append(str(q))
    return {"archivos": copiados, "salida": r.stdout[-800:]}
