// Corrige o uso de `new URL(...).pathname` nos testes.
//
// O problema: `URL.pathname` devolve percent-encoding e, no Windows, um caminho
// com a letra do disco na frente — `/C:/Users/Jussara%20dias/...`. Usar isso
// como caminho de arquivo produz `ENOENT` com um caminho que parece absurdo.
//
// O certo é `fileURLToPath`, que decodifica e remove a barra inicial do disco.
//
// Este script é de uso único; fica no repositório porque documenta a correção
// melhor do que a mensagem de commit consegue.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = path.join(fileURLToPath(new URL("..", import.meta.url)), "tests");
const ARQUIVOS = [
  "bootsplash.test.mjs",
  "chave-da-loja.test.mjs",
  "dev-free-console.test.mjs",
  "device-r35s-port.test.mjs",
  "godot.test.mjs",
  "gpu-drivers.test.mjs",
  "joypad-driver.test.mjs",
  "onboard-drivers.test.mjs",
  "post-build-harfbuzz.test.mjs",
  "rk3326-legacy-boot.test.mjs",
  "sdk-sysroot.test.mjs",
  "sdl2-alsa.test.mjs",
  "sdl2-image-decoders.test.mjs",
  "sha256sums.test.mjs",
];

// `new URL(<algo>, import.meta.url).pathname` -> `fileURLToPath(new URL(<algo>, import.meta.url))`
const RE = /new URL\(([^)]*?), import\.meta\.url\)\.pathname/g;

let alterados = 0;
for (const nome of ARQUIVOS) {
  const caminho = path.join(TESTS, nome);
  const antes = readFileSync(caminho, "utf8");
  let depois = antes.replace(RE, "fileURLToPath(new URL($1, import.meta.url))");
  if (depois === antes) {
    console.log(`  sem mudanca: ${nome}`);
    continue;
  }
  // Garante o import, uma vez só.
  if (!depois.includes("fileURLToPath")) {
    throw new Error(`${nome}: substituiu mas não inseriu o import`);
  }
  if (!/import \{[^}]*fileURLToPath[^}]*\} from "node:url";/.test(depois)) {
    // Insere depois do último `import ... from "node:..."` existente.
    const linhas = depois.split("\n");
    let ultimo = -1;
    for (let i = 0; i < linhas.length; i++) {
      if (/^import .* from "node:/.test(linhas[i])) ultimo = i;
    }
    if (ultimo === -1) {
      // Nenhum import de node: ainda; põe depois do primeiro import.
      for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].startsWith("import ")) {
          ultimo = i;
          break;
        }
      }
    }
    if (ultimo === -1) throw new Error(`${nome}: não achei onde inserir o import`);
    linhas.splice(ultimo + 1, 0, 'import { fileURLToPath } from "node:url";');
    depois = linhas.join("\n");
  }
  writeFileSync(caminho, depois, "utf8");
  const n = (antes.match(RE) || []).length;
  console.log(`  ${nome}: ${n} ocorrência(s)`);
  alterados++;
}
console.log(`\n${alterados} arquivo(s) alterado(s).`);
