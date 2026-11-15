import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { DEVICE_ROOT, ROOT } from "../scripts/lib/devices.mjs";

// Invariante da pilha gráfica: **handheld roda em KMSDRM, sem servidor gráfico.**
//
// Não é preferência estética. O caminho de render desta árvore é SDL2 +
// KMSDRM + OpenGL ES sobre o DRM direto, e é o que foi medido funcionando nos
// dois aparelhos (§11-A do AGENTS). Trazer GTK3/WebKitGTK/X11/Wayland para
// dentro de um defconfig de handheld não é "adicionar um pacote": é trocar a
// arquitetura de vídeo, e o custo está medido em
// docs/evaluacao-quiver-launcher.md.
//
// Este teste existe porque a decisão foi tomada uma vez (avaliar o Quiver
// Launcher) e a forma de desfazê-la em silêncio é uma linha num defconfig:
// `BR2_PACKAGE_LIBGTK3=y` arrasta cairo, icu, libsoup3, libsecret, harfbuzz,
// libxslt, enchant, sqlite, webp, woff2 e libseccomp (selects do próprio
// Kconfig), e o build continua verde.
//
// O QEMU entra na regra pelo mesmo motivo do launcher-deps: o fragmento comum
// vale para TODOS os aparelhos, inclusive o único que está habilitado na CI.

const DESKTOP = [
  // Servidor gráfico
  ["BR2_PACKAGE_XORG7", "Xorg"],
  ["BR2_PACKAGE_WAYLAND", "Wayland"],
  ["BR2_PACKAGE_WESTON", "Weston"],
  ["BR2_PACKAGE_CAGE", "cage"],
  // Toolkit
  ["BR2_PACKAGE_LIBGTK2", "GTK2"],
  ["BR2_PACKAGE_LIBGTK3", "GTK3"],
  ["BR2_PACKAGE_WEBKITGTK", "WebKitGTK"],
  ["BR2_PACKAGE_WPEWEBKIT", "WPE WebKit"],
  // Barramento de sessão que os dois exigem
  ["BR2_PACKAGE_DBUS", "D-Bus"],
];

function ligados(texto) {
  const achados = [];
  for (const [simbolo, nome] of DESKTOP) {
    if (new RegExp(`^${simbolo}=y$`, "m").test(texto)) achados.push(nome);
  }
  return achados;
}

test("o fragmento comum não puxa pilha de desktop", async () => {
  const texto = await readFile(path.join(ROOT, "config/common.fragment"), "utf8");
  const achados = ligados(texto);
  assert.deepEqual(
    achados,
    [],
    `config/common.fragment vale para TODO aparelho, inclusive o QEMU. ` +
      `Pilha de desktop (${achados.join(", ")}) mora no fragmento do aparelho, ` +
      `e só com a decisão registrada em docs/evaluacao-quiver-launcher.md.`,
  );
});

test("nenhum defconfig de handheld tem servidor gráfico", async () => {
  const problemas = [];
  for (const entry of await readdir(DEVICE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const arquivo = path.join(DEVICE_ROOT, entry.name, "defconfig");
    let texto;
    try {
      texto = await readFile(arquivo, "utf8");
    } catch {
      continue; // rascunho sem defconfig não gera imagem
    }
    const achados = ligados(texto);
    if (achados.length > 0) {
      problemas.push(`${entry.name}: ${achados.join(", ")}`);
    }
  }
  assert.deepEqual(
    problemas,
    [],
    "handheld renderiza em KMSDRM (SDL2 direto no DRM). GTK3/WebKit exigem " +
      "servidor gráfico e não são linha de defconfig: ver " +
      "docs/evaluacao-quiver-launcher.md",
  );
});

test("o estudo do Quiver registra o veredito e os quatro bloqueios", async () => {
  const texto = await readFile(
    path.join(ROOT, "docs/evaluacao-quiver-launcher.md"),
    "utf8",
  );
  // Se a decisão for revista, é este documento que muda — não um defconfig.
  assert.match(texto, /não integrar/i);
  for (const bloqueio of [
    /Business Source License|BSL/, // licença
    /KMSDRM|servidor gráfico/, // arquitetura de vídeo
    /1\.90/, // toolchain de Rust
    /2 GB|RAM/, // memória
  ]) {
    assert.match(texto, bloqueio);
  }
  // O veredito não pode ter sido escrito sem citar o caminho que serve.
  assert.match(texto, /loja|store/i);
});

// kmscube é o único jeito de PROVAR que a GPU desenha.
//
// `GL_VERSION` não distingue GPU de CPU: com o panfrost fora do caminho, o Mesa
// cai no `softpipe` e responde exatamente "OpenGL ES 3.1" (§12.51). O que
// separa os dois é `GL_RENDERER` — e, de forma ainda mais direta, um desenho de
// verdade: contexto EGL, shader compilado e scanout. Sem um binário de teste na
// imagem, `giochi-selftest` só consegue afirmar "o driver panfrost existe", que
// é a pergunta indireta.
//
// A invariante é a mesma do launcher-deps: **quem liga mesa3d liga o teste**.
test("todo aparelho com mesa3d leva o kmscube, para poder provar 3D", async () => {
  const semTeste = [];
  const comMesa = [];
  for (const entry of await readdir(DEVICE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const arquivo = path.join(DEVICE_ROOT, entry.name, "defconfig");
    let texto;
    try {
      texto = await readFile(arquivo, "utf8");
    } catch {
      continue;
    }
    const mesa = /^BR2_PACKAGE_MESA3D=y$/m.test(texto);
    const egl = /^BR2_PACKAGE_MESA3D_OPENGL_EGL=y$/m.test(texto);
    const kms = /^BR2_PACKAGE_KMSCUBE=y$/m.test(texto);
    if (mesa && egl) {
      comMesa.push(entry.name);
      if (!kms) semTeste.push(entry.name);
    }
  }
  assert.ok(
    comMesa.length > 0,
    "nenhum defconfig liga mesa3d+EGL: o teste não estaria testando nada",
  );
  assert.deepEqual(
    semTeste,
    [],
    `estes aparelhos têm GPU e pilha de render, mas nenhum jeito de provar que ` +
      `ela desenha: ${semTeste.join(", ")}. Acrescente BR2_PACKAGE_KMSCUBE=y ao ` +
      `defconfig. As dependências (EGL, GLES, libgbm, libdrm) já vêm de ` +
      `MESA3D_OPENGL_EGL, que faz select MESA3D_GBM.`,
  );
});

test("o kmscube NÃO entra no fragmento comum (o QEMU não tem mesa3d)", async () => {
  const texto = await readFile(path.join(ROOT, "config/common.fragment"), "utf8");
  // `config/common.fragment` vale para o qemu-aarch64 também, e sem mesa3d o
  // símbolo nem é oferecido: o olddefconfig o descarta em silêncio e o
  // assert-config reprova o build do único aparelho que a CI sempre constrói.
  const ligado = /^BR2_PACKAGE_KMSCUBE=y$/m.test(texto);
  assert.ok(
    !ligado,
    "BR2_PACKAGE_KMSCUBE=y no fragmento comum quebra o build do qemu-aarch64: " +
      "sem mesa3d o símbolo é descartado e o assert-config reprova. " +
      "Ele mora no defconfig de cada aparelho com GPU.",
  );
});
