/* 🎮 REGLAS PROPIAS DE TU JUEGO (motor 2D pixel art del Estudio de Noviq)
   Ganchos: alIniciar(J), alActualizar(J, dt), alRecoger(J, objeto), alDerrotar(J, enemigo), alDanio(J, cantidad), alGanar(J), alPerder(J)
   J (API): J.jugador {x, y, vx, vy, vida, puntos, dir}, J.enemigos[], J.objetos[], J.partida {t, recogidos, derrotados},
   J.mapa.at(tx, ty) / J.mapa.set(tx, ty, v) (0 aire, 1 sólido, 2 plataforma, 3 pinchos, 4 agua, 5 árbol), J.T (tamaño del tile = 16),
   J.aviso("texto"), J.sonido("moneda"), J.sumarPuntos(n), J.danio(n), J.curar(n), J.ganar("…"), J.perder("…"), J.chispa(x, y, "#color").
   ⚠ Los cambios de mapa se ven al reiniciar la capa: úsalos en alIniciar. No crees objetos nuevos en alActualizar. */
window.REGLAS = {
  alIniciar(J) { J.aviso("🎯 " + J.C.objetivo.texto, 2500); },
  alActualizar(J, dt) {},
  alRecoger(J, objeto) {},
  alDerrotar(J, enemigo) {},
  alDanio(J, cantidad) {},
  alGanar(J) {},
  alPerder(J) {}
};
