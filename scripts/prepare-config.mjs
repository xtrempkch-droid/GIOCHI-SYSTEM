#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { fragments: [], overlays: [], kernelFragments: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--fragment") {
      args.fragments.push(argv[++index]);
    } else if (item === "--overlay") {
      args.overlays.push(argv[++index]);
    } else if (item === "--kernel-fragment") {
      args.kernelFragments.push(argv[++index]);
    } else if (item.startsWith("--")) {
      args[item.slice(2)] = argv[++index];
    } else {
      throw new Error(`Argumento inesperado: ${item}`);
    }
  }
  return args;
}

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setKey(lines, key, value) {
  const keyPattern = new RegExp(`^(?:${key}=|# ${key} is not set$)`);
  const filtered = lines.filter((line) => !keyPattern.test(line));
  filtered.push(value === null ? `# ${key} is not set` : `${key}=${value}`);
  return filtered;
}

function applyFragment(lines, fragmentPath) {
  const text = readFileSync(fragmentPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const notSet = line.match(/^# (BR2_[A-Za-z0-9_]+) is not set$/);
    if (notSet) {
      lines = setKey(lines, notSet[1], null);
      continue;
    }

    if (line.startsWith("#")) continue;
    const assignment = line.match(/^(BR2_[A-Za-z0-9_]+)=(.+)$/);
    if (!assignment) continue;
    lines = setKey(lines, assignment[1], assignment[2]);
  }
  return lines;
}

function currentOverlays(lines) {
  const line = lines.find((item) => item.startsWith("BR2_ROOTFS_OVERLAY="));
  if (!line) return [];
  let value = line.slice("BR2_ROOTFS_OVERLAY=".length).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  return value.split(/\s+/).filter(Boolean);
}

const args = parseArgs(process.argv.slice(2));

if (!args.config || !args.hostname) {
  console.error(
    "Uso: node scripts/prepare-config.mjs --config <arquivo> --hostname <nome> [--fragment ...] [--overlay ...] --dl-dir <dir>",
  );
  process.exit(2);
}

if (!existsSync(args.config)) {
  throw new Error(`Configuração não encontrada: ${args.config}`);
}

if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(args.hostname)) {
  throw new Error(`Hostname inválido: ${args.hostname}`);
}

// Padrão de desenvolvimento. Precisa respeitar a validação logo abaixo:
// `giochi` tinha 6 caracteres e quebrava o build no CI, onde o secret
// ROOT_PASSWORD não existe e o fallback entra em ação.
const password = String(args["root-password"] || process.env.ROOT_PASSWORD || "giochi-dev");
if (!/^[A-Za-z0-9._@-]{8,128}$/.test(password)) {
  throw new Error(
    "A senha de root deve ter 8–128 caracteres e usar apenas letras, números, ponto, hífen, underscore ou @.",
  );
}

if (!args["dl-dir"]) {
  throw new Error("--dl-dir é obrigatório.");
}

mkdirSync(args["dl-dir"], { recursive: true });

let lines = readFileSync(args.config, "utf8").split(/\r?\n/);
lines = lines.filter((line, index, all) => !(index === all.length - 1 && line === ""));

for (const fragment of args.fragments) {
  if (!fragment) continue;
  if (!existsSync(fragment)) {
    throw new Error(`Fragmento não encontrado: ${fragment}`);
  }
  lines = applyFragment(lines, fragment);
}

lines = setKey(
  lines,
  "BR2_TARGET_GENERIC_HOSTNAME",
  quote(args.hostname),
);
lines = setKey(
  lines,
  "BR2_TARGET_GENERIC_ISSUE",
  quote(args.issue || `Giochi System — ${args.hostname}`),
);
lines = setKey(lines, "BR2_TARGET_GENERIC_ROOT_PASSWD", quote(password));
lines = setKey(lines, "BR2_DL_DIR", quote(path.resolve(args["dl-dir"])));

// ccache: corta o rebuild de 1-3 h para minutos. BR2_CCACHE_USE_BASEDIR
// torna o cache independente do caminho absoluto do workspace — sem ele o
// cache do CI nunca acerta, porque cada runner monta o repo num caminho novo.
if (args["ccache-dir"]) {
  const ccacheDir = path.resolve(args["ccache-dir"]);
  mkdirSync(ccacheDir, { recursive: true });
  lines = setKey(lines, "BR2_CCACHE", "y");
  lines = setKey(lines, "BR2_CCACHE_DIR", quote(ccacheDir));
  lines = setKey(lines, "BR2_CCACHE_USE_BASEDIR", "y");
} else {
  lines = setKey(lines, "BR2_CCACHE", null);
}

const overlays = currentOverlays(lines);
for (const overlay of args.overlays) {
  if (!overlay) continue;
  if (!existsSync(overlay)) {
    throw new Error(`Overlay não encontrado: ${overlay}`);
  }
  const resolved = path.resolve(overlay);
  if (!overlays.includes(resolved)) overlays.push(resolved);
}
lines = setKey(lines, "BR2_ROOTFS_OVERLAY", quote(overlays.join(" ")));

// Fragmentos de KERNEL (símbolos `CONFIG_*`). O Buildroot exige caminho
// ABSOLUTO aqui, então a resolução acontece neste ponto — o fragmento do
// aparelho não pode escrever o próprio caminho.
//
// Sem esta linha o `linux.fragment` de um aparelho é um arquivo morto: o kernel
// compila apenas com o defconfig da arquitetura, e o hardware existe no DTS sem
// funcionar (painel, áudio, controles). Erro silencioso clássico.
const kernelFragments = [];
for (const kernelFragment of args.kernelFragments) {
  if (!kernelFragment) continue;
  if (!existsSync(kernelFragment)) {
    throw new Error(`Fragmento de kernel não encontrado: ${kernelFragment}`);
  }
  kernelFragments.push(path.resolve(kernelFragment));
}
if (kernelFragments.length > 0) {
  lines = setKey(
    lines,
    "BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES",
    quote(kernelFragments.join(" ")),
  );
}

writeFileSync(args.config, `${lines.join("\n")}\n`, "utf8");
console.log(
  `Configuração preparada: ${args.config} (host=${args.hostname}, overlays=${overlays.length}).`,
);
