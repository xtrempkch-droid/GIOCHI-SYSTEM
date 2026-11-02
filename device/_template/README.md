# Template de dispositivo

Copie esta pasta para `device/<nome-do-dispositivo>/` e ajuste:

1. `device.json` — id, nome, arquitetura, defconfig, artefatos, runner e timeout.
2. `buildroot.fragment` — opções exclusivas do hardware.
3. `rootfs-overlay/` — arquivos únicos que entram no rootfs.
4. `README.md` — instruções de build, boot e flashing.

Depois adicione uma entrada em `device/devices.json`:

```json
{
  "id": "nome-do-dispositivo",
  "folder": "nome do dispositivo",
  "arch": "arm64",
  "enabled": false
}
```

Mantenha `enabled: false` até que a imagem seja validada em hardware real.

Consulte `docs/adding-a-device.md` para o fluxo completo.
