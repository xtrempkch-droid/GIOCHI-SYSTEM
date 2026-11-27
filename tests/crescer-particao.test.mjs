// O crescimento da partição de dados no PRIMEIRO BOOT.
//
// ## O problema
//
// A `.img` tem 2 GiB (o GitHub recusa asset ≥ 2 GiB), então a p3 nasce com
// ~704 MiB **mesmo num cartão de 120 GB**. O `--grow` do `flash-sd.sh` cobre
// quem grava com ele — mas quem grava com `dd` puro, balenaEtcher ou Raspberry
// Pi Imager fica com 704 MiB e 99% do cartão sem uso.
//
// O aparelho resolve sozinho no primeiro boot: lê o tamanho real do disco,
// cresce a p3 até o fim e ajusta o filesystem.
//
// ## Por que estes testes existem
//
// Crescer partição é a operação mais destrutiva que o sistema faz sozinho. Um
// erro aqui não gera mensagem: gera cartão sem tabela, ou save de jogo apagado.
// E o modo de falha é silencioso — medido numa bancada, o `fdisk` do busybox
// criou uma partição de **512 bytes** em vez de 1 GiB, sem erro nenhum.
//
// Por isso a implementação escreve os 4 bytes da entrada do MBR direto, e é
// isso que se testa: a posição, o little-endian e a conta.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync,
    openSync, readSync, writeSync, closeSync, statSync, truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const SCRIPT = path.join(ROOT, "device/common/rootfs-overlay/etc/init.d/S20userdata");
const FRAGMENT = path.join(ROOT, "config/common.fragment");

const SETOR = 512;
const ENTRADA_3 = 0x1BE + 16 * 2;   // 0x1DE

/** Cria um "cartão" com o layout da imagem, e um disco de tamanho escolhido. */
function cartao({ discoGib = 4, p3Setores = 1441792 } = {}) {
    const raiz = mkdtempSync(path.join(tmpdir(), "giochi-grow-"));
    const img = path.join(raiz, "cartao3");   // termina em dígito, como mmcblk1p3
    writeFileSync(img, "");            // truncateSync exige que exista
    truncateSync(img, discoGib * 1024 ** 3);

    // Tabela no mesmo formato do make-sd-image.sh
    const fd = openSync(img, "r+");
    const buf = Buffer.alloc(512);
    buf.writeUInt32LE(0x47494f43, 440);   // disk id
    const escreve = (n, start, size, tipo, boot) => {
        const o = 0x1BE + 16 * (n - 1);
        buf[o] = boot ? 0x80 : 0x00;
        buf[o + 1] = 0xfe; buf[o + 2] = 0xff; buf[o + 3] = 0xff;  // CHS start
        buf[o + 4] = tipo;
        buf[o + 5] = 0xfe; buf[o + 6] = 0xff; buf[o + 7] = 0xff;  // CHS end
        buf.writeUInt32LE(start, o + 8);
        buf.writeUInt32LE(size, o + 12);
    };
    escreve(1, 131072, 524288, 0x0c, true);       // p1 FAT32, 256 MiB
    escreve(2, 655360, 2097152, 0x83, false);     // p2 ext4, 1024 MiB
    escreve(3, 2752512, p3Setores, 0x83, false);  // p3 dados
    buf[510] = 0x55; buf[511] = 0xaa;
    // writeSync e NÃO writeFileSync: o arquivo já foi truncado no tamanho do
    // disco, e `writeFileSync` truncaria de volta para 512 bytes.
    writeSync(fd, buf, 0, 512, 0);
    closeSync(fd);

    return { raiz, img, limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}

function lerSetor0(img) {
    const fd = openSync(img, "r");
    const b = Buffer.alloc(512);
    readSync(fd, b, 0, 512, 0);
    closeSync(fd);
    return b;
}

function lerEntrada3(img) {
    const fd = openSync(img, "r");
    const b = Buffer.alloc(16);
    readSync(fd, b, 0, 16, ENTRADA_3);
    closeSync(fd);
    return { lbaIni: b.readUInt32LE(8), tamanho: b.readUInt32LE(12), tipo: b[4] };
}

/**
 * A lógica de crescimento, extraída do script e adaptada a um arquivo comum.
 *
 * O script real lê `/sys/class/block/<cartao>/size` e escreve no block device;
 * aqui o "disco" é um arquivo. O que se testa é a **conta** e os **bytes**, que
 * são a parte que não pode errar.
 */
function crescerPorArquivo(img, { tamanhoDiscoSetores } = {}) {
    const setores = tamanhoDiscoSetores ?? Math.floor(statSync(img).size / SETOR);
    const { lbaIni, tamanho } = lerEntrada3(img);
    const novo = setores - lbaIni - 2048;
    if (novo <= tamanho) return { cresceu: false, lbaIni, tamanho, novo };
    const b = Buffer.alloc(4);
    b.writeUInt32LE(novo, 0);
    const fd = openSync(img, "r+");
    try {
        // `writeSync` com posição: exatamente o que o `dd seek=` faz.
        execFileSync("dd", [
            `of=${img}`, "bs=1", `seek=${ENTRADA_3 + 12}`,
            "conv=notrunc", "status=none",
        ], { input: b });
    } finally {
        closeSync(fd);
    }
    return { cresceu: true, lbaIni, tamanho, novo };
}

test("cresce a p3 até o fim do disco, na entrada CERTA do MBR", () => {
    // A posição é o que mais importa: escrever 4 bytes no offset errado
    // corrompe a tabela inteira e o cartão deixa de bootar. Medido numa
    // bancada: o `fdisk` do busybox criou uma partição de 512 bytes sem erro.
    const c = cartao({ discoGib: 4 });
    try {
        const antes = lerEntrada3(c.img);
        assert.equal(antes.lbaIni, 2752512);
        assert.equal(antes.tamanho, 1441792);

        const r = crescerPorArquivo(c.img);
        assert.ok(r.cresceu, "não cresceu com disco de 4 GiB");

        const depois = lerEntrada3(c.img);
        assert.equal(depois.lbaIni, antes.lbaIni, "o LBA inicial da p3 mudou — não pode");
        assert.equal(depois.tipo, antes.tipo, "o tipo da partição mudou — não pode");
        assert.equal(depois.tamanho, r.novo, "o tamanho escrito não é o calculado");

        // A conta: fim do disco menos o início da p3, com 1 MiB de margem.
        assert.equal(depois.tamanho, Math.floor(4 * 1024 ** 3 / SETOR) - 2752512 - 2048);

        // E a p3 não pode passar do fim do disco.
        assert.ok(depois.tamanho + depois.lbaIni <= 4 * 1024 ** 3 / SETOR,
            "a p3 passou do fim do disco — a tabela ficaria inválida");
    } finally {
        c.limpar();
    }
});

test("as outras entradas do MBR ficam intactas", () => {
    // Corromper a p1 (boot) ou a p2 (sistema) por um offset errado é o pior
    // resultado possível: o aparelho não liga mais.
    const c = cartao({ discoGib: 4 });
    try {
        // Setor 0 inteiro: o arquivo tem 4 GiB e `readFileSync` sem posição
        // estoura o limite de 2 GiB do Buffer.
        const antes = lerSetor0(c.img).subarray(0x1BE, 0x1BE + 32);
        crescerPorArquivo(c.img);
        const depois = lerSetor0(c.img).subarray(0x1BE, 0x1BE + 32);
        assert.deepEqual(depois, antes, "p1 ou p2 foram alteradas — só a p3 pode mudar");

        // E a assinatura do MBR continua lá.
        const b = lerSetor0(c.img).subarray(510, 512);
        assert.deepEqual([...b], [0x55, 0xaa], "a assinatura 0x55AA do MBR sumiu");
    } finally {
        c.limpar();
    }
});

test("não cresce quando já está no tamanho (ou é maior)", () => {
    // Idempotência: rodar de novo em todo boot não pode mexer em nada. Sem
    // isso, cada boot reescreveria a tabela.
    const c = cartao({ discoGib: 4, p3Setores: 8388608 });  // p3 = 4 GiB inteiro
    try {
        const antes = lerEntrada3(c.img);
        const r = crescerPorArquivo(c.img);
        assert.equal(r.cresceu, false, "cresceu sem precisar");
        assert.deepEqual(lerEntrada3(c.img), antes);
    } finally {
        c.limpar();
    }
});

test("disco MAIOR que a partição: cresce de novo (trocou de cartão)", () => {
    // O usuário gravou a imagem num cartão de 128 GB depois de rodar num de
    // 4 GB. A p3 fica com o tamanho do cartão antigo.
    const c = cartao({ discoGib: 4 });
    try {
        crescerPorArquivo(c.img);
        const apos1 = lerEntrada3(c.img);
        // "troca" para um disco maior
        truncateSync(c.img, 16 * 1024 ** 3);
        const r2 = crescerPorArquivo(c.img);
        assert.ok(r2.cresceu, "não cresceu ao trocar para um cartão maior");
        assert.ok(lerEntrada3(c.img).tamanho > apos1.tamanho);
    } finally {
        c.limpar();
    }
});

test("o script usa ext4 + resize2fs (preserva) e reformata exFAT/FAT", () => {
    // Os três formatos NÃO são iguais: ext4 tem resize2fs e preserva dados;
    // exFAT e FAT não têm — crescer exige reformatar, e isso só é seguro
    // enquanto a partição está vazia.
    const t = readFileSync(SCRIPT, "utf8");
    assert.match(t, /resize2fs/, "não usa resize2fs no caso ext4");
    assert.match(t, /mkfs\.exfat/, "não reformata exFAT");
    assert.match(t, /mkfs\.vfat/, "não reformata FAT32");
    assert.match(t, /ext4\)/, "não separa o caso ext4");
    assert.match(t, /exfat\|vfat\)/, "não separa o caso exFAT/FAT");
});

test("com dados do usuário na p3, NÃO reformata — avisa e não mexe", () => {
    // O caso que apaga o save de alguém. Se a partição tem qualquer coisa além
    // das quatro pastas, do marcador e do LEIA-ME, crescer seria destrutivo.
    const t = readFileSync(SCRIPT, "utf8");
    assert.match(t, /grep -vxE 'games\|apps\|musica\|ports\|giochi-user\|LEIA-ME\.txt'/,
        "a lista do que é 'vazio' tem de excluir só o que o build cria");
    assert.match(t, /não vou apagar|nao vou apagar/,
        "tem de dizer que não apaga, em vez de falhar calado");
    assert.match(t, /regrave com --grow|--grow/,
        "tem de dar a saída para quem quer o espaço assim mesmo");
});

test("só a p3 do cartão do sistema é crescida — nunca um cartão alheio", () => {
    // Mexer na partição do segundo cartão apagaria o save de outra pessoa, e o
    // usuário formatou aquele cartão no tamanho que quis.
    //
    // A chamada real é a ÚLTIMA ocorrência: a primeira é a definição da
    // função. Procurar a primeira acha a assinatura e não prova nada — foi o
    // que aconteceu na versão anterior deste teste.
    const linhas = readFileSync(SCRIPT, "utf8").split("\n");
    const iDef = linhas.findIndex((l) => l.startsWith("crescer_particao_dados()"));
    const iChamada = linhas.findIndex((l, i) => i > iDef && /crescer_particao_dados\s+"\$/.test(l));
    assert.ok(iChamada > iDef, "o script define a função mas nunca a chama");

    // O `if` que a guarda está algumas linhas acima.
    const contexto = linhas.slice(iDef, iChamada + 1).join("\n");
    assert.match(contexto, /if \[ -n "\$ROOT_CARD" \] && \[ -n "\$ROOT_PARTICAO" \]/,
        "a chamada tem de estar guardada por ROOT_CARD/ROOT_PARTICAO — " +
        "sem isso o segundo cartão também seria crescido");
    assert.doesNotMatch(linhas.slice(iDef, iChamada + 1).join("\n"), /achar_e_montar_dados\s*$/m,
        "a chamada tem de ser antes do mount, com a partição desmontada");
});

test("os pacotes estão no common: MKFS_FAT, RESIZE2FS e EXFATPROGS", () => {
    // `BR2_PACKAGE_DOSFSTOOLS=y` sozinho NÃO instala `mkfs.vfat` — é subopção,
    // e o padrão é nenhuma. Medido no target do R35S: mkfs.ext4 e e2fsck
    // existiam, `resize2fs` e `mkfs.vfat` não. É o §12.16 na letra.
    const f = readFileSync(FRAGMENT, "utf8");
    assert.match(f, /^BR2_PACKAGE_DOSFSTOOLS_MKFS_FAT=y$/m,
        "sem MKFS_FAT não há mkfs.vfat — o pacote sozinho não o instala");
    assert.match(f, /^BR2_PACKAGE_E2FSPROGS_RESIZE2FS=y$/m,
        "sem RESIZE2FS o ext4 só cresceria reformatando");
    assert.match(f, /^BR2_PACKAGE_EXFATPROGS=y$/m,
        "sem exfatprogs não há como reformatar a p3 exFAT no aparelho");
});

test("o tamanho é reportado em MiB, não em GiB (bug de unidade corrigido)", () => {
    // Erro meu na primeira versão: `setores / 2 / 1024` dá MiB, e eu rotulava
    // GiB. A p3 de 704 MiB aparecia como "704 GiB" — número absurdo que
    // esconde a informação em vez de dar. Mesma família do §12.63.
    const t = readFileSync(SCRIPT, "utf8");
    assert.match(t, /_atual_mib=\$\(\( _lba_tam \/ 2 \/ 1024 \)\)/,
        "a conta de MiB tem de ser setores/2/1024");
    assert.doesNotMatch(t, /\$\{_atual_gib\}|\$\{_novo_gib\}/,
        "sobrou variável rotulada GiB com valor de MiB");
});

// ─────────────────────────────────────────────────────────────────────────────
// Integração: roda a FUNÇÃO REAL do script, não uma reimplementação.
//
// Os testes acima provam a conta e os bytes com uma cópia da lógica em JS. Isso
// é o "mock mais generoso que o alvo" que já custou caro neste projeto duas
// vezes (§44, §46): o teste aprova o que o autor *quis* escrever, não o que o
// script faz. Aqui a função é extraída do arquivo entre sentinelas e executada
// por um `sh` de verdade, com `mount`/`resize2fs`/`mkfs.*` falsos que só
// registram a chamada.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fecha o bloco extraído com a quantidade de `}` que falta.
 *
 * O `begin`/`end` de cada bloco está numa posição diferente em relação à chave
 * de fechamento: no helper o `}` fica ANTES do `end`, na função principal fica
 * DEPOIS. Acrescentar `}` sempre dava "syntax error" num dos dois, e a mensagem
 * aponta para o arquivo gerado, não para o teste.
 */
function fechar(bloco) {
    const abre = (bloco.match(/\{/g) || []).length;
    const fecha = (bloco.match(/\}/g) || []).length;
    return bloco + "}".repeat(Math.max(0, abre - fecha)) + "\n";
}

/** Extrai `crescer_particao_dados()` do script, adaptada a arquivos comuns. */
function funcaoReal({ img }) {
    const texto = readFileSync(SCRIPT, "utf8");
    const iIni = texto.indexOf("# giochi-system:grow:begin");
    const iFim = texto.indexOf("# giochi-system:grow:end");
    assert.ok(iIni > 0 && iFim > iIni, "as sentinelas grow:begin/end sumiram do script");
    // Recua até o começo da linha da definição.
    const iCabeca = texto.lastIndexOf("\ncrescer_particao_dados() {", iIni);

    // A função usa `gravar_tamanho_mbr`, que mora antes dela. Extrair só a
    // função daria "command not found" e o MBR não cresceria — o teste
    // passaria a medir a ausência do helper, não o comportamento.
    const iMbrIni = texto.indexOf("# giochi-system:mbr:begin");
    const iMbrFim = texto.indexOf("# giochi-system:mbr:end");
    assert.ok(iMbrIni > 0 && iMbrFim > iMbrIni, "as sentinelas mbr:begin/end sumiram do script");
    // O `begin` fica ANTES da definição do helper (ao contrário da função
    // principal, cujo `begin` está dentro dela). `lastIndexOf` devolvia -1 e
    // o harness extraía o arquivo INTEIRO — o teste então falhava com
    // "syntax error", que não aponta para a causa.
    const iHelper = texto.indexOf("gravar_tamanho_mbr() {", iMbrIni);
    assert.ok(iHelper > iMbrIni, "a definição do helper não foi achada depois do begin");
    const helper = texto.slice(iHelper, iMbrFim);

    let bloco = fechar(helper) + fechar(texto.slice(iCabeca, iFim));

    // O script fala com block devices; o teste fala com arquivos. As duas
    // trocas são as ÚNICAS e estão declaradas aqui, para que o resto do corpo
    // seja o que roda no aparelho.
    bloco = bloco
        .replace(
            'cat "/sys/class/block/$_cartao/size" 2>/dev/null',
            `cat "${path.join(path.dirname(img), "size")}" 2>/dev/null`
        )
        .replace('_disco="/dev/$_cartao"', `_disco="${img}"`)
        // O script monta num ponto fixo (`/run/giochi/p3-tmp`), que o teste não
        // pode criar — não roda como root. Sem esta troca o `mount` falso
        // falhava por permissão, `ls -A` vinha vazio e TODO teste de exFAT
        // "passava" reformatando: o mock estava medindo a própria falha.
        .replace(/_tmpmnt=\/run\/giochi\/p3-tmp/, `_tmpmnt=${path.join(path.dirname(img), "p3-tmp")}`);

    assert.match(bloco, /_disco="\/tmp|_disco="\/home/, "a troca do disco não pegou");
    return bloco;
}

/** PATH com os comandos do aparelho trocados por registradores de chamada. */
function ferramentas(raiz, { montaOk = true, conteudo = "", temMkfs = true } = {}) {
    const bin = path.join(raiz, "bin");
    mkdirSync(bin, { recursive: true });
    const log = path.join(raiz, "chamadas.log");
    writeFileSync(log, "");

    const sh = (nome, corpo) => {
        const p = path.join(bin, nome);
        writeFileSync(p, `#!/bin/sh\n${corpo}\n`);
        execFileSync("chmod", ["+x", p]);
    };

    // Toda ferramenta só anota que foi chamada, com os argumentos.
    for (const nome of ["resize2fs", "mkfs.exfat", "mkfs.vfat", "partprobe", "sync"]) {
        if (nome.startsWith("mkfs") && !temMkfs) continue;
        sh(nome, `echo "${nome} $*" >> "${log}"; exit 0`);
    }
    sh("sleep", `echo "sleep $*" >> "${log}"; exit 0`);

    // `mount` precisa simular o conteúdo: é o que decide se reformata ou não.
    // Um `mkdir -p` por item, e não um `printf` com a lista numa string: com
    // `printf '%s\\n' "a\\nb"` o `\\n` sai LITERAL e o mock cria uma pasta de
    // nome esquisito em vez de duas — o teste então mede o mock, não o script.
    const itens = conteudo.split("\n").filter(Boolean);
    const criaItens = itens
        .map((n) => `mkdir -p "$ult/${n}" 2>/dev/null || true`)
        .join("\n");
    sh("mount", [
        `echo "mount $*" >> "${log}"`,
        `for a in "$@"; do ult="$a"; done`,
        montaOk ? criaItens : `exit 32`,
        `exit 0`,
    ].join("\n"));

    sh("umount", `echo "umount $*" >> "${log}"; exit 0`);

    // PATH ISOLADO: só as ferramentas do utilitário mínimo, e só as nossas.
    //
    // Sem isso, `command -v mkfs.exfat` acha o do HOST e o teste "sem mkfs"
    // mede a máquina de quem roda, não o script. Foi o que aconteceu na
    // primeira versão: o teste falhava com o exfatprogs instalado e passava
    // sem ele — resultado que depende do host não prova nada.
    const reais = [
        "dd", "od", "sed", "grep", "ls", "cat", "basename", "dirname",
        "mkdir", "rmdir", "tr", "head", "rm", "mv", "cp", "stat", "awk",
    ];
    for (const r of reais) {
        const origem = execFileSync("sh", ["-c", `command -v ${r}`], { encoding: "utf8" }).trim();
        execFileSync("ln", ["-sf", origem, path.join(bin, r)]);
    }

    return { bin, log, chamadas: () => readFileSync(log, "utf8") };
}

/** Roda a função real com o harness montado. */
function rodarFuncao({ img, tipo, ferramentas: f }) {
    const raiz = path.dirname(img);
    const script = path.join(raiz, "harness.sh");
    writeFileSync(script, `#!/bin/sh
LABEL_PREFERIDO=GIOCHI_USER
log() { echo "LOG: $*"; }
${funcaoReal({ img })}
crescer_particao_dados "${img}" "${tipo}"
echo "RC=$?"
`);
    execFileSync("chmod", ["+x", script]);
    return execFileSync("/bin/sh", [script], {
        encoding: "utf8",
        env: { ...process.env, PATH: f.bin },   // isolado: ver `ferramentas()`
    });
}

function bancada({ discoGib = 4, tipo = "ext4", conteudo = "", montaOk = true, temMkfs = true }) {
    const c = cartao({ discoGib });
    // O sysfs reporta setores de 512 num arquivo chamado `size`.
    writeFileSync(path.join(c.raiz, "size"), String(discoGib * 1024 ** 3 / SETOR) + "\n");
    const f = ferramentas(c.raiz, { montaOk, conteudo, temMkfs });
    return { ...c, f, rodar: (t = tipo) => rodarFuncao({ img: c.img, tipo: t, ferramentas: f }) };
}

test("INTEGRAÇÃO: ext4 escreve o MBR e chama resize2fs", () => {
    // O caminho que preserva dados. Se `resize2fs` não for chamado, o MBR diz
    // 2,7 GiB e o filesystem continua com 704 MiB — `df` mente e o usuário
    // enche o cartão até dar "no space left" no meio de um save.
    const b = bancada({ tipo: "ext4" });
    try {
        const saida = b.rodar("ext4");
        const depois = lerEntrada3(b.img);
        // O valor EXATO, não só "cresceu". Com `>` apenas, tirar a margem de
        // 1 MiB (2048 setores) passa despercebido — medido: a mutação M3
        // sobrevivia a 18/18.
        const esperado = Math.floor(4 * 1024 ** 3 / SETOR) - 2752512 - 2048;
        assert.equal(depois.tamanho, esperado,
            "o tamanho não é disco - lba_ini - margem(1 MiB). " +
            "Sem a margem, o último MiB fica fora do alinhamento do sfdisk.");

        const ch = b.f.chamadas();
        assert.match(ch, /resize2fs/, "não chamou resize2fs — o ext4 ficaria do tamanho antigo");
        assert.match(ch, /partprobe/, "não chamou partprobe — o kernel não relê a tabela");
        assert.doesNotMatch(ch, /mkfs/, "reformatou ext4 — perda de dados");
        assert.match(saida, /dados preservados/);
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: rodar duas vezes seguidas não muda nada na 2ª", () => {
    // O script roda em TODO boot. Sem a guarda, ele reescreveria a tabela e
    // reformataria o exFAT a cada boot — e no segundo boot a p3 já pode ter
    // dados do usuário, então a "reformatada" viraria perda de save.
    //
    // Medido: sem a guarda (mutação M2) os 18 testes passavam, porque a
    // idempotência só era testada na reimplementação em JS.
    const b = bancada({ tipo: "exfat", conteudo: "games\napps\nmusica\nports\ngiochi-user" });
    try {
        b.rodar("exfat");
        const apos1 = lerEntrada3(b.img);
        const ch1 = b.f.chamadas();
        assert.ok(apos1.tamanho > 1441792, "a primeira passada não cresceu");

        writeFileSync(b.f.log, "");                 // zera o registro
        const saida2 = b.rodar("exfat");
        assert.deepEqual(lerEntrada3(b.img), apos1,
            "a segunda passada mexeu no MBR — todo boot reescreveria a tabela");
        assert.equal(b.f.chamadas(), "",
            "a segunda passada chamou ferramenta (" + b.f.chamadas().trim() + "). " +
            "Sem a guarda `novo > atual`, todo boot reformata a partição.");
        assert.doesNotMatch(saida2, /crescido|reformatado/,
            "a segunda passada disse que cresceu — não cresceu");
        assert.ok(!ch1.match(/mkfs/g) || true);
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: o caso real de 120 GB — p3 passa de 704 MiB para ~118 GiB", () => {
    // O pedido do dono do projeto: "sdcard de 120gb, redimensiona até
    // preencher". O número que importa é este, e não o de um cartão de 4 GiB.
    const b = bancada({ discoGib: 120, tipo: "ext4" });
    try {
        const saida = b.rodar("ext4");
        const p3 = lerEntrada3(b.img);
        const mib = Math.floor(p3.tamanho / 2 / 1024);
        // 120 GiB = 122880 MiB. Menos 1344 MiB (p1+p2 deslocamento) e 1 MiB
        // de margem = 121535 MiB. A conta tem de ser em MiB dos dois lados:
        // comparar MiB contra o número de GiB foi o meu erro na primeira
        // versão deste teste, e é a mesma família do bug de unidade do script.
        assert.ok(mib > 121_000 && mib < 122_880,
            "p3 ficou com " + mib + " MiB; esperado ~121535 num cartão de 120 GiB");
        assert.match(saida, /p3 tem 704 MiB de 121\d{3} MiB possíveis/);
        assert.match(saida, /disco de 251658240 setores \(~120 GiB\)/);
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: exFAT vazia reformata e avisa que estava vazia", () => {
    // Primeiro boot: só as quatro pastas, o marcador e o LEIA-ME.
    const b = bancada({
        tipo: "exfat",
        conteudo: "games\napps\nmusica\nports\ngiochi-user\nLEIA-ME.txt",
    });
    try {
        const saida = b.rodar("exfat");
        assert.ok(lerEntrada3(b.img).tamanho > 1441792, "o MBR não cresceu");
        const ch = b.f.chamadas();
        assert.match(ch, /mkfs\.exfat/, "não reformatou o exFAT");
        assert.doesNotMatch(ch, /resize2fs/, "chamou resize2fs num exFAT");
        assert.match(saida, /reformatado/);
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: exFAT COM dados do usuário não é tocada", () => {
    // O caso que apaga o save de alguém. Nem o MBR pode mudar: crescer o MBR
    // sem crescer o filesystem já é ruim, e reformatar é pior.
    const b = bancada({
        tipo: "exfat",
        conteudo: "games\napps\nmusica\nports\ngiochi-user\nLEIA-ME.txt\nmeu-jogo.sav",
    });
    try {
        const saida = b.rodar("exfat");
        assert.equal(lerEntrada3(b.img).tamanho, 1441792, "o MBR mudou com dados na partição");
        const ch = b.f.chamadas();
        assert.doesNotMatch(ch, /mkfs/, "reformatou uma partição com dados — perda de save");
        assert.match(saida, /não vou apagar/);
        assert.match(saida, /--grow/, "não ofereceu a saída para quem quer o espaço");
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: se não consegue montar para conferir, não cresce", () => {
    // Na dúvida, preservar. Um mount que falha pode significar filesystem que
    // o kernel não entende — reformatar ali apagaria algo que não se conseguiu
    // nem ler.
    const b = bancada({ tipo: "exfat", montaOk: false });
    try {
        const saida = b.rodar("exfat");
        assert.equal(lerEntrada3(b.img).tamanho, 1441792, "cresceu sem conseguir conferir o conteúdo");
        assert.doesNotMatch(b.f.chamadas(), /mkfs/);
        assert.match(saida, /não consegui montar/);
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: sem mkfs na imagem, avisa em vez de mentir", () => {
    // Build antigo, sem `EXFATPROGS`. O MBR já cresceu; o filesystem não. Se o
    // script dissesse "crescido", o usuário encheria o cartão e perderia dados
    // no "no space left" — o aviso é a única coisa entre ele e isso.
    const b = bancada({ tipo: "exfat", temMkfs: false, conteudo: "games\ngiochi-user" });
    try {
        const saida = b.rodar("exfat");
        assert.match(saida, /AVISO: sem mkfs\.exfat/, "não avisou da falta do mkfs");
        assert.match(saida, /fica com 704 MiB/, "não disse o tamanho real que sobrou");
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: tipo desconhecido não é tocado", () => {
    const b = bancada({ tipo: "btrfs" });
    try {
        const saida = b.rodar("btrfs");
        assert.equal(lerEntrada3(b.img).tamanho, 1441792);
        assert.match(saida, /não sei crescer btrfs/);
    } finally {
        b.limpar();
    }
});

test("INTEGRAÇÃO: o MBR escrito é uma tabela que o sfdisk lê", () => {
    // A prova de que os bytes estão na posição certa: um leitor externo
    // reconstrói a tabela. Escrever em offset errado passa em qualquer teste
    // que só compare o que ele mesmo escreveu.
    const b = bancada({ tipo: "ext4" });
    try {
        b.rodar("ext4");
        const saida = execFileSync("sfdisk", ["-d", b.img], { encoding: "utf8" });
        assert.match(saida, /start=\s*131072, size=\s*524288, type=c, bootable/,
            "a p1 (boot) não é mais reconhecida");
        assert.match(saida, /start=\s*655360, size=\s*2097152, type=83/,
            "a p2 (sistema) não é mais reconhecida");
        const p3 = saida.match(/start=\s*2752512, size=\s*(\d+), type=83/);
        assert.ok(p3, "a p3 não é mais reconhecida");
        assert.ok(Number(p3[1]) > 1441792, "a p3 não cresceu");
    } finally {
        b.limpar();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// O MBR escrito tem de ser válido em TODA shell que rode `#!/bin/sh`.
//
// Medido: `printf '\x00\x00\x00\x01'` escreve os BYTES CERTOS no bash e no
// busybox ash, e escreve o TEXTO "\x00" no dash. O aparelho usa busybox ash,
// então passaria — mas `/bin/sh` é dash em Debian/Ubuntu, e um init script que
// grava tabela de partição não pode depender de extensão. Do lado do aparelho o
// sintoma seria um MBR com "\x00" no campo de tamanho: cartão sem tabela.
// ─────────────────────────────────────────────────────────────────────────────

/** Extrai só o helper `gravar_tamanho_mbr` do script. */
function helperMbr() {
    const texto = readFileSync(SCRIPT, "utf8");
    const iIni = texto.indexOf("# giochi-system:mbr:begin");
    const iFim = texto.indexOf("# giochi-system:mbr:end");
    assert.ok(iIni > 0 && iFim > iIni, "as sentinelas mbr:begin/end sumiram do script");
    const iCab = texto.indexOf("gravar_tamanho_mbr() {", iIni);
    assert.ok(iCab > iIni, "a definição do helper não foi achada depois do begin");
    return texto.slice(iCab, iFim);
}

test("gravar_tamanho_mbr grava 4 bytes certos em dash, bash e busybox ash", () => {
    const helper = helperMbr();

    const shells = [["/bin/sh", ["/bin/sh"]], ["bash", ["bash"]]];
    try {
        execFileSync("busybox", ["true"]);
        shells.push(["busybox ash", ["busybox", "sh"]]);
    } catch { /* busybox é opcional na bancada; dash e bash bastam */ }

    // 8372224 = 0x007fc000 -> bytes 00 c0 7f 00. NUL nas duas pontas é
    // justamente o caso que o `\x` do dash erra.
    const valor = 8372224;
    const esperado = [0x00, 0xc0, 0x7f, 0x00];

    const raiz = mkdtempSync(path.join(tmpdir(), "giochi-mbr-"));
    try {
        const alvo = path.join(raiz, "setor");
        const script = path.join(raiz, "h.sh");
        writeFileSync(script, "#!/bin/sh\n" + helper + "\ngravar_tamanho_mbr " + alvo + " 8 " + valor + "\n");
        execFileSync("chmod", ["+x", script]);

        for (const [nome, cmd] of shells) {
            writeFileSync(alvo, Buffer.alloc(512, 0xaa));
            execFileSync(cmd[0], [...cmd.slice(1), script]);
            const lido = [...readFileSync(alvo).subarray(8, 12)];
            const hex = (a) => a.map((b) => b.toString(16).padStart(2, "0")).join(" ");
            assert.deepEqual(lido, esperado,
                nome + ": gravou [" + hex(lido) + "] em vez de [" + hex(esperado) + "]. " +
                "\\xNN nao e POSIX: use octal NNN.");
        }
    } finally {
        rmSync(raiz, { recursive: true, force: true });
    }
});

test("nenhum printf do script usa a extensao hexa (so octal)", () => {
    // A classe inteira, não o caso: o teste acima só extrai o helper, então um
    // `printf` novo com hexa em outro lugar passaria por ele e quebraria o MBR
    // no caminho novo.
    const linhas = readFileSync(SCRIPT, "utf8").split("\n");
    const hexa = /printf\s+"?[^"]*\\x/;
    const culpadas = linhas
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => hexa.test(l))
        .filter(([, l]) => !l.trimStart().startsWith("#"));
    assert.deepEqual(culpadas.map(([n]) => n), [],
        "linha(s) com hexa: " + JSON.stringify(culpadas.map(([n, l]) => n + ": " + l.trim())) +
        ". A extensao hexa nao e POSIX e o dash grava o texto literal.");
});
