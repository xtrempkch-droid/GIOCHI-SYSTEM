# Adicionar um dispositivo

Este guia usa como exemplo um handheld ARM64. Os passos valem para qualquer alvo suportado pelo Buildroot ou por um defconfig próprio.

## 1. Copie o template

```bash
cp -a device/_template "device/meu-handheld"
```

Ajuste o nome da pasta. Espaços são permitidos (`device/powkiddy x55`), mas evite `/`, `..` e caracteres de controle.

## 2. Edite `device.json`

```json
{
  "schemaVersion": 1,
  "id": "meu-handheld",
  "name": "Meu Handheld",
  "description": "Handheld baseado em SoC XYZ, tela 1280x720 e cartão SD.",
  "arch": "arm64",
  "hostname": "giochi-system-meu",
  "buildrootDefconfig": "meu_handheld_defconfig",
  "buildrootFragment": "buildroot.fragment",
  "rootfsOverlays": ["rootfs-overlay"],
  "artifacts": ["sdcard.img"],
  "runner": "ubuntu-24.04",
  "timeoutMinutes": 300,
  "status": "draft",
  "bootNotes": "Imagem SD com U-Boot no offset X.",
  "docs": "README.md"
}
```

- `id`: minúsculo, começa com letra/número, usa `a-z`, `0-9` e `-`.
- `buildrootDefconfig`: precisa existir em `buildroot/configs/` ou ser fornecido por uma árvore externa. O valor deve terminar em `_defconfig`.
- `artifacts`: padrões de arquivos em `output/images/`.
- Mantenha `status: "draft"` até validar em hardware real.

## 3. Adicione ao índice

Em `device/devices.json`:

```json
{
  "id": "meu-handheld",
  "folder": "meu-handheld",
  "arch": "arm64",
  "enabled": false
}
```

O `folder` deve ser exatamente o nome da pasta. Um device só entra no CI com `enabled: true`, `status: "ready"` e defconfig definido.

## 4. Configure o fragmento

`buildroot.fragment` recebe opções específicas:

```text
BR2_TARGET_ROOTFS_EXT2_SIZE="2048M"
BR2_LINUX_KERNEL_DTS_SUPPORT=y
BR2_LINUX_KERNEL_INTREE_DTS_NAME="rockchip/rk3566-meu-handheld"
BR2_TARGET_UBOOT=y
BR2_TARGET_UBOOT_BOARD_DEFCONFIG="meu-handheld-rk3566"
BR2_PACKAGE_LINUX_FIRMWARE=y
```

Opções comuns (OpenSSH, nano, curl, htop etc.) ficam em `config/common.fragment`; não duplique.

## 5. Coloque os arquivos únicos no overlay

```text
device/meu-handheld/rootfs-overlay/
├── etc/motd
├── etc/giochi-system/device-id
├── etc/giochi-system/meu-hardware.conf
└── etc/udev/rules.d/99-meu-handheld.rules
```

O overlay é copiado para o rootfs depois do overlay comum. Crie apenas o que for específico do dispositivo.

Para serviços de inicialização, lembre-se de que o Git preserva o bit executável; em um repositório criado pelo Windows, confirme com:

```bash
git ls-files -s device/meu-handheld/rootfs-overlay/etc/init.d/S99meu
# o modo deve ser 100755
```

Se necessário, use `git update-index --chmod=+x <arquivo>`.

## 6. Defconfig: encontre ou crie

Defconfigs prontos ficam em `buildroot/configs/` após o download do Buildroot. Exemplos úteis:

- `qemu_aarch64_virt_defconfig` — VM ARM64 de referência.
- `raspberrypi4_64_defconfig` — SBC ARM64.
- `raspberrypi3_64_defconfig` — SBC ARM64.

Para hardware sem defconfig pronto, crie um defconfig próprio no Buildroot ou forneça uma árvore externa. O Giochi System espera que o nome exista e que o build consiga rodá-lo.

## 7. Valide

```bash
node scripts/validate-devices.mjs
```

O validador verifica:

- ids e pastas duplicadas;
- arquivos e overlays existentes;
- defconfig presente em devices habilitados;
- status `ready` em devices habilitados;
- runner e timeout;
- documentação obrigatória.

## 8. Construa localmente

```bash
ALLOW_DRAFT=1 bash scripts/build-device.sh meu-handheld
```

`ALLOW_DRAFT=1` permite testar um device ainda marcado como draft. O build falha se o defconfig estiver vazio.

## 9. Habilite no CI

Depois de validar em hardware:

1. `status` para `"ready"`;
2. `enabled` para `true` em `devices.json`;
3. commit e push na `main`;
4. acompanhe o workflow **Build Giochi System ARM64**.

## 10. Documente o boot

Atualize o `README.md` do device com:

- como gravar a imagem;
- requisitos de bootloader/firmware;
- portas seriais e velocidade;
- credenciais padrão e como trocar a senha;
- periféricos que funcionam e os que ainda não funcionam;
- limitações conhecidas.

## Checklist final

- [ ] `node scripts/validate-devices.mjs` passa.
- [ ] `node tests/devices.test.mjs` passa.
- [ ] O defconfig existe na versão do Buildroot fixada.
- [ ] Os artefatos esperados foram gerados.
- [ ] A imagem inicia em hardware real.
- [ ] Rede, armazenamento e console foram testados.
- [ ] A senha padrão foi trocada ou o secret do CI foi configurado.
- [ ] O README do device está atualizado.
