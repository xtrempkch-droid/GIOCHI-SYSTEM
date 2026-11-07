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
