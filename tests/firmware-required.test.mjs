import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Regressão de um bug real do Buildroot 2024.02: o pacote linux-firmware da
// MESMA versão traz rtl_bt/rtl8821cs_fw.bin e rtl_bt/rtl8821cs_config.bin, mas
// BR2_PACKAGE_LINUX_FIRMWARE_RTL_88XX_BT lista só rtl8821a_* e rtl8821c_*.
// O resultado é imagem que boota e um Bluetooth que "não funciona" sem uma
// linha de erro. O acréscimo vive em config/package-overrides.mk.

async function readOverrides() {
  return readFile(path.join(ROOT, "config/package-overrides.mk"), "utf8");
}

test("package-overrides.mk acrescenta os dois arquivos do RTL8821CS", async () => {
  const text = await readOverrides();
  for (const file of ["rtl8821cs_fw.bin", "rtl8821cs_config.bin"]) {
    assert.ok(
      text.includes(file),
      `package-overrides.mk não menciona ${file}: o Buildroot 2024.02 não o instala`,
    );
  }
});

test("o acréscimo usa LINUX_FIRMWARE_FILES, que é a variável do pacote", async () => {
  const text = await readOverrides();
  assert.match(text, /^LINUX_FIRMWARE_FILES \+= [^\n]*rtl8821cs_fw\.bin/m);
});

test("o X55 declara os firmwares obrigatórios do rádio", async () => {
  const required = await readFile(
    path.join(ROOT, "device/powkiddy x55/firmware-required.txt"),
    "utf8",
  );
  for (const file of [
    "rtw88/rtw8821c_fw.bin",
    "rtl_bt/rtl8821cs_fw.bin",
    "rtl_bt/rtl8821cs_config.bin",
  ]) {
    assert.ok(required.includes(file), `firmware-required.txt não lista ${file}`);
  }
});

test("firmware-required.txt não usa caminho absoluto nem ..", async () => {
  const required = await readFile(
    path.join(ROOT, "device/powkiddy x55/firmware-required.txt"),
    "utf8",
  );
  for (const raw of required.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    assert.ok(!line.startsWith("/"), `caminho absoluto: ${line}`);
    assert.ok(!line.includes(".."), `caminho com ..: ${line}`);
  }
});

test("main.conf do bluetooth liga o rádio no boot", async () => {
  const conf = await readFile(
    path.join(ROOT, "device/powkiddy x55/rootfs-overlay/etc/bluetooth/main.conf"),
    "utf8",
  );
  // Sem AutoEnable o controlador fica "Powered: no" e parece defeito.
  assert.match(conf, /^\[Policy\]$/m);
  assert.match(conf, /^AutoEnable\s*=\s*true$/m);
});
