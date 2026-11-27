// As regras de engenharia que precisam chegar às outras equipes.
//
// Elas nasceram dentro deste repositório (§12 do AGENTS.md, 41 seções) e ficaram
// lá. Uma regra que só existe no repo de quem a descobriu não protege ninguém:
// as outras equipes produzem artefatos que vão para o MESMO aparelho, e o erro
// de qualquer uma aparece como "o sistema está quebrado".
//
// Estes testes prendem a CLASSE, não a lista: toda issue de regras tem de
// apontar para o documento base, e o documento base tem de conter as doze. Um
// quinto repo que apareça amanhã cai na mesma verificação.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const BASE = join(RAIZ, "docs/regras-para-outras-equipes.md");
const PASTA = join(RAIZ, "docs/issues-para-outros-repos");

const LINKS_BASE =
    /https:\/\/github\.com\/xtrempkch-droid\/GIOCHI-SYSTEM\/blob\/main\/docs\/regras-para-outras-equipes\.md/;

function arquivosDeRegras() {
    return readdirSync(PASTA)
        .filter((f) => /^REGRAS-.*\.md$/.test(f))
        .map((f) => ({ nome: f, texto: readFileSync(join(PASTA, f), "utf8") }));
}

test("o documento base existe e tem as doze regras", () => {
    const t = readFileSync(BASE, "utf8");
    for (let i = 1; i <= 12; i++) {
        assert.match(
            t,
            new RegExp(`^## R${i} — `, "m"),
            `falta a regra R${i} no documento base — o número é o que as issues citam`,
        );
    }
    assert.doesNotMatch(
        t,
        /^## R13 — /m,
        "apareceu uma R13: atualize o intervalo acima de propósito, senão o teste vira decoração",
    );
});

test("cada regra tem exemplo medido, não parábola", () => {
    // A força do documento é a procedência. Uma regra sem o caso que a criou é
    // conselho, e conselho é o que as equipes já ignoram.
    const t = readFileSync(BASE, "utf8");
    const blocos = t.split(/^## R\d+ — /m).slice(1);
    assert.equal(blocos.length, 12, `esperava 12 blocos de regra, achei ${blocos.length}`);
    const fracos = blocos
        .map((b, i) => ({ n: i + 1, b }))
        .filter(({ b }) => !/medid|Medid|caso|exemplo|Exemplo/.test(b));
    assert.deepEqual(
        fracos.map((f) => `R${f.n}`),
        [],
        "regra sem exemplo medido — sem o caso que a criou ela não convence",
    );
});

test("toda issue de regras aponta para o documento base", () => {
    const arquivos = arquivosDeRegras();
    assert.ok(arquivos.length >= 4, `esperava >=4 recortes, achei ${arquivos.length}`);
    for (const { nome, texto } of arquivos) {
        assert.match(
            texto,
            LINKS_BASE,
            `${nome} não aponta para o documento base. Sem o link, a equipe recebe ` +
                `uma lista de pedidos sem o porquê — e o porquê é o que muda comportamento.`,
        );
    }
});

test("toda issue de regras pede adoção versionada, com commit", () => {
    // Regra que não vira arquivo no repo da equipe morre na próxima sessão. O
    // pedido tem de ser concreto: criar o arquivo e citar o commit.
    for (const { nome, texto } of arquivosDeRegras()) {
        assert.match(texto, /Adotar as regras|adotar as regras/i, `${nome}: falta o pedido de adoção`);
        assert.match(
            texto,
            /docs\/regras\.md|AGENTS\.md/,
            `${nome}: diga ONDE a regra passa a morar no repo deles`,
        );
        assert.match(
            texto,
            /commit/i,
            `${nome}: o pedido tem de incluir citar o commit — regra sem data é lenda (§R9)`,
        );
    }
});

test("cada recorte pede o que aquela equipe faz, e o APP vem primeiro", () => {
    // O dono do projeto foi explícito: o APP é quem mais precisa, porque é a
    // primeira coisa que o usuário vê e a última que segura o aparelho quando
    // algo dá errado. O recorte do APP tem de ser o mais completo.
    const arquivos = arquivosDeRegras();
    const app = arquivos.find((a) => a.nome === "REGRAS-APP.md");
    assert.ok(app, "falta o recorte do APP");
    const tamanhoMax = Math.max(...arquivos.map((a) => a.texto.length));
    assert.equal(
        app.texto.length,
        tamanhoMax,
        "o recorte do APP tem de ser o mais detalhado — é a equipe que mais depende das regras",
    );

    // E cada recorte tem de ter pedido, não só diagnóstico.
    for (const { nome, texto } of arquivos) {
        assert.match(texto, /## O que pedimos/, `${nome} não tem a seção de pedidos`);
        const pedidos = (texto.split("## O que pedimos")[1] || "").match(/^\d+\. /gm) || [];
        assert.ok(pedidos.length >= 3, `${nome} tem só ${pedidos.length} pedido(s)`);
    }
});

test("o documento base não promete o que não foi medido", () => {
    // R10 aplicada ao próprio documento: ele cita números (§12.63, GLES), e um
    // número sem procedência num documento de regras é o pior exemplo possível.
    const t = readFileSync(BASE, "utf8");
    for (const numero of ["981 MiB", "192 Mpix/s", "49,0", "90,7"]) {
        if (!t.includes(numero)) continue;
        assert.match(
            t,
            /08\/11\/2026|medido|Medido/,
            `o documento cita "${numero}" sem a data/medição ao lado — número solto vira opinião (§R1)`,
        );
    }
});
