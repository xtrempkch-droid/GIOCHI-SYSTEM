#!/usr/bin/env node
// `build-device.sh` roda com `set -euo pipefail`: qualquer variável referenciada
// e não definida ABORTA o script naquele ponto.
//
// Por que isto é um teste e não "cuidado ao editar": em 06/11/2026 escrevi
// `node "$REPO_ROOT/scripts/device-info.mjs"` quando a variável do script se
// chama `ROOT`. O `bash -n` passou (sintaxe é válida), o build começou, baixou e
// extraiu o Buildroot, aplicou o defconfig, montou os overlays e morreu em:
//
//   scripts/build-device.sh: linha 390: REPO_ROOT: variável não associada
//
// Ou seja: cinco minutos perdidos num erro que é verificável sem rodar nada.
// Este teste faz essa verificação.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SCRIPT = readFileSync(new URL("../scripts/build-device.sh", import.meta.url), "utf8");

/** Remove comentários para não acusar variável citada em prosa. */
function code(text) {
  return text
    .split("\n")
    .map((line) => {
      // `#` só inicia comentário quando não está entre aspas.
      let inSingle = false;
      let inDouble = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "'" && !inDouble) inSingle = !inSingle;
        else if (char === '"' && !inSingle) inDouble = !inDouble;
        else if (char === "#" && !inSingle && !inDouble && line[index - 1] !== "$") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

test("o script aborta em variável não definida (o teste faz sentido)", () => {
  assert.match(SCRIPT, /^set -euo pipefail$/m);
});

test("toda variável usada em ${...} ou $VAR está atribuída no próprio script", () => {
  const body = code(SCRIPT);

  // Nomes definidos: `VAR=`, `VAR:=`, `local VAR`, `export VAR`, e as listas.
  const assigned = new Set();
  for (const match of body.matchAll(/^\s*(?:local\s+|export\s+|declare\s+(?:-\w+\s+)?)?([A-Z_][A-Z0-9_]*)=/gm)) {
    assigned.add(match[1]);
  }
  // Arrays e atribuições com `+=`.
  for (const match of body.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\+=\(/gm)) {
    assigned.add(match[1]);
  }
  // Atribuição depois de `case`: `  arm64) ARCH_SYMBOL="BR2_aarch64" ;;`
  for (const match of body.matchAll(/\)\s*([A-Z_][A-Z0-9_]*)=/g)) {
    assigned.add(match[1]);
  }
  // `mapfile -t VAR < <(...)` e `readarray -t VAR`.
  for (const match of body.matchAll(/\b(?:mapfile|readarray)\s+(?:-\w+\s+)*([A-Z_][A-Z0-9_]*)/g)) {
    assigned.add(match[1]);
  }
  // `for VAR in` e `read VAR` também definem.
  for (const match of body.matchAll(/\bfor\s+([A-Z_][A-Z0-9_]*)\s+in\b/g)) {
    assigned.add(match[1]);
  }
  for (const match of body.matchAll(/\bread\s+(?:-\w+\s+)*([A-Z_][A-Z0-9_]*)/g)) {
    assigned.add(match[1]);
  }

  // As exceções são as que o ambiente ou o bash fornecem.
  const external = new Set([
    // Ambiente (documentadas no cabeçalho do script).
    "GIOCHI_SYSTEM_WORK_DIR",
    "GIOCHI_SYSTEM_CACHE_DIR",
    "GIOCHI_SYSTEM_CCACHE_DIR",
    "GIOCHI_SYSTEM_MIN_FREE_GB",
    "GIOCHI_SYSTEM_ABORT_FREE_GIB",
    "GIOCHI_SYSTEM_DISK_POLL_SECONDS",
    "GIOCHI_SYSTEM_GROWTH_LIMIT_MIB",
    "GIOCHI_SYSTEM_OUT_DIR",
    "GIOCHI_SYSTEM_KEEP_WORK",
    "ALLOW_DRAFT",
    "BUILDROOT_VERSION",
    "ROOT_PASSWORD",
    "JOBS",
    "PATH",
    "HOME",
    "PWD",
    "IFS",
    "TMPDIR",
    "HOSTNAME",
    // Do bash.
    "BASH_SOURCE",
    "FUNCNAME",
    "LINENO",
    "RANDOM",
    "SECONDS",
    "EUID",
    "UID",
    "PPID",
    "SHELL",
    "PS4",
    "BASH_REMATCH",
    "SECONDS",
  ]);

  const used = new Set();
  // `${VAR...}` e `${VAR}` com modificadores.
  // `${VAR:-x}`, `${VAR-x}`, `${VAR:=x}` e `${VAR=+x}` são SEGUROS com `set -u`:
  // o próprio parâmetro declara o que fazer quando está vazio. Só `${VAR}`
  // puro, `${VAR?}` e `${VAR:?}` abortam.
  for (const match of body.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:?[-=+]?)/g)) {
    if (match[2]) continue;
    used.add(match[1]);
  }
  // `$VAR` simples.
  for (const match of body.matchAll(/\$([A-Z_][A-Z0-9_]*)\b/g)) {
    used.add(match[1]);
  }

  const undeclared = [...used].filter((name) => !assigned.has(name) && !external.has(name)).sort();
  assert.deepEqual(
    undeclared,
    [],
    "variável(is) usada(s) e nunca atribuída(s) — com `set -u` isso aborta o build no meio:\n  " +
      undeclared.join("\n  "),
  );
});

test("o nome da raiz do repositório é ROOT, e REPO_ROOT não existe", () => {
  // O bug concreto, preso pelo nome: se alguém reintroduzir outro nome, este
  // teste falha apontando a linha.
  assert.match(SCRIPT, /^ROOT="\$\(cd/m);
  const body = code(SCRIPT);
  const wrong = [...body.matchAll(/.*\$\{?REPO_ROOT.*/g)].map((m) => m[0].trim());
  assert.deepEqual(wrong, [], `REPO_ROOT não existe neste script: ${wrong.join(" | ")}`);
});

// ── falha silenciosa sob `set -euo pipefail` ────────────────────────────────
//
// O teste acima pega VARIÁVEL não definida. Este pega o irmão dele: comando que
// falha e derruba o script sem mensagem, porque o erro foi para `/dev/null`.
//
// Medido no CI do commit dc030b0 (`Build qemu-aarch64`): o script imprimiu o
// cabeçalho — device, arch, work, out — e saiu com código 1 **sem mais nenhuma
// linha**. Causa: `sha256sum "$DEVICE_DIR/linux.fragment"` num aparelho que não
// tem fragmento de kernel (o `qemu-aarch64` usa o config default). Com
// `pipefail`, a atribuição devolve não-zero, e `set -e` mata o script. O
// `2>/dev/null` garantia que ninguém visse o motivo.
//
// A verificação é por EXECUÇÃO, não por texto: extrai o bloco entre os marcadores
// `giochi-system:kernel-fragment-state:{begin,end}` do próprio script e roda num
// bash real, com `set -euo pipefail`, contra dois diretórios de aparelho — um com
// fragmento, outro sem. Texto não pegaria: `bash -n` passa nos dois casos.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function extractBlock() {
  const begin = "giochi-system:kernel-fragment-state:begin";
  const end = "giochi-system:kernel-fragment-state:end";
  const lines = SCRIPT.split("\n");
  const from = lines.findIndex((line) => line.includes(begin));
  const to = lines.findIndex((line) => line.includes(end));
  assert.ok(from > 0 && to > from, "marcadores do bloco de fragmento ausentes no script");
  return lines.slice(from + 1, to).join("\n");
}

function runBlock({ withFragment }) {
  const root = mkdtempSync(join(tmpdir(), "giochi-frag-"));
  const deviceDir = join(root, "device");
  const workDir = join(root, "work");
  const buildDir = join(root, "build");
  mkdirSync(deviceDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  // Simula um kernel já configurado: é o caso em que o bloco tomaria decisão.
  mkdirSync(join(buildDir, "build", "linux-6.12"), { recursive: true });
  writeFileSync(join(buildDir, "build", "linux-6.12", ".stamp_configured"), "");

  if (withFragment) writeFileSync(join(deviceDir, "linux.fragment"), "CONFIG_FOO=y\n");

  const harness = [
    "set -euo pipefail",
    `DEVICE_DIR=${JSON.stringify(deviceDir)}`,
    `WORK_DIR=${JSON.stringify(workDir)}`,
    `BUILD_DIR=${JSON.stringify(buildDir)}`,
    "FORCE_KERNEL_REBUILD=0",
    "KERNEL_REBUILD_REASON=",
    extractBlock(),
    'printf "FORCE=%s\\n" "${FORCE_KERNEL_REBUILD}"',
    'printf "STATE=%s\\n" "$(cat "$KERNEL_FRAGMENT_STATE_FILE" 2>/dev/null || echo vazio)"',
  ].join("\n");

  return execFileSync("bash", ["-c", harness], { encoding: "utf8" });
}

test("o bloco do fragmento sobrevive a aparelho SEM linux.fragment", () => {
  // O caso exato do qemu-aarch64, que derrubou o CI.
  const output = runBlock({ withFragment: false });
  assert.match(output, /FORCE=0/, "sem fragmento não há o que comparar nem limpar");
  assert.match(output, /STATE=vazio/, "sem fragmento não se grava estado");
});

test("o bloco do fragmento limpa o kernel quando o hash muda", () => {
  // Com fragmento e kernel já configurado, o primeiro run grava estado e pede
  // rebuild — é o comportamento que existe para o §12.11 não morder.
  const output = runBlock({ withFragment: true });
  assert.match(output, /FORCE=1/, "fragmento novo com kernel já configurado pede dirclean");
  assert.match(output, /STATE=[0-9a-f]{64}/, "o hash do fragmento tem de ser gravado");
});
