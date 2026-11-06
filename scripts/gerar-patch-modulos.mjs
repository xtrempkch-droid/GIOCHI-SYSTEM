#!/usr/bin/env node
// ============================================================
// Giochi System — leva os drivers FORA DA ÁRVORE do ROCKNIX para dentro do kernel
// ============================================================
// Uso:
//   node scripts/gerar-patch-modulos.mjs --kernel <árvore-do-linux>   # gera os dois
//   node scripts/gerar-patch-modulos.mjs --kernel <árvore> --modulo painel
//   node scripts/gerar-patch-modulos.mjs --check                      # patch em dia?
//
// ## Por que patches, e não um pacote do Buildroot
//
// O Buildroot só copia para dentro da árvore do kernel o que vem em
// `BR2_LINUX_KERNEL_CUSTOM_DTS_PATH`, e isso vale apenas para DTS. Arquivo `.c`
// entra por patch ou por `BR2_EXTERNAL` — e uma árvore externa inteira para dois
// drivers seria desproporcional.
//
// O patch é **gerado** a partir do fonte em `device/r35s/kernel-modules/`, que
// continua sendo a fonte da verdade. Ninguém edita o patch à mão.
//
// ## Os dois drivers, e por que cada um é indispensável
//
// | Driver | `compatible` | Sem ele |
// | --- | --- | --- |
// | `rocknix-joypad` | `rocknix-singleadc-joypad` | 19 botões e 4 eixos não existem |
// | `generic-dsi` | `rocknix,generic-dsi` | **tela preta**, sistema bootando normal |
//
// Os dois são a mesma classe de defeito: o DTS declara um `compatible` e
// **nenhum driver responde**, sem uma linha de erro. O kernel não reclama de nó
// órfão. Medido nos dois casos, em 06/11/2026:
//
//   joypad: /lib/modules/6.12.0 com 1285 .ko e zero rocknix-*
//   painel: ff450000.dsi.0 criado, só `panel-simple` no barramento, sem
//           /dev/dri/card0 nenhum
//
// ## Três armadilhas que custaram um build cada
//
// 1. **Patch gerado contra árvore já patcheada** não aplica: o `a/` do diff passa
//    a conter as linhas que ele mesmo insere. O erro é `Hunk #1 FAILED`, e o
//    motivo só aparece olhando o `a/`.
// 2. **`obj-$(CONFIG_X) += foo.o` procura o `.o` no diretório do Makefile.** Se o
//    arquivo mora em subdiretório, a linha TEM de trazer o caminho
//    (`sub/foo.o`, como `stmm/tee_stmm_efi.o`).
// 3. **Dois `.c` no mesmo diretório como módulos separados** que compartilham
//    símbolo quebram no modpost (`joypad_input_g undefined`). Um variante por
//    símbolo de Kconfig, nunca os dois juntos.
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
const MODULOS_DIR = join(ROOT, "device/r35s/kernel-modules");
const PATCHES_DIR = join(ROOT, "device/r35s/patches");

// ---------------------------------------------------------------------------
// Kconfig do joypad
// ---------------------------------------------------------------------------
const JOYPAD_KCONFIG = `# SPDX-License-Identifier: GPL-2.0-only
# ============================================================
# Giochi System — joypad do ROCKNIX (fora da árvore), trazido por patch
# ============================================================
# Gerado por scripts/gerar-patch-modulos.mjs a partir de
# device/r35s/kernel-modules/rocknix-joypad/. Não edite à mão.
#
# ## Por que o símbolo se chama ODROIDGO3 num aparelho que não é Odroid
#
# Porque é o nome MEDIDO. A config do kernel do aparelho
# (device/r35s/extracted/kernel-config.gz, md5 93bf213f...) tem:
#
#   CONFIG_JOYSTICK_ODROIDGO2=y
#   CONFIG_JOYSTICK_ODROIDGO3=y
#   CONFIG_JOYSTICK_RGB20S=y
#   CONFIG_JOYSTICK_XU10=y
#
# No ROCKNIX é uma Kconfig por variante de hardware, todas servindo o mesmo par
# de fontes. Inventar outro nome quebraria a única regra que torna o fragmento
# verificável: todo símbolo pedido foi observado no aparelho.
#
# A variante do R35S é a ODROIDGO3: um canal de SARADC atrás de um multiplexador.
# O nó do DTS do vendor chama-se odroidgo3-joypad e o driver registra só
# compatible = "rocknix-singleadc-joypad".
#
# A separação em dois símbolos corrige um bug do Makefile do fornecedor: lá a
# escolha era feita por ifeq ($(DEVICE),$(filter $(DEVICE), ...)), e com DEVICE
# vazio a primeira comparação dá verdadeira — compilando a variante errada.

config JOYSTICK_ODROIDGO3
	tristate "ROCKNIX joypad, um canal SARADC com multiplexador (amux)"
	depends on ARCH_ROCKCHIP || COMPILE_TEST
	depends on IIO
	depends on PWM
	help
	  Driver do joypad dos consoles portáteis cujo botão é lido por um
	  único canal do SARADC através de um multiplexador analógico.

	  É o caso do R35S/R36S (RK3326): dezenove botões e os eixos dos
	  analógicos saem todos de um pino de ADC. O adc-joystick do mainline
	  não atende, porque exige um canal por eixo.

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
// Kconfig do painel
// ---------------------------------------------------------------------------
const PAINEL_KCONFIG = `# SPDX-License-Identifier: GPL-2.0-only
# ============================================================
# Giochi System — painel DSI genérico do ROCKNIX, trazido por patch
# ============================================================
# Gerado por scripts/gerar-patch-modulos.mjs a partir de
# device/r35s/kernel-modules/generic-dsi/. Não edite à mão.
#
# ## Por que um driver "genérico" em vez de um painel no mainline
#
# O painel do R35S é um clone chinês sem controlador nomeado. O ROCKNIX resolve
# isso descrevendo o painel em DADOS, não em código: a sequência de init (155
# comandos), a geometria e a temporização vão numa propriedade do DT chamada
# panel_description, e este driver a interpreta.
#
# A alternativa seria escrever um driver por painel. Com painel descrito em
# dados, trocar a tela é trocar o DTS — e o gerador
# scripts/panel-to-dtsi.mjs faz isso a partir do overlay .dtbo.
#
# Sem este símbolo o nó panel@0 do DTS fica órfão: o controlador DSI probe, o
# dispositivo mipi-dsi é criado, e NENHUM driver responde. Não há /dev/dri/card0,
# não há erro no dmesg, e o sintoma é tela preta com o sistema bootando normal.
# Medido no R35S em 06/11/2026.

config DRM_PANEL_GENERIC_DSI
	tristate "Generic MIPI-DSI panel with runtime description (ROCKNIX)"
	depends on DRM
	depends on DRM_MIPI_DSI
	depends on OF
	help
	  Painel MIPI-DSI cuja sequência de inicialização, geometria e
	  temporização vêm de dados no device tree (propriedade
	  panel_description) em vez de código no driver.

	  É o que permite suportar os painéis sem controlador nomeado dos
	  consoles portáteis chineses — incluindo os clones de R36S, cuja
	  descrição tem 155 comandos de init.

	  To compile this driver as a module, choose M here: the module
	  will be called panel-generic-dsi.
`;

// ---------------------------------------------------------------------------
// Tabela: cada módulo descreve ONDE entra no kernel e COMO
// ---------------------------------------------------------------------------
//
// `novos` são arquivos criados; `editar` são alterações em arquivos existentes.
// A ancoragem é por TEXTO, não por número de linha: número de linha muda com
// qualquer atualização do kernel e o patch passaria a aplicar no lugar errado.
const MODULOS = [
  {
    id: "joypad",
    patch: "0002-giochi-joypad-singleadc.patch",
    src: "rocknix-joypad",
    // Marcador que denuncia árvore já patcheada.
    marcaDePatcheado: /CONFIG_JOYSTICK_ODROIDGO|rocknix-joypad\/Kconfig/,
    novos: [
      { caminho: "drivers/input/joystick/rocknix-joypad/Kconfig", texto: JOYPAD_KCONFIG },
    ],
    copiar: [
      ["rocknix-joypad.h", "drivers/input/joystick/rocknix-joypad/rocknix-joypad.h"],
      ["rocknix-joypad.c", "drivers/input/joystick/rocknix-joypad/rocknix-joypad.c"],
      ["rocknix-singleadc-joypad.c",
        "drivers/input/joystick/rocknix-joypad/rocknix-singleadc-joypad.c"],
    ],
    editar: [
      {
        arquivo: "drivers/input/joystick/Kconfig",
        // O Kconfig de joystick termina com `endif` fechando o if INPUT_JOYSTICK.
        antesDe: { tipo: "ultimo", valor: "endif" },
        linhas: ['source "drivers/input/joystick/rocknix-joypad/Kconfig"'],
      },
      {
        arquivo: "drivers/input/joystick/Makefile",
        // Em ordem: antes de SENSEHAT.
        antesDe: { tipo: "contem", valor: "CONFIG_JOYSTICK_SENSEHAT" },
        // O caminho do subdiretório é OBRIGATÓRIO: sem ele o Kbuild procura
        // `drivers/input/joystick/rocknix-*.o` e para com "No rule to make target".
        linhas: [
          "obj-$(CONFIG_JOYSTICK_ODROIDGO3)\t+= rocknix-joypad/rocknix-singleadc-joypad.o",
          "obj-$(CONFIG_JOYSTICK_ODROIDGO2)\t+= rocknix-joypad/rocknix-joypad.o",
        ],
      },
    ],
    // Símbolos que o patch tem de declarar e ligar, para a checagem final.
    conferir: {
      kconfig: ["JOYSTICK_ODROIDGO3", "JOYSTICK_ODROIDGO2"],
      makefile: ["JOYSTICK_ODROIDGO3", "JOYSTICK_ODROIDGO2"],
      objComCaminho: /^\+obj-\$\(CONFIG_JOYSTICK_ODROIDGO[23]\)\t\+= rocknix-joypad\//m,
    },
  },
  {
    id: "painel",
    patch: "0003-giochi-painel-generic-dsi.patch",
    src: "generic-dsi",
    marcaDePatcheado: /CONFIG_DRM_PANEL_GENERIC_DSI/,
    novos: [],
    // Um único .c, direto no diretório de painéis — não precisa de subdiretório.
    copiar: [
      ["panel-generic-dsi.c", "drivers/gpu/drm/panel/panel-generic-dsi.c"],
    ],
    editar: [
      {
        arquivo: "drivers/gpu/drm/panel/Kconfig",
        // Este termina com `endmenu`, não `endif` — âncoras diferentes.
        antesDe: { tipo: "ultimo", valor: "endmenu" },
        linhas: [PAINEL_KCONFIG],
      },
      {
        arquivo: "drivers/gpu/drm/panel/Makefile",
        // DRM_PANEL_GENERIC_DSI vem depois de DSI_CM/LVDS e antes de HIMAX.
        antesDe: { tipo: "contem", valor: "CONFIG_DRM_PANEL_HIMAX_HX83102" },
        linhas: [
          "obj-$(CONFIG_DRM_PANEL_GENERIC_DSI) += panel-generic-dsi.o",
        ],
      },
    ],
    conferir: {
      kconfig: ["DRM_PANEL_GENERIC_DSI"],
      makefile: ["DRM_PANEL_GENERIC_DSI"],
      // Arquivo único no próprio diretório: sem subcaminho.
      objComCaminho: /^\+obj-\$\(CONFIG_DRM_PANEL_GENERIC_DSI\) \+= panel-generic-dsi\.o$/m,
    },
  },
];

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

let kernelDir = "";
let checkOnly = false;
let soModulo = "";

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--kernel") kernelDir = resolve(argv[++i] ?? "");
  else if (arg === "--modulo") soModulo = argv[++i] ?? "";
  else if (arg === "--check") checkOnly = true;
  else if (arg === "-h" || arg === "--help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  } else {
    console.error(`ERRO: argumento desconhecido: ${arg}`);
    process.exit(2);
  }
}

const selecionados = soModulo
  ? MODULOS.filter((m) => m.id === soModulo)
  : MODULOS;

if (selecionados.length === 0) {
  console.error(`ERRO: módulo desconhecido: ${soModulo}`);
  console.error(`Conhecidos: ${MODULOS.map((m) => m.id).join(", ")}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// --check: o patch commitado ainda bate com o fonte do driver?
// ---------------------------------------------------------------------------
// Não prova que o patch AINDA APLICA (isso é o `patch --dry-run` do teste), mas
// pega o caso que acontece de verdade: alguém corrige o driver em
// device/r35s/kernel-modules/ e esquece de regerar. Silencioso e verde.

function textoDoArquivo(mod, nome) {
  if (nome === "Kconfig") {
    return mod.id === "joypad" ? JOYPAD_KCONFIG : PAINEL_KCONFIG;
  }
  return readFileSync(join(MODULOS_DIR, mod.src, nome), "utf8");
}

if (checkOnly) {
  let falhou = 0;
  for (const mod of selecionados) {
    const outPath = join(PATCHES_DIR, mod.patch);
    let patch;
    try {
      patch = readFileSync(outPath, "utf8");
    } catch {
      console.error(`ERRO: patch não existe: ${outPath}`);
      falhou = 1;
      continue;
    }
    const desatualizados = [];
    // Conteúdo dos arquivos copiados tem de estar no patch, linha a linha.
    for (const [origem] of mod.copiar) {
      for (const linha of textoDoArquivo(mod, origem).split("\n")) {
        if (!linha) continue;
        if (!patch.includes(`+${linha}`)) {
          desatualizados.push(`${origem}: ${linha.slice(0, 60)}`);
          break;
        }
      }
    }
    if (desatualizados.length) {
      console.error(`ERRO: ${mod.patch} está desatualizado em relação ao fonte:`);
      for (const d of desatualizados) console.error(`  ${d}`);
      console.error("  Regenere: node scripts/gerar-patch-modulos.mjs --kernel <árvore>");
      falhou = 1;
      continue;
    }
    console.log(`OK: ${mod.patch} bate com o fonte do driver`);
  }
  process.exit(falhou);
}

if (!kernelDir) {
  console.error("ERRO: informe --kernel <árvore-do-linux> (ex.: o linux-6.12 do build)");
  console.error("  Ou use --check para só comparar o patch com o fonte.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Monta a/ e b/ e deixa o `diff -ruN` fazer o trabalho
// ---------------------------------------------------------------------------

/** Insere `linhas` antes da âncora pedida. Âncora por texto, nunca por número. */
function inserir(conteudo, antesDe, linhas, rotulo) {
  const arr = conteudo.replace(/\n*$/, "\n").split("\n");
  let idx = -1;
  if (antesDe.tipo === "ultimo") {
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      if (arr[i] === antesDe.valor) { idx = i; break; }
    }
  } else {
    idx = arr.findIndex((l) => l.includes(antesDe.valor));
  }
  if (idx < 0) {
    console.error(`ERRO: não achei a âncora "${antesDe.valor}" em ${rotulo}`);
    console.error("  O kernel mudou de forma? O patch precisa ser revisto.");
    process.exit(1);
  }
  return [...arr.slice(0, idx), ...linhas, ...arr.slice(idx)].join("\n");
}

for (const mod of selecionados) {
  const outPath = join(PATCHES_DIR, mod.patch);
  const srcDir = join(MODULOS_DIR, mod.src);

  // O diretório de origem tem de existir: sem ele o patch sairia vazio e o
  // build ficaria verde com o driver ausente — o defeito que isto corrige.
  try {
    readFileSync(join(srcDir, mod.copiar[0][0]));
  } catch {
    console.error(`ERRO: falta ${mod.copiar[0][0]} em ${srcDir}`);
    process.exit(2);
  }

  const tmp = mkdtempSync(join(tmpdir(), `giochi-patch-${mod.id}-`));
  const aDir = join(tmp, "a");
  const bDir = join(tmp, "b");
  mkdirSync(aDir, { recursive: true });
  mkdirSync(bDir, { recursive: true });

  // Arquivos que já existem no kernel: cópia fiel em a/, alterada em b/.
  const cache = new Map();
  const lerOriginal = (rel) => {
    if (!cache.has(rel)) {
      try {
        cache.set(rel, readFileSync(join(kernelDir, rel), "utf8"));
      } catch {
        console.error(`ERRO: não achei ${rel} em --kernel`);
        console.error("  --kernel aponta para uma árvore do Linux?");
        process.exit(2);
      }
    }
    return cache.get(rel);
  };

  let algumPatch = false;

  for (const ed of mod.editar) {
    const original = lerOriginal(ed.arquivo);

    // ## A árvore tem de estar LIMPA
    //
    // Gerar contra uma árvore já patcheada produz patch que não aplica: o `a/`
    // passa a conter as linhas que ele mesmo insere. Medido: `Hunk #1 FAILED`.
    if (mod.marcaDePatcheado.test(original)) {
      console.error(`ERRO: ${ed.arquivo} em --kernel já está patcheado (${mod.id}).`);
      console.error("  O patch gerado assim não aplica: o contexto incluiria as");
      console.error("  linhas que ele mesmo insere.");
      console.error("  Use fonte limpa, ex.: extraia de dl/linux/linux-6.12.tar.xz:");
      console.error(`    tar -xJf dl/linux/linux-6.12.tar.xz --strip-components=1 \\`);
      console.error(`        -C <dir> linux-6.12/${ed.arquivo}`);
      rmSync(tmp, { recursive: true, force: true });
      process.exit(1);
    }

    const novo = inserir(original, ed.antesDe, ed.linhas, ed.arquivo);
    algumPatch = true;

    const aPath = join(aDir, ed.arquivo);
    const bPath = join(bDir, ed.arquivo);
    mkdirSync(dirname(aPath), { recursive: true });
    mkdirSync(dirname(bPath), { recursive: true });
    writeFileSync(aPath, original);
    writeFileSync(bPath, novo);
  }

  // Arquivos novos: só em b/.
  for (const nv of mod.novos) {
    const p = join(bDir, nv.caminho);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, nv.texto);
    algumPatch = true;
  }
  for (const [origem, destino] of mod.copiar) {
    const p = join(bDir, destino);
    mkdirSync(dirname(p), { recursive: true });
    copyFileSync(join(srcDir, origem), p);
    algumPatch = true;
  }

  if (!algumPatch) {
    console.error(`ERRO: módulo ${mod.id} não produziu alteração nenhuma`);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
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

  // --- checagens baratas, que pegam falha verde ---
  let erro = 0;
  for (const destino of [
    ...mod.novos.map((n) => n.caminho),
    ...mod.copiar.map(([, d]) => d),
  ]) {
    if (!patch.includes(`b/${destino}`)) {
      console.error(`ERRO: o patch de ${mod.id} não contém ${destino}`);
      erro = 1;
    }
  }

  // Todo `obj-$(CONFIG_X)` acrescentado tem de ter um `config X` correspondente.
  // Sem esta checagem, um rename parcial gera um Makefile que referencia símbolo
  // inexistente: o Kconfig promete o módulo, o Makefile nunca o compila, e o
  // build fica verde.
  const definidos = new Set([...patch.matchAll(/^\+config ([A-Z0-9_]+)$/gm)].map((m) => m[1]));
  const referidos = new Set(
    [...patch.matchAll(/^\+obj-\$\(CONFIG_([A-Z0-9_]+)\)/gm)].map((m) => m[1]),
  );
  for (const s of mod.conferir.kconfig ?? []) {
    if (!definidos.has(s)) {
      console.error(`ERRO: ${mod.id}: Kconfig não declara ${s}`);
      erro = 1;
    }
  }
  for (const s of mod.conferir.makefile ?? []) {
    if (!referidos.has(s)) {
      console.error(`ERRO: ${mod.id}: Makefile não usa ${s}`);
      erro = 1;
    }
  }
  const orfaos = [...referidos].filter((s) => !definidos.has(s));
  if (orfaos.length) {
    console.error(`ERRO: ${mod.id}: Makefile referencia símbolo sem Kconfig: ${orfaos.join(", ")}`);
    erro = 1;
  }
  if (!mod.conferir.objComCaminho.test(patch)) {
    console.error(`ERRO: ${mod.id}: a linha do Makefile não tem o formato esperado.`);
    console.error("  Se o .o mora em subdiretório, o caminho é obrigatório:");
    console.error("  obj-$(CONFIG_X) += sub/foo.o");
    erro = 1;
  }

  if (erro) {
    console.error(`  patch deixado em ${outPath} para inspeção`);
    process.exit(1);
  }

  const linhas = patch.split("\n").length;
  console.log(`patch: ${outPath}`);
  console.log(`  ${linhas} linhas, ${(Buffer.byteLength(patch) / 1024).toFixed(1)} KiB`);
  console.log(`  OK: ${definidos.size} símbolo(s) no Kconfig, ${referidos.size} no Makefile, casados`);
}
