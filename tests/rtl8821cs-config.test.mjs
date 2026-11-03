import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";
import { buildConfig } from "../scripts/gen-rtl8821cs-config.mjs";

// O `rtl8821cs_config.bin` é binário de 25 bytes sem comentário possível. Este
// teste é a documentação executável dele: se alguém trocar o arquivo à mão, o
// gerador discorda e o build para antes de gerar imagem com rádio mudo.
const CONFIG_PATH = path.join(
  ROOT,
  "device/powkiddy x55/rootfs-overlay/lib/firmware/rtl_bt/rtl8821cs_config.bin",
);

test("o rtl8821cs_config.bin versionado é o que o gerador produz", async () => {
  const committed = await readFile(CONFIG_PATH);
  const generated = buildConfig();
  assert.deepEqual(
    committed,
    generated,
    "arquivo difere do gerador; rode: node scripts/gen-rtl8821cs-config.mjs",
  );
});

test("o config tem 25 bytes e a assinatura RTL_CONFIG_MAGIC", async () => {
  const blob = await readFile(CONFIG_PATH);
  assert.equal(blob.length, 25);
  // struct rtl_vendor_config.signature, LE32
  assert.equal(blob.readUInt32LE(0), 0x8723ab55);
  // total_len cobre exatamente o resto do arquivo
  assert.equal(blob.readUInt16LE(4), blob.length - 6);
});

test("o config declara o offset de UART (0x0c) que o btrtl procurar", async () => {
  const blob = await readFile(CONFIG_PATH);
  assert.equal(blob.readUInt16LE(6), 0x0c);
  assert.equal(blob.readUInt8(8), 16);
});

test("o baudrate pedido não reprograma a UART do console", () => {
  // 0x0252c014 é o único valor que btrtl_convert_baudrate() mapeia para 115200.
  const blob = buildConfig();
  assert.equal(blob.readUInt32LE(9), 0x0252c014);
});

test("controle de fluxo é opcional e muda exatamente um bit", () => {
  const threeWire = buildConfig({ flowControl: false });
  const fourWire = buildConfig({ flowControl: true });
  assert.equal(threeWire.length, fourWire.length);
  // data[12] começa em offset 9; BIT(2) é o flag de flow control.
  assert.equal(threeWire[9 + 12] & 0x04, 0);
  assert.equal(fourWire[9 + 12] & 0x04, 0x04);
  let diff = 0;
  for (let i = 0; i < threeWire.length; i += 1) {
    if (threeWire[i] !== fourWire[i]) diff += 1;
  }
  assert.equal(diff, 1);
});
