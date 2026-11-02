# Contribuindo

Obrigado por contribuir com o Giochi System.

## Antes de abrir um PR

1. Valide a árvore:

   ```bash
   node scripts/validate-devices.mjs
   node tests/devices.test.mjs
   ```

2. Se adicionar um device, mantenha `enabled: false` até validar a imagem em hardware real.
3. Não inclua binários de imagem, caches, logs ou segredos.
4. Atualize a documentação do device e o `docs/` quando o comportamento mudar.

## Adicionar um dispositivo

O guia completo está em [docs/adding-a-device.md](docs/adding-a-device.md).

Resumo:

```text
device/<nome>/
├── device.json
├── buildroot.fragment
├── rootfs-overlay/
└── README.md
```

Registre em `device/devices.json` e rode o validador.

## Estilo

- JavaScript ESM, sem dependências externas.
- JSON com 2 espaços.
- Shell compatível com Bash em Ubuntu 24.04.
- Caminhos de device podem ter espaços; não os use diretamente em `BR2_ROOTFS_OVERLAY` (o build faz staging).
- Mensagens e documentação em português.

## Commits

Use mensagens curtas e descritivas, por exemplo:

```text
device(powkiddy-x55): add RK3566 kernel fragment
ci: cache Buildroot downloads
docs: explain root password handling
```
