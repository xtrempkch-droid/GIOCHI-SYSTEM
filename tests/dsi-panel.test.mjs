#!/usr/bin/env node
// Overlays de painel do R35S/R36S: o formato `panel_description` e a conta do
// refresh.
//
// Por que isto existe: o R35S e os clones saem de fábrica com pelo menos cinco
// painéis diferentes, e escolher o overlay errado dá **tela preta sem
// mensagem**. Sem um jeito de comparar os cinco com números, o único método é
// "troca até ligar" — que é o que se faz quando não se entende o artefato.
//
// Os arquivos em `device/r35s/panels/` são o texto EXTRAÍDO dos `.dtbo` do
// ROCKNIX, guardado em texto e não em binário de propósito: um `.dtbo` no Git
// não mostra o que mudou, e a descrição é a parte que importa.
//
// A conta central (verificada contra o comentário `# 60` que o autor do overlay
// deixou): `refresh = clock ÷ (htotal × vtotal)`, com
//
//   htotal = ativo + front porch + sync width + back porch
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  checkDeclaredRefresh,
  checkGeometry,
  defaultMode,
  parsePanelDescription,
  splitLines,
  summarize,
} from "../scripts/lib/dsi-panel.mjs";

const PANELS_DIR = new URL("../device/r35s/panels/", import.meta.url);

function load(name) {
  return parsePanelDescription(readFileSync(new URL(`${name}.txt`, PANELS_DIR), "utf8"));
}

const NAMES = readdirSync(PANELS_DIR)
  .filter((file) => file.endsWith(".txt"))
  .map((file) => file.replace(/\.txt$/, ""))
  .sort();

// ── o que os cinco overlays dizem ───────────────────────────

test("os cinco overlays do R35S estão versionados em texto", () => {
  assert.deepEqual(NAMES, [
    "r36s-panel1",
    "r36s-panel2",
    "r36s-panel3",
    "r36s-panel4",
    "r36s_clone",
  ]);
});

test("todos declaram 640x480, 4 lanes, rgb888", () => {
  for (const name of NAMES) {
    const panel = load(name);
    const mode = defaultMode(panel);
    assert.equal(mode.active.width, 640, `${name}: largura`);
    assert.equal(mode.active.height, 480, `${name}: altura`);
    assert.equal(panel.general.lanes, 4, `${name}: lanes`);
    assert.equal(panel.general.format, "rgb888", `${name}: formato`);
    assert.equal(panel.general.flags, 0xe03, `${name}: flags`);
  }
});

test("o painel4 declara 60, 50 e 75 Hz - e a conta confere", () => {
  const panel = load("r36s-panel4");
  assert.equal(panel.modes.length, 3);

  // Estes três são os únicos com refresh escrito em comentário, então são a
  // única oportunidade de validar o modelo `clock ÷ (htotal × vtotal)` contra
  // a intenção declarada pelo autor do overlay.
  const esperado = [
    { declared: 60, hTotal: 732, vTotal: 661 },
    { declared: 50, hTotal: 732, vTotal: 792 },
    { declared: 75, hTotal: 732, vTotal: 528 },
  ];

  for (const [index, mode] of panel.modes.entries()) {
    assert.equal(mode.declaredHz, esperado[index].declared, `modo ${index}: Hz declarado`);
    assert.equal(mode.hTotal, esperado[index].hTotal, `modo ${index}: htotal`);
    assert.equal(mode.vTotal, esperado[index].vTotal, `modo ${index}: vtotal`);
    const drift = Math.abs(mode.refreshHz - mode.declaredHz) / mode.declaredHz;
    assert.ok(drift < 0.01, `modo ${index}: ${mode.refreshHz} Hz contra ${mode.declaredHz} declarado`);
  }

  assert.deepEqual(checkDeclaredRefresh(panel), [], "nenhuma divergência de refresh");
});

test("o modo default do painel4 é o de 60 Hz", () => {
  const panel = load("r36s-panel4");
  const mode = defaultMode(panel);
  assert.equal(mode.isDefault, true);
  assert.equal(Math.round(mode.refreshHz), 60);
});

test("os outros quatro não declaram Hz - e por isso a conta não é conferível", () => {
  // Isto é honestidade sobre limite de dado, não detalhe: sem comentário não há
  // como saber se o clock foi escolhido para 60 Hz ou para outra coisa. Registra
  // o valor CALCULADO para que a diferença apareça no relatório.
  const calculado = {};
  for (const name of NAMES) {
    const panel = load(name);
    const mode = defaultMode(panel);
    calculado[name] = panel.modes.every((m) => m.declaredHz === null)
      ? null
      : "declara";
    if (name !== "r36s-panel4") {
      assert.equal(mode.declaredHz, null, `${name}: não deveria ter Hz declarado`);
      assert.ok(mode.refreshHz > 0, `${name}: refresh calculado tem de ser positivo`);
    }
  }
  assert.equal(calculado["r36s-panel4"], "declara");
  assert.ok(Object.values(calculado).includes(null));
});

test("nenhum overlay declara refresh incompatível com os próprios timings", () => {
  for (const name of NAMES) {
    assert.deepEqual(checkDeclaredRefresh(load(name)), [], `${name}`);
  }
});

// ── a geometria: `size` é (lado curto, lado longo) ──────────

test("size=52,70 confere com 640x480 - e a ordem do par importa", () => {
  // 70/52 = 1,346 contra 640/480 = 1,333. Lido como (largura, altura) daria
  // 0,743, e quatro painéis corretos seriam acusados de erro. A comparação é
  // sem rotação de propósito.
  for (const name of ["r36s-panel1", "r36s-panel2", "r36s-panel3", "r36s-panel4"]) {
    assert.deepEqual(checkGeometry(load(name)), [], `${name}: não deveria acusar`);
  }
});

test("o r36s_clone tem geometria inconsistente e é sinalizado", () => {
  const problems = checkGeometry(load("r36s_clone"));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].size, "153x85 mm");
  assert.equal(problems[0].mode, "640x480");
  // 153x85 é um painel 16:9 de ~7", e os 12 modos são 4:3. Um dos dois lados
  // está errado; os quatro painéis 52x70 não têm esse problema.
  assert.ok(problems[0].drift > 0.3, `divergência de ${problems[0].drift}`);
});

// ── a armadilha do separador ────────────────────────────────

test("as linhas vêm separadas por NUL, não por newline", () => {
  // Ler a propriedade com `split("\n")` devolve tudo como uma linha e todo
  // parse por linha falha em silêncio. Medido no .dtbo real.
  const text = "G size=52,70 delays=20,150,20,120,20 format=rgb888 lanes=4 flags=0xe03\u0000" +
    "M clock=29000 horizontal=640,46,2,44 vertical=480,165,2,14 default=1 # 60\u0000" +
    "I seq=11 wait=200\u0000#END\u0000";
  const lines = splitLines(text);
  assert.equal(lines.length, 4);
  assert.ok(lines[1].startsWith("M clock=29000"));

  const panel = parsePanelDescription(text);
  assert.equal(panel.modes.length, 1);
  assert.equal(panel.modes[0].declaredHz, 60);
  assert.equal(panel.ended, true);
});

test("o texto salvo usa newline e produz o mesmo resultado", () => {
  const fromFile = load("r36s-panel4");
  const text = readFileSync(new URL("r36s-panel4.txt", PANELS_DIR), "utf8");
  const nulVersion = text.split("\n").join("\u0000");
  assert.deepEqual(
    summarize("x", parsePanelDescription(nulVersion)),
    summarize("x", fromFile),
    "a mesma descrição em NUL e em newline tem de dar o mesmo painel",
  );
});

// ── sequência de inicialização ──────────────────────────────

test("a sequência de init separa comando DCS de dados", () => {
  const panel = load("r36s-panel4");
  const first = panel.init[0];
  assert.equal(first.command, 0xff, "primeiro byte é o comando DCS");
  assert.equal(first.data.toString("hex"), "30", "o resto é o payload");
  assert.equal(first.origCmd, 0x15);

  // O painel4 tem DOIS comandos 0x11: um `seq=1100` no meio (0x11 com payload,
  // gravado como short write de 1 parâmetro) e o `seq=11 wait=200` no fim. O que
  // liga a tela é o último, e é o único com espera — procurar por `.find()` pega
  // o primeiro e o teste passaria a verificar a coisa errada.
  const sleepOuts = panel.init.filter((item) => item.command === 0x11);
  assert.equal(sleepOuts.length, 2, "o painel4 declara dois comandos 0x11");
  const real = sleepOuts[sleepOuts.length - 1];
  assert.equal(real.data.length, 0, "o 0x11 de verdade não tem payload");
  assert.equal(real.waitMs, 200, "e espera 200 ms antes de seguir");

  const displayOns = panel.init.filter((item) => item.command === 0x29);
  assert.ok(displayOns.length >= 2, "o painel4 também tem um 0x29 no meio da sequência");
  const displayOn = displayOns[displayOns.length - 1];
  assert.equal(displayOn.data.length, 0, "o 0x29 que liga o display não tem payload");
  assert.equal(displayOn.waitMs, 20);
});

test("os dois últimos comandos são sempre sleep-out e display-on", () => {
  // A ordem importa: 0x29 antes do 0x11 deixa a tela apagada. Olhar o fim da
  // sequência é o que verifica a ordem; procurar por presença não verifica nada.
  for (const name of NAMES) {
    const panel = load(name);
    const commands = panel.init.map((item) => item.command);
    assert.equal(commands[commands.length - 1], 0x29, `${name}: último tem de ser 0x29`);
    assert.equal(commands[commands.length - 2], 0x11, `${name}: penúltimo tem de ser 0x11`);
  }
});

test("toda sequência termina com sleep-out, espera e display-on", () => {
  // Se faltar o 0x11 ou o 0x29, a tela fica preta com o driver "ok" — o pior
  // tipo de falha, porque o kernel não reclama de nada.
  for (const name of NAMES) {
    const panel = load(name);
    const commands = panel.init.map((item) => item.command);
    assert.ok(commands.includes(0x11), `${name}: sem 0x11 (sleep out)`);
    assert.ok(commands.includes(0x29), `${name}: sem 0x29 (display on)`);
    assert.ok(panel.counts.initDelayMs > 0, `${name}: sem espera na sequência`);
  }
});

test("o painel2 e o painel3 são quase idênticos, mas não iguais", () => {
  // Saber QUE diferem evita a conclusão errada de "são o mesmo painel, tanto
  // faz". O painel3 tem um comando a mais.
  const p2 = load("r36s-panel2");
  const p3 = load("r36s-panel3");
  assert.equal(Math.abs(p2.counts.init - p3.counts.init), 1);
  assert.notEqual(
    p2.init.map((i) => i.command).join(","),
    p3.init.map((i) => i.command).join(","),
  );
});

// ── erro de formato tem de estourar, nunca passar ───────────

test("descrição sem G, sem M, com tag desconhecida ou hex ímpar falha alto", () => {
  assert.throws(
    () => parsePanelDescription("M clock=29000 horizontal=640,1,1,1 vertical=480,1,1,1"),
    /sem linha G/,
  );
  assert.throws(
    () => parsePanelDescription("G size=52,70 delays=1,1,1,1,1 format=rgb888 lanes=4"),
    /sem linha M/,
  );
  assert.throws(
    () =>
      parsePanelDescription(
        "G size=52,70 delays=1,1,1,1,1 format=rgb888 lanes=4\n" +
          "M clock=29000 horizontal=640,1,1,1 vertical=480,1,1,1\n" +
          "X nada=1",
      ),
    /linha desconhecida/,
  );
  assert.throws(
    () =>
      parsePanelDescription(
        "G size=52,70 delays=1,1,1,1,1 format=rgb888 lanes=4\n" +
          "M clock=29000 horizontal=640,1,1,1 vertical=480,1,1,1\n" +
          "I seq=abc",
      ),
    /ímpar/,
  );
});

test("resumo traz o que a tabela precisa, e o refresh é do modo default", () => {
  const summary = summarize("r36s-panel4", load("r36s-panel4"));
  assert.equal(summary.width, 52);
  assert.equal(summary.height, 70);
  assert.equal(summary.lanes, 4);
  assert.equal(summary.clockKhz, 29000);
  assert.equal(summary.hTotal, 732);
  assert.equal(summary.vTotal, 661);
  assert.equal(Math.round(summary.refreshHz), 60);
  assert.equal(summary.modes, 3);
  assert.equal(summary.initCommands, 155);
});
