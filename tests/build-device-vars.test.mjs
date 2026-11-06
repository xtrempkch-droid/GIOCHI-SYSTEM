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
