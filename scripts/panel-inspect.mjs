#!/usr/bin/env node
// ============================================================
// Giochi System — inspecionar overlay de painel MIPI-DSI
// ============================================================
// Uso:
//   node scripts/panel-inspect.mjs <arquivo.dtbo|arquivo.txt> [...]
//   node scripts/panel-inspect.mjs --extract <arquivo.dtbo>   # imprime o texto
//   node scripts/panel-inspect.mjs device/r35s/panels/*.txt   # tabela
//
// Existe por causa do §13-A: o R36S/R35S e os clones saem com painéis
// diferentes, e escolher o overlay errado dá tela preta SEM mensagem. Comparar
// os cinco lado a lado com números é mais confiável que trocar overlay até
// ligar — e é o que permite dizer "este aqui é o 60 Hz" em vez de "este é o
// panel4".
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  checkDeclaredRefresh,
  checkGeometry,
  defaultMode,
  parsePanelDescription,
  splitLines,
  summarize,
} from "./lib/dsi-panel.mjs";
import { parseFdt, walkFdt } from "./lib/fdt.mjs";

const DSI_PROPERTY = "panel_description";

/** Extrai a descrição de um .dtbo. Devolve null se o arquivo não for FDT. */
function descriptionFromDtbo(buffer) {
  if (buffer.length < 4 || buffer.readUInt32BE(0) !== 0xd00dfeed) return null;
  const root = parseFdt(buffer);
  let found = null;
  walkFdt(root, (node) => {
    const data = node.props.get(DSI_PROPERTY);
    if (!data) return;
    // A propriedade é uma sequência de tokens terminados em NUL. Descartar o
    // último byte evita um token vazio no fim.
    found = data.toString("utf8").replace(/\u0000+$/, "");
  });
  return found;
}

function loadPanel(path) {
  const buffer = readFileSync(path);
  const fromDtbo = descriptionFromDtbo(buffer);
  if (fromDtbo !== null) return { text: fromDtbo, origin: "dtbo" };
  // Texto salvo: uma linha por token, como o `--extract` emite.
  const text = buffer.toString("utf8");
  if (!/\bG size=/.test(text)) {
    throw new Error(`${basename(path)}: não é FDT nem panel_description em texto`);
  }
  return { text, origin: "texto" };
}

function fmt(value, digits = 2) {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function padStart(text, width) {
  return String(text).padStart(width);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("uso: node scripts/panel-inspect.mjs <arquivo> [...] [--extract] [--json]");
  process.exit(2);
}

const extract = args.includes("--extract");
const asJson = args.includes("--json");
const files = args.filter((arg) => !arg.startsWith("--"));

if (files.length === 0) {
  console.error("nenhum arquivo informado");
  process.exit(2);
}

if (extract) {
  // Emite o texto em linhas separadas para poder ser versionado e comparado
  // com `git diff` — um .dtbo binário não mostra o que mudou.
  for (const file of files) {
    const { text } = loadPanel(file);
    console.log(`# ${basename(file)}`);
    for (const line of splitLines(text)) console.log(line);
  }
  process.exit(0);
}

const rows = [];
let failed = 0;

for (const file of files) {
  const name = basename(file).replace(/^mipi-panel\.dtbo\./, "");
  try {
    const { text } = loadPanel(file);
    const panel = parsePanelDescription(text);
    const mode = defaultMode(panel);
    rows.push({ name, panel, mode });

    if (asJson) continue;

    console.log(`=== ${name} ===`);
    console.log(
      `  painel   ${panel.general.width}x${panel.general.height}  ` +
        `${panel.general.lanes} lanes  ${panel.general.format}  flags=0x${(panel.general.flags ?? 0).toString(16)}`,
    );
    console.log(`  delays   ${panel.general.delays.join(", ")} ms`);
    for (const [index, entry] of panel.modes.entries()) {
      const mark = entry.isDefault ? "*" : " ";
      const declared = entry.declaredHz === null ? "" : `  declarado ${entry.declaredHz} Hz`;
      console.log(
        `${mark} modo ${index}  ${fmt(entry.refreshHz)} Hz  ` +
          `clock ${entry.clockKhz} kHz  ${entry.hTotal}x${entry.vTotal}${declared}`,
      );
    }
    console.log(
      `  init     ${panel.counts.init} comandos, ` +
        `${panel.counts.initDelayMs} ms de espera` +
        (panel.ended ? "" : "  (SEM #END)"),
    );

    const problems = checkDeclaredRefresh(panel);
    for (const problem of problems) {
      console.log(
        `  ! modo ${problem.mode}: comentário diz ${problem.declaredHz} Hz, ` +
          `os timings dão ${fmt(problem.computedHz)} Hz ` +
          `(${(problem.drift * 100).toFixed(1)}% de diferença)`,
      );
    }
    for (const problem of checkGeometry(panel)) {
      console.log(
        `  ! geometria: size diz ${problem.size} (razão ${fmt(problem.physical)}), ` +
          `modo diz ${problem.mode} (razão ${fmt(problem.active)}) — ` +
          `${(problem.drift * 100).toFixed(0)}% de diferença`,
      );
    }
    console.log();
  } catch (error) {
    failed += 1;
    console.error(`${name}: ${error.message}`);
  }
}

if (asJson) {
  const out = rows.map((row) => {
    const summary = summarize(row.name, row.panel);
    return {
      ...summary,
      refreshHz: Number(summary.refreshHz.toFixed(2)),
      modes: row.panel.modes.map((mode) => ({
        clockKhz: mode.clockKhz,
        hTotal: mode.hTotal,
        vTotal: mode.vTotal,
        refreshHz: Number(mode.refreshHz.toFixed(2)),
        declaredHz: mode.declaredHz,
        default: mode.isDefault,
      })),
      problems: checkDeclaredRefresh(row.panel),
      geometry: checkGeometry(row.panel),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

if (rows.length > 1) {
  console.log("=== comparação (modo padrão) ===");
  const columns = ["painel", "tamanho", "clock", "htotal", "vtotal", "refresh", "modos", "init"];
  const widths = [22, 9, 10, 7, 7, 9, 6, 5];
  console.log(columns.map((c, i) => pad(c, widths[i])).join(""));
  for (const row of rows) {
    const values = [
      row.name,
      `${row.panel.general.width}x${row.panel.general.height}`,
      `${row.mode.clockKhz} kHz`,
      row.mode.hTotal,
      row.mode.vTotal,
      `${fmt(row.mode.refreshHz)} Hz`,
      row.panel.modes.length,
      row.panel.counts.init,
    ];
    console.log(values.map((v, i) => pad(v, widths[i])).join(""));
  }
  console.log();
  console.log("* = modo default. `refresh` é CALCULADO: clock ÷ (htotal × vtotal).");
}

process.exit(failed > 0 ? 1 : 0);
