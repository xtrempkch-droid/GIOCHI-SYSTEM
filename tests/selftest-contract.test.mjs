import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do `giochi-selftest` que o hardware desmentiu duas vezes.
//
// A regra que saiu das duas: **teste que pergunta a coisa errada é pior que
// teste nenhum**, porque manda caçar defeito onde não há e ensina o operador a
// ignorar o bloco inteiro — inclusive quando ele estiver certo.
//
// Caso 1 (03/11): `ls /usr/lib/x.so* /lib/x.so*` devolvia não-zero quando o
// padrão de UM diretório não casava. Cinco FAILs falsos num aparelho onde as
// cinco bibliotecas existiam. Corrigido em `lib_existe()`.
//
// Caso 2 (04/11): a imagem testada era de 19:17 e a correção de 19:18 — um
// minuto. O time do app diagnosticou o `ls` e reportou de volta; a árvore já
// estava corrigida. Este teste existe para que a terceira vez não aconteça.

const SELFTEST = path.join(
  ROOT,
  "device/common/rootfs-overlay/usr/bin/giochi-selftest",
);

const read = () => readFile(SELFTEST, "utf8");

test("cada biblioteca é procurada por diretório, nunca com dois globs num ls", async () => {
  const texto = await read();
  // A forma do bug: `ls A B >/dev/null` — dois caminhos no mesmo comando.
  const doisGlobs = texto.match(/^\s*(?:if\s+)?ls\s+\S+\s+\S+\s*>/m);
  assert.equal(
    doisGlobs,
    null,
    `ls com dois globs volta não-zero quando um deles não casa. ` +
      `Encontrado: ${doisGlobs?.[0]?.trim()}. Use um ls por diretório, ` +
      `como em lib_existe().`,
  );
  assert.match(texto, /^lib_existe\(\) \{/m);
  // E o laço tem de cobrir os dois diretórios reais do Buildroot. `/lib` não é
  // symlink para `/usr/lib` nesta imagem — é o que faz o segundo glob falhar.
  const corpo = texto.slice(texto.indexOf("lib_existe() {"));
  assert.match(corpo.slice(0, 300), /\/usr\/lib/);
  assert.match(corpo.slice(0, 300), /\/lib/);
});

test("lib_existe() funciona de verdade, nos dois diretórios", () => {
  // Executa a função real extraída do script, num diretório sintético: prova
  // que a correção não é só textual.
  const script = `
lib_existe() {
    for dir in "$1/usr/lib" "$1/lib"; do
        if ls "$dir/$2".so* >/dev/null 2>&1; then
            return 0
        fi
    done
    return 1
}
`;
  const dir = mkdtempSync(path.join(tmpdir(), "selftest-libs-"));
  try {
    execFileSync("mkdir", ["-p", path.join(dir, "usr/lib"), path.join(dir, "lib")]);

    const roda = (lib, onde) => {
      const alvo = onde ? path.join(dir, onde, `${lib}.so.1`) : "";
      if (alvo) writeFileSync(alvo, "x");
      try {
        execFileSync("sh", ["-c", `${script}\nlib_existe "$1" "$2"`, "sh", dir, lib]);
        return 0;
      } catch (error) {
        return error.status ?? 1;
      }
    };

    // O caso que produzia FAIL falso: a lib só existe em /usr/lib.
    assert.equal(roda("libasound", "usr/lib"), 0, "lib só em /usr/lib tem de achar");
    // E o espelho: só em /lib.
    assert.equal(roda("libpulso", "lib"), 0, "lib só em /lib tem de achar");
    // Ausente nos dois continua ausente — senão a correção viraria um PASS
    // sempre-verde, que é o defeito oposto.
    assert.notEqual(roda("libinexistente", null), 0, "lib ausente não pode passar");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a prova do harfbuzz não depende de readelf estar na imagem", async () => {
  const texto = await read();
  const inicio = texto.indexOf("HarfBuzz ligado no SDL2_ttf");
  assert.ok(inicio > 0, "o bloco do harfbuzz precisa existir");
  // Até o fim do bloco, não do arquivo: o comentário do harness é longo de
  // propósito (explica por que NÃO se usa binutils) e empurra o código adiante.
  // Marcador de fim, não janela fixa — janela de 3000 chars quebrou quando o
  // bloco cresceu, e o teste passou a acusar o que já estava certo.
  const bloco = texto.slice(
    inicio,
    texto.indexOf("Fontes: o diretório existir não prova nada", inicio),
  );
  assert.ok(bloco.length > 0, "não achei o fim do bloco");

  // `readelf` vem só com BR2_PACKAGE_BINUTILS_TARGET, que instala a toolchain
  // inteira no aparelho. Sem ele o bloco saía [SKIP] justamente no item que
  // importa — medido no X35H em 04/11.
  assert.match(
    bloco,
    /grep -aq/,
    "precisa de um caminho sem readelf (grep -a no soname)",
  );
  assert.match(bloco, /readelf -d/);

  // E o texto do PASS tem de dizer QUAL prova foi usada: as três não valem o
  // mesmo, e quem lê o relatório precisa saber a diferença.
  assert.match(bloco, /NEEDED/);
  assert.match(bloco, /soname/);
  assert.match(bloco, /resolvido pelo loader/);
});

test("a prova do loader lê o EXIT CODE, não só a saída", async () => {
  // Medido forjando um ELF com NEEDED apontando para `libqqq.so`:
  //
  //   ld.so --list fake.so  →  exit 127, e a lista NEM É ESCRITA
  //   error while loading shared libraries: libqqq.so: cannot open...
  //
  // Com `--list | grep -q libharfbuzz` o resultado é falso, a cascata cai no
  // `grep -a` do binário — que ACHA o soname — e o bloco dava PASS no caso
  // exato que importa: biblioteca pedida e ausente. O exit code é a única
  // coisa que separa "não usa harfbuzz" de "usa e não tem".
  const texto = await read();
  const bloco = texto.slice(
    texto.indexOf("HarfBuzz ligado no SDL2_ttf"),
    texto.indexOf("Fontes: o diretório existir não prova nada"),
  );
  assert.ok(bloco.length > 0, "não achei o bloco");
  assert.match(
    bloco,
    /LISTA="\$\("\$LOADER" --list "\$TTF_LIB" 2>&1\)" && LOADER_OK=1/,
    "tem de capturar a saída E o exit code",
  );
  // E o ramo em que o loader falha com o nome presente tem de ser WARN, nunca
  // PASS — é o falso positivo que este teste existe para impedir.
  const ramoFalha = bloco.slice(bloco.indexOf("elif [ \"$PEDE\" = 1 ]"));
  assert.match(ramoFalha, /^\s*warn /m, "loader falhou + pede ⇒ warn");
  assert.ok(
    !/elif \[ "\$PEDE" = 1 \][^;]*;?\s*\n\s*pass /m.test(bloco),
    "PEDE=1 nunca pode virar PASS",
  );
});

test("o painel é reportado como linha própria, com proporção", async () => {
  const texto = await read();
  // Foi o dado que explicou a faixa de 25% e a fonte pela metade no X35H
  // (640x480 com UI 16:9). Fica cedo no bloco e em linha própria: no meio de
  // vinte PASS ele se perde.
  const inicio = texto.indexOf('PAINEL=""');
  assert.ok(inicio > 0, "o bloco do painel precisa existir");
  // Do começo do bloco até o próximo teste do bloco de display: o `pass` do
  // painel aparece duas vezes (ramo sem dígito e ramo calculado), então cortar
  // na primeira ocorrência pegaria só metade.
  const fim = texto.indexOf("renderD128", inicio);
  const bloco = texto.slice(inicio, fim > inicio ? fim : inicio + 2000);

  assert.match(bloco, /painel: \$PAINEL/);
  assert.match(bloco, /retrato/);
  assert.match(bloco, /paisagem/);

  // Aritmética inteira: busybox ash não tem ponto flutuante garantido, e o
  // §12.20 já mostrou que função de gawk (strtonum) devolve vazio em silêncio.
  // As checagens abaixo olham USO, não menção: o próprio comentário do bloco
  // cita `awk` e `strtonum` para explicar por que não são usados.
  assert.doesNotMatch(bloco, /strtonum\s*\(/, "strtonum não é do busybox awk");
  // Invocação de awk, não a palavra: o comentário do bloco diz "sem awk" e não
  // pode ser confundido com uso.
  assert.doesNotMatch(
    bloco,
    /(?:^|\$\(|\|\s*)\s*awk\s/m,
    "proporção do painel não pode depender de awk: use aritmética de shell",
  );
  assert.match(bloco, /R100=/, "esperado o cálculo inteiro em centésimos");
});

test("a proporção calculada bate com as resoluções reais dos aparelhos", () => {
  const razao = (m) => {
    const [w, h] = m.split("x").map(Number);
    const r100 = Math.floor((w * 100 + Math.floor(h / 2)) / h);
    return `${Math.floor(r100 / 100)}.${String(r100 % 100).padStart(2, "0")}`;
  };
  assert.equal(razao("640x480"), "1.33", "X35H é 4:3");
  assert.equal(razao("1280x720"), "1.78", "16:9");
  assert.equal(razao("720x1280"), "0.56", "X55 é retrato");
  assert.equal(razao("800x480"), "1.67");
});
