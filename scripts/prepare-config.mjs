#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
  fragments: [],
  overlays: [],
  kernelFragments: [],
  busyboxFragments: [],
  kernelPatches: [],
  dtsPaths: [],
  postBuildScripts: [],
};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--fragment") {
      args.fragments.push(argv[++index]);
    } else if (item === "--overlay") {
      args.overlays.push(argv[++index]);
    } else if (item === "--kernel-fragment") {
      args.kernelFragments.push(argv[++index]);
    } else if (item === "--busybox-fragment") {
      args.busyboxFragments.push(argv[++index]);
    } else if (item === "--post-build") {
      args.postBuildScripts.push(argv[++index]);
    } else if (item === "--kernel-patch") {
      args.kernelPatches.push(argv[++index]);
    } else if (item === "--dts-path") {
      args.dtsPaths.push(argv[++index]);
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

// BR2_ROOTFS_OVERLAY, BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES e
// BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES são listas separadas por espaço.
// Um caminho com espaço é lido como dois caminhos, e o erro que aparece cita
// só a primeira metade — nunca o espaço. Quem chama já deve ter feito o
// staging sem espaços; isto é a rede de segurança.
function rejectSpaces(label, filePath) {
  if (String(filePath).includes(" ")) {
    throw new Error(
      `${label} com espaço no caminho: ${filePath}\n` +
        "O Buildroot separa essas listas por espaço e leria dois caminhos.\n" +
        "Copie o arquivo para um diretório sem espaços (o build-device.sh faz " +
        "isso em work/<device>/) e passe esse caminho.",
    );
  }
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
    "Uso: node scripts/prepare-config.mjs --config <arquivo> --hostname <nome> [--fragment ...] [--overlay ...] [--kernel-fragment ...] [--busybox-fragment ...] [--post-build ...] --dl-dir <dir>",
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
  rejectSpaces("Overlay", overlay);
  if (!overlays.includes(resolved)) overlays.push(resolved);
}
lines = setKey(lines, "BR2_ROOTFS_OVERLAY", quote(overlays.join(" ")));

// Scripts de POST-BUILD: ACRESCENTA aos que já existem, nunca substitui.
//
// Defconfigs de placa real podem depender do próprio post-build (gerar dtb,
// copiar firmware, ajustar permissão). Sobrescrever `BR2_ROOTFS_POST_BUILD_SCRIPT`
// quebra esses aparelhos em silêncio — o build passa e o artefato da placa sai
// sem o que o post-build dela fazia. É o mesmo motivo do §7 do AGENTS sobre não
// sobrescrever post-build/post-image.
if (args.postBuildScripts.length > 0) {
  const linha = lines.find((item) => item.startsWith("BR2_ROOTFS_POST_BUILD_SCRIPT="));
  let existentes = [];
  if (linha) {
    let valor = linha.slice("BR2_ROOTFS_POST_BUILD_SCRIPT=".length).trim();
    if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1);
    existentes = valor.split(/\s+/).filter(Boolean);
  }
  for (const script of args.postBuildScripts) {
    if (!script) continue;
    if (!existsSync(script)) {
      throw new Error(`Script de post-build não encontrado: ${script}`);
    }
    // O Buildroot roda o post-build com shell; caminho com espaço vira dois
    // comandos. Mesma armadilha dos overlays (§12.6).
    rejectSpaces("Script de post-build", script);
    const resolvido = path.resolve(script);
    if (!existentes.includes(resolvido)) existentes.push(resolvido);
  }
  lines = setKey(lines, "BR2_ROOTFS_POST_BUILD_SCRIPT", quote(existentes.join(" ")));
}

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
  rejectSpaces("Fragmento de kernel", kernelFragment);
  kernelFragments.push(path.resolve(kernelFragment));
}
if (kernelFragments.length > 0) {
  lines = setKey(
    lines,
    "BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES",
    quote(kernelFragments.join(" ")),
  );
}

// Patches de KERNEL. Mesma regra de espaço dos fragmentos: BR2_LINUX_KERNEL_PATCH
// é lista separada por espaço.
const kernelPatches = [];
for (const kernelPatch of args.kernelPatches) {
  if (!kernelPatch) continue;
  if (!existsSync(kernelPatch)) {
    throw new Error(`Patch de kernel não encontrado: ${kernelPatch}`);
  }
  rejectSpaces("Patch de kernel", kernelPatch);
  kernelPatches.push(path.resolve(kernelPatch));
}
if (kernelPatches.length > 0) {
  lines = setKey(lines, "BR2_LINUX_KERNEL_PATCH", quote(kernelPatches.join(" ")));
}

// DTS fora da árvore. `BR2_LINUX_KERNEL_CUSTOM_DTS_PATH` copia os arquivos para
// dentro do kernel e compila os `.dts` de lá. É a forma de acrescentar um
// aparelho sem manter um patch com 20 kB de dtsi.
//
// Mesma regra de espaço dos outros: é lista separada por espaço (§12.6).
const dtsPaths = [];
for (const dtsPath of args.dtsPaths) {
  if (!dtsPath) continue;
  if (!existsSync(dtsPath)) {
    throw new Error(`DTS/DTSI não encontrado: ${dtsPath}`);
  }
  rejectSpaces("DTS/DTSI", dtsPath);
  dtsPaths.push(path.resolve(dtsPath));
}
if (dtsPaths.length > 0) {
  lines = setKey(lines, "BR2_LINUX_KERNEL_CUSTOM_DTS_PATH", quote(dtsPaths.join(" ")));
}

// Overrides de pacote: arquivo .mk incluído pelo Buildroot ANTES das receitas
// de pacote (`Makefile:528` vs `:531` no 2024.02) — não depois. A ordem importa:
// com `VAR = ...` na receita, um `VAR += ...` escrito aqui é apagado em silêncio,
// e é por isso que `config/package-overrides.mk` usa `override` nos casos em que
// a receita atribui com `=`. Serve para acrescentar opção a um pacote sem editar
// a árvore do Buildroot — caso do strace 6.7, que precisa de
// `--enable-bundled=yes` para compilar contra os headers do kernel 6.12.
if (args["package-override"]) {
  const override = path.resolve(args["package-override"]);
  if (!existsSync(override)) {
    throw new Error(`Arquivo de override não encontrado: ${override}`);
  }
  lines = setKey(lines, "BR2_PACKAGE_OVERRIDE_FILE", quote(override));
}

// Fragmentos de BUSYBOX (símbolos `CONFIG_*` do busybox). Mesmo motivo do
// fragmento de kernel: caminho absoluto. A utilidade prática é desligar applet
// que não compila contra os headers do kernel escolhido — o `tc` do busybox
// 1.36.1 usa TCA_CBQ_*, removido no 6.12, e derruba o build inteiro.
const busyboxFragments = [];
for (const busyboxFragment of args.busyboxFragments) {
  if (!busyboxFragment) continue;
  if (!existsSync(busyboxFragment)) {
    throw new Error(`Fragmento de busybox não encontrado: ${busyboxFragment}`);
  }
  rejectSpaces("Fragmento de busybox", busyboxFragment);
  busyboxFragments.push(path.resolve(busyboxFragment));
}
if (busyboxFragments.length > 0) {
  lines = setKey(
    lines,
    "BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES",
    quote(busyboxFragments.join(" ")),
  );
}

writeFileSync(args.config, `${lines.join("\n")}\n`, "utf8");
console.log(
  `Configuração preparada: ${args.config} (host=${args.hostname}, overlays=${overlays.length}).`,
);
