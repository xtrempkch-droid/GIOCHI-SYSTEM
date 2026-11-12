import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

// SDL2_image X DECODIFICADORES — o terceiro caso da mesma família.
//
// O padrão se repetiu três vezes nesta árvore, e é sempre a mesma forma:
//
//   ifeq ($(BR2_PACKAGE_<LIB>),y)  ->  --enable-<formato>
//
// no `.mk` do consumidor. `sdl2` com ALSA (§12.56), `alsa-utils` com
// `amixer`/`aplay` (§12.16), `sdl2_image` com PNG/JPEG/WebP. Em todos, o
// símbolo do FORMATO não existe: existe o pacote da biblioteca, e o consumidor
// pergunta por ele no configure.
//
// Medido no R35S em 07/11/2026: `libpng` declarado no defconfig e
// `--disable-png` no `config.log` do sdl2_image. Sintoma: `IMG_isPNG` existe e
// responde "PNG images are not supported" — erro que aparece no app, não no
// build, e parece bug de quem chamou.

const POST_BUILD = path.join(fileURLToPath(new URL("..", import.meta.url)), "scripts", "post-build.sh");

async function alvo({ libs = [], sdlimgRefs = [] }) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-img-"));
  await mkdir(path.join(dir, "etc"), { recursive: true });
  await mkdir(path.join(dir, "usr/lib"), { recursive: true });
  await mkdir(path.join(dir, "usr/bin"), { recursive: true });
  await writeFile(path.join(dir, "etc/inittab"), "::sysinit:/etc/init.d/rcS\n");
  const init = path.join(dir, "usr/bin/giochi-init");
  await writeFile(init, "#!/bin/sh\n");
  await chmod(init, 0o755);
  for (const l of libs) await writeFile(path.join(dir, `usr/lib/${l}`), "x\n");
  // O gate mede o .so do SYSROOT do host, nao o do target: o target passou por
  // `strip` e `stbi_` e um simbolo, que o strip remove. Estrutura minima de um
  // layout de build: <base>/target e <base>/build/host/<trio>/sysroot.
  const sysrootLib = path.join(dir, "..", "build/host/aarch64-buildroot-linux-gnu/sysroot/usr/lib");
  await mkdir(sysrootLib, { recursive: true });
  await writeFile(
    path.join(sysrootLib, "libSDL2_image-2.0.so.0.800.2"),
    sdlimgRefs.length ? `xx ${sdlimgRefs.join(" ")} yy\n` : "xx nada yy\n",
  );
  return dir;
}

const rodar = (dir) =>
  run("sh", [POST_BUILD], { env: { ...process.env, TARGET_DIR: dir } });

test("stb_image embutido conta como decodificador PNG/JPEG", async () => {
  // SDL2_image 2.8+ decodifica PNG e JPEG pelo stb_image EMBUTIDO
  // (`-DUSE_STBIMAGE=1`). A biblioteca NUNCA lista libpng/libjpeg como NEEDED
  // nem as menciona, mesmo com o suporte ligado. Medido:
  //   com --enable-png:  stbi_ = 1   libpng = 0
  //   sem:               stbi_ = 0   libpng = 0
  // A primeira versão do gate exigia referência a libpng e reprovou um build
  // correto — a mesma classe do `debugfs` ausente: perguntou pela
  // implementação, e a implementação mudou de biblioteca.
  const dir = await alvo({ libs: ["libpng16.so.16"], sdlimgRefs: ["stbi_"] });
  try {
    const { stdout } = await rodar(dir);
    assert.match(stdout, /SDL2_image com os decodificadores/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nem stb nem libpng: o build FALHA", async () => {
  // Caso real: `--disable-png` porque `BR2_PACKAGE_LIBPNG` nao estava no
  // defconfig. A imagem sai com `IMG_isPNG` presente e respondendo
  // "PNG images are not supported" — erro que aparece no app, nao no build.
  const dir = await alvo({ libs: ["libpng16.so.16"], sdlimgRefs: [] });
  try {
    await assert.rejects(rodar(dir), (err) => {
      assert.match(err.stderr, /SEM decodificador/);
      assert.match(err.stderr, /PNG/);
      // a mensagem tem de ensinar o diagnóstico E a correção
      assert.match(err.stderr, /--disable-png|configurado ANTES/);
      assert.match(err.stderr, /rm -rf .*sdl2_image-\*/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sem libpng na imagem, SDL2_image sem PNG é legítimo", async () => {
  // Aparelho que não quer PNG não deve ser reprovado. O gate é sobre a
  // CONTRADIÇÃO (lib presente, consumidor sem ela), não sobre ter PNG.
  const dir = await alvo({ libs: [], sdlimgRefs: [] });
  try {
    await rodar(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WebP exige referência própria — stb_image não decodifica WebP", async () => {
  // O stb_image cobre PNG/JPEG, não WebP. Com `libwebp` na imagem e sem
  // referência a webp na biblioteca, o formato não está compilado.
  const dir = await alvo({
    libs: ["libpng16.so.16", "libwebp.so.7"],
    sdlimgRefs: ["stbi_"],       // PNG/JPEG ok, WebP nao
  });
  try {
    await assert.rejects(rodar(dir), (err) => {
      assert.match(err.stderr, /WebP/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("com WebP referenciado, passa", async () => {
  const dir = await alvo({
    libs: ["libpng16.so.16", "libwebp.so.7"],
    sdlimgRefs: ["stbi_", "webp"],
  });
  try {
    await rodar(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("aparelho sem SDL2_image não é afetado pelo gate", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-img-"));
  try {
    await mkdir(path.join(dir, "etc"), { recursive: true });
    await mkdir(path.join(dir, "usr/lib"), { recursive: true });
    await mkdir(path.join(dir, "usr/bin"), { recursive: true });
    await writeFile(path.join(dir, "etc/inittab"), "::sysinit:/etc/init.d/rcS\n");
    const init = path.join(dir, "usr/bin/giochi-init");
    await writeFile(init, "#!/bin/sh\n");
    await chmod(init, 0o755);
    await writeFile(path.join(dir, "usr/lib/libpng16.so.16"), "x\n");
    await rodar(dir);   // sem libSDL2_image: nada a exigir
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
