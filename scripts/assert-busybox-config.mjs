#!/usr/bin/env node
// Verifica os símbolos `CONFIG_*` do fragmento de BUSYBOX contra o `.config`
// que o busybox realmente usou.
//
// Uso:
//   node scripts/assert-busybox-config.mjs --config <busybox/.config> \
//        --fragment config/common.busybox.fragment [--fragment ...]
//
// ## Por que existe
//
// `assert-config.mjs` cobre os símbolos `BR2_*` do Buildroot e
// `assert-kernel-config.mjs` cobre os `CONFIG_*` do kernel. O busybox é um
// TERCEIRO Kconfig, com o seu próprio `olddefconfig` — e não tinha gate nenhum.
//
// Medido em 08/11/2026, no `.config` real do busybox 1.36.1 do build do R35S:
//
//   `CONFIG_FEATURE_TAR_GZIP=y`   -> símbolo NÃO EXISTE (é SEAMLESS_GZ desde o
//                                    1.31); resultado: `tar xzf` não funcionava
//   `CONFIG_FEATURE_TAR_XZ=y`     -> idem (é SEAMLESS_XZ)
//   `CONFIG_FEATURE_PS_WIDE=y`    -> `depends on ... && !DESKTOP`, e DESKTOP=y:
//                                    impossível, descartado em silêncio
//   `CONFIG_FEATURE_CROND_DIR=y`  -> o símbolo é STRING, não bool
//
// Quatro linhas de um fragmento de 100+, todas no arquivo que define o "sistema
// base" de TODO aparelho, nenhuma com aviso. É exatamente a classe do §12.1:
// símbolo pedido, descartado em silêncio, build verde.
//
// A mecânica de comparação é a mesma do kernel (`lib/assert-kernel-config.mjs`)
// de propósito — a pergunta é idêntica e o código não precisa ser duplicado.
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

if (!args.config || args.fragments.length === 0) {
  console.error(
    "Uso: node scripts/assert-busybox-config.mjs --config <busybox/.config> --fragment <busybox.fragment>",
  );
  process.exit(2);
}

if (!existsSync(args.config)) {
  console.error(`ERRO: configuração do busybox não encontrada: ${args.config}`);
  process.exit(2);
}
for (const fragment of args.fragments.filter(Boolean)) {
  if (!existsSync(fragment)) {
    console.error(`ERRO: fragmento não encontrado: ${fragment}`);
    process.exit(2);
  }
}

const { requested, allowed } = collectRequested(args.fragments.filter(Boolean));
const config = readConfig(args.config);
const { missing, changed, checked } = verify(requested, config, allowed);

if (missing.length === 0 && changed.length === 0) {
  const note = allowed.size > 0 ? ` (${allowed.size} allow-drop: ${[...allowed.keys()].join(", ")})` : "";
  console.log(`assert-busybox-config: OK — ${checked} applet(s)/opção(ões) do busybox verificados${note}.`);
  process.exit(0);
}

console.error("assert-busybox-config: o busybox NÃO usou símbolos pedidos pelo fragmento.");
console.error("O applet simplesmente não existe na imagem, e nada falha até alguém");
console.error("precisar dele no aparelho — sem console, sem editor, sem tar.");
console.error("");

if (missing.length > 0) {
  console.error(`  AUSENTE no busybox (${missing.length}) — símbolo não existe nesta versão:`);
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
console.error("  1. Confira o nome no Kconfig do busybox usado:");
console.error("       make -C <busybox-dir> menuconfig   (ou grep em */Config.in)");
console.error("  2. Veja se o símbolo depende de algo desligado: `depends on` no Kconfig:");
console.error("     quase todo applet depende de outro, e `DESKTOP` derruba vários.");
console.error("  3. Se o descarte for intencional, documente no fragmento:");
console.error("       # giochi-system:allow-drop CONFIG_SIMBOLO motivo curto");
process.exit(1);
