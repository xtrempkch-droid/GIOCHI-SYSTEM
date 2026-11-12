#!/usr/bin/env node
// O manifesto `SHA256SUMS` de cada imagem tem de verificar.
//
// Defeito medido em 09/11/2026, na imagem do R35S recém-construída:
//
//     $ sha256sum -c SHA256SUMS
//     SHA256SUMS: FAILED
//     sha256sum: WARNING: 1 computed checksum did NOT match
//
// O `build-device.sh` fazia `rm -f SHA256SUMS` e então
// `find ... | xargs sha256sum >SHA256SUMS`. O shell cria o arquivo do redirect
// (truncado) ANTES de rodar o `find`, então ele existia — vazio — quando o
// `find` o listava. O manifesto saía com "SHA256SUMS = hash de arquivo vazio".
//
// A primeira correção (gerar em `SHA256SUMS.tmp` e renomear) trocou um defeito
// por outro: o `.tmp` também passou a ser listado, e a verificação reprovou por
// "could not be read". A que funciona captura a lista ANTES de criar arquivo.
//
// Isto é o §12.30 aplicado ao artefato: o arquivo existia, tinha as linhas
// certas e conteúdo plausível — e não servia para nada, porque ninguém o
// verificava. Um manifesto que não verifica é pior que nenhum: dá a impressão
// de integridade.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BUILD = readFileSync(new URL("../scripts/build-device.sh", import.meta.url), "utf8");

/** O bloco que gera o manifesto, copiado do script real. */
function blocoDoManifesto() {
  const ini = BUILD.indexOf('  cd "$OUT_DIR"\n  rm -f SHA256SUMS');
  if (ini < 0) throw new Error("bloco de geração do SHA256SUMS não encontrado");
  const fim = BUILD.indexOf("\n)", ini);
  return BUILD.slice(ini, fim);
}

test("o bloco do manifesto não se auto-inclui", () => {
  const bloco = blocoDoManifesto();

  // A lista tem de ser capturada ANTES de qualquer arquivo ser criado: um
  // redirect direto para SHA256SUMS cria o arquivo, e o `find` o vê.
  assert.ok(!/>SHA256SUMS\.tmp/.test(bloco),
    "temporário dentro de out/ é listado pelo find (medido: 'could not be read')");
  assert.match(bloco, /LISTA="\$\(find/, "a lista tem de ser capturada numa variável");

  // E o `find` tem de rodar antes do redirect final, na ordem do texto.
  const posFind = bloco.indexOf("LISTA=\"$(find");
  const posRedirect = bloco.indexOf(">SHA256SUMS");
  assert.ok(posFind >= 0 && posRedirect > posFind,
    "o find tem de vir antes do redirect para SHA256SUMS");
});

test("o manifesto gerado pelo bloco real verifica com sha256sum -c", () => {
  // Executa o bloco de verdade num diretório sintético. Testar o texto não
  // provaria nada: o defeito era de ORDEM de execução do shell, não de sintaxe.
  const dir = mkdtempSync(join(tmpdir(), "giochi-sums-"));
  try {
    writeFileSync(join(dir, "Image"), "kernel\n");
    writeFileSync(join(dir, "rootfs.ext4"), "rootfs\n");
    writeFileSync(join(dir, "build-info.txt"), "commit=abc\n");

    const bloco = blocoDoManifesto();
    execFileSync("bash", ["-c", `OUT_DIR=${JSON.stringify(dir)}\n${bloco}`], {
      stdio: "pipe",
    });

    const manifesto = readFileSync(join(dir, "SHA256SUMS"), "utf8");
    const linhas = manifesto.trim().split("\n");
    assert.equal(linhas.length, 3, `esperava 3 entradas, veio:\n${manifesto}`);
    assert.ok(!/SHA256SUMS$/.test(manifesto.trim()),
      "o manifesto não pode listar a si mesmo");

    // A prova final: a verificação tem de passar.
    const saida = execFileSync("sh", ["-c", "sha256sum -c SHA256SUMS 2>&1"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.ok(!/FAILED|did NOT match/.test(saida), `verificação falhou:\n${saida}`);

    // E uma alteração tem de ser detectada — senão o teste acima passaria com
    // um manifesto vazio, que também "verifica".
    writeFileSync(join(dir, "Image"), "adulterado\n");
    let reprovou = false;
    try {
      execFileSync("sh", ["-c", "sha256sum -c SHA256SUMS"], { cwd: dir, stdio: "pipe" });
    } catch {
      reprovou = true;
    }
    assert.ok(reprovou, "arquivo alterado tem de reprovar a verificação");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("as imagens em out/ que existirem verificam", () => {
  // Vale para o que está no disco agora: se uma imagem antiga já foi publicada
  // com o manifesto quebrado, este teste a acusa em vez de deixar passar.
  const raiz = fileURLToPath(new URL("../out/", import.meta.url));
  const dirs = ["r35s", "powkiddy-x55", "powkiddy-x35h"];
  for (const d of dirs) {
    const sums = join(raiz, d, "SHA256SUMS");
    if (!existsSync(sums)) continue;
    let saida = "";
    try {
      saida = execFileSync("sh", ["-c", "sha256sum -c SHA256SUMS 2>&1"], {
        cwd: join(raiz, d),
        encoding: "utf8",
      });
    } catch (e) {
      saida = String(e.stdout || "") + String(e.stderr || "");
    }
    assert.ok(!/FAILED|did NOT match/.test(saida), `out/${d}: ${saida}`);
  }
});
