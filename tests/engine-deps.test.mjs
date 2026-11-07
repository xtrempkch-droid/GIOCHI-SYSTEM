import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT, DEVICE_ROOT } from "../scripts/lib/devices.mjs";

// CONSUMO DA GIOCHI-ENGINE — o que a imagem tem de entregar para ela rodar.
//
// A engine declara no `Cargo.toml`:
//
//   sdl2 = { version = "0.38", default-features = false,
//            features = ["image", "mixer", "ttf"] }
//
// e no `Cross.toml` instala `libsdl2-{,image-,mixer-,ttf-}dev` mais
// `libasound2-dev`. Ou seja: quatro módulos SDL e ALSA. A imagem tem de ter os
// quatro `.pc` no sysroot, senão o `sdl2-sys` falha no build com
//
//   Could not find `SDL2_mixer` in pkg-config search path
//
// e a mensagem cita pkg-config, não a imagem — quem lê procura no lugar errado.
//
// Medido antes desta correção: o sysroot tinha `sdl2.pc`, `SDL2_image.pc` e
// `SDL2_ttf.pc`, e **não** tinha `SDL2_mixer.pc`. Faltava uma linha no defconfig.

async function defconfigsComSdl2() {
  const out = [];
  for (const e of await readdir(DEVICE_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const file = path.join(DEVICE_ROOT, e.name, "defconfig");
    let texto;
    try {
      texto = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (/^BR2_PACKAGE_SDL2=y$/m.test(texto)) out.push({ pasta: e.name, texto });
  }
  return out;
}

test("quem tem SDL2 tem o mixer que a engine exige", async () => {
  // `mixer` está nas features da engine. Sem `SDL2_mixer`, o `.pc` não existe no
  // sysroot e o build da engine falha citando pkg-config.
  const aparelhos = await defconfigsComSdl2();
  assert.ok(aparelhos.length > 0, "nenhum defconfig com SDL2 — teste inútil");
  for (const { pasta, texto } of aparelhos) {
    assert.match(
      texto,
      /^BR2_PACKAGE_SDL2_MIXER=y$/m,
      `${pasta}: falta BR2_PACKAGE_SDL2_MIXER (a engine usa features image+mixer+ttf)`,
    );
  }
});

test("quem tem SDL2 tem image e ttf — os outros dois módulos da engine", async () => {
  const aparelhos = await defconfigsComSdl2();
  for (const { pasta, texto } of aparelhos) {
    assert.match(texto, /^BR2_PACKAGE_SDL2_IMAGE=y$/m, `${pasta}: falta SDL2_IMAGE`);
    assert.match(texto, /^BR2_PACKAGE_SDL2_TTF=y$/m, `${pasta}: falta SDL2_TTF`);
  }
});

test("KMSDRM continua ligado com OpenGLES — senão o SDL2 não tem vídeo", async () => {
  // Sem OPENGLES o Kconfig DESCARTA o KMSDRM em silêncio, e o SDL2 fica sem
  // driver de vídeo com /dev/dri/card0 perfeitamente funcional. A engine só
  // fala KMSDRM; um SDL2 sem ele não abre janela.
  const aparelhos = await defconfigsComSdl2();
  for (const { pasta, texto } of aparelhos) {
    assert.match(texto, /^BR2_PACKAGE_SDL2_KMSDRM=y$/m, `${pasta}: falta KMSDRM`);
    assert.match(texto, /^BR2_PACKAGE_SDL2_OPENGLES=y$/m, `${pasta}: falta OPENGLES`);
  }
});

// ── ALSA: subopções explícitas ──────────────────────────────────────────────
//
// Esta é a correção de uma afirmação errada que ficou onze revisões no AGENTS:
// "amixer não existe no Buildroot 2024.02". Existe — em `package/alsa-utils/`,
// como `BR2_PACKAGE_ALSA_UTILS_AMIXER`, e SEM `default y`. Só `alsactl` e
// `alsamixer` têm default. A diferença importa: "não empacotado" exige receita
// nova; "empacotado e desligado" é uma linha.

test("os utilitários de áudio que faltavam estão declarados", async () => {
  // `aplay`/`arecord` provam que o alto-falante toca numa imagem recém-gravada,
  // onde não há mídia. `speaker-test` gera o tom sem arquivo nenhum — é o único
  // teste de áudio que funciona sem conteúdo no cartão.
  const necessidade = [
    "BR2_PACKAGE_ALSA_UTILS_AMIXER",
    "BR2_PACKAGE_ALSA_UTILS_APLAY",
    "BR2_PACKAGE_ALSA_UTILS_SPEAKER_TEST",
  ];
  for (const e of await readdir(DEVICE_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const file = path.join(DEVICE_ROOT, e.name, "defconfig");
    let texto;
    try {
      texto = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!/^BR2_PACKAGE_ALSA_UTILS=y$/m.test(texto)) continue;
    for (const s of necessidade) {
      assert.match(
        texto,
        new RegExp(`^${s}=y$`, "m"),
        `${e.name}: falta ${s} — o padrão do 2024.02 só liga alsactl e alsamixer`,
      );
    }
  }
});

test("o AGENTS não repete mais que amixer não existe no Buildroot", async () => {
  // O erro sobreviveu onze revisões porque o sintoma de "não existe" e o de
  // "não vem ligado" são idênticos numa imagem: `command -v amixer` falha nos
  // dois casos. Este teste é barato e impede a frase de voltar.
  const texto = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
  assert.doesNotMatch(
    texto,
    /`amixer` não existe no Buildroot/,
    "a afirmação errada voltou — amixer É empacotado, é subopção sem default",
  );
  assert.match(texto, /config BR2_PACKAGE_ALSA_UTILS_AMIXER/, "a evidência do Config.in saiu");
});

// ── o script de cross-compile ───────────────────────────────────────────────
//
// A engine tem `Cross.toml` e ele funciona — mas o SDL2 que produz vem do
// `libsdl2-dev` AMD64 do container e o artefato sai pedindo `libsndio.so.7`,
// `libwayland-egl.so.1`, `libjack.so.0`, `libpipewire-0.3.so.0`. Nenhuma existe
// numa imagem Buildroot. Estes testes prendem o contrato do caminho que serve.

const ENGINE_SH = path.join(ROOT, "scripts", "engine-build.sh");

test("o script da engine usa o linker do Buildroot, não o do sistema", async () => {
  // O gcc do Buildroot carrega o próprio sysroot (glibc igual à do aparelho) e
  // injeta `--dynamic-linker` e os `crt*.o` sozinho. O `aarch64-linux-gnu-gcc`
  // do Ubuntu traz sysroot glibc 2.35 contra aparelho 2.38, e é a raiz das
  // quatro gambiarras que a doc da engine manda fazer à mão.
  const texto = await readFile(ENGINE_SH, "utf8");
  assert.match(texto, /buildroot-linux-gnu-gcc/);
  assert.doesNotMatch(
    texto,
    /LINKER=.*aarch64-linux-gnu-gcc["'\s]/,
    "não use o gcc aarch64 do sistema — sysroot glibc 2.35",
  );
});

test("o script usa PKG_CONFIG_LIBDIR, que SUBSTITUI a busca padrão", async () => {
  // `PKG_CONFIG_PATH` ACRESCENTA; o `.pc` do Ubuntu continua respondendo. Foi
  // assim que `-I/usr/include/SDL2` entrou no cross-compile do sdl2_mixer e o
  // gcc do Buildroot abortou com "unsafe header/library path".
  const texto = await readFile(ENGINE_SH, "utf8");
  assert.match(texto, /PKG_CONFIG_LIBDIR=/, "sem LIBDIR o .pc do host vence");
  assert.doesNotMatch(
    texto,
    /^\s*export PKG_CONFIG_PATH=/m,
    "PKG_CONFIG_PATH acrescenta e deixa o host vencer — use LIBDIR",
  );
});

test("o script desliga o SDL2 bundled e usa o do sysroot", async () => {
  // `bundled` compila um SDL2 próprio, com backends de desktop. `sdl2-system`
  // troca por `use-pkgconfig`, que é o que aponta para o sysroot.
  const texto = await readFile(ENGINE_SH, "utf8");
  assert.match(texto, /--no-default-features/);
  assert.match(texto, /--features sdl2-system/);
});

test("o script recusa binário que peça backend de desktop", async () => {
  // Sem esta guarda, um PKG_CONFIG_LIBDIR mal posto produz binário que `file`
  // diz ser válido e que morre no aparelho sem mensagem útil.
  const texto = await readFile(ENGINE_SH, "utf8");
  assert.match(texto, /lib\(sndio\|wayland\|jack\|pulse\|pipewire\)/);
});

test("o script confere PT_INTERP antes de instalar", async () => {
  // O sintoma mais enganoso: `file` diz "ELF aarch64 válido" e o binário dá
  // segfault imediato porque o kernel não sabe quem carregar.
  const texto = await readFile(ENGINE_SH, "utf8");
  assert.match(texto, /ld-linux-aarch64\.so\.1/);
  assert.match(texto, /readelf -l/);
});

test("quem tem SDL2_IMAGE tem libpng — senão PNG não decodifica", async () => {
  // `BR2_PACKAGE_SDL2_IMAGE=y` não implica decodificador PNG: o `.mk` do
  // Buildroot só passa `--enable-png` quando `BR2_PACKAGE_LIBPNG` existe por
  // conta própria. Sem ele a biblioteca é construída com `IMG_isPNG` presente e
  // respondendo "PNG images are not supported" — um erro que parece do app.
  //
  // Medido no R35S em 07/11/2026: `giochi-demo` carregava `assets/player.png`
  // no X55 e falhava aqui; o `c_smoke` da engine ia de 2 para 7 falhas, todas
  // do mesmo motivo. X55 e X35H já declaravam `libpng`; o R35S não.
  const aparelhos = await defconfigsComSdl2();
  assert.ok(aparelhos.length > 0, "nenhum defconfig com SDL2 — teste inútil");
  for (const { pasta, texto } of aparelhos) {
    if (!/^BR2_PACKAGE_SDL2_IMAGE=y$/m.test(texto)) continue;
    assert.match(
      texto,
      /^BR2_PACKAGE_LIBPNG=y$/m,
      `${pasta}: falta BR2_PACKAGE_LIBPNG — a SDL2_image fica sem PNG`,
    );
  }
});
