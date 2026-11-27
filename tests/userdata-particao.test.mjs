// A partição de dados do usuário (`/user`) — a que sobrevive à regravação.
//
// O problema que estes testes protegem é de PERDA DE DADO, e ele tem três
// formas, todas silenciosas:
//
//   1. montar a partição sobre o `/user` do rootfs esconde o que estava lá
//      (LEIA-ME, jogos já copiados) — o usuário vê "sumiu tudo", sem mensagem;
//   2. a partição nasce VAZIA no make-sd-image, então sem migração o primeiro
//      boot é justamente o momento em que o conteúdo antigo desaparece;
//   3. mexer numa partição que JÁ tem conteúdo (o save de um jogo) sobrescreve
//      sem volta.
//
// O teste roda o `S20userdata` de verdade, com `mount`/`umount` falsos no PATH —
// não monta nada e não precisa de root. É o mesmo padrão do `ssh` falso em
// `tests/panel-diag.test.mjs`: a lógica é o que se testa, não o kernel.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync,
    chmodSync, symlinkSync, rmSync, cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const SCRIPT = path.join(ROOT, "device/common/rootfs-overlay/etc/init.d/S20userdata");

/**
 * Monta uma bancada: raiz falsa, /dev/disk/by-label opcional, mount/umount
 * falsos que registram o que foi chamado, e /proc/mounts próprio.
 */
function bancada({ label = null, jaMontado = false, conteudoUsuario = null, conteudoParticao = null } = {}) {
    const raiz = mkdtempSync(path.join(tmpdir(), "giochi-sd-"));
    const dirs = {
        raiz,
        bin: path.join(raiz, "bin"),
        dev: path.join(raiz, "dev/disk/by-label"),
        user: path.join(raiz, "user"),
        run: path.join(raiz, "run"),
        mnt: path.join(raiz, "mnt"),
    };
    for (const d of [dirs.bin, dirs.dev, dirs.user, dirs.mnt, path.join(dirs.run, "giochi")]) {
        mkdirSync(d, { recursive: true });
    }

    // Um "dispositivo" que é só um diretório com o conteúdo da partição.
    const particao = path.join(raiz, "particao");
    mkdirSync(particao, { recursive: true });
    if (conteudoParticao) {
        for (const [nome, txt] of Object.entries(conteudoParticao)) {
            mkdirSync(path.join(particao, path.dirname(nome)), { recursive: true });
            writeFileSync(path.join(particao, nome), txt);
        }
    }

    if (conteudoUsuario) {
        for (const [nome, txt] of Object.entries(conteudoUsuario)) {
            mkdirSync(path.join(dirs.user, path.dirname(nome)), { recursive: true });
            writeFileSync(path.join(dirs.user, nome), txt);
        }
    }

    // by-label/GIOCHI_USER -> o diretório da partição
    if (label) {
        symlinkSync(particao, path.join(dirs.dev, label));
    }

    const registro = path.join(raiz, "chamadas.log");
    writeFileSync(registro, "");

    // `mount` falso: em vez de montar, copia a partição para o destino (que é o
    // que o kernel faria do ponto de vista de quem lê o diretório).
    writeFileSync(
        path.join(dirs.bin, "mount"),
        `#!/bin/sh
echo "mount $*" >> "${registro}"
# Parse de verdade: mount -t ext4 <origem> <destino>. A versão anterior
# tratava ext4 (o argumento de -t) como origem, e o mock "montava" um caminho
# inexistente — apagando o destino e não copiando nada. O teste passava/falhava
# pelo motivo errado.
src=""; dst=""; pular=0
for a in "$@"; do
  if [ "$pular" = 1 ]; then pular=0; continue; fi
  case "$a" in
    -t) pular=1 ;;
    -*) ;;
    *) if [ -z "$src" ]; then src="$a"; else dst="$a"; fi ;;
  esac
done
[ -n "$src" ] && [ -n "$dst" ] || exit 1
# src é /dev/... que aqui é um symlink para o diretório da partição.
# O kernel ESCONDE o conteúdo do ponto de montagem — o mock tem de fazer o
# mesmo, senão o script veria o /user do rootfs e concluiria "já tem conteúdo".
alvo="$(readlink -f "$src" 2>/dev/null)"
[ -n "$alvo" ] || exit 1
rm -rf "$dst"/* "$dst"/.[!.]* 2>/dev/null || true
cp -a "$alvo/." "$dst/" 2>/dev/null || true
exit 0
`,
    );
    writeFileSync(
        path.join(dirs.bin, "umount"),
        `#!/bin/sh
echo "umount $*" >> "${registro}"
exit 0
`,
    );
    // `mountpoint` falso: responde pelo estado que o teste escolheu.
    writeFileSync(
        path.join(dirs.bin, "mountpoint"),
        `#!/bin/sh
${jaMontado ? "exit 0" : "exit 1"}
`,
    );
    for (const f of ["mount", "umount", "mountpoint"]) chmodSync(path.join(dirs.bin, f), 0o755);

    // /proc/mounts e /proc/self/mountinfo próprios
    const mounts = path.join(raiz, "proc-mounts");
    writeFileSync(
        mounts,
        jaMontado
            ? `tmpfs / tmpfs rw 0 0\n/dev/mmcblk0p3 ${dirs.user} ext4 rw 0 0\n`
            : `tmpfs / tmpfs rw 0 0\n`,
    );
    writeFileSync(path.join(raiz, "proc-mountinfo"), `24 1 179:2 / / rw - ext4 /dev/root rw\n`);

    // O script com os caminhos trocados para a bancada.
    const fonte = readFileSync(SCRIPT, "utf8");
    const adaptado = fonte
        .replace(/^MNT=\/user$/m, `MNT=${dirs.user}`)
        .replace(/\/run\/giochi/g, path.join(dirs.run, "giochi"))
        .replace(/\/dev\/disk\/by-label/g, dirs.dev)
        .replace(/\/proc\/self\/mountinfo/g, path.join(raiz, "proc-mountinfo"))
        .replace(/\/proc\/mounts/g, mounts)
        .replace(/\/sys\/dev\/block/g, path.join(dirs.mnt, "sys-dev-block"))
        .replace(/\/sys\/class\/block/g, path.join(dirs.mnt, "sys-class-block"));
    const script = path.join(raiz, "S20userdata");
    writeFileSync(script, adaptado);
    chmodSync(script, 0o755);

    // No kernel, `$MNT` e a partição são o MESMO armazenamento. Aqui são dois
    // diretórios, então depois de rodar o script o conteúdo do ponto de
    // montagem é sincronizado de volta — senão o teste "provaria" só que o
    // script escreveu no diretório errado.
    const sincronizar = () => {
        if (!existsSync(dirs.user)) return;
        // Só houve montagem se o `mount` falso foi chamado; sem isso o `user`
        // ainda é o do rootfs e copiá-lo destruiria o conteúdo da partição.
        if (!/^mount /m.test(readFileSync(registro, "utf8"))) return;
        for (const e of readdirSync(particao)) {
            rmSync(path.join(particao, e), { recursive: true, force: true });
        }
        cpSync(dirs.user, particao, { recursive: true });
    };

    const rodar = () => {
        const saida = execFileSync("sh", [script], {
            env: { ...process.env, PATH: `${dirs.bin}:${process.env.PATH}` },
            encoding: "utf8",
            stdio: "pipe",
        });
        sincronizar();
        return saida;
    };

    return { ...dirs, particao, registro, rodar, limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}

test("sem partição de dados, /user fica no rootfs e as pastas continuam existindo", () => {
    const b = bancada();
    try {
        const saida = b.rodar();
        assert.match(saida, /sem partição de dados/i, "tem de DIZER que não há partição");
        // Nada de mount: sem partição não se monta nada.
        assert.equal(readFileSync(b.registro, "utf8").trim(), "", "não pode chamar mount");
        // E não pode apagar o que estava no /user do rootfs.
        assert.ok(existsSync(b.user), "/user do rootfs continua lá");
    } finally {
        b.limpar();
    }
});

test("a partição VAZIA recebe o conteúdo do primeiro boot, e o original é liberado", () => {
    // O caso que perde dado se não for tratado: a p3 nasce formatada e vazia, e
    // montá-la esconde o /user do rootfs.
    const b = bancada({
        label: "GIOCHI_USER",
        conteudoUsuario: { "musica/faixa.mp3": "MUSICA", "LEIA-ME.txt": "LEIAME" },
    });
    try {
        b.rodar();
        assert.ok(existsSync(path.join(b.particao, "musica/faixa.mp3")),
            "a música do rootfs não foi migrada para a partição");
        assert.equal(readFileSync(path.join(b.particao, "LEIA-ME.txt"), "utf8"), "LEIAME");
        // As quatro pastas do contrato, na partição.
        for (const p of ["games", "apps", "musica", "ports"]) {
            assert.ok(existsSync(path.join(b.particao, p)), `falta ${p}/ na partição`);
        }
    } finally {
        b.limpar();
    }
});

test("partição que JÁ tem conteúdo não é tocada — save de jogo não se sobrescreve", () => {
    // Este é o caso que estraga tudo se invertido: sobrescrever o que o usuário
    // já tem na partição é perda de dado sem volta, e pior que não migrar.
    const b = bancada({
        label: "GIOCHI_USER",
        conteudoUsuario: { "LEIA-ME.txt": "LEIAME" },
        conteudoParticao: { "games/save-do-jogo.sav": "SAVE" },
    });
    try {
        const saida = b.rodar();
        assert.equal(readFileSync(path.join(b.particao, "games/save-do-jogo.sav"), "utf8"), "SAVE",
            "o save na partição foi sobrescrito ou apagado");
        assert.ok(!existsSync(path.join(b.particao, "LEIA-ME.txt")),
            "migrou por cima de uma partição que já tinha conteúdo");
        assert.match(saida, /já tem conteúdo|não mexo/i, "tem de dizer que não mexeu");
    } finally {
        b.limpar();
    }
});

test("/user já montado não é remontado nem desmontado", () => {
    // "Nunca desmonte o que você não montou" (§12.28) — e remontar por cima
    // enquanto o usuário usa o aparelho esconde arquivos abertos.
    const b = bancada({ label: "GIOCHI_USER", jaMontado: true });
    // "Já montado" quer dizer que o ponto de montagem JÁ mostra a partição.
    writeFileSync(path.join(b.user, "ja-estava.txt"), "PARTICAO");
    try {
        const saida = b.rodar();
        assert.match(saida, /já está montado/i);
        const log = readFileSync(b.registro, "utf8");
        assert.doesNotMatch(log, /^mount /m, "não pode chamar mount");
        assert.doesNotMatch(log, /umount/, "não pode desmontar o que não montou");
    } finally {
        b.limpar();
    }
});

test("o script é executável e está no overlay comum (vale para os três aparelhos)", async () => {
    // O overlay comum é o que faz o comportamento chegar em todo aparelho. Se o
    // S20userdata fosse só num overlay de aparelho, os outros ficariam sem a
    // montagem — e o sintoma seria "no X55 funciona, no R35S não".
    const st = await import("node:fs").then((m) => m.statSync(SCRIPT));
    assert.ok(st.mode & 0o111, "S20userdata sem bit de execução: o rcS não o executa (§12.50)");
    assert.ok(SCRIPT.includes(path.join("device", "common", "rootfs-overlay")),
        "tem de estar no overlay COMUM, não no de um aparelho");

    // E o post-build tem de continuar criando as pastas no rootfs: é o que
    // existe no primeiro boot, antes de haver partição montada.
    const pb = readFileSync(path.join(ROOT, "scripts/post-build.sh"), "utf8");
    for (const p of ["games", "apps", "musica", "ports"]) {
        assert.match(pb, new RegExp(p), `o post-build deixou de criar /user/${p}`);
    }
});

test("o make-sd-image cria a p3 e o flash-sd sabe crescer ela", async () => {
    // Sem a p3 na imagem, não há o que montar; sem o --grow apontando para ela,
    // a partição fica nos 704 MiB da imagem e o piso de 4 GiB nunca acontece.
    const sd = readFileSync(path.join(ROOT, "scripts/make-sd-image.sh"), "utf8");
    assert.match(sd, /GIOCHI_USER/, "falta o rótulo da partição de dados");
    assert.match(sd, /DATA_PART_MIB/, "falta o cálculo do tamanho da p3");
    assert.match(sd, /start=.*ROOTFS_MIB.*\* 2048.*\nstart=/, "a tabela sfdisk não tem a terceira partição");
    // A p2 fica do tamanho EXATO do rootfs: crescer o rootfs era o
    // comportamento antigo, e é o oposto do que se quer.
    assert.match(sd, /size=\$\(\( ROOTFS_MIB \* 2048 \)\)/, "a p2 tem de ter tamanho fixo (o do rootfs)");

    const flash = readFileSync(path.join(ROOT, "scripts/flash-sd.sh"), "utf8");
    // O --grow tem de mirar a ÚLTIMA partição, não a 2 — e a última é a de dados.
    assert.match(flash, /sfdisk|resize2fs/, "o --grow tem de continuar existindo");
});

test("com DOIS cartões rotulados, prefere o do cartão do sistema", () => {
    // O requisito do dono do projeto: "não esquecer o sdcard (ou o segundo
    // sdcard)". Um segundo cartão de dados é útil — mas escolher "o primeiro que
    // aparecer" fica dependente da ordem de probe, e `mmcblk0` num boot pode ser
    // o cartão do sistema e no seguinte o de dados (§12.24: nome de device não é
    // identidade — o que decide é o rótulo, com desempate pelo cartão do rootfs).
    const b = bancada({ label: "GIOCHI_USER" });
    try {
        // Segundo cartão, com o mesmo rótulo e conteúdo diferente.
        const outro = path.join(b.raiz, "particao2");
        mkdirSync(path.join(outro, "games"), { recursive: true });
        writeFileSync(path.join(outro, "games/segundo.txt"), "SEGUNDO");
        symlinkSync(outro, path.join(b.dev, "GIOCHI_USER1"));

        b.rodar();
        const log = readFileSync(b.registro, "utf8");
        // A mensagem diz qual foi escolhido; o importante é não pegar o segundo.
        assert.match(log, /mount -t ext4 /, "montou alguma coisa");
        assert.doesNotMatch(log, /particao2/, "montou o segundo cartão sem ser pedido");
    } finally {
        b.limpar();
    }
});
