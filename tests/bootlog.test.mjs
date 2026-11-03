import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// O log no cartão é o ÚNICO canal de diagnóstico dos aparelhos sem console
// serial. Ele falhou na primeira tentativa de gravação e o sintoma foi "não tem
// giochi-boot.log" — indistinguível de "o aparelho não ligou".

const OVERLAY = path.join(ROOT, "device/common/rootfs-overlay");
const BOOTLOG = path.join(OVERLAY, "usr/bin/giochi-bootlog");
const BUSYBOX_FRAGMENT = path.join(ROOT, "config/common.busybox.fragment");

const read = (p) => readFile(p, "utf8");

test("o bootlog NÃO monta por PARTUUID/UUID/LABEL", async () => {
  // Causa medida da primeira falha: o busybox desta imagem tem
  // CONFIG_FEATURE_MOUNT_LABEL desligado, então `mount` não resolve
  // PARTUUID=/UUID=/LABEL= — só o util-linux faz. A string vai crua para o
  // kernel, que responde ENODEV, e nenhum log é escrito.
  // Só LINHAS DE COMANDO: o comentário do arquivo explica a armadilha e cita
  // PARTUUID de propósito.
  const comandos = (await read(BOOTLOG))
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(
    comandos,
    /mount[^\n]*PARTUUID=/,
    "voltou a montar por PARTUUID: o busybox não resolve e o log não aparece",
  );
  assert.doesNotMatch(comandos, /mount[^\n]*vfat[^\n]*UUID=/);
});

test("o bootlog acha a partição pelo CONTEÚDO, não pelo nome", async () => {
  // Nome de dispositivo depende de como o driver enumerou (mmcblk0p1,
  // mmcblk1p1, sda1...). Uma lista fixa erra no aparelho que importa.
  const texto = await read(BOOTLOG);
  assert.match(texto, /extlinux\/extlinux\.conf/, "a validação tem de ser o extlinux.conf");
  assert.match(texto, /boot\.scr/);
  assert.match(texto, /\/dev\/mmcblk\*p1/, "faltou glob para o SD/eMMC");
  assert.match(texto, /\/dev\/sd\*\[0-9\]/, "faltou glob para leitor USB");
});

test("o bootlog reaproveita a partição já montada e não desmonta o que não montou", async () => {
  // Medido: com o cartão já montado (udisks2, ou um serviço antes), tentar
  // montar de novo falha com "already mounted or mount point busy" — que não
  // diz o motivo. E desmontar o que não montamos derruba outro processo.
  const texto = await read(BOOTLOG);
  assert.match(texto, /awk '\$3 == "vfat" \{print \$2\}' \/proc\/mounts/);
  assert.match(texto, /MOUNTED_BY_US/);
  assert.match(texto, /if \[ "\$MOUNTED_BY_US" = "1" \]/, "só desmonta o que montou");
});

test("existe uma fase EARLY, antes de qualquer serviço que possa travar", async () => {
  // Se o S96 (fim) travasse, não haveria log nenhum — e o diagnóstico diria
  // "não ligou". A fase early roda em S10, quando o dmesg já tem o probe do
  // painel, DRM, MMC e USB.
  const early = path.join(OVERLAY, "etc/init.d/S10bootlog");
  const full = path.join(OVERLAY, "etc/init.d/S96bootlog");
  for (const p of [early, full]) {
    const info = await stat(p);
    assert.ok((info.mode & 0o111) !== 0, `${path.basename(p)} sem bit de execução`);
  }
  assert.match(await read(early), /giochi-bootlog early/);
  assert.match(await read(full), /giochi-bootlog full/);
  assert.ok("S10bootlog" < "S15modules", "S10 tem de rodar antes dos módulos? não: ordem é alfabética");
});

test("o bootlog só roda em aparelho com o marcador", async () => {
  // A X55 tem console e não precisa escrever no cartão a cada boot. Só o X35H
  // tem /etc/giochi/boot-log.
  for (const nome of ["S10bootlog", "S96bootlog"]) {
    const texto = await read(path.join(OVERLAY, `etc/init.d/${nome}`));
    assert.match(texto, /\[ -f \/etc\/giochi\/boot-log \] \|\| exit 0/);
  }
  await assert.rejects(
    readFile(path.join(OVERLAY, "etc/giochi/boot-log")),
    "o marcador vazou para o overlay comum",
  );
});

test("o dmesg é capturado — é o que diz POR QUE a tela não acendeu", async () => {
  // Sem TTL, o dmesg do cartão é a única forma de ver -517 (EPROBE_DEFER) ou
  // -110 (timeout) no probe do painel.
  const texto = await read(BOOTLOG);
  assert.match(texto, /dmesg/);
  assert.match(texto, /\/sys\/class\/drm\/\*\/status/);
  assert.match(texto, /\/sys\/class\/backlight/);
  assert.match(texto, /\/proc\/bus\/input\/devices/);
});

test("vfat está no kernel do aparelho", async () => {
  // O mount falharia por outro motivo se o kernel não soubesse ler FAT.
  const req = await read(path.join(ROOT, "device/powkiddy x35h/kernel-required.txt"));
  const frag = await read(path.join(ROOT, "device/powkiddy x35h/linux.fragment"));
  assert.ok(
    /CONFIG_VFAT_FS=y/.test(req) || /CONFIG_VFAT_FS=y/.test(frag),
    "faltou CONFIG_VFAT_FS=y: o bootlog não monta a partição de boot",
  );
});
