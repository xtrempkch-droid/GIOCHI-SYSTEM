# Powkiddy X55

Placeholder para o handheld Powkiddy X55, baseado no SoC Rockchip RK3566 (ARM64).

O dispositivo está **desabilitado** em `device/devices.json` e não é compilado pelo workflow até que a configuração de hardware esteja completa.

## Checklist para habilitar

- [ ] Definir kernel e DTS/DTB do RK3566 para a placa X55.
- [ ] Adicionar U-Boot (ou bootloader equivalente) com defconfig da placa.
- [ ] Configurar `genimage` e o layout de partições do cartão SD/eMMC.
- [ ] Adicionar firmware de Wi-Fi, Bluetooth, áudio e vídeo.
- [ ] Mapear tela, botões, analógicos e LEDs no rootfs-overlay ou em um pacote próprio.
- [ ] Definir `buildrootDefconfig` em `device.json`.
- [ ] Trocar `status` para `ready` e `enabled` para `true`.
- [ ] Validar com `node scripts/validate-devices.mjs`.
- [ ] Construir com `bash scripts/build-device.sh powkiddy-x55`.
- [ ] Testar em hardware real antes de publicar a imagem.

## Arquivos únicos

- `rootfs-overlay/etc/motd` — mensagem de boas-vindas do X55;
- `rootfs-overlay/etc/giochi-system/device-id` — identificador da imagem;
- `buildroot.fragment` — opções exclusivas do hardware.

## Referências de hardware

- SoC: Rockchip RK3566 (4× Cortex-A55, ARM64).
- O Giochi System não inclui ainda drivers ou firmware específicos deste handheld.
