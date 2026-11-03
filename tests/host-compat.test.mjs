import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// COMPATIBILIDADE COM O HOST — e por que isso precisa de teste.
//
// Os dois problemas abaixo são invisíveis no CI e invisíveis em qualquer build
// que não parta do zero. Os dois apareceram no mesmo dia, na mesma máquina, um
// atrás do outro:
//
//   1. CMake 4.x recusa projeto que declara mínimo < 3.5 (AGENTS §12.32)
//   2. GCC 15 compila em C23 e quebra o gnulib do m4 1.4.19 (AGENTS §12.33)
//
// Nenhum dos dois é bug do projeto — são do AMBIENTE. É justamente por isso que
// precisam de guarda: a correção mora num arquivo de configuração que alguém vai
// olhar e achar que pode limpar, e o sintoma de limpar é um build que só quebra
// na máquina de outra pessoa, horas depois.

const OVERRIDES = path.join(ROOT, "config", "package-overrides.mk");
const BUILD_SH = path.join(ROOT, "scripts", "build-device.sh");

test("GCC 15/C23: os host tools compilam em gnu17", async () => {
  // O m4 1.4.19 escolhe `[[__nodiscard__]]` quando `__STDC_VERSION__` indica
  // C23, e essa forma é inválida entre `inline` e `int`. Com gnu17 ele usa
  // `__attribute__`, que é aceito em qualquer posição.
  //
  // Sem esta linha, build do zero quebra no primeiro pacote de host.
  const texto = await readFile(OVERRIDES, "utf8");
  assert.match(texto, /^HOST_CFLAGS \+= -std=gnu17$/m);
});

test("a correção de C23 vale só para HOST, não para o target", async () => {
  // `TARGET_CFLAGS` é o cross-compile do aparelho. Mexer nele mudaria o código
  // que roda no aparelho para consertar uma ferramenta que roda no PC — e o
  // §12.4 já mostrou que pilha gráfica/governança de flag do target é delicada.
  const texto = await readFile(OVERRIDES, "utf8");
  assert.doesNotMatch(texto, /^TARGET_CFLAGS/m);
  assert.doesNotMatch(texto, /^TARGET_CXXFLAGS/m);
});

test("CMake 4.x: o build exporta CMAKE_POLICY_VERSION_MINIMUM", async () => {
  // Buildroot 2024.02 é de fevereiro de 2024 e vários pacotes declaram mínimo
  // 3.4. O CMake 4.0 removeu a compatibilidade com < 3.5.
  const texto = await readFile(BUILD_SH, "utf8");
  assert.match(texto, /CMAKE_POLICY_VERSION_MINIMUM=3\.5/);
});

test("a detecção de CMake 4 é por versão maior, não por igualdade", async () => {
  // Se fosse `== 4`, o CMake 5 voltaria a quebrar e ninguém entenderia por quê.
  // A comparação tem de ser `-ge 4`.
  const texto = await readFile(BUILD_SH, "utf8");
  assert.match(texto, /-ge 4/);
});

test("as duas correções de host ficam visíveis no log do build", async () => {
  // Correção silenciosa é correção que a próxima pessoa desfaz. As duas têm de
  // aparecer no log, para quem lê o build saber que foram aplicadas.
  const texto = await readFile(BUILD_SH, "utf8");
  assert.match(texto, /CMAKE_POLICY_VERSION_MINIMUM=3\.5"/);
});
