// O material das issues dos repos vizinhos — que só pode ser colado à mão.
//
// Esta máquina não tem como escrever issue pela API (`POST`/`PATCH` → 401, sem
// `gh`, sem token, sem credential helper — medido em 17/11/2026), e o formulário
// interativo da ferramenta de issues se mostrou não confiável: duplicou quatro
// vezes e trocou o corpo de duas. O caminho que sobrou é o manual — abrir a
// issue, *Edit*, apagar tudo e colar o arquivo desta pasta.
//
// Isso torna os arquivos **material de operação**, não documentação: alguém vai
// abrir o GitHub e colar o conteúdo sem reler. Um arquivo vazio, com HTML, com
// título dentro ou com o texto da equipe errada seria colado do mesmo jeito, e o
// erro só apareceria na issue — no repo de outra equipe, onde não olhamos.
//
// É o §12.50 aplicado a texto: o modo de falha não é o arquivo sumir, é ele
// existir com o conteúdo errado e ninguém notar.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const PASTA = join(RAIZ, "docs/issues-para-outros-repos");
const README = readFileSync(join(PASTA, "README.md"), "utf8");

// A tabela do README é a fonte da verdade do que existe. Extrair dela, e não de
// uma lista escrita aqui, é o que faz um arquivo novo (ou removido) aparecer.
function arquivosDaTabela() {
    const linhas = README.split("\n");
    const saida = [];
    for (const linha of linhas) {
        const m = linha.match(/^\|\s*`(GIOCHI-[A-Z]+)`\s*\|\s*([^|]+?)\s*\|\s*\[`([^`]+)`\]/);
        if (m) saida.push({ repo: m[1], titulo: m[2], arquivo: m[3] });
    }
    return saida;
}

test("o README lista os três repos vizinhos, e cada arquivo existe", () => {
    const entradas = arquivosDaTabela();
    assert.ok(entradas.length >= 2,
        `a tabela do README tem de listar os pedidos; achei ${entradas.length}`);

    for (const e of entradas) {
        const caminho = join(PASTA, e.arquivo);
        const texto = readFileSync(caminho, "utf8"); // lança se não existir
        assert.ok(texto.length > 1500,
            `${e.arquivo} tem só ${texto.length} B — material de colar precisa ` +
            `ser o corpo inteiro`);
    }
});

test("nenhum arquivo chegou em HTML — foi o defeito de 17/11", () => {
    // Os corpos de `GIOCHI-APP#1` e `GIOCHI-OS#1` foram criados pelo formulário
    // da ferramenta e chegaram renderizados (`<h2 dir="auto">…`). Markdown com
    // tag HTML colada à mão vira texto literal na issue — e o leitor não sabe
    // se está lendo o pedido ou um pedaço de código.
    for (const e of arquivosDaTabela()) {
        const texto = readFileSync(join(PASTA, e.arquivo), "utf8");
        const tag = texto.match(/<\/?(h[1-6]|p|ul|ol|li|strong|em|code|pre)\b[^>]*>/i);
        assert.equal(tag, null,
            `${e.arquivo} tem tag HTML (${tag && tag[0]}) — o corpo tem de ser ` +
            `markdown puro, para colar e renderizar`);
    }
});

test("é corpo puro: sem título H1 e sem separador horizontal", () => {
    // O título da issue é campo separado, e é o que mais importa acertar — o
    // README traz o de cada uma. Um H1 no arquivo faria a issue abrir com o
    // título repetido; um `---` logo no começo vira uma linha horizontal solta.
    for (const e of arquivosDaTabela()) {
        const texto = readFileSync(join(PASTA, e.arquivo), "utf8");
        const primeira = texto.split("\n").find((l) => l.trim().length > 0);
        assert.doesNotMatch(primeira, /^#\s/,
            `${e.arquivo} começa com H1 ("${primeira.slice(0, 40)}") — o título ` +
            `vai no campo da issue, não no corpo`);
        assert.doesNotMatch(primeira, /^-{3,}\s*$/,
            `${e.arquivo} começa com separador horizontal`);
    }
});

test("os títulos do README não são o do GIOCHI-GAMES", () => {
    // O erro real: `APP#1` e `OS#1` nasceram com o título e o corpo do GAMES.
    // Um título genérico ("Contrato de entrada: ...") é indistinguível do que já
    // está lá, então a tabela tem de dizer a *equipe* no começo da frase —
    // senão quem cola não percebe que está no repo errado.
    const entradas = arquivosDaTabela();
    const repos = new Set(entradas.map((e) => e.repo));
    assert.ok(repos.has("GIOCHI-APP") && repos.has("GIOCHI-OS"),
        `faltam os pedidos do APP ou do OS; achei ${[...repos].join(", ")}`);

    for (const e of entradas) {
        assert.ok(e.titulo.length > 25,
            `o título de ${e.repo} é curto demais (${e.titulo}) — precisa dizer ` +
            `o que a equipe faz, não o nome do contrato`);
        assert.match(e.titulo, /joystick|entrada|Gamepad|enumerar|analógico|junção/i,
            `o título de ${e.repo} não diz sobre o que é: ${e.titulo}`);
    }
});

test("cada corpo carrega a instrução que aquela equipe precisa seguir", () => {
    // O corpo do GAMES serve para o GAMES e para mais ninguém: ele fala de somar
    // fontes de input dentro do jogo. Colar aquele texto no APP deixa a equipe
    // sem saber o que fazer com o `EvdevInput::open` dela. O recorte é o motivo
    // de os arquivos existirem.
    const esperado = {
        "GIOCHI-APP": /EvdevInput|vigi|enumer/i,
        "GIOCHI-OS": /jun[çc][ãa]o|imagem/i,
    };
    for (const e of arquivosDaTabela()) {
        const re = esperado[e.repo];
        if (!re) continue;
        const texto = readFileSync(join(PASTA, e.arquivo), "utf8");
        assert.match(texto, re,
            `${e.arquivo} não fala do que ${e.repo} tem de fazer (${re}) — ` +
            `parece ter sido trocado pelo corpo de outra equipe, que é o defeito ` +
            `que aconteceu em 17/11`);
    }
});
