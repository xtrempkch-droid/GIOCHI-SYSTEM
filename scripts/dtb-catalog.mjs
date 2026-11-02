#!/usr/bin/env node
// Gera um catálogo a partir de uma pasta de DTBs.
//
// Serve para a comunidade: quem tem um aparelho novo consulta o catálogo, vê o
// modelo, o driver dos botões e os códigos evdev, e cria `device/<pasta>/` sem
// precisar decodificar device tree na mão.
//
// Uso:
//   node scripts/dtb-catalog.mjs <pasta-com-dtbs> [--md saida.md] [--json saida.json]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buttonsFromFdt, parseFdt, walkFdt } from "./lib/fdt.mjs";

function str(props, name) {
  const data = props.get(name);
  if (!data) return null;
  return data.toString("utf8").replace(/\0+$/, "").trim() || null;
}

function list(props, name) {
  const data = props.get(name);
  if (!data) return [];
  return data.toString("utf8").split("\0").map((s) => s.trim()).filter(Boolean);
}

function analyse(file) {
  const root = parseFdt(readFileSync(file));
  const result = buttonsFromFdt(root);

  let joypad = null;
  let panel = null;
  let audio = null;

  walkFdt(root, (node) => {
    const compat = list(node.props, "compatible");
    if (!joypad && compat.some((c) => c.includes("joypad"))) {
      joypad = {
        driver: compat.find((c) => c.includes("joypad")),
        name: str(node.props, "joypad-name"),
      };
    }
    if (!panel && compat.some((c) => c.includes("panel"))) {
      panel = compat.filter((c) => c.includes("panel")).join(" + ");
    }
    if (!audio) {
      const card = str(node.props, "simple-audio-card,name");
      if (card) audio = card;
    }
  });

  return {
    file: path.basename(file),
    model: str(root.props, "model"),
    compatible: list(root.props, "compatible").join(" · ") || null,
    joypadDriver: joypad?.driver ?? null,
    joypadName: joypad?.name ?? null,
    panel,
    soundCard: audio,
    buttonCount: result.buttons.length,
    buttons: result.buttons.map((b) => `${b.name}=${b.symbol}`),
    unknownCodes: result.unknown.map((u) => `${u.hex} ${u.label ?? ""}`.trim()),
  };
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("Uso: node scripts/dtb-catalog.mjs <pasta> [--md saida.md] [--json saida.json]");
  process.exit(2);
}

const mdOut = args.includes("--md") ? args[args.indexOf("--md") + 1] : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".dtb"))
  .sort()
  .map((f) => path.join(dir, f));

const rows = [];
for (const file of files) {
  try {
    rows.push(analyse(file));
  } catch (error) {
    console.error(`aviso: ${path.basename(file)} ignorado (${error.message})`);
  }
}

if (jsonOut) {
  writeFileSync(jsonOut, `${JSON.stringify({ generatedAt: new Date().toISOString(), devices: rows }, null, 2)}\n`, "utf8");
  console.log(`JSON: ${jsonOut} (${rows.length} aparelho(s))`);
}

if (mdOut) {
  const lines = [
    "# Catálogo de aparelhos RK3326 — extraído de device tree",
    "",
    "Gerado por `scripts/dtb-catalog.mjs` a partir dos DTBs do release ROCKNIX.",
    "**Não editar à mão:** regenere quando o DTB de origem mudar.",
    "",
    "## Como usar",
    "",
    "1. Encontre o aparelho pela coluna `model`.",
    "2. Confira o driver dos botões — se for `rocknix-*`, ele **não está no mainline**:",
    "   sem o driver compilado, nenhum botão funciona.",
    "3. Crie `device/<pasta>/` com `device.json`, `buildroot.fragment`, `linux.fragment`,",
    "   `buttons.map` e `rootfs-overlay/` (ver [adding-a-device.md](adding-a-device.md)).",
    "4. Copie o `.dtb` para `device/<pasta>/dts/` para o build ser reproduzível.",
    "5. Confirme no aparelho com `evtest` — o DTB diz o que o kernel registra.",
    "",
    "## Aparelhos",
    "",
    "| DTB | model | driver dos botões | painel | botões |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| \`${r.file}\` | ${r.model ?? "?"} | ${r.joypadDriver ?? "gpio-keys"} | ${r.panel ?? "—"} | ${r.buttonCount} |`,
    ),
    "",
    "## Botões por aparelho",
    "",
  ];

  for (const row of rows) {
    lines.push(`### ${row.model ?? row.file}`, "", `- DTB: \`${row.file}\``);
    if (row.compatible) lines.push(`- compatible: \`${row.compatible}\``);
    if (row.joypadName) lines.push(`- joypad: \`${row.joypadName}\``);
    if (row.soundCard) lines.push(`- placa de som: \`${row.soundCard}\``);
    lines.push(`- botões (${row.buttonCount}): ${row.buttons.join(", ") || "nenhum"}`);
    if (row.unknownCodes.length > 0) lines.push(`- códigos sem nome: ${row.unknownCodes.join(", ")}`);
    lines.push("");
  }

  writeFileSync(mdOut, `${lines.join("\n")}\n`, "utf8");
  console.log(`Markdown: ${mdOut}`);
}

console.log(`Aparelhos: ${rows.length}`);
for (const row of rows) {
  console.log(`  ${row.file.padEnd(34)} ${String(row.buttonCount).padStart(3)} botões  ${row.joypadDriver ?? "-"}`);
}
