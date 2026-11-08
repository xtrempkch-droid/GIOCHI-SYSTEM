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

/**
 * Remove comentários para não acusar variável citada em prosa — e o conteúdo de
 * heredoc CITADO (\`<<'EOF'\`), que o shell não expande.
 *
 * Sem isto o teste acusa falso positivo: um heredoc citado é TEXTO LITERAL, e
 * `$STAGING_DIR` dentro dele não é expansão do script. É o caso do bloco que o
 * build-device.sh anexa ao `environment-setup` do SDK, onde `$STAGING_DIR` é
 * uma variável do arquivo GERADO, não deste script.
 */
function code(text) {
  const semHeredoc = [];
  let marcador = null;
  for (const line of text.split("\n")) {
    if (marcador) {
      if (line.trim() === marcador) marcador = null;
      semHeredoc.push("");     // dentro do heredoc: não é código deste script
      continue;
    }
    // `<<'EOF'` ou `<<"EOF"` → não expande. `<<EOF` (sem aspas) expande, e aí
    // o conteúdo TEM de ser analisado.
    const abre = line.match(/<<-?\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (abre) marcador = abre[2];
    semHeredoc.push(line);
  }
  return semHeredoc
    .join("\n")
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

// ── estado dos PATCHES: sem morte silenciosa ────────────────────────────────
//
// Irmão do teste acima, na linha logo antes dele. A versão original era
//
//   CURRENT_PATCHES="$(... | xargs -r -d '\n' -I{} sha256sum {} 2>/dev/null | ...)"
//
// e tinha três defeitos, medidos em 08/11/2026:
//
//   1. `sha256sum` num arquivo ausente devolve não-zero, o `xargs` devolve 123, e
//      com `set -euo pipefail` a ATRIBUIÇÃO derruba o script ali mesmo — antes
//      do cabeçalho, sem uma linha de diagnóstico (a mesma família do §12.53);
//   2. o `2>/dev/null` escondia justamente a mensagem que diria qual arquivo
//      faltou;
//   3. só o KERNEL era hasheado — `uboot-patches/` e `uboot.fragment` tinham o
//      mesmo problema do §12.11 e ninguém detectava.
//
// Como no teste do fragmento, a verificação é por EXECUÇÃO: extrai o bloco entre
// `giochi-system:patch-state:{begin,end}` e roda num bash real. `bash -n` passa
// nos dois casos, então sintaxe nunca ia pegar.
const PATCH_BEGIN = "giochi-system:patch-state:begin";
const PATCH_END = "giochi-system:patch-state:end";

function extractPatchBlock() {
  const lines = SCRIPT.split("\n");
  const from = lines.findIndex((line) => line.includes(PATCH_BEGIN));
  const to = lines.findIndex((line) => line.includes(PATCH_END));
  assert.ok(from > 0 && to > from, "marcadores do bloco de patches ausentes no script");
  return lines.slice(from + 1, to).join("\n");
}

test("o estado dos patches falha ALTO quando um patch não existe", () => {
  const root = mkdtempSync(join(tmpdir(), "giochi-patch-"));
  const workDir = join(root, "work");
  const buildDir = join(root, "build");
  mkdirSync(workDir, { recursive: true });
  mkdirSync(buildDir, { recursive: true });

  const harness = [
    "set -euo pipefail",
    `ROOT=${JSON.stringify(process.cwd())}`,
    'DEVICE_ID="r35s"',
    `DEVICE_DIR=${JSON.stringify(join(process.cwd(), "device", "r35s"))}`,
    `WORK_DIR=${JSON.stringify(workDir)}`,
    `BUILD_DIR=${JSON.stringify(buildDir)}`,
    "FORCE_KERNEL_REBUILD=0",
    "FORCE_UBOOT_REBUILD=0",
    "KERNEL_REBUILD_REASON=",
    // Um caminho que não existe: é o caso que matava o script em silêncio.
    `FANTASMA=${JSON.stringify(join(root, "nao-existe.patch"))}`,
    extractPatchBlock(),
    `SAIDA="$( { printf '%s\\n' "$FANTASMA" | hash_entradas; } 2>&1 )" || ESTADO=$?`,
    'printf "ESTADO=%s\\n" "${ESTADO:-0}"',
    'printf "MSG=%s\\n" "$SAIDA"',
  ].join("\n");

  // `execFileSync` lança quando o filho sai não-zero; aqui o harness captura o
  // status por conta própria, então o exit é 0 e a saída traz os dois campos.
  const output = execFileSync("bash", ["-c", harness], { encoding: "utf8" });
  assert.match(output, /ESTADO=2/, "tem de sair com status próprio, não com 123 do xargs");
  assert.match(
    output,
    /MSG=ERRO: patch declarado não existe: .*nao-existe\.patch/,
    "a mensagem tem de dizer QUAL arquivo faltou — era o que o 2>/dev/null comia",
  );
});

test("o estado dos patches cobre o aparelho real e muda quando o conteúdo muda", () => {
  const root = mkdtempSync(join(tmpdir(), "giochi-patch2-"));
  const workDir = join(root, "work");
  const buildDir = join(root, "build");
  mkdirSync(workDir, { recursive: true });
  mkdirSync(join(buildDir, "build", "linux-6.12"), { recursive: true });
  writeFileSync(join(buildDir, "build", "linux-6.12", ".stamp_patched"), "");

  const a = join(root, "a.patch");
  const b = join(root, "b.patch");
  writeFileSync(a, "conteudo A\n");
  writeFileSync(b, "conteudo B\n");

  const harness = [
    "set -euo pipefail",
    `ROOT=${JSON.stringify(process.cwd())}`,
    'DEVICE_ID="r35s"',
    `DEVICE_DIR=${JSON.stringify(join(process.cwd(), "device", "r35s"))}`,
    `WORK_DIR=${JSON.stringify(workDir)}`,
    `BUILD_DIR=${JSON.stringify(buildDir)}`,
    "FORCE_KERNEL_REBUILD=0",
    "FORCE_UBOOT_REBUILD=0",
    "KERNEL_REBUILD_REASON=",
    `A=${JSON.stringify(a)}`,
    `B=${JSON.stringify(b)}`,
    extractPatchBlock(),
    'printf "DO_APARELHO=%s\\n" "$CURRENT_PATCHES"',
    'printf "STATE_FILE=%s\\n" "$(cat "$PATCH_STATE_FILE" 2>/dev/null || echo vazio)"',
    'printf "FORCE=%s\\n" "$FORCE_KERNEL_REBUILD"',
    'printf "H1=%s\\n" "$(printf "%s\\n" "$A" | hash_entradas)"',
    'printf "AB=%s\\n" "$(printf "%s\\n%s\\n" "$A" "$B" | hash_entradas)"',
    'printf "SEM_ENTRADA=[%s]\\n" "$(printf "" | hash_entradas)"',
  ].join("\n");

  const output = execFileSync("bash", ["-c", harness], { encoding: "utf8" });
  // O r35s declara 3 patches de kernel: o hash do conjunto não pode sair vazio.
  const doAparelho = (output.match(/DO_APARELHO=(.*)/)?.[1] ?? "").trim();
  const hashes = doAparelho.split(/\s+/).filter(Boolean);
  assert.ok(hashes.length >= 3, `3 patches = pelo menos 3 hashes; veio "${doAparelho}"`);
  for (const h of hashes) assert.match(h, /^[0-9a-f]{64}$/);
  // Primeiro run com stamp existente: pede dirclean, como o do fragmento.
  assert.match(output, /FORCE=1/, "primeiro run com kernel já patcheado pede dirclean");
  assert.match(output, /STATE_FILE=[0-9a-f]{64}/, "o estado tem de ficar gravado");
  // Ordem e conteúdo: o hash de cada arquivo entra no conjunto.
  const ab = (output.match(/AB=(.*)/)?.[1] ?? "").trim();
  const h1 = (output.match(/H1=(.*)/)?.[1] ?? "").trim();
  assert.match(h1, /^[0-9a-f]{64}$/, "hash de um arquivo só");
  assert.ok(ab.includes(h1), "o hash de cada arquivo entra no conjunto");
  assert.match(output, /SEM_ENTRADA=\[\]/, "lista vazia não pode virar linha em branco");
});

// ── `out/` só é limpo depois do build dar certo ─────────────────────────────
//
// O script apagava `out/<device>/` no começo. Num projeto cujo build leva 1–3 h,
// um build que falha no `make` (ou no `assert-config`, ou no `assert-kernel`)
// levava junto a última imagem que funcionava — e o `out/_anterior-x55-…` que
// está na documentação foi criado À MÃO por causa disso.
//
// Nada é escrito em `out/` antes da coleta, então adiar a limpeza não muda mais
// nada do build; o que muda é o estado depois de uma falha.
test("o build não apaga o artefato anterior antes de compilar", () => {
  const linhas = SCRIPT.split("\n");
  const limpezas = linhas
    .map((linha, indice) => ({ linha: linha.trim(), indice }))
    .filter(({ linha }) => /^rm -rf "\$OUT_DIR"$/.test(linha));
  assert.equal(limpezas.length, 1, "deve haver exatamente uma limpeza de out/");

  const make = linhas.findIndex((linha) => /^make -C "\$BR2_DIR" O="\$BUILD_DIR"/.test(linha.trim()));
  assert.ok(make > 0, "não achei a chamada do make");
  assert.ok(
    limpezas[0].indice > make,
    "a limpeza de out/ voltou para antes do make: um build que falha apaga a imagem boa",
  );
});
