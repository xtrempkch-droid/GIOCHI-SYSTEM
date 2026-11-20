#!/usr/bin/env node
// Bootsplash: padrão do projeto, imagem no tamanho da tela, e — o que mais
// importa — a saída do splash no momento certo.
//
// ## Por que a saída é a parte crítica
//
// O `psplash` segura o framebuffer. Se ele não sair:
//
//   com launcher  -> a tela do app fica PRETA. O psplash continua sendo dono do
//                    framebuffer e o primeiro quadro do launcher nunca aparece.
//                    Sistema funcionando, tela morta — o sintoma que este
//                    projeto mais combate.
//   sem launcher  -> o logo fica na tela para sempre e o getty do console
//                    escreve no ttyS2, invisível. Quem olha a tela vê o splash;
//                    quem está na serial vê o login. Assimetria que custa tempo.
//
// O segundo caso é o de TODA imagem desta árvore hoje (nenhum aparelho tem o
// launcher empacotado), então não é hipótese: é o caminho principal.
//
// ## Por que a imagem é gerada por aparelho
//
// O `psplash` não escala nem centraliza: desenha em (0,0). Uma imagem de 640x480
// numa tela de 720x1280 fica no canto com o resto preto — pior que não ter
// splash, porque parece defeito.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdtempSync, readFileSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMON = readFileSync(`${ROOT}config/common.fragment`, "utf8");
const OVERRIDES = readFileSync(`${ROOT}config/package-overrides.mk`, "utf8");
const GERADOR = `${ROOT}scripts/gerar-splash.mjs`;
const S01 = `${ROOT}device/common/rootfs-overlay/etc/init.d/S01splash`;
const INIT = readFileSync(`${ROOT}device/common/rootfs-overlay/usr/bin/giochi-init`, "utf8");

/** Lê um PNG e devolve { largura, altura, pixels(y,x) -> [r,g,b] }. */
function lerPng(caminho) {
  const d = readFileSync(caminho);
  assert.deepEqual([...d.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "não é um PNG");
  let i = 8;
  let idat = Buffer.alloc(0);
  let largura = 0;
  let altura = 0;
  while (i < d.length) {
    const n = d.readUInt32BE(i);
    const tipo = d.toString("ascii", i + 4, i + 8);
    const dados = d.subarray(i + 8, i + 8 + n);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
    } else if (tipo === "IDAT") {
      idat = Buffer.concat([idat, dados]);
    }
    i += 12 + n;
  }
  const cru = inflateSync(idat);
  const passo = 1 + largura * 3;
  return {
    largura,
    altura,
    cor(x, y) {
      const base = y * passo + 1 + x * 3;
      return [cru[base], cru[base + 1], cru[base + 2]];
    },
  };
}

// ── padrão do projeto ────────────────────────────────────────────────────

test("psplash está no fragmento COMUM — padrão de todos os aparelhos", () => {
  // Se estivesse no fragmento de um aparelho só, o próximo aparelho nasceria sem
  // splash e ninguém notaria: ausência de splash não gera erro.
  assert.match(COMMON, /^BR2_PACKAGE_PSPLASH=y$/m);
});

test("o override usa `override`, não `=` — senão a receita apaga (§12.7)", () => {
  // `psplash.mk` faz `PSPLASH_IMAGE = $(call qstrip,$(BR2_PACKAGE_PSPLASH_IMAGE))`
  // com atribuição SIMPLES. Definir antes do include não adianta: a receita
  // sobrescreve em silêncio e o pacote volta para a imagem do Yocto.
  assert.match(OVERRIDES, /^override PSPLASH_IMAGE = \$\(GIOCHI_SPLASH_PNG\)$/m);
  // E a variável tem de ser recursiva (`=`), não `:=`: o caminho só existe no
  // momento do uso, depois de o build-device.sh gerar o arquivo.
  assert.ok(
    !/^override PSPLASH_IMAGE :=/m.test(OVERRIDES),
    "`:=` congelaria o valor antes de o arquivo existir",
  );
});

test("o build gera imagem E barra antes do make", () => {
  const sh = readFileSync(`${ROOT}scripts/build-device.sh`, "utf8");
  assert.match(sh, /gerar-splash\.mjs/);
  assert.match(sh, /GIOCHI_SPLASH_PNG/);
  // A barra é um segundo arquivo: o psplash desenha a imagem de fundo e, em
  // separado, a barra. Gerar só a imagem deixava as duas peças em lugares
  // diferentes — o defeito que este par fecha.
  assert.match(sh, /--bar-out "\$SPLASH_BAR"/);
  assert.match(sh, /GIOCHI_SPLASH_BAR/);
  // Geometria e cores viajam com eles.
  assert.match(sh, /psplash-config\.h/);
  assert.match(sh, /psplash-colors\.h/);
  // O caminho tem de ir para work/, não para a pasta do aparelho: caminho com
  // espaço entraria cru numa variável de make (§12.6).
  assert.match(sh, /SPLASH_DIR="\$WORK_DIR\/psplash"/);
  assert.match(sh, /SPLASH_PNG="\$SPLASH_DIR\/splash\.png"/);
  // E falhar ao gerar NÃO pode derrubar o build — sem splash o aparelho boota.
  const inicio = sh.indexOf("SPLASH_PNG=");
  const bloco = sh.slice(inicio, inicio + 2000);
  assert.match(bloco, /NÃO gerado/);
  assert.ok(!/^\s*exit 1\s*$/m.test(bloco), "splash é cosmético: não derruba o build");
});

test("o psplash é reconstruído: hook de extração não roda em pacote já extraído", () => {
  // A imagem, a barra e os headers entram por POST_EXTRACT. Num `work/`
  // retomado (`GIOCHI_SYSTEM_KEEP_WORK=1`, o caminho normal) a pasta do pacote
  // já existe, o hook é pulado e o build fica VERDE com o splash antigo.
  const sh = readFileSync(`${ROOT}scripts/build-device.sh`, "utf8");
  assert.match(
    sh,
    /rm -rf "\$BUILD_DIR\/build\/psplash-"\*/,
    "sem remover a pasta do psplash, mudar o splash não muda a imagem",
  );
});

// ── a imagem ─────────────────────────────────────────────────────────────

test("a imagem é gerada no tamanho lógico da tela do aparelho", () => {
  const tmp = mkdtempSync(join(tmpdir(), "giochi-splash-"));
  try {
    for (const [id, largura, altura] of [
      ["r35s", 640, 480],
      ["powkiddy-x55", 720, 1280],
      ["powkiddy-x35h", 640, 480],
    ]) {
      const out = join(tmp, `${id}.png`);
      execFileSync(process.execPath, [GERADOR, "--device", id, "--out", out],
        { encoding: "utf8" });
      const png = lerPng(out);
      const rotacionado = id === "powkiddy-x55";
      assert.equal(png.largura, rotacionado ? altura : largura, `${id}: largura lógica`);
      assert.equal(png.altura, rotacionado ? largura : altura, `${id}: altura lógica`);
      // E o arquivo tem de ser pequeno: é um logo, não uma fotografia. Acima de
      // 50 KiB indicaria que algo inesperado entrou no desenho.
      assert.ok(statSync(out).size < 50 * 1024, `${id}: ${statSync(out).size} B`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("o desenho tem texto legível e NÃO pinta a barra", () => {
  // "Gerou PNG" e "gerou splash legível" são perguntas diferentes. Aqui o teste
  // olha os pixels.
  //
  // O trilho era exigido nesta imagem até 14/11/2026 — e era exatamente o
  // defeito: uma barra decorativa desenhada aqui, longe do logo, enquanto o
  // psplash desenhava a barra REAL em outro lugar. Agora a barra tem arquivo
  // próprio (`--bar-out`) e a imagem não pinta trilho nenhum.
  const tmp = mkdtempSync(join(tmpdir(), "giochi-splash-px-"));
  try {
    for (const [id, largura, altura] of [["r35s", 640, 480], ["powkiddy-x55", 1280, 720]]) {
      const out = join(tmp, `${id}.png`);
      execFileSync(process.execPath, [GERADOR, "--device", id, "--out", out]);
      const png = lerPng(out);

      // 1. fundo escuro no canto
      const [r, g, b] = png.cor(2, 2);
      assert.ok(r < 60 && g < 60 && b < 70, `${id}: fundo ${[r, g, b]}`);

      // 2. texto claro na faixa central
      let claros = 0;
      for (let y = Math.floor(altura * 0.3); y < Math.floor(altura * 0.7); y += 1) {
        for (let x = 0; x < largura; x += 1) {
          const c = png.cor(x, y);
          if (c[0] > 200 && c[1] > 200 && c[2] > 200) claros += 1;
        }
      }
      assert.ok(claros > 200, `${id}: só ${claros} pixels de texto`);

      // 3. nenhum pixel do trilho: a barra é do psplash, não da imagem
      let trilho = 0;
      for (let y = 0; y < altura; y += 1) {
        for (let x = 0; x < largura; x += 1) {
          const c = png.cor(x, y);
          if (c[0] === 0x24 && c[1] === 0x28 && c[2] === 0x30) trilho += 1;
        }
      }
      assert.equal(trilho, 0, `${id}: ${trilho} pixels de trilho pintados na imagem`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a barra nasce na largura do logo e logo abaixo dele", () => {
  // A queixa que originou o trabalho: "o carregamento e o texto estão
  // separados". Aqui a geometria é medida: a barra tem de ter a largura do logo
  // e começar poucos pixels abaixo dele.
  const tmp = mkdtempSync(join(tmpdir(), "giochi-splash-bar-"));
  try {
    for (const [id, largura, altura] of [["r35s", 640, 480], ["powkiddy-x55", 1280, 720]]) {
      const splashOut = join(tmp, `${id}.png`);
      const barraOut = join(tmp, `${id}-bar.png`);
      execFileSync(process.execPath,
        [GERADOR, "--device", id, "--out", splashOut, "--bar-out", barraOut]);

      const splash = lerPng(splashOut);
      const barra = lerPng(barraOut);

      // Caixa do texto: onde há pixel claro ou azul.
      let minX = largura, maxX = -1, maxY = -1;
      for (let y = 0; y < altura; y += 1) {
        for (let x = 0; x < largura; x += 1) {
          const c = splash.cor(x, y);
          const claro = c[0] > 200 && c[1] > 200 && c[2] > 200;
          const azul = c[0] === 0x3d && c[1] === 0x9a && c[2] === 0xff;
          if (!claro && !azul) continue;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      assert.ok(maxX > 0, `${id}: não achei o logo`);

      // A barra começa na mesma coluna e tem a mesma largura do logo.
      assert.equal(barra.largura, maxX - minX + 1, `${id}: largura da barra ≠ do logo`);
      const barraX = Math.floor((largura - barra.largura) / 2);
      assert.equal(barraX, minX, `${id}: a barra não está na coluna do logo`);

      // E fica logo abaixo: o vão é o mesmo que o gerador declara (2% da
      // altura, no mínimo dois pixels de escala), nunca um sexto de tela.
      const barraY = altura - Math.floor(((16 - 9) * altura) / 16);
      const vao = barraY - maxY - 1;
      assert.ok(vao > 0 && vao < Math.round(altura * 0.06),
        `${id}: vão de ${vao}px entre logo e barra`);

      // A barra é uma cápsula: os cantos ficam no fundo, o meio no trilho.
      const [cr, cg, cb] = barra.cor(0, 0);
      assert.deepEqual([cr, cg, cb], [0x10, 0x12, 0x16], `${id}: canto da barra`);
      const [mr, mg, mb] = barra.cor(Math.floor(barra.largura / 2), Math.floor(barra.altura / 2));
      assert.deepEqual([mr, mg, mb], [0x24, 0x28, 0x30], `${id}: trilho`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("geometria e cores do psplash batem com o gerador", () => {
  // O gerador posiciona o logo pela fração 9/16; o psplash desenha a barra na
  // fração que está no header. Se as duas divergirem, ninguém vê erro — só um
  // logo flutuando longe da barra, que é o defeito original voltando por outra
  // porta.
  const config = readFileSync(`${ROOT}config/psplash/psplash-config.h`, "utf8");
  const cores = readFileSync(`${ROOT}config/psplash/psplash-colors.h`, "utf8");
  const gerador = readFileSync(GERADOR, "utf8");

  assert.match(config, /^#define PSPLASH_IMG_FULLSCREEN 1$/m,
    "sem FULLSCREEN a imagem é centralizada em 5/6 e o logo desloca H/12");
  assert.match(config, /^#define PSPLASH_SHOW_PROGRESS_BAR 1$/m);

  const num = Number(/^#define PSPLASH_IMG_SPLIT_NUMERATOR (\d+)$/m.exec(config)?.[1]);
  const den = Number(/^#define PSPLASH_IMG_SPLIT_DENOMINATOR (\d+)$/m.exec(config)?.[1]);
  assert.ok(num > 0 && den > 0 && num < den, `split inválido: ${num}/${den}`);

  const numGerador = Number(/const SPLIT_NUMERADOR = (\d+);/.exec(gerador)?.[1]);
  const denGerador = Number(/const SPLIT_DENOMINADOR = (\d+);/.exec(gerador)?.[1]);
  assert.equal(numGerador, num, "SPLIT_NUMERADOR do gerador ≠ do header");
  assert.equal(denGerador, den, "SPLIT_DENOMINADOR do gerador ≠ do header");

  // Cores: o psplash pinta o miolo da barra e limpa a tela com estes valores.
  const cor = (nome) => {
    const m = new RegExp(`^#define ${nome} (0x[0-9a-f]{2}),(0x[0-9a-f]{2}),(0x[0-9a-f]{2})$`, "mi")
      .exec(cores);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const paleta = (nome) => {
    const m = new RegExp(`const ${nome} = \\[(0x[0-9a-f]{2}), (0x[0-9a-f]{2}), (0x[0-9a-f]{2})\\]`, "i")
      .exec(gerador);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };

  assert.deepEqual(cor("PSPLASH_BACKGROUND_COLOR"), paleta("FUNDO"));
  assert.deepEqual(cor("PSPLASH_TEXT_COLOR"), paleta("TEXTO"));
  assert.deepEqual(cor("PSPLASH_BAR_COLOR"), paleta("DESTAQUE"));
  assert.deepEqual(cor("PSPLASH_BAR_BACKGROUND_COLOR"), paleta("TRILHO"));

  // E o pacote tem de receber os três arquivos, não só a imagem.
  assert.match(OVERRIDES, /base-images\/psplash-bar\.png/);
  assert.match(OVERRIDES, /psplash-config\.h/);
  assert.match(OVERRIDES, /psplash-colors\.h/);
  assert.match(OVERRIDES, /PSPLASH_POST_EXTRACT_HOOKS \+= GIOCHI_PSPLASH_VISUAL/);
});

test("o splash do X55 é gerado em paisagem para rotação nativa pelo psplash", () => {
  const tmp = mkdtempSync(join(tmpdir(), "giochi-splash-rot-"));
  try {
    const out = join(tmp, "x55.png");
    execFileSync(process.execPath, [GERADOR, "--device", "powkiddy-x55", "--out", out]);
    const png = lerPng(out);
    assert.equal(png.largura, 1280);
    assert.equal(png.altura, 720);
    const script = readFileSync(S01, "utf8");
    assert.match(script, /fbcon=rotate:3\) PSPLASH_ANGLE=90/,
      "a rotação confirmada no X55 é anti-horária em 90° no psplash");
    assert.match(script, /psplash -n -a "\$PSPLASH_ANGLE"/,
      "a rotação do psplash precisa abranger texto e barra");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("aparelho sem panel no device.json não gera splash, e diz por quê", () => {
  // Rascunho pode não ter a resolução ainda. O gerador tem de RECUSAR em vez de
  // inventar um tamanho — inventar produz o splash no canto, que parece defeito.
  const tmp = mkdtempSync(join(tmpdir(), "giochi-splash-sem-"));
  try {
    let falhou = false;
    let mensagem = "";
    try {
      execFileSync(process.execPath,
        [GERADOR, "--device", "steamdeck", "--out", join(tmp, "x.png")],
        { encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      falhou = true;
      mensagem = `${err.stderr ?? ""}${err.stdout ?? ""}`;
    }
    assert.ok(falhou, "steamdeck não declara panel: tem de falhar");
    assert.match(mensagem, /panel/);
    assert.match(mensagem, /NÃO escala|nao escala/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── a saída do splash ────────────────────────────────────────────────────

test("S01splash existe, é executável e sobe o psplash", () => {
  assert.ok(existsSync(S01), "falta o S01splash");
  assert.ok(statSync(S01).mode & 0o100, "tem de ser executável no índice do Git");
  const sh = readFileSync(S01, "utf8");
  assert.match(sh, /psplash -n -a "\$PSPLASH_ANGLE"/,
    "o `-n` mantém o processo e `-a` orienta o desenho completo");
  assert.match(sh, /\/dev\/fb0/, "sem framebuffer não há onde desenhar");
  // Falha não pode derrubar o boot.
  assert.match(sh, /seguindo sem splash|seguindo/);
});

test("o giochi-init encerra o splash ANTES do launcher", () => {
  // O launcher vira DRM master. Se o psplash ainda estiver lá, o primeiro quadro
  // dele não aparece e a tela fica preta — sistema bom, tela morta.
  //
  // A âncora é a CHAMADA (`"$LAUNCHER"` sozinho na linha), não a primeira
  // ocorrência do texto: havia um comentário citando `"$LAUNCHER"` na linha 18 e
  // o `indexOf` simples achava ele, então o teste procurava stop_splash no lugar
  // errado e falhava num código correto.
  const chamada = /^\s*"\$LAUNCHER"\s*$/m.exec(INIT);
  assert.ok(chamada, "não achei a chamada isolada de \"$LAUNCHER\"");
  const antes = INIT.slice(Math.max(0, chamada.index - 500), chamada.index);
  assert.match(antes, /stop_splash/, "stop_splash tem de vir ANTES de $LAUNCHER");
});

test("sem launcher, o splash sai para o getty aparecer", () => {
  // Este é o caminho de TODA imagem desta árvore hoje. Sem isto o logo fica na
  // tela e o login só existe na serial.
  const bloco = INIT.slice(INIT.indexOf("wait_for_launcher()"), INIT.indexOf("main()"));
  assert.match(bloco, /stop_splash/, "wait_for_launcher tem de encerrar o splash");
  assert.match(bloco, /getty|console|interface/i, "e o motivo tem de estar escrito");
});

test("stop_splash acha o FIFO em /run e sempre tem o kill como reserva", () => {
  // O defeito que este teste prendia: ele exigia
  // `[ -p /tmp/psplash_fifo ] || return 0`, que é EXATAMENTE o bug. O psplash
  // faz `chdir("/run")` e cria `psplash_fifo` lá (`psplash.c`), então o teste
  // de `/tmp` era sempre falso e `stop_splash` retornava sem fazer nada.
  //
  // Medido no X55 em 08/11/2026: o psplash estava vivo desde 1,7 s de uptime
  // com o `uptime` em 12017 s, segurando `/dev/fb0` ao lado do launcher.
  const bloco = INIT.slice(INIT.indexOf("psplash_fifo()"), INIT.indexOf("wait_for_launcher()"));
  assert.match(bloco, /\/run\/psplash_fifo/, "o caminho real do FIFO é /run");
  assert.match(bloco, /PSPLASH_FIFO_DIR/, "variável de ambiente tem precedência");
  assert.match(bloco, /psplash-write "QUIT"/, "QUIT é o caminho normal");
  // O kill não pode ser exceção de um teste de existência: se o FIFO existir
  // e não houver leitor, o QUIT "funciona" e o processo fica.
  assert.match(bloco, /pidof psplash/, "kill como reserva, sempre");
  assert.ok(
    !/\[ -p \/tmp\/psplash_fifo \] \|\| return 0/.test(bloco),
    "o early-return no caminho errado não pode voltar",
  );
});

test("o console de texto é assumido quando o launcher não é a interface", () => {
  // `CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y` faz o fbcon esperar alguém
  // escrever no console virtual — e o getty está em `console` = ttyS2 (serial),
  // então ninguém escreve. Medido no X55: `vtcon` só com `dummy device`,
  // geometria 25x80, `fbcon/rotate=0`, com `fbcon=rotate:3` na cmdline.
  // Depois de UMA linha em /dev/tty0: `(M) frame buffer device`, 45x160,
  // `fbcon/rotate=3`.
  assert.match(INIT, /assumir_console\(\)/, "a função tem de existir");
  assert.match(INIT, /\/dev\/tty0/, "o gatilho é escrever no tty0");

  const wait = INIT.slice(INIT.indexOf("wait_for_launcher()"), INIT.indexOf("main()"));
  assert.match(wait, /assumir_console/, "sem launcher é o caso em que o console é a interface");
  assert.match(wait, /stop_splash/, "e o splash tem de sair antes");

  // A flag de desenvolvimento entrega o console para depuração: sem o takeover
  // ela entrega uma tela parada, que é o oposto do que ela existe para dar.
  const main = INIT.slice(INIT.indexOf("main()"));
  const inicioRamo = main.indexOf('-f "$DEV_FREE_FILE"');
  assert.ok(inicioRamo > 0, "não achei o ramo da flag de desenvolvimento");
  // Recorte ESTRUTURAL, não por número de caracteres: o ramo vai do teste do
  // arquivo até a atribuição que marca o aviso como dado (`dev_aviso=1`).
  // A janela fixa de 900 chars quebrava a cada linha nova dentro do ramo — foi
  // o que aconteceu em 20/11/2026, ao entrar a auto-cura do marcador órfão.
  const fimRamo = main.indexOf("dev_aviso=1", inicioRamo);
  assert.ok(fimRamo > inicioRamo, "não achei o fim do ramo da flag de desenvolvimento");
  const ramoDev = main.slice(inicioRamo, fimRamo);
  assert.match(ramoDev, /assumir_console/, "o modo dev também precisa do console");
  assert.match(ramoDev, /stop_splash/, "e o splash tem de sair antes, no modo dev também");
});

test("o DEFERRED_TAKEOVER continua, e agora tem contrapartida", () => {
  // A opção existe por um motivo bom (não pintar preto antes do splash). O que
  // faltava era o gatilho — sem ele, o fbcon nunca assume e o console não
  // existe. Este teste amarra os dois lados para ninguém remover só um.
  for (const f of [
    "device/r35s/linux.fragment",
    "device/powkiddy x55/linux.fragment",
    "device/powkiddy x35h/linux.fragment",
  ]) {
    const frag = readFileSync(`${ROOT}${f}`, "utf8");
    assert.match(frag, /^CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y$/m, f);
    assert.match(frag, /^# CONFIG_LOGO is not set$/m, f);
  }
  assert.match(INIT, /assumir_console/, "o giochi-init é a contrapartida do DEFERRED_TAKEOVER");
});

test("o selftest distingue 'fbcon não assumiu' de 'rotação desligada'", () => {
  // As duas causas dão `fbcon/rotate=0`, e a correção é diferente: uma é
  // `CONFIG_FRAMEBUFFER_CONSOLE_ROTATION=y`, a outra é o takeover. O aviso
  // antigo mandava procurar no Kconfig uma opção que estava certa.
  const texto = readFileSync(
    `${ROOT}device/common/rootfs-overlay/usr/bin/giochi-selftest`,
    "utf8",
  );
  assert.match(texto, /vtconsole/, "a distinção vem do vtconsole");
  assert.match(texto, /fbcon não assumiu/, "e o texto tem de dizer qual das duas é");
});

// ── kernel: a janela preta do meio ───────────────────────────────────────

test("o fbcon não apaga a tela antes do splash subir", () => {
  // Sem DEFERRED_TAKEOVER o fbcon pinta preto ao carregar, e o psplash só sobe
  // no S01 — a janela preta no meio do boot parece travamento.
  for (const f of [
    "device/r35s/linux.fragment",
    "device/powkiddy x55/linux.fragment",
    "device/powkiddy x35h/linux.fragment",
  ]) {
    const frag = readFileSync(`${ROOT}${f}`, "utf8");
    assert.match(frag, /^CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y$/m, f);
    // E o pinguim sai: "pinguim -> preto -> nosso splash" não parece o mesmo
    // sistema.
    assert.match(frag, /^# CONFIG_LOGO is not set$/m, f);
  }
});
