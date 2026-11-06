#!/usr/bin/env node
// ============================================================
// Giochi System — gera o DTSI do painel a partir da descrição medida
// ============================================================
// Uso:
//   node scripts/panel-to-dtsi.mjs device/r35s/panels/r36s-panel4.txt
//   node scripts/panel-to-dtsi.mjs <painel.txt> --out <arquivo.dtsi>
//
// Por que isto existe: o driver `rocknix,generic-dsi` NÃO tem timing no código —
// ele lê a propriedade `panel_description` do device tree. O ROCKNIX entrega isso
// num `.dtbo` aplicado pelo U-Boot (FDTOVERLAYS). Nós não precisamos do overlay:
// o nó `panel@0` já existe no DTS base, então basta trocar o `compatible` e
// acrescentar a propriedade. Menos peça móvel no boot.
//
// Formato da propriedade, medido no código do driver
// (`of_property_count_strings` / `of_property_read_string_index`):
//
//   panel_description = "G size=52,70 ...",
//                       "M clock=29000 ...",
//                       "#END";
//
// Ou seja: **lista de strings**, uma linha por elemento. No blob isso aparece
// como NUL entre as linhas — é a mesma coisa, e é por isso que ler o `.dtbo` com
// `split("\n")` devolve tudo numa linha só.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import {
  checkDeclaredRefresh,
  checkGeometry,
  defaultMode,
  parsePanelDescription,
  splitLines,
} from "./lib/dsi-panel.mjs";

const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith("--"));
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const wrapperIndex = args.indexOf("--wrapper");
const wrapperFile = wrapperIndex >= 0 ? args[wrapperIndex + 1] : null;
const baseIndex = args.indexOf("--base");
const baseFile = baseIndex >= 0 ? args[baseIndex + 1] : null;

if (files.length === 0) {
  console.error("uso: node scripts/panel-to-dtsi.mjs <painel.txt> [--out <arquivo.dtsi>]");
  process.exit(2);
}

const source = files[0];
const lines = splitLines(readFileSync(source, "utf8"));
const panel = parsePanelDescription(lines.join("\n"));
const mode = defaultMode(panel);

/** Escapa para string de DTS: só `"` e `\` importam aqui. */
function dtsString(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const name = basename(source, ".txt");
const indent = " ".repeat(8);

const body = lines
  .map((line, index) => {
    const comma = index === lines.length - 1 ? ";" : ",";
    // A primeira linha sai na mesma linha da propriedade; as demais alinhadas.
    return index === 0 ? `${dtsString(line)}${comma}` : `${indent}${dtsString(line)}${comma}`;
  })
  .join("\n");

const warnings = [];
for (const problem of checkDeclaredRefresh(panel)) {
  warnings.push(
    `modo ${problem.mode}: comentário diz ${problem.declaredHz} Hz, timings dão ` +
      `${problem.computedHz.toFixed(2)} Hz`,
  );
}
for (const problem of checkGeometry(panel)) {
  warnings.push(
    `geometria: size diz ${problem.size}, modo diz ${problem.mode} ` +
      `(${(problem.drift * 100).toFixed(0)}% de diferença)`,
  );
}

const header = `// SPDX-License-Identifier: (GPL-2.0+ OR MIT)
// ============================================================
// GERADO — nao editar a mao.
// ============================================================
// Origem: device/r35s/panels/${name}.txt (descricao extraida do overlay
// \`mipi-panel.dtbo.${name}\` do ROCKNIX, formato \`rocknix,generic-dsi\`).
//
// Regenerar com:
//   node scripts/panel-to-dtsi.mjs device/r35s/panels/${name}.txt
//
// Painel:  ${panel.general.width}x${panel.general.height} mm fisicos, ` +
  `${panel.general.lanes} lanes, ${panel.general.format}
// Modo padrao: ${mode.active.width}x${mode.active.height} @ ${mode.refreshHz.toFixed(2)} Hz ` +
  `(clock ${mode.clockKhz} kHz, ${mode.hTotal}x${mode.vTotal})
// Sequencia de init: ${panel.counts.init} comandos, ${panel.counts.initDelayMs} ms de espera
`;

const footer = warnings.length
  ? warnings.map((text) => `// AVISO: ${text}`).join("\n") + "\n"
  : "// Conferido: refresh declarado e geometria batem.\n";

const dtsi = `${header}${footer}
&internal_display {
\t/*
\t * O DTS base declara \`gameconsole,r36s-panel\`/\`sitronix,st7703\`. Estes
\t * paineis de clone NAO seguem o ST7703: a sequencia de init e' diferente por
\t * lote, e um driver fixo acerta um lote e erra os outros. O driver generico
\t * recebe a sequencia como dado, entao aqui ela vem medida.
\t */
\tcompatible = "rocknix,generic-dsi";

\tpanel_description = ${body}
};
`;

// Wrapper: o `.dts` do aparelho com o include do painel. O DTS vendorizado é
// um `/dts-v1/` completo, então não pode ser `#include`-ado; em vez de duplicar
// 7 kB à mão (que envelhece em silêncio quando o upstream muda), o wrapper é
// gerado a partir dele.
if (wrapperFile) {
  if (!baseFile) {
    console.error("--wrapper exige --base <dts vendorizado>");
    process.exit(2);
  }
  const base = readFileSync(baseFile, "utf8");
  const includeName = basename(outFile ?? "panel.dtsi");
  const lines = base.split("\n");
  // Depois do ÚLTIMO `#include`, não do primeiro: o dts inclui o dtsi de grupo
  // por último, e a ordem de override importa (o nosso painel sobrescreve o
  // `internal_display` que o grupo declara).
  let lastInclude = -1;
  lines.forEach((line, index) => {
    if (/^\s*#include\s+"/.test(line)) lastInclude = index;
  });
  if (lastInclude < 0) {
    console.error("o DTS base não tem nenhum #include para ancorar o painel");
    process.exit(2);
  }
  lines.splice(lastInclude + 1, 0, `#include "${includeName}"`);
  const banner = `// GERADO por scripts/panel-to-dtsi.mjs -- nao editar a mao.\n` +
    `// Base: ${basename(baseFile)} (vendorizado, GPL-2.0+/MIT, ROCKNIX/JELOS).\n` +
    `// Unica diferenca: o include do painel medido (${includeName}).\n`;
  writeFileSync(wrapperFile, banner + lines.join("\n"));
  console.log(`gerado ${wrapperFile}`);
}

if (outFile) {
  writeFileSync(outFile, dtsi);
  console.log(`gerado ${outFile}`);
  console.log(`  painel   ${panel.general.width}x${panel.general.height} mm`);
  console.log(`  modo     ${mode.active.width}x${mode.active.height} @ ${mode.refreshHz.toFixed(2)} Hz`);
  console.log(`  init     ${panel.counts.init} comandos, ${panel.counts.initDelayMs} ms`);
  for (const warning of warnings) console.log(`  AVISO: ${warning}`);
} else {
  process.stdout.write(dtsi);
}
