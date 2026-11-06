#!/usr/bin/env node
// O port do R35S: o que foi extraído do aparelho e o encanamento de DTS.
//
// Contexto medido em 06/11/2026: com a console serial funcionando, extraí do
// R35S a config do kernel que boota nele, e provei que DTS e os dois drivers
// fora da árvore compilam contra o NOSSO kernel 6.12. Este teste prende as duas
// metades para não virarem ficção quando alguém mexer.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const DEVICE = `${ROOT}device/r35s`;
const device = JSON.parse(readFileSync(`${DEVICE}/device.json`, "utf8"));

// ── artefatos extraídos do aparelho ─────────────────────────

test("a config do kernel veio do aparelho e o md5 é o medido", () => {
  // O md5 foi lido no aparelho com `md5sum` e conferido do lado de cá pelo
  // serial-pull.py. Fixar aqui impede que um arquivo trocado passe como se
  // fosse a medição original.
  const raw = readFileSync(`${DEVICE}/extracted/kernel-config.gz`);
  const md5 = createHash("md5").update(raw).digest("hex");
  assert.equal(md5, "93bf213f1cbaed4f5867236cdfb4c13c");
  assert.equal(raw.length, 41849);
});

test("a config descomprime e é um kernel config de verdade", () => {
  const text = gunzipSync(readFileSync(`${DEVICE}/extracted/kernel-config.gz`)).toString("utf8");
  const lines = text.split("\n").filter(Boolean);
  assert.ok(lines.length > 5000, `só ${lines.length} linhas`);
  assert.match(text, /^CONFIG_ARM64=y$/m);
  // Deve ser a config do vendor, não a nossa: é o que dá valor comparativo.
  assert.match(text, /^CONFIG_DEFAULT_HOSTNAME="ROCKNIX"$/m);
  assert.match(text, /^CONFIG_ARCH_ROCKCHIP=y$/m);
});

test("os símbolos do fragmento existem na config do vendor", () => {
  // Cada símbolo que afirmamos ser necessário deve ter sido OBSERVADO no
  // aparelho. Se um saiu daqui sem estar lá, é invenção.
  const vendor = gunzipSync(readFileSync(`${DEVICE}/extracted/kernel-config.gz`)).toString("utf8");
  const fragment = readFileSync(`${DEVICE}/linux.fragment`, "utf8");
  const symbols = [...fragment.matchAll(/^CONFIG_([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  assert.ok(symbols.length > 40, `fragmento com só ${symbols.length} símbolos`);

  const missing = symbols.filter((symbol) => !new RegExp(`^CONFIG_${symbol}=`, "m").test(vendor));
  // Exceções têm de ser EXPLÍCITAS e ter motivo. Silêncio aqui transformaria
  // "achei no aparelho" em "inventei", que é a diferença entre medir e supor.
  const allowed = new Set([
    // Sub-símbolo do MFD no 6.12; o vendor o embute de outra forma.
    "MFD_RK8XX_I2C",
    // ESCOLHA NOSSA, não medição: o vendor usa outro governor. O `schedutil` é
    // o padrão do mainline para ARM e é o que interage bem com `cpufreq-dt`.
    "CPU_FREQ_DEFAULT_GOV_SCHEDUTIL",
    // ESCOLHA NOSSA (AGENTS §12.31): o dongle barato de hoje é o 8188FU, que só
    // é coberto com UNTESTED ligado. O vendor não precisa porque não empacota
    // driver de dongle.
    "RTL8XXXU_UNTESTED",
    // DIFERENÇA DE VERSÃO DO KERNEL, medida: no vendor (7.1.2) o menu pai
    // `SND_SOC_ROCKCHIP` não existe mais — só os filhos. No 6.12 ele existe e é
    // obrigatório: `SND_SOC_ROCKCHIP_I2S` depende dele, e sem pedir o pai o
    // filho fica travado em `=m`. O `assert-kernel-config` pegou exatamente
    // isso no primeiro build:
    //   CONFIG_SND_SOC_ROCKCHIP_I2S: pedido =y, ficou =m
    "SND_SOC_ROCKCHIP",
  ]);
  const unexpected = missing.filter((symbol) => !allowed.has(symbol));
  assert.deepEqual(unexpected, [], `símbolos inventados: ${unexpected.join(", ")}`);
});

// ── os drivers fora da árvore estão vendorizados ────────────

test("os dois drivers GPL estão no repositório, com licença", () => {
  for (const file of [
    "kernel-modules/rocknix-joypad/rocknix-singleadc-joypad.c",
    "kernel-modules/rocknix-joypad/rocknix-joypad.c",
    "kernel-modules/rocknix-joypad/CREDITS",
    "kernel-modules/generic-dsi/panel-generic-dsi.c",
  ]) {
    assert.ok(existsSync(`${DEVICE}/${file}`), `falta ${file}`);
  }
  // GPL declarada nos fontes: é o que torna legítimo trazer para cá.
  const joypad = readFileSync(`${DEVICE}/kernel-modules/rocknix-joypad/rocknix-singleadc-joypad.c`, "utf8");
  assert.match(joypad, /MODULE_LICENSE\("GPL"\)/);
});

test("a correção do joypad_input_g está declarada, não escondida", () => {
  // O vendor declara `extern struct input_dev *joypad_input_g;` e NUNCA define.
  // Compilar os dois módulos separados dá `modpost: undefined!` — e o Makefile
  // do upstream esconde isso por acidente: sem DEVICE definido, `$(filter
  // $(DEVICE), S922X RK3588)` também é vazio, `empty == empty` é verdadeiro e
  // ele compila SÓ o rocknix-joypad.o, sem nunca tocar no arquivo problemático.
  const source = readFileSync(`${DEVICE}/kernel-modules/rocknix-joypad/rocknix-singleadc-joypad.c`, "utf8");
  const hasExtern = /^extern struct input_dev \* joypad_input_g;/m.test(source);
  const hasDefinition = /^struct input_dev \*joypad_input_g;/m.test(source);
  assert.ok(
    !hasExtern || hasDefinition,
    "ou o `extern` sai, ou uma definição precisa existir — senão o modpost quebra",
  );
});

// ── encanamento de DTS fora da árvore ───────────────────────

test("o DTS chega ao build por PATCH, não por dtsPaths", () => {
  // Medido: `BR2_LINUX_KERNEL_CUSTOM_DTS_PATH` copia para
  // arch/arm64/boot/dts/ — a RAIZ (linux/linux.mk linha 504) — e o Makefile de
  // lá usa `subdir-y += rockchip`. O DTS faz `#include "...r3xs.dtsi"`, que vive
  // em rockchip/, então compilar deu:
  //   arm64/boot/dts/arm64/boot/dts/rk3326-gameconsole-r36s-giochi.dtb — sem regra
  //
  // Por isso este aparelho usa patch. O campo `dtsPaths` continua no schema
  // para quem NÃO precise de include de irmão; aqui ele não pode aparecer.
  assert.equal(device.dtsPaths, undefined, "r35s usa patch, não dtsPaths");
  assert.ok(Array.isArray(device.kernelPatches) && device.kernelPatches.length > 0);

  for (const relative of device.kernelPatches) {
    assert.ok(!relative.startsWith("/"), `caminho absoluto: ${relative}`);
    assert.ok(existsSync(`${DEVICE}/${relative}`), `patch inexistente: ${relative}`);
  }
});

test("o patch do DTS põe os arquivos em rockchip/ e registra o dtb", () => {
  const patch = readFileSync(`${DEVICE}/${device.kernelPatches[0]}`, "utf8");
  // Tem de ir para rockchip/, que é onde o Makefile da raiz procura.
  assert.match(patch, /^\+\+\+ b\/arch\/arm64\/boot\/dts\/rockchip\//m);
  // E a linha do Makefile tem de existir UMA vez: duas seriam erro de reload.
  const linhas = patch.split("\n").filter((line) => /^\+dtb-\$.*gameconsole-r36s-giochi\.dtb$/.test(line));
  assert.equal(linhas.length, 1, `linha do Makefile aparece ${linhas.length} vez(es)`);
  // O dtsi VENDOR não entra: quem fornece rk3326.dtsi/px30.dtsi é o kernel 6.12.
  assert.ok(
    !patch.includes("+++ b/arch/arm64/boot/dts/rockchip/rk3326.dtsi"),
    "rk3326.dtsi do vendor não deve sobrescrever o do mainline",
  );
});

test("o DTS do R35S chega ao build: o painel entra pelo include gerado", () => {
  const wrapper = `${DEVICE}/dts/generated/rk3326-gameconsole-r36s-giochi.dts`;
  const text = readFileSync(wrapper, "utf8");
  // O include é o ÚNICO desvio do DTS vendorizado.
  assert.match(text, /#include "panel-panel4\.dtsi"/);
  // E tem de vir DEPOIS do include do grupo, porque o painel sobrescreve o
  // `internal_display` que o grupo declara. Ordem trocada = painel ignorado.
  const includePanel = text.indexOf('#include "panel-panel4.dtsi"');
  const includeGroup = text.indexOf('#include "rk3326-device-group-r36.dtsi"');
  assert.ok(includePanel > includeGroup, "o include do painel precisa vir depois do grupo");
});

test("o dtsi do painel traz a lista de strings, não uma linha só", () => {
  const text = readFileSync(`${DEVICE}/dts/generated/panel-panel4.dtsi`, "utf8");
  const match = text.match(/panel_description = ([\s\S]*?);\n/);
  assert.ok(match, "panel_description ausente");
  const quoted = match[1].match(/"[^"]*"/g) ?? [];
  // 1 G + 3 M + 155 I + #END. O driver lê com of_property_read_string_index,
  // então uma string gigante com \n dentro seria UM elemento e ele leria lixo.
  assert.equal(quoted.length, 160, `esperava 160 strings, veio ${quoted.length}`);
  assert.ok(quoted[0].startsWith('"G size=52,70'));
  assert.equal(quoted[159], '"#END"');
});

test("o gerador reproduz o dtsi versionado", () => {
  // Se a descrição do painel mudar e ninguém regenerar, o DTS e o `.txt` passam
  // a divergir em silêncio — build verde, painel errado.
  const fresh = execFileSync(
    process.execPath,
    [`${ROOT}scripts/panel-to-dtsi.mjs`, `${DEVICE}/panels/r36s-panel4.txt`],
    { encoding: "utf8", maxBuffer: 4 << 20 },
  );
  const committed = readFileSync(`${DEVICE}/dts/generated/panel-panel4.dtsi`, "utf8");
  // Compara o corpo (o cabeçalho tem o caminho do arquivo, que não muda).
  const body = (text) => text.slice(text.indexOf("&internal_display"));
  assert.equal(body(fresh), body(committed), "regenere com panel-to-dtsi.mjs");
});

// ── o bloqueio que resta está declarado ─────────────────────

test("o device.json diz que a imagem é gerável mas NÃO bootou", () => {
  // Correção de uma afirmação errada: eu havia escrito que a imagem não podia
  // ser gerada por falta de loader. Existem rkbin PX30 (DDR + BL31) e U-Boot
  // odroid-go2. O que falta é a PROVA em hardware. O bootNotes tem de dizer as
  // duas coisas, senão alguém lê "gerável" como "funciona".
  // O bootNotes tem de dizer o ESTADO MEDIDO: para em 0x200000 com console
  // mudo. Antes dizia "não bootou"; o mais preciso é "não chega ao userspace".
  assert.match(device.bootNotes, /0x200000|mudo|console/i);
  assert.match(device.bootNotes, /odroid-go2|U-Boot|mainline/i);
  assert.equal(
    device.buildrootDefconfig,
    "giochi_r35s_defconfig",
    "o defconfig existe; o bloqueio é a prova de boot, não a configuração",
  );
});

test("os artefatos declarados existem no build, não são glob inventado", () => {
  // O `artifacts` do device.json diz o que o CI publica. Estava `["sdcard.img"]`,
  // um arquivo que este pipeline NUNCA gera — então a coleta passava sem copiar
  // o kernel nem o rootfs, e o "build OK" entregava só o U-Boot.
  assert.ok(Array.isArray(device.artifacts) && device.artifacts.length > 0);
  assert.ok(
    !device.artifacts.includes("sdcard.img"),
    "sdcard.img quem faz é make-sd-image.sh, não o build",
  );
  for (const exigido of ["Image", "rootfs.ext4"]) {
    assert.ok(device.artifacts.includes(exigido), `falta ${exigido} em artifacts`);
  }
  // O DTB tem de ser o DESTE aparelho, não o do mainline.
  const dtb = device.artifacts.find((item) => item.endsWith(".dtb"));
  assert.ok(dtb, "nenhum .dtb declarado");
  assert.match(dtb, /giochi/, `o DTB tem de ser o do painel próprio: ${dtb}`);
});

test("o defconfig liga o que o hardware medido exige", () => {
  const defconfig = readFileSync(`${DEVICE}/defconfig`, "utf8");
  // SoC errado manda o build para o lugar errado, e o sintoma é não sair do Maskrom.
  assert.match(defconfig, /^BR2_cortex_a35=y$/m, "RK3326 é Cortex-A35, não A55");
  assert.ok(!/^BR2_cortex_a55=y$/m.test(defconfig), "A55 é RK3566 — aparelho trocado");
  // Blobs do PX30, não do RK3566.
  assert.match(defconfig, /^BR2_PACKAGE_ROCKCHIP_RKBIN_TPL_FILENAME="bin\/rk33\/px30_ddr_333MHz/m);
  assert.match(defconfig, /^BR2_PACKAGE_ROCKCHIP_RKBIN_BL31_FILENAME="bin\/rk33\/px30_bl31/m);
  assert.ok(!/rk35\//.test(defconfig), "caminho rk35/ é do RK3566");
  // U-Boot do RK3326.
  assert.match(defconfig, /^BR2_TARGET_UBOOT_BOARD_DEFCONFIG="odroid-go2"$/m);
  // SEM formato de U-Boot: este board usa binman, e a regra de `u-boot.itb` só
  // existe sem ele. Pedir FORMAT_ITB dá "Sem regra para processar o alvo".
  assert.ok(
    !/^BR2_TARGET_UBOOT_FORMAT_ITB=y$/m.test(defconfig),
    "com binman o alvo u-boot.itb não existe; o hook do rkbin instala u-boot-rockchip.bin",
  );
  // DTS pelo nome que o patch registra.
  assert.match(defconfig, /^BR2_LINUX_KERNEL_INTREE_DTS_NAME="rockchip\/rk3326-gameconsole-r36s-giochi"$/m);
});

test("os dois drivers do aparelho são declarados como módulos", () => {
  // Eles não têm símbolo no Kconfig do kernel (são out-of-tree, medido: zero
  // `ROCKNIX` na config do vendor). Então o linux.fragment NÃO pode prometer
  // algo que ele não entrega — quem os constrói é um pacote, e isso ainda não
  // existe. O teste garante que ninguém "resolva" o problema inventando símbolo.
  const fragment = readFileSync(`${DEVICE}/linux.fragment`, "utf8");
  assert.ok(
    !/^CONFIG_ROCKNIX_/m.test(fragment),
    "não existe CONFIG_ROCKNIX_* no kernel — símbolo inventado seria descartado em silêncio",
  );
  // O que o fragmento PODE e DEVE garantir é o que o DTS referencia:
  // `saradc` para o multiplexador e `JOYSTICK_ADC` para o nó adc-joystick.
  assert.match(fragment, /^CONFIG_JOYSTICK_ADC=y$/m);
  assert.match(fragment, /^CONFIG_ROCKCHIP_SARADC=y$/m);
});

// ── armazenamento: medido no DTB, não suposto ───────────────

test("o R35S não tem eMMC — o controlador 8-bit está disabled", async () => {
  // O dono do projeto avisou que "alguns aparelhos têm dois slots de SD e ainda
  // eMMC". O R35S NÃO é um deles, e isso é fato do DTB que vai para o cartão:
  //   mmc@ff390000  status=disabled  bus-width=8  sem cd-gpios
  //
  // Responder "eMMC" para o R35S seria inventar layout de dados a partir de um
  // aviso sobre OUTROS aparelhos. Este teste impede a generalização.
  const { parseFdt, walkFdt } = await import("../scripts/lib/fdt.mjs");
  const dtb = `${ROOT}out/r35s/rk3326-gameconsole-r36s-giochi.dtb`;
  if (!existsSync(dtb)) return; // CI de config não builda o DTB; o build local cobre
  const raiz = parseFdt(readFileSync(dtb));
  const status = new Map();
  walkFdt(raiz, (no, caminho) => {
    if (!/^\/mmc@/.test(caminho)) return;
    const p = no.props;
    status.set(caminho, p.has("status") ? String(p.get("status")).replace(/\0+$/, "") : "(herdado)");
  });
  assert.equal(status.get("/mmc@ff390000"), "disabled", "se virar okay, há eMMC e o layout muda");
});

test("o R35S habilita DOIS controladores SD removíveis", async () => {
  // Medido: mmc@ff370000 (alias mmc0) e mmc@ff380000 (alias mmc1), os dois
  // "okay", 4 bits, com cd-gpios próprio. O U-Boot só listou um — o outro só
  // aparece com cartão enfiado.
  //
  // Consequência prática, e o motivo de estar num teste: o NÚMERO do cartão
  // depende da ordem de probe, não do conector. Um catálogo que guarde
  // `/mnt/cartao1` pode abrir o cartão errado depois de um boot. Por isso a
  // convenção proposta com a equipe do app é `/media/<LABEL>`, não `/mnt/cartaoN`.
  const { parseFdt, walkFdt } = await import("../scripts/lib/fdt.mjs");
  const dtb = `${ROOT}out/r35s/rk3326-gameconsole-r36s-giochi.dtb`;
  if (!existsSync(dtb)) return;
  const raiz = parseFdt(readFileSync(dtb));
  const removiveis = [];
  walkFdt(raiz, (no, caminho) => {
    if (!/^\/mmc@/.test(caminho)) return;
    const p = no.props;
    const ok = p.has("status") && String(p.get("status")).replace(/\0+$/, "") === "okay";
    if (ok && p.has("cd-gpios") && !p.has("non-removable")) removiveis.push(caminho);
  });
  assert.equal(removiveis.length, 2, `esperava 2 controladores com cartão: ${removiveis}`);
  assert.deepEqual(removiveis.sort(), ["/mmc@ff370000", "/mmc@ff380000"]);
});
