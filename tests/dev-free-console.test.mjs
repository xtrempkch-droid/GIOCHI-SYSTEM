import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const INIT = path.join(new URL("..", import.meta.url).pathname,
  "device/common/rootfs-overlay/usr/bin/giochi-init");

// CONSOLE LIVRE — `touch /run/giochi/dev-free-console` impede o giochi-init de
// iniciar o launcher enquanto o arquivo existir.
//
// Pedido da equipe da engine (07/11/2026, P4). O que acontecia antes: para
// testar um binário que precisa do DRM master era preciso `chmod -x` no
// launcher e lembrar de reverter. Esquecer deixa o aparelho sem interface para
// sempre, e o launcher morto 5 vezes em 60 s faz o supervisor desistir — tela
// preta, `sleep 3600`, nada no console dizendo por quê.

async function cenario({ comFlag }) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-devfree-"));
  const launcher = path.join(dir, "launcher");
  const log = path.join(dir, "execucoes.log");
  await writeFile(launcher, `#!/bin/sh\necho x >> ${log}\necho "saindo" >/dev/null\nexit 0\n`);
  await chmod(launcher, 0o755);
  if (comFlag) {
    await mkdir(path.join(dir, "run"), { recursive: true });
    await writeFile(path.join(dir, "run/dev-free"), "");
  }
  const env = {
    ...process.env,
    GIOCHI_LAUNCHER: launcher,
    GIOCHI_CONFIG_DIR: path.join(dir, "cfg"),
    GIOCHI_PARADA_FILE: path.join(dir, "run/parado"),
    GIOCHI_DEV_FREE_FILE: path.join(dir, "run/dev-free"),
    GIOCHI_LAUNCHER_WAIT: "1",
  };
  return { dir, log, env };
}

async function execucoes(log) {
  try {
    return (await readFile(log, "utf8")).split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function rodar(env, ms) {
  // `timeout` mata o laço infinito do init; o exit é esperado e não é falha.
  try {
    await run("timeout", [String(ms / 1000), "sh", INIT], { env, timeout: ms + 5000 });
  } catch {
    /* timeout mata com 124 — normal */
  }
}

test("sem a flag, o launcher é iniciado", async () => {
  const { dir, log, env } = await cenario({ comFlag: false });
  try {
    await rodar(env, 4000);
    assert.ok((await execucoes(log)) > 0, "o launcher devia ter rodado");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("com a flag, o launcher NÃO é iniciado", async () => {
  // É o ponto inteiro: o console fica livre para quem precisa do DRM master.
  const { dir, log, env } = await cenario({ comFlag: true });
  try {
    await rodar(env, 4000);
    assert.equal(await execucoes(log), 0, "a flag devia impedir o launcher");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remover a flag devolve o comportamento normal", async () => {
  // Sem isto a flag seria uma armadilha: quem a cria não saberia voltar.
  const { dir, log, env } = await cenario({ comFlag: true });
  try {
    await rodar(env, 3000);
    assert.equal(await execucoes(log), 0);
    await rm(path.join(dir, "run/dev-free"), { force: true });
    await rodar(env, 4000);
    assert.ok((await execucoes(log)) > 0, "após rm, o launcher devia voltar");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a flag é documentada no próprio script", async () => {
  // Arquivo de liberação que ninguém conhece não libera nada. O caminho tem de
  // estar no texto do script, que é onde alguém vai procurar.
  const texto = await readFile(INIT, "utf8");
  assert.match(texto, /dev-free-console/);
  assert.match(texto, /DRM master/);
});
