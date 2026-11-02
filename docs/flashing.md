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

## Powkiddy X55 (draft)

A pasta existe, mas a imagem ainda não é inicializável no hardware. Antes de gravar:

- kernel, DTB, U-Boot, firmware e layout de partições precisam ser definidos;
- o `buildrootDefconfig` precisa ser preenchido;
- `status` deve virar `ready` e `enabled` deve ser `true`;
- a imagem deve ser testada em hardware real.

Não use a imagem draft em um cartão principal.

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
sudo dd if=out/<device>/sdcard.img of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

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

- Conecte o console serial quando disponível (geralmente 115200 8N1).
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
