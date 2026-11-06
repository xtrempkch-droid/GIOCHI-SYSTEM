import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// ── o gamepad do R35S é um nome diferente, não ausência de gamepad ────────
//
// Medido no aparelho em 06/11/2026: `r36s_Gamepad` registrado em `event1`,
// dirigido pelo `rocknix-singleadc-joypad`, com EV_KEY + EV_ABS + EV_FF. E o
// `giochi-selftest` dava **dois FAIL**: "sem gpio-keys-control" e "sem
// adc-joystick". Ele procurava o nome do driver dos OUTROS aparelhos.
//
// É a mesma classe do §12.30 e §12.34 — FAIL falso é pior que teste nenhum,
// porque ensina o operador a ignorar o bloco inteiro.

test("a contagem de botões aceita os três nomes de gamepad, não só um", () => {
  const sh = readFileSync(SELFTEST, "utf8");
  const bloco = sh.slice(sh.indexOf("PAD_BUTTONS=0"), sh.indexOf("MAP_FILE="));
  // Os três drivers desta árvore.
  assert.match(bloco, /gpio-keys-control/, "X55/X35H usam gpio-keys");
  assert.match(bloco, /adc-joystick/, "mainline usa adc-joystick");
  assert.match(bloco, /\*Gamepad\*|Gamepad\),/, "R35S usa r36s_Gamepad");
  // E a mensagem de falha não pode nomear um driver só.
  assert.ok(
    !/fail "sem gpio-keys-control/.test(sh),
    "a mensagem de FAIL não pode acusar a ausência de UM driver específico",
  );
});

test("a contagem pergunta a CONSEQUÊNCIA (bits), não o nome do nó", () => {
  const sh = readFileSync(SELFTEST, "utf8");
  const bloco = sh.slice(sh.indexOf("PAD_BUTTONS=0"), sh.indexOf("MAP_FILE="));
  // capabilities/key e capabilities/abs são o que o driver realmente declara.
  assert.match(bloco, /capabilities\/key/);
  assert.match(bloco, /capabilities\/abs/);
  assert.match(bloco, /count_bits/);
});

test("a lógica conta os bits do gamepad e ignora o nó de volume", () => {
  // Prova em sysfs sintético: dois nós, um deles `gpio-keys-vol` com 1 bit.
  // O selftest tem de escolher o de 16 e reportar o NOME de origem.
  const tmp = mkdtempSync(path.join(tmpdir(), "giochi-pad-"));
  try {
    const mk = (nome, keyBits, absBits) => {
      const d = path.join(tmp, "sys/class/input", `event${nome === "r36s_Gamepad" ? 1 : 0}`,
        "device/capabilities");
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, "../name"), nome);
      writeFileSync(path.join(d, "key"), `${keyBits}\n`);
      if (absBits) writeFileSync(path.join(d, "abs"), `${absBits}\n`);
    };
    mk("r36s_Gamepad", "ffff0000000000000", "3003f0000000000");
    mk("gpio-keys-vol", "40000000");

    const sh = readFileSync(SELFTEST, "utf8");
    const bloco = sh.slice(sh.indexOf("PAD_BUTTONS=0"), sh.indexOf("MAP_FILE="))
      .replaceAll("/sys/class/input", path.join(tmp, "sys/class/input"));

    const script = `
count_bits() {
    awk '{
        s = $0; n = 0; tabela = "0123456789abcdef"
        for (i = 1; i <= length(s); i++) {
            c = substr(s, i, 1); v = index(tabela, c) - 1
            if (v <= 0) continue
            while (v > 0) { n += v % 2; v = int(v / 2) }
        }
        print n
    }'
}
read_or() { cat "$1" 2>/dev/null | tr -d '\\0'; }
${bloco}
echo "$PAD_BUTTONS|$PAD_AXES|$PAD_ORIGEM"
`;
    const saida = execFileSync("sh", ["-c", script], { encoding: "utf8" }).trim();
    const [botoes, eixos, origem] = saida.split("|");
    assert.equal(botoes, "16", `botões: ${saida}`);
    assert.equal(eixos, "8", `eixos: ${saida}`);
    assert.equal(origem, "r36s_Gamepad", "tem de reportar o nome de origem");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Caso 3 (06/11): o `ps` desta imagem MENTE ───────────────────────────────
//
// Relato da equipe do app, medido no R35S:
//
//     $ ps
//       169 ttyS2  sh
//       184 ttyS2  ps
//     $ ls -d /proc/[0-9]* | wc -l
//     94
//
// 94 processos em `/proc`, dois no `ps` — e entre os invisíveis estavam o
// `init`, o `sshd`, o `giochi-init` **e o launcher**. A conclusão que quase
// saiu de lá foi "o launcher não está rodando" enquanto ele desenhava a 99,2%
// na tela.
//
// A causa não é defeito: `/bin/ps` desta imagem é **procps-ng 3.3.17**, e o
// `ps` do procps-ng sem argumento seleciona "mesmo euid e mesmo terminal" —
// comportamento herdado do Unix, documentado no man. Medido no `rootfs.ext4`:
// `strings target/bin/ps | grep procps-ng` → `procps-ng 3.3.17`; o busybox
// também tem `CONFIG_PS=y` (defconfig da placa puxa procps-ng e o binário real
// ganha do symlink).
//
// Regra que fica: ferramenta de diagnóstico NÃO usa `ps`. `/proc` não tem
// seleção implícita.

test("a imagem traz procps-ng, cujo `ps` mostra só a própria TTY", async () => {
  // A premissa do teste seguinte só vale se o `ps` for o do procps-ng. Se o
  // Buildroot passar a instalar o applet do busybox, `ps` volta a listar tudo e
  // o comentário do selftest fica mentindo — este teste avisa antes.
  const frag = await readFile(path.join(ROOT, "config/common.fragment"), "utf8");
  const temProcps = /^BR2_PACKAGE_PROCPS_NG=y$/m.test(frag);
  const defconfig = await readFile(
    path.join(ROOT, "device/r35s/defconfig"), "utf8").catch(() => "");
  const noDefconfig = /^BR2_PACKAGE_PROCPS_NG=y$/m.test(defconfig);
  assert.ok(
    temProcps || noDefconfig,
    "nem o fragmento comum nem o defconfig ligam PROCPS_NG — confira qual `ps` a imagem tem antes de mexer no selftest",
  );
});

test("o selftest descobre o launcher por /proc, nunca por ps", async () => {
  const texto = await read();
  assert.ok(
    /\/proc\/\[0-9\]\*\/cmdline/.test(texto),
    "o selftest tem de ler /proc/*/cmdline para ver processos",
  );
  // `ps` dentro do selftest é a regressão: voltaria a esconder o launcher.
  const usaPs = texto
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .some((l) => /(^|[\s|(;])ps\s+(-[a-zA-Z]|\|)/.test(l) || /\bps -e\b/.test(l));
  assert.ok(!usaPs, "o selftest não pode usar `ps`: nesta imagem ele esconde processos");
});

test("a desistência do giochi-init vira FAIL no selftest, com o motivo", async () => {
  // Antes: o init parava de reiniciar e dormia, e a tela ficava parada sem
  // nenhuma pista. O arquivo é o que transforma silêncio em diagnóstico.
  const texto = await read();
  assert.match(texto, /\/run\/giochi\/launcher-parado/);
  assert.match(texto, /DESISTIU de reiniciar/);
  // O conteúdo é repassado, não só a existência: "desistiu" sem o motivo
  // obriga a abrir o arquivo por SSH, que é justamente o que falta quando a
  // tela está parada e o USB não subiu.
  assert.match(texto, /tr '\\n' ' ' <"?\$PARADA_FILE"?/);
});
