import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do estudo pyglet/arcade (docs/evaluacao-pyglet-arcade.md).
//
// O que estes testes protegem não é o código do jogo: é a **memória da
// análise**. O veredito depende de fatos que envelhecem — se o pyglet ganhar um
// backend KMSDRM, ou se o arcade traduzir os shaders para GLSL ES, a conclusão
// muda e o documento precisa mudar junto.
//
// O risco real é o oposto do estudo do Quiver: ali a licença era o bloqueio e
// alguém poderia "resolver" o problema trocando de licença. Aqui o bloqueio é
// técnico e some sozinho no dia em que o upstream implementar a janela — e aí
// ninguém vai lembrar de reler o documento.

const DOC = path.join(ROOT, "docs/evaluacao-pyglet-arcade.md");

test("o estudo existe e registra o bloqueio real, não um genérico", async () => {
  const texto = await readFile(DOC, "utf8");
  // O bloqueio é a JANELA, não licença nem gamepad — se o documento começar a
  // dizer outra coisa, o veredito foi trocado sem nova medição.
  assert.match(texto, /KMSDRM/);
  assert.match(texto, /xlib/);
  assert.match(texto, /evdev/);
  assert.match(texto, /BSD-3|BSD 3/);
  assert.match(texto, /MIT/);
});

test("o estudo separa o que é medido do que é estimado", async () => {
  const texto = await readFile(DOC, "utf8");
  // A regra do repositório: número estimado tem de estar dito como estimado.
  // A §6 se recusa a inventar RAM de jogo — e isso tem de continuar explícito.
  assert.match(texto, /a medir/);
  assert.match(texto, /N[ãa]o vou inventar n[úu]mero/);
});

test("as três armadilhas técnicas estão nomeadas", async () => {
  const texto = await readFile(DOC, "utf8");
  // Cada uma derruba um caminho diferente; perder qualquer uma do documento
  // faz alguém gastar uma rodada descobrindo de novo.
  assert.match(texto, /#version 330/, "shaders do arcade são desktop GLSL");
  assert.match(texto, /geometry shader/i, "colisão usa geometry shader");
  assert.match(texto, /3\.0\.dev11/, "pyglet vem pinado num pré-release");
  assert.match(texto, /pymunk/, "dependência binária que não existe no Buildroot");
});

test("o estudo aponta a alternativa que já funciona na imagem", async () => {
  const texto = await readFile(DOC, "utf8");
  // Sem isto o documento responde "não" e deixa o usuário sem saída. O PySDL2
  // usa o SDL2/KMSDRM que a imagem JÁ tem.
  assert.match(texto, /PySDL2/);
  assert.match(texto, /CC0|dom[íi]nio p[úu]blico/);
});

test("o estudo registra a consequência sobre o gate da pilha gráfica", async () => {
  const texto = await readFile(DOC, "utf8");
  // Escolher X11 na imagem exige alterar tests/graphics-stack.test.mjs com a
  // decisão registrada — não contornar o teste. Se o documento parar de dizer
  // isso, a próxima pessoa vai só apagar a linha do gate.
  assert.match(texto, /graphics-stack\.test\.mjs/);
  assert.match(texto, /BR2_PACKAGE_XORG7/);
});

test("o Python do Buildroot atende o arcade", async () => {
  // arcade exige >= 3.11. Isto é um fato do Buildroot 2024.02 que precisa
  // continuar verdadeiro se a versão for atualizada: subir o Buildroot e cair
  // para 3.10 quebraria o caminho inteiro, sem aviso.
  const version = (
    await readFile(path.join(ROOT, "buildroot.version"), "utf8")
  ).trim();
  assert.equal(version, "2024.02", "revalidar Python e pillow/numpy ao atualizar");

  const mk = path.join(
    process.env.GIOCHI_SYSTEM_WORK_DIR ?? path.join(process.env.HOME ?? "", ".cache/giochi-system/work"),
    "powkiddy-x55",
    `buildroot-${version}`,
    "package/python3/python3.mk",
  );
  let texto;
  try {
    texto = await readFile(mk, "utf8");
  } catch {
    return; // árvore do Buildroot não extraída: nada a conferir
  }
  // O .mk declara em duas etapas:
  //   PYTHON3_VERSION_MAJOR = 3.11
  //   PYTHON3_VERSION = $(PYTHON3_VERSION_MAJOR).8
  // Então o major.minor vem da primeira linha, e não do literal da segunda.
  const majorMinor = texto.match(/^PYTHON3_VERSION_MAJOR = (\d+)\.(\d+)/m);
  assert.ok(majorMinor, "PYTHON3_VERSION_MAJOR não encontrado");
  const [major, minor] = [Number(majorMinor[1]), Number(majorMinor[2])];
  assert.ok(
    major === 3 && minor >= 11,
    `arcade exige Python >= 3.11; o Buildroot ${version} tem ${major}.${minor}`,
  );
});
