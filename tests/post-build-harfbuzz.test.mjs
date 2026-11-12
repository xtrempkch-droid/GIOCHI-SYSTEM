import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

// HARFBUZZ — o gate que nunca disparou.
//
// A função `verifica_harfbuzz` do `post-build.sh` nasceu em 06/11/2026 para
// pegar o caso do §12.29: `libharfbuzz` na imagem e `libSDL2_ttf` configurado
// com `--disable-harfbuzz`, porque o pacote foi construído ANTES da dependência
// entrar no `.config`. O texto com escrita complexa sai errado, sem erro em
// tempo de execução.
//
// O gate começava com
//
//   [ "${BR2_PACKAGE_HARFBUZZ:-n}" = "y" ] || return 0
//
// e **nunca rodou**. O Buildroot chama o post-build com
// `EXTRA_ENV = PATH BR2_DL_DIR BUILD_DIR CONFIG_DIR O` — nenhum `BR2_PACKAGE_*`
// chega ao ambiente. É a MESMA armadilha do HOST_DIR, documentada no topo do
// próprio `post-build.sh`, repetida três parágrafos abaixo na mesma função.
// Com `:-n` o teste era sempre falso e a função retornava antes de olhar a
// imagem: build verde e nenhuma cobertura.
//
// Por isso o teste roda o script de VERDADE com um ambiente SEM `BR2_*` — o
// ambiente real. Um teste que exportasse `BR2_PACKAGE_HARFBUZZ=y` passaria
// mesmo com o bug.

const POST_BUILD = path.join(fileURLToPath(new URL("..", import.meta.url)), "scripts", "post-build.sh");

// Reproduz o `EXTRA_ENV` do Buildroot: nada de BR2_*.
function ambienteDoBuildroot(extra = {}) {
  const env = {};
  for (const [chave, valor] of Object.entries(process.env)) {
    if (!chave.startsWith("BR2_")) env[chave] = valor;
  }
  return { ...env, ...extra };
}

async function alvo({ comHarfbuzz, ttfCita }) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-hb-"));
  await mkdir(path.join(dir, "etc"), { recursive: true });
  await mkdir(path.join(dir, "usr/lib"), { recursive: true });
  await mkdir(path.join(dir, "usr/bin"), { recursive: true });
  await writeFile(path.join(dir, "etc/inittab"), "::sysinit:/etc/init.d/rcS\n");
  const init = path.join(dir, "usr/bin/giochi-init");
  await writeFile(init, "#!/bin/sh\n");
  await chmod(init, 0o755);
  if (comHarfbuzz) {
    await writeFile(path.join(dir, "usr/lib/libharfbuzz.so.0.60830.0"), "hb\n");
  }
  await writeFile(
    path.join(dir, "usr/lib/libSDL2_ttf-2.0.so.0.2200.0"),
    ttfCita ? "xx libharfbuzz.so.0 yy\n" : "xx nada yy\n",
  );
  return dir;
}

const rodar = (dir) =>
  run("sh", [POST_BUILD], { env: ambienteDoBuildroot({ TARGET_DIR: dir }) });

test("harfbuzz na imagem e SDL2_ttf sem ele: o build FALHA", async () => {
  const dir = await alvo({ comHarfbuzz: true, ttfCita: false });
  try {
    await assert.rejects(
      rodar(dir),
      (erro) => {
        const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
        assert.match(saida, /NÃO pede harfbuzz/, "a mensagem tem de nomear a consequência");
        assert.match(saida, /sdl2_ttf/, "e o pacote a limpar");
        return true;
      },
      "o gate precisa reprovar — é o caso que ele existe para pegar",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o gate dispara mesmo sem BR2_PACKAGE_HARFBUZZ no ambiente", async () => {
  // A regressão exata: com a guarda `${BR2_PACKAGE_HARFBUZZ:-n}` a função
  // retornava antes de olhar a imagem, e este caso passava como sucesso.
  const dir = await alvo({ comHarfbuzz: true, ttfCita: false });
  try {
    await assert.rejects(rodar(dir), /NÃO pede harfbuzz/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const texto = await readFile(POST_BUILD, "utf8");
  // Só o CÓDIGO: o comentário acima desta função cita a linha antiga de
  // propósito, para quem for mexer entender por que a guarda saiu.
  const executavel = texto
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("#"))
    .join("\n");
  assert.ok(
    !/BR2_PACKAGE_HARFBUZZ:?[-=]/.test(executavel),
    "o gate não pode depender de variável BR2_*: ela não chega ao post-build",
  );
});

test("harfbuzz ao lado de um ttf que o pede: passa", async () => {
  const dir = await alvo({ comHarfbuzz: true, ttfCita: true });
  try {
    const { stdout } = await rodar(dir);
    assert.match(stdout, /SDL2_ttf pede libharfbuzz/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("aparelho sem harfbuzz é legítimo e passa", async () => {
  // Quem não usa escrita complexa não empacota harfbuzz. O gate não pode
  // transformar "não pediu" em "esqueceu".
  const dir = await alvo({ comHarfbuzz: false, ttfCita: false });
  try {
    const { stdout } = await rodar(dir);
    assert.ok(!/NÃO pede harfbuzz/.test(stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("aparelho sem SDL2_ttf não é afetado", async () => {
  const dir = await alvo({ comHarfbuzz: true, ttfCita: false });
  try {
    await rm(path.join(dir, "usr/lib/libSDL2_ttf-2.0.so.0.2200.0"), { force: true });
    await rodar(dir); // não pode lançar
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
