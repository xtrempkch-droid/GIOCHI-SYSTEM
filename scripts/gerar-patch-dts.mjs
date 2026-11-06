#!/usr/bin/env node
// ============================================================
// Giochi System — gera o patch que leva o DTS/DTSI do R35S para o kernel
// ============================================================
// Uso:
//   node scripts/gerar-patch-dts.mjs --kernel <árvore-do-linux>
//   node scripts/gerar-patch-dts.mjs --check
//
// ## Por que um gerador, e não um patch escrito à mão
//
// O `0001-giochi-system-r35s-dts-e-painel.patch` é 988 linhas e carrega quatro
// arquivos de DTS mais o registro do `.dtb` no Makefile. Ele foi feito à mão, e
// um patch à mão diverge da fonte em silêncio: alguém corrige
// `device/r35s/dts/src/*.dtsi`, esquece de regerar, e o build continua usando a
// versão velha — build verde, aparelho com o comportamento antigo. É a mesma
// família do §12.11 e do §12.39.
//
// Aqui a fonte da verdade é `device/r35s/dts/`:
//
//   dts/src/        os arquivos do vendor (GPL-2.0+/MIT, ROCKNIX/JELOS)
//   dts/generated/  o painel descrito em dados + o wrapper do aparelho
//
// O gerador monta `a/` vazio (os quatro arquivos não existem no kernel) e `b/`
// com o conteúdo, deixa o `diff -ruN` fazer o trabalho, e só altera o Makefile
// do kernel — que é o único arquivo que já existe.
//
// ## A lição que está embutida nas checagens
//
// Um DTS que compila não prova que o hardware acorda. `otg-port` com
// `status = "disabled"` compila perfeitamente e produz um aparelho cujo gadget
// fica em `not attached` para sempre — o PHY nunca é criado, porque
// `for_each_available_child_of_node` pula nó disabled. Por isso o gerador avisa
// sobre `status` de nós que o aparelho usa, em vez de só copiar texto.
// ============================================================

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DTS_SRC = join(ROOT, "device/r35s/dts/src");
const DTS_GEN = join(ROOT, "device/r35s/dts/generated");
const PATCH_OUT = join(ROOT, "device/r35s/patches/0001-giochi-system-r35s-dts-e-painel.patch");
const KERNEL_DTS_DIR = "arch/arm64/boot/dts/rockchip";
const DTB_NAME = "rk3326-gameconsole-r36s-giochi";
const WRAPPER = `${DTB_NAME}.dts`;

// Ordem fixa: o patch tem de ser byte-idêntico entre gerações, senão todo build
// parece "patch mudou" (§12.11) e o `linux-dirclean` roda sem motivo.
const FILES = [
  { origem: join(DTS_GEN, "panel-panel4.dtsi"), destino: "panel-panel4.dtsi" },
  { origem: join(DTS_SRC, "rk3326-device-group-r36.dtsi"), destino: "rk3326-device-group-r36.dtsi" },
  { origem: join(DTS_SRC, "rk3326-gameconsole-r3xs.dtsi"), destino: "rk3326-gameconsole-r3xs.dtsi" },
  { origem: join(DTS_GEN, WRAPPER), destino: WRAPPER },
];

let kernelDir = "";
let checkOnly = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--kernel") kernelDir = resolve(argv[++i] ?? "");
  else if (argv[i] === "--check") checkOnly = true;
  else if (argv[i] === "-h" || argv[i] === "--help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  } else {
    console.error(`ERRO: argumento desconhecido: ${argv[i]}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------
if (checkOnly) {
  let patch;
  try {
    patch = readFileSync(PATCH_OUT, "utf8");
  } catch {
    console.error(`ERRO: patch não existe: ${PATCH_OUT}`);
    process.exit(1);
  }
  const faltando = [];
  for (const { origem, destino } of FILES) {
    if (!existsSync(origem)) {
      faltando.push(`${destino}: fonte ausente (${origem})`);
      continue;
    }
    for (const linha of readFileSync(origem, "utf8").split("\n")) {
      if (!linha) continue;
      if (!patch.includes(`+${linha}`)) {
        faltando.push(`${destino}: ${linha.slice(0, 60)}`);
        break;
      }
    }
  }
  // As três correções que este patch precisa carregar para o aparelho funcionar.
  const obrigatorias = [
    {
      re: /^\+	u2phy_otg: otg-port \{$/m,
      msg: "o otg-port tem de estar no patch (sem PHY, o gadget fica not attached)",
    },
    {
      re: /^\+		status = "okay";$/m,
      msg: "algum nó ficou sem status=okay",
    },
    {
      re: new RegExp(`^\\+dtb-\\$\\(CONFIG_ARCH_ROCKCHIP\\) \\+= ${DTB_NAME}\\.dtb$`, "m"),
      msg: "o .dtb tem de ser registrado no Makefile, senão nunca compila",
    },
  ];
  for (const { re, msg } of obrigatorias) {
    if (!re.test(patch)) faltando.push(msg);
  }

  if (faltando.length) {
    console.error("ERRO: o patch do DTS está desatualizado em relação à fonte:");
    for (const f of faltando) console.error(`  ${f}`);
    console.error("\nRegenere: node scripts/gerar-patch-dts.mjs --kernel <árvore-do-linux>");
    process.exit(1);
  }
  console.log("OK: 0001-giochi-system-r35s-dts-e-painel.patch bate com device/r35s/dts/");
  process.exit(0);
}

if (!kernelDir) {
  console.error("ERRO: informe --kernel <árvore-do-linux>");
  console.error("  Ou use --check para só comparar o patch com a fonte.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Âncora: o Makefile do kernel, que já existe
// ---------------------------------------------------------------------------

const mkKernel = join(kernelDir, KERNEL_DTS_DIR, "Makefile");
let mkOriginal;
try {
  mkOriginal = readFileSync(mkKernel, "utf8");
} catch {
  console.error(`ERRO: não achei ${mkKernel}`);
  console.error("  --kernel aponta para uma árvore do Linux?");
  process.exit(2);
}

// Árvore já patcheada produz patch que não aplica (§12.39). Recusar.
if (new RegExp(`^dtb-\\$\\(CONFIG_ARCH_ROCKCHIP\\) \\+= ${DTB_NAME}\\.dtb$`, "m").test(mkOriginal)) {
  console.error(`ERRO: ${KERNEL_DTS_DIR}/Makefile já registra ${DTB_NAME}.dtb.`);
  console.error("  O patch gerado assim não aplica: o `a/` traria a linha que");
  console.error("  ele mesmo insere. Use fonte limpa:");
  console.error(`    tar -xJf dl/linux/linux-6.12.tar.xz --strip-components=1 \\`);
  console.error(`        -C <dir> linux-6.12/${KERNEL_DTS_DIR}/Makefile`);
  process.exit(1);
}

// A ordem alfabética importa para o patch ficar estável entre gerações.
const mkLinhas = mkOriginal.replace(/\n*$/, "\n").split("\n");
let idx = mkLinhas.findIndex((l) => l.startsWith("dtb-$(CONFIG_ARCH_ROCKCHIP) += rk3326-odroid-go2.dtb"));
if (idx < 0) {
  idx = mkLinhas.findIndex((l) => l.startsWith("dtb-$(CONFIG_ARCH_ROCKCHIP) += rk3326-"));
}
if (idx < 0) {
  console.error(`ERRO: não achei nenhum \`dtb-$(CONFIG_ARCH_ROCKCHIP) += rk3326-\` em ${KERNEL_DTS_DIR}/Makefile`);
  console.error("  O kernel mudou de forma? O patch precisa ser revisto.");
  process.exit(1);
}
idx += 1;
const mkNovo = [
  ...mkLinhas.slice(0, idx),
  `dtb-$(CONFIG_ARCH_ROCKCHIP) += ${DTB_NAME}.dtb`,
  ...mkLinhas.slice(idx),
].join("\n");

// ---------------------------------------------------------------------------
// Monta a/ e b/
// ---------------------------------------------------------------------------

// Toda fonte tem de existir antes de gerar: um arquivo ausente produziria um
// patch silenciosamente incompleto, e o kernel compilaria sem o DTS do aparelho.
for (const { origem } of FILES) {
  if (!existsSync(origem)) {
    console.error(`ERRO: fonte ausente: ${origem}`);
    process.exit(2);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "giochi-patch-dts-"));
const aDir = join(tmp, "a", KERNEL_DTS_DIR);
const bDir = join(tmp, "b", KERNEL_DTS_DIR);
mkdirSync(aDir, { recursive: true });
mkdirSync(bDir, { recursive: true });

writeFileSync(join(aDir, "Makefile"), mkOriginal);
writeFileSync(join(bDir, "Makefile"), mkNovo);
for (const { origem, destino } of FILES) {
  copyFileSync(origem, join(bDir, destino));
}

let patch = "";
try {
  patch = execFileSync("diff", ["-ruN", "a", "b"], { cwd: tmp, encoding: "utf8" });
} catch (err) {
  if (err.status !== 1) throw err; // 1 = há diferenças, é o caso normal
  patch = err.stdout;
}

// Timestamps e caminho do tmp não entram: o hash do patch é estado do build.
patch = patch.replace(/^(---|\+\+\+) (\S+)\t.*$/gm, "$1 $2");
rmSync(tmp, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Checagens que o compilador do DTC não faz
// ---------------------------------------------------------------------------
//
// Um DTS compila com o hardware errado. Estas checagens olham o SIGNIFICADO dos
// nós que já nos custaram um boot.

const problemas = [];

function statusDe(texto, label) {
  const m = new RegExp(`\\b${label}:\\s+[A-Za-z0-9_-]+\\s*\\{([\\s\\S]*?)\\n\\s*\\};`).exec(texto);
  if (!m) return null;
  const st = /status\s*=\s*"([a-z]+)"/.exec(m[1]);
  return st ? st[1] : "(ausente)";
}

const r3xs = readFileSync(join(DTS_SRC, "rk3326-gameconsole-r3xs.dtsi"), "utf8");
const wrapper = readFileSync(join(DTS_GEN, WRAPPER), "utf8");

// 1. O R35S tem UMA porta USB e ela é OTG. Sem o PHY do otg-port o gadget nunca
//    sai de `not attached` — medido em 06/11/2026.
if (statusDe(r3xs, "u2phy_otg") !== "okay") {
  problemas.push(
    "u2phy_otg (otg-port) não está status=okay: o dwc2 não recebe PHY e o " +
    "gadget fica em `not attached` com o cabo plugado",
  );
}

// 2. O nó do painel tem de apontar para o driver que existe na imagem.
if (!/compatible\s*=\s*"rocknix,generic-dsi"/.test(
  readFileSync(join(DTS_GEN, "panel-panel4.dtsi"), "utf8"),
)) {
  problemas.push(
    "o painel não usa `rocknix,generic-dsi`: sem o driver o nó fica órfão e a " +
    "tela fica preta com o sistema bootando",
  );
}

// 3. O wrapper tem de incluir o painel, senão o `internal_display` fica com o
//    compatible do vendor (st7703) e o painel4 nunca é lido.
const incluiPainel = /#include\s+"panel-panel4\.dtsi"/.test(wrapper);
if (!incluiPainel) {
  problemas.push("o wrapper não inclui panel-panel4.dtsi");
}

// 4. `dr_mode` do OTG: `peripheral` é o que funciona nesta placa.
//    Em `otg` o dwc2 espera bvalid do PHY, que não chega — medido.
const drMode = /&usb20_otg\s*\{([\s\S]*?)\n\};/.exec(r3xs);
if (!drMode) {
  problemas.push("não achei o nó &usb20_otg — o controle do USB mudou de lugar");
} else if (!/dr_mode\s*=\s*"peripheral"/.test(drMode[1])) {
  problemas.push(
    "usb20_otg sem `dr_mode = \"peripheral\"`: em modo otg o dwc2 espera " +
    "VBUS do PHY, que este aparelho não liga — usb0 fica NO-CARRIER",
  );
}

// 5. O `compatible` do aparelho: é o que identifica a placa (§12.30 — o U-Boot
//    sobrescreve /model, então `compatible` é a identidade que vale).
if (!/gameconsole,r35s/.test(wrapper)) {
  problemas.push("o wrapper não declara `gameconsole,r35s` em compatible");
}

if (problemas.length) {
  console.error("ERRO: o DTS compila mas o aparelho não funcionaria:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}

mkdirSync(dirname(PATCH_OUT), { recursive: true });
writeFileSync(PATCH_OUT, patch);

console.log(`patch: ${PATCH_OUT}`);
console.log(`  ${patch.split("\n").length} linhas, ${(Buffer.byteLength(patch) / 1024).toFixed(1)} KiB`);
console.log(`  arquivos: Makefile + ${FILES.length} DTS/DTSI`);
console.log("  OK: otg-port, painel generic-dsi, include do painel e compatible conferidos");
