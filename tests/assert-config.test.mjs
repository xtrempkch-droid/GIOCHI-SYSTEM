#!/usr/bin/env node
// Testa o núcleo de scripts/lib/assert-config.mjs, que protege contra o
// olddefconfig descartar símbolos em silêncio.
//
// Importa o módulo em vez de spawnar o CLI: sob o sandbox, child_process com
// stdio em pipe falha com EPERM, e testar a função pura é melhor de qualquer forma.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectRequested, readConfig, verify } from "../scripts/lib/assert-config.mjs";

function withTempDir(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "giochi-assert-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function build(configText, fragmentText, extraFragments = [], allowDrop = []) {
  return withTempDir((dir) => {
    const configPath = path.join(dir, "config");
    writeFileSync(configPath, `${configText}\n`, "utf8");

    const fragments = [];
    const primary = path.join(dir, "fragment");
    writeFileSync(primary, `${fragmentText}\n`, "utf8");
    fragments.push(primary);

    extraFragments.forEach((text, index) => {
      const extra = path.join(dir, `extra-${index}.fragment`);
      writeFileSync(extra, `${text}\n`, "utf8");
      fragments.push(extra);
    });

    return verify({ configPath, fragments, allowDrop });
  });
}

test("aceita quando todos os símbolos pedidos sobrevivem", () => {
  const result = build(
    "BR2_aarch64=y\nBR2_PACKAGE_SDL2=y\n# BR2_PACKAGE_HOST_QEMU is not set",
    "BR2_aarch64=y\nBR2_PACKAGE_SDL2=y\n# BR2_PACKAGE_HOST_QEMU is not set",
  );
  assert.equal(result.ok, true);
  assert.equal(result.total, 0);
  assert.equal(result.requestedCount, 3);
});

test("detecta símbolo que desapareceu da configuração", () => {
  const result = build(
    "BR2_aarch64=y\nBR2_PACKAGE_SDL2=y",
    "BR2_aarch64=y\nBR2_PACKAGE_SDL2=y\nBR2_PACKAGE_MESA3D=y",
  );
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].symbol, "BR2_PACKAGE_MESA3D");
  assert.equal(result.missing[0].requested, "y");
});

test("detecta símbolo que caiu de =y para =m", () => {
  const result = build(
    "BR2_aarch64=y\nBR2_PACKAGE_SDL2=m",
    "BR2_aarch64=y\nBR2_PACKAGE_SDL2=y",
  );
  assert.equal(result.ok, false);
  assert.equal(result.disabled.length, 1);
  assert.equal(result.disabled[0].requested, "y");
  assert.equal(result.disabled[0].got, "m");
});

test("detecta símbolo pedido como desligado que veio ligado", () => {
  const result = build("BR2_PACKAGE_FFMPEG=y", "# BR2_PACKAGE_FFMPEG is not set");
  assert.equal(result.ok, false);
  assert.equal(result.reverted.length, 1);
  assert.equal(result.reverted[0].symbol, "BR2_PACKAGE_FFMPEG");
});

test("não reclama de símbolo desligado que nem existe na árvore", () => {
  const result = build("BR2_aarch64=y", "BR2_aarch64=y\n# BR2_PACKAGE_HOST_QEMU is not set");
  assert.equal(result.ok, true);
});

test("tolera reescrita de aspas em valores string", () => {
  const result = build(
    'BR2_TARGET_ROOTFS_EXT2_SIZE="512M"',
    'BR2_TARGET_ROOTFS_EXT2_SIZE=512M',
  );
  assert.equal(result.ok, true, JSON.stringify(result.disabled));
});

test("detecta valor string realmente alterado", () => {
  const result = build(
    'BR2_TARGET_ROOTFS_EXT2_SIZE="256M"',
    'BR2_TARGET_ROOTFS_EXT2_SIZE="512M"',
  );
  assert.equal(result.ok, false);
  assert.equal(result.disabled.length, 1);
});

test("allow-drop dentro do fragmento perdoa um descarte justificado", () => {
  const result = build(
    "BR2_aarch64=y",
    "BR2_aarch64=y\n# giochi-system:allow-drop BR2_PACKAGE_MESA3D driver proprietario\nBR2_PACKAGE_MESA3D=y",
  );
  assert.equal(result.ok, true);
  assert.equal(result.allowedCount, 1);
});

test("allowDrop na chamada perdoa um descarte", () => {
  const result = build(
    "BR2_aarch64=y",
    "BR2_aarch64=y\nBR2_PACKAGE_MESA3D=y",
    [],
    ["BR2_PACKAGE_MESA3D"],
  );
  assert.equal(result.ok, true);
});

test("allow-drop não silencia um símbolo diferente", () => {
  const result = build(
    "BR2_aarch64=y",
    "BR2_aarch64=y\nBR2_PACKAGE_MESA3D=y\nBR2_PACKAGE_FFMPEG=y",
    [],
    ["BR2_PACKAGE_MESA3D"],
  );
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].symbol, "BR2_PACKAGE_FFMPEG");
});

test("collectRequested ignora comentários comuns e linhas vazias", () => {
  return withTempDir((dir) => {
    const fragment = path.join(dir, "f.fragment");
    writeFileSync(
      fragment,
      "# comentário normal\n\nBR2_A=y\n  BR2_B=y  \n# BR2_C is not set\n",
      "utf8",
    );
    const requested = collectRequested([fragment]);
    assert.deepEqual([...requested.keys()].sort(), ["BR2_A", "BR2_B", "BR2_C"]);
  });
});

test("readConfig distingue is not set de ausente", () => {
  return withTempDir((dir) => {
    const config = path.join(dir, "config");
    writeFileSync(config, 'BR2_A=y\n# BR2_B is not set\nBR2_C="texto com espaço"\n', "utf8");
    const values = readConfig(config);
    assert.equal(values.get("BR2_A"), "y");
    assert.equal(values.get("BR2_B"), null);
    assert.equal(values.has("BR2_B"), true);
    assert.equal(values.get("BR2_C"), '"texto com espaço"');
    assert.equal(values.has("BR2_ZZZ"), false);
  });
});
