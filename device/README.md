# Dispositivos

Cada subpasta representa um alvo de imagem. A fonte da verdade da lista é [`devices.json`](./devices.json).

| ID | Pasta | Arch | Status | Build no CI |
| --- | --- | --- | --- | --- |
| `qemu-aarch64` | `qemu-aarch64/` | arm64 | ready | sim |
| `powkiddy-x55` | `powkiddy x55/` | arm64 | draft | não |
| `steamdeck` | `steamdeck/` | x86_64 | draft | não |
| `generic-x64` | `generic-x64/` | x86_64 | draft | não |
| `_template` | `_template/` | — | template | — |

## Estrutura de um dispositivo

```text
device/<pasta>/
├── device.json           # configuração declarativa
├── buildroot.fragment    # opções Buildroot exclusivas
├── buildroot.*.fragment  # opcional: fragmentos por área (panel, input, audio…)
├── patches/kernel/       # opcional: patches de kernel/DTB
├── firmware/             # opcional: blobs de firmware
├── rootfs-overlay/       # arquivos únicos do rootfs
└── README.md             # build, boot, flashing e pendências
```

Drivers e painel **só** existem dentro da pasta do device. O `common/` não declara nenhum `CONFIG_DRM_PANEL_*` nem código de hardware.

## Drivers e painel por dispositivo

Para hardware com painel/controles próprios:

1. **DTB e patches de kernel** em `patches/kernel/` (panel node, timings, rotação).
2. **Opções de build** em `buildroot.panel.fragment` — `CONFIG_DRM_PANEL_<nome>`, backlight.
3. **Firmware** em `firmware/` (Wi-Fi, Bluetooth, áudio).
4. **Calibração e mapeamentos** em `rootfs-overlay/usr/share/giochi-system/`.

Declare os arquivos no `device.json`:

```json
{
  "buildrootFragments": ["buildroot.panel.fragment", "buildroot.input.fragment"],
  "kernelPatches": ["patches/kernel"],
  "firmwareFiles": ["firmware"]
}
```

O build aplica `common` → `buildroot.fragment` → fragmentos por área, nessa ordem. Ver [docs/architecture.md](../docs/architecture.md#camada-de-drivers-e-painel-por-dispositivo).

## Estados

- `ready`: configuração completa e validada o suficiente para o CI construir.
- `draft`: placeholder ou hardware ainda não validado; não entra no CI.
- `enabled`: campo em `devices.json`. Um device só é construído se estiver `enabled: true`, `status: "ready"` e tiver `buildrootDefconfig`.

## Adicionar um dispositivo

1. Copie `_template/` para `device/<nome>/`.
2. Preencha `device.json` e `buildroot.fragment`.
3. Adicione os arquivos exclusivos em `rootfs-overlay/`.
4. Registre o id e a pasta em `devices.json` com `enabled: false`.
5. Valide:

```bash
node scripts/validate-devices.mjs
```

6. Quando estiver pronto, mude `status` para `ready`, `enabled` para `true` e rode o build.

O caminho da pasta pode conter espaços (ex.: `powkiddy x55`). O script de build copia os overlays para um caminho interno sem espaços antes de chamar o Buildroot.
