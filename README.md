# Giochi System

Imagens **Linux ARM64** mínimas, reproduzíveis e configuradas por dispositivo, construídas com **Buildroot** e **GitHub Actions**.

O repositório foi desenhado para receber os dispositivos depois: cada alvo vive em `device/<nome>/` com sua configuração Buildroot, overlay de rootfs e arquivos únicos. O workflow lê esses arquivos, monta uma matriz e gera as imagens.

> **Estado atual:** o device virtual `qemu-aarch64` está habilitado como referência de pipeline. `powkiddy-x55` (ARM64) e `steamdeck` (x86_64) são placeholders desabilitados até receberem kernel, bootloader, firmware e layout de partições.

## O que está incluído

- Estrutura `device/` com `device.json`, fragmentos Buildroot, overlays e documentação por dispositivo.
- Buildroot fixado em [`buildroot.version`](./buildroot.version) (`2025.02`, LTS).
- Script de build que aplica defconfig, mescla configuração comum + device, preserva scripts de pós-build do Buildroot e empacota artefatos com SHA256.
- Validador de devices e testes em Node.js puro.
- Workflow GitHub Actions com validação, matriz de devices, cache de downloads e artefatos.
- Pasta `docs/` com arquitetura, adição de dispositivo, build local, CI, flashing, troubleshooting e segurança.
- `AGENTS.md` com o handoff completo para continuação por qualquer pessoa.

## Dispositivos

| Device | Arch | Estado | Build |
| --- | --- | --- | --- |
| `qemu-aarch64` | arm64 | ready | habilitado |
| `powkiddy-x55` | arm64 | draft | desabilitado |
| `steamdeck` | x86_64 | draft | desabilitado |
| `_template` | — | template | não listado |

A lista oficial é [`device/devices.json`](./device/devices.json). A pasta `qemu-aarch64` é um alvo virtual para validar o pipeline; ela não representa hardware final.

## Estrutura do repositório

```text
.
├── buildroot.version             # versão fixada do Buildroot
├── config/
│   └── common.fragment           # opções comuns a todos os devices
├── device/
│   ├── devices.json              # fonte da verdade da lista/matriz
│   ├── common/rootfs-overlay/    # arquivos comuns do rootfs
│   ├── qemu-aarch64/             # device de referência habilitado
│   ├── powkiddy x55/             # placeholder ARM64
│   ├── steamdeck/                # placeholder x86_64
│   └── _template/                # template para novos devices
├── scripts/
│   ├── build-device.sh           # build Buildroot de um device
│   ├── prepare-config.mjs        # merge de .config, overlays e hostname
│   ├── validate-devices.mjs      # validação da árvore
│   ├── list-devices.mjs          # lista e matriz do GitHub Actions
│   ├── device-info.mjs           # consulta campos do device
│   └── lib/devices.mjs           # loader/validador reutilizável
├── docs/
├── tests/
├── .github/workflows/
├── AGENTS.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── .gitignore
├── .gitattributes
└── .editorconfig
```

## Começar

Requisitos para validação/scripts: **Node.js 20+**. Para compilar: **Linux ou WSL2** com as dependências de Buildroot.

```bash
node scripts/validate-devices.mjs
node tests/devices.test.mjs
node scripts/list-devices.mjs
node scripts/list-devices.mjs --github-matrix
```

Build local do alvo de referência:

```bash
bash scripts/build-device.sh qemu-aarch64
```

O primeiro build compila a toolchain interna do Buildroot e pode levar de dezenas de minutos a algumas horas. As imagens saem em `out/qemu-aarch64/`.

## Como o workflow funciona

1. **Validate** roda o validador e os testes.
2. **Discover** transforma `device/devices.json` em uma matriz JSON, filtrando arquitetura e devices habilitados.
3. **Build** roda um job por device, instala dependências, baixa o Buildroot fixado, aplica o defconfig, mescla os fragmentos, compila e publica o artefato.
4. **Upload** disponibiliza `giochi-system-<device>` no GitHub Actions.

O workflow padrão é **ARM64**. Também aceita `arch=x86_64` e `arch=arm` para devices que vierem a ser habilitados com essas arquiteturas.

Consulte [docs/github-actions.md](./docs/github-actions.md) para entradas, cache, segredos e limites.

## Publicar no GitHub

```bash
git init
git add .
git commit -m "Initial Giochi System device tree"
git branch -M main
git remote add origin https://github.com/xtrempkch-droid/GIOCHI-SYSTEM.git
git push -u origin main
```

Depois:

1. Abra **Actions** e confirme os workflows `Build Giochi System ARM64` e `Validate device tree`.
2. (Opcional) Configure o secret `GIOCHI_SYSTEM_ROOT_PASSWORD`.
3. Rode o workflow manualmente com `device=all` e `arch=arm64`.
4. Baixe os artefatos em **Actions → execução → Artifacts**.

Este projeto não usa GitHub Pages: ele produz imagens. Para distribuição permanente, anexe os artefatos a uma **Release**.

## Segurança

- A senha padrão de desenvolvimento é `giochi-system`. **Troque antes de distribuir.**
- Em CI, use o secret `GIOCHI_SYSTEM_ROOT_PASSWORD`.
- O `buildroot.config` publicado tem a senha redigida.
- O Giochi System não assina imagens nem implementa atualização OTA.
- Não coloque chaves, tokens ou segredos de produção no rootfs.

Leia [docs/security.md](./docs/security.md) antes de publicar uma imagem.

## Documentação

- [Índice da documentação](./docs/README.md)
- [Arquitetura](./docs/architecture.md)
- [Adicionar um dispositivo](./docs/adding-a-device.md)
- [Build local](./docs/building-locally.md)
- [GitHub Actions](./docs/github-actions.md)
- [Gravação e boot](./docs/flashing.md)
- [Solução de problemas](./docs/troubleshooting.md)
- [Segurança](./docs/security.md)
- [Handoff técnico (AGENTS.md)](./AGENTS.md)

## Limitações atuais

- O build Buildroot completo não foi executado nesta sessão; os scripts, a configuração e a matriz foram validados localmente.
- Powkiddy X55 e Steam Deck são placeholders; não há imagem inicializável para esses hardwares.
- O kernel, bootloader, DTB, firmware e layout de partições de cada handheld precisam ser definidos no `buildrootDefconfig`/fragmento/overlay.
- O CI usa runners padrão do GitHub; builds completos podem ser demorados.
- Não há interface gráfica, emuladores ou camada de jogos.

## Licença

[MIT](./LICENSE). Buildroot é distribuído sob GPL-2.0 e mantém sua própria licença; este repositório apenas o utiliza como ferramenta de build.
