#!/usr/bin/env node
// ============================================================
// Giochi System — gera o patch que leva o driver do joypad ROCKNIX para dentro
// da árvore do kernel
// ============================================================
// Uso:
//   node scripts/gerar-patch-joypad.mjs --kernel <árvore-do-linux> [--out <arq>]
//   node scripts/gerar-patch-joypad.mjs --check
//
// ## Por que um patch, e não um pacote
//
// O R35S lê **todos** os botões por um único canal SARADC através de um
// multiplexador analógico (`amux`). O `adc-joystick` do mainline não faz isso —
// ele exige um canal de ADC por eixo. Quem faz é o `rocknix-singleadc-joypad`,
// que é driver fora da árvore. Sem ele o DTS declara um nó
// `compatible = "rocknix-singleadc-joypad"` que **nenhum driver atende**: o
// aparelho boota, mostra o login e não tem botão nenhum.
//
// O Buildroot só copia para dentro da árvore do kernel o que vem em
// `BR2_LINUX_KERNEL_CUSTOM_DTS_PATH`, e isso vale apenas para DTS. Arquivo `.c`
// só entra por patch (ou por `BR2_EXTERNAL`, que seria uma árvore externa
// inteira para um driver). O patch é gerado a partir de
// `device/r35s/kernel-modules/rocknix-joypad/`, que continua sendo a fonte da
// verdade — ninguém edita o patch à mão.
//
// ## O bug do Makefile do fornecedor
//
// O Makefile original decide qual variante compilar assim:
//
//   ifeq ($(DEVICE),$(filter $(DEVICE), S922X RK3588))
//
// Com `DEVICE` vazio — que é o caso dentro do kernel — `$(filter ,...)` também
// é vazio, então a comparação dá **verdadeira** e ele compila `rocknix-joypad.o`
// mesmo quando o aparelho precisa do `singleadc`. O sintoma seria o pior tipo:
// módulo presente, `modprobe` sem erro, e nenhum botão. Por isso o patch não
// usa o Makefile do fornecedor: as duas variantes viram dois símbolos de
// Kconfig independentes.
// ============================================================

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "device/r35s/kernel-modules/rocknix-joypad");
const PATCH_OUT = join(ROOT, "device/r35s/patches/0002-giochi-joypad-singleadc.patch");

// Ordem fixa: o patch tem de ser byte-idêntico entre gerações, senão todo build
// parece "patch mudou" (§12.11) e o `linux-dirclean` roda sem motivo.
const KERNEL_SUBDIR = "drivers/input/joystick/rocknix-joypad";
const KERNEL_DIRNAME = "rocknix-joypad";
const FILES = ["Kconfig", "rocknix-joypad.h", "rocknix-joypad.c",
  "rocknix-singleadc-joypad.c"];

// ---------------------------------------------------------------------------
// Conteúdo dos arquivos que vão para dentro da árvore do kernel
// ---------------------------------------------------------------------------

const KCONFIG = `# SPDX-License-Identifier: GPL-2.0-only
# ============================================================
# Giochi System — joypad do ROCKNIX (fora da árvore), trazido por patch
# ============================================================
# Gerado por scripts/gerar-patch-joypad.mjs a partir de
# device/r35s/kernel-modules/rocknix-joypad/. Não edite à mão: edite o fonte e
# regenere.
#
# ## Por que o símbolo se chama ODROIDGO3 num aparelho que não é Odroid
#
# Porque é o nome MEDIDO, não um nome escolhido. A config do kernel do vendor,
# extraída do aparelho (\`device/r35s/extracted/kernel-config.gz\`, md5
# 93bf213f…), tem exatamente:
#
#   CONFIG_JOYSTICK_ODROIDGO2=y
#   CONFIG_JOYSTICK_ODROIDGO3=y
#   CONFIG_JOYSTICK_RGB20S=y
#   CONFIG_JOYSTICK_XU10=y
#
# Ou seja: no ROCKNIX uma Kconfig por variante de hardware, todas servindo o
# mesmo par de fontes. Inventar outro nome aqui quebraria a única regra que
# torna o fragmento verificável — "todo símbolo que pedimos foi observado no
# aparelho" (\`tests/device-r35s-port.test.mjs\`). O nome é feio; a alternativa é
# uma exceção sem prova.
#
# A variante que o R35S usa é a **ODROIDGO3** (um canal de SARADC atrás de um
# multiplexador): o nó do DTS do vendor chama-se \`odroidgo3-joypad\` e o driver
# registra só \`compatible = "rocknix-singleadc-joypad"\`.
#
# A separação em dois símbolos é a correção de um bug do Makefile do fornecedor.
# Lá a escolha era feita por \`ifeq ($(DEVICE),$(filter $(DEVICE), ...))\`, e com
# DEVICE vazio a primeira comparação dava verdadeira — compilando a variante
# errada, sem aviso. Dois símbolos de Kconfig não têm esse modo de falha.

config JOYSTICK_ODROIDGO3
	tristate "ROCKNIX joypad, um canal SARADC com multiplexador (amux)"
	depends on ARCH_ROCKCHIP || COMPILE_TEST
	depends on IIO
	depends on PWM
	help
	  Driver do joypad dos consoles portáteis cujo botão é lido por um
	  único canal do SARADC através de um multiplexador analógico.

	  É o caso do R35S/R36S (RK3326): dezesseis botões e os eixos dos
	  analógicos saem todos de um pino de ADC. O \`adc-joystick\` do
	  mainline não atende, porque exige um canal por eixo.

	  To compile this driver as a module, choose M here: the module
	  will be called rocknix-singleadc-joypad.

config JOYSTICK_ODROIDGO2
	tristate "ROCKNIX joypad, vários canais SARADC"
	depends on ARCH_ROCKCHIP || COMPILE_TEST
	depends on IIO
	depends on PWM
	help
	  Variante do mesmo driver para os aparelhos que usam um canal de
	  SARADC por eixo. Não é usada por nenhum aparelho desta árvore hoje;
	  fica declarada para não obrigar a mexer no patch quando aparecer.

	  To compile this driver as a module, choose M here: the module
	  will be called rocknix-joypad.
`;


// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

let kernelDir = "";
let checkOnly = false;
let outPath = PATCH_OUT;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--kernel") {
    kernelDir = resolve(argv[++i] ?? "");
  } else if (arg === "--out") {
    outPath = resolve(argv[++i] ?? "");
  } else if (arg === "--check") {
    checkOnly = true;
  } else if (arg === "-h" || arg === "--help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  } else {
    console.error(`ERRO: argumento desconhecido: ${arg}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// --check: o patch commitado ainda bate com o fonte do driver?
// ---------------------------------------------------------------------------
// Não prova que o patch AINDA APLICA (isso só um build prova), mas pega o caso
// que acontece de verdade: alguém corrige o driver em
// device/r35s/kernel-modules/ e esquece de regerar, e o build segue usando a
// versão velha. Silencioso e verde, exatamente a classe do §12.1.

function sourcesAsPatchBody() {
  const partes = [];
  for (const f of FILES) {
    const texto = f === "Kconfig" ? KCONFIG : readFileSync(join(SRC_DIR, f), "utf8");
    partes.push({ nome: f, texto });
  }
  return partes;
}

if (checkOnly) {
  let patch;
  try {
    patch = readFileSync(outPath, "utf8");
  } catch {
    console.error(`ERRO: patch não existe: ${outPath}`);
    console.error("  Gere com: node scripts/gerar-patch-joypad.mjs --kernel <árvore>");
    process.exit(1);
  }
  const faltando = [];
  for (const { nome, texto } of sourcesAsPatchBody()) {
    for (const linha of texto.split("\n")) {
      if (!linha) continue;
      if (!patch.includes(`+${linha}`)) {
        faltando.push(`${nome}: ${linha.slice(0, 60)}`);
        break;
      }
    }
  }
  if (faltando.length) {
    console.error("ERRO: o patch está desatualizado em relação ao fonte do driver:");
    for (const f of faltando) console.error(`  ${f}`);
    console.error("\nRegenere: node scripts/gerar-patch-joypad.mjs --kernel <árvore-do-linux>");
    process.exit(1);
  }
  console.log(`OK: ${outPath.split("/").pop()} bate com o fonte do driver`);
  process.exit(0);
}

if (!kernelDir) {
  console.error("ERRO: informe --kernel <árvore-do-linux> (ex.: o linux-6.12 do build)");
  console.error("  Ou use --check para só comparar o patch com o fonte.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Monta a/ e b/ e deixa o `diff -ruN` fazer o trabalho
// ---------------------------------------------------------------------------

const anchorKconfig = join(kernelDir, "drivers/input/joystick/Kconfig");
const anchorMakefile = join(kernelDir, "drivers/input/joystick/Makefile");
for (const a of [anchorKconfig, anchorMakefile]) {
  try {
    readFileSync(a);
  } catch {
    console.error(`ERRO: não achei ${a} — --kernel aponta para uma árvore do Linux?`);
    process.exit(2);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "giochi-patch-joypad-"));
const aDir = join(tmp, "a");
const bDir = join(tmp, "b");
for (const d of [aDir, bDir]) {
  mkdirSync(join(d, "drivers/input/joystick", KERNEL_DIRNAME), { recursive: true });
}

// --- arquivos que já existem: cópia fiel em a/, versão alterada em b/ ---
const kcOriginal = readFileSync(anchorKconfig, "utf8");
const mkOriginal = readFileSync(anchorMakefile, "utf8");

// ## A árvore tem de estar LIMPA
//
// Gerar o patch contra uma árvore que já recebeu este patch produz um patch que
// não aplica: o `a/` do diff passa a conter as linhas que nós mesmos inserimos,
// e o contexto esperado deixa de existir na fonte de verdade. Medido em
// 06/11/2026 — o hunk do `Makefile` falhou com
//
//   Hunk #1 FAILED at 31.
//   1 out of 1 hunk FAILED
//
// e o motivo só aparece se alguém olhar o `a/` do patch: ele tinha
// `obj-$(CONFIG_JOYSTICK_ROCKNIX) += rocknix-joypad.o` como CONTEXTO, linha que
// existe apenas depois de aplicar.
//
// A checagem custa uma linha e evita um build inteiro perdido.
for (const [rotulo, texto] of [["Kconfig", kcOriginal], ["Makefile", mkOriginal]]) {
  if (/rocknix-joypad\/Kconfig|CONFIG_JOYSTICK_ODROIDGO/.test(texto)) {
    console.error(`ERRO: ${rotulo} em --kernel já está patcheado.`);
    console.error("  O patch gerado assim não aplica: o contexto incluiria as");
    console.error("  linhas que ele mesmo insere.");
    console.error("  Use uma fonte limpa (ex.: extraia de dl/linux/linux-6.12.tar.xz):");
    console.error("    tar -xJf dl/linux/linux-6.12.tar.xz --strip-components=1 \\");
    console.error("        -C <dir> linux-6.12/drivers/input/joystick/{Kconfig,Makefile}");
    process.exit(1);
  }
}

// O bloco novo entra antes do `endif` final do Kconfig (o arquivo termina com
// `endif` na última linha, fechando o `if INPUT_JOYSTICK`).
const kcLinhas = kcOriginal.replace(/\n*$/, "\n").split("\n");
let idxEndif = -1;
for (let i = kcLinhas.length - 1; i >= 0; i -= 1) {
  if (kcLinhas[i] === "endif") { idxEndif = i; break; }
}
if (idxEndif < 0) {
  console.error("ERRO: não achei o `endif` final em drivers/input/joystick/Kconfig");
  console.error("  O kernel mudou de forma? O patch precisa ser revisto.");
  process.exit(1);
}
const kcNovo = [
  ...kcLinhas.slice(0, idxEndif),
  `source "${KERNEL_SUBDIR}/Kconfig"`,
  ...kcLinhas.slice(idxEndif),
].join("\n");

// No Makefile a entrada entra em ordem alfabética, antes de SENSEHAT.
const mkLinhas = mkOriginal.replace(/\n*$/, "\n").split("\n");
let idxSense = mkLinhas.findIndex((l) => l.includes("CONFIG_JOYSTICK_SENSEHAT"));
if (idxSense < 0) idxSense = mkLinhas.length - 1;
const mkNovo = [
  ...mkLinhas.slice(0, idxSense),
  'obj-$(CONFIG_JOYSTICK_ODROIDGO3)\t+= rocknix-joypad/rocknix-singleadc-joypad.o',
  'obj-$(CONFIG_JOYSTICK_ODROIDGO2)\t+= rocknix-joypad/rocknix-joypad.o',
  ...mkLinhas.slice(idxSense),
].join("\n");

writeFileSync(join(aDir, "drivers/input/joystick/Kconfig"), kcOriginal);
writeFileSync(join(bDir, "drivers/input/joystick/Kconfig"), kcNovo);
writeFileSync(join(aDir, "drivers/input/joystick/Makefile"), mkOriginal);
writeFileSync(join(bDir, "drivers/input/joystick/Makefile"), mkNovo);

// --- arquivos novos: só em b/ ---
for (const [nome, texto] of [["Kconfig", KCONFIG]]) {
  writeFileSync(join(bDir, "drivers/input/joystick", KERNEL_DIRNAME, nome), texto);
}
for (const f of ["rocknix-joypad.h", "rocknix-joypad.c", "rocknix-singleadc-joypad.c"]) {
  copyFileSync(join(SRC_DIR, f), join(bDir, "drivers/input/joystick", KERNEL_DIRNAME, f));
}

let patch = "";
try {
  patch = execFileSync("diff", ["-ruN", "a", "b"], { cwd: tmp, encoding: "utf8" });
} catch (err) {
  // diff sai com 1 quando há diferenças — é o caso normal
  if (err.status !== 1) throw err;
  patch = err.stdout;
}

// Timestamps e caminho do tmp não podem entrar no patch: o hash dele é usado
// como estado do build (§12.11) e o caminho muda a cada execução.
patch = patch.replace(/^(---|\+\+\+) (\S+)\t.*$/gm, "$1 $2");

rmSync(tmp, { recursive: true, force: true });

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, patch);

const linhas = patch.split("\n").length;
const bytes = Buffer.byteLength(patch);
console.log(`patch: ${outPath}`);
console.log(`  ${linhas} linhas, ${(bytes / 1024).toFixed(1)} KiB`);

// Verificação barata: o patch tem de conter os arquivos que ele promete.
for (const f of FILES) {
  if (!patch.includes(`b/${KERNEL_SUBDIR}/${f}`)) {
    console.error(`ERRO: o patch gerado não contém ${KERNEL_SUBDIR}/${f}`);
    process.exit(1);
  }
}
if (!patch.includes('+source "drivers/input/joystick/rocknix-joypad/Kconfig"')) {
  console.error("ERRO: o patch não liga o Kconfig do driver em drivers/input/joystick/Kconfig");
  process.exit(1);
}
if (!patch.includes("+obj-$(CONFIG_JOYSTICK_ODROIDGO3)")) {
  console.error("ERRO: o patch não liga o Makefile do driver");
  process.exit(1);
}

// Os `.o` moram num subdiretório, então a linha do Makefile TEM de trazer o
// caminho. Sem ele o Kbuild procura `drivers/input/joystick/rocknix-*.o` e
// para com um erro que não cita o patch:
//
//   make[6]: *** No rule to make target
//     'drivers/input/joystick/rocknix-singleadc-joypad.o',
//     needed by 'drivers/input/joystick/built-in.a'.  Stop.
//
// Medido em 06/11/2026. O idioma certo é `obj-$(CONFIG_X) += sub/foo.o`, como
// `stmm/tee_stmm_efi.o` em drivers/firmware/efi/Makefile.
if (!/^\+obj-\$\(CONFIG_JOYSTICK_ODROIDGO[23]\)\t\+= rocknix-joypad\//m.test(patch)) {
  console.error("ERRO: a linha do Makefile não aponta para rocknix-joypad/<arquivo>.o");
  console.error("  Sem o subdiretório o Kbuild não acha o objeto.");
  process.exit(1);
}

// Todo `obj-$(CONFIG_X)` acrescentado tem de ter um `config X` correspondente.
// Sem este teste, um rename parcial gera um Makefile que referencia símbolo
// inexistente: o Kconfig promete o módulo, o Makefile nunca o compila, e o build
// fica verde. Aconteceu na primeira versão deste gerador (a substituição trocou
// o template do Makefile e esqueceu o array que insere na árvore).
const definidos = new Set([...patch.matchAll(/^\+config ([A-Z0-9_]+)$/gm)].map((m) => m[1]));
const referidos = new Set(
  [...patch.matchAll(/^\+obj-\$\(CONFIG_([A-Z0-9_]+)\)/gm)].map((m) => m[1]),
);
const orfaos = [...referidos].filter((s) => !definidos.has(s));
if (orfaos.length) {
  console.error(`ERRO: o Makefile referencia símbolo(s) sem Kconfig: ${orfaos.join(", ")}`);
  console.error("  O Kconfig prometeria o módulo e nada seria compilado.");
  process.exit(1);
}
console.log(`  OK: ${definidos.size} símbolo(s) no Kconfig, ${referidos.size} no Makefile, todos casados`);
console.log("  OK: arquivos e ganchos de Kconfig/Makefile presentes");
