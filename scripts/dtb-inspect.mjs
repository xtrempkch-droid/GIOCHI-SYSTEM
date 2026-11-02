#!/usr/bin/env node
// Inspeciona um DTB: mostra nós e propriedades, com filtro.
//
// Existe porque nem todo aparelho expõe botões por `gpio-keys`. O R35S/R36S usa
// `rocknix-singleadc-joypad`, cujos códigos não ficam em `linux,code` como nos
// nós de teclado GPIO — então o `dtb-buttons.mjs` não os encontra, e é preciso
// olhar o nó cru.
//
// Uso:
//   node scripts/dtb-inspect.mjs arquivo.dtb                 # tudo
//   node scripts/dtb-inspect.mjs arquivo.dtb joypad          # só nós com "joypad"
//   node scripts/dtb-inspect.mjs arquivo.dtb joypad --props  # + propriedades
import { readFileSync } from "node:fs";

import { parseFdt, walkFdt } from "./lib/fdt.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const filter = args.find((a, i) => !a.startsWith("--") && i > 0);
const showProps = args.includes("--props");

if (!file) {
  console.error("Uso: node scripts/dtb-inspect.mjs <arquivo.dtb> [filtro] [--props]");
  process.exit(2);
}

const root = parseFdt(readFileSync(file));

function describe(data) {
  if (data.length === 4) return `u32 ${data.readUInt32BE(0)} (0x${data.readUInt32BE(0).toString(16)})`;
  const asText = data.toString("utf8").replace(/\0/g, "").trim();
  if (asText.length > 0 && /^[\x20-\x7e\s]+$/.test(asText)) {
    const parts = data.toString("utf8").split("\0").filter(Boolean);
    return parts.length > 1 ? `strings ${JSON.stringify(parts)}` : `"${asText}"`;
  }
  return `bytes[${data.length}] ${data.subarray(0, 16).toString("hex")}`;
}

let count = 0;
walkFdt(root, (node, path) => {
  const compat = node.props.get("compatible");
  const compatText = compat ? compat.toString("utf8").replace(/\0/g, " ").trim() : "";
  const haystack = `${path} ${compatText}`.toLowerCase();

  if (filter && !haystack.includes(filter.toLowerCase())) return;

  count += 1;
  console.log(`\n${path}${node.props.has("compatible") ? `  [${compatText}]` : ""}`);

  if (!showProps) {
    const keys = [...node.props.keys()].filter((k) => k !== "compatible");
    if (keys.length > 0) console.log(`    props: ${keys.join(", ")}`);
    return;
  }

  for (const [name, data] of node.props) {
    console.log(`    ${name} = ${describe(data)}`);
  }
});

console.log(`\n${count} nó(s)${filter ? ` com "${filter}"` : ""}`);
