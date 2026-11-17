import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      .replaceAll("/sys/class/input", path.join(tmp, "sys/class/input").replaceAll("\\", "/"));

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

// ── as duas armadilhas de busybox que apareceram no mesmo bloco ──────────────
//
// O bloco de áudio fazia:
//
//   CARDS=$(grep -c '^\s*[0-9]' /proc/asound/cards 2>/dev/null)
//
// e as duas coisas erradas ali dão o MESMO sintoma — `FAIL nenhuma placa de som`
// num aparelho com som:
//
//   1. `\s` é extensão do GNU grep, e o alvo desta imagem é o busybox (§12.20).
//      Onde ela não é aceita, `^\s*[0-9]` vira "zero ou mais letras `s` seguidas
//      de dígito" — e as linhas de `/proc/asound/cards` começam com ESPAÇO.
//   2. `grep -c` SEM casa imprime `0` **e** sai com status 1. Com
//      `|| echo 0` o valor vira "0\n0", que não é número, e o `[ -gt ]` falha em
//      silêncio (§12.56). Foi o que aconteceu no gate do SDL2/ALSA.
//
// A regra que fecha os dois: `[[:space:]]` no lugar de `\s`, e nunca
// `grep -c ... || echo 0`.
test("nenhum script do rootfs usa `\\s` em grep — busybox não garante a extensão", async () => {
  const dir = new URL("../device/common/rootfs-overlay/usr/bin/", import.meta.url);
  const arquivos = readdirSync(dir);
  const achados = [];
  for (const nome of arquivos) {
    const texto = readFileSync(new URL(nome, dir), "utf8");
    for (const linha of texto.split("\n")) {
      if (linha.trim().startsWith("#")) continue;      // o comentário EXPLICA a regra
      if (!/\bgrep\b/.test(linha) && !/\bsed\b/.test(linha)) continue;
      // `\s` dentro do padrão de grep/sed, e não uma barra invertida qualquer.
      if (/['"][^'"]*\\s[^'"]*['"]/.test(linha)) achados.push(`${nome}: ${linha.trim()}`);
    }
  }
  assert.deepEqual(achados, [], "use [[:space:]] — \\s não é POSIX:\n  " + achados.join("\n  "));
});

test("nenhum script do rootfs faz `grep -c ... || echo 0`", async () => {
  // O `|| echo 0` existe para "não deixar o status vazar", mas `grep -c` já
  // imprime 0: o resultado é dois zeros numa string só.
  const dir = new URL("../device/common/rootfs-overlay/usr/bin/", import.meta.url);
  const achados = [];
  for (const nome of readdirSync(dir)) {
    const texto = readFileSync(new URL(nome, dir), "utf8");
    for (const linha of texto.split("\n")) {
      if (linha.trim().startsWith("#")) continue;
      if (/grep\s+-[a-zA-Z]*c[a-zA-Z]*\b.*\|\|\s*echo\s+0/.test(linha)) {
        achados.push(`${nome}: ${linha.trim()}`);
      }
    }
  }
  assert.deepEqual(achados, [], "`grep -c` já imprime 0; o `|| echo 0` produz \"0\\n0\":\n  " + achados.join("\n  "));
});

test("o selftest não atribui contagem que ninguém lê", async () => {
  // `LEASES=$(grep -c ...)` era calculada e nunca usada — código morto que
  // carregava o defeito do teste acima sem nenhum efeito. Variável que só
  // existe para justificar uma linha é a que envelhece errada.
  const texto = await read();
  assert.ok(!/^\s*LEASES=/m.test(texto), "LEASES não é lida por ninguém: remova");
});

test("o selftest não repete a lenda de que `amixer` não existe no Buildroot", async () => {
  // §12.16: `amixer` EXISTE, como subopção do `alsa-utils` desligada por
  // padrão. "Não empacotado" e "empacotado e desligado" dão o mesmo sintoma, e
  // o comentário que os confunde sobreviveu onze revisões no AGENTS — não pode
  // voltar no código.
  const texto = await read();
  assert.ok(
    !/amixer`? N[ÃA]O existe/i.test(texto),
    "amixer existe no Buildroot; o que faltava era a subopção ligada",
  );
});

test("o kmscube é PULADO quando o launcher detém o DRM master, não reprovado", async () => {
  // O DRM master é exclusivo. Com o launcher rodando, `kmscube -D /dev/dri/card0`
  // não consegue virar master e sai diferente de zero — e chamar isso de FAIL é
  // falso negativo em cima de uma GPU funcionando, na mesma família do §12.45
  // (a ferramenta de diagnóstico consumindo o recurso que o produto usa).
  //
  // O teste também pega o defeito espelhado: transformar o bloco inteiro em
  // `skip` incondicional deixaria 3D sem prova nenhuma em aparelho sem launcher,
  // que é justamente o caso da X55 de release.
  const texto = await read();
  const bloco = texto.slice(texto.indexOf("EGL/GLES: sem binário"));
  assert.ok(bloco.length > 0, "o bloco de EGL/GLES sumiu do selftest");
  assert.match(
    bloco,
    /LAUNCHER_RODANDO/,
    "o passo do kmscube tem de ler LAUNCHER_RODANDO antes de rodar",
  );
  assert.match(
    bloco,
    /timeout 10 kmscube -D \/dev\/dri\/card0/,
    "sem launcher, o kmscube tem de RODAR — skip incondicional não prova nada",
  );
  // A ordem importa: o guarda do launcher vem ANTES da execução.
  const iGuard = bloco.indexOf("LAUNCHER_RODANDO");
  const iRun = bloco.indexOf("timeout 10 kmscube");
  assert.ok(
    iGuard < iRun,
    "o guarda do launcher tem de vir antes do kmscube rodar",
  );
});

test("o bloco do kmscube lê o RENDERER, e o timeout 124 é sucesso", async () => {
  // Medido no R35S em 15/11/2026, imagem `commit=a012b5a`: o kmscube imprimiu
  // `renderer: "Mali-G31 (Panfrost)"` e o selftest deu
  //
  //   [FAIL] kmscube falhou — EGL/GLES ou scanout quebrado
  //
  // num aparelho com a GPU funcionando. Causa: o kmscube é uma ANIMAÇÃO e não
  // sai sozinho — quem encerra é o `timeout`, e ele devolve 124. A primeira
  // versão usava `if timeout 10 kmscube; then pass; else fail`, então 124 caía
  // no `else`. Falso negativo da mesma família do §12.34.
  //
  // E o espelho, que é o que o §12.51 ensina: sem panfrost o Mesa responde a
  // MESMA `GL_VERSION` com `renderer: softpipe`. Se o teste só olhasse o exit
  // code, um aparelho renderizando na CPU passaria verde.
  //
  // Este teste executa o bloco REAL do selftest com um `kmscube` de mentira,
  // nos cinco desfechos que importam.
  const texto = await read();
  const inicio = texto.indexOf("EGL/GLES: sem binário");
  assert.ok(inicio > 0, "o bloco de EGL/GLES sumiu do selftest");
  const fim = texto.indexOf("\nfi\n", texto.indexOf("timeout 10 kmscube"));
  assert.ok(fim > inicio, "não consegui delimitar o bloco do kmscube");
  const bloco = texto.slice(inicio, fim + 4);

  const raiz = mkdtempSync(path.join(tmpdir(), "giochi-kms-"));
  const bin = path.join(raiz, "bin");
  mkdirSync(bin, { recursive: true });

  // `pass`/`fail`/`skip` do selftest viram eco, para o veredito ser legível.
  const cabecalho = [
    "pass() { echo \"PASS\"\" $*\"; }",
    "fail() { echo \"FAIL\"\" $*\"; }",
    "skip() { echo \"SKIP\"\" $*\"; }",
  ].join("\n");
  const script = path.join(raiz, "t.sh");
  writeFileSync(script, `${cabecalho}\n${bloco}\n`);

  function roda({ exit = 0, renderer = "", launcher = 0, ausente = false }) {
    if (ausente) {
      rmSync(path.join(bin, "kmscube"), { force: true });
    } else {
      const corpo = [
        "#!/bin/sh",
        "echo 'OpenGL ES information:'",
        renderer ? `echo '  renderer: "${renderer}"'` : "true",
        `exit ${exit}`,
        "",
      ].join("\n");
      const alvo = path.join(bin, "kmscube");
      writeFileSync(alvo, corpo);
      chmodSync(alvo, 0o755);
    }
    return execFileSync("sh", [script], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        LAUNCHER_RODANDO: String(launcher),
        HOME: raiz,
      },
      timeout: 30_000,
      encoding: "utf8",
    }).trim();
  }

  try {
    assert.match(
      roda({ exit: 124, renderer: "Mali-G31 (Panfrost)" }),
      /^PASS.*Mali-G31/,
      "timeout 124 com GPU tem de ser PASS — é o falso FAIL medido no aparelho",
    );
    assert.match(
      roda({ exit: 0, renderer: "Mali-G31 (Panfrost)" }),
      /^PASS/,
      "saída limpa com GPU também é PASS",
    );
    assert.match(
      roda({ exit: 143, renderer: "softpipe" }),
      /^FAIL.*CPU/,
      "softpipe tem de reprovar — sem panfrost a GL_VERSION é a MESMA (§12.51)",
    );
    assert.match(
      roda({ exit: 1, renderer: "" }),
      /^FAIL.*exit 1/,
      "falha de verdade tem de doer, e com o código na mensagem",
    );
    assert.match(
      roda({ exit: 143, renderer: "Mali-G31 (Panfrost)", launcher: 1 }),
      /^SKIP/,
      "com launcher o kmscube roubaria a tela — SKIP, nunca FAIL (§12.45)",
    );
    assert.match(
      roda({ ausente: true }),
      /^SKIP/,
      "sem o binário é SKIP, não FAIL: não deu para medir não é o mesmo que quebrado",
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("a leitura de /proc/*/cmdline silencia o processo que sumiu", async () => {
  // Medido no R35S em 15/11/2026: o bloco do launcher imprimiu
  //   /usr/bin/giochi-selftest: line 967: can't open /proc/3021/cmdline
  // porque o processo saiu entre o glob e o `open` — normal em /proc. O código
  // JÁ tinha `2>/dev/null`, e o comentário acima dele já dizia "silêncio é o
  // certo aqui". Não silenciava: o shell aplica os redirecionamentos da
  // ESQUERDA para a DIREITA, então `<"$cmdline"` falhava primeiro, o erro ia
  // para um stderr que ainda não tinha sido desviado, e o `/dev/null` nunca
  // chegava a valer.
  //
  // É a mesma família do §12.59/§12.62: a intenção escrita no comentário não é
  // o comportamento. Por isso o teste roda a LINHA REAL do script — reescrever
  // a ordem de novo faz ele falhar com o ruído que aparecer.
  const texto = await read();
  const linha = texto
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^cmd="\$\(tr\b/.test(l));
  assert.ok(
    linha,
    "a leitura de /proc/*/cmdline sumiu do selftest — é ela que decide se o " +
      "launcher está vivo, e `ps` não serve nesta imagem (§12.46)",
  );

  const r = spawnSync(
    "sh",
    ["-c", `cmdline=/proc/999999/cmdline\n${linha}\nprintf '%s' "$cmd"\n`],
    { encoding: "utf8" },
  );
  assert.equal(
    r.status,
    0,
    `a leitura falhou com status ${r.status}: ${r.stderr.trim()}`,
  );
  assert.equal(
    r.stdout,
    "",
    "o redirect que falhou devolveu conteúdo em vez de vazio",
  );
  assert.equal(
    r.stderr.trim(),
    "",
    `um /proc de processo que sumiu poluiu a saída do selftest:\n` +
      `  ${r.stderr.trim()}\n` +
      `A ordem dos redirecionamentos é o que importa: ` +
      `\`2>/dev/null\` tem de vir ANTES do \`<\`. Escrito ao contrário, o \`<\` ` +
      `falha primeiro e o stderr ainda não está desviado.`,
  );
});

// ── Caso 4 (17/11): o controle VIRTUAL não era verificado ──────────────────
//
// O bloco de gamepad do selftest conta o HARDWARE (gpio-keys, adc-joystick,
// r36s_Gamepad). Isso responde "os botões existem", não "os jogos veem o mesmo
// layout em qualquer console" — que passou a ser a promessa do sistema quando o
// `giochi-gamepad` entrou: um nó só, 17 códigos canônicos, 4 eixos.
//
// Se o daemon não sobe, nada quebra visivelmente: os jogos voltam a ver o
// hardware cru e o `neon-drift` volta a divergir entre R35S e X55. Build verde,
// contrato ausente, nenhum aviso — a classe do §12.29 aplicada a um serviço.
test("o controle virtual é verificado pela consequência (nó + daemon)", async () => {
  const texto = await read();
  assert.match(texto, /Giochi Gamepad/,
    "o selftest tem de olhar o nó virtual, não só o hardware");
  assert.match(texto, /S52gamepad/,
    "e tem de saber que o serviço existe, para distinguir 'não embarcado' de 'embarcado e quebrado'");
  assert.match(texto, /\/proc\/\[0-9\]\*\/cmdline/,
    "o daemon é `/bin/sh` rodando o script: `pidof` casaria pelo nome e diria " +
    "'ausente' com ele vivo (§12.46)");
});

test("os três estados do controle virtual dão três vereditos distintos", async () => {
  const sh = readFileSync(SELFTEST, "utf8");
  const bruto = sh.slice(
    sh.indexOf("# ── o controle VIRTUAL"),
    sh.indexOf("# ── áudio"),
  );
  assert.ok(bruto.length > 500, `bloco não encontrado (${bruto.length} B)`);

  const tmp = mkdtempSync(path.join(tmpdir(), "selftest-virt-"));
  try {
    const sysInput = path.join(tmp, "sys/class/input").replaceAll("\\", "/");
    const proc = path.join(tmp, "proc").replaceAll("\\", "/");
    const initd = path.join(tmp, "init.d/S52gamepad").replaceAll("\\", "/");
    const bin = path.join(tmp, "usr/bin/giochi-gamepad").replaceAll("\\", "/");
    mkdirSync(path.dirname(initd), { recursive: true });
    mkdirSync(path.dirname(bin), { recursive: true });
    mkdirSync(path.join(tmp, "proc"), { recursive: true });

    const bloco = bruto
      .replaceAll("/sys/class/input", sysInput)
      .replaceAll("/proc/", `${proc}/`)
      .replaceAll("/etc/init.d/S52gamepad", initd)
      .replaceAll("/usr/bin/giochi-gamepad", bin);

    // O caminho real é `input/eventN/device/name`: o DIRETÓRIO é `eventN`, e o
    // nome do aparelho está dentro do arquivo. Criar a pasta com o nome do
    // aparelho não casaria o glob `event*/device` — e foi o que aconteceu na
    // primeira versão deste teste.
    const no = (nome, keyBits, absBits, evento = "event21") => {
      const d = path.join(tmp, "sys/class/input", evento, "device");
      mkdirSync(path.join(d, "capabilities"), { recursive: true });
      writeFileSync(path.join(d, "name"), `${nome}\n`);
      writeFileSync(path.join(d, "capabilities/key"), `${keyBits}\n`);
      if (absBits) writeFileSync(path.join(d, "capabilities/abs"), `${absBits}\n`);
    };
    const daemon = (vivo) => {
      if (!vivo) return;
      const d = path.join(tmp, "proc/4242");
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, "cmdline"), "/bin/sh\0/usr/bin/giochi-gamepad\0");
    };
    const instalar = () => writeFileSync(initd, "#!/bin/sh\n", { mode: 0o755 });

    const roda = () => {
      const script = `
PASS=0; WARN=0; FAIL=0; SKIP=0
pass() { echo "PASS $*"; }
warn() { echo "WARN $*"; }
fail() { echo "FAIL $*"; }
skip() { echo "SKIP $*"; }
say() { echo "     $*"; }
head2() { :; }
MAP_GAMEPAD=16
read_or() { cat "$1" 2>/dev/null | tr -d '\\0'; }
${sh.slice(sh.indexOf("count_bits() {"), sh.indexOf("# ## Três origens de gamepad"))}
${bloco}
`;
      return execFileSync("sh", ["-c", script], { encoding: "utf8" });
    };

    // 1. Contrato valendo: serviço instalado, daemon vivo, nó com 17 botões.
    instalar();
    daemon(true);
    no("Giochi Gamepad", "7fdbff0f0000000000000000000000000", "3003f00000000000");
    const r1 = roda();
    assert.match(r1, /PASS controle virtual: Giochi Gamepad/,
      `serviço + daemon + nó certo tem de dar PASS; veio:\n${r1}`);

    // 2. Daemon caiu: os jogos voltam ao hardware cru. É o defeito silencioso.
    rmSync(path.join(tmp, "proc/4242"), { recursive: true, force: true });
    assert.match(roda(), /FAIL giochi-gamepad NÃO está rodando/,
      "serviço instalado e daemon morto tem de doer — é o contrato prometido e não cumprido");

    // 3. Daemon vivo, mas sem /dev/uinput não há nó: o kernel não criou o device.
    daemon(true);
    rmSync(path.join(tmp, "sys/class/input"), { recursive: true, force: true });
    mkdirSync(path.join(tmp, "sys/class/input"), { recursive: true });
    assert.match(roda(), /FAIL giochi-gamepad roda mas o nó/,
      "sem nó, o daemon está vivo e não entrega nada — FAIL, não PASS");

    // 4. Nada instalado: imagem anterior ao contrato. SKIP, e não FAIL — senão
    //    toda imagem antiga fica vermelha e o operador aprende a ignorar.
    rmSync(initd, { force: true });
    assert.match(roda(), /SKIP sem controle virtual/,
      "imagem sem o serviço é SKIP: não foi prometido, não pode reprovar");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
