import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do `scripts/arcade-probe/`.
//
// O probe existe para transformar uma conclusão de leitura de código em medida.
// Duas coisas precisam continuar verdadeiras para ele valer:
//
//   1. o probe mede o FENÔMENO certo — o arcade instalado de verdade carrega os
//      programas com geometry shader na inicialização, e o fallback sem geo
//      existe no pacote;
//   2. o documento não pode continuar afirmando a estimativa antiga ("só a
//      colisão quebra", "~10 linhas"), que a medição mostrou errada.
//
// O risco real é o de sempre: o estudo virar fato e a medição ser esquecida.

const PROBE = path.join(ROOT, "scripts/arcade-probe");
const DOC = path.join(ROOT, "docs/evaluacao-pyglet-arcade.md");

const read = (p) => readFile(p, "utf8");

test("o probe tem as três peças executáveis", async () => {
  for (const arquivo of ["Dockerfile", "run.sh", "arcade_probe.py", "patch-sem-geometry-shader.py", "README.md"]) {
    const alvo = path.join(PROBE, arquivo);
    const info = await stat(alvo).catch(() => null);
    assert.ok(info?.isFile(), `falta scripts/arcade-probe/${arquivo}`);
  }
  const run = await read(path.join(PROBE, "run.sh"));
  assert.match(run, /^#!\/usr\/bin\/env bash/, "run.sh precisa de shebang");
  assert.match(run, /xvfb-run -a/, "dois Xvfb no mesmo display colidem; use -a");
});

test("a versão do arcade está fixada — medir outra invalida o registro", async () => {
  const dockerfile = await read(path.join(PROBE, "Dockerfile"));
  assert.match(dockerfile, /arcade==3\.3\.3/);
  // O README cita os resultados dessa versão; se a versão subir, os números
  // antigos não se aplicam e alguém precisa remedir.
  const readme = await read(path.join(PROBE, "README.md"));
  assert.match(readme, /3\.3\.3/);
});

test("o probe mede os três cenários, não só o feliz", async () => {
  const run = await read(path.join(PROBE, "run.sh"));
  // A: prova que o ambiente funciona. B sem remendo: prova que a falha existe.
  // B com remendo: prova que o remendo resolve. Faltar qualquer um transforma
  // o probe em "abriu, então está bom".
  const linhas = run.split("\n");
  assert.ok(
    linhas.some((l) => /arcade_probe\.py A\b/.test(l)),
    "falta o cenário A (caminho normal)",
  );
  assert.ok(
    linhas.some((l) => /arcade_probe\.py B\b/.test(l) && !l.includes("--remendo")),
    "falta o cenário B sem remendo (prova que a falha existe)",
  );
  assert.ok(
    linhas.some((l) => /arcade_probe\.py B --remendo/.test(l)),
    "falta o cenário B com remendo",
  );
});

test("o patch falha alto quando a âncora não existe", async () => {
  const patch = await read(path.join(PROBE, "patch-sem-geometry-shader.py"));
  // Ancoras sao linhas exatas da 3.3.3. Aplicar "pela metade" em outra versao
  // seria pior que nao aplicar: o build fica verde e o comportamento muda.
  assert.match(patch, /raise SystemExit\(f"ERRO: ancora nao encontrada/);
  // E precisa ser idempotente: `run.sh` chama duas vezes em cenarios distintos.
  assert.match(patch, /ja aplicado/);
});

test("o patch cobre os cinco programas, e não só a colisão", async () => {
  const patch = await read(path.join(PROBE, "patch-sem-geometry-shader.py"));
  // Este foi o erro da primeira versão: só colisão. A 3.3.3 tem geometry
  // shader também no desenho de SpriteList e no sprite único.
  assert.match(patch, /sprite_list_program_no_cull/);
  assert.match(patch, /sprite_list_program_cull/);
  assert.match(patch, /sprite_program_single/);
  assert.match(patch, /collision_detection_program\b/);
  // E o fallback de dados, que estava comentado no pacote.
  assert.match(patch, /SpriteListTextureData/);
  assert.match(patch, /has_geometry_shaders/);
});

test("o probe registra o que NÃO prova", async () => {
  const readme = await read(path.join(PROBE, "README.md"));
  // Sem esta seção o resultado vira promessa: alguém lê "funciona" e assume
  // panfrost + GLES + KMSDRM, que não foram testados.
  assert.match(readme, /NÃO prova|NAO prova/i);
  for (const limite of [/llvmpipe/, /injetada/, /GLES/, /KMSDRM/]) {
    assert.match(readme, limite);
  }
});

test("o estudo não repete mais a estimativa que a medição desmentiu", async () => {
  const texto = await read(DOC);
  // A afirmação errada era "só os dois programas de colisão / todo o 2D funciona"
  // e a estimativa "~10 linhas". Ambas aparecem agora apenas como correção
  // explícita, nunca como conclusão.
  assert.match(texto, /Correção de uma afirmação anterior deste documento/);
  assert.match(texto, /cinco/i);
  assert.match(texto, /arcade-probe/);
  // A palavra "~10 linhas" só pode aparecer marcada como errada.
  const ocorrencias = [...texto.matchAll(/~10 linhas/g)];
  for (const achado of ocorrencias) {
    const contexto = texto.slice(Math.max(0, achado.index - 120), achado.index + 40);
    assert.match(contexto, /Errado|errado/, `"~10 linhas" sem marcação de erro perto de: ${contexto}`);
  }
});

test("o pixel não é usado como prova de desenho", async () => {
  const probe = await read(path.join(PROBE, "arcade_probe.py"));
  // Medido: get_image() e glReadPixels devolvem preto também no caminho que
  // funciona. Se alguém "melhorar" o probe para ler pixel, o teste passa a
  // mentir — em silêncio, que é o pior tipo.
  assert.doesNotMatch(
    probe,
    /glReadPixels|get_image\(/,
    "prova por pixel não distingue desenho de tela preta",
  );
  // A prova é interceptar o render da classe de dados.
  assert.match(probe, /cls\.render/, "a prova é o render() da classe de dados");
  assert.match(probe, /instrumenta\(SpriteListBufferData/);
  assert.match(probe, /instrumenta\(SpriteListTextureData/);
});
