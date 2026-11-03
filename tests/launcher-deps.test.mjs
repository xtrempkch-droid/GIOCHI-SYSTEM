import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT, DEVICE_ROOT } from "../scripts/lib/devices.mjs";

// Dependências de TEXTO do launcher, e as duas armadilhas que fazem o build
// ficar verde com a tela sem texto nenhum:
//
//   1. `BR2_PACKAGE_SDL2_TTF` parece opção do sdl2, mas é PACOTE à parte. E
//      depende de `BR2_PACKAGE_SDL2`: num aparelho sem SDL2 (o QEMU) o Kconfig
//      nem oferece o símbolo, o `olddefconfig` descarta em silêncio e o build
//      quebra no `assert-config` — por isso estas linhas NÃO podem morar no
//      `config/common.fragment`.
//
//   2. `BR2_PACKAGE_DEJAVU=y` sozinho instala ZERO fontes: o `dejavu.mk`
//      preenche a lista de arquivos só dentro de
//      `ifeq ($(BR2_PACKAGE_DEJAVU_<FAMILIA>),y)`. O diretório é criado vazio.
//
// A invariante testada: quem liga SDL2 liga o texto — porque SDL2 nesta árvore
// significa "vai rodar o launcher".

async function defconfigsComSdl2() {
  const resultado = [];
  for (const entry of await readdir(DEVICE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const file = path.join(DEVICE_ROOT, entry.name, "defconfig");
    let texto;
    try {
      texto = await readFile(file, "utf8");
    } catch {
      continue; // draft sem defconfig: não gera imagem, nada a exigir
    }
    if (/^BR2_PACKAGE_SDL2=y$/m.test(texto)) {
      resultado.push({ pasta: entry.name, texto });
    }
  }
  return resultado;
}

test("todo aparelho com SDL2 liga o stack de texto do launcher", async () => {
  const aparelhos = await defconfigsComSdl2();
  assert.ok(aparelhos.length >= 2, "esperado ao menos X55 e X35H com SDL2");
  for (const { pasta, texto } of aparelhos) {
    for (const simbolo of [
      "BR2_PACKAGE_SDL2_TTF",
      "BR2_PACKAGE_DEJAVU",
      "BR2_PACKAGE_DEJAVU_SANS",
    ]) {
      assert.match(
        texto,
        new RegExp(`^${simbolo}=y$`, "m"),
        `${pasta}: falta ${simbolo}=y — o launcher não abre fonte`,
      );
    }
  }
});

test("DEJAVU nunca aparece sem uma família selecionada", async () => {
  // Este é o erro silencioso: pacote instalado, zero arquivos .ttf.
  const aparelhos = await defconfigsComSdl2();
  for (const { pasta, texto } of aparelhos) {
    if (!/^BR2_PACKAGE_DEJAVU=y$/m.test(texto)) continue;
    const familias = [
      "BR2_PACKAGE_DEJAVU_SANS",
      "BR2_PACKAGE_DEJAVU_SERIF",
      "BR2_PACKAGE_DEJAVU_MONO",
      "BR2_PACKAGE_DEJAVU_SANS_CONDENSED",
      "BR2_PACKAGE_DEJAVU_SERIF_CONDENSED",
    ];
    const alguma = familias.some((f) => new RegExp(`^${f}=y$`, "m").test(texto));
    assert.ok(
      alguma,
      `${pasta}: BR2_PACKAGE_DEJAVU=y sem família — /usr/share/fonts/dejavu/ sai VAZIO`,
    );
  }
});

test("o stack de texto NÃO está no fragmento comum", async () => {
  // O QEMU não tem SDL2. No comum, SDL2_TTF seria descartado em silêncio pelo
  // olddefconfig e o `assert-config` reprovaria o build do smoke test — que é
  // justamente o aparelho que prova o pipeline.
  const comum = await readFile(path.join(ROOT, "config/common.fragment"), "utf8");
  for (const simbolo of ["BR2_PACKAGE_SDL2_TTF", "BR2_PACKAGE_DEJAVU"]) {
    assert.doesNotMatch(
      comum,
      new RegExp(`^${simbolo}=y$`, "m"),
      `${simbolo} no comum quebra o QEMU, que não tem SDL2`,
    );
  }
});

test("harfbuzz está ligado — SDL2_TTF não o puxa sozinho", async () => {
  // ARMADILHA: SDL2_TTF faz `select FREETYPE`, mas NÃO liga harfbuzz — o `.mk`
  // só passa --enable-harfbuzz quando BR2_PACKAGE_HARFBUZZ=y existe por conta
  // própria. A falta não dá erro: o texto latino sai legível e o de script
  // complexo sai com shaping errado (ligaduras trocadas, consoantes separadas).
  //
  // Exige C++ no toolchain (BR2_TOOLCHAIN_BUILDROOT_CXX), que a árvore já tem.
  const aparelhos = await defconfigsComSdl2();
  for (const { pasta, texto } of aparelhos) {
    assert.match(
      texto,
      /^BR2_PACKAGE_HARFBUZZ=y$/m,
      `${pasta}: falta HARFBUZZ — SDL2_TTF não o puxa e o shaping sai errado`,
    );
  }
});

test("harfbuzz não arrasta glib, cairo nem icu sem necessidade", async () => {
  // As dependências do harfbuzz.mk são condicionais. Ligar glib/cairo/icu
  // "por garantia" engorda a imagem sem o launcher usar nenhum dos três.
  const aparelhos = await defconfigsComSdl2();
  for (const { pasta, texto } of aparelhos) {
    for (const pesado of ["BR2_PACKAGE_LIBGLIB2", "BR2_PACKAGE_CAIRO", "BR2_PACKAGE_ICU"]) {
      assert.doesNotMatch(
        texto,
        new RegExp(`^${pesado}=y$`, "m"),
        `${pasta}: ${pesado} entrou sem necessidade — harfbuzz não exige`,
      );
    }
  }
});

test("o toolchain tem C++, sem o qual harfbuzz nem é oferecido", async () => {
  // `harfbuzz/Config.in` depende de BR2_INSTALL_LIBSTDCPP. Sem ele o símbolo
  // nem aparece, o olddefconfig descarta em silêncio e o assert-config reprova.
  const aparelhos = await defconfigsComSdl2();
  for (const { pasta, texto } of aparelhos) {
    assert.match(texto, /^BR2_TOOLCHAIN_BUILDROOT_CXX=y$/m, `${pasta}: sem C++`);
  }
});
