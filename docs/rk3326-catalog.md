# Catálogo de aparelhos RK3326 — extraído de device tree

Gerado por `scripts/dtb-catalog.mjs` a partir dos DTBs do release ROCKNIX.
**Não editar à mão:** regenere quando o DTB de origem mudar.

## Como usar

1. Encontre o aparelho pela coluna `model`.
2. Confira o driver dos botões — se for `rocknix-*`, ele **não está no mainline**:
   sem o driver compilado, nenhum botão funciona.
3. Crie `device/<pasta>/` com `device.json`, `buildroot.fragment`, `linux.fragment`,
   `buttons.map` e `rootfs-overlay/` (ver [adding-a-device.md](adding-a-device.md)).

> **O catálogo não diz qual é o painel.** Ele sai do DTB, e DSI não tem EDID —
> o mesmo modelo de aparelho sai de fábrica com telas diferentes (o R35S tem
> **cinco**). Para os painéis do R35S/R36S, que estão medidos e em texto
> comparável, ver [`device/r35s/panels/`](../device/r35s/panels/README.md) e
> `node scripts/panel-inspect.mjs`.
4. Copie o `.dtb` para `device/<pasta>/dts/` para o build ser reproduzível.
5. Confirme no aparelho com `evtest` — o DTB diz o que o kernel registra.

## Aparelhos

| DTB | model | driver dos botões | painel | botões |
| --- | --- | --- | --- | --- |
| `rk3326-anbernic-rg351m.dtb` | Anbernic RG351M | gpio-keys | — | 0 |
| `rk3326-anbernic-rg351v.dtb` | Anbernic RG351V | gpio-keys | anbernic,rg351v-panel | 2 |
| `rk3326-batlexp-g350.dtb` | BatleXP G350 | rocknix-singleadc-joypad | — | 19 |
| `rk3326-gameconsole-eeclone.dtb` | Generic EE clone | rocknix-singleadc-joypad | — | 17 |
| `rk3326-gameconsole-r33s.dtb` | Game Console R33S | rocknix-singleadc-joypad | gameconsole,r36s-panel | 16 |
| `rk3326-gameconsole-r36s.dtb` | Game Console R36S | rocknix-singleadc-joypad | gameconsole,r36s-panel | 19 |
| `rk3326-magicx-xu-mini-m.dtb` | MagicX XU Mini M | xu10-joypad | — | 2 |
| `rk3326-magicx-xu10.dtb` | MagicX XU10 | xu10-joypad | magicx,xu10-panel | 2 |
| `rk3326-odroid-go2-v11.dtb` | ODROID-GO Advance Black Edition | rocknix-joypad | — | 18 |
| `rk3326-odroid-go2.dtb` | ODROID-GO Advance | odroidgo2-joypad | — | 2 |
| `rk3326-odroid-go3.dtb` | ODROID-GO Super | rocknix-singleadc-joypad | — | 18 |
| `rk3326-powkiddy-rgb10.dtb` | Powkiddy RGB10 | rocknix-joypad | — | 16 |
| `rk3326-powkiddy-rgb10x.dtb` | Powkiddy RGB10X | rocknix-singleadc-joypad | powkiddy,rk2023-panel | 19 |
| `rk3326-powkiddy-rgb20s.dtb` | Powkiddy RGB20S | rocknix-singleadc-joypad | — | 19 |
| `rk3326s-gkd-pixel2.dtb` | GameKiddy GKD Pixel2 | rocknix-singleadc-joypad | — | 16 |

## Botões por aparelho

### Anbernic RG351M

- DTB: `rk3326-anbernic-rg351m.dtb`
- compatible: `anbernic,rg351m · rockchip,rk3326`
- placa de som: `rk817_int`
- botões (0): nenhum

### Anbernic RG351V

- DTB: `rk3326-anbernic-rg351v.dtb`
- compatible: `anbernic,rg351v · rockchip,rk3326`
- placa de som: `rk817_int`
- botões (2): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP

### BatleXP G350

- DTB: `rk3326-batlexp-g350.dtb`
- compatible: `batlexp,g350 · rockchip,rk3326`
- joypad: `retrogame_joypad`
- placa de som: `rk817_int`
- botões (19): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP, up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, x=BTN_NORTH, y=BTN_WEST, select=BTN_SELECT, start=BTN_START, home=BTN_MODE, l=BTN_TL, r=BTN_TR, l2=BTN_TL2, r2=BTN_TR2, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR

### Generic EE clone

- DTB: `rk3326-gameconsole-eeclone.dtb`
- compatible: `gameconsole,eeclone · rockchip,rk3326`
- joypad: `r36s_Gamepad`
- placa de som: `rk817_ext`
- botões (17): up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, y=BTN_WEST, x=BTN_NORTH, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR, home=BTN_MODE, l=BTN_TL, r=BTN_TR, select=BTN_SELECT, r2=BTN_TR2, l2=BTN_TL2, start=BTN_START

### Game Console R33S

- DTB: `rk3326-gameconsole-r33s.dtb`
- compatible: `gameconsole,r33s · rockchip,rk3326`
- joypad: `r33s_joypad`
- placa de som: `rk817_int`
- botões (16): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP, up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, y=BTN_WEST, x=BTN_NORTH, l=BTN_TL, r=BTN_TR, select=BTN_SELECT, r2=BTN_TR2, l2=BTN_TL2, start=BTN_START

### Game Console R36S

- DTB: `rk3326-gameconsole-r36s.dtb`
- compatible: `gameconsole,r35s · gameconsole,r36s · rockchip,rk3326`
- joypad: `r36s_Gamepad`
- placa de som: `rk817_int`
- botões (19): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP, up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, y=BTN_WEST, x=BTN_NORTH, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR, home=BTN_MODE, l=BTN_TL, r=BTN_TR, select=BTN_SELECT, r2=BTN_TR2, l2=BTN_TL2, start=BTN_START

### MagicX XU Mini M

- DTB: `rk3326-magicx-xu-mini-m.dtb`
- compatible: `magicx,xu-mini-m · rockchip,rk3326`
- joypad: `XU Mini M Gamepad`
- placa de som: `rk817_int`
- botões (2): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP

### MagicX XU10

- DTB: `rk3326-magicx-xu10.dtb`
- compatible: `magicx,xu10 · rockchip,rk3326`
- joypad: `XU10 Gamepad`
- placa de som: `rk817_int`
- botões (2): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP

### ODROID-GO Advance Black Edition

- DTB: `rk3326-odroid-go2-v11.dtb`
- compatible: `hardkernel,rk3326-odroid-go2-v11 · rockchip,rk3326`
- joypad: `odroidgo2_v11_joypad`
- placa de som: `rk817_int`
- botões (18): up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, x=BTN_NORTH, y=BTN_WEST, select=BTN_SELECT, start=BTN_START, l=BTN_TL, r=BTN_TR, l2=BTN_TL2, r2=BTN_TR2, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR, volup=KEY_VOLUMEUP, voldown=KEY_VOLUMEDOWN

### ODROID-GO Advance

- DTB: `rk3326-odroid-go2.dtb`
- compatible: `hardkernel,rk3326-odroid-go2 · rockchip,rk3326`
- placa de som: `rk817_int`
- botões (2): volup=KEY_VOLUMEUP, voldown=KEY_VOLUMEDOWN

### ODROID-GO Super

- DTB: `rk3326-odroid-go3.dtb`
- compatible: `hardkernel,rk3326-odroid-go3 · rockchip,rk3326`
- joypad: `odroidgo3_joypad`
- placa de som: `rk817_int`
- botões (18): up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, y=BTN_WEST, x=BTN_NORTH, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR, l=BTN_TL, r=BTN_TR, select=BTN_SELECT, r2=BTN_TR2, l2=BTN_TL2, start=BTN_START, voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP
- códigos sem nome: 0x2c2 GPIO F3, 0x2c5 GPIO F6

### Powkiddy RGB10

- DTB: `rk3326-powkiddy-rgb10.dtb`
- compatible: `powkiddy,rk3326-rgb10 · rockchip,rk3326`
- joypad: `odroidgo2_v11_joypad`
- placa de som: `rk817_int`
- botões (16): up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, x=BTN_NORTH, y=BTN_WEST, select=BTN_SELECT, start=BTN_START, l=BTN_TL, r=BTN_TR, l2=BTN_TL2, r2=BTN_TR2, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR

### Powkiddy RGB10X

- DTB: `rk3326-powkiddy-rgb10x.dtb`
- compatible: `powkiddy,rk3326-rgb10x · rockchip,rk3326`
- joypad: `retrogame_joypad_s1_f2`
- placa de som: `rk817_int`
- botões (19): up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, x=BTN_NORTH, y=BTN_WEST, select=BTN_SELECT, start=BTN_START, home=BTN_MODE, l=BTN_TL, r=BTN_TR, l2=BTN_TL2, r2=BTN_TR2, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR, voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP

### Powkiddy RGB20S

- DTB: `rk3326-powkiddy-rgb20s.dtb`
- compatible: `powkiddy,rgb20s · rockchip,rk3326`
- joypad: `r36s_Gamepad`
- placa de som: `rk817_int`
- botões (19): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP, up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, a=BTN_EAST, b=BTN_SOUTH, y=BTN_WEST, x=BTN_NORTH, thumbl=BTN_THUMBL, thumbr=BTN_THUMBR, home=BTN_MODE, l=BTN_TL, r=BTN_TR, select=BTN_SELECT, r2=BTN_TR2, l2=BTN_TL2, start=BTN_START

### GameKiddy GKD Pixel2

- DTB: `rk3326s-gkd-pixel2.dtb`
- compatible: `gamekiddy,gkd-pixel2 · rockchip,rk3326`
- joypad: `gkd_pixel2_joypad`
- placa de som: `rk817_int`
- botões (16): voldown=KEY_VOLUMEDOWN, volup=KEY_VOLUMEUP, up=BTN_DPAD_UP, down=BTN_DPAD_DOWN, left=BTN_DPAD_LEFT, right=BTN_DPAD_RIGHT, b=BTN_SOUTH, a=BTN_EAST, x=BTN_NORTH, y=BTN_WEST, l=BTN_TL, r=BTN_TR, l2=BTN_TL2, r2=BTN_TR2, select=BTN_SELECT, start=BTN_START
- códigos sem nome: 0x2c0 FUNCTION

