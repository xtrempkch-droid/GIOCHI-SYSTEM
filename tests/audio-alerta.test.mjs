#!/usr/bin/env node
// Contrato de `scripts/audio-alerta.sh`.
//
// O script existe para provar som pela via SDL2 → ALSA, e não pelo ALSA direto:
// `speaker-test` toca num aparelho onde o SDL2 foi compilado com `--disable-alsa`
// e todo app SDL fica mudo (§12.56). Duas coisas o faziam mentir, as duas
// medidas em 08/11/2026:
//
//  1. **duração anunciada ≠ duração tocada.** O script imprimia "${DURACAO_S}s"
//     e chamava o probe SEM argumento, então o binário tocava o próprio padrão
//     (1500 ms) e `--alar` (3 bipes de 0,35 s) tocava 1,5 s cada;
//  2. **aparelho cravado no código.** `out/r35s/` e `work/r35s/` fixos: rodando
//     contra a X55, cross-compilava com o sysroot do R35S e ninguém percebia —
//     os dois são aarch64 e o `libSDL2` liga dinamicamente.
//
// As duas são a mesma família do §12.24 e do §12.30: a ferramenta respondendo a
// pergunta que não foi feita.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const AUDIO = readFileSync(new URL("../scripts/audio-alerta.sh", import.meta.url), "utf8");
const PROBE = readFileSync(new URL("../scripts/sdl-audio-probe.c", import.meta.url), "utf8");

/** Texto sem comentários: o comentário que explica o defeito contém o código que ele proíbe. */
const CODIGO = AUDIO.split("\n")
  .map((l) => l.replace(/#.*$/, ""))
  .join("\n");

test("a duração anunciada chega ao probe", () => {
  // O probe aceita a duração em ms no argv[1].
  assert.match(PROBE, /argc > 1[\s\S]*atoi\(argv\[1\]\)/,
    "o probe recebe a duração por argumento");
  assert.match(CODIGO, /DURACAO_MS=/, "o script tem de converter a duração para ms");
  assert.match(CODIGO, /sdl-audio-probe \$DURACAO_MS/,
    "e tem de PASSAR a duração; sem isso toca o padrão do binário");
});

test("nenhum aparelho cravado no script", () => {
  // `out/r35s/` e `work/r35s/` eram fixos: com a X55 em 10.55.0.2 o binário
  // saía do sysroot do R35S.
  assert.ok(!/out\/r35s|work\/r35s|\/r35s\/build/.test(CODIGO),
    "não pode haver caminho de aparelho específico");
  assert.match(CODIGO, /build-info\.txt/, "o aparelho tem de ser descoberto na imagem");
  assert.match(CODIGO, /GIOCHI_DEVICE/, "e tem de haver como sobrepor por variável");
  assert.match(CODIGO, /out\/\$DEVICE/, "o binário vai para out/<device>");
});

test("o script não fixa o driver de áudio do SDL2", () => {
  // Fixar `SDL_AUDIODRIVER=alsa` esconderia exatamente o defeito que o script
  // existe para pegar: o SDL2 caindo no `dsp`/OSS por não ter ALSA compilado.
  assert.ok(!/SDL_AUDIODRIVER=/.test(CODIGO),
    "fixar SDL_AUDIODRIVER esconde a escolha que se quer observar");
  // O veredito é impresso pelo BINÁRIO, não pelo script: é ele que sabe qual
  // driver o SDL2 escolheu de fato.
  assert.match(PROBE, /VEREDITO/);
});
