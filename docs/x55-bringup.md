# Powkiddy X55 — registro do primeiro boot

> Documento de **evidência**, não de intenção. Tudo aqui foi medido no aparelho
> físico em 03/11/2026. Onde não foi medido, está escrito que não foi.

## Resultado

O aparelho boota o Giochi System a partir do cartão SD, com login na console
serial:

```text
Giochi System 6.12.0 (/dev/console)
giochi-system-x55 login:
```

`uname -a` dentro do aparelho:

```text
Linux giochi-system-x55 6.12.0 #2 SMP PREEMPT Tue Nov  3 06:31:13 UTC 2026 aarch64 GNU/Linux
```

**Estado do aparelho:** `status: draft` continua correto. O sistema boota, mas
ainda faltam botões, Wi-Fi, Bluetooth e áudio (lista no fim).

## Cadeia de boot observada

```text
BootROM
  └── setor 64     idbloader.img        assinatura RKNS
      └── setor 16384  u-boot.itb       FIT d0 0d fe ed
          └── U-Boot 2024.10            "Model: Powkiddy x55", "DRAM: 2 GiB", "PMIC: RK817"
              └── boot.scr em mmc 1:1   carrega Image + DTB, booti
                  └── Linux 6.12.0      console=ttyS2,1500000n8
                      └── rootfs ext4   PARTUUID=47494f43-02
                          └── login     giochi-system-x55
```

O `bootcmd` gravado no U-Boot do aparelho é:

```text
bootcmd=for d in 1 0; do if load mmc ${d}:1 ${scriptaddr} boot.scr; then setenv giochi_mmc ${d}; source ${scriptaddr}; fi; done; echo GIOCHI: nenhum boot.scr legivel (mmc 1 e 0)
```

Por isso a imagem grava **`boot.scr` além do `extlinux.conf`**: sem o script o
U-Boot para no prompt, mesmo com `extlinux.conf` presente e correto. Os dois
convivem — `extlinux.conf` serve ao U-Boot mainline com distro boot.

## Layout de cartão medido

| Offset | Conteúdo | Verificação |
| --- | --- | --- |
| setor 0 | MBR, id de disco `0x47494f43` ("GIOCHI") | `part list mmc 1` |
| setor 64 (32 KiB) | `idbloader.img` (TPL + SPL, `RKNS`) | `md.b` no U-Boot |
| setor 16384 (8 MiB) | `u-boot.itb` (FIT) | `md.b` no U-Boot |
| 64 MiB | p1 FAT32 `GIOCHI_BOOT`, 256 MiB | `fatls mmc 1:1` |
| 320 MiB | p2 ext4 `GIOCHI`, resto do cartão | `mount` |

`part list mmc 1` no aparelho, com a imagem instalada:

```text
Part	Start Sector	Num Sectors	UUID		Type
  1	131072    	524288    	47494f43-01	0c Boot
  2	655360    	3538944   	47494f43-02	83
```

O PARTUUID **não é aleatório**: `make-sd-image.sh` fixa `label-id: 0x47494f43`
no `sfdisk`, então `47494f43-02` é determinístico entre builds e não depende de
`blkid` nem de udev.

### Linha de comando do kernel

```text
root=PARTUUID=47494f43-02 rootwait rw rootfstype=ext4 \
console=ttyS2,1500000n8 earlycon=uart8250,mmio32,0xfe660000 fbcon=rotate:3
```

Cada parâmetro tem motivo medido:

| Parâmetro | Por quê |
| --- | --- |
| `console=ttyS2,1500000n8` | a UART do console é ttyS2 a **1500000**, não 115200 |
| `earlycon=uart8250,mmio32,0xfe660000` | saída desde o começo; sem ela, falha antes do console é silêncio total |
| `fbcon=rotate:3` | o painel é montado a 270°; sem isso o console aparece deitado |
| `rootwait` | cartão SD enumera depois do rootfs |

## Diagnóstico do aparelho (`giochi-selftest`)

```text
  PASS 15 · WARN 5 · FAIL 1 · SKIP 2
```

### Passou

- `device tree: Powkiddy x55`
- rootfs em `/dev/root`, cartão `mmcblk1 29.7G`
- `/dev/dri/card0` + render node, driver `rockchip-drm`
- **conector `card0-DSI-1: connected 720x1280`** — o painel HX8394 sobe
- backlight `833/1666`
- 3 dispositivos de entrada (`rk805 pwrkey`, `gpio-keys-control`, `gpio-keys-vol`)
- `/etc/giochi/buttons.map` com 31 entradas
- UDC `fcc00000.usb`
- bateria e temperatura (`36C`)

Ou seja: **tela, backlight, armazenamento, console, volume e energia
funcionam**. Era o que faltava para o aparelho sair do console.

### Falhou

| Item | Causa medida | Correção aplicada |
| --- | --- | --- |
| áudio | `--- no soundcards ---`; o card `rk817_ext` declara `aux-devs = <&spk_amp>` e o amplificador estava `CONFIG_SND_SOC_SIMPLE_AMPLIFIER=m`, que não carrega (sem autoload por modalias) | `=y` no `linux.fragment` |

### Avisos com causa conhecida

| Aviso | Causa |
| --- | --- |
| `sem hwrng` | `rng@fe388000` nasce `disabled` no `rk356x.dtsi`; o RK3566 não herda o `okay` do `rk3568.dtsi` |
| `nenhuma interface além de lo` | Wi-Fi depende do SDIO, corrigido no patch de DTS, e do `rtl8821cs_config.bin` gerado (ainda não existe) |
| `giochi-init não é o PID 1` | falta a linha `::respawn:` no `/etc/inittab` (decisão em aberto, `docs/giochi-init.md`) |
| `sem /opt/giochi/apps/index.json` | a grade é do `Giochi app`, não deste repositório |
| `driver DRM rockchip-drm` | o render node é `panfrost`; o selftest olha o nome do DRM de display |

## Instalação remota, sem tirar o cartão

O cartão do aparelho **não estava no leitor** do computador. O caminho usado foi
serial + U-Boot:

1. `loady <addr>` + YMODEM (`docker/ymodem-send.py`) para levar o arquivo à RAM.
   Medido: 10240 bytes com CRC32 conferido (`8d12ebe6` nos dois lados).
2. `mmc write` para o MBR (512 bytes, setor 0).
3. `gzwrite mmc 1 <addr> ${filesize} <wbuf> <offset>` para FAT e rootfs
   comprimidos com gzip.

Vantagem: o U-Boot executa `gzwrite` sozinho depois de receber o arquivo, e
**nada é interrompido** ao desconectar o host. Detalhe que quase custou o
diagnóstico: parar o container no meio não interrompeu a gravação — quem estava
gravando era o U-Boot.

Tamanhos medidos com `gzip -1`:

| Arquivo | Cru | Comprimido |
| --- | --- | --- |
| `rootfs.ext4` | 1 GiB | 52 MB |
| partição FAT de boot | 256 MiB | 17 MB |
| imagem de cartão inteira | 2 GiB | 73 MB |

## Gadget USB (usb0) — funciona, mas não foi usado para transferir

Montado em runtime no aparelho, sem mudar o kernel:

```sh
mount -t configfs none /sys/kernel/config
cd /sys/kernel/config/usb_gadget && mkdir g1 && cd g1
echo 0x1d6b > idVendor; echo 0x0104 > idProduct
mkdir -p strings/0x409 configs/c.1/strings/0x409 functions/ecm.usb0
echo GIOCHI > strings/0x409/manufacturer; echo x55 > strings/0x409/product
echo 0001 > strings/0x409/serialnumber
echo ECM > configs/c.1/strings/0x409/configuration
ln -s functions/ecm.usb0 configs/c.1/
echo fcc00000.usb > UDC
ip link set usb0 up
ip addr add 10.55.0.2/24 dev usb0
```

Resultado medido:

- host cria `enx323a584c0d05` com `32:3a:58:4c:0d:05`;
- aparelho cria `usb0` com `da:79:96:dc:d5:5e`;
- **`ping6` do host para o aparelho: 0% de perda, 0.3 ms**.

O que faltou para transferir: o host não tem IPv4 na interface nova (sem `sudo`
para `ip addr add`) e o aparelho não ganhou rota IPv6 para o link. Com um IPv4
nos dois lados, é o caminho mais rápido — o link é USB 2.0.

## O que ainda falta (ordem de risco)

1. **`rocknix-joypad`** — driver fora da árvore. Sem ele, **16 dos 17 botões não
   funcionam**; só o volume responde (`gpio-keys`). O `assert-kernel-config`
   falha se alguém remover o `allow-drop` sem trazer o driver.
2. **Validação do patch de DTS em hardware** — o build com
   `patches/0001-giochi-system-x55-dts.patch` (HDMI off, SDIO `no-mmc/no-sd`,
   `dma-names` do uart1, `&rng okay`) foi compilado e verificado no DTB gerado,
   mas **não foi instalado no aparelho** nesta sessão. O boot validado usou o
   DTB **sem** o patch.
3. **`rtl8821cs_config.bin`** de 25 bytes, gerado — o do `linux-firmware` não tem
   a entrada de offset `0x0c` e o `hci0` fica sem endereço MAC.
4. **`giochi-init` no `/etc/inittab`** — o script está na imagem e ninguém o
   chama; `giochi-selftest` avisa.
5. **`genimage` dentro do Buildroot** — hoje a imagem de cartão é montada por
   `scripts/make-sd-image.sh`, fora do Buildroot.

## Como reproduzir

```bash
# 1. host auditável (não instala nada, não precisa de root)
bash scripts/check-host.sh

# 2. build completo sem instalar dependências no host
ALLOW_DRAFT=1 bash scripts/build-in-container.sh powkiddy-x55

# 3. imagem de cartão (firmware nos offsets, MBR, FAT, ext4)
bash scripts/build-in-container.sh --sd-image powkiddy-x55

# 4. gravar, com guarda de tamanho e SHA256 conferido relendo o cartão
docker run --rm --privileged --user 0:0 -v /dev:/dev -v "$PWD:/work" -w /work \
  --entrypoint bash giochi-builder:2 -c \
  'bash scripts/flash-sd.sh out/powkiddy-x55/giochi-system-powkiddy-x55-sd.img /dev/sdX --expect-gib 30'

# 5. console e diagnóstico
docker run --rm --device=/dev/ttyUSB0 --entrypoint python3 giochi-serial:1 \
  /work/uboot-serial.py /dev/ttyUSB0 1500000 /dev/null "giochi-selftest"
```

Login: `root` / `giochi-dev` (ou `ROOT_PASSWORD` no build).
