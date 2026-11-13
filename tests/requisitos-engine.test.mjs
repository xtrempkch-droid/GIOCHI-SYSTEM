import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// REQUISITOS DE IMAGEM DA ENGINE — relatório de 13/11/2026.
//
// A equipe da engine levantou nove itens de "o que a imagem precisa
// acrescentar". Este arquivo prende os contratos dos que são NOSSOS; os que não
// são possíveis estão justificados em AGENTS §12.66 (glibc ≥ 2.39 exige trocar
// de Buildroot; térmica é hardware).
//
// Cada teste aqui existe porque o defeito correspondente tem a mesma forma: o
// build fica VERDE e a imagem sai sem o que foi prometido.

const OVERLAY = path.join(ROOT, "device/common/rootfs-overlay");
const COMMON = path.join(ROOT, "config/common.fragment");
const NET = path.join(OVERLAY, "usr/bin/giochi-usbnet");
const INIT = path.join(OVERLAY, "usr/bin/giochi-init");
const BUILD_SH = path.join(ROOT, "scripts/build-device.sh");
const EXTERNAL = path.join(ROOT, "buildroot-external");

const read = (p) => readFile(p, "utf8");

/** Recorta o heredoc que gera o `/etc/udhcpd.conf`. */
function blocoDoDhcp(texto) {
  const inicio = texto.indexOf('cat >"$DHCP_CONF" <<EOF');
  assert.ok(inicio > 0, "o heredoc do udhcpd.conf sumiu de giochi-usbnet");
  const fim = texto.indexOf("\nEOF\n", inicio);
  assert.ok(fim > inicio, "heredoc do udhcpd.conf sem terminador EOF");
  return texto.slice(inicio, fim);
}

// ── item 1: o DHCP não anuncia o que não existe ─────────────────────────────

test("o lease não anuncia gateway nem DNS", async () => {
  // Medido no R35S em 13/11/2026: o PC recebia `router 10.55.0.2` e
  // `dns 10.55.0.2`, num aparelho com ip_forward=0, sem NAT e sem porta 53.
  // Numa máquina cujo único adaptador é o cabo, a internet inteira para — e o
  // culpado parece o console.
  const bloco = blocoDoDhcp(await read(NET));
  assert.doesNotMatch(bloco, /^\s*option\s+router\b/m);
  assert.doesNotMatch(bloco, /^\s*option\s+dns\b/m);
});

test("o lease mantém o que sustenta o SSH", async () => {
  // Sem `subnet`, o cliente não sabe que 10.55.0.2 é ON-LINK e passa a
  // precisar de gateway — que é justamente o que não existe. O `domain` é
  // inerte sem DNS (não há resolver anunciado) e serve de rótulo.
  const bloco = blocoDoDhcp(await read(NET));
  assert.match(bloco, /^\s*option\s+subnet\s+255\.255\.255\.0\s*$/m);
  assert.match(bloco, /^\s*option\s+domain\s+giochi\.local\s*$/m);
});

test("anunciar gateway exige implementar o gateway", async () => {
  // A invariante, não o texto de hoje: se alguém devolver o `option router`
  // para "resolver" a internet do PC, tem de trazer junto o encaminhamento e o
  // NAT. Anunciar sem implementar é o defeito que este item corrige — a rota
  // morta esconde o erro até o primeiro `connect()`.
  const texto = await read(NET);
  const anuncia = /^\s*option\s+router\b/m.test(blocoDoDhcp(texto));
  if (anuncia) {
    assert.match(texto, /ip_forward/, "anuncia gateway sem ligar ip_forward");
    assert.match(texto, /\b(nft|iptables)\b/, "anuncia gateway sem regra de NAT");
  }
});

test("o aparelho NÃO ganha rota default", async () => {
  // Pedido explícito da engine: rota morta é pior que nenhuma. Sem uplink, o
  // `connect()` tem de falhar com ENETUNREACH em vez de sumir num gateway que
  // não encaminha. O `S40wifi` é a exceção: lá o uplink existe de verdade, e a
  // rota vem do `udhcpc`, não de uma linha cravada.
  const texto = await read(NET);
  assert.doesNotMatch(texto, /ip\s+route\s+add\s+default/);
  assert.doesNotMatch(texto, /default\s+via\s+/);
});

// ── item 3: `ldd` no alvo ───────────────────────────────────────────────────

test("o glibc utils está ligado no fragmento comum", async () => {
  // `ldd` é o que responde "por que este binário não abre". O símbolo existe no
  // Buildroot 2024.02 (package/glibc/Config.in:67) e instala `posix/getconf`,
  // `elf/ldd` e `elf/ldconfig` (glibc.mk:218-224).
  const texto = await read(COMMON);
  assert.match(texto, /^BR2_PACKAGE_GLIBC_UTILS=y$/m);
});

test("o glibc utils tem o bash de que o ldd depende", async () => {
  // O `ldd` do glibc é script de shell. O Buildroot amarra
  // `ac_cv_path_BASH_SHELL=/bin/bash` quando `BR2_PACKAGE_BASH=y`; sem ele o
  // script é reescrito para POSIX (GLIBC_LDD_NO_BASH). Não é erro sem o bash —
  // mas é uma mudança silenciosa de comportamento num utilitário de
  // diagnóstico, e por isso o par fica preso.
  const texto = await read(COMMON);
  assert.match(texto, /^BR2_PACKAGE_GLIBC_UTILS=y$/m);
  assert.match(texto, /^BR2_PACKAGE_BASH=y$/m);
});

// ── item 5: driver `dummy` do SDL2 ──────────────────────────────────────────

test("a árvore br2-external existe e é válida", async () => {
  // O Buildroot valida três arquivos e o nome em `support/scripts/br2-external`:
  // `external.desc` com `name:` só de [A-Za-z0-9_], `external.mk` e `Config.in`.
  // Faltar qualquer um aborta o build — e o teste roda em 1 ms.
  for (const arquivo of ["external.desc", "external.mk", "Config.in"]) {
    await access(path.join(EXTERNAL, arquivo));
  }
  const desc = await read(path.join(EXTERNAL, "external.desc"));
  const nome = desc.match(/^name:\s*(\S+)\s*$/m);
  assert.ok(nome, "external.desc sem linha `name:`");
  assert.match(nome[1], /^[A-Za-z0-9_]+$/, `nome inválido para br2-external: ${nome[1]}`);
});

test("o dummy do SDL2 é ligado no external.mk, não no override file", async () => {
  // O `package-overrides.mk` é incluído ANTES das receitas: lá, `SDL2_CONF_OPTS
  // += ...` é apagado pelo `+=` da receita, e `override SDL2_CONF_OPTS += ...`
  // bloqueia os `+=` DELA — perderia kmsdrm/alsa/opengles, que dependem do
  // `.config` de cada aparelho. O `external.mk` entra depois (Makefile:545).
  const mk = await read(path.join(EXTERNAL, "external.mk"));
  assert.match(mk, /^SDL2_CONF_OPTS := \$\(filter-out --disable-video-dummy,\$\(SDL2_CONF_OPTS\)\) --enable-video-dummy$/m);

  const overrides = await read(path.join(ROOT, "config/package-overrides.mk"));
  assert.doesNotMatch(
    overrides,
    /SDL2_CONF_OPTS/,
    "o override file não alcança as opções do sdl2 — use buildroot-external/",
  );
});

test("a flag de dummy não fica duplicada na linha de comando", async () => {
  // A primeira versão usava `+=`, e o `make --eval` mostrou a linha final com
  // `--disable-video-dummy ... --enable-video-dummy`. O autoconf do SDL2
  // percorre `$ac_configure_args` em ordem e a ÚLTIMA vence
  // (configure.ac:2441 — `AC_ARG_ENABLE(video-dummy, ..., , enable_video_dummy=yes)`),
  // então funciona; e é exatamente o tipo de coisa que não se deixa no repo: o
  // `config.log` registra as duas, a ordem é o único sustentáculo do
  // comportamento, e um reordenamento futuro desliga o dummy sem erro.
  //
  // `filter-out` é o que garante UMA flag só. Um `+=` aqui reintroduz o defeito.
  const mk = await read(path.join(EXTERNAL, "external.mk"));
  assert.doesNotMatch(
    mk,
    /^SDL2_CONF_OPTS\s*\+=/m,
    "`+=` deixa --disable-video-dummy e --enable-video-dummy juntas",
  );
  assert.match(mk, /filter-out --disable-video-dummy/);
});

test("o build exporta BR2_EXTERNAL e recusa árvore incompleta", async () => {
  // Sem `export`, o `Makefile:188` regenera `.br2-external.mk` vazio e o pacote
  // é construído sem o ajuste — sem erro. O export tem de vir antes de qualquer
  // invocação do make.
  const texto = await read(BUILD_SH);
  assert.match(texto, /^export BR2_EXTERNAL="\$BR2_EXTERNAL_DIR"$/m);

  const exportIdx = texto.indexOf('export BR2_EXTERNAL="$BR2_EXTERNAL_DIR"');
  const primeiroMake = texto.indexOf("make -C \"$BR2_DIR\"");
  assert.ok(exportIdx > 0 && primeiroMake > 0, "marcadores do build sumiram");
  assert.ok(
    exportIdx < primeiroMake,
    "BR2_EXTERNAL é exportado DEPOIS do primeiro make — não vale para ele",
  );
  assert.match(texto, /external\.desc external\.mk Config\.in/);
});

test("o giochi-init fixa o driver de vídeo em kmsdrm", async () => {
  // O dummy é o ÚLTIMO bootstrap do SDL2 (`SDL_video.c`): se kmsdrm falhar, o
  // SDL cai nele em silêncio — janela de mentira, tela preta, processo vivo.
  // Com a variável fixada, a falha aparece com o texto que a engine já
  // documenta ("kmsdrm not available").
  const texto = await read(INIT);
  assert.match(texto, /^SDL_VIDEODRIVER="\$\{SDL_VIDEODRIVER:-kmsdrm\}"$/m);
  assert.match(texto, /^export SDL_VIDEODRIVER$/m);
});

test("o driver fixado respeita quem escolhe dummy de propósito", async () => {
  // `=` em vez de `:=` no shell -- o `:-` é o que deixa o teste headless
  // definir SDL_VIDEODRIVER=dummy e a escolha sobreviver. Sem isso a variável
  // seria inútil: só kmsdrm, sempre.
  const texto = await read(INIT);
  assert.doesNotMatch(texto, /^SDL_VIDEODRIVER=kmsdrm$/m);
});

// ── item 7: SDK em vez de cabeçalhos no rootfs ──────────────────────────────

test("o SDK é gerado por escolha explícita, não sempre", async () => {
  // O tarball de um aparelho com mesa+SDL2 passa de ~400 MB e o artefato de CI
  // fica 14 dias no ar. Quem compila no PC usa `scripts/engine-build.sh`, que
  // lê `work/<device>/build/staging` e não precisa disto.
  const texto = await read(BUILD_SH);
  assert.match(texto, /WITH_SDK="\$\{GIOCHI_SYSTEM_SDK:-0\}"/);
  assert.match(texto, /make -C "\$BR2_DIR" O="\$BUILD_DIR" sdk/);
  // O tarball tem nome de tuple, então não cabe no `artifacts` do device.json.
  assert.match(texto, /\*sdk-buildroot\.tar\.gz/);
});

test("o rootfs NÃO ganha headers nem .pc — a resposta é o SDK", async () => {
  // Copiar `include/` para a imagem multiplica o tamanho e continua sem os
  // headers de libc. A decisão está no comment do item 7 do relatório, e este
  // teste impede que alguém "resolva" o item 7 pelo caminho errado.
  const comum = await read(COMMON);
  assert.doesNotMatch(comum, /BR2_PACKAGE_SDL2_DEV/);
  const overlays = ["qemu-aarch64", "r35s", "powkiddy x55", "powkiddy x35h"];
  for (const p of overlays) {
    const dir = path.join(ROOT, "device", p, "rootfs-overlay/usr/include");
    await assert.rejects(access(dir), `${p}: headers no rootfs`);
  }
});
