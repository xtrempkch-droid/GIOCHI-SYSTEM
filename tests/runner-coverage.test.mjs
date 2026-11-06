#!/usr/bin/env node
// Todo `tests/*.test.mjs` tem de estar importado pelo `run-all.mjs`.
//
// Por que isto existe: o runner não descobre arquivos por glob — ele importa cada
// um explicitamente, porque `node --test tests/` spawna um processo por arquivo e
// falha sob sandbox (`spawn EPERM`). O preço dessa escolha é que **teste novo não
// roda até alguém lembrar de adicionar a linha**.
//
// Aconteceu em 06/11/2026: `tests/onboard-drivers.test.mjs` foi criado com 7
// testes, a suíte continuou dizendo 388/388 (o número de antes) e tudo parecia
// certo. Um teste que não roda é pior que teste nenhum: ele dá a sensação de
// cobertura sem cobrir nada — a mesma família do §12.29 ("biblioteca presente não
// prova uso") e do §12.50 ("o teste perguntando por um caso quando o defeito é da
// classe inteira").
//
// A verificação é sobre a CLASSE, não sobre o arquivo de hoje: qualquer
// `*.test.mjs` que apareça em `tests/` sem import no runner falha aqui.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const TESTS_DIR = new URL("./", import.meta.url);
const RUNNER = new URL("./run-all.mjs", import.meta.url);

test("todo arquivo tests/*.test.mjs está importado pelo run-all.mjs", () => {
  const runner = readFileSync(RUNNER, "utf8");
  const files = readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();

  assert.ok(files.length > 0, "nenhum teste encontrado — o caminho está errado?");

  const missing = files.filter((name) => !runner.includes(`"./${name}"`));
  assert.deepEqual(
    missing,
    [],
    `testes que NÃO rodam (falta import em tests/run-all.mjs): ${missing.join(", ")}`,
  );
});

test("o run-all.mjs não importa arquivo que não existe", () => {
  // O erro espelhado: renomear um teste e deixar o import apontando para o nome
  // antigo quebra a suíte inteira com ERR_MODULE_NOT_FOUND, que é claro. Mas um
  // import comentado ou duplicado passa despercebido — este teste cobre a
  // existência e a unicidade.
  const runner = readFileSync(RUNNER, "utf8");
  const imports = [...runner.matchAll(/^import "\.\/(.+\.test\.mjs)";$/gm)].map((m) => m[1]);
  const present = new Set(readdirSync(TESTS_DIR));

  const ghosts = imports.filter((name) => !present.has(name));
  assert.deepEqual(ghosts, [], `imports para arquivos inexistentes: ${ghosts.join(", ")}`);

  const duplicated = imports.filter((name, i) => imports.indexOf(name) !== i);
  assert.deepEqual(duplicated, [], `imports duplicados: ${duplicated.join(", ")}`);
});
