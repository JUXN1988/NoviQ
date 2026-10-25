# -*- coding: utf-8 -*-
"""⚙ Agente de recursos: que Noviq trabaje rápido SIN colapsar la PC.

Mide la PC de verdad (RAM LIBRE, no la total; procesador, disco, tarjeta gráfica y memoria de video libre) y, con
eso, reparte un «presupuesto»: siempre deja una RESERVA para Windows y los demás programas, y solo el resto se usa
para lo pesado que lanza Noviq:
  • máquina virtual Linux (WSL) y contenedores Docker → límites de memoria/CPU (.wslconfig y docker --memory/--cpus)
  • navegador invisible de pruebas → uno a la vez, con memoria de JavaScript limitada y usando la GPU si hay
  • programas que se prueban/ejecutan → se ejecutan NATIVOS (sin máquina virtual: más livianos) pero dentro de un
    «Job Object» de Windows que limita su memoria y su CPU, como si fueran un contenedor
  • IA local (Ollama) → contexto calculado con la VRAM y la RAM LIBRES
  • vista previa de páginas/juegos dentro de la ventana de Noviq → se detiene si se dispara la memoria
Un VIGILANTE revisa la memoria cada 10 s: si la RAM libre baja de la reserva, pausa lo pesado nuevo (espera a que
se libere) y avisa a la ventana para que detenga las vistas previas.

Perfiles: auto (según la RAM libre del momento) · basico · equilibrado · potente · personalizado.
Todo es a prueba de fallos: si algo no se puede medir, se usan valores prudentes y Noviq sigue funcionando."""
import json
import os
import platform
import re
import shutil
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from .config import CONFIG, DATA_DIR, IS_WINDOWS, NO_WINDOW

GB = 1024 ** 3
_lock = threading.RLock()
_cache = {"t": 0.0, "m": None, "gpu_t": 0.0, "gpu": None, "cpu_prev": None, "procs_t": 0.0, "procs": None}
_estado = {"nivel": "ok", "ahorro": False, "detener_vista": "", "detener_t": 0, "ultimo": None, "avisos": []}
_sem = {}

PERFILES = {
    "basico": {"nombre": "Básico (PC con poca memoria)", "vm_gb": 2, "vm_cpus": 2, "swap_gb": 1, "navegadores": 1,
               "equipo": 1, "js_mb": 768, "proc_mb": 1536, "cpu_pct": 60, "vista_auto": False},
    "equilibrado": {"nombre": "Equilibrado", "vm_gb": 4, "vm_cpus": 4, "swap_gb": 2, "navegadores": 1, "equipo": 2,
                    "js_mb": 1536, "proc_mb": 3072, "cpu_pct": 75, "vista_auto": False},
    "potente": {"nombre": "Potente (PC con mucha memoria)", "vm_gb": 8, "vm_cpus": 8, "swap_gb": 4, "navegadores": 2,
                "equipo": 4, "js_mb": 2048, "proc_mb": 6144, "cpu_pct": 85, "vista_auto": True},
}
DEFAULT = {"perfil": "auto", "reserva_gb": 0, "limitar_wsl": True, "limitar_procesos": True, "preferir_nativo": True,
           "usar_gpu": "auto", "vista_previa_auto": False, "vista_max_gb": 2.5, "vm_gb": 4, "vm_cpus": 2, "swap_gb": 2,
           "navegadores": 1, "proc_mb": 2048, "cpu_pct": 75}


def cfg():
    return dict(DEFAULT, **(CONFIG.get("recursos") or {}))


# ═════════════════════════════ MEDICIÓN ═════════════════════════════
def _mem_windows():
    import ctypes
    from ctypes import wintypes

    class MEMSTAT(ctypes.Structure):
        _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD), ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    st = MEMSTAT()
    st.dwLength = ctypes.sizeof(MEMSTAT)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)):
        raise OSError("GlobalMemoryStatusEx falló")
    return {"total": st.ullTotalPhys, "libre": st.ullAvailPhys, "carga_pct": st.dwMemoryLoad,
            "compromiso_libre": st.ullAvailPageFile, "compromiso_total": st.ullTotalPageFile}


def _mem_linux():
    info = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        k, _, v = line.partition(":")
        info[k] = int(v.split()[0]) * 1024
    total, libre = info.get("MemTotal", 0), info.get("MemAvailable", info.get("MemFree", 0))
    return {"total": total, "libre": libre, "carga_pct": round(100 - 100 * libre / max(1, total)),
            "compromiso_libre": libre + info.get("SwapFree", 0), "compromiso_total": total + info.get("SwapTotal", 0)}


def _mem_mac():
    total = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5).stdout.strip() or 0)
    vm = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=5).stdout
    ps = int(re.search(r"page size of (\d+)", vm).group(1)) if re.search(r"page size of (\d+)", vm) else 4096
    pages = {k: int(v) for k, v in re.findall(r"Pages (free|inactive|speculative|purgeable):\s+(\d+)", vm)}
    libre = sum(pages.values()) * ps
    return {"total": total, "libre": libre, "carga_pct": round(100 - 100 * libre / max(1, total)),
            "compromiso_libre": libre, "compromiso_total": total}


def _cpu_windows():
    """% de uso del procesador desde la última medición (GetSystemTimes)."""
    import ctypes
    from ctypes import wintypes
    idle, kern, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
    ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
    v = lambda f: (f.dwHighDateTime << 32) | f.dwLowDateTime
    cur = (v(idle), v(kern), v(user))
    prev, _cache["cpu_prev"] = _cache["cpu_prev"], cur
    if not prev:
        return None
    di, dk, du = cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]
    tot = dk + du
    return round(100.0 * (tot - di) / tot, 1) if tot > 0 else None


def _cpu_linux():
    try:
        vals = [int(x) for x in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
        idle, tot = vals[3] + (vals[4] if len(vals) > 4 else 0), sum(vals)
        prev, _cache["cpu_prev"] = _cache["cpu_prev"], (idle, tot)
        if not prev:
            return None
        return round(100.0 * (1 - (idle - prev[0]) / max(1, tot - prev[1])), 1)
    except Exception:
        return None


def gpu_info(max_age=15):
    """Tarjetas gráficas: nombre, VRAM total/libre (NVIDIA con nvidia-smi; otras con Windows)."""
    if _cache["gpu"] is not None and time.time() - _cache["gpu_t"] < max_age:
        return _cache["gpu"]
    gpus = []
    smi = shutil.which("nvidia-smi")
    if not smi and IS_WINDOWS:
        cand = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
        smi = str(cand) if cand.exists() else None
    if smi:
        try:
            r = subprocess.run([smi, "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu",
                                "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=8, creationflags=NO_WINDOW)
            for line in r.stdout.strip().splitlines():
                p = [x.strip() for x in line.split(",")]
                if len(p) >= 5:
                    gpus.append({"nombre": p[0], "vram_total_gb": round(float(p[1]) / 1024, 1), "vram_usada_gb": round(float(p[2]) / 1024, 1),
                                 "vram_libre_gb": round(float(p[3]) / 1024, 1), "uso_pct": float(p[4]) if p[4].replace(".", "").isdigit() else None,
                                 "nvidia": True})
        except Exception:
            pass
    if not gpus and IS_WINDOWS:
        if _cache.get("gpu_win") is None:
            try:
                r = subprocess.run(["powershell", "-NoProfile", "-Command",
                                    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"],
                                   capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
                j = json.loads(r.stdout or "[]")
                j = j if isinstance(j, list) else [j]
                _cache["gpu_win"] = [{"nombre": x.get("Name", ""), "vram_total_gb": round((x.get("AdapterRAM") or 0) / GB, 1),
                                      "vram_libre_gb": None, "nvidia": "nvidia" in (x.get("Name") or "").lower()}
                                     for x in j if x.get("Name") and "basic" not in (x.get("Name") or "").lower()]
            except Exception:
                _cache["gpu_win"] = []
        gpus = list(_cache["gpu_win"])
    _cache["gpu"], _cache["gpu_t"] = gpus, time.time()
    return gpus


def hay_gpu():
    modo = str(cfg().get("usar_gpu", "auto")).lower()
    if modo in ("no", "false", "0"):
        return False
    if modo in ("si", "sí", "true", "1"):
        return True
    return bool(gpu_info())


def _procesos_windows():
    """[(pid, ppid, exe, memoria_privada_bytes)] de TODOS los procesos, sin PowerShell (instantáneo, vía Toolhelp32)."""
    import ctypes
    from ctypes import wintypes
    k32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi

    class PE32(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                    ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                    ("szExeFile", ctypes.c_wchar * 260)]

    class PMC(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + \
                   [(n, ctypes.c_size_t) for n in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                                   "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                                                   "PagefileUsage", "PeakPagefileUsage", "PrivateUsage")]
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k32.OpenProcess.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)
    out = []
    try:
        e = PE32()
        e.dwSize = ctypes.sizeof(PE32)
        ok = k32.Process32FirstW(wintypes.HANDLE(snap), ctypes.byref(e))
        while ok:
            out.append([e.th32ProcessID, e.th32ParentProcessID, e.szExeFile.lower(), 0])
            ok = k32.Process32NextW(wintypes.HANDLE(snap), ctypes.byref(e))
    finally:
        k32.CloseHandle(wintypes.HANDLE(snap))
    return out, k32, psapi, PMC


def _mem_proceso(k32, psapi, PMC, pid):
    import ctypes
    from ctypes import wintypes
    h = k32.OpenProcess(0x1000 | 0x0010, False, pid)  # QUERY_LIMITED_INFORMATION | VM_READ
    if not h:
        h = k32.OpenProcess(0x1000, False, pid)
    if not h:
        return 0
    try:
        c = PMC()
        c.cb = ctypes.sizeof(PMC)
        if psapi.GetProcessMemoryInfo(wintypes.HANDLE(h), ctypes.byref(c), c.cb):
            return max(c.PrivateUsage, c.WorkingSetSize)
        return 0
    finally:
        k32.CloseHandle(wintypes.HANDLE(h))


def procesos_noviq(max_age=8):
    """Memoria de lo que cuelga de Noviq: la ventana (WebView2: gráficos + página), los navegadores de prueba, los
    programas que se están probando, y la máquina virtual Linux (vmmem). Windows; en otros sistemas, vacío."""
    if _cache["procs"] is not None and time.time() - _cache["procs_t"] < max_age:
        return _cache["procs"]
    out = {"ventana_gb": None, "ventana_mayor_gb": None, "pruebas_gb": None, "pruebas_n": 0, "programas_gb": None, "wsl_gb": None}
    if IS_WINDOWS:
        try:
            procs, k32, psapi, PMC = _procesos_windows()
            hijos = {}
            for pid, ppid, exe, _ in procs:
                hijos.setdefault(ppid, []).append((pid, exe))
            yo = os.getpid()
            desc, pila = [], [yo]
            vistos = set()
            while pila:  # todos los descendientes de Noviq
                x = pila.pop()
                for pid, exe in hijos.get(x, []):
                    if pid not in vistos and pid != yo:
                        vistos.add(pid)
                        desc.append((pid, exe))
                        pila.append(pid)
            ven, prb, prog, mayor, n_prb = 0, 0, 0, 0, 0
            for pid, exe in desc:
                mem = _mem_proceso(k32, psapi, PMC, pid)
                if exe == "msedgewebview2.exe":
                    ven += mem
                    mayor = max(mayor, mem)
                elif exe in ("msedge.exe", "chrome.exe", "chromium.exe", "brave.exe"):
                    prb += mem
                    n_prb += 1
                elif exe not in ("conhost.exe",):
                    prog += mem
            wsl = sum(_mem_proceso(k32, psapi, PMC, pid) for pid, _pp, exe, _m in procs if exe.startswith("vmmem"))
            out.update(ventana_gb=round(ven / GB, 2), ventana_mayor_gb=round(mayor / GB, 2), pruebas_gb=round(prb / GB, 2),
                       pruebas_n=n_prb, programas_gb=round(prog / GB, 2), wsl_gb=round(wsl / GB, 2))
        except Exception:
            pass
    _cache["procs"], _cache["procs_t"] = out, time.time()
    return out


def medir(max_age=3, con_procesos=False):
    """Foto de la PC ahora mismo."""
    with _lock:
        if _cache["m"] is not None and time.time() - _cache["t"] < max_age and not con_procesos:
            return dict(_cache["m"])
        m = {"so": "Windows" if IS_WINDOWS else platform.system(), "nucleos": os.cpu_count() or 2}
        try:
            mem = _mem_windows() if IS_WINDOWS else _mem_mac() if platform.system() == "Darwin" else _mem_linux()
        except Exception:
            mem = {"total": 8 * GB, "libre": 2 * GB, "carga_pct": None, "compromiso_libre": None, "compromiso_total": None}
            m["aviso"] = "no pude medir la memoria: uso valores prudentes"
        m.update(ram_total_gb=round(mem["total"] / GB, 1), ram_libre_gb=round(mem["libre"] / GB, 1), ram_uso_pct=mem.get("carga_pct"),
                 compromiso_libre_gb=round((mem.get("compromiso_libre") or 0) / GB, 1) if mem.get("compromiso_libre") else None)
        try:
            m["cpu_pct"] = _cpu_windows() if IS_WINDOWS else _cpu_linux()
        except Exception:
            m["cpu_pct"] = None
        try:
            du = shutil.disk_usage(str(DATA_DIR))
            m["disco_libre_gb"] = round(du.free / GB, 1)
        except OSError:
            m["disco_libre_gb"] = None
        m["gpus"] = gpu_info()
        m["wsl"] = bool(shutil.which("wsl")) if IS_WINDOWS else False
        m["docker"] = bool(shutil.which("docker"))
        if con_procesos:
            m["noviq"] = procesos_noviq()
        _cache["m"], _cache["t"] = dict(m), time.time()
        return m


# ═════════════════════════════ PRESUPUESTO ═════════════════════════════
def reserva_gb(m=None):
    """Lo que SIEMPRE se deja libre para Windows y tus programas (auto = 20 % de la RAM, mínimo 2,5 GB)."""
    c = cfg()
    if float(c.get("reserva_gb") or 0) > 0:
        return float(c["reserva_gb"])
    m = m or medir()
    return round(max(2.5, m["ram_total_gb"] * 0.20), 1)


def _redondear(x, paso=0.5):
    return max(paso, round(int(x / paso) * paso, 1))


def perfil(m=None):
    """Límites que se aplican ahora (según el perfil elegido o, en «auto», según la RAM LIBRE de este momento)."""
    c = cfg()
    m = m or medir()
    nombre = c.get("perfil", "auto")
    res = reserva_gb(m)
    presupuesto = max(0.0, m["ram_libre_gb"] - res)
    nuc = m["nucleos"]
    motivo = []
    if nombre in PERFILES:
        p = dict(PERFILES[nombre])
        p["vm_cpus"] = min(p["vm_cpus"], max(1, nuc - 1))
        motivo.append(f"perfil fijo «{p['nombre']}»")
        if p["vm_gb"] > presupuesto + 0.5:
            motivo.append(f"⚠ ahora solo hay {presupuesto:.1f} GB disponibles después de la reserva: la máquina virtual podría "
                          "hacer que Windows use el disco (lento). Usa «auto» o «básico».")
    elif nombre == "personalizado":
        p = {"nombre": "Personalizado", "vm_gb": float(c["vm_gb"]), "vm_cpus": int(c["vm_cpus"]), "swap_gb": float(c["swap_gb"]),
             "navegadores": int(c["navegadores"]), "equipo": int(CONFIG.get("equipo_max", 2)), "js_mb": 1536,
             "proc_mb": int(c["proc_mb"]), "cpu_pct": int(c["cpu_pct"]), "vista_auto": bool(c.get("vista_previa_auto"))}
        motivo.append("valores personalizados")
    else:  # auto: se decide con la memoria LIBRE
        vm = min(16.0, max(2.0, _redondear(presupuesto * 0.6)))  # Linux necesita al menos ~2 GB para trabajar
        p = {"nombre": "Automático", "vm_gb": vm, "vm_cpus": max(1, min(8, nuc // 2)), "swap_gb": 1 if vm <= 2 else 2,
             "navegadores": 2 if presupuesto >= 8 and nuc >= 8 else 1,
             "equipo": max(1, min(4, int(presupuesto // 3), max(1, nuc // 4))),
             "js_mb": 768 if presupuesto < 3 else 1536 if presupuesto < 8 else 2048,
             "proc_mb": int(max(768, min(8192, presupuesto * 0.5 * 1024))), "cpu_pct": 60 if presupuesto < 2 else 75 if presupuesto < 6 else 85,
             "vista_auto": bool(c.get("vista_previa_auto")) and presupuesto >= 4}
        motivo.append(f"RAM libre {m['ram_libre_gb']:.1f} GB − reserva {res:.1f} GB = {presupuesto:.1f} GB para Noviq")
    p.update(reserva_gb=res, presupuesto_gb=round(presupuesto, 1), perfil=nombre, motivo=motivo,
             gpu=hay_gpu(), preferir_nativo=bool(c.get("preferir_nativo", True)),
             limitar_procesos=bool(c.get("limitar_procesos", True)), limitar_wsl=bool(c.get("limitar_wsl", True)))
    return p


def nivel(m=None):
    """ok · justo (queda poco) · critico (la RAM libre está por debajo de la reserva)."""
    m = m or medir()
    res = reserva_gb(m)
    if m["ram_libre_gb"] < res * 0.6:
        return "critico"
    if m["ram_libre_gb"] < res:
        return "justo"
    return "ok"


# ═════════════════════════════ LÍMITES A PROCESOS (Windows: Job Objects) ═════════════════════════════
_jobs = {}
_ESTR = []


def _estructuras():
    """Estructuras de Windows para los Job Objects (se crean una vez)."""
    if _ESTR:
        return _ESTR
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("Basic", BASIC), ("Io", IO_COUNTERS), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    class CPURATE(ctypes.Structure):
        _fields_ = [("ControlFlags", wintypes.DWORD), ("CpuRate", wintypes.DWORD)]
    _ESTR.extend([BASIC, EXTENDED, CPURATE])
    return _ESTR


def limitar_proceso(pid, mem_mb=None, cpu_pct=None, nombre=""):
    """Mete un proceso (y todo lo que abra) en un «Job Object» de Windows con memoria y CPU máximas. Así un programa
    en prueba corre NATIVO (rápido, sin máquina virtual) pero no puede tragarse la PC. Devuelve True si se aplicó."""
    if not IS_WINDOWS or not pid:
        return False
    c = perfil()
    if not c.get("limitar_procesos"):
        return False
    mem_mb = int(mem_mb or c["proc_mb"])
    cpu_pct = int(cpu_pct or c["cpu_pct"])
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32
        _BASIC, EXTENDED, CPURATE = _estructuras()
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.OpenProcess.restype = wintypes.HANDLE
        job = k32.CreateJobObjectW(None, None)
        if not job:
            return False
        ext = EXTENDED()
        ext.Basic.LimitFlags = 0x00000200  # JOB_OBJECT_LIMIT_JOB_MEMORY
        ext.JobMemoryLimit = mem_mb * 1024 * 1024
        ok1 = k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(ext), ctypes.sizeof(ext))  # Extended
        if 5 <= cpu_pct < 100:
            cr = CPURATE(0x1 | 0x4, cpu_pct * 100)  # ENABLE | HARD_CAP
            k32.SetInformationJobObject(wintypes.HANDLE(job), 15, ctypes.byref(cr), ctypes.sizeof(cr))
        h = k32.OpenProcess(0x0100 | 0x0001 | 0x0400, False, int(pid))  # SET_QUOTA | TERMINATE | QUERY_INFORMATION
        if not h:
            k32.CloseHandle(wintypes.HANDLE(job))
            return False
        ok2 = k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(h))
        k32.CloseHandle(wintypes.HANDLE(h))
        if not ok2:
            k32.CloseHandle(wintypes.HANDLE(job))
            return False
        with _lock:
            _jobs[int(pid)] = (job, time.time(), nombre)  # el handle se guarda: el límite dura lo que dure el proceso
            for opid in [p_ for p_, (_, t0, _n) in _jobs.items() if time.time() - t0 > 6 * 3600]:
                try:
                    k32.CloseHandle(wintypes.HANDLE(_jobs.pop(opid)[0]))
                except Exception:
                    pass
        return bool(ok1)
    except Exception:
        return False


def popen_limitado(cmd, nombre="", mem_mb=None, cpu_pct=None, **kw):
    """subprocess.Popen con límites de memoria/CPU. En Windows arranca el proceso SUSPENDIDO, lo mete en el Job Object
    y lo reanuda (así ni sus procesos hijos se escapan del límite). En otros sistemas es un Popen normal."""
    lim = IS_WINDOWS and perfil().get("limitar_procesos")
    if not lim:
        return subprocess.Popen(cmd, **kw)
    flags = kw.pop("creationflags", 0) | 0x00000004  # CREATE_SUSPENDED
    p = subprocess.Popen(cmd, creationflags=flags, **kw)
    try:
        limitar_proceso(p.pid, mem_mb, cpu_pct, nombre)
    finally:
        _reanudar(p)
    return p


def _reanudar(p):
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32
        k32.OpenProcess.restype = wintypes.HANDLE
        h = k32.OpenProcess(0x0800, False, p.pid)  # PROCESS_SUSPEND_RESUME
        if h:
            ctypes.windll.ntdll.NtResumeProcess(wintypes.HANDLE(h))
            k32.CloseHandle(wintypes.HANDLE(h))
    except Exception:
        pass


def _supero_limite(pid):
    """Pico de memoria (MB) que usó el proceso dentro de su Job Object, o None."""
    j = _jobs.get(int(pid or 0))
    if not j or not IS_WINDOWS:
        return None
    try:
        import ctypes
        from ctypes import wintypes
        _B, EXT, _C = _estructuras()
        a = EXT()
        if ctypes.windll.kernel32.QueryInformationJobObject(wintypes.HANDLE(j[0]), 9, ctypes.byref(a), ctypes.sizeof(a), None):
            return round(a.PeakJobMemoryUsed / (1024 * 1024))
    except Exception:
        pass
    return None


def nota_limite(pid, rc):
    """Texto para la IA si un programa terminó mal y estuvo cerca del límite de memoria."""
    try:
        pico = _supero_limite(pid)
        lim = perfil().get("proc_mb")
        if pico and lim and pico >= lim * 0.9 and rc not in (0, None):
            return (f"\n⚠ El programa intentó usar {pico} MB y chocó con el límite de memoria que Noviq le da para no colapsar la PC ({lim} MB). "
                    "Si de verdad necesita más, reduce su consumo (carga menos datos, libera objetos) o sube el límite en "
                    "⚙ Ajustes → Rendimiento.")
    except Exception:
        pass
    return ""


# ═════════════════════════════ TRABAJOS PESADOS (cola) ═════════════════════════════
def _semaforo(tipo, n):
    with _lock:
        s = _sem.get(tipo)
        if s is None or s[1] != n:
            s = (threading.BoundedSemaphore(n), n)
            _sem[tipo] = s
        return s[0]


@contextmanager
def trabajo_pesado(tipo="navegador", aviso=None, espera_max=120):
    """Cola para lo pesado (navegador de pruebas, máquina virtual, contenedor): pocos a la vez y solo si hay memoria.
    aviso(texto) se llama si hay que esperar. Si la memoria no se libera en espera_max s, se sigue igual pero con el
    perfil más prudente (no se bloquea el trabajo para siempre)."""
    n = perfil().get("navegadores", 1) if tipo == "navegador" else 1
    sem = _semaforo(tipo, max(1, int(n)))
    t0 = time.time()
    avisado = False
    while nivel(medir(max_age=2)) == "critico" and time.time() - t0 < espera_max:
        if aviso and not avisado:
            m = medir()
            aviso(f"⏳ Memoria libre baja ({m['ram_libre_gb']:.1f} GB; reserva para la PC {reserva_gb(m):.1f} GB): espero a que se "
                  f"libere antes de abrir {'el navegador de pruebas' if tipo == 'navegador' else 'la máquina virtual/contenedor'}…")
            avisado = True
        time.sleep(3)
    if not sem.acquire(timeout=espera_max * 2):
        raise RuntimeError("hay otra prueba pesada en marcha desde hace mucho; inténtalo en un momento")
    try:
        yield perfil()
    finally:
        sem.release()


# ═════════════════════════════ NAVEGADOR DE PRUEBAS ═════════════════════════════
def args_navegador():
    """Opciones para el navegador invisible de pruebas: memoria de JS limitada, pocos procesos y GPU si hay."""
    p = perfil()
    a = [f"--js-flags=--max-old-space-size={int(p['js_mb'])}", "--renderer-process-limit=2", "--enable-precise-memory-info",
         "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication", "--max-active-webgl-contexts=4"]
    if p.get("gpu"):
        a += ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] + (["--use-angle=d3d11"] if IS_WINDOWS else [])
    else:
        a += ["--disable-gpu-compositing"]  # sin GPU: WebGL por software (SwiftShader) solo cuando se necesita
    return a


def args_ventana():
    """Opciones de Chromium para la VENTANA de Noviq (WebView2): tope de memoria de JavaScript y de contextos WebGL
    (la vista previa de un juego con fuga de memoria llegó a usar 21 GB)."""
    p = perfil()
    js = 2048 if p.get("presupuesto_gb", 4) >= 4 else 1024
    return (f"--js-flags=--max-old-space-size={js} --max-active-webgl-contexts=4 --enable-precise-memory-info "
            "--disable-features=msSmartScreenProtection")


def matar_navegadores_huerfanos():
    """Cierra navegadores de prueba de Noviq que quedaron abiertos (por un cierre brusco)."""
    try:
        if IS_WINDOWS:
            subprocess.run(["powershell", "-NoProfile", "-Command",
                            "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | "
                            "Where-Object { $_.CommandLine -like '*noviq_nav_*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                            "-ErrorAction SilentlyContinue }"], capture_output=True, timeout=30, creationflags=NO_WINDOW)
        else:
            subprocess.run(["pkill", "-f", "noviq_nav_"], capture_output=True, timeout=10)
    except Exception:
        pass


# ═════════════════════════════ MÁQUINA VIRTUAL (WSL) Y DOCKER ═════════════════════════════
WSLCONFIG = Path.home() / ".wslconfig"
_MARCA = "# Noviq"


def wslconfig_texto(p=None):
    p = p or perfil()
    return {"wsl2": {"memory": f"{p['vm_gb']:g}GB", "processors": str(int(p["vm_cpus"])), "swap": f"{p['swap_gb']:g}GB",
                     "vmIdleTimeout": "60000"},
            "experimental": {"autoMemoryReclaim": "gradual", "sparseVhd": "true"}}


def _editar_ini(texto, quiero):
    """Cambia/agrega claves en un .ini conservando todo lo demás (comentarios, otras secciones y claves)."""
    lines = texto.splitlines()
    for sec, kv in quiero.items():
        ini = next((i for i, l in enumerate(lines) if re.match(rf"\s*\[{re.escape(sec)}\]\s*$", l, re.I)), None)
        if ini is None:
            if lines and lines[-1].strip():
                lines.append("")
            lines += [f"[{sec}]", f"{_MARCA}: límites para no colapsar la PC (⚙ Ajustes → Rendimiento)"]
            lines += [f"{k}={v}" for k, v in kv.items()]
            continue
        fin = next((i for i in range(ini + 1, len(lines)) if re.match(r"\s*\[[^\]]+\]\s*$", lines[i])), len(lines))
        faltan = []
        for k, v in kv.items():
            pos = next((i for i in range(ini + 1, fin) if re.match(rf"\s*{re.escape(k)}\s*=", lines[i], re.I)), None)
            if pos is None:
                faltan.append(f"{k}={v}")
            else:
                lines[pos] = f"{k}={v}"
        if faltan:
            ult = fin
            while ult > ini + 1 and not lines[ult - 1].strip():
                ult -= 1
            lines[ult:ult] = faltan
    return "\n".join(lines).strip() + "\n"


def aplicar_wslconfig(p=None, forzar=False):
    """Escribe los límites de la máquina virtual Linux en %USERPROFILE%\\.wslconfig SIN borrar lo que ya tengas
    (solo cambia estas claves; la primera vez guarda una copia .wslconfig.noviq.bak). Devuelve (cambió, texto)."""
    if not IS_WINDOWS:
        return False, "solo aplica en Windows"
    p = p or perfil()
    if not p.get("limitar_wsl") and not forzar:
        return False, "desactivado en Ajustes"
    old = WSLCONFIG.read_text(encoding="utf-8", errors="replace") if WSLCONFIG.exists() else ""
    nuevo = _editar_ini(old, wslconfig_texto(p))
    if nuevo.strip() == old.strip():
        return False, nuevo
    bak = WSLCONFIG.with_name(".wslconfig.noviq.bak")
    if old and not bak.exists():
        bak.write_text(old, encoding="utf-8")
    WSLCONFIG.write_text(nuevo, encoding="utf-8")
    return True, nuevo


def reiniciar_wsl():
    """Apaga la máquina virtual Linux para que tome los límites nuevos (se vuelve a encender sola al usarla)."""
    try:
        r = subprocess.run(["wsl", "--shutdown"], capture_output=True, text=True, timeout=60, creationflags=NO_WINDOW)
        return r.returncode == 0
    except Exception:
        return False


_wsl_aplicado = [False]


def preparar_wsl(aviso=None):
    """Antes de encender Linux (WSL): aplica los límites una vez por sesión."""
    if _wsl_aplicado[0] or not IS_WINDOWS:
        return
    _wsl_aplicado[0] = True
    try:
        cambio, _ = aplicar_wslconfig()
        if cambio and aviso:
            p = perfil()
            aviso(f"🐧 Límites de la máquina virtual Linux guardados en .wslconfig: {p['vm_gb']:g} GB de RAM, {p['vm_cpus']} "
                  "núcleos. Se aplican la próxima vez que Linux arranque (o con «Aplicar ahora» en ⚙ Ajustes → Rendimiento).")
    except Exception:
        pass


def docker_args(p=None, gpu=None):
    p = p or perfil()
    mem = max(0.5, float(p["vm_gb"]))
    a = ["--memory", f"{mem:g}g", "--memory-swap", f"{mem + float(p.get('swap_gb', 1)):g}g", "--cpus", str(max(1, int(p["vm_cpus"]))),
         "--pids-limit", "2048"]
    if gpu if gpu is not None else (p.get("gpu") and docker_gpu()):
        a += ["--gpus", "all"]
    return a


_docker_gpu = [None]


def docker_gpu():
    """¿Docker puede usar la GPU NVIDIA? (Docker Desktop con WSL2 + driver NVIDIA)."""
    if _docker_gpu[0] is None:
        try:
            r = subprocess.run(["docker", "info", "--format", "{{json .Runtimes}}"], capture_output=True, text=True, timeout=20,
                               creationflags=NO_WINDOW)
            _docker_gpu[0] = "nvidia" in (r.stdout or "").lower() or (IS_WINDOWS and any(g.get("nvidia") for g in gpu_info()))
        except Exception:
            _docker_gpu[0] = False
    return _docker_gpu[0]


# ═════════════════════════════ IA LOCAL ═════════════════════════════
def presupuesto_ia():
    """(VRAM usable, RAM usable) en GB para un modelo local, según lo LIBRE ahora (no lo instalado)."""
    m = medir()
    p = perfil(m)
    g = next((x for x in m.get("gpus") or [] if x.get("vram_total_gb")), None)
    vram = None
    if g:
        vram = g.get("vram_libre_gb") if g.get("vram_libre_gb") is not None else g.get("vram_total_gb")
    return vram, max(0.5, p["presupuesto_gb"])


# ═════════════════════════════ VIGILANTE ═════════════════════════════
def _vigilar():
    while True:
        try:
            m = medir(max_age=0, con_procesos=IS_WINDOWS)
            niv = nivel(m)
            c = cfg()
            _estado.update(nivel=niv, ahorro=niv != "ok", ultimo=m)
            nv = m.get("noviq") or {}
            vista_max = float(c.get("vista_max_gb") or 2.5)
            pesada = (nv.get("ventana_mayor_gb") or 0) > vista_max or (nv.get("ventana_gb") or 0) > vista_max * 1.6
            if pesada or niv == "critico":
                motivo = (f"la ventana de Noviq llegó a {nv.get('ventana_gb', 0):.1f} GB de memoria (el proceso más grande "
                          f"{nv.get('ventana_mayor_gb', 0):.1f} GB)" if pesada else
                          f"la RAM libre bajó a {m['ram_libre_gb']:.1f} GB (reserva para la PC {reserva_gb(m):.1f} GB)")
                _estado.update(detener_vista=motivo, detener_t=time.time())
        except Exception:
            pass
        time.sleep(10)


def iniciar():
    threading.Thread(target=matar_navegadores_huerfanos, daemon=True).start()
    threading.Thread(target=_vigilar, daemon=True, name="noviq-recursos").start()


def estado_publico():
    m = _estado.get("ultimo") or medir(con_procesos=False)
    p = perfil(m)
    return {"medicion": m, "perfil": p, "nivel": nivel(m), "reserva_gb": reserva_gb(m), "config": cfg(),
            "detener_vista": _estado.get("detener_vista") if time.time() - _estado.get("detener_t", 0) < 30 else "",
            "perfiles": {k: v["nombre"] for k, v in PERFILES.items()}, "wslconfig": str(WSLCONFIG),
            "wsl_limites": wslconfig_texto(p)["wsl2"], "docker_args": " ".join(docker_args(p, gpu=False))}


def resumen_texto(m=None):
    m = m or medir(con_procesos=True)
    p = perfil(m)
    g = ", ".join(f"{x['nombre']} ({x.get('vram_libre_gb') if x.get('vram_libre_gb') is not None else '?'} de {x.get('vram_total_gb')} GB libres)"
                  for x in m.get("gpus") or []) or "no detectada"
    return (f"PC: {m['nucleos']} núcleos, RAM {m['ram_total_gb']} GB (libre {m['ram_libre_gb']} GB), GPU: {g}, disco libre "
            f"{m.get('disco_libre_gb')} GB. Reserva para la PC {p['reserva_gb']} GB → presupuesto de Noviq {p['presupuesto_gb']} GB. "
            f"Perfil {p['nombre']}: máquina virtual {p['vm_gb']:g} GB/{p['vm_cpus']} núcleos, programas en prueba hasta "
            f"{p['proc_mb']} MB y {p['cpu_pct']}% de CPU, {p['navegadores']} navegador(es) de prueba a la vez.")


def autoprueba():
    """Comprueba en ESTA PC que los límites funcionan: mide, y lanza un Python que intenta reservar 1 GB dentro de un
    Job Object de 300 MB (debe fallar por memoria, sin afectar a la PC)."""
    import sys
    res = {"medicion": medir(max_age=0, con_procesos=True), "perfil": perfil()}
    from .config import python_exe
    py = python_exe() or sys.executable
    t0 = time.time()
    try:
        if not IS_WINDOWS:
            raise NotImplementedError("el límite por programa (Job Object) es de Windows")
        p = popen_limitado([py, "-c", "b = bytearray(1024 * 1024 * 1024); print('RESERVÓ 1 GB')"], nombre="autoprueba",
                           mem_mb=300, cpu_pct=50, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=NO_WINDOW)
        out, _ = p.communicate(timeout=60)
        txt = (out or b"").decode("utf-8", "replace")
        res["job"] = {"limite_aplicado": p.pid in _jobs, "salida": txt[-300:], "codigo": p.returncode,
                      "funciona": "MemoryError" in txt and "RESERVÓ" not in txt, "seg": round(time.time() - t0, 2),
                      "pico_mb": _supero_limite(p.pid)}
    except NotImplementedError as e:
        res["job"] = str(e)
    except Exception as e:
        res["job"] = {"error": f"{type(e).__name__}: {e}"}
    # navegador de pruebas dentro de su límite, con GPU, y el detector de fugas con una página que crea búferes sin parar
    try:
        import tempfile
        from . import navegador as NAV
        if NAV.find_browser():
            f = Path(tempfile.gettempdir()) / "noviq_autoprueba_fuga.html"
            f.write_text("<!doctype html><canvas id=c width=320 height=200></canvas><script>const gl=document.getElementById('c')"
                         ".getContext('webgl');window.gpuName=(()=>{const d=gl.getExtension('WEBGL_debug_renderer_info');return d?"
                         "gl.getParameter(d.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})();function loop(){requestAnimationFrame"
                         "(loop);for(let i=0;i<40;i++){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData("
                         "gl.ARRAY_BUFFER,new Float32Array(2000),gl.STATIC_DRAW);}gl.clearColor(0,.5,0,1);gl.clear(gl.COLOR_BUFFER_BIT);}"
                         "loop();</script>", encoding="utf-8")
            t1 = time.time()
            r = NAV.probar(str(f), captura=False, espera_ms=800, evaluar="window.gpuName")
            res["navegador"] = {"arranco": not r.get("fatal"), "gpu_webgl": r.get("eval"), "fuga_detectada": bool(r.get("fuga")),
                                "fuga": r.get("fuga"), "seg": round(time.time() - t1, 1), "error": (r.get("fatal") or "")[:200],
                                "limite_mb": None}
    except Exception as e:
        res["navegador"] = {"error": f"{type(e).__name__}: {e}"[:200]}
    return res
