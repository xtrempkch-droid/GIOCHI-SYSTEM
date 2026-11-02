#!/usr/bin/env node
// Testes do leitor de DTB.
//
// Não há DTB real nesta máquina, então o teste **constrói** um. Isso é melhor que
// um fixture binário: o formato fica explícito no teste, e qualquer erro de
// leitura aparece aqui em vez de no arquivo do usuário.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buttonsFromFdt,
  missingRequired,
  parseFdt,
  renderButtonsMap,
} from "../scripts/lib/fdt.mjs";

// ── construtor de FDT para teste ────────────────────────────

function align4(value) {
  return (value + 3) & ~3;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function u32Prop(...values) {
  return Buffer.concat(values.map(u32));
}

function stringProp(text) {
  return Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([0])]);
}

function stringsProp(items) {
  const parts = [];
  for (const item of items) {
    parts.push(Buffer.from(item, "utf8"), Buffer.from([0]));
  }
  return Buffer.concat(parts);
}

/** Monta um DTB completo a partir de uma árvore simples. */
function buildFdt(root) {
  const stringBlobs = [];
  const offsets = new Map();
  let stringSize = 0;

  const nameOffset = (name) => {
    if (offsets.has(name)) return offsets.get(name);
    offsets.set(name, stringSize);
    const blob = Buffer.from(name, "utf8");
    stringBlobs.push(blob, Buffer.from([0]));
    stringSize += blob.length + 1;
    return offsets.get(name);
  };

  const structParts = [];

  const emitNode = (node) => {
    structParts.push(u32(0x1)); // FDT_BEGIN_NODE
    const padded = Buffer.alloc(align4(node.name.length + 1));
    padded.write(node.name, 0, "utf8");
    structParts.push(padded);

    for (const [name, data] of node.props ?? []) {
      structParts.push(u32(0x3)); // FDT_PROP
      structParts.push(u32(data.length));
      structParts.push(u32(nameOffset(name)));
      const paddedData = Buffer.alloc(align4(data.length));
      data.copy(paddedData);
      structParts.push(paddedData);
    }

    for (const child of node.children ?? []) emitNode(child);
    structParts.push(u32(0x2)); // FDT_END_NODE
  };

  emitNode(root);
  structParts.push(u32(0x9)); // FDT_END

  const structBlock = Buffer.concat(structParts);
  // Nomes são reservados durante a emissão da estrutura; só agora têm tamanho.
  const stringsBlock = Buffer.concat(stringBlobs);

  const headerSize = 40;
  const rsvmapSize = 16;
  const offStruct = headerSize + rsvmapSize;
  const offStrings = offStruct + structBlock.length;
  const total = offStrings + stringsBlock.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt32BE(0xd00dfeed, 0);
  header.writeUInt32BE(total, 4);
  header.writeUInt32BE(offStruct, 8);
  header.writeUInt32BE(offStrings, 12);
  header.writeUInt32BE(headerSize, 16); // off_mem_rsvmap
  header.writeUInt32BE(17, 20); // version
  header.writeUInt32BE(16, 24); // last_comp_version
  header.writeUInt32BE(0, 28);
  header.writeUInt32BE(stringsBlock.length, 32);
  header.writeUInt32BE(structBlock.length, 36);

  return Buffer.concat([header, Buffer.alloc(rsvmapSize), structBlock, stringsBlock]);
}

function sampleTree() {
  return {
    name: "",
    props: [["compatible", stringsProp(["powkiddy,x55", "rockchip,rk3566"])]],
    children: [
      {
        name: "gpio-keys-control",
        props: [["compatible", stringsProp(["gpio-keys"])]],
        children: [
          // BTN_SOUTH = 0x130, BTN_EAST = 0x131 (linux/input-event-codes.h).
          // O nó chama-se "button-a" mas quem define o nome lógico é o código.
          { name: "button-a", props: [["label", stringProp("EAST")], ["linux,code", u32Prop(0x131)]] },
          { name: "button-b", props: [["label", stringProp("SOUTH")], ["linux,code", u32Prop(0x130)]] },
          { name: "button-up", props: [["label", stringProp("DPAD-UP")], ["linux,code", u32Prop(0x220)]] },
          { name: "button-start", props: [["label", stringProp("START")], ["linux,code", u32Prop(0x13b)]] },
        ],
      },
      {
        name: "adc-joystick",
        props: [["compatible", stringsProp(["adc-joystick"])]],
        children: [
          {
            name: "axis@0",
            props: [["linux,code", u32Prop(0x00)], ["abs-range", u32Prop(15, 1023)], ["abs-flat", u32Prop(30)]],
          },
          {
            name: "axis@1",
            props: [["linux,code", u32Prop(0x01)], ["abs-range", u32Prop(1023, 15)]],
          },
        ],
      },
      {
        name: "unrelated",
        props: [["compatible", stringsProp(["rockchip,rk817"])]],
        children: [],
      },
    ],
  };
}

// ── testes ──────────────────────────────────────────────────

test("parseFdt lê a árvore", () => {
  const root = parseFdt(buildFdt(sampleTree()));
  assert.equal(root.name, "/");
  assert.equal(root.children.length, 3);
  assert.equal(root.children[0].name, "gpio-keys-control");
  assert.equal(root.children[0].children.length, 4);
});

test("parseFdt recusa arquivo que não é DTB", () => {
  assert.throws(() => parseFdt(Buffer.from("nao sou dtb, sou texto")), /curto demais|não é DTB/);
  const big = Buffer.alloc(64);
  assert.throws(() => parseFdt(big), /não é DTB/);
});

test("parseFdt recusa DTB truncado", () => {
  const full = buildFdt(sampleTree());
  // Cabeçalho diz que é maior do que o arquivo entregue.
  full.writeUInt32BE(full.length + 100, 4);
  assert.throws(() => parseFdt(full), /truncado/);
});

test("extrai botões do gpio-keys", () => {
  const result = buttonsFromFdt(parseFdt(buildFdt(sampleTree())));
  assert.equal(result.buttons.length, 4);

  const byName = new Map(result.buttons.map((button) => [button.name, button]));
  assert.equal(byName.get("a").symbol, "BTN_EAST");
  assert.equal(byName.get("b").symbol, "BTN_SOUTH");
  assert.equal(byName.get("up").symbol, "BTN_DPAD_UP");
  assert.equal(byName.get("start").symbol, "BTN_START");
  assert.equal(byName.get("a").label, "EAST");
});

test("ignora nó que não é gpio-keys", () => {
  const result = buttonsFromFdt(parseFdt(buildFdt(sampleTree())));
  assert.equal(
    result.buttons.some((button) => button.node.includes("unrelated")),
    false,
  );
});

test("extrai eixos do adc-joystick com faixa", () => {
  const result = buttonsFromFdt(parseFdt(buildFdt(sampleTree())));
  assert.equal(result.axes.length, 2);

  const x = result.axes.find((axis) => axis.symbol === "ABS_X");
  assert.equal(x.min, 15);
  assert.equal(x.max, 1023);
  assert.equal(x.flat, 30);

  const y = result.axes.find((axis) => axis.symbol === "ABS_Y");
  assert.equal(y.min, 1023, "faixa invertida preservada");
  assert.equal(y.max, 15);
});

test("código sem nome lógico vai para unknown", () => {
  const tree = {
    name: "",
    children: [
      {
        name: "gpio-keys",
        props: [["compatible", stringsProp(["gpio-keys"])]],
        children: [
          { name: "b1", props: [["linux,code", u32Prop(0x2ff)]] },
          { name: "b2", props: [["linux,code", u32Prop(0x130)]] },
        ],
      },
    ],
  };
  const result = buttonsFromFdt(parseFdt(buildFdt(tree)));
  assert.equal(result.buttons.length, 1);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.unknown[0].hex, "0x2ff");
});

test("renderButtonsMap produz mapa utilizável", () => {
  const result = buttonsFromFdt(parseFdt(buildFdt(sampleTree())));
  const text = renderButtonsMap(result, "teste.dtb");

  assert.match(text, /^a\s+= BTN_EAST/m);
  assert.match(text, /^up\s+= BTN_DPAD_UP/m);
  assert.match(text, /^axis_x_min\s+= 15/m);
  assert.match(text, /^axis_x_max\s+= 1023/m);
  assert.match(text, /gerado de teste\.dtb/);
});

test("missingRequired aponta o que falta", () => {
  const result = buttonsFromFdt(parseFdt(buildFdt(sampleTree())));
  const missing = missingRequired(result);
  // A árvore de teste tem up, a, b, start — falta o resto.
  assert.ok(missing.includes("left"));
  assert.ok(missing.includes("select"));
  assert.ok(!missing.includes("up"));
  assert.ok(!missing.includes("a"));
});

test("home não é obrigatório", () => {
  const result = buttonsFromFdt(parseFdt(buildFdt(sampleTree())));
  assert.ok(!missingRequired(result).includes("home"));
});

test("liberdade de nome: nó não precisa chamar button", () => {
  const tree = {
    name: "",
    children: [
      {
        name: "keys",
        props: [["compatible", stringsProp(["gpio-keys-polled"])]],
        children: [{ name: "qualquer-nome", props: [["linux,code", u32Prop(0x13c)]] }],
      },
    ],
  };
  const result = buttonsFromFdt(parseFdt(buildFdt(tree)));
  assert.equal(result.buttons[0].name, "home");
  assert.equal(result.buttons[0].symbol, "BTN_MODE");
});
