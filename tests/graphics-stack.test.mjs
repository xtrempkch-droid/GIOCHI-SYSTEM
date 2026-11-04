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
