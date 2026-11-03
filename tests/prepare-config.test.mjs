import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ROOT } from "../scripts/lib/devices.mjs";

const run = promisify(execFile);

// Estes testes cobrem falhas medidas em build real do Powkiddy X55, todas na
// mesma classe: o Buildroot separa listas por ESPAÇO e o build morre com uma
// mensagem que não cita espaço nem aparelho.

async function prepareConfig(extraArgs) {
  const work = await mkdtemp(path.join(tmpdir(), "giochi-prepare-"));
  const config = path.join(work, ".config");
  await writeFile(config, "BR2_CCACHE=y\n", "utf8");
  const args = [
    path.join(ROOT, "scripts/prepare-config.mjs"),
    "--config",
    config,
    "--hostname",
    "test-host",
    "--issue",
    "issue de teste",
    "--root-password",
    "giochi-dev",
    "--dl-dir",
    path.join(work, "dl"),
    ...extraArgs,
  ];
  try {
    const { stdout } = await run(process.execPath, args);
    return { ok: true, config, stdout };
  } catch (error) {
    return { ok: false, stderr: `${error.stderr ?? ""}${error.message ?? ""}` };
  }
}

test("fragmento de kernel com espaço no caminho é recusado com mensagem útil", async () => {
  const fragment = path.join(ROOT, "device/powkiddy x55/linux.fragment");
  const result = await prepareConfig(["--kernel-fragment", fragment]);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /espaço/i);
  assert.match(result.stderr, /Buildroot separa/i);
});

test("fragmento de busybox com espaço no caminho é recusado", async () => {
  const fragment = path.join(ROOT, "device/powkiddy x55/busybox.fragment");
  const result = await prepareConfig(["--busybox-fragment", fragment]);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /busybox/i);
});

test("overlay com espaço no caminho é recusado", async () => {
  const result = await prepareConfig([
    "--overlay",
    path.join(ROOT, "device/powkiddy x55/rootfs-overlay"),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /Overlay/i);
});

test("fragmento de busybox em caminho sem espaço entra na configuração", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "giochi-bb-"));
  const staged = path.join(work, "busybox.fragment");
  await writeFile(staged, "# CONFIG_TC is not set\n", "utf8");
  const result = await prepareConfig(["--busybox-fragment", staged]);
  assert.equal(result.ok, true, result.stderr);
  const text = await readFile(result.config, "utf8");
  assert.match(text, /^BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES=".*busybox\.fragment"$/m);
});

test("override de pacote entra em BR2_PACKAGE_OVERRIDE_FILE", async () => {
  const override = path.join(ROOT, "config/package-overrides.mk");
  const result = await prepareConfig(["--package-override", override]);
  assert.equal(result.ok, true, result.stderr);
  const text = await readFile(result.config, "utf8");
  assert.match(text, /^BR2_PACKAGE_OVERRIDE_FILE=".*package-overrides\.mk"$/m);
});

test("patch de kernel em caminho sem espaço entra em BR2_LINUX_KERNEL_PATCH", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "giochi-kp-"));
  const staged = path.join(work, "0001-teste.patch");
  await writeFile(staged, "--- a/x\n+++ b/x\n", "utf8");
  const result = await prepareConfig(["--kernel-patch", staged]);
  assert.equal(result.ok, true, result.stderr);
  const text = await readFile(result.config, "utf8");
  assert.match(text, /^BR2_LINUX_KERNEL_PATCH=".*0001-teste\.patch"$/m);
});

test("patch de kernel com espaço no caminho é recusado", async () => {
  const result = await prepareConfig([
    "--kernel-patch",
    path.join(ROOT, "device/powkiddy x55/patches/0001-giochi-system-x55-dts.patch"),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /Patch de kernel/i);
});

test("o patch real do X55 existe e contém as quatro correções de DTS", async () => {
  const patch = await readFile(
    path.join(ROOT, "device/powkiddy x55/patches/0001-giochi-system-x55-dts.patch"),
    "utf8",
  );
  for (const marker of ["no-sd;", "sd-uhs-sdr50;", 'dma-names = "tx", "rx";', "&rng {"]) {
    assert.ok(patch.includes(marker), `patch sem ${marker}`);
  }
});
