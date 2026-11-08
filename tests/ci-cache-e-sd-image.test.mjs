import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// CACHE DO CI — o caminho que o workflow salva tem de ser o que o script usa.
//
// Medido em 08/11/2026: o workflow salvava `.cache/downloads` e
// `.cache/buildroot-dl`, e o `build-device.sh` escreve em
// `$GIOCHI_SYSTEM_CACHE_DIR/dl` (`BUILDROOT_DL_DIR="$CACHE_ROOT/dl"`, passado como
// `--dl-dir`). O cache era salvo e restaurado VAZIO, e todo build baixava o
// tarball do Buildroot e todos os pacotes de novo — sem erro, sem aviso, só
// lento. É a mesma família do §12.29: o símbolo certo e nenhum efeito.
//
// O teste amarra os dois lados: não basta o workflow citar `dl`, ele tem de
// citar o caminho que o script realmente usa.

const WORKFLOW = path.join(ROOT, ".github/workflows/build-linux-arm64.yml");

test("o cache do CI aponta para o diretório que o build usa (dl, não buildroot-dl)", async () => {
  const workflow = await readFile(WORKFLOW, "utf8");
  // Sem os comentários: o próprio bloco explica o nome antigo, e um comentário
  // não é caminho salvo pelo `actions/cache`.
  const efetivo = workflow
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("#"))
    .join("\n");
  const build = await readFile(path.join(ROOT, "scripts/build-device.sh"), "utf8");

  const dlDoBuild = build.match(/BUILDROOT_DL_DIR="\$CACHE_ROOT\/([A-Za-z0-9_.-]+)"/);
  assert.ok(dlDoBuild, "BUILDROOT_DL_DIR não é mais derivado de $CACHE_ROOT");
  const relativo = `.cache/${dlDoBuild[1]}`;

  assert.ok(
    efetivo.includes(relativo),
    `o workflow não salva "${relativo}", que é o BR2_DL_DIR do build`,
  );
  assert.ok(
    !/\.cache\/buildroot-dl/.test(efetivo),
    "`.cache/buildroot-dl` não é usado por nenhum script — cache sempre vazio",
  );
});

test("os docs citam o mesmo caminho de cache do workflow", async () => {
  // Documento que diverge do código é uma segunda fonte da verdade, e aqui a
  // divergência custou builds frios: quem lesse `docs/github-actions.md`
  // procuraria o cache no lugar errado.
  for (const doc of ["docs/github-actions.md", "docs/security.md"]) {
    const texto = await readFile(path.join(ROOT, doc), "utf8");
    assert.ok(
      !/\.cache\/buildroot-dl/.test(texto),
      `${doc} ainda cita .cache/buildroot-dl`,
    );
    assert.match(texto, /\.cache\/dl/, `${doc} precisa citar .cache/dl`);
  }
});

// ── DTB da imagem de cartão ────────────────────────────────────────────────
//
// `make-sd-image.sh` tinha `DTB_NAME="${DTB_NAME:-rk3566-powkiddy-x55}"`: um
// literal "do aparelho" num script de propósito geral, exatamente a dívida do
// §12.24. Num aparelho novo sem `INTREE_DTS_NAME` ele procuraria o DTB da X55,
// acharia (mora no mesmo `out/`) e gravaria o painel errado.

test("make-sd-image.sh não tem DTB de reserva de outro aparelho", async () => {
  const script = await readFile(path.join(ROOT, "scripts/make-sd-image.sh"), "utf8");
  const executavel = script
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("#"))
    .join("\n");
  assert.ok(
    !/DTB_NAME=.*:-/.test(executavel),
    "DTB_NAME não pode ter valor de reserva: adivinhar painel é tela preta",
  );
  assert.match(executavel, /if \[\[ -z "\$DTB_NAME" \]\]/, "tem de falhar dizendo o que falta");
});

test("device-info.mjs falha quando o defconfig não declara o DTS", () => {
  // O caso concreto: o qemu-aarch64 não tem `INTREE_DTS_NAME`. O comando sai 2,
  // e é essa saída que o make-sd-image.sh transforma em erro com instrução.
  assert.throws(
    () => execFileSync("node", [path.join(ROOT, "scripts/device-info.mjs"), "qemu-aarch64", "dts"], {
      stdio: "pipe",
    }),
    (erro) => erro.status === 2,
  );
});

test("todo aparelho que gera cartão declara o próprio DTS", () => {
  // A lista não é "os de hoje": qualquer aparelho com `panel` declarado é
  // candidato a imagem de cartão, e sem DTS o make-sd-image recusa.
  const saida = execFileSync("node", [path.join(ROOT, "scripts/validate-devices.mjs")], {
    encoding: "utf8",
  });
  assert.match(saida, /OK: 7 dispositivo/, "a validação da árvore tem de passar");
});

test("o bloco `path: |` do cache só tem caminhos, nenhum comentário", async () => {
  // ARMADILHA EM QUE EU CAÍ ao escrever a correção acima: a explicação foi para
  // dentro do `path: |`, e ali é BLOCO LITERAL do YAML — `#` não é comentário,
  // é texto. O `actions/cache` receberia uma linha `#  build-device.sh usa...`
  // como padrão de caminho. Não falha o workflow; só entra lixo na lista, que é
  // a pior forma de errar configuração.
  //
  // Este teste lê o YAML como TEXTO (o repositório não tem dependência de
  // parser) e confere o recorte do bloco.
  const linhas = (await readFile(WORKFLOW, "utf8")).split("\n");
  const inicio = linhas.findIndex((l) => l.includes("Cache Buildroot downloads"));
  assert.ok(inicio > 0, "o passo do cache sumiu");

  const pathIdx = linhas.findIndex((l, i) => i > inicio && /^\s*path:\s*\|/.test(l));
  assert.ok(pathIdx > inicio, "o passo do cache não tem mais `path: |`");

  const indentacao = linhas[pathIdx].match(/^\s*/)[0].length;
  const conteudo = [];
  for (let i = pathIdx + 1; i < linhas.length; i += 1) {
    const linha = linhas[i];
    if (linha.trim() === "") {
      conteudo.push(linha);
      continue;
    }
    if (linha.match(/^\s*/)[0].length <= indentacao) break;
    conteudo.push(linha);
  }

  const naoVazias = conteudo.map((l) => l.trim()).filter(Boolean);
  assert.ok(naoVazias.length >= 2, `bloco de cache com ${naoVazias.length} caminho(s)`);
  const comentarios = naoVazias.filter((l) => l.startsWith("#"));
  assert.deepEqual(
    comentarios,
    [],
    "comentário dentro de `path: |` vira caminho literal no actions/cache",
  );
  for (const caminho of naoVazias) {
    assert.match(caminho, /^[!./~]|^[A-Za-z]:/, `linha que não parece caminho: "${caminho}"`);
  }
});
