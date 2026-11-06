#!/usr/bin/env node
// Console serial do R35S: o que o DTB declara tem de ser o que o device.json usa.
//
// Por que este teste existe: em 04/11/2026 gastei uma sessão varrendo 12 bauds no
// escuro para descobrir onde estava o console desta placa. O valor estava no DTB
// versionado o tempo todo — `/chosen/stdout-path = "serial2:1500000n8"`. O erro
// não foi medir mal, foi não ter lido o artefato que já estava no repositório.
//
// Em 06/11/2026 o aparelho confirmou pela serial: a cmdline real do R35S é
// `console=ttyS2,1500000`. O `compatible` da unidade é idêntico ao do arquivo em
// `dts/`, então este DTB é mesmo o dela — não um parecido.
//
// Estes testes prendem as duas metades: o DTB (evidência) e o device.json
// (o que o build usa). Mexer num sem o outro passa a falhar aqui, e não num
// aparelho com tela preta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildKernelCmdline } from "../scripts/lib/cmdline.mjs";
import { parseFdt, walkFdt } from "../scripts/lib/fdt.mjs";

const DTB = new URL("../device/r35s/dts/rk3326-gameconsole-r36s.dtb", import.meta.url);
const DEVICE = new URL("../device/r35s/device.json", import.meta.url);

const device = JSON.parse(readFileSync(DEVICE, "utf8"));
const root = parseFdt(readFileSync(DTB));

function nodeAt(path) {
  let found = null;
  walkFdt(root, (node, here) => {
    if (here === path) found = node;
  });
  assert.ok(found, `nó ${path} não existe no DTB`);
  return found;
}

function stringProp(node, name) {
  const data = node.props.get(name);
  if (!data) return null;
  let end = 0;
  while (end < data.length && data[end] !== 0) end += 1;
  return data.toString("utf8", 0, end);
}

function stringList(node, name) {
  const data = node.props.get(name);
  if (!data) return [];
  return data.toString("utf8").split("\0").map((s) => s.trim()).filter(Boolean);
}

/** "/chosen/stdout-path" → { alias: "serial2", baud: 1500000, frame: "n8" } */
function stdoutPath() {
  const raw = stringProp(nodeAt("/chosen"), "stdout-path");
  assert.ok(raw, "/chosen/stdout-path ausente: sem ele, onde está o console é adivinhação");
  const match = /^(?<alias>[a-z0-9]+):(?<baud>\d+)(?<frame>[a-z0-9]*)$/i.exec(raw);
  assert.ok(match, `stdout-path "${raw}" não está no formato <alias>:<baud><frame>`);
  return { alias: match.groups.alias, baud: Number(match.groups.baud), frame: match.groups.frame };
}

test("o DTB do R35S é o da própria placa", () => {
  const compatible = stringList(nodeAt("/"), "compatible");
  // Se alguém trocar este DTB pelo de outra placa da pasta rk3326 (são 15), a
  // UART muda e a placa fica sem console — sem nenhuma mensagem dizendo isso.
  assert.ok(
    compatible.includes("gameconsole,r35s"),
    `compatible inesperado: ${compatible.join(" ")}`,
  );
  assert.ok(compatible.includes("rockchip,rk3326"), "o SoC tem de ser rk3326");
});

test("o DTB declara o console em serial2 a 1500000", () => {
  const out = stdoutPath();
  assert.equal(out.alias, "serial2");
  assert.equal(out.baud, 1500000);
  assert.equal(out.frame, "n8");
});

test("serial2 aponta para a UART em 0xff160000 e é px30-uart", () => {
  const alias = stringProp(nodeAt("/aliases"), "serial2");
  assert.equal(alias, "/serial@ff160000");

  const node = nodeAt("/serial@ff160000");
  assert.ok(stringList(node, "compatible").includes("rockchip,px30-uart"));
  // Este DTB usa #address-cells = 2: o `reg` é endereço de 64 bits em duas
  // células (<hi lo tamanho_hi tamanho_lo>), não um u32. Ler só a primeira
  // célula devolve zero e o teste passaria a testar nada.
  const reg = node.props.get("reg");
  assert.ok(reg && reg.length >= 8, "/serial@ff160000 sem reg");
  const address = reg.readUInt32BE(0) * 0x100000000 + reg.readUInt32BE(4);
  assert.equal(address, 0xff160000);
});

test("o device.json usa o console que o DTB declara", () => {
  const out = stdoutPath();
  const spec = device.kernelCmdline;
  assert.ok(spec, "kernelCmdline ausente no device.json");

  // ttyS2 ↔ serial2: o nome do tty é o do driver (8250), o alias é o do DTB.
  assert.equal(spec.console, `tty${out.alias.replace("serial", "S")}`);
  assert.equal(spec.baud, out.baud);
});

test("a cmdline composta reproduz a do aparelho", () => {
  // Medido em 06/11/2026: `console=ttyS2,1500000` (o `n8` vem explícito).
  const cmdline = buildKernelCmdline(device.kernelCmdline, { partuuid: "0000-0000" });
  assert.match(cmdline, /console=ttyS2,1500000n8/);
});

test("não declara earlycon que não foi medido", () => {
  // O ROCKNIX que roda nesta placa NÃO usa earlycon. Declarar um endereço sem
  // medir trocaria "console aparece depois do driver subir" por "earlycon errado
  // e console mudo desde o começo" — pior, e indistinguível de linha quebrada.
  assert.equal(
    device.kernelCmdline.earlycon,
    undefined,
    "earlycon só entra depois de medido no aparelho",
  );
});

test("a resolução medida é 640x480, e a cmdline não tenta mudá-la", () => {
  // `video=` não cria modo em painel DSI; num painel 640x480 ele é ignorado ou
  // apaga a tela (§12.23). A resolução se muda no driver do painel.
  assert.equal(device.kernelCmdline.video, undefined);
});
