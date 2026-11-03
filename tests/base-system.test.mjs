import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../scripts/lib/devices.mjs";

// Contrato do SISTEMA BASE (docs/sistema-base.md).
//
// A maioria dos aparelhos desta árvore não tem Wi-Fi nem Bluetooth, e console
// serial exige hardware que quase ninguém tem. Então o cabo USB é o único canal
// de acesso — e ele depende de quatro coisas estarem na imagem, em qualquer
// aparelho. Estes testes existem porque cada uma delas já faltou uma vez, e a
// falta nunca aparece como erro: aparece como "o aparelho não responde".

const OVERLAY = path.join(ROOT, "device/common/rootfs-overlay");
const BUSYBOX = path.join(ROOT, "config/common.busybox.fragment");
const COMMON = path.join(ROOT, "config/common.fragment");

const read = (p) => readFile(p, "utf8");

test("udhcpd está no fragmento comum de busybox", async () => {
  // Sem udhcpd, o PC precisa de IP estático configurado à mão em cada máquina.
  // Foi o que travou a transferência por usb0 no bring-up da X55.
  const text = await read(BUSYBOX);
  assert.match(text, /^CONFIG_UDHCPD=y$/m);
  assert.match(text, /^CONFIG_UDHCPC=y$/m);
});

test("os applets de diagnóstico do sistema base estão ligados", async () => {
  const text = await read(BUSYBOX);
  const minimo = [
    "CONFIG_NC=y", // transferir arquivo sem scp
    "CONFIG_VI=y", // corrigir arquivo que impede o boot
    "CONFIG_IFCONFIG=y",
    "CONFIG_PING=y",
    "CONFIG_DMESG=y",
    "CONFIG_TAR=y",
    "CONFIG_GZIP=y",
    "CONFIG_PS=y",
    "CONFIG_PGREP=y",
  ];
  for (const linha of minimo) {
    assert.ok(text.includes(linha), `falta ${linha} no fragmento comum de busybox`);
  }
});

test("o fragmento comum de busybox não desliga nada", async () => {
  // "# CONFIG_X is not set" é assunto do fragmento DO APARELHO, onde tem um
  // motivo (o `tc` que não compila contra o kernel 6.12). No comum, um
  // "is not set" desliga o applet em todos os aparelhos de uma vez, em silêncio.
  const text = await read(BUSYBOX);
  const desligados = text
    .split("\n")
    .filter((l) => /^#\s*CONFIG_\w+ is not set/.test(l));
  assert.deepEqual(desligados, [], `o comum desliga applet: ${desligados.join(", ")}`);
});

test("o build mescla o fragmento comum de busybox em todo aparelho", async () => {
  const script = await read(path.join(ROOT, "scripts/build-device.sh"));
  assert.match(script, /config\/common\.busybox\.fragment/);
  // A ordem importa: o fragmento do aparelho vence em conflito.
  const posComum = script.indexOf("common.busybox.fragment");
  const posAparelho = script.indexOf('BUSYBOX_FRAGMENT="$DEVICE_DIR/busybox.fragment"');
  assert.ok(posComum > 0 && posAparelho > posComum, "o comum tem de vir antes do aparelho");
});

test("o gadget USB e o init existem e são executáveis no Git", async () => {
  for (const rel of ["usr/bin/giochi-usbnet", "etc/init.d/S30usbnet"]) {
    const info = await stat(path.join(OVERLAY, rel));
    assert.ok(
      (info.mode & 0o111) !== 0,
      `${rel} sem bit de execução: o init não roda e o aparelho fica inacessível`,
    );
  }
});

test("S30usbnet sobe antes do sshd", async () => {
  // Se o sshd nascer antes da interface, ele pode subir sem socket válido.
  const usb = "S30usbnet";
  const ssh = "S50sshd"; // instalado pelo pacote openssh, não pelo overlay
  assert.ok(usb < ssh, "a ordem dos S* é a ordem de execução");
});

test("o gadget usa RNDIS por padrão, porque o Windows não tem driver de ECM", async () => {
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-usbnet"));
  // `start_gadget rndis` tem de ser o caminho sem argumento.
  assert.match(text, /"\s*\|\s*--rndis\)\s*start_gadget rndis/);
  // ECM continua alcançável.
  assert.match(text, /--ecm\)\s*start_gadget ecm/);
  assert.doesNotMatch(
    text,
    /^\s*FUNCTION=\$\{1:-ecm\}/m,
    "ECM como padrão deixa o Windows sem adaptador",
  );
});

test("o gadget configura os IDs de sistema operacional do RNDIS", async () => {
  // Sem os_desc, o Windows mostra "dispositivo desconhecido" em vez de instalar
  // o driver de rede na hora.
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-usbnet"));
  assert.match(text, /compatible_id/);
  assert.match(text, /sub_compatible_id/);
});

test("o DHCP serve exatamente um endereço ao PC", async () => {
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-usbnet"));
  assert.match(text, /max_leases\s+1/, "faixa maior aumenta a chance de IP obsoleto");
  assert.match(text, /start\s+\$HOST_ADDR/);
  assert.match(text, /end\s+\$HOST_ADDR/);
});

test("o sshd_config do overlay abre root por senha", async () => {
  // O padrão do Buildroot é prohibit-password: num aparelho novo não há chave, o
  // que torna o primeiro acesso impossível — e instalar a chave exige o acesso.
  const text = await read(path.join(OVERLAY, "etc/ssh/sshd_config"));
  assert.match(text, /^PermitRootLogin\s+yes$/m);
  assert.match(text, /^PasswordAuthentication\s+yes$/m);
});

test("o sshd_config desliga UseDNS", async () => {
  // Com UseDNS=yes (padrão) e sem DNS no link USB, CADA conexão trava até o
  // timeout. Era o "ssh demora 20 s para pedir senha".
  const text = await read(path.join(OVERLAY, "etc/ssh/sshd_config"));
  assert.match(text, /^UseDNS\s+no$/m);
});

test("o sistema base instala OpenSSH, e não dropbear", async () => {
  const comum = await read(COMMON);
  assert.match(comum, /^BR2_PACKAGE_OPENSSH=y$/m);
  // Dois servidores na porta 22: o segundo a subir falha e o sintoma é
  // "ssh às vezes não responde". Medido na imagem da X55.
  const defconfigs = ["device/powkiddy x55/defconfig", "device/powkiddy x35h/defconfig"];
  for (const rel of defconfigs) {
    const text = await read(path.join(ROOT, rel));
    assert.doesNotMatch(
      text,
      /^BR2_PACKAGE_DROPBEAR=y$/m,
      `${rel} instala dropbear junto com o openssh do sistema base`,
    );
  }
});

test("o selftest trata o usb0 como canal de acesso padrão", async () => {
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-selftest"));
  assert.match(text, /rede por USB/i, "falta o bloco de rede USB no selftest");
  assert.match(text, /usb0/);
  assert.match(text, /udhcpd/);
  assert.match(text, /sshd/);
  // O erro que já aconteceu: os dois servidores SSH na mesma imagem.
  assert.match(text, /dropbear E openssh/);
});

test("link USB desconectado não é FAIL", async () => {
  // Sem cabo, a operstate do netdev fica `down` — que é o estado correto. Marcar
  // FAIL ali produziria o vermelho permanente que esconde defeito real
  // (AGENTS §12.22).
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-selftest"));
  // Recorta o bloco do usb0 para não casar com o resto do arquivo.
  const inicio = text.indexOf("rede por USB");
  const bloco = text.slice(inicio, text.indexOf("# ── rede ──", inicio));
  assert.match(bloco, /cabo desconectado/);
  assert.doesNotMatch(bloco, /fail "usb0.*down/);
});
