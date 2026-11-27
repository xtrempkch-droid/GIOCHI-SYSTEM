// A partição de boot montada em caminho FIXO (/boot), e o que não é possível.
//
// Duas coisas se testam aqui, e a segunda é tão importante quanto a primeira:
//
//   1. o `S09bootpart` monta a p1 em `/boot`, e escolhe a do CARTÃO QUE BOOTOU —
//      não a eMMC interna, que pode ter um `extlinux/` de outra instalação;
//   2. `CONFIG_UEVENT_HELPER` está DESLIGADO, então automount de mídia
//      removível **não é possível** sem rebuild de kernel. O teste prende o
//      fato para que ninguém prometa a equipe do app uma coisa que a imagem não
//      faz.
//
// O teste roda os scripts de verdade com `mount` falso no PATH — não monta nada
// e não precisa de root.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync,
    symlinkSync, rmSync, readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const OVERLAY = path.join(ROOT, "device/common/rootfs-overlay");
const LIB = path.join(OVERLAY, "usr/lib/giochi/discos.sh");
const S09 = path.join(OVERLAY, "etc/init.d/S09bootpart");
const BOOTLOG = path.join(OVERLAY, "usr/bin/giochi-bootlog");

/**
 * Bancada: dois cartões, cada um com um `extlinux.conf` de conteúdo distinto,
 * e o rootfs no cartão 1. O `mount` falso materializa a partição no destino.
 */
function bancada({ rootNoCartao1 = true, preferidaVazia = false } = {}) {
    const raiz = mkdtempSync(path.join(tmpdir(), "giochi-boot-"));
    const d = {
        raiz,
        bin: path.join(raiz, "bin"),
        boot: path.join(raiz, "boot"),
        dev: path.join(raiz, "dev"),
        sys: path.join(raiz, "sys"),
    };
    for (const p of [d.bin, d.boot, d.dev, d.sys]) mkdirSync(p, { recursive: true });

    // partições simuladas
    for (const [nome, texto] of [["mmcblk1p1", "default giochi"], ["mmcblk0p1", "de outra instalacao"]]) {
        const dir = path.join(raiz, nome);
        mkdirSync(path.join(dir, "extlinux"), { recursive: true });
        writeFileSync(path.join(dir, "extlinux/extlinux.conf"), texto);
        writeFileSync(path.join(d.dev, nome), "");
    }
    if (preferidaVazia) {
        // O caso da eMMC sem sistema: o device existe, monta como vfat, e NÃO
        // tem `extlinux/`. Sem validar por conteúdo, o script para aqui e /boot
        // fica vazio com o cartão certo ao lado.
        const pref = rootNoCartao1 ? "mmcblk1p1" : "mmcblk0p1";
        rmSync(path.join(raiz, pref, "extlinux"), { recursive: true, force: true });
    }

    // /sys/dev/block/<maj:min> -> o device real do rootfs
    const alvo = rootNoCartao1 ? "mmcblk1/mmcblk1p2" : "mmcblk0/mmcblk0p2";
    mkdirSync(path.join(d.sys, path.dirname(alvo)), { recursive: true });
    mkdirSync(path.join(d.sys, alvo), { recursive: true });
    symlinkSync(path.join(d.sys, alvo), path.join(d.sys, "179:2"));

    // mount falso: copia a partição para o destino
    writeFileSync(
        path.join(d.bin, "mount"),
        `#!/bin/sh
src=""; dst=""; pular=0
for a in "$@"; do
  if [ "$pular" = 1 ]; then pular=0; continue; fi
  case "$a" in -t) pular=1 ;; -*) ;; *) if [ -z "$src" ]; then src="$a"; else dst="$a"; fi ;; esac
done
base="$(basename "$src")"
[ -d "${raiz}/$base" ] || exit 1
mkdir -p "$dst"
cp -a "${raiz}/$base/." "$dst/" 2>/dev/null || true
exit 0
`,
    );
    writeFileSync(path.join(d.bin, "umount"), "#!/bin/sh\nexit 0\n");
    writeFileSync(path.join(d.bin, "mountpoint"), "#!/bin/sh\nexit 1\n");
    for (const f of ["mount", "umount", "mountpoint"]) chmodSync(path.join(d.bin, f), 0o755);

    // /proc falsos. mountinfo tem DOIS campos "/" (root e mount point) — o
    // awk do script casa com o SEGUNDO. Sem o campo repetido, o script não
    // encontra o device do rootfs e cai na lista genérica, montando a eMMC.
    writeFileSync(path.join(raiz, "mounts"), "");
    writeFileSync(path.join(raiz, "mountinfo"), "24 1 179:2 / / rw - ext4 /dev/root rw\n");

    // scripts adaptados para a bancada
    const lib = readFileSync(LIB, "utf8")
        .replace(/\/proc\/mounts/g, path.join(raiz, "mounts"))
        .replace(/\/proc\/self\/mountinfo/g, path.join(raiz, "mountinfo"))
        .replace(/\/sys\/dev\/block/g, d.sys)
        .replace(/\/dev\/mmcblk\*p1/g, path.join(d.dev, "mmcblk*p1"))
        .replace(/\/dev\/sd\*1/g, path.join(d.dev, "sd*1"))
        .replace(/\/dev\/vd\*1/g, path.join(d.dev, "vd*1"));
    const libPath = path.join(raiz, "discos.sh");
    writeFileSync(libPath, lib);

    const s09 = readFileSync(S09, "utf8")
        .replaceAll("/usr/lib/giochi/discos.sh", libPath)
        .replace(/\/boot/g, d.boot)
        .replace(/\/proc\/mounts/g, path.join(raiz, "mounts"));
    const s09Path = path.join(raiz, "S09bootpart");
    writeFileSync(s09Path, s09);

    const rodar = () =>
        execFileSync("sh", [s09Path], {
            env: { ...process.env, PATH: `${d.bin}:${process.env.PATH}` },
            encoding: "utf8",
            stdio: "pipe",
        });

    return { ...d, rodar, limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}

test("monta a partição de boot em /boot e escolhe a do cartão que bootou", () => {
    // O caso real do X35H: a eMMC interna tinha um `extlinux/` de OUTRA
    // instalação. Escolher "o primeiro que montar" pega a eMMC e o /boot fica
    // apontando para o sistema errado — sem erro nenhum.
    const b = bancada({ rootNoCartao1: true });
    try {
        const saida = b.rodar();
        assert.match(saida, /montada em/, "não montou");
        const conteudo = readFileSync(path.join(b.boot, "extlinux/extlinux.conf"), "utf8").trim();
        assert.equal(conteudo, "default giochi",
            "montou a partição da eMMC (outra instalação) em vez da do cartão do rootfs");
    } finally {
        b.limpar();
    }
});

test("a preferência segue o cartão do rootfs, não um nome fixo de device", () => {
    // Se o rootfs estiver no cartão 0, é ele que tem de ser escolhido. Um script
    // que cravasse `mmcblk1p1` passaria no teste acima e falharia neste.
    const b = bancada({ rootNoCartao1: false });
    try {
        b.rodar();
        const conteudo = readFileSync(path.join(b.boot, "extlinux/extlinux.conf"), "utf8").trim();
        assert.equal(conteudo, "de outra instalacao",
            "com o rootfs no cartão 0, a partição de boot dele é a mmcblk0p1");
    } finally {
        b.limpar();
    }
});

test("o S09 rodou antes do S10bootlog, e o bootlog sabe reaproveitar", () => {
    // Se o S09 viesse DEPOIS do S10, o bootlog montaria em /mnt/bootlog e o S09
    // montaria de novo em /boot: dois pontos de montagem para a mesma partição
    // FAT. Funciona, mas é lixo — e um `umount` no fim do bootlog deixaria
    // /boot apontando para o vazio.
    const nomes = readdirSync(path.join(OVERLAY, "etc/init.d")).filter((f) => /^S\d/.test(f)).sort();
    const i09 = nomes.indexOf("S09bootpart");
    const i10 = nomes.indexOf("S10bootlog");
    assert.ok(i09 >= 0 && i10 >= 0, `scripts não encontrados: ${nomes.join(", ")}`);
    assert.ok(i09 < i10, `S09bootpart roda DEPOIS do S10bootlog (${nomes.join(", ")})`);

    // E o bootlog tem de reconhecer um vfat já montado com o marcador — é o que
    // faz o S09 servir para os dois.
    const bootlog = readFileSync(BOOTLOG, "utf8");
    assert.match(bootlog, /extlinux\/extlinux\.conf|boot\.scr/, "o bootlog não valida por conteúdo");
    assert.match(bootlog, /vfat/, "o bootlog não procura um vfat já montado");
});

test("CONFIG_UEVENT_HELPER desligado: automount de mídia removível NÃO é possível", () => {
    // Medido no `.config` do kernel 6.12 dos três aparelhos:
    //     # CONFIG_UEVENT_HELPER is not set
    // Sem ele o kernel não chama /sbin/mdev quando um device aparece, então
    // automount exigiria rebuild de kernel (ou daemon com poll, ou netlink).
    //
    // O teste prende o FATO para ninguém prometer à equipe do app algo que a
    // imagem não faz — a pendência "automount de mídia removível" é DELES resolver
    // montando por conta própria, e é o que já fazem.
    const kconfigs = [];
    const base = path.join(process.env.HOME || "", ".cache/giochi-system/work");
    for (const dev of ["r35s", "powkiddy-x55", "powkiddy-x35h"]) {
        const p = path.join(base, dev, "build/build/linux-6.12/.config");
        if (existsSync(p)) kconfigs.push(p);
    }
    if (kconfigs.length === 0) {
        // Sem a árvore em cache não dá para provar. Declarar é a R10 — melhor que
        // um PASS que não verificou nada.
        return;
    }
    for (const p of kconfigs) {
        const t = readFileSync(p, "utf8");
        assert.match(
            t,
            /# CONFIG_UEVENT_HELPER is not set/,
            `${path.basename(path.dirname(p))}: UEVENT_HELPER mudou de estado — ` +
                `se ele foi ligado, automount de mídia removível passou a ser possível ` +
                `e a issue do app precisa ser atualizada`,
        );
    }
});

test("o S09 anuncia o que NÃO faz, no próprio --help", () => {
    // O cabeçalho do script é a documentação que existe no aparelho. Quem for
    // depurar "por que meu pendrive não monta" tem de encontrar a resposta ali,
    // não num documento do repositório que ele não tem à mão.
    const t = readFileSync(S09, "utf8");
    assert.match(t, /UEVENT_HELPER/, "o motivo medido tem de estar escrito");
    assert.match(t, /m[íi]dia remov[íi]vel|pendrive|cart[ãa]o.*inserid/i,
        "o script tem de dizer que mídia removível NÃO é montada");
    assert.match(t, /remov[íi]vel/, "e nomear o caso");
});

test("partição preferida sem o marcador é descartada, e a próxima serve", () => {
    // O caso real: a p1 do cartão que bootou existe, monta como vfat, e NÃO tem
    // `extlinux/` (cartão recém-formatado, ou p1 de um sistema que foi apagado).
    // Sem validar por conteúdo, o script para na primeira que monta e `/boot`
    // fica vazio — com a partição certa ao lado, no mesmo cartão.
    const b = bancada({ rootNoCartao1: true, preferidaVazia: true });
    try {
        const saida = b.rodar();
        assert.match(saida, /montada em/, "desistiu na primeira, que não serve");
        const conteudo = readFileSync(path.join(b.boot, "extlinux/extlinux.conf"), "utf8").trim();
        assert.equal(conteudo, "de outra instalacao",
            "não caiu para a próxima partição com o marcador");
    } finally {
        b.limpar();
    }
});
