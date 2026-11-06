#!/usr/bin/env node
// A decisão sobre driver de GPU, presa em teste.
//
// Contexto: o panfrost (Mesa, software livre) não tem geometry shader; o blob da
// ARM (`libmali`) tem. A tentação é empacotar o blob "para garantir". Este teste
// existe para que essa troca não aconteça por uma linha de configuração sem que
// alguém perceba o que ela custa (licença em todo artefato público).
//
// Documento de referência: `docs/gpu-drivers.md`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const DOC = readFileSync(new URL("../docs/gpu-drivers.md", import.meta.url), "utf8");

function listFiles(dir) {
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

test("nenhum fragmento de buildroot pede o blob da ARM", () => {
  // `libmali` não é pacote do Buildroot: entrar na imagem exigiria um pacote
  // customizado. Se alguém criar um, tem de ser na loja (item 4.2 do doc), e
  // este teste obriga a decisão a ser explícita.
  const root = new URL("../device/", import.meta.url).pathname;
  const offenders = listFiles(root).filter((file) => {
    if (!/\.(fragment|json|mk)$/.test(file)) return false;
    const text = readFileSync(file, "utf8");
    return /libmali|mali-bifrost|MALI_BIFROST/i.test(text);
  });
  assert.deepEqual(offenders, [], `libmali referenciado em: ${offenders.join(", ")}`);
});

test("o fragmento comum não liga driver proprietário de GPU", () => {
  const common = readFileSync(new URL("../config/common.fragment", import.meta.url), "utf8");
  // A palavra "Mali" aparece num comentário legítimo ("Mali via panfrost").
  // O que não pode existir é PEDIDO de pacote/driver proprietário.
  assert.ok(
    !/^\s*BR2_[A-Z0-9_]*MALI[A-Z0-9_]*\s*=\s*y/m.test(common),
    "common.fragment não deve ligar pacote Mali proprietário",
  );
  assert.ok(!/MALI_BIFROST/i.test(common), "blob da ARM não entra na config comum");
  // E não deve desligar o panfrost por acidente: é o nosso driver.
  assert.ok(
    !/CONFIG_DRM_PANFROST\s+is\s+not\s+set/.test(common),
    "desligar CONFIG_DRM_PANFROST tira a GPU inteira",
  );
});

test("o documento cobre as três saídas, e nenhuma é 'empacotar o blob na imagem'", () => {
  // O que o doc precisa conter para continuar sendo um doc de DECISÃO:
  assert.match(DOC, /patch do arcade/i, "saída 4.1");
  assert.match(DOC, /libmali/i, "saída 4.2");
  assert.match(DOC, /recusar/i, "saída 4.3");
  assert.match(DOC, /fora\*\* da imagem base|fora da imagem base/i, "o blob fica fora da base");
  assert.match(DOC, /redistribui/i, "a pergunta de licença tem de estar escrita");
});

test("o documento diz que portar o driver nao e' trabalho deste repositorio", () => {
  // Sem esta frase, a pergunta "e se não for possível portar?" volta a cada
  // sessão, e alguém tenta implementar geometry shader no Mesa localmente.
  assert.match(DOC, /projeto do\s+\*\*Mesa\*\*|driver do\s+\*\*Mesa\*\*/i);
  assert.match(DOC, /(não\s+)?cabe\s+a\s+este\s+repositório/i);
});

test("a matriz diz que o launcher e o Godot Compatibility NAO precisam de geometry shader", () => {
  // Se isto deixar de ser verdade, o peso da decisão muda e o doc precisa ser
  // reescrito — não basta editar a tabela.
  const launcherRow = DOC.split("\n").find((line) => /Launcher SDL2/.test(line));
  assert.ok(launcherRow, "linha do launcher ausente na matriz");
  assert.match(launcherRow, /\|\s*não\s*\|/, "launcher não precisa de geometry shader");

  const godotRow = DOC.split("\n").find((line) => /Godot 4 \*\*Compatibility\*\*/.test(line));
  assert.ok(godotRow, "linha do Godot Compatibility ausente");
  assert.match(godotRow, /\|\s*\*\*não\*\*[^|]*\|/, "Godot Compatibility não precisa");
});

test("o numero que falta esta declarado como faltando", () => {
  // A honestidade do documento depende disto: comparamos HARDWARE (com blob)
  // contra o features.txt do Mesa; o panfrost rodando nunca foi medido. Se
  // alguém apagar esta seção, o doc passa a sugerir que foi.
  assert.match(DOC, /rmmod mali_kbase/);
  assert.match(DOC, /nunca foi medido|nunca foi medido/i);
});

test("o gles-probe.py continua sendo o instrumento da medicao pendente", () => {
  const probe = statSync(new URL("../scripts/gles-probe.py", import.meta.url));
  assert.ok(probe.size > 4000, "scripts/gles-probe.py encolheu?");
  assert.match(DOC, /gles-probe\.py/);
});
