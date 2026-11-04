import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { buildGithubMatrix, getBuildableDevices, loadDevice, loadIndex } from "../scripts/lib/devices.mjs";

// Contrato do `generic-x64` — o alvo de PC comum, que existe para separar
// defeito do sistema de defeito do aparelho.
//
// Ele é um rascunho, e rascunho não é lixo: é uma decisão registrada. O risco
// que estes testes cobrem é o de o registro apodrecer — defconfig que sai do
// Buildroot numa atualização, pasta que some, arquitetura trocada por engano.
// Nenhum desses aparece como erro: `device=all` simplesmente não o inclui, e
// ninguém percebe até alguém precisar dele.

const ID = "generic-x64";

test("generic-x64 está registrado no índice como x86_64 desabilitado", async () => {
  const index = await loadIndex();
  const entry = index.devices.find((item) => item.id === ID);
  assert.ok(entry, "generic-x64 precisa estar em device/devices.json");
  assert.equal(entry.arch, "x86_64");
  assert.equal(entry.enabled, false, "draft não pode estar habilitado");
  assert.equal(entry.folder, "generic-x64");
});

test("o device.json do generic-x64 carrega e é consistente com o índice", async () => {
  const device = await loadDevice(ID);
  assert.equal(device.arch, "x86_64");
  assert.equal(device.status, "draft");
  assert.ok(device.directory.endsWith("generic-x64"));
  // Sem `kernelCmdline` de propósito: num PC o kernel escolhe o console, e
  // declarar `console=ttyS0` numa máquina sem serial só atrapalha.
  assert.equal(device.kernelCmdline, undefined);
});

test("o defconfig declarado existe no Buildroot fixado", async () => {
  const device = await loadDevice(ID);
  assert.equal(device.buildrootDefconfig, "pc_x86_64_efi_defconfig");

  // A árvore do Buildroot só existe depois de um build. Quando existir, o
  // arquivo TEM de estar lá: o nome do defconfig muda entre versões, e um
  // dispatch com nome velho falha em `make`, não na validação.
  const version = (await import("node:fs")).readFileSync(
    path.join(import.meta.dirname, "..", "buildroot.version"),
    "utf8",
  ).trim();
  const candidates = [
    process.env.GIOCHI_SYSTEM_WORK_DIR,
    path.join(process.env.HOME ?? "", ".cache/giochi-system/work"),
    "/tmp/giochi-system-work",
  ].filter(Boolean);
  for (const workDir of candidates) {
    const configs = path.join(workDir, "powkiddy-x55", `buildroot-${version}`, "configs");
    if (existsSync(configs)) {
      assert.ok(
        existsSync(path.join(configs, "pc_x86_64_efi_defconfig")),
        `pc_x86_64_efi_defconfig não existe no Buildroot ${version}`,
      );
      return;
    }
  }
  // Sem árvore extraída não há o que conferir — e falhar aqui puniria quem só
  // rodou os testes num clone limpo.
});

test("generic-x64 não entra na matriz padrão nem em device=all", async () => {
  // arm64 é a matriz padrão: o generic-x64 não pode aparecer nela.
  const arm = await buildGithubMatrix({ arch: "arm64", allowDraft: true });
  assert.ok(!arm.include.some((item) => item.device === ID));

  // x86_64 não tem NENHUM device habilitado, então `device=all` recusa em vez
  // de devolver matriz vazia — e é assim que o rascunho fica de fora de um
  // build acidental. A mensagem tem de mandar pedir pelo id.
  await assert.rejects(
    () => buildGithubMatrix({ arch: "x86_64", allowDraft: true }),
    /Nenhum dispositivo habilitado/,
  );
});

test("dispatch por id com allow_draft constrói o generic-x64", async () => {
  const matrix = await buildGithubMatrix({
    arch: "x86_64",
    deviceId: ID,
    allowDraft: true,
  });
  assert.deepEqual(matrix.include.map((item) => item.device), [ID]);
  assert.equal(matrix.include[0].arch, "x86_64");
});

test("sem allow_draft o pedido é recusado com instrução", async () => {
  await assert.rejects(
    () => getBuildableDevices({ arch: "x86_64", deviceId: ID }),
    /allow_draft/,
  );
});

test("os artefatos declarados são os que o defconfig EFI realmente gera", async () => {
  const device = await loadDevice(ID);
  // genimage-efi.cfg monta `disk.img` com `bzImage` + ESP + `rootfs.ext2`.
  // Nome errado aqui não falha o build: ele só não copia o arquivo, e o
  // artefato sai sem a imagem de disco.
  assert.deepEqual(device.artifacts, ["bzImage", "rootfs.ext4", "disk.img"]);
});

test("o README do generic-x64 não promete build verificado", async () => {
  const { readFile } = await import("node:fs/promises");
  const device = await loadDevice(ID);
  const readme = await readFile(path.join(device.directory, device.docs), "utf8");
  // O risco não é técnico, é de leitura: alguém achar que "está na lista"
  // significa "está pronto". Tem de estar dito, com essas palavras.
  assert.match(readme, /[Nn]unca compilado/);
  assert.match(readme, /[Dd]raft/);
});

test("o fragmento do aparelho não redefine o que é comum", async () => {
  const { readFile } = await import("node:fs/promises");
  const device = await loadDevice(ID);
  const fragment = await readFile(
    path.join(device.directory, device.buildrootFragment),
    "utf8",
  );
  // O `config/common.fragment` já liga ext2/ext4. Duplicar aqui não quebra, mas
  // cria duas fontes para a mesma decisão — o defeito que o §12.1 persegue.
  assert.doesNotMatch(fragment, /^BR2_TARGET_ROOTFS_EXT2=y$/m);
  assert.doesNotMatch(fragment, /^BR2_TARGET_ROOTFS_EXT2_4=y$/m);
});
