#!/usr/bin/env node
// CLI fino sobre scripts/lib/assert-config.mjs.
// Verifica, depois do `make olddefconfig`, se os símbolos pedidos pelos
// fragmentos sobreviveram à resolução de dependências do Buildroot.
//
// Uso:
//   node scripts/assert-config.mjs --config <dotconfig> --fragment a.fragment \
//        [--fragment b.fragment] [--allow-drop SYMBOL]...
//
// Convenção para exceções justificadas, escrita no próprio fragmento:
//   # giochi-system:allow-drop BR2_ALGUM_SIMBOLO motivo curto
import { existsSync } from "node:fs";
import { describeValue, verify } from "./lib/assert-config.mjs";

function parseArgs(argv) {
  const args = { fragments: [], "allow-drop": [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--fragment") {
      args.fragments.push(argv[++index]);
    } else if (item === "--allow-drop") {
      args["allow-drop"].push(argv[++index]);
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
    "Uso: node scripts/assert-config.mjs --config <arquivo> --fragment <arquivo.fragment> [--allow-drop SYMBOL]",
  );
  process.exit(2);
}

if (!existsSync(args.config)) {
  console.error(`ERRO: configuração não encontrada: ${args.config}`);
  process.exit(2);
}

const fragments = args.fragments.filter(Boolean);
for (const fragment of fragments) {
  if (!existsSync(fragment)) {
    console.error(`ERRO: fragmento não encontrado: ${fragment}`);
    process.exit(2);
  }
}

if (fragments.length === 0) {
  console.log("assert-config: nenhum fragmento informado; nada a verificar.");
  process.exit(0);
}

const result = verify({
  configPath: args.config,
  fragments,
  allowDrop: args["allow-drop"],
});

if (result.ok) {
  const allowedNote =
    result.allowedCount > 0
      ? ` (${result.allowedCount} exceção(ões) allow-drop ignorada(s))`
      : "";
  console.log(
    `assert-config: OK — ${result.requestedCount} símbolo(s) de ${fragments.length} fragmento(s) verificados${allowedNote}.`,
  );
  process.exit(0);
}

console.error("");
console.error("assert-config: o olddefconfig descartou ou alterou símbolos pedidos.");
console.error("A imagem sairia sem o que foi configurado, então o build para aqui.");
console.error("");

if (result.missing.length) {
  console.error(
    `  DESAPARECEU (${result.missing.length}) — símbolo não existe nesta versão do Buildroot, virou legacy, ou o pai está unset:`,
  );
  for (const item of result.missing) {
    console.error(`    - ${item.symbol}`);
    console.error(`        pedido em ${item.origin}`);
  }
  console.error("");
}

if (result.disabled.length) {
  console.error(`  MUDOU DE VALOR (${result.disabled.length}) — dependência não satisfeita:`);
  for (const item of result.disabled) {
    console.error(
      `    - ${item.symbol}: pedido ${describeValue(item.requested)}, ficou ${describeValue(item.got)}`,
    );
    console.error(`        pedido em ${item.origin}`);
  }
  console.error("");
}

if (result.reverted.length) {
  console.error(
    `  REATIVADO (${result.reverted.length}) — pedimos 'is not set' e veio ligado:`,
  );
  for (const item of result.reverted) {
    console.error(`    - ${item.symbol}: ficou ${describeValue(item.got)}`);
    console.error(`        pedido em ${item.origin}`);
  }
  console.error("");
}

console.error("Como resolver:");
console.error(
  "  1. Confira o nome do símbolo (erro comum: LIBMPG123 não existe; o certo é MPG123).",
);
console.error("  2. Ligue o pai que falta: um filho só existe se o 'depends on' estiver satisfeito.");
console.error("  3. Se o descarte for intencional, documente no fragmento com:");
console.error("       # giochi-system:allow-drop BR2_SIMBOLO motivo");
process.exit(1);
