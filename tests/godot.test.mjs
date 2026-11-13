#!/usr/bin/env node
// Suporte a jogos Godot: o fragmento Wayland, o lançador e os fatos em que a
// decisão se apoia.
//
// ## Por que este teste existe
//
// O caminho do Godot é o mais fácil de "consertar" errado neste projeto. Três
// coisas parecem soluções e nenhuma é:
//
//   1. pôr `BR2_PACKAGE_CAGE=y` no `common.fragment` — quebra o QEMU, que não
//      tem wlroots, e o `olddefconfig` descarta o símbolo em SILÊNCIO (§12.1);
//   2. rodar o jogo com `SDL_VIDEODRIVER=kmsdrm` — o Godot não usa SDL2 e não
//      tem driver KMSDRM, então o processo roda e a tela fica preta;
//   3. pôr o `cage` como sessão padrão — o SDL2 desta árvore tem
//      `--disable-video-wayland` cravado no `.mk`, então o launcher perderia o
//      vídeo ao entrar no cage.
//
// Cada asserção abaixo corresponde a um desses enganos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GODOT_FRAGMENT = join(ROOT, "config/godot.fragment");
const COMMON = readFileSync(join(ROOT, "config/common.fragment"), "utf8");
const BUILD = readFileSync(join(ROOT, "scripts/build-device.sh"), "utf8");
const LANCADOR = join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-godot");

const ler = (p) => readFileSync(p, "utf8");

/** Símbolos `BR2_*` ligados (`=y`) num arquivo de fragmento. */
function simbolosLigados(texto) {
  return [...texto.matchAll(/^(BR2_[A-Z0-9_]+)=y$/gm)].map((m) => m[1]);
}

test("o fragmento do Godot existe e traz o compositor", () => {
  assert.ok(existsSync(GODOT_FRAGMENT), "config/godot.fragment não existe");
  const simbolos = simbolosLigados(ler(GODOT_FRAGMENT));
  for (const obrigatorio of [
    "BR2_PACKAGE_CAGE",
    "BR2_PACKAGE_WAYLAND",
    "BR2_PACKAGE_WAYLAND_PROTOCOLS",
    "BR2_PACKAGE_LIBXKBCOMMON",
  ]) {
    assert.ok(simbolos.includes(obrigatorio), `godot.fragment sem ${obrigatorio}=y`);
  }
});

test("o fragmento do Godot troca mdev por eudev, e isso é obrigatório", () => {
  const texto = ler(GODOT_FRAGMENT);
  // `cage` → `wlroots` → `select BR2_PACKAGE_LIBINPUT` → `depends on
  // BR2_PACKAGE_HAS_UDEV`. O mdev do busybox NÃO satisfaz HAS_UDEV, então sem
  // eudev o `olddefconfig` descarta BR2_PACKAGE_CAGE e o build fica verde.
  assert.match(texto, /^BR2_ROOTFS_DEVICE_CREATION_DYNAMIC_EUDEV=y$/m,
    "godot.fragment liga cage sem trocar o /dev management para eudev");
  assert.match(texto, /^BR2_PACKAGE_EUDEV=y$/m);
});

test("o Godot NÃO entra no fragmento comum (é opt-in por build)", () => {
  // O QEMU não tem wlroots nem eudev; e o R35S funciona hoje com mdev. Tornar
  // isto padrão quebraria os dois de uma vez, em silêncio.
  for (const proibido of ["BR2_PACKAGE_CAGE", "BR2_ROOTFS_DEVICE_CREATION_DYNAMIC_EUDEV"]) {
    assert.ok(!COMMON.includes(proibido),
      `${proibido} não pode estar no common.fragment — é opt-in`);
  }
  assert.match(BUILD, /GIOCHI_WITH_GODOT/, "build-device.sh não conhece GIOCHI_WITH_GODOT");
  assert.match(BUILD, /godot\.fragment/, "build-device.sh não entrega o fragmento ao prepare-config");
});

test("o build recusa combinar GIOCHI_WITH_GODOT com build retomado", () => {
  // Trocar mdev por eudev num `target/` já construído deixa a imagem com os
  // dois gerenciadores e nenhum funcionando — a família do §12.27.
  assert.match(BUILD, /GIOCHI_WITH_GODOT[\s\S]{0,900}?GIOCHI_SYSTEM_KEEP_WORK|KEEP_WORK[\s\S]{0,400}?GIOCHI_WITH_GODOT/);
  // A âncora é a ATRIBUIÇÃO, não a primeira menção: o nome da variável aparece
  // antes no cabeçalho de "Variáveis úteis", e ancorar na primeira ocorrência
  // fazia a janela começar na documentação em vez do bloco.
  const inicioBloco = BUILD.indexOf('WITH_GODOT="${GIOCHI_WITH_GODOT');
  assert.ok(inicioBloco > 0, "o parsing de GIOCHI_WITH_GODOT sumiu do build");
  const trecho = BUILD.slice(inicioBloco);
  assert.match(trecho.slice(0, 1200), /exit 2/,
    "não há saída explícita quando a combinação é inválida");
});

test("o lançador giochi-godot existe, é executável e diagnosticа", () => {
  assert.ok(existsSync(LANCADOR), "giochi-godot não existe");
  const modo = statSync(LANCADOR).mode;
  // `::respawn:` e chamada pelo app não vão rodar um script sem +x.
  assert.ok(modo & 0o111, "giochi-godot não é executável");
  const saida = execFileSync("sh", [LANCADOR, "--check"], { encoding: "utf8" });
  assert.match(saida, /cage:/, "--check não reporta o cage");
  assert.match(saida, /DRM master:/, "--check não reporta quem tem o DRM");
});

test("o lançador diz POR QUE não abre o jogo quando falta o cage", () => {
  // A diferença entre "não abre" e "a imagem foi construída sem o fragmento do
  // Godot" é a diferença entre uma hora e um dia de investigação.
  const texto = ler(LANCADOR);
  assert.match(texto, /GIOCHI_WITH_GODOT=1/, "não diz como consertar");
  assert.match(texto, /KMSDRM/, "não explica que o Godot não desenha em KMSDRM");
});

test("o lançador barra a disputa pelo DRM antes de subir o cage", () => {
  // O kernel permite UM DRM master. Com o launcher rodando, o cage falha com
  // um erro que não cita o outro processo.
  const texto = ler(LANCADOR);
  assert.match(texto, /dri\/card0/, "não verifica o DRM master");
  assert.match(texto, /exec "\$CAGE" -- /, "não repassa argumentos com separador `--`");
});

test("o fragmento registra o fato que decide a arquitetura: SDL2 sem Wayland", () => {
  // Se um dia o Buildroot passar a ter `BR2_PACKAGE_SDL2_WAYLAND`, este
  // comentário fica errado e a arquitetura pode simplificar (launcher dentro do
  // cage). O teste não impede a mudança — obriga a reler a decisão.
  const texto = ler(GODOT_FRAGMENT);
  assert.match(texto, /disable-video-wayland/,
    "o fragmento não registra a restrição do sdl2.mk");
  assert.match(texto, /SDL2_WAYLAND/, "não cita a opção que não existe");
});

test("a fonte TTF do Godot é declarada no fragmento, e com a família", () => {
  // `BR2_PACKAGE_DEJAVU=y` sozinho instala ZERO fontes (§11-A): `DEJAVU_FONTS_INSTALL`
  // começa vazio e só cresce dentro de `ifeq ($(BR2_PACKAGE_DEJAVU_SANS),y)`.
  const texto = ler(GODOT_FRAGMENT);
  if (/^BR2_PACKAGE_DEJAVU=y$/m.test(texto)) {
    assert.match(texto, /^BR2_PACKAGE_DEJAVU_SANS=y$/m,
      "DEJAVU=y sem DEJAVU_SANS=y instala uma pasta de fontes vazia");
  }
});
