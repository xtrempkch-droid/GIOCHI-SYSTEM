import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  ROOT,
  buildGithubMatrix,
  getBuildableDevices,
  loadDevice,
  loadIndex,
  readBuildrootVersion,
  validateDevice,
} from "../scripts/lib/devices.mjs";

test("buildroot.version está fixado em uma versão válida", async () => {
  const version = await readBuildrootVersion();
  assert.match(version, /^\d{4}\.\d{2}(?:\.\d+)?$/);
});

test("o índice de devices é válido e contém qemu-aarch64 habilitado", async () => {
  const index = await loadIndex();
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.defaultArch, "arm64");
  const qemu = index.devices.find((device) => device.id === "qemu-aarch64");
  assert.ok(qemu);
  assert.equal(qemu.enabled, true);
  assert.equal(qemu.arch, "arm64");
});

test("pastas com espaços são aceitas e resolvidas com segurança", async () => {
  const device = await loadDevice("powkiddy-x55");
  assert.equal(device.folder, "powkiddy x55");
  assert.equal(device.arch, "arm64");
  assert.ok(device.directory.endsWith(path.join("device", "powkiddy x55")));
});

test("todos os devices carregam com seus arquivos obrigatórios", async () => {
  const index = await loadIndex();
  for (const entry of index.devices) {
    const device = await loadDevice(entry.id, index);
    assert.equal(device.id, entry.id);
    assert.equal(device.arch, entry.arch);
  }
});

test("device habilitado com status draft é rejeitado", async () => {
  const device = await loadDevice("qemu-aarch64");
  const errors = await validateDevice({ ...device, status: "draft" });
  assert.ok(errors.some((error) => error.includes("status ready")));
});

test("device habilitado sem defconfig é rejeitado", async () => {
  const device = await loadDevice("qemu-aarch64");
  const errors = await validateDevice({ ...device, buildrootDefconfig: "" });
  assert.ok(errors.some((error) => error.includes("buildrootDefconfig")));
});

test("a matriz ARM64 contém apenas devices habilitados e completos", async () => {
  const matrix = await buildGithubMatrix({ arch: "arm64" });
  assert.ok(Array.isArray(matrix.include));
  assert.ok(matrix.include.length >= 1);
  const qemu = matrix.include.find((item) => item.device === "qemu-aarch64");
  assert.ok(qemu);
  assert.equal(qemu.arch, "arm64");
  assert.match(qemu.runner, /^ubuntu-/);
  assert.ok(qemu.timeout >= 60);
});

// O aparelho usado como exemplo NÃO é fixo: quando o X55 foi habilitado para a
// release, três testes que cravavam `powkiddy-x55` como "o desabilitado"
// passaram a falhar sem que a regra tivesse mudado. A pergunta é sobre a
// CLASSE ("device desabilitado não entra"), e a resposta vale para qualquer
// aparelho que esteja nesse estado no índice.
async function primeiroDesabilitado({ arch = "arm64", comDefconfig = false } = {}) {
  const index = await loadIndex();
  for (const entry of index.devices) {
    if (entry.enabled || entry.arch !== arch) continue;
    const device = await loadDevice(entry.id, index);
    if (comDefconfig && !device.buildrootDefconfig) continue;
    return device;
  }
  return null;
}

test("device desabilitado não entra na lista construível", async () => {
  const desabilitado = await primeiroDesabilitado();
  assert.ok(desabilitado, "o índice precisa manter ao menos um device desabilitado");
  await assert.rejects(
    () =>
      getBuildableDevices({ arch: desabilitado.arch, deviceId: desabilitado.id }),
    /desabilitado/,
  );
});

test("arquitetura sem device habilitado retorna erro claro", async () => {
  await assert.rejects(
    () => getBuildableDevices({ arch: "x86_64" }),
    /Nenhum dispositivo habilitado/,
  );
});

test("allow-draft inclui rascunho com defconfig quando pedido pelo id", async () => {
  const rascunho = await primeiroDesabilitado({ comDefconfig: true });
  assert.ok(rascunho, "o índice precisa manter ao menos um rascunho com defconfig");
  const matrix = await buildGithubMatrix({
    arch: rascunho.arch,
    deviceId: rascunho.id,
    allowDraft: true,
  });
  assert.deepEqual(
    matrix.include.map((item) => item.device),
    [rascunho.id],
  );
});

test("allow-draft nunca puxa rascunho quando o pedido é device=all", async () => {
  const index = await loadIndex();
  const rascunhos = index.devices.filter((entry) => !entry.enabled);
  const matrix = await buildGithubMatrix({ arch: "arm64", allowDraft: true });
  const ids = matrix.include.map((item) => item.device);
  for (const rascunho of rascunhos) {
    assert.ok(
      !ids.includes(rascunho.id),
      `device=all não deveria puxar rascunho (${rascunho.id}): ${ids}`,
    );
  }
});

test("o erro de device desabilitado diz como construir mesmo assim", async () => {
  const desabilitado = await primeiroDesabilitado();
  assert.ok(desabilitado, "o índice precisa manter ao menos um device desabilitado");
  await assert.rejects(
    () =>
      getBuildableDevices({ arch: desabilitado.arch, deviceId: desabilitado.id }),
    /allow_draft/,
  );
});

test("todo device habilitado entra na matriz da própria arquitetura", async () => {
  const index = await loadIndex();
  const habilitados = index.devices.filter((entry) => entry.enabled);
  assert.ok(habilitados.length > 0);
  for (const entry of habilitados) {
    const matrix = await buildGithubMatrix({ arch: entry.arch });
    const ids = matrix.include.map((item) => item.device);
    assert.ok(
      ids.includes(entry.id),
      `${entry.id} está habilitado no índice mas não entrou na matriz ${entry.arch}: ${ids}`,
    );
  }
});

test("o caminho do repositório é utilizado como raiz", () => {
  assert.ok(path.isAbsolute(ROOT), `raiz não absoluta: ${ROOT}`);

  // NÃO afirmar o nome da pasta. Ele muda conforme onde o projeto foi clonado
  // (`Giochi system` no Desktop, `GIOCHI-SYSTEM` no CI, qualquer coisa num fork),
  // e um teste que depende disso passa só na máquina de quem escreveu.
  //
  // O que importa é que a raiz aponte para o repositório: os marcadores do
  // projeto têm de existir a partir dela.
  for (const marker of ["buildroot.version", "device/devices.json", "scripts/validate-devices.mjs"]) {
    assert.ok(
      existsSync(path.join(ROOT, marker)),
      `faltou ${marker} sob a raiz calculada (${ROOT})`,
    );
  }
});
