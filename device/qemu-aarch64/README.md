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
