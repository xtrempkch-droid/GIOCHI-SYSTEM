import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ROOT } from "../scripts/lib/devices.mjs";

const SELFTEST = path.join(
  ROOT,
  "device/common/rootfs-overlay/usr/bin/giochi-selftest",
);

const run = promisify(execFile);
const POST_BUILD = path.join(ROOT, "scripts/post-build.sh");
const INIT = path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-init");

const INITTAB_BASE = `::sysinit:/etc/init.d/rcS
console::respawn:/sbin/getty -L  console 0 vt100 # GENERIC_SERIAL
`;

// Monta um rootfs mínimo: /etc/inittab, /usr/bin/giochi-init e, opcionalmente,
// o launcher. É o suficiente para exercitar as três decisões do post-build.
async function fakeRoot({ launcher = false, marker = false, inittab = INITTAB_BASE } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-pb-"));
  await mkdir(path.join(dir, "etc/giochi"), { recursive: true });
  await mkdir(path.join(dir, "usr/bin"), { recursive: true });
  await writeFile(path.join(dir, "etc/inittab"), inittab);
  const init = await readFile(INIT);
  await writeFile(path.join(dir, "usr/bin/giochi-init"), init, { mode: 0o755 });
  if (marker) await writeFile(path.join(dir, "etc/giochi/boot-layer"), "");
  if (launcher) {
    await mkdir(path.join(dir, "opt/giochi/apps/launcher/bin"), { recursive: true });
    await writeFile(path.join(dir, "opt/giochi/apps/launcher/bin/giochi-launcher"), "#!/bin/sh\n", {
      mode: 0o755,
    });
  }
  return dir;
}

const runPostBuild = (dir) =>
  run("sh", [POST_BUILD], { env: { ...process.env, TARGET_DIR: dir } });

test("sem launcher e sem marcador, o inittab não muda", async () => {
  // Pôr a linha sem launcher deixa um processo esperando binário que não
  // existe. Inofensivo, mas sem propósito — e um rootfs que muda sem motivo é
  // ruído em diff de artefato.
  const dir = await fakeRoot();
  try {
    await runPostBuild(dir);
    assert.equal(await readFile(path.join(dir, "etc/inittab"), "utf8"), INITTAB_BASE);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("com launcher, a linha entra logo depois do rcS e antes do getty", async () => {
  // `respawn` é o que mantém o launcher vivo: ele faz exec no jogo, então
  // ninguém sobra para redesenhar quando o jogo termina.
  const dir = await fakeRoot({ launcher: true });
  try {
    await runPostBuild(dir);
    const linhas = (await readFile(path.join(dir, "etc/inittab"), "utf8")).trimEnd().split("\n");
    assert.deepEqual(linhas, [
      "::sysinit:/etc/init.d/rcS",
      "::respawn:/usr/bin/giochi-init",
      "console::respawn:/sbin/getty -L  console 0 vt100 # GENERIC_SERIAL",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rodar duas vezes não duplica a linha", async () => {
  // O post-build roda a cada build; duplicar a entrada faria dois giochi-init
  // disputando o DRM.
  const dir = await fakeRoot({ launcher: true });
  try {
    await runPostBuild(dir);
    await runPostBuild(dir);
    const texto = await readFile(path.join(dir, "etc/inittab"), "utf8");
    assert.equal(texto.split("/usr/bin/giochi-init").length - 1, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o marcador /etc/giochi/boot-layer liga a linha sem launcher", async () => {
  // Permite testar o giochi-init num aparelho antes de o launcher existir.
  const dir = await fakeRoot({ marker: true });
  try {
    await runPostBuild(dir);
    const texto = await readFile(path.join(dir, "etc/inittab"), "utf8");
    assert.match(texto, /^::respawn:\/usr\/bin\/giochi-init$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inittab sem rcS recebe a linha no fim, sem perder o que havia", async () => {
  const dir = await fakeRoot({
    launcher: true,
    inittab: "::sysinit:/bin/mount -t proc proc /proc\n",
  });
  try {
    await runPostBuild(dir);
    const texto = await readFile(path.join(dir, "etc/inittab"), "utf8");
    assert.match(texto, /^::sysinit:\/bin\/mount -t proc proc \/proc$/m);
    assert.match(texto, /^::respawn:\/usr\/bin\/giochi-init$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o post-build nunca REMOVE linha do inittab", async () => {
  // Defconfig de placa real pode depender das linhas geradas (getty, shutdown,
  // ctrlaltdel). É o §7 do AGENTS: não sobrescrever, só acrescentar.
  const original = `::sysinit:/etc/init.d/rcS
console::respawn:/sbin/getty -L  console 0 vt100 # GENERIC_SERIAL
::ctrlaltdel:/sbin/reboot
::shutdown:/etc/init.d/rcK
`;
  const dir = await fakeRoot({ launcher: true, inittab: original });
  try {
    await runPostBuild(dir);
    const texto = await readFile(path.join(dir, "etc/inittab"), "utf8");
    for (const linha of original.trimEnd().split("\n")) {
      assert.ok(texto.includes(linha), `linha perdida: ${linha}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("giochi-init sem bit de execução falha o build em vez de virar linha morta", async () => {
  // Uma linha de inittab apontando para um arquivo não executável gera erro a
  // cada respawn, enchendo o console — e o build inteiro teria ficado verde.
  const dir = await fakeRoot({ launcher: true });
  try {
    await chmod(path.join(dir, "usr/bin/giochi-init"), 0o644);
    await assert.rejects(runPostBuild(dir), /giochi-init não está executável/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o prepare-config ACRESCENTA post-build em vez de substituir o do aparelho", async () => {
  // Sobrescrever BR2_ROOTFS_POST_BUILD_SCRIPT quebraria aparelhos que dependem
  // do próprio post-build, em silêncio.
  const script = await readFile(path.join(ROOT, "scripts/prepare-config.mjs"), "utf8");
  assert.match(script, /postBuildScripts/);
  const bloco = script.slice(script.indexOf("if (args.postBuildScripts.length > 0)"));
  assert.match(bloco, /existentes\.push\(resolvido\)/, "tem de somar à lista existente");
  assert.doesNotMatch(
    bloco.slice(0, 400),
    /setKey\(lines, "BR2_ROOTFS_POST_BUILD_SCRIPT", quote\(args/,
    "substituição direta: perderia o post-build do defconfig",
  );
});

test("o build chama o post-build", async () => {
  const script = await readFile(path.join(ROOT, "scripts/build-device.sh"), "utf8");
  assert.match(script, /POST_BUILD_ARGS=\(--post-build/);
  assert.match(script, /"\$\{POST_BUILD_ARGS\[@\]\+\"\$\{POST_BUILD_ARGS\[@\]\}\"\}"/);
});

test("o selftest não pergunta se o giochi-init é PID 1", async () => {
  // PID 1 é sempre o init do busybox. A pergunta `PID 1 é giochi-init?` tinha
  // resposta "não" garantida, então produzia WARN em TODO aparelho, para sempre
  // — o falso negativo permanente que o §12.22 descreve. A pergunta certa é se
  // o inittab chama o script.
  const texto = await readFile(SELFTEST, "utf8");
  assert.doesNotMatch(
    texto,
    /PID 1 é giochi-init/,
    "voltou a checar PID 1: nunca é verdade e vira WARN permanente",
  );
  assert.match(texto, /inittab chama giochi-init/);
});

test("o selftest falha quando há launcher e a camada de boot está desligada", async () => {
  // Sem isso, o launcher está na imagem, ninguém o chama, e o diagnóstico diz
  // que está tudo bem — o pior tipo de leitura.
  const texto = await readFile(SELFTEST, "utf8");
  assert.match(texto, /inittab NÃO chama giochi-init/);
  assert.match(texto, /LAUNCHER="?\/opt\/giochi\/apps\/launcher\/bin\/giochi-launcher/);
});
