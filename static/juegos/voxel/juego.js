/* 🎮 REGLAS PROPIAS DE TU JUEGO (motor vóxel del Estudio de Noviq, estilo Minecraft HD)
   Ganchos que llama el motor:
   alIniciar(J), alActualizar(J, dt), alRecoger(J, objeto), alDerrotar(J, criatura), alDanio(J, cantidad),
   alRomper(J, {x, y, z, b}) → false para impedirlo, alPoner(J, {x, y, z, b}) → false para impedirlo, alGanar(J), alPerder(J)

   J (API): J.jugador {pos, vel, vida, puntos, colocados, rotos, sel}, J.enemigos[], J.objetos[], J.partida {t, hora (0-1 del día)},
   J.B (tipos de bloque: J.B.PIEDRA, J.B.TABLAS, J.B.LADRILLO, J.B.ORO…), J.bloque(x, y, z), J.ponerBloque(x, y, z, J.B.ORO),
   J.alturaEn(x, z), J.aviso("texto"), J.sonido("moneda"), J.sumarPuntos(n), J.danio(n), J.curar(n), J.ganar("…"), J.perder("…").

   Ejemplo: construir una torre al empezar →  for (let y = 0; y < 6; y++) J.ponerBloque(5, J.alturaEn(5, 5) + y, 5, J.B.LADRILLO);
   ⚠ RENDIMIENTO: no crees geometrías ni materiales en alActualizar. */
window.REGLAS = {
  alIniciar(J) { J.aviso("🎯 " + J.C.objetivo.texto, 2500); },
  alActualizar(J, dt) {},
  alRecoger(J, objeto) {},
  alDerrotar(J, criatura) {},
  alDanio(J, cantidad) {},
  alRomper(J, b) {},
  alPoner(J, b) {},
  alGanar(J) {},
  alPerder(J) {}
};
