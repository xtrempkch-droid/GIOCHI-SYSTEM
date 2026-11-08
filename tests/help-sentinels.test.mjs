import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// `--help` RECORTADO POR NÚMERO DE LINHA MENTE EM SILÊNCIO.
//
// O padrão era `sed -n '2,20p' "$0"`, e ele tem duas falhas:
//
//   1. o cabeçalho cresce (uma opção nova, um parágrafo) e o recorte passa a
//      cortar no meio ou a imprimir código — sem erro, sem aviso;
//   2. o número mágico não diz nada a quem lê, então ninguém sabe se está certo.
//
// O próprio repositório já registrava isso no `tests/flash-grow.test.mjs`:
// "o `--help` cortado é um defeito próprio: o cabeçalho cresce quando entra
// opção nova, e um recorte por número de linha passa a mentir em silêncio".
// Mesmo assim havia NOVE lugares com o padrão.
//
// Medido em 08/11/2026, dois deles já estavam errados de fato:
//
//   giochi-usb --help        imprimia "## Por que isto existe" e mais nada
//   giochi-usbnet --help     imprimia 39 linhas, 30 delas de justificativa
//
// Os dois são do rootfs: no aparelho, `--help` é a ÚNICA documentação que existe
// quando não há SSH nem PC por perto.
//
// A correção usa sentinelas (`# giochi-system:help:begin` / `:end`), que é o
// que o `giochi-buttons` já fazia.

const SENTINELA = "giochi-system:help:begin";

function arquivosComShell() {
  const raiz = ROOT;
  const encontrados = [];
  const visitar = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome === ".git" || nome === "out" || nome === "work") continue;
      const caminho = path.join(dir, nome);
      const info = statSync(caminho);
      if (info.isDirectory()) {
        visitar(caminho);
        continue;
      }
      if (!nome.endsWith(".sh")) continue;
      encontrados.push(caminho);
    }
  };
  visitar(path.join(raiz, "scripts"));
  visitar(path.join(raiz, "device"));
  return encontrados;
}

function arquivosDoRootfs() {
  const dir = path.join(ROOT, "device/common/rootfs-overlay/usr/bin");
  return readdirSync(dir).map((nome) => path.join(dir, nome));
}

test("nenhum script recorta o help por número de linha", () => {
  const ofensores = [];
  for (const arquivo of [...arquivosComShell(), ...arquivosDoRootfs()]) {
    const texto = readFileSync(arquivo, "utf8");
    for (const linha of texto.split("\n")) {
      if (linha.trimStart().startsWith("#")) continue;
      // `sed -n 'N,Mp'` aplicado ao próprio script.
      if (/sed\s+-n\s+'[0-9]+,[0-9]+p'\s+.*(BASH_SOURCE|\$0)/.test(linha)) {
        ofensores.push(`${path.relative(ROOT, arquivo)}: ${linha.trim()}`);
      }
    }
  }
  assert.deepEqual(
    ofensores,
    [],
    "use sentinelas `# giochi-system:help:begin` / `:end`:\n  " + ofensores.join("\n  "),
  );
});

test("todo script com sentinela tem os DOIS marcadores", () => {
  // Meio par de sentinelas é pior que nenhum: o `awk` sai no fim do arquivo e
  // imprime o script inteiro, com o código junto.
  const problemas = [];
  for (const arquivo of [...arquivosComShell(), ...arquivosDoRootfs()]) {
    const texto = readFileSync(arquivo, "utf8");
    const abre = texto.includes(`# ${SENTINELA}`);
    const fecha = texto.includes("# giochi-system:help:end");
    if (abre !== fecha) {
      problemas.push(`${path.relative(ROOT, arquivo)}: ${abre ? "só o begin" : "só o end"}`);
    }
  }
  assert.deepEqual(problemas, [], problemas.join("\n  "));
});

test("o --help dos scripts do ROOTFS não imprime prosa de seção", () => {
  // No aparelho não existe `man` nem SSH garantido: o `--help` é a documentação.
  // Uma saída que começa com "## RNDIS, e não ECM" não responde "como eu uso".
  const casos = [
    ["giochi-usb", ["uso:", "giochi-usb --host"]],
    ["giochi-usbnet", ["uso:", "giochi-usbnet --ms"]],
    ["giochi-buttons", ["giochi-buttons --axes"]],
  ];
  const dir = path.join(ROOT, "device/common/rootfs-overlay/usr/bin");
  for (const [nome, esperados] of casos) {
    const saida = execFileSync("sh", [path.join(dir, nome), "--help"], { encoding: "utf8" });
    for (const esperado of esperados) {
      assert.ok(
        saida.toLowerCase().includes(esperado.toLowerCase()),
        `${nome} --help não menciona "${esperado}"`,
      );
    }
    assert.ok(
      !/^## /m.test(saida),
      `${nome} --help imprime título de seção ("## …"), que não é uso`,
    );
    assert.ok(saida.length < 1200, `${nome} --help com ${saida.length} chars: prosa demais`);
  }
});

test("o --help dos scripts de build não vaza código", () => {
  const casos = [
    ["check-host.sh", []],
    ["make-sd-image.sh", ["--size-mib"]],
    ["build-in-container.sh", ["--sd-image"]],
    ["flash-sd.sh", ["--grow"]],
    ["flash-dd.sh", []],
    ["chave-da-loja.sh", ["--verificar"]],
  ];
  for (const [nome, esperados] of casos) {
    const saida = execFileSync("bash", [path.join(ROOT, "scripts", nome), "--help"], {
      encoding: "utf8",
    });
    for (const esperado of esperados) {
      assert.ok(saida.includes(esperado), `${nome} --help não menciona ${esperado}`);
    }
    // Sinal de recorte errado: o corpo do script vazando na ajuda.
    assert.ok(!/^set -/m.test(saida), `${nome} --help imprimiu o corpo do script`);
    assert.ok(!/^\s*(if|fi|case|esac)\b/m.test(saida), `${nome} --help vazou shell`);
    assert.ok(saida.length < 2200, `${nome} --help com ${saida.length} chars: suspeito`);
  }
});
