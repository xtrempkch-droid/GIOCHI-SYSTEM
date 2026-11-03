#!/usr/bin/env node
// Verifica os símbolos `CONFIG_*` do fragmento do kernel contra o `.config`
// que o kernel realmente usou.
//
// Uso:
//   node scripts/assert-kernel-config.mjs --config <linux/.config> \
//        --fragment device/<pasta>/linux.fragment \
//        [--required device/<pasta>/kernel-required.txt]
//
// Sai 1 quando algum símbolo sumiu ou mudou de valor, e nesse caso o build
// precisa falhar: símbolo de painel/console/MMC ausente produz imagem que não
// boota, sem uma linha de erro.
import { existsSync } from "node:fs";
import { collectRequested, readConfig, verify } from "./lib/assert-kernel-config.mjs";

function parseArgs(argv) {
  const args = { fragments: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--fragment") {
      args.fragments.push(argv[++index]);
    } else if (item.startsWith("--")) {
      args[item.slice(2)] = argv[++index];
    } else {
      throw new Error(`Argumento inesperado: ${item}`);
    }
  }
  return args;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(2);
}

if (!args.config) {
  console.error(
    "Uso: node scripts/assert-kernel-config.mjs --config <linux/.config> --fragment <linux.fragment>",
  );
  process.exit(2);
}

if (!existsSync(args.config)) {
  console.error(`ERRO: configuração do kernel não encontrada: ${args.config}`);
  process.exit(2);
}

const fragments = args.fragments.filter(Boolean);
if (fragments.length === 0 && !args.required) {
  console.error("ERRO: informe ao menos um --fragment ou --required.");
  process.exit(2);
}
for (const fragment of fragments) {
  if (!existsSync(fragment)) {
    console.error(`ERRO: fragmento não encontrado: ${fragment}`);
    process.exit(2);
  }
}

const { requested, allowed } = collectRequested(fragments);
const config = readConfig(args.config);

// `--required` é a lista do que o aparelho PRECISA ter, independentemente de
// quem pediu. O fragmento é delta do defconfig; símbolo que vem do defconfig
// não aparece nele e, sem esta lista, ninguém notaria se sumisse.
if (args.required) {
  if (!existsSync(args.required)) {
    console.error(`ERRO: lista de obrigatórios não encontrada: ${args.required}`);
    process.exit(2);
  }
  const required = collectRequested([args.required]).requested;
  for (const [symbol, item] of required) {
    if (!requested.has(symbol)) requested.set(symbol, item);
  }
}

const { missing, changed, checked } = verify(requested, config, allowed);

if (missing.length === 0 && changed.length === 0) {
  const note = allowed.size > 0 ? ` (${allowed.size} allow-drop: ${[...allowed.keys()].join(", ")})` : "";
  console.log(`assert-kernel-config: OK — ${checked} símbolo(s) do kernel verificados${note}.`);
  process.exit(0);
}

console.error("assert-kernel-config: o kernel NÃO usou símbolos pedidos pelo fragmento.");
console.error("A imagem sairia sem o hardware configurado, então o build para aqui.");
console.error("");

if (missing.length > 0) {
  console.error(`  AUSENTE no kernel (${missing.length}) — símbolo não existe nesta versão:`);
  for (const item of missing) {
    console.error(`    - ${item.symbol}: pedido =${item.expected}`);
    console.error(`        pedido em ${item.origin}`);
  }
}
if (changed.length > 0) {
  console.error(`  VALOR DIFERENTE (${changed.length}) — dependência não satisfeita:`);
  for (const item of changed) {
    console.error(
      `    - ${item.symbol}: pedido =${item.expected}, ficou ${item.actual === null ? "is not set" : `=${item.actual}`}`,
    );
    console.error(`        pedido em ${item.origin}`);
  }
}

console.error("");
console.error("Como resolver:");
console.error("  1. Confira o nome no Kconfig do kernel usado (make -C linux nconfig).");
console.error("  2. Ligue o pai que falta: filho sem 'depends on' satisfeito some.");
console.error("  3. Se o descarte for intencional (driver fora da árvore, símbolo");
console.error("     removido), documente no fragmento:");
console.error("       # giochi-system:allow-drop CONFIG_SIMBOLO motivo curto");
process.exit(1);
