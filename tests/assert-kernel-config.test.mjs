import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectRequested, readConfig, verify } from "../scripts/lib/assert-kernel-config.mjs";

// Casos reais do primeiro build do Powkiddy X55: três símbolos do
// `linux.fragment` não sobreviveram ao Kconfig do kernel 6.12 e o build ficou
// verde. Estes testes fixam o comportamento do verificador.

async function files(configText, fragmentText) {
  const work = await mkdtemp(path.join(tmpdir(), "giochi-kconf-"));
  const config = path.join(work, "config");
  const fragment = path.join(work, "fragment");
  await writeFile(config, configText, "utf8");
  await writeFile(fragment, fragmentText, "utf8");
  return { config, fragment };
}

test("símbolo do kernel presente e igual passa", async () => {
  const { config, fragment } = await files(
    "CONFIG_DRM_PANEL_HIMAX_HX8394=y\nCONFIG_MMC=y\n",
    "CONFIG_DRM_PANEL_HIMAX_HX8394=y\nCONFIG_MMC=y\n",
  );
  const { requested, allowed } = collectRequested([fragment]);
  const result = verify(requested, readConfig(config), allowed);
  assert.equal(result.missing.length, 0);
  assert.equal(result.changed.length, 0);
  assert.equal(result.checked, 2);
});

test("símbolo que não existe no kernel é reportado como ausente", async () => {
  const { config, fragment } = await files(
    "CONFIG_MMC=y\n",
    "CONFIG_ARM_ROCKCHIP_CPUFREQ=y\n",
  );
  const { requested, allowed } = collectRequested([fragment]);
  const result = verify(requested, readConfig(config), allowed);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].symbol, "CONFIG_ARM_ROCKCHIP_CPUFREQ");
});

test("símbolo que caiu de =y para =m é reportado como alterado", async () => {
  const { config, fragment } = await files("CONFIG_BT=m\n", "CONFIG_BT=y\n");
  const { requested, allowed } = collectRequested([fragment]);
  const result = verify(requested, readConfig(config), allowed);
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].actual, "m");
});

test("allow-drop no fragmento perdoa o símbolo e o build segue", async () => {
  const { config, fragment } = await files(
    "CONFIG_MMC=y\n",
    "# giochi-system:allow-drop CONFIG_JOYSTICK_ROCKNIX driver fora da árvore\nCONFIG_JOYSTICK_ROCKNIX=y\n",
  );
  const { requested, allowed } = collectRequested([fragment]);
  const result = verify(requested, readConfig(config), allowed);
  assert.equal(result.missing.length, 0);
  assert.equal(allowed.size, 1);
});

test("allow-drop de um símbolo não silencia outro", async () => {
  const { config, fragment } = await files(
    "CONFIG_MMC=y\n",
    [
      "# giochi-system:allow-drop CONFIG_A motivo",
      "CONFIG_A=y",
      "CONFIG_B=y",
    ].join("\n"),
  );
  const { requested, allowed } = collectRequested([fragment]);
  const result = verify(requested, readConfig(config), allowed);
  assert.deepEqual(
    result.missing.map((item) => item.symbol),
    ["CONFIG_B"],
  );
});

test("readConfig distingue is not set de ausente", async () => {
  const { config } = await files("# CONFIG_X is not set\nCONFIG_Y=y\n", "");
  const values = readConfig(config);
  assert.equal(values.get("CONFIG_X"), null);
  assert.equal(values.has("CONFIG_Z"), false);
});

test("kernel-required.txt do X55 lista os drivers que fazem bootar", async () => {
  const { ROOT } = await import("../scripts/lib/devices.mjs");
  const requiredPath = path.join(ROOT, "device/powkiddy x55/kernel-required.txt");
  const { requested } = collectRequested([requiredPath]);
  // Estes símbolos vêm do defconfig arm64, NÃO do linux.fragment. Se sumirem,
  // a imagem não chega ao rootfs ou não acende a tela — e o build ficaria verde.
  for (const symbol of [
    "CONFIG_MMC_DW_ROCKCHIP",
    "CONFIG_EXT4_FS",
    "CONFIG_SERIAL_8250_DW",
    "CONFIG_DRM_PANEL_HIMAX_HX8394",
    "CONFIG_PHY_ROCKCHIP_INNO_DSIDPHY",
    "CONFIG_BACKLIGHT_PWM",
  ]) {
    assert.ok(requested.has(symbol), `${symbol} saiu de kernel-required.txt`);
  }
});

test("símbolo de kernel-required ausente no .config é reportado", async () => {
  const { config } = await files("CONFIG_MMC=y\n", "");
  const { ROOT } = await import("../scripts/lib/devices.mjs");
  const requiredPath = path.join(ROOT, "device/powkiddy x55/kernel-required.txt");
  const { requested } = collectRequested([requiredPath]);
  const result = verify(requested, readConfig(config));
  const missing = result.missing.map((item) => item.symbol);
  assert.ok(missing.includes("CONFIG_MMC_DW_ROCKCHIP"));
  assert.ok(!missing.includes("CONFIG_MMC"));
});
