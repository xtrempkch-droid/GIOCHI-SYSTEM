# Steam Deck

Placeholder para uma futura variante Giochi System para o Steam Deck (x86_64).

O pipeline padrão do repositório é **ARM64**. O modelo de dispositivo aceita outras arquiteturas, mas este alvo não entra na matriz padrão enquanto estiver desabilitado.

## Checklist para habilitar

- [ ] Definir kernel e firmware específicos do Steam Deck.
- [ ] Configurar áudio, Wi-Fi, Bluetooth e o controle `hid-steam`.
- [ ] Definir layout de armazenamento e processo de instalação/recuperação.
- [ ] Criar imagem inicializável e documentar o flashing.
- [ ] Preencher `buildrootDefconfig` em `device.json`.
- [ ] Trocar `status` para `ready`, ajustar `enabled` em `devices.json`.
- [ ] Rodar o workflow com `arch=x86_64`.

## Status

Draft. Não use esta pasta para gerar uma imagem de produção ainda.
