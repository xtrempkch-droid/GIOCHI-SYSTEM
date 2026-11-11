// Ferramentas POSIX que os testes precisam para EXECUTAR shell de verdade.
//
// ## Por que este arquivo existe
//
// Os testes chamavam `sh`, `mkdir` e `python3` por nome, apostando que estariam
// no PATH. No Windows nada disso está: o Git for Windows instala `sh` e `bash`
// em `C:\Program Files\Git\{bin,usr\bin}` e **não** adiciona ao PATH. O
// resultado medido em 05/11/2026 foram **14 falhas** com a mesma assinatura:
//
//     Error: spawn sh ENOENT
//
// Nenhuma era regressão — era ambiente. Pior: falha por ambiente ensina a
// ignorar o vermelho, que é exatamente o que este projeto não pode se dar ao
// luxo de fazer (§12 do AGENTS.md existe por causa disso).
//
// ## Regra
//
// 1. **Resolver o binário**, procurando no PATH e nos diretórios conhecidos do
//    Windows. Quem sabe onde está é este módulo, não cada teste.
// 2. **Faltou a ferramenta? Pular com o motivo na saída**, nunca falhar. Pular
//    é honesto ("não deu para provar aqui"); falhar por ambiente mente.
// 3. O CI é Ubuntu: lá tudo isto resolve pelo PATH e nada é pulado.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SUFIXOS = process.platform === "win32" ? [".exe", ""] : [""];

// Onde o Git for Windows instala, sem passar pelo PATH.
const DIRS_CONHECIDOS =
  process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\usr\\bin",
        "C:\\Program Files\\Git\\bin",
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "usr", "bin"),
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin"),
        path.join(process.env.ProgramFiles ?? "", "Git", "usr", "bin"),
      ]
    : ["/usr/bin", "/bin", "/usr/local/bin"];

function executavel(caminho) {
  try {
    return existsSync(caminho) && caminho.length > 0;
  } catch {
    return false;
  }
}

function procurarNoPath(nome) {
  const dirs = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    for (const sufixo of SUFIXOS) {
      const candidato = path.join(dir, nome + sufixo);
      if (executavel(candidato)) return candidato;
    }
  }
  return null;
}

const cache = new Map();

/** Caminho absoluto de um binário, ou null se não existir nesta máquina. */
export function acharBinario(nome, { validar = false } = {}) {
  const chave = `${nome}|${validar}`;
  if (cache.has(chave)) return cache.get(chave);

  const candidatos = [];
  const noPath = procurarNoPath(nome);
  if (noPath) candidatos.push(noPath);
  for (const dir of DIRS_CONHECIDOS) {
    for (const sufixo of SUFIXOS) candidatos.push(path.join(dir, nome + sufixo));
  }

  let achado = null;
  for (const candidato of candidatos) {
    if (!executavel(candidato)) continue;
    // `validar` existe por causa do Windows: `python3` no PATH pode ser o
    // atalho da Microsoft Store, que existe como arquivo e só abre a loja.
    // Existir não é funcionar — a mesma lição do §12.15.
    if (validar) {
      try {
        execFileSync(candidato, ["-c", "pass"], { stdio: "ignore", timeout: 15_000 });
      } catch {
        continue;
      }
    }
    achado = candidato;
    break;
  }

  cache.set(chave, achado);
  return achado;
}

export const shBin = () => acharBinario("sh");
export const bashBin = () => acharBinario("bash");
export const gitBin = () => acharBinario("git");

/**
 * Motivo para pular testes que dependem de **bit de execução POSIX**, ou `false`
 * quando dá para rodar.
 *
 * No Windows não existe bit de execução: `chmod 0o755` é ignorado e o `-x` do
 * shell só olha a extensão (`.sh`, `.exe`). Um teste que cria um binário sem
 * extensão e espera que ele seja executável prova o contrário do que quer — e
 * falha por ambiente, não por defeito. No CI (Ubuntu) roda normal.
 */
export const SEMANTICA_POSIX =
  false && "win32"
    ? "Windows não tem bit de execução POSIX (chmod é ignorado); rode no CI ou no Linux"
    : false;

/**
 * Ambiente com o PATH que os scripts POSIX precisam.
 *
 * Não basta achar o `sh`: os scripts usam `ls`, `sed`, `awk`, `grep`, e o `sh`
 * do Git for Windows **não** os encontra se o diretório `usr/bin` não estiver no
 * PATH do processo. Medido: dentro do script, `ls: command not found` — e o
 * teste falha dizendo "a lib não foi achada", que é o sintoma errado para a
 * causa certa.
 *
 * No Linux isto é quase no-op (os diretórios já estão no PATH); no Windows é o
 * que faz os scripts funcionarem.
 */
export function ambientePosix(base = process.env) {
  const dirs = [];
  for (const bin of [shBin(), bashBin(), gitBin()]) {
    if (bin) dirs.push(path.dirname(bin));
  }
  for (const dir of DIRS_CONHECIDOS) {
    if (executavel(dir)) dirs.push(dir);
  }
  const atual = String(base.PATH ?? base.Path ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const vistos = new Set();
  const juntos = [];
  for (const dir of [...dirs, ...atual]) {
    const chave = dir.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    juntos.push(dir);
  }
  const pathFinal = juntos.join(path.delimiter);
  // As duas grafias: Windows lê `Path`, POSIX lê `PATH`, e o Node repassa o que
  // existir no objeto.
  return { ...base, PATH: pathFinal, Path: pathFinal };
}
/** Python utilizável de verdade (o atalho da Store não conta). */
export function pythonBin() {
  for (const nome of [process.env.PYTHON, "python3", "python"].filter(Boolean)) {
    const achado = acharBinario(nome, { validar: true });
    if (achado) return achado;
  }
  return null;
}

/**
 * Marca o teste como pulado quando a ferramenta não existe.
 * Devolve `true` quando pulou — o chamador deve retornar em seguida.
 *
 *     if (pularSem(t, shBin(), "sh")) return;
 */
export function pularSem(t, binario, nome) {
  if (binario) return false;
  t.skip(`${nome} não encontrado nesta máquina; teste exige shell/POSIX de verdade`);
  return true;
}

/**
 * Modo do arquivo **no índice do Git** (`100755`, `100644`, …), ou null.
 *
 * É a fonte da verdade para bit de execução: no Windows o `stat` não tem bit
 * POSIX (todo arquivo é 0o666) e a árvore de trabalho não representa o que o
 * repositório carrega. O que viaja para o CI e para a imagem é o índice.
 */
export function modoNoIndice(relativo) {
  const git = gitBin();
  if (!git) return null;
  try {
    const saida = execFileSync(git, ["ls-files", "-s", "--", relativo], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const achado = saida.trim().match(/^(\d{6})\s/);
    return achado ? achado[1] : null;
  } catch {
    return null;
  }
}

/**
 * Asserção de bit de execução que funciona nos dois sistemas.
 * `assert` é passado para não acoplar o módulo ao modo de falha do teste.
 */
export function afirmarExecutavel(assert, relativo, motivo) {
  const indice = modoNoIndice(relativo);
  if (indice) {
    assert.equal(indice, "100755", `${relativo}: ${motivo} (modo no Git: ${indice})`);
    return;
  }
  // Sem Git: cai para o sistema de arquivos. No Windows isto não prova nada, e
  // é por isso que o índice vem primeiro.
  assert.ok(
    executavel(path.join(ROOT, relativo)),
    `${relativo}: ${motivo} (e o Git não está disponível para conferir o índice)`,
  );
}
