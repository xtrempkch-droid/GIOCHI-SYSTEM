// A partição de dados do usuário (`/user`), em ext4, exFAT e FAT32.
//
// ## O bug que este arquivo passou a existir para impedir
//
// A primeira versão do `S20userdata` procurava `/dev/disk/by-label/GIOCHI_USER`.
// Esse diretório **não existe** nesta imagem: o Buildroot é configurado com
// `BR2_ROOTFS_DEVICE_CREATION_DYNAMIC_DEVTMPFS=y` e **nem mdev nem udev** —
// devtmpfs cria os nodes dos devices, não os symlinks por rótulo. Quem cria
// by-label é o udev.
//
// Resultado real: o script nunca achava a partição, `/user` ficava sempre no
// rootfs, e nada dizia isso.
//
// **Por que o teste antigo passava:** a bancada dele *criava* o symlink
// by-label. O mock era mais generoso que o aparelho — a mesma classe do
// `mount` falso que lia `ext4` como argumento de `-t` e "montava" um caminho
// inexistente. A ferramenta respondia, e a resposta não era lida com
// desconfiança.
//
// Agora a bancada **não cria by-label nenhum**, e um dos testes falha se o
// script voltar a depender dele.
//
// ## Como a bancada imita o aparelho
//
//   /sys/class/block/<part>/partition   ← só existe PARA PARTIÇÕES; é a
//                                          enumeração autoritativa, sem
//                                          adivinhar `sda1` vs `mmcblk0p1`
//   /dev/<part>                         ← arquivo com o magic do filesystem
//                                          nos offsets que o script lê
//   mount falso                         ← mapeia device -> diretório de
//                                          conteúdo, e registra a chamada
//
// Nada aqui precisa de root, loop device ou kernel.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync,
    rmSync, statSync, cpSync, openSync, writeSync, closeSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

const SCRIPT = path.join(ROOT, "device/common/rootfs-overlay/etc/init.d/S20userdata");

/** Só o CÓDIGO: sem linhas que começam com `#`. Comparar posições no texto
 *  inteiro acha a menção em comentário e dá falso positivo. */
function semComentarios(texto) {
    return texto
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
}

/** A linha de mount DO DEVICE DE DADOS.
 *
 *  Procurar `fmask` no log inteiro dá falso positivo: o script tenta a p1
 *  (vfat, com fmask) antes da p3, e essa linha fica registrada. Foi assim que
 *  a mutação "exFAT sem fmask" passou sem ser pega. */
function linhaDoDados(log, nome) {
    return log.split("\n").find((l) => l.includes(nome) && /^mount /.test(l)) || "";
}

/** Escreve o magic do filesystem no arquivo que imita o device. */
function gravarMagic(arquivo, tipo) {
    const buf = Buffer.alloc(2048);
    if (tipo === "ext4") {
        buf[1080] = 0x53;
        buf[1081] = 0xef;
    } else if (tipo === "exfat") {
        buf.write("EXFAT", 3, "latin1");
    } else if (tipo === "vfat") {
        buf.write("FAT32", 82, "latin1");
    }
    writeFileSync(arquivo, buf);
}

function bancada(o = {}) {
    const {
        tipo = "ext4",
        conteudoRootfs = null,
        conteudoDados = null,
        jaMontado = false,
        segundoCartao = false,
        segundoComMarcador = false,
    } = o;

    const raiz = mkdtempSync(path.join(tmpdir(), "giochi-ud-"));
    const d = {
        raiz,
        bin: path.join(raiz, "bin"),
        dev: path.join(raiz, "dev"),
        user: path.join(raiz, "user"),
        run: path.join(raiz, "run/giochi"),
        sysClassBlk: path.join(raiz, "sys/class/block"),
        sysDevBlk: path.join(raiz, "sys/dev/block"),
    };
    for (const p of [d.bin, d.dev, d.user, d.run, d.sysClassBlk, d.sysDevBlk]) {
        mkdirSync(p, { recursive: true });
    }

    const povoar = (dir, obj) => {
        if (!obj) return;
        for (const [nome, txt] of Object.entries(obj)) {
            mkdirSync(path.join(dir, path.dirname(nome)), { recursive: true });
            writeFileSync(path.join(dir, nome), txt);
        }
    };
    povoar(d.user, conteudoRootfs);

    const criarParticao = (nome, fs, conteudo) => {
        mkdirSync(path.join(d.sysClassBlk, nome), { recursive: true });
        writeFileSync(path.join(d.sysClassBlk, nome, "partition"), "1\n");
        gravarMagic(path.join(d.dev, nome), fs);
        const dir = path.join(raiz, "conteudo", nome);
        mkdirSync(dir, { recursive: true });
        povoar(dir, conteudo);
    };
    criarParticao("mmcblk1p1", "vfat", null);   // boot
    criarParticao("mmcblk1p2", "ext4", null);   // rootfs
    criarParticao("mmcblk1p3", tipo, conteudoDados); // dados
    criarParticao("mmcblk0p1", "vfat", null);   // eMMC interna, não é a nossa
    if (segundoCartao) {
        criarParticao("mmcblk2p1", tipo, segundoComMarcador ? { "giochi-user/.keep": "" } : null);
    }

    // /sys/dev/block/<maj:min> -> rootfs em mmcblk1p2
    mkdirSync(path.join(d.sysDevBlk, "mmcblk1/mmcblk1p2"), { recursive: true });
    symlinkSync(path.join(d.sysDevBlk, "mmcblk1/mmcblk1p2"), path.join(d.sysDevBlk, "179:2"));

    // ── mount falso ──
    const registro = path.join(raiz, "chamadas.log");
    writeFileSync(registro, "");
    writeFileSync(
        path.join(d.bin, "mount"),
        `#!/bin/sh
echo "mount $*" >> "${registro}"
src=""; dst=""; pular=0; leropts=0
for a in "$@"; do
  if [ "$pular" = 1 ]; then pular=0; continue; fi
  if [ "$leropts" = 1 ]; then leropts=0; continue; fi
  case "$a" in
    -t) pular=1 ;;
    -o) leropts=1 ;;
    -*) ;;
    *) if [ -z "$src" ]; then src="$a"; else dst="$a"; fi ;;
  esac
done
[ -n "$src" ] && [ -n "$dst" ] || exit 1
base="$(basename "$src")"
origem="${raiz}/conteudo/$base"
[ -d "$origem" ] || exit 1
rm -rf "$dst"/* "$dst"/.[!.]* 2>/dev/null
mkdir -p "$dst"
cp -r "$origem/." "$dst/" 2>/dev/null
exit 0
`,
    );
    writeFileSync(path.join(d.bin, "umount"), `#!/bin/sh\necho "umount $*" >> "${registro}"\nexit 0\n`);
    writeFileSync(path.join(d.bin, "mountpoint"), `#!/bin/sh\n${jaMontado ? "exit 0" : "exit 1"}\n`);
    writeFileSync(path.join(d.bin, "df"), `#!/bin/sh\necho "Filesystem Size Used Free"\necho "/dev/x 1G 1M 1G"\n`);
    for (const f of ["mount", "umount", "mountpoint", "df"]) chmodSync(path.join(d.bin, f), 0o755);

    writeFileSync(
        path.join(raiz, "mounts"),
        jaMontado ? `tmpfs / tmpfs rw 0 0\n/dev/mmcblk1p3 ${d.user} ext4 rw 0 0\n` : "tmpfs / tmpfs rw 0 0\n",
    );
    writeFileSync(path.join(raiz, "mountinfo"), "24 1 179:2 / / rw - ext4 /dev/root rw\n");

    if (jaMontado) {
        cpSync(path.join(raiz, "conteudo/mmcblk1p3"), d.user, { recursive: true });
    }

    const fonte = readFileSync(SCRIPT, "utf8")
        .replace(/^MNT=\/user$/m, `MNT=${d.user}`)
        .replace(/\/run\/giochi/g, d.run)
        .replace(/\/sys\/class\/block/g, d.sysClassBlk)
        .replace(/\/sys\/dev\/block/g, d.sysDevBlk)
        .replace(/\/dev\/\$_nome/g, `${d.dev}/$_nome`)
        .replace(/\/proc\/self\/mountinfo/g, path.join(raiz, "mountinfo"))
        .replace(/\/proc\/mounts/g, path.join(raiz, "mounts"));
    const script = path.join(raiz, "S20userdata");
    writeFileSync(script, fonte);
    chmodSync(script, 0o755);

    // O mount falso copia o conteúdo, então o "device" de dados tem de refletir
    // o que o script escreveu: sincroniza de volta SÓ quando houve mount.
    const rodar = () => {
        const saida = execFileSync("sh", [script], {
            env: { ...process.env, PATH: `${d.bin}:${process.env.PATH}` },
            encoding: "utf8",
            stdio: "pipe",
        });
        return saida;
    };

    return {
        ...d,
        registro,
        rodar,
        chamadas: () => readFileSync(registro, "utf8"),
        limpar: () => rmSync(raiz, { recursive: true, force: true }),
    };
}

test("acha a p3 do cartão do rootfs SEM /dev/disk/by-label (o bug de 27/11)", () => {
    // O diretório by-label não existe no aparelho (devtmpfs sem mdev/udev). A
    // descoberta agora é por LAYOUT: p3 do cartão do rootfs.
    const b = bancada({ tipo: "ext4", conteudoRootfs: { "musica/faixa.mp3": "MUSICA" } });
    try {
        const saida = b.rodar();
        assert.match(saida, /montada em/, `não montou: ${saida}`);
        assert.match(saida, /layout/, "não identificou por layout");
        assert.ok(existsSync(path.join(b.user, "musica/faixa.mp3")),
            "o conteúdo do /user do rootfs não foi migrado");
    } finally {
        b.limpar();
    }
});

test("o script NÃO pode voltar a depender de by-label", () => {
    const fonte = readFileSync(SCRIPT, "utf8");
    assert.match(fonte, /layout/i, "o critério de layout sumiu");
    assert.match(fonte, /\/sys\/class\/block\/\*\/partition/,
        "a enumeração por /sys/class/block/*/partition sumiu — é ela que não depende de symlink");

    // Comparar no CÓDIGO, não nos comentários: o cabeçalho do script cita
    // `/dev/disk/by-label` justamente para explicar por que não se usa.
    const codigo = semComentarios(fonte);
    const iByLabel = codigo.indexOf("/dev/disk/by-label");
    const iLayout = codigo.indexOf("/sys/class/block/*/partition");
    assert.ok(iByLabel === -1 || (iLayout !== -1 && iLayout < iByLabel),
        "by-label aparece no código antes da enumeração por sysfs — voltou a ser a fonte primária");
});

test("exFAT monta com fmask=0000 — sem isso o port não roda", () => {
    const b = bancada({ tipo: "exfat" });
    try {
        const saida = b.rodar();
        assert.match(saida, /exfat/, `não detectou exFAT: ${saida}`);
        const linha = linhaDoDados(b.chamadas(), "mmcblk1p3");
        assert.ok(linha, `nenhuma linha de mount da p3:\n${b.chamadas()}`);
        assert.match(linha, /-t exfat/, "não montou como exfat");
        assert.match(linha, /fmask=0000/, "exFAT sem fmask=0000: nada é executável");
        assert.match(linha, /dmask=0000/, "diretório também precisa de 0777");
        assert.match(linha, /uid=0,gid=0/, "sem uid/gid o dono fica indefinido");
        assert.match(linha, /iocharset=utf8/, "sem utf8, nome com acento quebra");
    } finally {
        b.limpar();
    }
});

test("FAT32 monta com o mesmo tratamento, e com code page", () => {
    const b = bancada({ tipo: "vfat" });
    try {
        b.rodar();
        const linha = linhaDoDados(b.chamadas(), "mmcblk1p3");
        assert.ok(linha, "nenhuma linha de mount da p3");
        assert.match(linha, /-t vfat/, "não montou como vfat");
        assert.match(linha, /fmask=0000/, "FAT também não guarda permissão");
        assert.match(linha, /codepage=437/, "FAT32 precisa de code page para nome curto");
    } finally {
        b.limpar();
    }
});

test("ext4 continua montando sem opção de permissão", () => {
    const b = bancada({ tipo: "ext4" });
    try {
        b.rodar();
        const log = b.chamadas();
        assert.match(log, /-t ext4/, "não montou como ext4");
        // Olhar a LINHA do device de dados: o log inteiro inclui a tentativa na
        // p1 (vfat, com fmask), e `doesNotMatch(/fmask/)` acusaria falso
        // positivo — o defeito oposto do que se quer pegar.
        const linha = linhaDoDados(log, "mmcblk1p3");
        assert.ok(linha, `não há linha de mount da p3 em ext4 no log:\n${log}`);
        assert.doesNotMatch(linha, /fmask/, "fmask em ext4 dá EINVAL e a p3 não monta");
        assert.doesNotMatch(linha, /dmask/, "dmask em ext4 idem");
    } finally {
        b.limpar();
    }
});

test("migrar para exFAT usa cp -r, não cp -a (não há o que preservar)", () => {
    const b = bancada({ tipo: "exfat", conteudoRootfs: { "LEIA-ME.txt": "LEIAME" } });
    try {
        b.rodar();
        assert.equal(readFileSync(path.join(b.user, "LEIA-ME.txt"), "utf8"), "LEIAME",
            "a migração para exFAT não copiou");
        // E o script tem de usar `cp -r` no ramo de exFAT/fat.
        const fonte = readFileSync(SCRIPT, "utf8");
        assert.match(fonte, /exfat\|vfat\)\s*cp -r/,
            "o ramo de exFAT/FAT tem de usar cp -r: cp -a tenta preservar dono e permissão, " +
                "que não existem lá, e o busybox cp pode abortar no meio");
    } finally {
        b.limpar();
    }
});

test("partição que JÁ tem conteúdo não é tocada — save de jogo não se sobrescreve", () => {
    const b = bancada({
        tipo: "ext4",
        conteudoRootfs: { "LEIA-ME.txt": "LEIAME" },
        conteudoDados: { "games/save-do-jogo.sav": "SAVE" },
    });
    try {
        const saida = b.rodar();
        assert.equal(readFileSync(path.join(b.user, "games/save-do-jogo.sav"), "utf8"), "SAVE",
            "o save foi sobrescrito ou apagado");
        assert.ok(!existsSync(path.join(b.user, "LEIA-ME.txt")),
            "migrou por cima de uma partição que já tinha conteúdo");
        assert.match(saida, /já tem conteúdo|não mexo/i, "tem de dizer que não mexeu");
    } finally {
        b.limpar();
    }
});

test("segundo cartão só é aceito com o marcador giochi-user", () => {
    const sem = bancada({ tipo: "exfat", segundoCartao: true, segundoComMarcador: false });
    try {
        const saida = sem.rodar();
        assert.doesNotMatch(saida, /mmcblk2p1/, "aceitou um segundo cartão SEM marcador");
    } finally {
        sem.limpar();
    }
});

test("/user já montado não é remontado nem desmontado", () => {
    const b = bancada({ tipo: "ext4", jaMontado: true });
    try {
        const saida = b.rodar();
        assert.match(saida, /já está montado/i);
        const log = b.chamadas();
        assert.doesNotMatch(log, /^mount /m, "não pode chamar mount");
        assert.doesNotMatch(log, /umount/, "não pode desmontar o que não montou");
    } finally {
        b.limpar();
    }
});

test("a espera pela partição continua curta (ou não existe mais)", () => {
    const fonte = readFileSync(SCRIPT, "utf8");
    const m = fonte.match(/while \[ "\$tentativa" -lt (\d+) \]/);
    if (m) {
        assert.ok(Number(m[1]) <= 5,
            `o laço tenta ${m[1]} vezes: medido, 10 tentativas davam 10,0 s de boot a mais`);
    }
});

test("o script é executável e está no overlay comum", () => {
    const st = statSync(SCRIPT);
    assert.ok(st.mode & 0o111, "S20userdata sem +x: o rcS não o executa (§12.50)");
    assert.ok(SCRIPT.includes(path.join("device", "common", "rootfs-overlay")),
        "tem de estar no overlay COMUM, não no de um aparelho");
});

test("o make-sd-image gera p3 em exFAT, vfat e ext4", () => {
    const sd = readFileSync(path.join(ROOT, "scripts/make-sd-image.sh"), "utf8");
    assert.match(sd, /--user-fs/, "falta a opção");
    assert.match(sd, /mkfs\.exfat/, "falta o mkfs de exFAT");
    assert.match(sd, /mkfs\.vfat -F 32 -n GIOCHI_USER/, "falta o mkfs de FAT32 para a p3");
    assert.equal("GIOCHI_USER".length, 11, "o rótulo tem de caber nos 11 do FAT");
    // exFAT é o padrão: é o que resolve o caso do usuário no Windows.
    assert.match(sd, /^USER_FS=exfat$/m, "exFAT tem de ser o padrão");
});

test("o kernel tem exFAT e UTF-8 nos três aparelhos, e o gate cobra", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const pasta of ["powkiddy x55", "powkiddy x35h", "r35s"]) {
        const frag = await readFile(path.join(ROOT, "device", pasta, "linux.fragment"), "utf8");
        assert.match(frag, /^CONFIG_EXFAT_FS=y$/m, `${pasta}: falta CONFIG_EXFAT_FS=y`);
        assert.match(frag, /^CONFIG_NLS_UTF8=y$/m, `${pasta}: falta CONFIG_NLS_UTF8=y`);
        assert.doesNotMatch(frag, /^CONFIG_EXFAT_FS=m$/m,
            `${pasta}: =m não monta no boot — não há autoload (§12.43)`);

        const req = await readFile(path.join(ROOT, "device", pasta, "kernel-required.txt"), "utf8");
        for (const s of ["CONFIG_EXFAT_FS", "CONFIG_NLS_UTF8"]) {
            assert.match(req, new RegExp(`^${s}$`, "m"),
                `${pasta}: ${s} não está no kernel-required — o fragmento é delta, ` +
                    `e sem o gate ele pode sumir em silêncio (§12.9)`);
        }
    }
});

test("nenhum script depende de /dev/disk/by-label existir", () => {
    // O symlink por rótulo é criado pelo udev; esta imagem é devtmpfs puro.
    const arquivos = [
        "device/common/rootfs-overlay/etc/init.d/S20userdata",
        "device/common/rootfs-overlay/etc/init.d/S09bootpart",
        "device/common/rootfs-overlay/usr/lib/giochi/discos.sh",
    ];
    for (const rel of arquivos) {
        const codigo = semComentarios(readFileSync(path.join(ROOT, rel), "utf8"));
        const iLabel = codigo.indexOf("/dev/disk/by-label");
        if (iLabel === -1) continue;
        const iDescoberta = codigo.search(/\/sys\/class\/block|extlinux\/extlinux\.conf/);
        assert.ok(iDescoberta !== -1 && iDescoberta < iLabel,
            `${path.basename(rel)}: by-label antes da descoberta por sysfs/conteúdo`);
    }
});
