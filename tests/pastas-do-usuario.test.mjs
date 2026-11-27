// As pastas que o usuário usa À MÃO, sem a loja.
//
// Quem copia arquivo pelo cartão ou por SSH precisa saber onde. Medido nos
// fontes do `Giochi app` (26/11/2026), os caminhos que ele varre são quatro, e
// não há outros:
//
//   /user/games   jogos    (launcher: "jogos de /opt/giochi/games e /user/games")
//   /user/apps    apps     (launcher: "apps de /opt/giochi/apps e /user/apps")
//   /user/ports   ports    (giochi-ports: PORTS_DIR=/user/ports)
//   /user/musica  música   (app/musica: NO_APARELHO = "/user/musica")
//
// **Nenhum dos dois lados criava essas pastas** — nem o build, nem o launcher,
// nem o app de música (não há um `create_dir_all` para elas). O defeito é do
// tipo que aparece como culpa do usuário: copiar um arquivo para
// `/user/musica/x.mp3` falha porque o diretório não existe, e o app responde
// "a pasta /user/musica não existe".
//
// O teste roda o `post-build.sh` DE VERDADE num TARGET_DIR sintético — não lê o
// texto — porque o modo de falha aqui é o comando não rodar (§12.59/1: o gate do
// harfbuzz tinha a mensagem certa e a primeira linha o desligava).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const PASTAS = ["games", "apps", "musica", "ports"];

function rodarPostBuild() {
    const alvo = mkdtempSync(path.join(tmpdir(), "giochi-user-"));
    mkdirSync(path.join(alvo, "etc"), { recursive: true });
    mkdirSync(path.join(alvo, "usr/bin"), { recursive: true });
    writeFileSync(
        path.join(alvo, "etc/inittab"),
        "::sysinit:/etc/init.d/rcS\nconsole::respawn:/sbin/getty -L console 0 vt100\n",
    );
    try {
        execFileSync("sh", [path.join(ROOT, "scripts/post-build.sh")], {
            env: { ...process.env, TARGET_DIR: alvo, BINARIES_DIR: alvo, HOST_DIR: "/nonexistent" },
            stdio: "pipe",
        });
    } catch {
        // O script sai 1 quando o `giochi-init` não está executável no alvo
        // sintético — guarda que existe desde antes (§12.50). O que interessa
        // aqui é o que ele JÁ escreveu antes de parar.
    }
    return alvo;
}

test("o post-build cria as quatro pastas do usuário", () => {
    const alvo = rodarPostBuild();
    try {
        for (const p of PASTAS) {
            const caminho = path.join(alvo, "user", p);
            const st = statSync(caminho); // lança se não existir
            assert.ok(st.isDirectory(), `/user/${p} existe e não é diretório`);
        }
    } finally {
        rmSync(alvo, { recursive: true, force: true });
    }
});

test("/roms é symlink para /user, e o LEIA-ME explica cada pasta", () => {
    const alvo = rodarPostBuild();
    try {
        assert.equal(readlinkSync(path.join(alvo, "roms")), "/user",
            "/roms tem de apontar para /user — 7 de 25 ports citam /roms literal (20/11/2026)");

        const leia = readFileSync(path.join(alvo, "user/LEIA-ME.txt"), "utf8");
        for (const p of PASTAS) {
            assert.match(leia, new RegExp(`\\b${p}/`),
                `o LEIA-ME não cita ${p}/ — quem copia arquivo à mão lê ESTE arquivo`);
        }
        // A consequência de não ser partição separada tem de estar dita: sem
        // isso alguém enche o aparelho de ROMs e perde tudo ao regravar.
        assert.match(leia, /NÃO é uma partição separada|NAO e uma particao separada/i,
            "o LEIA-ME tem de avisar que regravar a imagem apaga o conteúdo");
        assert.match(leia, /APAGA/i, "e dizer o que acontece");
    } finally {
        rmSync(alvo, { recursive: true, force: true });
    }
});

test("os caminhos batem com o que o GIOCHI-APP varre", async () => {
    // A fonte da verdade é o código do app (repo somente leitura, §2-A). Se um
    // dia ele passar a varrer /user/jogos em vez de /user/games, este teste
    // avisa aqui — e não no aparelho, com o usuário dizendo "meu jogo não aparece".
    const { existsSync } = await import("node:fs");
    const app = path.join(path.dirname(ROOT), "GIOCHI-APP");
    if (!existsSync(app)) {
        // Sem o repo vizinho na máquina, o teste não pode provar nada. Declarar
        // isso é a regra R10 — e é melhor que um PASS que não verificou nada.
        return;
    }
    const fonte = readFileSync(
        path.join(app, "app/launcher-star-dust/crates/ui-sdl/src/main.rs"),
        "utf8",
    );
    for (const p of ["user/games", "user/apps"]) {
        assert.ok(fonte.includes(p),
            `o launcher não varre /${p} — as nossas pastas ficaram desalinhadas`);
    }
    const pm = readFileSync(path.join(ROOT, "device/common/rootfs-overlay/usr/bin/giochi-ports"), "utf8");
    assert.match(pm, /^PORTS_DIR=\/user\/ports$/m, "o giochi-ports mudou de pasta");
});
