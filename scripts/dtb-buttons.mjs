#!/usr/bin/env node
// Converte um device tree (.dtb) em `buttons.map`.
//
// Uso:
//   node scripts/dtb-buttons.mjs rk3326-r35s.dtb
//   node scripts/dtb-buttons.mjs r35s.dtb --out device/r35s/buttons.map
//
// O .dtb pode vir de:
//   - /sys/firmware/fdt no aparelho (é o FDT vivo, o mais confiável)
//   - partição de boot do cartão
//   - dump do U-Boot
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buttonsFromFdt,
  missingRequired,
  parseFdt,
  renderButtonsMap,
} from "./lib/fdt.mjs";

function parseArgs(argv) {
  const args = { file: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--out") {
      args.out = argv[index + 1];
      index += 1;
    } else if (!item.startsWith("--")) {
      args.file = item;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  console.error("Uso: node scripts/dtb-buttons.mjs <arquivo.dtb> [--out buttons.map]");
  process.exit(2);
}

let buffer;
try {
  buffer = readFileSync(args.file);
} catch (error) {
  console.error(`ERRO: não consegui ler ${args.file}`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

let root;
try {
  root = parseFdt(buffer);
} catch (error) {
  console.error(`ERRO: ${args.file} não é um DTB válido`);
  console.error(`  ${error.message}`);
  console.error("");
  console.error("Se o arquivo for um .dts (texto), use o DTS direto: ele é legível");
  console.error("e o script também aceita — ver docs/button-maps.md.");
  process.exit(1);
}

const result = buttonsFromFdt(root);
const source = path.basename(args.file);

if (result.buttons.length === 0) {
  console.error(`ERRO: nenhum botão encontrado em ${source}`);
  console.error("  O device tree pode usar um driver que não expõe gpio-keys,");
  console.error("  ou os botões podem estar em outro nó. Nada foi gerado.");
  process.exit(1);
}

const map = renderButtonsMap(result, source);

if (args.out) {
  writeFileSync(args.out, map, "utf8");
  console.log(`Escrito: ${args.out}`);
} else {
  process.stdout.write(map);
}

console.log("");
console.log(`Botões: ${result.buttons.length}`);
console.log(`Eixos:  ${result.axes.length}`);
for (const axis of result.axes) {
  console.log(`  ${axis.symbol} faixa ${axis.min}..${axis.max}${axis.flat ? ` flat ${axis.flat}` : ""}`);
}

const missing = missingRequired(result);
if (missing.length > 0) {
  console.log("");
  console.log(`AVISO: faltam do contrato do launcher: ${missing.join(", ")}`);
  if (missing.includes("home")) {
    console.log("  `home` é opcional — o X55 também não tem (ver docs/button-maps.md).");
  }
}

if (result.unknown.length > 0) {
  console.log("");
  console.log(`AVISO: ${result.unknown.length} código(s) sem nome lógico — revisar o mapa:`);
  for (const item of result.unknown) {
    console.log(`  ${item.hex} ${item.label ?? ""} em ${item.node}`);
  }
}
