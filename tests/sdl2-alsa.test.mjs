import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// SDL2 X ALSA — o defeito que só apareceu rodando a engine NO APARELHO.
//
// Medido em 07/11/2026 no R35S:
//
//   [WARN] áudio indisponível, seguindo sem som: não foi possível abrir o
//          dispositivo de áudio: dsp: No such audio device
//
// O SDL2 havia caído no backend OSS. No aparelho, `strings libSDL2 | grep -c
// alsa` dava 0; no build do X35H, 71. Causa:
//
//   sdl2.mk:160   ifeq ($(BR2_PACKAGE_ALSA_LIB),y)
//                 SDL2_CONF_OPTS += --enable-alsa
//
// é decidido NO CONFIGURE do sdl2. No build do R35S o sdl2 foi configurado às
// 06:20 e o `.config` com ALSA_LIB é das 19:33 — treze horas depois. Buildroot
// não reconfigura pacote construído quando uma dependência aparece (§12.29).
// O `config.log` diz `--disable-alsa` e o `.config` diz que está ligado; os
// dois estão coerentes e a imagem sai muda. Build verde, UI funciona, e "sem
// áudio" parece problema de driver de placa.
//
// O gate no post-build pergunta pela CONSEQUÊNCIA: alsa-lib está na imagem e o
// SDL2 não menciona ALSA? Então foi configurado sem ela.

const POST_BUILD = path.join(new URL("..", import.meta.url).pathname, "scripts", "post-build.sh");

async function fakeTarget({ libasound, sdl2MentionsAlsa }) {
  const dir = await mkdtemp(path.join(tmpdir(), "giochi-sdl2-"));
  await mkdir(path.join(dir, "etc"), { recursive: true });
  await mkdir(path.join(dir, "usr/lib"), { recursive: true });
  await mkdir(path.join(dir, "usr/bin"), { recursive: true });
  // o post-build exige /etc/inittab e um giochi-init executável
  await writeFile(path.join(dir, "etc/inittab"), "::sysinit:/etc/init.d/rcS\n");
  const init = path.join(dir, "usr/bin/giochi-init");
  await writeFile(init, "#!/bin/sh\n");
  await chmod(init, 0o755);
  if (libasound) await writeFile(path.join(dir, "usr/lib/libasound.so.2"), "x\n");
  await writeFile(
    path.join(dir, "usr/lib/libSDL2-2.0.so.0.2800.5"),
    sdl2MentionsAlsa ? "xx alsa yy snd_pcm\n" : "xx only-oss yy\n",
  );
  return dir;
}

const rodar = (dir) =>
  run("sh", [POST_BUILD], { env: { ...process.env, TARGET_DIR: dir } });

test("SDL2 com ALSA e alsa-lib na imagem: o build passa", async () => {
  const dir = await fakeTarget({ libasound: true, sdl2MentionsAlsa: true });
  try {
    const { stdout } = await rodar(dir);
    assert.match(stdout, /SDL2 com suporte a ALSA/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("alsa-lib na imagem e SDL2 SEM ALSA: o build FALHA", async () => {
  // Este é o caso real do R35S. A imagem sairia muda e o build ficaria verde.
  const dir = await fakeTarget({ libasound: true, sdl2MentionsAlsa: false });
  try {
    await assert.rejects(rodar(dir), (err) => {
      assert.match(err.stderr, /compilado SEM ALSA/);
      // a mensagem tem de dizer onde olhar: causa E correção
      assert.match(err.stderr, /--disable-alsa|configurado ANTES/);
      assert.match(err.stderr, /rm -rf .*sdl2-\*/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sem alsa-lib na imagem, SDL2 sem ALSA é legítimo e passa", async () => {
  // Aparelho sem áudio nenhum não deve ser reprovado pelo gate. O gate é sobre
  // a CONTRADIÇÃO (alsa-lib presente, SDL2 sem ela), não sobre ter ALSA.
  const dir = await fakeTarget({ libasound: false, sdl2MentionsAlsa: false });
  try {
    await rodar(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("o gate roda mesmo quando o inittab já está correto", async () => {
  // §12.49 na prática: a primeira versão da checagem ficou DEPOIS de um
  // `exit 0` do bloco do inittab, então só rodava no primeiro build. No
  // segundo — que é o caso normal de quem depura — passava reto, e o defeito
  // voltava em silêncio. Rodar duas vezes tem de manter a checagem ativa.
  const dir = await fakeTarget({ libasound: true, sdl2MentionsAlsa: false });
  try {
    await assert.rejects(rodar(dir), /compilado SEM ALSA/);
    // segunda execução: o inittab já tem a linha agora
    await assert.rejects(rodar(dir), /compilado SEM ALSA/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
