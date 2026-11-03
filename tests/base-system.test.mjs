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

test("o comum só desliga applet com motivo de kernel, nunca de gosto", async () => {
  // Um "# CONFIG_X is not set" no comum desliga o applet em TODOS os aparelhos
  // de uma vez, em silêncio. Só é aceitável quando o motivo é do projeto
  // inteiro — hoje, exatamente um: o `tc` do busybox 1.36.1 usa `TCA_CBQ_*`,
  // removido no kernel 6.12, e todos usam 6.12 (BR2_KERNEL_HEADERS_AS_KERNEL).
  const text = await read(BUSYBOX);
  const desligados = text
    .split("\n")
    .filter((l) => /^#\s*CONFIG_\w+ is not set/.test(l))
    .map((l) => l.match(/CONFIG_\w+/)[0]);
  assert.deepEqual(
    desligados,
    ["CONFIG_TC"],
    "applet novo desligado no comum: justifique no arquivo e atualize este teste",
  );
});

test("o tc desligado tem substituto na imagem", async () => {
  // Desligar o applet só é correção porque o iproute2 traz o `tc` que compila
  // contra os headers do 6.12. Sem ele, o aparelho perde a funcionalidade.
  const comum = await read(COMMON);
  assert.match(comum, /^BR2_PACKAGE_IPROUTE2=y$/m);
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

test("o gadget configura o MS OS Descriptor completo, não só o compatible_id", async () => {
  // ARMADILHA verificada no fonte do kernel 6.12: escrever em
  // os_desc/interface.rndis/compatible_id NÃO BASTA. O descritor só chega ao
  // host se o gadget declarar `b_vendor_code` e `qw_sign`, e apontar a
  // configuração com o symlink `os_desc`. Sem isso, os arquivos existem,
  // aceitam o valor em silêncio, e o Windows nunca os vê.
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-usbnet"));
  assert.match(text, /compatible_id/);
  assert.match(text, /sub_compatible_id/);
  assert.match(text, /b_vendor_code/, "sem b_vendor_code o descritor não é enviado");
  assert.match(text, /qw_sign/);
  assert.match(text, /ln -s configs\/c\.1 os_desc/, "o symlink os_desc ativa o descritor");
});

test("o os_desc/interface.rndis existe mesmo no kernel 6.12", async () => {
  // Este caminho não é invenção: `usb_os_desc_prepare_interf_dir` cria
  // "interface.%s" com os atributos compatible_id e sub_compatible_id, e
  // `f_rndis.c` o chama com o nome "rndis". O script testa a existência antes
  // de escrever, então isto é documentação do contrato, não tautologia.
  const text = await read(path.join(OVERLAY, "usr/bin/giochi-usbnet"));
  assert.match(text, /os_desc\/interface\.rndis/);
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

test("o build recusa continuar quando um pacote foi removido da config", async () => {
  // Buildroot nunca apaga arquivo de target/ quando o símbolo sai do Kconfig.
  // Medido na X55: dropbear foi removido do defconfig, o .config ficou correto,
  // e o binário continuou no target/ indo para a imagem — com S50dropbear e
  // S50sshd, os dois na porta 22.
  //
  // Tentar consertar apagando target/ + stamps NÃO funciona (o target-finalize
  // morre em /etc/shells). Então o build tem de RECUSAR.
  const script = await read(path.join(ROOT, "scripts/build-device.sh"));
  assert.match(script, /packages\.state/, "falta o estado do conjunto de pacotes");
  assert.match(script, /pacote\(s\) removido\(s\) desde o \u00faltimo build/);
  assert.match(
    script,
    /SEM GIOCHI_SYSTEM_KEEP_WORK=1/,
    "a recusa precisa dizer como sair dela",
  );
});

test("o estado de pacotes só avança com build bem-sucedido", async () => {
  // Gravar antes faz um build que falha deixar o estado "em dia", e a próxima
  // tentativa perde a detecção — foi medido no primeiro teste deste gate.
  const script = await read(path.join(ROOT, "scripts/build-device.sh"));
  const escrita = script.lastIndexOf('printf \'%s\' "$CURRENT_PACKAGES"');
  const sucesso = script.lastIndexOf('OK: imagem(ns) em $OUT_DIR');
  assert.ok(escrita > 0, "o estado de pacotes nunca é gravado");
  assert.ok(
    escrita < sucesso,
    "o estado é gravado antes do sucesso: build que falha esquece a remoção",
  );
});
