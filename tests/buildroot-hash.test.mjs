import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT, readBuildrootVersion } from "../scripts/lib/devices.mjs";

// build-device.sh só verifica o tarball quando buildroot.sha256 tem uma linha
// para a versão pedida. Subir `buildroot.version` sem atualizar o hash não
// quebra nada — e é justamente por isso que precisa de teste.
async function readHashEntries() {
  const text = await readFile(path.join(ROOT, "buildroot.sha256"), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [hash, name] = line.split(/\s+/);
      return { hash, name };
    });
}

test("buildroot.sha256 fixa o hash do tarball da versão em buildroot.version", async () => {
  const version = await readBuildrootVersion();
  const expectedName = `buildroot-${version}.tar.gz`;
  const entries = await readHashEntries();
  const entry = entries.find((item) => item.name === expectedName);
  assert.ok(entry, `buildroot.sha256 não tem entrada para ${expectedName}`);
  assert.match(entry.hash, /^[0-9a-f]{64}$/);
});

test("buildroot.sha256 não repete o mesmo tarball com hashes diferentes", async () => {
  const entries = await readHashEntries();
  const seen = new Map();
  for (const { name, hash } of entries) {
    const previous = seen.get(name);
    assert.ok(
      previous === undefined || previous === hash,
      `buildroot.sha256 tem hashes divergentes para ${name}`,
    );
    seen.set(name, hash);
  }
});
