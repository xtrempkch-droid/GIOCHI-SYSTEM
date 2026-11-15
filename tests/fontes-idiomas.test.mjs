#!/usr/bin/env node
// As fontes das dez escritas do launcher.
//
// Pedido da equipe do app em 15/11/2026 (issue #5 do GIOCHI-SYSTEM): o launcher
// passou a ter os dez idiomas do site e desenha **por string** — a principal
// (DejaVu) cobre o latim, e a fonte da escrita entra só no texto que ela não
// cobre. Nada disso precisa de mudança no sistema, desde que as fontes existam.
//
// Medido por eles no R35S, com `TTF_GlyphIsProvided`:
//
//   en/es/fr/pt  15/15      legível
//   ru           10/10      legível
//   ar/ur        10/10      legível (o DejaVu cobre o alfabeto árabe)
//   zh            5/8       quadradinho no que falta
//   hi            1/11      praticamente tudo quadradinho
//   bn            1/10      idem
//
// Três escritas faltavam, e cada uma tem um caminho diferente:
//
//   CJK        `BR2_PACKAGE_WQY_ZENHEI=y` — o pacote JÁ está no Buildroot e
//              instala em `/usr/share/fonts/wqy-zenhei/`, que é um dos
//              `DIRETORIOS_FONTE` do launcher. Uma linha por defconfig.
//   devanágari } não há pacote do Buildroot que instale no diretório que o app
//   bengali    } varre (`googlefontdirectory` põe cada família na pasta dela,
//                e baixa o repositório inteiro do google/fonts). As duas fontes
//                estão versionadas em
//                `device/common/rootfs-overlay/usr/share/fonts/truetype/noto/`.
//
// **O teste pergunta pela consequência, não pela intenção.** "O arquivo existe"
// e "a fonte cobre a escrita" são perguntas diferentes — e a diferença é
// exatamente o sintoma da issue (arquivo presente, quadradinho na tela). Por
// isso aqui há um leitor de `cmap` de TrueType de verdade, que responde
// "este código Unicode tem glifo?".

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const NOTO_DIR = path.join(
  ROOT,
  "device", "common", "rootfs-overlay", "usr", "share", "fonts", "truetype", "noto",
);

/// Lê a tabela `cmap` de um TrueType e devolve o conjunto de códigos cobertos.
///
/// Só os formatos 4 (BMP) e 12 (full Unicode) interessam: são os que fonte
/// de escrita real usa. Se nenhum dos dois existir, é mais honesto falhar do
/// que devolver conjunto vazio e fazer o teste "passar" sem testar nada.
function codigosDoCmap(arquivo) {
  const d = readFileSync(arquivo);
  const numTables = d.readUInt16BE(4);

  let offsetCmap = null;
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    if (d.toString("latin1", p, p + 4) === "cmap") {
      offsetCmap = d.readUInt32BE(p + 8);
      break;
    }
  }
  assert.ok(offsetCmap !== null, `${path.basename(arquivo)}: sem tabela cmap`);

  const nSub = d.readUInt16BE(offsetCmap + 2);
  let escolhido = null;
  for (let i = 0; i < nSub; i++) {
    const p = offsetCmap + 4 + i * 8;
    const sub = d.readUInt32BE(p + 4);
    const fmt = d.readUInt16BE(offsetCmap + sub);
    if (fmt === 12) { escolhido = { fmt, base: offsetCmap + sub }; break; }
    if (fmt === 4 && escolhido === null) escolhido = { fmt, base: offsetCmap + sub };
  }
  assert.ok(escolhido, `${path.basename(arquivo)}: cmap sem formato 4 nem 12`);

  const codigos = new Set();
  if (escolhido.fmt === 4) {
    const segX2 = d.readUInt16BE(escolhido.base + 6);
    const seg = segX2 / 2;
    const ends = escolhido.base + 14;
    const starts = ends + segX2 + 2;
    for (let i = 0; i < seg; i++) {
      const ini = d.readUInt16BE(starts + i * 2);
      const fim = d.readUInt16BE(ends + i * 2);
      if (ini === 0xffff) continue;
      for (let c = ini; c <= fim; c++) codigos.add(c);
    }
  } else {
    const grupos = d.readUInt32BE(escolhido.base + 12);
    for (let g = 0; g < grupos; g++) {
      const p = escolhido.base + 16 + g * 12;
      const ini = d.readUInt32BE(p);
      const fim = d.readUInt32BE(p + 4);
      for (let c = ini; c <= fim; c++) codigos.add(c);
    }
  }
  return codigos;
}

function cobertura(arquivo, texto) {
  const codigos = codigosDoCmap(arquivo);
  const faltando = [...texto].filter((c) => !codigos.has(c.codePointAt(0)));
  return { total: [...texto].length, faltando };
}

// ── as fontes que precisam existir, e a escrita que cada uma atende ─────────

const FONTES = [
  {
    arquivo: "NotoSansDevanagari-Regular.ttf",
    escrita: "devanágari (hindi, mr, ne)",
    amostra: "हिन्दी",
  },
  {
    arquivo: "NotoSansBengali-Regular.ttf",
    escrita: "bengali (bn, as)",
    amostra: "বাংলা",
  },
];

test("as fontes de devanágari e bengali estão no diretório que o launcher varre", () => {
  // O caminho não é escolha livre: `DIRETORIOS_FONTE` em
  // `app/launcher-star-dust/crates/ui-sdl/src/draw.rs` do GIOCHI-APP lista
  // `/usr/share/fonts/truetype/noto`. Fonte num diretório fora dessa lista é
  // quadradinho na tela **com a fonte instalada** — o pior tipo de defeito,
  // porque um `find` mostra o arquivo e encerra a investigação.
  assert.equal(
    path.relative(ROOT, NOTO_DIR),
    path.join("device", "common", "rootfs-overlay", "usr", "share", "fonts", "truetype", "noto"),
    "as fontes Noto têm de morar em /usr/share/fonts/truetype/noto",
  );
  assert.ok(existsSync(NOTO_DIR), `${NOTO_DIR} não existe`);

  for (const { arquivo } of FONTES) {
    const alvo = path.join(NOTO_DIR, arquivo);
    assert.ok(existsSync(alvo), `${arquivo} não está em truetype/noto/`);
    const cabecalho = readFileSync(alvo).subarray(0, 4);
    const magic = cabecalho.toString("hex");
    assert.ok(
      magic === "00010000" || magic === "74727565" || magic === "4f54544f",
      `${arquivo}: não é TrueType/OpenType (magic ${magic})`,
    );
  }
});

test("cada fonte cobre de fato a escrita que ela existe para atender", () => {
  // É o teste que a issue pede, na forma verificável sem aparelho: o mesmo
  // critério que o `--fontes` do launcher usa (o glifo existe?), respondido
  // lendo o `cmap` em vez de olhar o nome do arquivo.
  for (const { arquivo, escrita, amostra } of FONTES) {
    const { total, faltando } = cobertura(path.join(NOTO_DIR, arquivo), amostra);
    assert.deepEqual(
      faltando,
      [],
      `${arquivo} não cobre "${amostra}" (${escrita}): faltam ${faltando.length}/${total}`,
    );
  }
});

test("nenhuma das duas cobre CJK — quem cobre é o wqy-zenhei", () => {
  // Controle negativo. Se alguém substituir as fontes por uma CJK "que serve
  // para tudo", o teste acima continua passando e o desenho muda: o launcher
  // escolhe a primeira fonte da cadeia que cobre o caractere, então uma fonte
  // latina gorda aqui roubaria o chinês do `wqy-zenhei`.
  for (const { arquivo } of FONTES) {
    const { faltando } = cobertura(path.join(NOTO_DIR, arquivo), "中文");
    assert.equal(
      faltando.length,
      2,
      `${arquivo} passou a cobrir CJK — o wqy-zenhei deixaria de ser usado`,
    );
  }
});

test("as licenças OFL acompanham as fontes", () => {
  // OFL-1.1 exige que o texto da licença ande junto com a fonte. Fonte sem
  // licença no artefato é problema de redistribuição, e o artefato de CI é
  // público (§12.14 é a mesma família).
  for (const { arquivo } of FONTES) {
    const familia = arquivo.replace(/^NotoSans/, "").replace(/-Regular\.ttf$/, "");
    const licenca = path.join(NOTO_DIR, `OFL-NotoSans${familia}.txt`);
    assert.ok(existsSync(licenca), `falta a licença de ${arquivo} (${licenca})`);
    const texto = readFileSync(licenca, "utf8");
    assert.match(texto, /SIL OPEN FONT LICENSE/i, `${licenca} não parece a OFL`);
    assert.match(texto, /Copyright 20\d\d The Noto Project Authors/i, `${licenca} sem o copyright`);
  }
});

test("todo aparelho que liga o texto latino liga o CJK", () => {
  // Invariante, não lista — a lição do §12.50: cobertura por caso num defeito de
  // classe deixa o próximo aparelho de fora. O `wqy-zenhei` é a metade do
  // pedido que o Buildroot já resolve com uma linha.
  const pasta = path.join(ROOT, "device");
  const comTela = [];
  for (const device of readdirSync(pasta)) {
    let texto;
    try {
      texto = readFileSync(path.join(pasta, device, "defconfig"), "utf8");
    } catch {
      continue; // sem defconfig próprio: usa o do Buildroot
    }
    if (!/^BR2_PACKAGE_DEJAVU=y$/m.test(texto)) continue;
    comTela.push(device);
    assert.match(
      texto,
      /^BR2_PACKAGE_WQY_ZENHEI=y$/m,
      `${device}: liga DejaVu (texto latino) e não liga WQY_ZENHEI — ` +
        `o idioma chinês sai em quadradinhos com a fonte ausente`,
    );
  }
  assert.ok(comTela.length >= 3, `esperava os três aparelhos com tela, achei ${comTela.length}`);
});
