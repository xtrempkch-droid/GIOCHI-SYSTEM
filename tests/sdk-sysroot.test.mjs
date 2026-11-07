import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BUILD_SH = path.join(ROOT, "scripts", "build-device.sh");
const COMMON = path.join(ROOT, "config", "common.fragment");

// SDK E SYSROOT EXPLÍCITO — pedido P1 do relatório da equipe da engine
// (07/11/2026).
//
// O `/usr/include` da imagem é VAZIO (medido: zero entradas). Não há stdio.h,
// nem os headers das satélites do SDL2. Copiar `include/` e `lib/` para o rootfs
// não resolve: aumentaria a imagem e continuaria sem headers de libc.
//
// A correção é exportar um SDK — `BR2_PACKAGE_HOST_ENVIRONMENT_SETUP=y` gera
// `host/environment-setup`.
//
// E aqui está o ponto que estes testes protegem: o `environment-setup` do
// Buildroot exporta `PKG_CONFIG=pkg-config` e `STAGING_DIR`, mas **não** exporta
// `PKG_CONFIG_SYSROOT_DIR` nem `PKG_CONFIG_LIBDIR`. Medido — ele funciona, mas
// só porque o `pkg-config` do PATH é o do Buildroot, que resolve pelo sysroot
// sozinho. Trocado o PATH, o do sistema responde com `.pc` de x86_64: é
// exatamente o vazamento dos §12.54 e §12.55, que já custou dois builds aqui.
//
// O build acrescenta as duas linhas ao final do script gerado.

test("o build pede o SDK do Buildroot", async () => {
  const texto = await readFile(COMMON, "utf8");
  assert.match(texto, /^BR2_PACKAGE_HOST_ENVIRONMENT_SETUP=y$/m);
});

test("o build reforça o environment-setup com sysroot explícito", async () => {
  const texto = await readFile(BUILD_SH, "utf8");
  assert.match(texto, /PKG_CONFIG_SYSROOT_DIR=\$STAGING_DIR/);
  assert.match(texto, /PKG_CONFIG_LIBDIR=\$STAGING_DIR/);
});

test("o reforço é idempotente — não duplica a cada build", async () => {
  // O build roda muitas vezes sobre o mesmo `work/`. Acrescentar sem guarda
  // faria o arquivo crescer indefinidamente e as exportações se repetirem.
  const texto = await readFile(BUILD_SH, "utf8");
  assert.match(texto, /grep -q "PKG_CONFIG_SYSROOT_DIR"/);
});

test("usa LIBDIR, não PATH — PATH acrescenta e deixa o host vencer", async () => {
  // `PKG_CONFIG_PATH` ACRESCENTA à busca padrão: o `.pc` do host continua
  // respondendo. `PKG_CONFIG_LIBDIR` SUBSTITUI, que é o que impede o vazamento.
  const texto = await readFile(BUILD_SH, "utf8");
  assert.doesNotMatch(texto, /export "PKG_CONFIG_PATH=/);
  assert.match(texto, /export "PKG_CONFIG_LIBDIR=/);
});

test("o timeout do busybox está ligado — P2 do relatório", async () => {
  // Sem `timeout`, um teste que trava prende o console para sempre: não há
  // segunda sessão para matar o processo. Custa ~1 KB pelo applet do busybox;
  // `BR2_PACKAGE_COREUTILS` traria ~100 utilitários sem uso.
  const texto = await readFile(path.join(ROOT, "config", "common.busybox.fragment"), "utf8");
  assert.match(texto, /^CONFIG_TIMEOUT=y$/m);
});

test("o timeout vem do busybox, não de coreutils", async () => {
  const comum = await readFile(COMMON, "utf8");
  assert.doesNotMatch(comum, /^BR2_PACKAGE_COREUTILS=y$/m);
});
