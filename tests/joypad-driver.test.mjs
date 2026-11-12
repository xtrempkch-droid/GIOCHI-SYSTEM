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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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

// ── áudio: o card, não só o codec ─────────────────────────────────────────
//
// Medido no aparelho em 06/11/2026 com a imagem que bootou: `CONFIG_SND_SOC_RK817=y`,
// `CONFIG_SND_SOC_ROCKCHIP_I2S=y`, PMIC `rk808` probe OK — e mesmo assim
// `--- no soundcards ---`.
//
// Faltavam DUAS peças, independentes, com o mesmo sintoma:
//
//   1. `CONFIG_SND_SIMPLE_CARD` estava `=m` (default do defconfig arm64) e o
//      R35S não tem `/etc/modules` nem `S15modules`. O `.ko` existia em
//      `/lib/modules/.../snd-soc-simple-card.ko` e nada o carregava — a mesma
//      armadilha do X55 (§3), com o mesmo build verde.
//   2. `BR2_PACKAGE_ALSA_LIB` não estava ligada em lugar nenhum, então o rootfs
//      não tinha `libasound.so` e o SDL2 não tinha como abrir o dispositivo.

test("o card de som é =y, não =m — nada carrega módulo neste aparelho", () => {
  // Sem `/etc/modules` e sem `S15modules`, `=m` significa "no disco e morto".
  assert.match(fragment, /^CONFIG_SND_SIMPLE_CARD=y$/m);
  assert.match(required, /^CONFIG_SND_SIMPLE_CARD=y$/m);
  // E o codec e o I2S continuam exigidos: o card sozinho não faz som.
  assert.match(fragment, /^CONFIG_SND_SOC_RK817=y$/m);
  assert.match(fragment, /^CONFIG_SND_SOC_ROCKCHIP_I2S=y$/m);
});

test("o R35S não tem S15modules, então módulo de áudio seria mudo", () => {
  // Este teste documenta a PREMISSA da decisão acima. Se um dia alguém criar
  // um S15modules para este aparelho, o `=m` volta a ser aceitável — e este
  // teste avisa que a premissa mudou.
  const temS15 = existsSync(`${ROOT}device/r35s/rootfs-overlay/etc/init.d/S15modules`);
  const temModules = existsSync(`${ROOT}device/r35s/rootfs-overlay/etc/modules`);
  assert.equal(
    temS15 || temModules, false,
    "apareceu autoload de módulo no R35S: reveja a decisão de SND_SIMPLE_CARD=y",
  );
});

test("libasound e alsactl estão na imagem", () => {
  // `ALSA_LIB` é o que o SDL2 precisa. `ALSA_UTILS` traz `alsactl`, única forma
  // de ler/gravar mixer no aparelho — `amixer` não existe nesta série (§12.16).
  const br = readFileSync(`${ROOT}device/r35s/buildroot.fragment`, "utf8");
  assert.match(br, /^BR2_PACKAGE_ALSA_LIB=y$/m);
  assert.match(br, /^BR2_PACKAGE_ALSA_UTILS=y$/m);
});

// ── USB OTG: o PHY que o DTS do vendor deixa desligado ────────────────────
//
// Medido no aparelho em 06/11/2026, com o cabo plugado na porta OTG:
//
//   /sys/class/udc/ff300000.usb/state          ->  not attached
//   /sys/kernel/config/usb_gadget/.../UDC      ->  ff300000.usb   (vinculado)
//   usb0                                       ->  NO-CARRIER, com 10.55.0.2
//
// O gadget estava armado e o controlador não acordava o link. Causa:
// `rockchip_usb2phy_probe` percorre os filhos com
// `for_each_available_child_of_node`, que PULA nó `status = "disabled"`. O
// `otg-port` do vendor está disabled, então nenhum PHY é criado — e o
// `usb@ff300000` pede exatamente esse PHY (`phys = <&u2phy_otg>`).
//
// O R35S tem UMA porta USB (`usb@ff300000`, dr_mode=otg); as outras duas
// (`ff340000`, `ff350000`) estão disabled no DTB. Ou seja: sem o otg-port não
// há USB nenhum, nem para shell.

const R3XS = `${ROOT}device/r35s/dts/src/rk3326-gameconsole-r3xs.dtsi`;

test("o otg-port do PHY está okay — sem ele o gadget fica not attached", () => {
  const src = readFileSync(R3XS, "utf8");
  const m = /\bu2phy_otg:\s*otg-port\s*\{([\s\S]*?)\n\s*\};/.exec(src);
  assert.ok(m, "não achei o nó u2phy_otg no dtsi da placa");
  assert.match(
    m[1], /status\s*=\s*"okay"/,
    "otg-port disabled => nenhum PHY criado => dwc2 sem VBUS => not attached",
  );
});

test("o patch do DTS carrega o otg-port ligado", () => {
  // O patch é gerado da fonte; este teste pega o caso de alguém corrigir o dtsi
  // e esquecer de regerar — build verde, aparelho com o comportamento antigo.
  const p = readFileSync(`${ROOT}device/r35s/patches/0001-giochi-system-r35s-dts-e-painel.patch`, "utf8");
  assert.match(p, /^\+	u2phy_otg: otg-port \{$/m);
  const bloco = p.slice(p.indexOf("+	u2phy_otg: otg-port {"));
  assert.match(bloco.slice(0, 400), /^\+\t\tstatus = "okay";$/m);
});

test("o patch do DTS está em dia com device/r35s/dts/", () => {
  const out = execFileSync(process.execPath,
    [`${ROOT}scripts/gerar-patch-dts.mjs`, "--check"], { encoding: "utf8" });
  assert.match(out, /^OK: /m);
});

test("o gerador do DTS recusa publicar DTS que compila mas não funciona", () => {
  // As checagens do gerador olham SIGNIFICADO, não sintaxe: um DTS compila com
  // o hardware errado. Este teste garante que as checagens existem e cobrem os
  // três casos que já custaram um boot.
  const gerador = readFileSync(`${ROOT}scripts/gerar-patch-dts.mjs`, "utf8");
  assert.match(gerador, /u2phy_otg \(otg-port\) não está status=okay/);
  assert.match(gerador, /rocknix,generic-dsi/);
  assert.match(gerador, /gameconsole,r35s/);
});

// ── USB: `otg` não basta, tem de ser `peripheral` ─────────────────────────
//
// Medido no aparelho em 06/11/2026, com o cabo neste porta:
//
//   dr_mode = "otg"         ->  udc state = not attached, usb0 NO-CARRIER
//   dr_mode = "peripheral"  ->  udc state = configured, usb0 LOWER_UP, e o PC
//                               enumera: "rndis_host ... Product: Giochi System"
//
// As linhas de dados funcionam; o que falta é a detecção de VBUS (a alimentação
// vem pelo carregador do PMIC, não pelo pino VBUS do controlador). Em `otg` o
// dwc2 espera o `bvalid` do PHY antes de conectar o pullup; em `peripheral` ele
// conecta sem esperar (`dwc2_hsotg_pullup`).
//
// Ligar o otg-port do PHY sozinho não resolveu — foi medido: o PHY passou a ser
// criado (IRQ 61 -> 63) e o estado continuou `not attached`. As duas peças são
// necessárias, e nenhuma das duas aparece em mensagem de erro.

test("usb20_otg tem role switch, não dr_mode fixo", () => {
  // A evolução do diagnóstico, medida em duas rodadas:
  //
  //   1. `dr_mode = "otg"`        -> UDC `not attached` (bvalid do PHY nunca sobe)
  //   2. `dr_mode = "peripheral"` -> funciona, MAS fecha a porta para host:
  //                                  dongle Wi-Fi deixa de ser possível
  //   3. role switch              -> os dois papéis
  //
  // O `dwc2_ovr_init()` força `GOTGCTL_BVALOVAL | GOTGCTL_VBVALOVAL` quando o
  // modo default é peripheral — mesmo efeito do item 2, sem matar host. E o
  // role switch só existe se o nó tiver `usb-role-switch`.
  const src = readFileSync(R3XS, "utf8");
  const m = /&usb20_otg\s*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(m, "não achei o nó &usb20_otg");
  const corpo = m[1];

  assert.match(corpo, /^\s*usb-role-switch;/m,
    "sem isto o dwc2 não registra o role switch");
  assert.match(corpo, /role-switch-default-mode\s*=\s*"peripheral"/,
    "é o que força BVALOVAL e faz o gadget subir sem o PHY");
  // `otg` é REQUISITO: `dwc2_drd_role_sw_set` recusa host com `peripheral`.
  assert.match(corpo, /dr_mode\s*=\s*"otg"/,
    "com `peripheral` o kernel recusa a troca para host (EINVAL)");
});

test("o patch do DTS carrega role switch e otg-port", () => {
  const p = readFileSync(
    `${ROOT}device/r35s/patches/0001-giochi-system-r35s-dts-e-painel.patch`, "utf8");
  assert.match(p, /^\+	usb-role-switch;$/m);
  assert.match(p, /^\+	role-switch-default-mode = "peripheral";$/m);
  assert.match(p, /^\+	dr_mode = "otg";$/m);
  // E o otg-port também, que é a outra metade.
  assert.match(p, /^\+	u2phy_otg: otg-port \{$/m);
});

test("o gerador do DTS recusa DTS sem role switch", () => {
  const gerador = readFileSync(`${ROOT}scripts/gerar-patch-dts.mjs`, "utf8");
  assert.match(gerador, /usb-role-switch/, "a checagem tem de cobrir o role switch");
  assert.match(gerador, /role-switch-default-mode/);
  assert.match(gerador, /recusa host com/);
});

// ── transferência de arquivo: mass_storage, não MTP ───────────────────────
//
// Pedido de "confirmar o MTP". A verificação deu NEGATIVO no kernel, e o
// resultado está medido: o mainline não tem `f_mtp` — não existe
// `CONFIG_USB_CONFIGFS_MTP` nem `f_mtp.c` em `drivers/usb/gadget/function/`.
// MTP no Android é patch fora da árvore, e existe lá porque o Android não pode
// expor o armazenamento cru.
//
// O que existe é `mass_storage`, que já vem `=y` do defconfig arm64. É o que
// `giochi-usbnet --ms` usa: o PC vê a partição como disco removível e `cp`
// funciona sem daemon nem biblioteca no aparelho.

const USBNET = `${ROOT}device/common/rootfs-overlay/usr/bin/giochi-usbnet`;

test("o modo de transferência é mass_storage, e é o que o kernel tem", () => {
  const sh = readFileSync(USBNET, "utf8");
  assert.match(sh, /functions\/mass_storage\.usb0/, "não usa mass_storage");
  assert.match(sh, /lun\.0\/file/, "o LUN tem de apontar para um dispositivo");
  assert.match(sh, /lun\.0\/removable/, "sem removable o PC não mostra como disco");
  // E o fragmento declara o símbolo, em vez de depender do default do arm64.
  assert.match(fragment, /^CONFIG_USB_CONFIGFS_MASS_STORAGE=y$/m);
});

test("o modo de armazenamento RECUSA expor a partição do rootfs", () => {
  // A guarda que não se negocia: expor o filesystem que sustenta `/` deixa o PC
  // escrever num filesystem EM USO. O dano só aparece no boot seguinte.
  const sh = readFileSync(USBNET, "utf8");
  const bloco = sh.slice(sh.indexOf("start_mass_storage()"), sh.indexOf("stop_mass_storage()"));
  assert.match(bloco, /RECUSADO/, "tem de haver recusa explícita");
  assert.match(bloco, /mountinfo/, "a recusa tem de comparar com o que sustenta /");
  assert.match(bloco, /\$5 == "\/"/, "tem de identificar a partição de /");
  // E o teste NEGATIVO: o caminho de recusa tem de sair com erro, não avisar e
  // continuar — avisar e seguir é o defeito.
  assert.match(bloco, /return 1/);
});

test("o modo de armazenamento desmonta antes de expor", () => {
  // Expor partição montada dá cache sujo no aparelho e lixo no PC.
  const sh = readFileSync(USBNET, "utf8");
  const bloco = sh.slice(sh.indexOf("start_mass_storage()"), sh.indexOf("stop_mass_storage()"));
  assert.match(bloco, /umount/, "tem de desmontar antes");
  assert.ok(
    bloco.indexOf("umount") < bloco.indexOf("lun.0/file"),
    "a ordem importa: desmontar ANTES de apontar o LUN",
  );
});

test("`--ms-stop` desanexa o backing file e volta ao RNDIS", () => {
  // Limpar `lun.0/file` é o que libera o dispositivo. Sem isso o backing file
  // fica preso e o aparelho não consegue remontar a partição.
  const sh = readFileSync(USBNET, "utf8");
  const bloco = sh.slice(sh.indexOf("stop_mass_storage()"), sh.indexOf("# ---------------------------------------------------------------- main"));
  assert.match(bloco, /lun\.0\/file/, "tem de limpar o file do LUN");
  assert.match(bloco, /start_gadget rndis/, "tem de voltar ao gadget de rede");
});

test("a guarda do rootfs compara major:minor, não nome de node", () => {
  // DEFEITO REAL, medido no aparelho em 06/11/2026: a primeira versão da guarda
  // comparava `/proc/mounts` com o part via `readlink -f`, e o teste no aparelho
  // EXPÔS O ROOTFS AO PC. Não é hipótese — aconteceu:
  //
  //   /proc/mounts ->  /dev/root        (nome de conveniência)
  //   readlink -f  ->  /dev/root        (o node NÃO existe)
  //   ls /dev/root ->  No such file or directory
  //
  // `readlink -f` de caminho inexistente devolve o próprio caminho, então
  // `/dev/root` != `/dev/mmcblk1p2` e a guarda deixava passar.
  //
  // O método que funciona é major:minor: `/proc/self/mountinfo` dá `179:2` e
  // `/sys/dev/block/179:2` é um symlink para o mmcblk1p2.
  const sh = readFileSync(USBNET, "utf8");
  const bloco = sh.slice(sh.indexOf("start_mass_storage()"), sh.indexOf("stop_mass_storage()"));
  assert.match(bloco, /mountinfo/, "tem de usar mountinfo, que traz major:minor");
  assert.match(bloco, /sys\/dev\/block/, "tem de resolver o número pelo kernel");
  // E o método ANTIGO não pode voltar: readlink -f em /dev/root não resolve.
  assert.ok(
    !/readlink -f "\$ROOTDEV"/.test(bloco) && !/readlink -f "\$PART"/.test(bloco),
    "readlink -f não resolve /dev/root (o node não existe) — foi o que falhou",
  );
});

test("a guarda não usa strtonum (não existe no awk do busybox)", () => {
  // §12.20: `strtonum` é do gawk. No busybox a expressão devolve vazio e uma
  // comparação com vazio dá "diferente" — ou seja, a guarda nunca recusaria.
  const sh = readFileSync(USBNET, "utf8");
  // Só linhas de CÓDIGO contam: o comentário cita `strtonum` de propósito, para
  // explicar por que ele não é usado. Procurar a palavra no arquivo inteiro dava
  // falso negativo — foi o que este teste pegou na primeira execução.
  const codigo = sh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.ok(!/strtonum/.test(codigo), "strtonum não existe no awk do busybox");
});

test("a guarda recusa mmcblk1p2 e permite mmcblk1p1, com os dados reais", () => {
  // Reproduz o sysfs do aparelho: /sys/dev/block/179:2 -> .../mmcblk1p2, e
  // /proc/self/mountinfo dizendo que a raiz é 179:2.
  //
  // Roda com `cwd` no tmp porque o symlink do kernel é RELATIVO
  // (`../../devices/...`): com caminho absoluto no argumento, `ls -l` mostraria
  // o destino relativo ao diretório do teste, não ao sysfs — e o teste acusaria
  // falha num código que funciona (foi o que aconteceu na primeira versão).
  const tmp = mkdtempSync(path.join(tmpdir(), "giochi-guarda-"));
  try {
    mkdirSync(path.join(tmp, "sys/dev/block"), { recursive: true });
    mkdirSync(path.join(tmp, "devices/mmcblk1"), { recursive: true });
    writeFileSync(path.join(tmp, "mountinfo"),
      "24 1 179:2 / / rw,relatime - ext4 /dev/root rw\n");
    for (const pp of ["mmcblk1p1", "mmcblk1p2"]) {
      writeFileSync(path.join(tmp, "devices/mmcblk1", pp), "");
    }
    // Os alvos ficam em <tmp>/devices/... e o symlink em <tmp>/sys/dev/block
    // aponta para ../../devices/... — igual ao kernel.
    // `symlinkSync` em vez de `ln`: o `ln` do shell do teste resolve
    // `-sfn` de forma diferente conforme o cwd, e o symlink saía apontando
    // para o lugar errado — o teste então acusava falha no código que funciona.
    symlinkSync("../../devices/mmcblk1/mmcblk1p2",
      path.join(tmp, "sys/dev/block/179:2"));
    symlinkSync("../../devices/mmcblk1/mmcblk1p1",
      path.join(tmp, "sys/dev/block/179:1"));

    const script = `
for part in mmcblk1p2 mmcblk1p1; do
  raiz="$(awk '$5 == "/" {print $3; exit}' mountinfo)"
  alvo="$(ls -l sys/dev/block 2>/dev/null | awk -v p="$part" '$NF ~ ("/" p "$") {print $9; exit}')"
  if [ -n "$raiz" ] && [ "$raiz" = "$alvo" ]; then echo "$part RECUSA"; else echo "$part permite"; fi
done`;
    const saida = execFileSync("sh", ["-c", script], { cwd: tmp, encoding: "utf8" })
      .trim().split("\n");
    assert.deepEqual(saida, ["mmcblk1p2 RECUSA", "mmcblk1p1 permite"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── dongle Wi-Fi: o R35S não tem rádio, então é o único caminho ───────────
//
// Pedido de 06/11/2026: "dongle Wi-Fi/USB pode implantar, pois esse não tem
// wifi nem bluetooth interno". Confere com o medido: o DTB não tem nó de rádio,
// e o `ls /sys/class/net` só mostra `lo` e `usb0`.
//
// Isso exigiu reverter o `dr_mode = "peripheral"` que eu tinha fixado: um
// `dr_mode` fixo escolhe um papel para sempre, e a MESMA porta serve para o
// shell USB (device) e para o dongle (host).

const USB_TOOL = `${ROOT}device/common/rootfs-overlay/usr/bin/giochi-usb`;

test("giochi-usb troca o papel e volta — sem deixar o gadget pendurado", () => {
  assert.ok(existsSync(USB_TOOL), "falta o giochi-usb");
  const sh = readFileSync(USB_TOOL, "utf8");
  assert.match(sh, /\/sys\/class\/usb_role\/\*\/role/, "o caminho do role switch");
  // Desmontar o gadget antes de virar host: bind pendurado num controlador que
  // virou host faz o `--device` seguinte não remontar.
  const blocoHost = sh.slice(sh.indexOf("virar_host()"), sh.indexOf("virar_device()"));
  assert.match(blocoHost, /--stop/, "tem de parar o gadget antes de trocar");
  // E voltar para device tem de REMONTAR o RNDIS, senão o usuário perde o shell.
  const blocoDev = sh.slice(sh.indexOf("virar_device()"));
  assert.match(blocoDev, /giochi-usbnet|USBNET/, "tem de remontar o RNDIS");
});

test("os drivers de dongle estão no R35S e são módulos", () => {
  // Hardware FORNECIDO pelo usuário se empacota mesmo ausente (§12.31): a imagem
  // é gravada uma vez e o dongle chega depois.
  for (const sym of ["RTL8XXXU", "RTL8192CU", "MT7601U", "ATH9K_HTC"]) {
    assert.match(fragment, new RegExp(`^CONFIG_${sym}=m$`, "m"), `falta ${sym}`);
  }
  // `UNTESTED` é o que cobre o 8188FU, o dongle barato de hoje.
  assert.match(fragment, /^CONFIG_RTL8XXXU_UNTESTED=y$/m);
  // `=m` e não `=y`: carregam por modalias quando o dongle entra, e não custam
  // memória se ninguém plugar.
  assert.ok(
    !/^CONFIG_RTL8XXXU=y$/m.test(fragment),
    "=y infla o kernel com driver que talvez nunca seja usado",
  );
});

test("o firmware dos dongles vem na imagem, com usuário de Wi-Fi", () => {
  const br = readFileSync(`${ROOT}device/r35s/buildroot.fragment`, "utf8");
  assert.match(br, /^BR2_PACKAGE_LINUX_FIRMWARE_RTL_81XX=y$/m, "8188/8192/8723/8188FU");
  assert.match(br, /^BR2_PACKAGE_LINUX_FIRMWARE_ATHEROS_9271=y$/m, "AR9271");
  // Sem wpa_supplicant/iw a interface existe e não há como conectar.
  assert.match(br, /^BR2_PACKAGE_WPA_SUPPLICANT=y$/m);
  assert.match(br, /^BR2_PACKAGE_IW=y$/m);
  assert.match(br, /^BR2_PACKAGE_WIRELESS_REGDB=y$/m);
  // E o mt7601u entra pelo override, que já vale para todos os aparelhos.
  const ov = readFileSync(`${ROOT}config/package-overrides.mk`, "utf8");
  assert.match(ov, /mediatek\/mt7601u\.bin/);
});

test("credencial de Wi-Fi não entra na imagem (§12.14)", () => {
  // O artefato do CI é público: um wpa_supplicant.conf com psk= entrega a senha
  // de quem buildou. É provisionado no aparelho com `wpa_passphrase`.
  const br = readFileSync(`${ROOT}device/r35s/buildroot.fragment`, "utf8");
  assert.ok(!/psk=|ssid=/i.test(br), "nada de credencial no fragmento");
  assert.match(br, /wpa_passphrase|provisionad/i, "o motivo tem de estar escrito");
});
