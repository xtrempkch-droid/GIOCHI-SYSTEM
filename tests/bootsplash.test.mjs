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

const ROOT = new URL("..", import.meta.url).pathname;
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

test("o build gera o splash antes do make", () => {
  const sh = readFileSync(`${ROOT}scripts/build-device.sh`, "utf8");
  assert.match(sh, /gerar-splash\.mjs/);
  assert.match(sh, /GIOCHI_SPLASH_PNG/);
  // O caminho tem de ir para work/, não para a pasta do aparelho: caminho com
  // espaço entraria cru numa variável de make (§12.6).
  assert.match(sh, /SPLASH_PNG="\$WORK_DIR\/splash\.png"/);
  // E falhar ao gerar NÃO pode derrubar o build — sem splash o aparelho boota.
  const bloco = sh.slice(sh.indexOf("SPLASH_PNG="), sh.indexOf("SPLASH_PNG=") + 900);
  assert.match(bloco, /NÃO gerado/);
  assert.ok(!/^\s*exit 1\s*$/m.test(bloco), "splash é cosmético: não derruba o build");
});

// ── a imagem ─────────────────────────────────────────────────────────────

test("a imagem é gerada NO TAMANHO DA TELA do aparelho", () => {
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
      assert.equal(png.largura, largura, `${id}: largura`);
      assert.equal(png.altura, altura, `${id}: altura`);
      // E o arquivo tem de ser pequeno: é um logo, não uma fotografia. Acima de
      // 50 KiB indicaria que algo inesperado entrou no desenho.
      assert.ok(statSync(out).size < 50 * 1024, `${id}: ${statSync(out).size} B`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("o desenho tem texto legível, barra e fundo — nos dois tamanhos", () => {
  // "Gerou PNG" e "gerou splash legível" são perguntas diferentes. Aqui o teste
  // olha os pixels: um PNG de cor sólida passaria no teste de assinatura.
  const tmp = mkdtempSync(join(tmpdir(), "giochi-splash-px-"));
  try {
    for (const [id, largura, altura] of [["r35s", 640, 480], ["powkiddy-x55", 720, 1280]]) {
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

      // 3. barra na base, no tom do trilho (0x24,0x28,0x30)
      const yBarra = altura - Math.round(altura * 0.12);
      let trilho = 0;
      for (let x = 0; x < largura; x += 1) {
        const c = png.cor(x, yBarra);
        if (c[0] === 0x24 && c[1] === 0x28 && c[2] === 0x30) trilho += 1;
      }
      assert.ok(trilho > largura * 0.6, `${id}: barra com ${trilho} de ${largura} px`);
    }
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
  assert.match(sh, /psplash -n/, "o `-n` evita que ele morra ao fechar o FIFO");
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

test("stop_splash usa QUIT e tem o kill como reserva", () => {
  const bloco = INIT.slice(INIT.indexOf("stop_splash()"), INIT.indexOf("wait_for_launcher()"));
  assert.match(bloco, /psplash-write "QUIT"/, "QUIT é o caminho normal");
  assert.match(bloco, /pidof psplash/, "kill como reserva se o FIFO sumiu");
  // Idempotente: chamar duas vezes não pode falhar.
  assert.match(bloco, /\[ -p \/tmp\/psplash_fifo \] \|\| return 0/);
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
