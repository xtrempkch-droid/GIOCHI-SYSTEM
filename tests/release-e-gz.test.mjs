// A Release: o caminho pelo qual a imagem se baixa SEM passar pelo agente.
//
// O artefato do Actions resolve o build, não o download: exige login
// (`GET /actions/artifacts/<id>/zip` → 401 sem token, medido em 17/11/2026) e
// expira em 14 dias. Uma Release resolve as duas coisas — página com o arquivo,
// download anônimo em repositório público, link que não expira.
//
// Este teste existe porque a Release é o único caminho de entrega que **não
// passa por ninguém deste repositório**: se ela quebrar, ninguém descobre por
// log de build. O build fica verde, o artefato sobe, e a página continua
// mostrando a imagem de duas semanas atrás. É o §12.29 na forma de entrega.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Só as linhas de código: o YAML e os scripts EXPLICAM por que não fazem certas
// coisas ("não use `uniq -d`", "não use `gzip -l`"), e uma asserção negativa
// sobre o texto cru acusaria a própria explicação. Já aconteceu três vezes neste
// arquivo — é o mesmo erro do teste que procurou o nome do driver em vez da
// consequência (§12.30).
const soCodigo = (fonte) => fonte
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

const RAIZ = new URL("..", import.meta.url).pathname;
const WORKFLOW = readFileSync(join(RAIZ, ".github/workflows/build-linux-arm64.yml"), "utf8");
const FLASH_SD = readFileSync(join(RAIZ, "scripts/flash-sd.sh"), "utf8");
const FLASH_DD = readFileSync(join(RAIZ, "scripts/flash-dd.sh"), "utf8");
const MAKE_SD = readFileSync(join(RAIZ, "scripts/make-sd-image.sh"), "utf8");

test("o input `publicar_release` é choice, não boolean", () => {
    // §12.5: `workflow_dispatch` com `type: boolean` entrega
    // `github.event.inputs.*` como STRING, e comparar tipos diferentes em
    // expressão do Actions faz coerção NUMÉRICA — `"true" == true` dá falso.
    // Foi o que manteve o `allow_draft` desligado e derrubou o discover em 1 s.
    //
    // A comparação no `if:` do job `release` é justamente `== 'true'`, então se
    // alguém trocar para `type: boolean` nada muda no YAML e o job para de
    // rodar para sempre — a release fica velha e o build continua verde.
    const bloco = WORKFLOW.slice(
        WORKFLOW.indexOf("publicar_release:"),
        WORKFLOW.indexOf("allow_draft:"),
    );
    assert.ok(bloco.length > 0, "o input publicar_release sumiu");
    assert.match(bloco, /type: choice/,
        "boolean chega como string e a comparação com 'true' falha em silêncio");
    assert.match(bloco, /default: "false"/,
        "publicar release não pode ser o padrão: um push comum criaria release");
});

test("o job de release só roda em dispatch, com a caixa marcada", () => {
    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));
    assert.ok(bloco.length > 100, "o job `release` sumiu do workflow");

    assert.match(bloco, /needs: \[build\]/,
        "sem `needs: [build]` a release publicaria antes de as imagens existirem");
    assert.match(bloco, /github\.event_name == 'workflow_dispatch'/,
        "push não pode publicar release: todo commit em device/ viraria página nova");
    assert.match(bloco, /github\.event\.inputs\.publicar_release == 'true'/);
});

test("a permissão de escrita fica no job, não no topo", () => {
    // `contents: write` no topo daria poder de escrita a TODOS os passos,
    // inclusive aos que rodam código de terceiros (actions de checkout/setup).
    const topo = WORKFLOW.slice(0, WORKFLOW.indexOf("jobs:"));
    assert.match(topo, /permissions:\s*\n\s*contents: read/,
        "o workflow inteiro deve continuar com contents: read");
    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));
    assert.match(bloco, /permissions:\s*\n\s*contents: write/,
        "o job de release precisa de contents: write para criar/editar a release");
});

test("as imagens são comprimidas — a .img tem 2 GiB e o GitHub recusa", () => {
    // `SIZE_MIB=2048` em make-sd-image.sh = 2 GiB exatos.
    const size = MAKE_SD.match(/^SIZE_MIB=(\d+)/m);
    assert.ok(size, "não achei SIZE_MIB em make-sd-image.sh");
    assert.equal(Number(size[1]), 2048,
        "se o tamanho da imagem mudar, a decisão de comprimir precisa ser " +
        "reavaliada contra o limite de 2 GiB por asset do GitHub");

    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));
    assert.match(bloco, /gzip/,
        "sem gzip a imagem de 2 GiB não sobe: o GitHub recusa asset de 2 GiB ou mais");
});

test("a tag é móvel: uma página só, sempre a mais recente", () => {
    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));
    // `--clobber` é o que sobrescreve a imagem anterior em vez de acumular uma
    // por build. Sem ele, `gh release upload` falha com "asset already exists".
    assert.match(bloco, /--clobber/,
        "sem --clobber o upload falha quando o asset já existe, e a release " +
        "fica presa na primeira publicação");
    assert.match(bloco, /gh release view/,
        "precisa distinguir criar de editar, senão a primeira publicação falha " +
        "e as seguintes também");
});

test("nome de asset é único: o `--clobber` sobrescreve sem avisar", () => {
    // O defeito que quase foi publicado: `build-info.txt`, `SHA256SUMS`, `Image`,
    // `device.json` e `rootfs.ext4` existem nos TRÊS aparelhos. Numa release o
    // nome do asset é único, e `--clobber` não falha — ele SOBRESCREVE. O
    // resultado seria a release mostrando o build-info de um aparelho como se
    // fosse de todos, com upload saindo com sucesso e nenhum aviso.
    //
    // A defesa tem duas partes, e as duas precisam existir: renomear com o
    // aparelho no nome, e RECUSAR quando ainda assim houver duplicata (o
    // `uniq -d`), porque renomear depende de o laço ter coberto todos os
    // arquivos.
    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));

    assert.match(bloco, /giochi-system-\$\{aparelho\}-\$\{base\}/,
        "os arquivos comuns aos aparelhos precisam levar o aparelho no nome");

    // A checagem tem de acontecer ANTES do `cp`/`gzip`, no próprio nome de
    // destino — e não com `uniq -d` no fim do laço. Uma pasta plana não pode
    // conter dois arquivos com o mesmo nome: a colisão acontece no `cp -f`, que
    // sobrescreve calado. `uniq -d` no fim é sempre vazio, ou seja, decorativo.
    // (Primeira versão deste passo fazia exatamente isso.)
    assert.match(bloco, /checa\(\)/, "falta a função que recusa a colisão");
    assert.match(bloco, /\[ -e "publicar\/\$1" \]/,
        "a checagem tem de ser sobre o destino JÁ existente, antes de escrever");
    assert.doesNotMatch(bloco, /uniq -d/,
        "`uniq -d` numa pasta plana nunca dispara — a colisão é no cp, não depois");

    // E o `exit 1` não pode estar dentro de `$(...)`: ali ele mata só o
    // subshell, o script segue com destino vazio e o operador vê um erro de
    // `cp` que não diz nada. Medido.
    assert.doesNotMatch(bloco, /\$\(por /,
        "chamar a checagem em `$(...)` faria o `exit 1` morrer no subshell");
    assert.match(bloco, /checa "giochi-system-\$\{aparelho\}-\$\{base\}"/,
        "a checagem tem de ser chamada no shell principal, com o nome já montado");

    // E o upload sai da pasta normalizada, não de `baixado/` — senão o
    // renomeamento não teria efeito nenhum.
    assert.match(bloco, /find publicar/,
        "o upload tem de publicar a pasta com os nomes normalizados");
});

test("a imagem de cartão mantém o nome único que já nasce com ela", () => {
    // `giochi-system-<aparelho>-sd.img.gz` já é única, e é o arquivo que o
    // usuário procura. Renomear de novo daria `giochi-system-r35s-giochi-
    // system-r35s-sd.img.gz` — feio e confuso na página de download.
    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));
    assert.match(bloco, /\*-sd\.img\.gz\)/,
        "o caso da imagem comprimida precisa de ramo próprio");
});

test("o SHA256SUMS sobe antes da imagem", () => {
    // Se o upload parar no meio, o que falta tem de ser a imagem, não o hash
    // dela. Ordem invertida deixaria um .img.gz sem conferência publicada.
    const bloco = soCodigo(WORKFLOW.slice(WORKFLOW.indexOf("\n  release:")));
    const hash = bloco.search(/\*\*SHA256SUMS' -print0|\*SHA256SUMS' -print0/);
    const resto = bloco.search(/! -name '\*SHA256SUMS'/);
    assert.ok(hash > 0 && resto > 0, "não achei os dois uploads");
    assert.ok(hash < resto, "o SHA256SUMS tem de subir primeiro");
});

test("os dois scripts de gravação aceitam .img.gz — o formato do release", () => {
    // O release publica `.img.gz`. Se só o `flash-sd.sh` aceitasse, o caminho de
    // reserva (`flash-dd.sh`, que existe para quando o sd tem problema) deixaria
    // de ser reserva no dia em que fosse preciso — e o erro apareceria como
    // "dd: unrecognized" ou, pior, como uma imagem de 200 MB gravada no cartão.
    for (const [nome, fonte] of [["flash-sd.sh", FLASH_SD], ["flash-dd.sh", FLASH_DD]]) {
        assert.match(fonte, /ler_imagem\(\)/,
            `${nome} não tem a função que lê .gz`);
        assert.match(fonte, /gzip -dc/,
            `${nome} não descomprime`);
        assert.match(fonte, /ler_imagem \| dd/,
            `${nome} ainda faz \`dd if=$IMAGEM\` — com .gz isso grava o ARQUIVO ` +
            `COMPRIMIDO no cartão, e o aparelho não boota`);
    }
});

test("o tamanho vem de `wc -c` descomprimido, não de `gzip -l`", () => {
    // O ISIZE do gzip é o tamanho módulo 2^32. Num arquivo maior que 4 GiB ele
    // reporta MENOS que o real, a checagem "o cartão é grande o bastante"
    // passaria com um cartão pequeno, e o `dd` morreria no meio — cartão
    // meio-gravado é pior que cartão não gravado, porque parece pronto.
    // Sem os comentários: o script EXPLICA por que não usa `gzip -l`, e um
    // `doesNotMatch` sobre o texto cru acusaria a própria explicação. É o mesmo
    // erro que o teste do `--iface` cometeu — perguntar pelo texto em vez de
    // pelo comportamento.
    const codigo = (fonte) => fonte
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
    for (const [nome, fonte] of [["flash-sd.sh", FLASH_SD], ["flash-dd.sh", FLASH_DD]]) {
        assert.doesNotMatch(codigo(fonte), /gzip -l/,
            `${nome} usa \`gzip -l\`, que mente para arquivos > 4 GiB`);
        assert.match(codigo(fonte), /ler_imagem \| wc -c/,
            `${nome} tem de medir o conteúdo descomprimido`);
    }
});

test("o hash é do conteúdo descomprimido", () => {
    // É o hash do que vai para o cartão, e é o mesmo que o SHA256SUMS do
    // release publica. Hash do .gz compararia outra coisa e nunca bateria com
    // o arquivo publicado.
    assert.match(FLASH_SD, /ler_imagem \| sha256sum/,
        "flash-sd.sh tem de conferir o hash do conteúdo descomprimido");
});

test("a função dos dois scripts devolve o MESMO conteúdo do original", () => {
    // Executável, não textual: extrai o `ler_imagem()` real dos scripts e roda
    // sobre um arquivo que existe, comparando hash e tamanho com o original.
    //
    // É a diferença entre "o script chama gunzip" e "o script grava o que o
    // usuário baixou". A primeira passa com a função errada; a segunda não.
    const tmp = mkdtempSync(join(tmpdir(), "gz-flash-"));
    try {
        // 1 MiB de dados pseudoaleatórios — comprime, e o hash tem o que cobrir.
        const original = join(tmp, "imagem.img");
        const bytes = Buffer.alloc(1024 * 1024);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
        writeFileSync(original, bytes);
        execFileSync("gzip", ["-9", "-k", original]);
        const comprimido = `${original}.gz`;
        const esperadoSha = execFileSync("sha256sum", [original], { encoding: "utf8" }).split(" ")[0];
        const esperadoBytes = String(bytes.length);

        for (const [nome, fonte] of [["flash-sd.sh", FLASH_SD], ["flash-dd.sh", FLASH_DD]]) {
            // Extrai só a definição da função, que é a mesma nos dois.
            const def = fonte.match(/ler_imagem\(\) \{[\s\S]*?\n\}/);
            assert.ok(def, `${nome}: não consegui extrair ler_imagem()`);

            const alvo = nome === "flash-sd.sh" ? "IMAGE" : "IMAGEM";
            const script = `
${def[0]}
${alvo}="${comprimido}"
ler_imagem | sha256sum | awk '{print $1}'
ler_imagem | wc -c
`;
            const saida = execFileSync("bash", ["-c", script], { encoding: "utf8" })
                .trim().split("\n");
            assert.equal(saida[0], esperadoSha,
                `${nome}: o hash do conteúdo lido difere do original`);
            assert.equal(saida[1].trim(), esperadoBytes,
                `${nome}: o tamanho lido difere do original — a checagem "o cartão ` +
                `é grande o bastante" passaria ou falharia com o número errado`);

            // E um arquivo NÃO comprimido continua funcionando: o caminho
            // antigo não pode ter sido quebrado para ganhar o novo.
            const scriptCru = `
${def[0]}
${alvo}="${original}"
ler_imagem | sha256sum | awk '{print $1}'
`;
            const cru = execFileSync("bash", ["-c", scriptCru], { encoding: "utf8" }).trim();
            assert.equal(cru, esperadoSha,
                `${nome}: imagem sem .gz deixou de ser lida corretamente`);
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});
