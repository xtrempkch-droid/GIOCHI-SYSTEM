#!/usr/bin/env node
// O joypad do R35S é driver FORA da árvore, e nada no build o exigia.
//
// Medido no cartão gravado em 06/11/2026 (`/lib/modules/6.12.0`): 1285 `.ko`,
// nenhum `rocknix-*`. O DTS declara `compatible = "rocknix-singleadc-joypad"`,
// o fonte estava em `device/r35s/kernel-modules/rocknix-joypad/` desde a
// extração — e nenhum script o levava para dentro da árvore do kernel.
//
// O resultado seria o pior tipo de imagem: boota, mostra o login, e os 16
// botões e os 4 eixos simplesmente não existem. Sem erro, sem mensagem, sem
// nada no dmesg — o nó do DTS fica órfão e o kernel não reclama de um
// `compatible` que ninguém atende.
//
// Estes testes prendem as quatro peças que fazem o driver chegar ao aparelho:
// o patch gerado, o gancho no `device.json`, o símbolo pedido no fragmento e a
// exigência em `kernel-required.txt`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = `${ROOT}device/r35s/kernel-modules/rocknix-joypad`;
const PATCH = `${ROOT}device/r35s/patches/0002-giochi-joypad-singleadc.patch`;
const GERADOR = `${ROOT}scripts/gerar-patch-modulos.mjs`;
const device = JSON.parse(readFileSync(`${ROOT}device/r35s/device.json`, "utf8"));
const fragment = readFileSync(`${ROOT}device/r35s/linux.fragment`, "utf8");
const required = readFileSync(`${ROOT}device/r35s/kernel-required.txt`, "utf8");

test("o fonte do driver está versionado, com licença GPL", () => {
  for (const f of ["rocknix-singleadc-joypad.c", "rocknix-joypad.c", "rocknix-joypad.h"]) {
    assert.ok(existsSync(`${SRC}/${f}`), `falta ${f}`);
  }
  const c = readFileSync(`${SRC}/rocknix-singleadc-joypad.c`, "utf8");
  assert.match(c, /SPDX-License-Identifier: GPL-2\.0-or-later/);
  assert.match(c, /MODULE_LICENSE\("GPL"\)/);
  // O `compatible` do DTS tem de casar com o que o driver anuncia, senão o nó
  // fica órfão — e é exatamente esse o defeito que este arquivo vigia.
  assert.match(c, /rocknix-singleadc-joypad/);
});

test("o patch existe e carrega os arquivos para dentro da árvore", () => {
  assert.ok(existsSync(PATCH), "o patch do joypad não existe");
  const p = readFileSync(PATCH, "utf8");
  for (const f of ["Kconfig", "rocknix-joypad.h",
    "rocknix-joypad.c", "rocknix-singleadc-joypad.c"]) {
    assert.ok(
      p.includes(`b/drivers/input/joystick/rocknix-joypad/${f}`),
      `o patch não cria drivers/input/joystick/rocknix-joypad/${f}`,
    );
  }
  // E tem de LIGAR o diretório nos dois lugares, senão o arquivo entra na
  // árvore e nunca é compilado.
  assert.match(p, /^\+source "drivers\/input\/joystick\/rocknix-joypad\/Kconfig"$/m);
  assert.match(p, /^\+obj-\$\(CONFIG_JOYSTICK_ODROIDGO3\)/m);
});

test("o patch está em dia com o fonte do driver", () => {
  // Sem isto, corrigir o .c em device/r35s/kernel-modules/ não muda a imagem:
  // o build aplica o patch velho e fica verde (§12.1 na forma pura).
  const out = execFileSync(process.execPath, [GERADOR, "--check"], { encoding: "utf8" });
  assert.match(out, /^OK: /m);
});

test("o device.json manda aplicar o patch", () => {
  const lista = device.kernelPatches ?? [];
  assert.ok(
    lista.some((p) => p.includes("0002-giochi-joypad-singleadc.patch")),
    "sem isto o patch existe no repositório e nenhum build o aplica",
  );
  // E o arquivo declarado tem de existir de verdade.
  for (const p of lista) {
    assert.ok(existsSync(`${ROOT}device/r35s/${p}`), `declarado e ausente: ${p}`);
  }
});

test("o símbolo do driver é =y no fragmento, não =m", () => {
  // Módulo que depende do `S15modules` para carregar é gamepad que pode não
  // existir no boot. Medido na X55: módulo na imagem, nada carregado, botões
  // mortos, build verde.
  assert.match(fragment, /^CONFIG_JOYSTICK_ODROIDGO3=y$/m);
});

test("kernel-required exige o símbolo — o gate que fecha o patch que não aplica", () => {
  // Se o patch parar de aplicar (kernel novo, contexto mudado), o símbolo
  // desaparece do `.config` e o build falha aqui — em vez de gerar imagem sem
  // botão nenhum e ninguém notar.
  assert.match(required, /^CONFIG_JOYSTICK_ODROIDGO3=y$/m);
});

test("o Kconfig do driver exige IIO e PWM, que é do que ele depende", () => {
  const p = readFileSync(PATCH, "utf8");
  const kconfig = p.slice(
    p.indexOf("b/drivers/input/joystick/rocknix-joypad/Kconfig"),
    p.indexOf("b/drivers/input/joystick/rocknix-joypad/rocknix-joypad.c"),
  );
  assert.match(kconfig, /depends on IIO/, "o driver usa devm_iio_channel_get");
  assert.match(kconfig, /depends on PWM/, "o driver usa devm_pwm_get no rumble");
  assert.match(kconfig, /tristate/, "tem de ser tristate para poder ser =y ou =m");
});

test("o Makefile aponta para o subdiretório — sem isso o Kbuild não acha o .o", () => {
  // Os `.o` moram em `rocknix-joypad/`, e o Makefile de cima tem de dizer isso.
  // Sem o caminho, o Kbuild procura `drivers/input/joystick/rocknix-*.o` e para:
  //
  //   make[6]: *** No rule to make target
  //     'drivers/input/joystick/rocknix-singleadc-joypad.o',
  //     needed by 'drivers/input/joystick/built-in.a'.  Stop.
  //
  // Medido em 06/11/2026, depois de o patch aplicar perfeitamente. O idioma
  // certo é o mesmo de `stmm/tee_stmm_efi.o` no Makefile do EFI.
  const p = readFileSync(PATCH, "utf8");
  assert.match(
    p,
    /^\+obj-\$\(CONFIG_JOYSTICK_ODROIDGO3\)\t\+= rocknix-joypad\/rocknix-singleadc-joypad\.o$/m,
  );
  assert.match(
    p,
    /^\+obj-\$\(CONFIG_JOYSTICK_ODROIDGO2\)\t\+= rocknix-joypad\/rocknix-joypad\.o$/m,
  );
  // E o `ifeq` do fornecedor não pode voltar: com DEVICE vazio ele compila a
  // variante errada em silêncio. Checar linha a linha, porque o texto do
  // comentário do Kconfig cita o `ifeq` de propósito.
  const linhasMake = p.split("\n").filter((l) => /^\+obj-|^\+ifeq|^\+else/.test(l));
  assert.ok(
    linhasMake.every((l) => !/ifeq/.test(l)),
    "nenhuma condicional por DEVICE pode voltar ao Makefile",
  );
});

test("o patch APLICA numa fonte limpa (dry-run)", () => {
  // Gerar o patch contra uma árvore que já recebeu o patch produz um diff que
  // não aplica: o `a/` passa a ter as linhas que ele mesmo insere. Aconteceu em
  // 06/11/2026 e custou um build inteiro:
  //
  //   Hunk #1 FAILED at 31.  1 out of 1 hunk FAILED
  //
  // O teste extrai as duas fontes do tarball do kernel (que o build já baixou) e
  // aplica com `--dry-run`. Não substitui o build, mas pega o erro em 1 s.
  const tarball = `${ROOT}/../.cache/giochi-system/dl/linux/linux-6.12.tar.xz`;
  const alt = `${process.env.HOME}/.cache/giochi-system/dl/linux/linux-6.12.tar.xz`;
  const fonte = existsSync(alt) ? alt : tarball;
  if (!existsSync(fonte)) {
    // Sem o tarball não há como provar — e pular em silêncio seria o defeito.
    console.warn(`  (pulado: ${fonte} não existe)`);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "giochi-dryrun-"));
  try {
    execFileSync("tar", ["-xJf", fonte, "--strip-components=1", "-C", tmp,
      "linux-6.12/drivers/input/joystick/Kconfig",
      "linux-6.12/drivers/input/joystick/Makefile"]);
    const out = execFileSync("patch", ["-p1", "--dry-run", "-i", PATCH],
      { cwd: tmp, encoding: "utf8" });
    assert.match(out, /checking file drivers\/input\/joystick\/Makefile/);
    assert.ok(!/FAILED/.test(out), out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("todo símbolo do Makefile tem um config no Kconfig", () => {
  // O Kconfig prometendo um módulo que o Makefile nunca compila é falha verde:
  // o usuário liga o símbolo, nada é construído, ninguém reclama. Aconteceu na
  // primeira versão do gerador — um rename parcial deixou
  // `obj-$(CONFIG_JOYSTICK_ROCKNIX)` no Makefile e `config JOYSTICK_ODROIDGO2`
  // no Kconfig.
  const p = readFileSync(PATCH, "utf8");
  const definidos = new Set([...p.matchAll(/^\+config ([A-Z0-9_]+)$/gm)].map((m) => m[1]));
  const referidos = new Set(
    [...p.matchAll(/^\+obj-\$\(CONFIG_([A-Z0-9_]+)\)/gm)].map((m) => m[1]),
  );
  assert.ok(definidos.size >= 2, `Kconfig com só ${definidos.size} símbolo(s)`);
  const orfaos = [...referidos].filter((s) => !definidos.has(s));
  assert.deepEqual(orfaos, [], `Makefile referencia símbolo sem Kconfig: ${orfaos.join(", ")}`);
  // E o contrário também: símbolo declarado que nunca vira módulo é promessa vazia.
  const semModulo = [...definidos].filter((s) => !referidos.has(s));
  assert.deepEqual(semModulo, [], `Kconfig declara símbolo sem obj-: ${semModulo.join(", ")}`);
});

// ── o painel: a outra metade da tela ──────────────────────────────────────
//
// Mesma classe de defeito do joypad, e o sintoma é pior: tela preta com o
// sistema bootando normal. Medido no R35S em 06/11/2026 — login funcionando por
// serial e `SEM_DRI`, porque o `dw-mipi-dsi-rockchip` cria o dispositivo
// `mipi-dsi ff450000.dsi.0` e nenhum driver de painel o atende.

const PATCH_PAINEL = `${ROOT}device/r35s/patches/0003-giochi-painel-generic-dsi.patch`;
const SRC_PAINEL = `${ROOT}device/r35s/kernel-modules/generic-dsi/panel-generic-dsi.c`;

test("o fonte do driver de painel está versionado, com licença GPL", () => {
  assert.ok(existsSync(SRC_PAINEL), "falta o .c do painel");
  const c = readFileSync(SRC_PAINEL, "utf8");
  assert.match(c, /SPDX-License-Identifier: GPL-2\.0/);
  assert.match(c, /MODULE_LICENSE\("GPL/);
  // O `compatible` do DTS tem de casar com o que o driver anuncia.
  assert.match(c, /"rocknix,generic-dsi"/);
  // E tem de ler a descrição do DT — é o que o gerador de painel escreve.
  assert.match(c, /of_property_count_strings\([^)]*"panel_description"/);
});

test("o patch do painel carrega o .c e liga Kconfig/Makefile", () => {
  assert.ok(existsSync(PATCH_PAINEL), "o patch do painel não existe");
  const p = readFileSync(PATCH_PAINEL, "utf8");
  assert.ok(
    p.includes("b/drivers/gpu/drm/panel/panel-generic-dsi.c"),
    "o patch não cria panel-generic-dsi.c",
  );
  // Arquivo na árvore sem gancho não compila. Os dois ganchos são obrigatórios.
  assert.match(p, /^\+config DRM_PANEL_GENERIC_DSI$/m);
  assert.match(p, /^\+obj-\$\(CONFIG_DRM_PANEL_GENERIC_DSI\) \+= panel-generic-dsi\.o$/m);
  // Arquivo único fica no próprio diretório: sem subcaminho no obj-.
  assert.ok(
    !/CONFIG_DRM_PANEL_GENERIC_DSI\) \+= .*\//.test(p),
    "panel-generic-dsi.c não mora em subdiretório",
  );
});

test("o device.json manda aplicar o patch do painel", () => {
  const lista = device.kernelPatches ?? [];
  assert.ok(
    lista.some((p) => p.includes("0003-giochi-painel-generic-dsi.patch")),
    "sem isto o patch existe e nenhum build o aplica",
  );
});

test("o símbolo do painel é =y no fragmento e exigido no kernel-required", () => {
  // `=m` dependeria do S15modules — e uma tela que depende de autoload de
  // módulo é uma tela que pode não acender. O painel é o console desta placa.
  assert.match(fragment, /^CONFIG_DRM_PANEL_GENERIC_DSI=y$/m);
  assert.match(required, /^CONFIG_DRM_PANEL_GENERIC_DSI=y$/m);
});

test("o DTS usa o compatible que o driver anuncia, não um inventado", () => {
  // Um `compatible` sem driver deixa o nó órfão e a tela preta, sem erro.
  // Este teste fecha a ponte entre os dois arquivos.
  const dts = readFileSync(
    `${ROOT}device/r35s/patches/0001-giochi-system-r35s-dts-e-painel.patch`,
    "utf8",
  );
  assert.match(dts, /^\+	compatible = "rocknix,generic-dsi";$/m);
  const driver = readFileSync(SRC_PAINEL, "utf8");
  assert.match(driver, /\.compatible = "rocknix,generic-dsi"/);
});

test("o patch do painel APLICA numa fonte limpa (dry-run)", () => {
  // Mesma armadilha do joypad: patch gerado contra árvore já patcheada não
  // aplica, e o `a/` do diff esconde o motivo.
  const alt = `${process.env.HOME}/.cache/giochi-system/dl/linux/linux-6.12.tar.xz`;
  if (!existsSync(alt)) {
    console.warn(`  (pulado: ${alt} não existe)`);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "giochi-dryrun-painel-"));
  try {
    execFileSync("tar", ["-xJf", alt, "--strip-components=1", "-C", tmp,
      "linux-6.12/drivers/gpu/drm/panel/Kconfig",
      "linux-6.12/drivers/gpu/drm/panel/Makefile"]);
    const out = execFileSync("patch", ["-p1", "--dry-run", "-i", PATCH_PAINEL],
      { cwd: tmp, encoding: "utf8" });
    assert.match(out, /checking file drivers\/gpu\/drm\/panel\/Makefile/);
    assert.ok(!/FAILED/.test(out), out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
