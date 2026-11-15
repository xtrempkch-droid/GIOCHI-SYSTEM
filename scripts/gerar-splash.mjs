#!/usr/bin/env node
// ============================================================
// Giochi System — gera a imagem de bootsplash no tamanho da tela do aparelho
// ============================================================
// Uso:
//   node scripts/gerar-splash.mjs --largura 640 --altura 480 --out splash.png
//   node scripts/gerar-splash.mjs --device r35s --out dispositivo.png
//   node scripts/gerar-splash.mjs --device r35s --out s.png --bar-out bar.png
//
// ## Por que a imagem precisa ser gerada, e não uma só para todos
//
// O `psplash` **não escala nem centraliza**: ele desenha a imagem em (0,0) do
// framebuffer. Uma imagem de 640x480 numa tela de 720x1280 aparece no canto
// superior esquerdo, com o resto da tela preto — que é pior que não ter splash,
// porque parece defeito.
//
// Então a imagem é gerada no tamanho lógico da tela, em tempo de build, a
// partir da resolução e da rotação declaradas no `device.json` do aparelho.
//
// ## Por que PNG escrito à mão, sem dependência
//
// O projeto não usa npm (regra do AGENTS: scripts de metadados sem dependência).
// Um PNG de cor sólida + texto bitmap precisa de três coisas: CRC32, deflate e
// os chunks IHDR/IDAT/IEND. `zlib` do Node resolve o deflate; o resto é umas 40
// linhas. Assim o splash não quebra quando alguém roda o script numa máquina sem
// ImageMagick, e não há binário para auditar.
//
// ## O desenho: um bloco só
//
// O psplash NÃO desenha a barra junto com a imagem: ele pinta a imagem de fundo
// e, separadamente, a barra, numa linha fixa do framebuffer (`height * 5/6` por
// padrão). Enquanto ninguém combinou os dois, a tela mostrava o logo no meio e
// a barra solta lá embaixo — medido no X55 em 14/11/2026.
//
// A composição agora é uma só: "GIOCHI OS" (branco + azul) e, logo abaixo, uma
// barra de progresso da MESMA largura do logo. O que garante o alinhamento:
//
//   - `config/psplash/psplash-config.h` move a linha da barra para 9/16 da
//     altura e desliga o modo "imagem em 5/6" (a imagem passa a ser desenhada
//     em 0,0);
//   - este script posiciona o texto usando a MESMA fração (9/16), logo acima
//     dela;
//   - `--bar-out` gera a barra no mesmo tamanho, e o pacote a recebe por
//     `config/package-overrides.mk`.
//
// Os dois lados não podem divergir em silêncio: `tests/bootsplash.test.mjs`
// lê a fração do header e compara com o gerador.
// ============================================================

import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Paleta — a mesma do resto da identidade, para não inventar cor aqui
// ---------------------------------------------------------------------------
const FUNDO = [0x10, 0x12, 0x16]; // quase preto, azulado
const TEXTO = [0xf2, 0xf4, 0xf8]; // branco levemente quente
const DESTAQUE = [0x3d, 0x9a, 0xff]; // azul do projeto
const TRILHO = [0x24, 0x28, 0x30]; // barra vazia

// ---------------------------------------------------------------------------
// Fonte bitmap 5x7 — desenhada para este uso, sem dependência de licença
// ---------------------------------------------------------------------------
// Cada caractere é uma lista de 7 linhas de 5 bits (1 = pixel aceso).
const FONTE = {
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
};

// ---------------------------------------------------------------------------
// Canvas RGB
// ---------------------------------------------------------------------------
function novoCanvas(largura, altura, cor) {
  const px = Buffer.alloc(largura * altura * 3);
  for (let i = 0; i < largura * altura; i += 1) {
    px[i * 3] = cor[0];
    px[i * 3 + 1] = cor[1];
    px[i * 3 + 2] = cor[2];
  }
  return { largura, altura, px };
}

function pinta(canvas, x, y, cor) {
  if (x < 0 || y < 0 || x >= canvas.largura || y >= canvas.altura) return;
  const i = (y * canvas.largura + x) * 3;
  canvas.px[i] = cor[0];
  canvas.px[i + 1] = cor[1];
  canvas.px[i + 2] = cor[2];
}

function retangulo(canvas, x, y, largura, altura, cor) {
  for (let dy = 0; dy < altura; dy += 1) {
    for (let dx = 0; dx < largura; dx += 1) {
      pinta(canvas, x + dx, y + dy, cor);
    }
  }
}

/** Desenha texto com a fonte 5x7, ampliado por `escala`. Devolve a largura usada. */
function texto(canvas, str, x, y, escala, cor) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const glifo = FONTE[ch];
    if (!glifo) {
      cx += 6 * escala;
      continue;
    }
    for (let linha = 0; linha < 7; linha += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (!(glifo[linha] & (1 << (4 - col)))) continue;
        retangulo(canvas, cx + col * escala, y + linha * escala, escala, escala, cor);
      }
    }
    cx += 6 * escala; // 5 de glifo + 1 de espaço
  }
  return cx - x;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

function paraPng(canvas) {
  const { largura, altura, px } = canvas;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro padrão
  ihdr[12] = 0; // sem entrelaçamento

  // Cada linha do PNG começa com um byte de filtro. 0 = None. Filtro None
  // comprime pior, mas é o único que não precisa de estado entre linhas — e o
  // splash tem áreas grandes de cor sólida, que o deflate resolve sozinho.
  const cru = Buffer.alloc(altura * (1 + largura * 3));
  for (let y = 0; y < altura; y += 1) {
    const destino = y * (1 + largura * 3);
    cru[destino] = 0;
    px.copy(cru, destino + 1, y * largura * 3, (y + 1) * largura * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(cru, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
let largura = 0;
let altura = 0;
let saida = "";
let barraSaida = "";
let deviceId = "";

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--largura") largura = Number(argv[++i]);
  else if (a === "--altura") altura = Number(argv[++i]);
  else if (a === "--out") saida = resolve(argv[++i] ?? "");
  else if (a === "--bar-out") barraSaida = resolve(argv[++i] ?? "");
  else if (a === "--device") deviceId = argv[++i] ?? "";
  else if (a === "-h" || a === "--help") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n").slice(1, 8).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(0);
  } else {
    console.error(`ERRO: argumento desconhecido: ${a}`);
    process.exit(2);
  }
}

let rotacao = 0;

// A resolução vem do device.json quando --device é usado: a mesma fonte da
// verdade que gera a cmdline e o DTB. Um número digitado à mão aqui divergiria
// do painel em silêncio.
if (deviceId) {
  const indice = JSON.parse(readFileSync(resolve(ROOT, "device/devices.json"), "utf8"));
  const lista = indice.devices ?? indice;
  const dev = lista.find((d) => d.id === deviceId);
  if (!dev) {
    console.error(`ERRO: aparelho desconhecido: ${deviceId}`);
    console.error(`Conhecidos: ${lista.map((d) => d.id).join(", ")}`);
    process.exit(2);
  }
  const meta = JSON.parse(
    readFileSync(resolve(ROOT, "device", dev.folder, "device.json"), "utf8"),
  );
  const painel = meta.panel;
  if (!painel?.width || !painel?.height) {
    console.error(`ERRO: ${deviceId} não declara panel { width, height } no device.json`);
    console.error("  O psplash NÃO escala a imagem: ele desenha em (0,0). Sem a");
    console.error("  resolução nativa, o splash sai no canto com o resto preto.");
    process.exit(2);
  }
  largura = painel.width;
  altura = painel.height;
  rotacao = meta.kernelCmdline?.fbconRotate ?? 0;
  if (!Number.isInteger(rotacao) || rotacao < 0 || rotacao > 3) {
    console.error(`ERRO: ${deviceId} declara fbconRotate inválido: ${rotacao}`);
    process.exit(2);
  }
}

if (!largura || !altura) {
  console.error("ERRO: informe --largura e --altura, ou --device <id>");
  process.exit(2);
}
if (!saida) {
  console.error("ERRO: informe --out <arquivo.png>");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Geometria — a mesma fração de `config/psplash/psplash-config.h`
// ---------------------------------------------------------------------------
// `psplash.c` calcula a linha da barra como
// `height - ((DEN - NUM) * height / DEN)`, em aritmética inteira. Repetimos a
// expressão aqui, e não `height * 9/16`, porque o truncamento do C e o
// arredondamento do JS divergem em uma linha de pixel para alturas ímpares.
// Um pixel de diferença é o bastante para a barra encostar no texto.
const SPLIT_NUMERADOR = 9;
const SPLIT_DENOMINADOR = 16;

function linhaDaBarra(altura) {
  return altura - Math.floor(((SPLIT_DENOMINADOR - SPLIT_NUMERADOR) * altura) / SPLIT_DENOMINADOR);
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------
// psplash aplica a rotação ao desenho inteiro com `-a`; para rotações de 90°
// ou 270°, a imagem de entrada precisa estar em orientação paisagem.
const canvasLogico = rotacao % 2 === 0
  ? novoCanvas(largura, altura, FUNDO)
  : novoCanvas(altura, largura, FUNDO);

/**
 * Desenha o logo acima da linha da barra. Devolve a geometria usada, para a
 * barra ser gerada no mesmo tamanho e na mesma coluna.
 */
function desenharLockup(canvas) {
  const escala = Math.max(2, Math.round(canvas.largura / 108));
  const avanco = 6 * escala;
  const alturaTexto = 7 * escala;

  const esquerda = "GIOCHI";
  const direita = "OS";
  const larguraEsquerda = (esquerda.length * 6 - 1) * escala;
  const larguraDireita = (direita.length * 6 - 1) * escala;
  // Um caractere de espaço entre as duas palavras, e nada depois da última.
  const larguraTotal = larguraEsquerda + avanco + larguraDireita;

  const barraY = linhaDaBarra(canvas.altura);
  const barraAltura = Math.max(14, Math.round(canvas.altura * 0.022));
  const vao = Math.max(2 * escala, Math.round(canvas.altura * 0.02));
  const textoY = barraY - vao - alturaTexto;

  // `floor`, como a divisão inteira do C que o psplash usa para centralizar a
  // barra — senão os dois ficam 1 px fora de eixo em largura ímpar.
  const x = Math.floor((canvas.largura - larguraTotal) / 2);

  texto(canvas, esquerda, x, textoY, escala, TEXTO);
  texto(canvas, direita, x + larguraEsquerda + avanco, textoY, escala, DESTAQUE);

  return { x, textoY, escala, larguraTotal, barraY, barraAltura };
}

/**
 * A barra que o psplash desenha e anima.
 *
 * Ela vai num PNG separado (`--bar-out`) porque o psplash desenha a barra a
 * partir de `base-images/psplash-bar.png` e pinta o progresso por cima com as
 * cores de `psplash-colors.h`. Formato de cápsula (raio = metade da altura): o
 * miolo que ele preenche entra com 4 px de margem em cima e embaixo, então o
 * preenchimento fica como um filete dentro da cápsula.
 */
function canvasDaBarra(larguraBarra, alturaBarra) {
  const canvas = novoCanvas(larguraBarra, alturaBarra, FUNDO);
  const raio = alturaBarra / 2;
  const centroY = alturaBarra / 2;

  for (let y = 0; y < alturaBarra; y += 1) {
    for (let x = 0; x < larguraBarra; x += 1) {
      const px = x + 0.5;
      const dx = Math.max(raio - px, 0, px - (larguraBarra - raio));
      const dy = y + 0.5 - centroY;
      if (dx * dx + dy * dy <= raio * raio) pinta(canvas, x, y, TRILHO);
    }
  }
  return canvas;
}

const geo = desenharLockup(canvasLogico);

const png = paraPng(canvasLogico);
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, png);

let barraPng = null;
if (barraSaida) {
  barraPng = paraPng(canvasDaBarra(geo.larguraTotal, geo.barraAltura));
  mkdirSync(dirname(barraSaida), { recursive: true });
  writeFileSync(barraSaida, barraPng);
}

console.log(`splash: ${saida}`);
console.log(`  painel: ${largura}x${altura}; imagem lógica: ${canvasLogico.largura}x${canvasLogico.altura}`);
console.log(`  rotação fbcon: ${rotacao}; aplicada pelo psplash ao desenho completo`);
console.log(
  `  logo: escala ${geo.escala}, ${geo.larguraTotal}px de largura, em y=${geo.textoY}`,
);
console.log(
  `  barra: ${geo.larguraTotal}x${geo.barraAltura} em y=${geo.barraY} ` +
    `(${SPLIT_NUMERADOR}/${SPLIT_DENOMINADOR} da altura)` +
    (barraPng ? ` → ${barraSaida}` : " (sem --bar-out: NÃO gerada)"),
);
console.log(`  ${(png.length / 1024).toFixed(1)} KiB`);
