# Gravação e boot

> **Atenção:** gravar uma imagem apaga o conteúdo do cartão/eMMC de destino. Confira o dispositivo de destino com `lsblk` antes de usar `dd`. Nunca aponte o comando para o disco do sistema.

## QEMU AArch64

O device `qemu-aarch64` gera `Image` e `rootfs.ext4`.

```bash
cd out/qemu-aarch64

qemu-system-aarch64 \
  -M virt \
  -cpu cortex-a53 \
  -smp 2 \
  -m 512 \
  -kernel Image \
  -drive file=rootfs.ext4,if=virtio,format=raw \
  -append "root=/dev/vda rw console=ttyAMA0" \
  -netdev user,id=net0 \
  -device virtio-net-device,netdev=net0 \
  -nographic
```

- Login: `root`.
- Senha padrão: `giochi-system` (ou o secret configurado).
- Saída do console: `Ctrl+A`, depois `X`.
- Para acessar a rede do host, adicione `hostfwd` ao `-netdev user`, por exemplo `hostfwd=tcp::2222-:22`, e conecte com `ssh -p 2222 root@127.0.0.1`.

## Powkiddy X55

Handheld RK3566. O aparelho **boota pelo cartão SD** — não há eMMC nele: a
única memória de massa é o cartão.

### Layout medido no hardware

O BootROM do RK3566 não lê tabela de partição: ele busca o firmware em setores
fixos. Verificado no aparelho pelo console serial:

| Offset | Conteúdo | Evidência |
| --- | --- | --- |
| setor 64 (32 KiB) | `idbloader.img` | assinatura `RKNS` lida com `md.b` |
| setor 16384 (8 MiB) | `u-boot.itb` | cabeçalho FIT `d0 0d fe ed` |
| 64 MiB | p1 FAT32 `GIOCHI_BOOT` | `Image`, `dtbs/`, `extlinux.conf`, `boot.scr` |
| 320 MiB | p2 ext4 `GIOCHI` | rootfs |

Um cartão só com `Image` e `rootfs.ext4` — o que o build entrega hoje — não
boota: falta o firmware nos setores fixos e a partição de boot.

### Partição de dados da loja (proposta, não implementada)

A loja não pode morar no rootfs — rootfs assinado é read-only por desenho, e
conteúdo comprado não pode depender de reimagem. O time do app propôs:

| | |
| --- | --- |
| piso | **4 GiB** |
| teto | **todo o espaço restante do cartão** |

O número é do dono do projeto, não nosso — por isso ainda não está em script.
Duas consequências decidem a implementação, e nenhuma é trivial:

1. **A `.img` tem tamanho fixo** (2 GiB, com as duas partições acima). "O resto
   do cartão" não cabe num arquivo de tamanho fixo: a partição de dados só chega
   ao tamanho final se **crescer no primeiro boot** no aparelho, ou se o
   `flash-sd.sh` particionar o cartão depois de gravar a imagem.
2. **Gravar apaga os dados do usuário.** `dd` e `flash-sd.sh` não preservam
   nada, e a partição de dados é a primeira a morrer. Aceitável em
   desenvolvimento, inaceitável para usuário final — é mais um motivo para o
   aviso antes de qualquer gravação.

### Gerar a imagem de cartão

```bash
# monta out/<device>/giochi-system-<device>-sd.img a partir dos artefatos
bash scripts/build-in-container.sh --sd-image powkiddy-x55
```

A imagem inclui firmware nos offsets, as duas partições, `extlinux.conf` e
`boot.scr`. O `boot.scr` não é redundante: o U-Boot que está no aparelho tem
`bootcmd` que procura `boot.scr` em `mmc 1:1` e `0:1`, e para no prompt quando
não encontra.

### Gravar

```bash
# confirme o destino: só discos removíveis são aceitos
bash scripts/flash-sd.sh --list

# grava e confere o SHA256 relendo o cartão
sudo bash scripts/flash-sd.sh out/powkiddy-x55/giochi-system-powkiddy-x55-sd.img /dev/sdX

# melhor: passe o tamanho que o U-Boot reporta em `mmc info`
sudo bash scripts/flash-sd.sh <imagem> /dev/sdX --expect-gib 29
```

O script recusa disco fixo, partição em vez de disco, destino montado e cartão
menor que a imagem.

**Dois cartões SD ao mesmo tempo é a armadilha real.** O aparelho pode estar com
um cartão na gaveta e outro no leitor do computador; os dois aparecem como
`removable=1` e nada no nome do device distingue um do outro. Já aconteceu nesta
sessão: o aparelho tinha um `SE32G` de 29,7 GiB e o leitor tinha um cartão de
116 GiB — a gravação foi para o cartão errado e só o `mmc info` do U-Boot
revelou. Use `--expect-gib` com a capacidade que o aparelho reporta.

Quando o cartão é de outro tamanho, um `dd` no cartão errado também apaga o que
havia nele. Nesta sessão o cartão do leitor continha a imagem do antecessor; o
`extlinux.conf` e os logs de boot foram preservados antes em
`~/.cache/giochi-system/old-card/`.

### Console serial

O console do X55 é **`ttyS2` a 1500000 8N1** — não 115200. Um adaptador CH341
(`1a86:5523`) aparece como `/dev/ttyUSB0`; no host, o usuário precisa estar no
grupo `dialout`, ou use o container:

```bash
# logger em background, escreve em ~/.cache/giochi-system/serial/boot.log
docker run -d --name x55-serial --device=/dev/ttyUSB0 \
  -v "$HOME/.cache/giochi-system/serial:/work/log" giochi-serial:1 \
  /dev/ttyUSB0 1500000 /work/log/boot.log

# enviar comandos ao U-Boot
docker run --rm --device=/dev/ttyUSB0 --entrypoint python3 giochi-serial:1 \
  /work/uboot-serial.py /dev/ttyUSB0 1500000 /dev/null "mmc list"
```

Sequência de boot observada no aparelho: `U-Boot SPL 2024.10` → `Trying to boot
from MMC2` → hash dos FIT → `BL31 v2.3` → `U-Boot 2024.10` → `Model: Powkiddy
x55` / `DRAM: 2 GiB` / `PMIC: RK817` → `bootcmd`.

## Steam Deck (draft)

O Steam Deck é x86_64 e não entra na matriz ARM64 padrão. A pasta é um placeholder para uma futura variante; não há imagem inicializável ainda.

## Método genérico para cartão SD/eMMC

1. Identifique o disco:

```bash
lsblk -o NAME,SIZE,MODEL,TRAN
```

2. Confirme que o destino é o cartão/eMMC correto. Exemplo: `/dev/sdX`.
3. Desmonte as partições montadas do destino.
4. Grave a imagem:

```bash
sudo dd if=out/<device>/giochi-system-<device>-sd.img of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

Ou, com as verificações de segurança: `sudo bash scripts/flash-sd.sh <imagem> /dev/sdX`.

5. Ejete com segurança.

Alternativas gráficas: balenaEtcher, Raspberry Pi Imager (quando o formato for compatível) e usbimager.

## Verificação de integridade

Antes de gravar:

```bash
cd out/<device>
sha256sum -c SHA256SUMS
```

Se o build veio do GitHub Actions, baixe o artefato `giochi-system-<device>` e confira o `SHA256SUMS` com o valor exibido no resumo do job.

## Primeiro boot

- Conecte o console serial. No X55 é `ttyS2` a **1500000 8N1**, não 115200 —
  em 115200 a saída sai ilegível.
- Verifique se o kernel encontrou o rootfs e o console correto.
- Faça login como `root`.
- Troque a senha imediatamente:

```sh
passwd
```

- Verifique a rede:

```sh
ip addr
ip route
ping -c 3 1.1.1.1
```

- Verifique o espaço:

```sh
df -h
```

## Ajustes antes de distribuir

- Troque a senha de root.
- Revise `/etc/ssh/sshd_config` e considere desabilitar login de root por senha.
- Remova ou restrinja serviços que não são necessários.
- Gere um `SHA256SUMS` novo se alterar a imagem.
- Documente as limitações de hardware no README do device.

## Segurança física

Uma imagem de cartão SD pode ser montada e lida em outro computador. Não coloque chaves privadas, tokens ou senhas de produção no rootfs. Use primeiro boot, provisionamento ou um cofre externo.
