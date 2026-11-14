# QEMU AArch64 Virt

Alvo virtual ARM64 mantido no repositório para validar o pipeline Buildroot sem depender de hardware físico.

## Build

```bash
bash scripts/build-device.sh qemu-aarch64
```

Artefatos em `out/qemu-aarch64/`:

- `Image` — kernel ARM64;
- `rootfs.ext4` (ou `rootfs.ext2`, conforme a versão do Buildroot);
- `buildroot.config` — configuração final;
- `device.json`, `buildroot.fragment`, `DEVICE.md`;
- `build-info.txt` e `SHA256SUMS`.

## Executar

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

Login padrão: `root` / `giochi-system` (ou a senha definida no secret do workflow).

Digite `Ctrl+A`, depois `X` para sair do QEMU.

## Receber os apps do Giochi os

O launcher e os jogos não nascem aqui: eles vêm do repositório **Giochi os**, que
monta o overlay e passa o caminho ao build.

```bash
# no Giochi os
node scripts/assemble.mjs apps --apps ../GIOCHI-APP/app --out staging

# aqui
GIOCHI_SYSTEM_EXTRA_OVERLAY=../GIOCHI-OS/staging/rootfs-overlay \
  bash scripts/build-device.sh qemu-aarch64
```

O overlay entra como **último** `BR2_ROOTFS_OVERLAY`, então não sobrescreve
configuração de hardware. Sem ele, o build continua íntegro — e o `giochi-init`
espera o launcher aparecer, sem inundar o console.

### Por que este device agora tem SDL2

O `virt` do QEMU nasceu sem SDL2 (é o smoke test do pipeline). Com apps na
imagem isso passou a ser um defeito silencioso: o binário existe, o manifesto
anuncia, e o console mostra

```text
giochi-launcher: error while loading shared libraries: libSDL2-2.0.so.0
```

O fragmento deste device liga `SDL2`, `SDL2_TTF` e `DEJAVU` (com a família
`SANS`). `HARFBUZZ` fica de fora porque o defconfig do QEMU não tem C++ no
toolchain, e `SDL2_KMSDRM` também: sem `virtio-gpu-pci` não existe card DRM.

### Console, não launcher

`rootfs-overlay/etc/giochi/headless` existe só neste device. Presente, o
`giochi-init` mantém o console (e o getty) como interface e não inicia o
launcher — que rodaria com o driver `dummy`, sem tela, escrevendo diagnóstico no
mesmo terminal do login.

Para ver o launcher nesta VM: remova o arquivo da imagem e inicie com
`-device virtio-gpu-pci -display ...`.
