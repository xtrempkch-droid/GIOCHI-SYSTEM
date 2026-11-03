import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// `buttons.map` é lido em runtime por `giochi-buttons` e `giochi-selftest`.
// Os dois derivam dele a QUANTIDADE de botões que esperam ver — e uma
// quantidade errada produz exatamente o falso negativo que o marcador
// OPCIONAL existe para evitar: a ferramenta fica presa em "falta 1 botão"
// para sempre e esconde um botão que realmente quebrou.
//
// Por isso o mapa é um contrato testado, não um comentário.

const MAP = path.join(ROOT, "device/powkiddy x55/buttons.map");

async function loadMap() {
  const text = await readFile(MAP, "utf8");
  const entries = [];
  for (const raw of text.split("\n")) {
    const opcional = /opcional/i.test(raw);
    const line = raw.replace(/#.*/, "").trim();
    if (!line.includes("=")) continue;
    const [name, value] = line.split("=");
    entries.push({ name: name.trim(), code: value.trim(), opcional });
  }
  return entries;
}

test("buttons.map é parseável: toda linha é <nome> = <CODIGO>", async () => {
  const entries = await loadMap();
  assert.ok(entries.length > 0, "nenhuma entrada reconhecida no mapa");
  for (const { name, code } of entries) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `nome lógico inválido: ${name}`);
    if (name.startsWith("axis_")) {
      assert.match(code, /^-?\d+$/, `eixo deve ser número em ${name}: ${code}`);
    } else {
      assert.match(code, /^(BTN|KEY)_[A-Z0-9_]+$/, `código evdev inválido em ${name}: ${code}`);
    }
  }
});

test("nenhum nome lógico aparece duas vezes", async () => {
  const nomes = (await loadMap()).map((e) => e.name);
  assert.equal(new Set(nomes).size, nomes.length, `nomes repetidos: ${nomes.join(", ")}`);
});

test("nenhum código evdev aparece duas vezes", async () => {
  // Só BTN_*/KEY_*: os `axis_*` guardam números (15, 1023) e repetem de
  // propósito entre eixos.
  const codigos = (await loadMap())
    .filter((e) => /^(BTN|KEY)_/.test(e.code))
    .map((e) => e.code);
  assert.equal(
    new Set(codigos).size,
    codigos.length,
    `códigos repetidos: ${codigos.join(", ")}`,
  );
});

test("o gamepad exige exatamente 16 botões obrigatórios", async () => {
  // 17 nós são declarados no DTS (o patch 0002 acrescenta o BTN_MODE), mas o
  // gabarito do aparelho testado tem 16. O 17º é OPCIONAL; se este número
  // mudar sem querer, o selftest passa a reportar falta/sobra para sempre.
  // `giochi-buttons` conta todo BTN_* do mapa, thumbs incluídos.
  const gamepad = (await loadMap()).filter((e) => e.code.startsWith("BTN_"));
  const obrigatorios = gamepad.filter((e) => !e.opcional);
  assert.equal(obrigatorios.length, 16, "o número de botões obrigatórios do gamepad mudou");
});

test("BTN_MODE é o único botão marcado OPCIONAL", async () => {
  const opcionais = (await loadMap()).filter((e) => e.opcional);
  assert.equal(opcionais.length, 1, "só o botão F é opcional nesta revisão");
  assert.equal(opcionais[0].name, "home");
  assert.equal(opcionais[0].code, "BTN_MODE");
});

test("contagem eixos separada da contagem de botões", async () => {
  // `axis_*` são números, não códigos evdev: as ferramentas os ignoram na
  // contagem de botões. Se virarem BTN_/KEY_, a contagem quebra.
  const eixos = (await loadMap()).filter((e) => e.name.startsWith("axis_"));
  assert.ok(eixos.length > 0, "o mapa perdeu os eixos do analógico");
  for (const eixo of eixos) {
    assert.doesNotMatch(eixo.code, /^(BTN|KEY)_/, `${eixo.name} não deveria ser um botão`);
  }
});
