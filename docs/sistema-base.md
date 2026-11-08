# O sistema base — o que todo aparelho tem, e por quê

Esta página define o **contrato do sistema base**: o conjunto mínimo de software
que qualquer imagem do Giochi System entrega, independente de SoC, painel ou
rádio. Não é uma lista de desejos — é o que dá para garantir que existe, porque
cada item abaixo foi escolhido por **resolver um problema de acesso ou de
diagnóstico** que já custou tempo neste projeto.

## O princípio: acesso antes de interface

Um aparelho que não responde não pode ser consertado. E os aparelhos desta
árvore têm um problema de acesso estrutural:

| Canal | Serve para quantos aparelhos |
| --- | --- |
| Wi-Fi | só a X55 tem rádio |
| Bluetooth | só a X55; e BT não é canal de shell |
| Console serial (TTL) | tecnicamente todos — mas **exige adaptador, solda ou carcaça aberta** |
| Cabo USB | **todos**, e é o mesmo cabo que carrega |

Ou seja: se o sistema base não oferece shell por USB, a maioria dos aparelhos só
é acessível abrindo o plástico. Por isso o SSH sobre o cabo USB é **padrão e
obrigatório**, não um extra do aparelho que tem rádio.

Consequência de projeto: **tudo o que é necessário para esse canal mora no
overlay comum** (`device/common/rootfs-overlay`), não no overlay do aparelho.

## O que está garantido

### 1. Rede por cabo USB — `S30usbnet` + `giochi-usbnet`

O aparelho sobe um gadget USB e atende em **`10.55.0.2`**. O PC recebe
`10.55.0.1` por DHCP, sem configuração.

| Peça | Arquivo |
| --- | --- |
| Script do gadget | `/usr/bin/giochi-usbnet` |
| Init | `/etc/init.d/S30usbnet` |
| Config do DHCP | `/etc/udhcpd.conf` (gerado) |
| Applet `udhcpd` | `config/common.busybox.fragment` |

**RNDIS, não ECM.** ECM é o padrão tecnicamente correto e foi o que se tentou no
bring-up da X55 — e o resultado foi "o PC cria a interface e não faz nada com
ela". O **Windows não tem driver de ECM**. RNDIS o Windows reconhece sozinho.
Linux também fala RNDIS, então RNDIS é o padrão e ECM é a alternativa
(`giochi-usbnet --ecm`, para macOS/ChromeOS).

```text
PC (Windows/Linux/macOS)          aparelho
   10.55.0.1           ←USB→       10.55.0.2
   pega IP por DHCP                udhcpd serve o IP
   ssh root@10.55.0.2              sshd atende na 22
```

### 2-A. Dois aparelhos no mesmo PC: IP e MAC fixos não distinguem

O `giochi-usbnet` usa **um endereço e um MAC fixos** em todo aparelho
(`DEV_MAC=02:47:49:4f:43:49`, `HOST_MAC=…:48`, aparelho sempre em `10.55.0.2`).
Com dois handhelds plugados ao mesmo tempo, os dois respondem a `10.55.0.2` e
apresentam o **mesmo MAC** — não há como perguntar "quero o outro" por IP nem por
MAC. Medido em 08/11/2026, com R35S e X55 ligados juntos:

```text
$ ip -brief addr | grep 10.55
enx0247494f4348  UNKNOWN  10.55.0.1/24     ← X55   (usb 2-2, serial giochi-system-x55-)
usb0             UNKNOWN  10.55.0.1/24     ← R35S  (usb 2-9, serial giochi-system-r35s-)
$ ip neigh show dev usb0
10.55.0.2 lladdr 02:47:49:4f:43:49 REACHABLE     ← mesmo MAC nos dois
```

`ssh -o BindInterface=usb0` **não resolve**: o tráfego continuou saindo pela
interface do primeiro aparelho (conferido em `/sys/class/net/*/statistics`, que
não se moveu na `usb0`). O que funciona é `SO_BINDTODEVICE`, que é o que o
`ping -I` usa e que neste kernel **não exige root**:

```bash
ssh -o "ProxyCommand=python3 scripts/ssh-por-iface.py --iface usb0 %h %p" root@10.55.0.2
bash scripts/gpu-bench.sh r35s --run --iface usb0      # já monta o ProxyCommand
```

O `scripts/ssh-por-iface.py` existe para isso. Quem identifica o aparelho é o
**serial USB** (`/sys/bus/usb/devices/*/serial`, gravado pelo próprio hostname),
não o endereço.

**Por que não "consertar" o MAC por aparelho:** o MAC do gadget sai no descritor
USB antes de o userspace configurar qualquer coisa, e derivá-lo do serial exigiria
que o `giochi-usbnet` soubesse o serial (que ele tem, mas o endereço não pode
variar sem que o PC perca o DHCP previsível). A decisão de manter fixo é
deliberada — o preço é este, e a solução é escolher a interface.

### 2. SSH — OpenSSH, e só ele

| Item | Valor |
| --- | --- |
| Pacote | `BR2_PACKAGE_OPENSSH` (em `config/common.fragment`) |
| Servidor | `/usr/sbin/sshd`, init `/etc/init.d/S50sshd` |
| Config | `/etc/ssh/sshd_config` — **substituído pelo overlay** |

O `sshd_config` é reescrito de propósito. O padrão do Buildroot tem dois furos
que quebram exatamente o caso de uso deste projeto:

| Falta | Padrão do Buildroot | Efeito real |
| --- | --- | --- |
| `PermitRootLogin` | `prohibit-password` (só chave) | Num aparelho novo não há chave; e instalar a chave exige o acesso que falta. **O primeiro acesso não acontece.** |
| `UseDNS` | `yes` | O sshd tenta resolver o IP do cliente ao contrário. No link USB não há DNS → **cada conexão trava até o timeout** ("ssh demora 20 s para pedir senha"). |

Por isso: `PermitRootLogin yes`, `PasswordAuthentication yes`, `UseDNS no`.

**Trade-off assumido.** Senha de root habilitada é mais fraco que só chave. É
aceitável porque o link é um cabo USB ponto a ponto, não uma rede, e a senha é
definida no build (`ROOT_PASSWORD`; sem ela, `giochi-dev`) — o build **falha** se
a senha ou chaves de host vazarem para dentro de `target/`. Para produção:
instalar a chave e trocar para `prohibit-password`.

**Dropbear saiu.** Os dois juntos instalam `S50dropbear` E `S50sshd`, e ambos
tentam a porta 22: o segundo a subir falha, e o sintoma é "ssh às vezes não
responde". Medido na imagem da X55: os dois binários estavam no rootfs. Ficou o
OpenSSH porque o `scp` do OpenSSH 9+ usa SFTP por padrão, e o dropbear não tem
`sftp-server` — então `scp` e WinSCP contra dropbear falham com
`subsystem request failed`, e não há como copiar arquivo.

### 3. Diagnosticar sem console

| Ferramenta | Por que |
| --- | --- |
| `dmesg` | o `-517`/`-110` que explica tela preta e rádio mudo |
| `dmesg -c`/`klogd` | log que sobrevive ao boot |
| `evtest` | base do `giochi-buttons`; sem ele não se prova código evdev |
| `strace` | o processo que trava antes de logar |
| `nc` | transferir arquivo sem scp: `nc -l -p 5556 > f` |
| `vi` | corrigir um arquivo que impede o boot, pelo console |
| `ip`, `ifconfig`, `route`, `netstat`, `ping`, `wget` | rede |
| `top`, `free`, `uptime`, `ps`, `iostat` | pressão de memória, processo zumbi |
| `hexdump`, `strings` | inspecionar blob de firmware |
| `tar`, `gzip`, `xz`, `unzip` | empacotar sem depender de host |
| `giochi-selftest` | o veredito resumido (PASS/WARN/FAIL/SKIP) |
| `giochi-buttons` | botões e eixos, com nome lógico do `buttons.map` |
| `giochi-usbnet --status` | **por que** o PC não vê o aparelho |

### 4. Log no cartão, quando nem a tela funciona

`S96bootlog` grava `giochi-boot.log` na partição FAT do cartão. Roda só quando o
aparelho tem o marcador `/etc/giochi/boot-log` — usado nos aparelhos sem console
exposto (X35H). Ver [`x35h-bringup.md`](x35h-bringup.md).

### 5. A hora sobrevive ao desligamento

`S50hwclock` grava a hora do sistema no RTC no `stop` do `rcK`, e o kernel a lê
de volta no boot seguinte (`CONFIG_RTC_HCTOSYS=y`).

Nos três aparelhos desta árvore o RTC existe e persiste — medido no R35S:
`rk808-rtc`, `/dev/rtc0`, `hwclock -w` sobrevivendo a reboot. O que faltava era o
caminho de volta: ninguém gravava, então o próximo boot voltava para a data de
fábrica.

Se o ano do sistema for **anterior ao ano de construção da imagem**, o script se
recusa a gravar. Um relógio de 1970 no RTC é pior que um relógio perdido: o
aparelho nasce em 1970 para sempre, e nenhum piso de tempo (nem o do catálogo
assinado da loja) corrige para trás. O piso vem de `/etc/giochi/build-info.txt`,
gravado pelo build — não de constante escrita à mão que envelhece.

O `giochi-selftest` reporta o resultado na seção `energia`:

```text
[PASS] relógio: 2026-11-06 17:04 · RTC rk808-rtc
[WARN] relógio em 1970, antes de 2026 — RTC rk808-rtc existe mas o sistema nasceu com data errada
       não é falta de RTC: ninguém acertou o relógio ainda (S50hwclock grava no desligamento)
```

A distinção importa: as duas linhas são `WARN`, e a mensagem é o que evita trocar
hardware por causa de um relógio que ninguém acertou.

**O que o sistema não faz:** descobrir a hora certa sozinho. Sem rede não há
NTP; o RTC precisa de alguém dizer a hora ao menos uma vez (UI, catálogo
assinado, ou `hwclock --set` por SSH). Depois disso, ele mantém.

## A camada de boot: quem chama o `giochi-init`

O `giochi-init` mantém o launcher vivo. `respawn` tem dois motivos, e nenhum
depende de o launcher fazer `exec` (ele **não** faz hoje: o único uso de processo
é `fork`+`wait` em `poweroff`/`reboot`; o `exec` é decisão do app para quando o
lançamento de jogos entrar):

1. recupera o launcher se ele morrer;
2. é pré-requisito do `exec` futuro, para não haver dois processos disputando o
   DRM master.

Ele está na imagem e precisa ser chamado por alguém — a linha de `/etc/inittab`:

```text
::sysinit:/etc/init.d/rcS
::respawn:/usr/bin/giochi-init          ← acrescentada pelo post-build
console::respawn:/sbin/getty -L console 0 vt100
```

Quem acrescenta é `scripts/post-build.sh`, e o `prepare-config` **soma** esse
script ao `BR2_ROOTFS_POST_BUILD_SCRIPT` que o defconfig já tinha. Duas decisões
que custaram para ser tomadas:

| Alternativa | Por que não |
| --- | --- |
| `/etc/inittab` no overlay comum | substituiria o arquivo gerado, e defconfig de placa real pode depender das linhas dele (getty, shutdown, ctrlaltdel) |
| sobrescrever `BR2_ROOTFS_POST_BUILD_SCRIPT` | perderia em silêncio o post-build do aparelho |

**A linha só entra quando há launcher** — ou o marcador `/etc/giochi/boot-layer`,
para testar antes:

```text
/opt/giochi/apps/launcher/bin/giochi-launcher   existe?
/etc/giochi/boot-layer                          existe?
        │
        ├── não, não → inittab fica como está (comportamento anterior)
        └── sim      → acrescenta ::respawn:/usr/bin/giochi-init
```

Sem flag de configuração para esquecer: o comportamento acompanha o artefato. No
dia em que o launcher for empacotado, ele sobe sozinho.

O script é idempotente (rodar duas vezes não duplica a entrada — duplicar seria
dois `giochi-init` disputando o DRM) e **falha o build** se o `giochi-init`
estiver sem bit de execução: uma linha de inittab apontando para arquivo sem `+x`
gera erro a cada respawn, e o build teria ficado verde.

## Onde cada peça mora

```text
config/common.fragment              ← pacotes Buildroot do sistema base
config/common.busybox.fragment      ← applets do busybox (udhcpd, nc, vi, ip)
scripts/post-build.sh               ← liga o giochi-init no /etc/inittab
device/common/rootfs-overlay/
├── etc/init.d/S30usbnet            ← sobe a rede USB no boot
├── etc/init.d/S96bootlog           ← log no cartão (só com marcador)
├── etc/ssh/sshd_config             ← substitui o do pacote
└── usr/bin/
    ├── giochi-usbnet               ← o gadget + DHCP
    ├── giochi-selftest             ← diagnóstico
    ├── giochi-buttons              ← botões e eixos
    └── giochi-init                 ← camada de boot (ainda sem inittab)
```

A ordem dos `S*` importa: `S30usbnet` sobe a interface **antes** de `S50sshd`,
para o sshd nascer com socket válido. `S50hwclock` não depende de ordem: só age
no `stop`, quando todos os outros já pararam ou estão parando.

## Trocar de servidor SSH num build retomado exige build limpo

Buildroot **não apaga** arquivo de `target/` quando um símbolo sai do Kconfig.
Remover `BR2_PACKAGE_DROPBEAR` do defconfig e rodar com
`GIOCHI_SYSTEM_KEEP_WORK=1` deixa o binário antigo no rootfs — e a imagem sai
com **os dois** servidores na porta 22, que é exatamente o defeito que a troca
existia para corrigir.

Desde que isso foi medido, `build-device.sh` guarda o conjunto de
`BR2_PACKAGE_*=y` em `work/<device>/packages.state` e **recusa** continuar
quando um pacote sumiu:

```text
ERRO: pacote(s) removido(s) desde o último build: DROPBEAR
  O target/ do build anterior ainda tem os arquivos deles e o
  Buildroot NÃO os remove: a imagem sairia com binário que a config
  diz que não existe.
  Rode de novo SEM GIOCHI_SYSTEM_KEEP_WORK=1 (o padrão limpa work/).
```

Regra prática: `KEEP_WORK=1` é seguro para **acrescentar** pacote e para
depurar o mesmo conjunto. Remover ou renomear exige build limpo.

## O que um aparelho NÃO pode tirar do sistema base

Um `defconfig` de aparelho pode acrescentar, mas não pode remover:

- `BR2_PACKAGE_OPENSSH` e o `sshd_config` do overlay;
- o applet `udhcpd` e o `S30usbnet`;
- `giochi-selftest`, `giochi-buttons`, `giochi-usbnet`.

`tests/base-system.test.mjs` verifica isso — inclusive que **não** voltou um
segundo servidor SSH.

## O que cada aparelho decide

| Decisão | Onde | Exemplo |
| --- | --- | --- |
| Wi-Fi/BT | `defconfig` do aparelho | X55 tem (`wpa_supplicant`, `bluez`); X35H não |
| Painel | `linux.fragment` + patch | HX8394 na X55, ST7703 na X35H |
| Console/rotação | `kernelCmdline` no `device.json` | `ttyS2,1500000n8` + `fbconRotate` |
| Log no cartão | marcador `/etc/giochi/boot-log` | X35H sim; X55 não (tem console) |
| Controles | `buttons.map` | 16 botões no X35H, 16+1 opcional na X55 |

## Estado do mixer ALSA: o app é o dono

O sistema **não persiste** estado de ALSA. Não há `alsactl store` no desligamento
nem `alsactl restore` no boot, e não deve haver.

Motivo: o launcher grava a intenção do usuário em `/user/.config/giochi/volume` e
aplica no mixer ele mesmo. Se o sistema também salvasse e restaurasse o mixer, os
dois escreveriam sem saber um do outro, e o volume "voltaria sozinho" no boot
seguinte — sintoma que ninguém ligaria à causa.

Consequência prática: num aparelho sem launcher, o volume volta ao padrão do
driver a cada boot. É aceitável, e é o preço de não ter dois donos.

`alsa-utils` (`alsactl`, `alsamixer`) continua na imagem — é ferramenta de
diagnóstico e o `giochi-selftest` depende dele para conferir o *Playback Mux*.

**Se algum dia o sistema precisar restaurar o mixer**, a decisão tem de ser
combinada antes: ou o sistema guarda e o app só lê, ou o contrário. O que não
funciona é os dois escreverem.

## Verificação rápida no aparelho

```sh
giochi-usbnet --status     # UDC, gadget, usb0, leases, sshd
giochi-selftest            # o bloco "rede por USB" vem antes de "rede"
```

Se o PC não vê o adaptador:

1. `giochi-usbnet --status` — existe UDC? O gadget está montado?
2. UDC vazio → a porta não está em modo dispositivo (cabo só de carga, ou hub).
3. usb0 sem IP → o gadget montou e o `ip addr add` não rodou.
4. Adaptador aparece no PC mas sem IP → `udhcpd` não está rodando; IP estático
   `10.55.0.1/24` resolve.

## Ver também

- [`x55-bringup.md`](x55-bringup.md) — o gadget ECM que foi testado primeiro.
- [`x35h-bringup.md`](x35h-bringup.md) — aparelho sem TTL/Wi-Fi/BT.
- [`dependencies-manifest.md`](dependencies-manifest.md) — o contrato com o
  `Giochi app`.
