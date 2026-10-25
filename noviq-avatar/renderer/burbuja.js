/* ==========================================================================
   Noviq Avatar — Burbujas de diálogo (habla, pensamiento, mensaje escrito)
   Modos: 'instantaneo', 'maquina' (máquina de escribir), 'sync' (sincronizado
   con la voz), 'puntos' (indicador "escribiendo..." / "pensando...").
   Textos largos se dividen en páginas automáticamente.
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const { clamp } = N.util;
  const MAX_PAGINA = 150;

  function paginar(texto) {
    const t = String(texto || '');
    const paginas = [];
    let ini = 0;
    while (ini < t.length) {
      while (ini < t.length && /\s/.test(t[ini])) ini++;
      if (ini >= t.length) break;
      let fin = Math.min(t.length, ini + MAX_PAGINA);
      if (fin < t.length) {
        const trozo = t.slice(ini, fin);
        let corte = -1;
        const m = trozo.match(/.*[.!?…](\s|$)/s);
        if (m && m[0].length > MAX_PAGINA * 0.45) corte = m[0].length;
        if (corte < 0) { const sp = trozo.lastIndexOf(' '); if (sp > MAX_PAGINA * 0.4) corte = sp + 1; }
        if (corte > 0) fin = ini + corte;
      }
      paginas.push({ ini, fin });
      ini = fin;
    }
    if (!paginas.length) paginas.push({ ini: 0, fin: 0 });
    return paginas;
  }

  class Burbuja {
    constructor(escena) {
      this.escena = escena;
      this.el = document.createElement('div');
      this.el.className = 'burbuja';
      this.el.setAttribute('data-hit', '1');
      this.cont = document.createElement('div');
      this.cont.className = 'contenido';
      this.el.appendChild(this.cont);
      escena.appendChild(this.el);
      this.p1 = document.createElement('div'); this.p1.className = 'nube-punto p1';
      this.p2 = document.createElement('div'); this.p2.className = 'nube-punto p2';
      escena.appendChild(this.p1); escena.appendChild(this.p2);
      this.s = null;
      this.token = 0;
      this.medida = { w: 0, h: 0 };
      this.textoRender = null;
    }

    mostrar(o) {
      o = o || {};
      if (this.s && this.s.resolver) this.s.resolver({ reemplazada: true });
      const token = ++this.token;
      const texto = String(o.texto == null ? '' : o.texto);
      const modo = texto ? (o.modo || 'instantaneo') : 'puntos';
      const s = (this.s = {
        token, texto, modo, tipo: o.tipo || 'habla', paginas: paginar(texto), pagina: 0,
        revelado: 0, cps: o.cps || 30, fijo: !!o.fijo, duracion: o.duracion != null ? o.duracion / 1000 : null,
        espera: 0, syncFin: modo !== 'sync', completado: false, alCompletar: o.alCompletar, t: 0, saliendo: false
      });
      this.el.className = 'burbuja ' + s.tipo + (modo === 'puntos' ? ' puntos' : '');
      this.textoRender = null;
      this.render(true);
      requestAnimationFrame(() => this.el.classList.add('visible'));
      const promesa = new Promise((res) => (s.resolver = res));
      return { token, promesa };
    }

    progreso(n) { if (this.s && this.s.modo === 'sync') this.s.revelado = Math.max(this.s.revelado, n); }
    finSync() { if (this.s) { this.s.syncFin = true; this.s.revelado = this.s.texto.length; } }

    ocultar(token) {
      if (!this.s || (token != null && token !== this.s.token)) return;
      const s = this.s;
      this.s = null;
      this.el.classList.remove('visible');
      this.p1.classList.remove('visible'); this.p2.classList.remove('visible');
      if (s.resolver) s.resolver({ ok: true });
    }

    render(forzar) {
      const s = this.s;
      if (!s) return;
      let html;
      if (s.modo === 'puntos') {
        html = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      } else {
        const pg = s.paginas[s.pagina];
        const hasta = clamp(Math.floor(s.revelado), pg.ini, pg.fin);
        const vis = s.texto.slice(pg.ini, hasta);
        const resto = s.texto.slice(hasta, pg.fin);
        const cursor = s.modo === 'maquina' && hasta < pg.fin ? '<span class="cursor"></span>' : '';
        const pag = s.paginas.length > 1 ? `<span class="pagina">${s.pagina + 1}/${s.paginas.length}</span>` : '';
        // El resto se reserva invisible para que la burbuja no cambie de tamaño mientras aparece el texto
        html = escapar(vis) + cursor + `<span class="oculto">${escapar(resto)}</span>` + pag;
      }
      if (forzar || html !== this.textoRender) {
        this.cont.innerHTML = html;
        this.textoRender = html;
        this.medida = { w: this.el.offsetWidth, h: this.el.offsetHeight };
      }
    }

    frame(dt, ax, ay) {
      const s = this.s;
      if (s) {
        s.t += dt;
        if (s.modo !== 'puntos') {
          const pg = s.paginas[s.pagina];
          if (s.modo === 'instantaneo') s.revelado = Math.max(s.revelado, pg.fin);
          else if (s.modo === 'maquina') s.revelado = Math.max(s.revelado, pg.ini) + s.cps * dt;
          const esUltima = s.pagina === s.paginas.length - 1;
          if (s.revelado >= pg.fin) {
            if (s.modo === 'sync' && !esUltima) {
              s.pagina++;
            } else if (s.modo === 'sync' && !s.syncFin) {
              // esperando que termine la voz
            } else {
              if (esUltima && !s.completado) { s.completado = true; if (s.alCompletar) s.alCompletar(); }
              s.espera += dt;
              const chars = pg.fin - pg.ini;
              const lectura = esUltima && s.duracion != null ? s.duracion : Math.max(1.4, 0.9 + chars * 0.05);
              if (s.espera >= lectura) {
                if (!esUltima) { s.pagina++; s.espera = 0; if (s.modo === 'instantaneo') s.revelado = s.paginas[s.pagina].fin; }
                else if (!s.fijo) { this.ocultar(); return; }
              }
            }
          }
        } else if (s.duracion != null && s.t >= s.duracion && !s.fijo) { this.ocultar(); return; }
        this.render();
      }
      if (!this.s && !this.el.classList.contains('visible')) return;
      // Posición: centrada sobre la cabeza, sin salirse de la escena
      const W = 440, { w, h } = this.medida;
      const left = clamp(ax - w / 2, 6, W - w - 6);
      const top = Math.max(4, ay - h - 16);
      this.el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      this.el.style.setProperty('--cola', clamp(ax - left, 22, w - 22).toFixed(1) + 'px');
      const nube = this.s && this.s.tipo === 'pensamiento';
      this.p1.classList.toggle('visible', !!nube);
      this.p2.classList.toggle('visible', !!nube);
      if (nube) {
        this.p1.style.transform = `translate(${(ax + 30).toFixed(1)}px, ${(top + h + 2).toFixed(1)}px)`;
        this.p2.style.transform = `translate(${(ax + 44).toFixed(1)}px, ${(top + h + 16).toFixed(1)}px)`;
      }
    }

    get visible() { return !!this.s; }
    get texto() { return this.s ? this.s.texto : ''; }
  }

  function escapar(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\n/g, '<br>');
  }

  N.Burbuja = Burbuja;
  N.paginar = paginar;
})();
