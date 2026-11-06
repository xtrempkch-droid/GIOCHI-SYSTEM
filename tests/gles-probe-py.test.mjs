#!/usr/bin/env node
// Probe de GLES por ctypes: o contrato que ele tem de cumprir.
//
// Existe porque `scripts/gles-probe.c` exige cross-toolchain e um `work/<device>`
// populado — e não roda num aparelho que não é nosso. A versão em Python usa o
// `python3` e o Mesa/EGL que JÁ estão na imagem.
//
// Os dois defeitos abaixo foram medidos no R35S em 06/11/2026 e cada um custou
// uma rodada de upload pela serial. Ficam presos aqui para não voltarem.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SOURCE = readFileSync(new URL("../scripts/gles-probe.py", import.meta.url), "utf8");

test("carrega EGL por caminho explicito, nao por find_library", () => {
  // `ctypes.util.find_library` depende de `ldconfig`, `gcc` ou varrer o PATH.
  // Num rootfs de handheld nenhum dos tres costuma existir, e o retorno e o
  // proprio nome ("EGL"), que o dlopen nao abre. O sintoma medido foi
  // `! nao carregou EGL`, que parece driver ausente e e biblioteca presente.
  assert.match(SOURCE, /"\/usr\/lib\/libEGL\.so\.1"/);
  assert.match(SOURCE, /"\/usr\/lib\/libGLESv2\.so\.2"/);
  // E o retorno do find_library tem de ser TRATADO, nao usado direto.
  assert.ok(
    !/ctypes\.util\.find_library\(name\) or name/.test(SOURCE),
    "usar o retorno do find_library direto e' o bug: ele devolve o nome, nao o caminho",
  );
  assert.match(SOURCE, /found != name/, "o retorno so' serve se for um caminho de verdade");
});

test("EGL_RENDERABLE_TYPE aparece uma vez POR LISTA, com os bits somados", () => {
  // Repetir a chave DENTRO da mesma lista de atributos e' invalido em EGL:
  // `eglChooseConfig` devolve 0 configs e a mensagem ("nenhum config renderable")
  // manda procurar driver, nao lista malformada.
  //
  // A chave aparece tres vezes no arquivo, e todas legitimas: a definicao da
  // constante, a lista ES3|ES2 e a lista de fallback ES2. O que nao pode e' duas
  // dentro da MESMA tupla — foi o bug medido.
  const tuples = [...SOURCE.matchAll(/\(ctypes\.c_int \* \d+\)\(([^)]*)\)/gs)].map(
    (match) => match[1],
  );
  assert.ok(tuples.length >= 2, "esperava a lista principal e a de fallback");

  for (const [index, tuple] of tuples.entries()) {
    const count = (tuple.match(/EGL_RENDERABLE_TYPE/g) ?? []).length;
    assert.ok(
      count <= 1,
      `a lista ${index} repete EGL_RENDERABLE_TYPE ${count} vezes: ${tuple.trim()}`,
    );
  }

  assert.match(
    SOURCE,
    /EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT \| EGL_OPENGL_ES2_BIT/,
    "os bits tem de ser somados numa unica entrada",
  );
});

test("a pergunta do arcade e' respondida explicitamente", () => {
  // O motivo do probe existir: `SpriteList` monta cinco programas que exigem
  // geometry shader, e `load_program` levanta em vez de degradar. Sem a
  // extensao, `arcade.Window()` aborta antes de desenhar qualquer coisa.
  assert.match(SOURCE, /GL_OES_geometry_shader/);
  assert.match(SOURCE, /GL_EXT_geometry_shader/);
  assert.match(SOURCE, /geometry shader DISPONIVEL/);
  assert.match(SOURCE, /geometry shader AUSENTE/);
});

test("le a lista de extensoes por glGetStringi, nao filtrada", () => {
  // `glGetString(GL_EXTENSIONS)` em contexto core pode devolver NULL ou so' as
  // extensoes de compilacao; `glGetStringi` com GL_NUM_EXTENSIONS e' a leitura
  // correta em ES3.
  assert.match(SOURCE, /GL_NUM_EXTENSIONS/);
  assert.match(SOURCE, /glGetStringi/);
});

test("nao compila nada e nao exige toolchain", () => {
  // Se aparecer subprocess/gcc no CODIGO, o probe perdeu a razao de existir: o
  // aparelho pode nao ter compilador. Docstring e comentario citam `gcc` de
  // propósito (explicando por que NAO se compila), então a checagem roda sobre o
  // codigo sem comentarios.
  const code = SOURCE
    .replace(/"""[\s\S]*?"""/g, "") // docstrings
    .replace(/#.*$/gm, ""); // comentarios de linha

  assert.ok(!/subprocess/.test(code), "probe nao deve chamar subprocess");
  assert.ok(!/\bgcc\b/.test(code), "probe nao deve chamar gcc");
  assert.ok(!/\bos\.system\b/.test(code), "probe nao deve chamar os.system");
  assert.ok(!/\bcompile\b/.test(code), "probe nao deve compilar nada");
});

test("roda com python3 da propria imagem e nao usa modulo externo", () => {
  // So' stdlib: num rootfs de handheld nao ha pip.
  const imports = [...SOURCE.matchAll(/^import (\w+)/gm)].map((match) => match[1]);
  const allowed = ["ctypes", "os", "sys"];
  for (const name of imports) {
    assert.ok(allowed.includes(name), `import inesperado: ${name}`);
  }
});
