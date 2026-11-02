# AGENTS.md — Giochi System

> Handoff técnico do repositório. Leia antes de continuar o trabalho.
> Atualizado em: 02/11/2026.

## 1. Objetivo do usuário

Criar, no Desktop, a pasta **`Giochi System`** com uma estrutura pronta para publicar no GitHub. O projeto deve:

- ter uma pasta **`device/`** com a lista de dispositivos, configurações e arquivos únicos;
- permitir adicionar dispositivos depois (o usuário citou exemplos como `device/powkiddy x55/` e `device/steamdeck/`);
- ter um **workflow** que construa **Linux ARM64** conforme as configurações da pasta `device/`;
- ter uma pasta **`docs/`** com documentação;
- ter um **`AGENTS.md`** na raiz para que qualquer pessoa continue o processo.

O usuário esclareceu que **os dispositivos ARM serão adicionados depois**. Portanto, a estrutura foi criada com:

- `qemu-aarch64` — device virtual ARM64 **habilitado**, usado como referência e smoke test do pipeline;
- `powkiddy-x55` — placeholder ARM64 **desabilitado**;
- `steamdeck` — placeholder x86_64 **desabilitado** (mantém o modelo pronto para outra arquitetura);
- `_template` — template para novos devices.

## 2. Localização

```text
C:\Users\Jussara dias\Desktop\Giochi System
```

## 3. Estado atual

### Concluído

- Estrutura completa de repositório.
- `device/devices.json` como fonte da verdade da lista e da matriz.
- `device.json` por dispositivo, com validação de schema e arquivos.
- Pasta `device/common/rootfs-overlay/` com arquivos comuns do rootfs.
- Overlays únicos em `qemu-aarch64`, `powkiddy x55`, `steamdeck` e `_template`.
- Buildroot fixado em **2024.02** (`buildroot.version`).
- Script de build Buildroot: `scripts/build-device.sh`.
- Merge de configuração: `scripts/prepare-config.mjs`.
- Validação: `scripts/validate-devices.mjs`.
- Matriz de CI: `scripts/list-devices.mjs`.
- Consulta de metadados de device: `scripts/device-info.mjs`.
- Asserção pós-`olddefconfig`: `scripts/assert-config.mjs` + núcleo em `scripts/lib/assert-config.mjs`.
- Loader/validador reutilizável: `scripts/lib/devices.mjs`.
- Testes em Node.js puro: `tests/devices.test.mjs`, `tests/assert-config.test.mjs` e runner `tests/run-all.mjs`.
- ccache habilitado no build e no CI, com checagem de espaço livre antes de compilar.
- Workflow de build: `.github/workflows/build-linux-arm64.yml`.
- Workflow de validação: `.github/workflows/validate.yml`.
- README raiz e documentação em `docs/`.
- Licença MIT.
- Pasta de dispositivo com espaço (`powkiddy x55`) suportada por staging de overlays em caminho sem espaços.

### Validado nesta sessão

- `node scripts/validate-devices.mjs` passou:
  - 3 devices carregados;
  - 1 habilitado (`qemu-aarch64`);
  - 2 drafts.
- `node tests/devices.test.mjs` passou: **10/10 testes**.
- `node scripts/list-devices.mjs --github-matrix` gerou a matriz com `qemu-aarch64`.
- `scripts/prepare-config.mjs` foi testado com um `.config` falso e os fragmentos reais:
  - aplicou pacotes comuns;
  - aplicou `BR2_TARGET_ROOTFS_EXT2_SIZE="512M"`;
  - desabilitou `BR2_PACKAGE_HOST_QEMU`;
  - preservou overlay existente e anexou os overlays do Giochi System;
  - aplicou hostname, issue, senha e `BR2_DL_DIR`.
- Geração de ícones/Assets não se aplica a este projeto.

### Não executado / pendente

- **Build Buildroot completo** não foi executado nesta máquina (Windows, sem bash/WSL disponível). O workflow foi escrito para Ubuntu 24.04. A primeira execução no GitHub Actions deve ser tratada como validação real do build.
- **`scripts/build-device.sh` nunca foi executado nem passou por `bash -n`.** É o maior risco aberto: erro de sintaxe shell não aparece em revisão visual. Decisão do usuário: testar no primeiro push — ver §19.5.
- **Não há repositório Git local nem remoto.** `git` não está instalado neste ambiente. O usuário ainda precisa criar o repositório no GitHub e enviar os arquivos.
- **Powkiddy X55 e Steam Deck não são inicializáveis.** São placeholders; falta kernel, DTB, U-Boot, firmware, genimage/partições e validação em hardware.
- O workflow não cria GitHub Releases automaticamente; apenas publica artefatos por 14 dias. Para release permanente, anexar manualmente ou criar um job futuro.
- O SHA256 do tarball do Buildroot não está fixado/verificado no script; é uma melhoria de segurança recomendada.
- O `buildroot.config` do artefato é redigido (`BR2_TARGET_GENERIC_ROOT_PASSWD="__REDACTED__"`), mas o `.config` interno em `work/` contém a senha real.
- O caminho local do projeto contém espaço (`Jussara dias`), mas o build local deve ser feito em Linux/WSL com um caminho sem espaços para evitar limitações do Buildroot. O CI usa workspace sem espaços.

## 4. Ambiente da sessão

- Windows.
- Node.js usado: `C:\Users\Jussara dias\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` (v24.21.0).
- Sem `git`.
- Sem `bash` no PATH do Windows; o shell script foi revisado manualmente, mas não executado.
- Acesso à internet disponível durante a sessão (usado para conferir os defconfigs do Buildroot 2024.02).
- O projeto não tem dependências npm; os scripts usam apenas Node built-ins.
- Buildroot 2024.02 foi confirmado para:
  - `qemu_aarch64_virt_defconfig`;
  - `raspberrypi4_64_defconfig` (não usado no projeto, mas referência);
  - `raspberrypi3_64_defconfig` (não usado no projeto, mas referência).

## 5. Estrutura de arquivos

```text
Giochi System/
├── buildroot.version
├── config/
│   └── common.fragment
├── device/
│   ├── devices.json
│   ├── README.md
│   ├── common/rootfs-overlay/
│   │   └── etc/...
│   ├── qemu-aarch64/
│   │   ├── device.json
│   │   ├── buildroot.fragment
│   │   ├── rootfs-overlay/
│   │   └── README.md
│   ├── powkiddy x55/
│   │   ├── device.json
│   │   ├── buildroot.fragment
│   │   ├── rootfs-overlay/
│   │   └── README.md
│   ├── steamdeck/
│   │   ├── device.json
│   │   ├── buildroot.fragment
│   │   ├── rootfs-overlay/
│   │   └── README.md
│   └── _template/
│       ├── device.json
│       ├── buildroot.fragment
│       ├── rootfs-overlay/
│       └── README.md
├── docs/
│   ├── README.md
│   ├── architecture.md
│   ├── adding-a-device.md
│   ├── building-locally.md
│   ├── github-actions.md
│   ├── flashing.md
│   ├── troubleshooting.md
│   ├── security.md
│   └── dependencies-manifest.md
├── scripts/
│   ├── build-device.sh
│   ├── prepare-config.mjs
│   ├── assert-config.mjs
│   ├── validate-devices.mjs
│   ├── list-devices.mjs
│   ├── device-info.mjs
│   └── lib/
│       ├── devices.mjs
│       └── assert-config.mjs
├── tests/
│   ├── devices.test.mjs
│   ├── assert-config.test.mjs
│   └── run-all.mjs
├── .github/workflows/
│   ├── build-linux-arm64.yml
│   └── validate.yml
├── package.json
├── Makefile
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── .gitignore
├── .gitattributes
└── .editorconfig
```

## 6. Modelo de dispositivo

### Índice: `device/devices.json`

```json
{
  "id": "qemu-aarch64",
  "folder": "qemu-aarch64",
  "arch": "arm64",
  "enabled": true
}
```

- `id` é slug (`a-z`, `0-9`, `-`), usado no build, artefatos e CI.
- `folder` é a pasta real e pode conter espaços.
- `arch` deve coincidir com o `device.json`.
- `enabled` controla a entrada no CI. Drafts ficam `false`.

### `device/<pasta>/device.json`

Campos principais:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| `schemaVersion` | sim | 1 |
| `id` | sim | igual ao índice |
| `name` | sim | nome legível |
| `description` | sim | mínimo 10 caracteres |
| `arch` | sim | `arm64`, `x86_64` ou `arm` |
| `hostname` | sim | hostname válido |
| `buildrootDefconfig` | para enabled | ex.: `qemu_aarch64_virt_defconfig` |
| `buildrootFragment` | sim | caminho relativo |
| `rootfsOverlays` | sim | array de diretórios |
| `artifacts` | sim | globs em `output/images` |
| `runner` | sim | ex.: `ubuntu-24.04` |
| `timeoutMinutes` | sim | 60–360 |
| `status` | sim | `ready` ou `draft` |
| `bootNotes` | recomendado | anotações de boot |
| `docs` | sim | README do device |

## 7. Pipeline de build

1. `list-devices.mjs` lê `devices.json`, filtra `enabled` + `arch` e gera a matriz.
2. `build-device.sh <id>`:
   - valida device e `buildrootDefconfig`;
   - baixa Buildroot 2024.02 para `/tmp/giochi-system-cache` (ou cache do CI);
   - extrai em `/tmp/giochi-system-work/<device>`;
   - aplica o defconfig com `make O=<build> <defconfig>`;
   - copia `device/common/rootfs-overlay` e os overlays do device para um staging **sem espaços**;
   - chama `prepare-config.mjs` para mesclar `config/common.fragment` + fragmento do device, hostname, issue, senha, `BR2_DL_DIR` e overlays;
   - roda `make olddefconfig`;
   - roda `scripts/assert-config.mjs` e **falha** se algum símbolo pedido pelos fragmentos desapareceu ou mudou de valor (ver §19);
   - valida `BR2_aarch64=y`/`BR2_x86_64=y`/`BR2_arm=y` e `BR2_ROOTFS_OVERLAY`;
   - compila com `make -j`;
   - copia artefatos, `.config` redigido, `device.json`, fragmento, README, `build-info.txt` e `SHA256SUMS` para `out/<device>/`.
3. O workflow publica `out/<device>` como artefato.

### Por que staging de overlays?

Buildroot separa `BR2_ROOTFS_OVERLAY` por espaços. A pasta `device/powkiddy x55` contém espaço. O script copia cada overlay para `.../giochi-system-overlays/00-common`, `01-device`, etc., e usa esses caminhos sem espaços. **Não remova esse staging** sem substituir por outra solução.

### Por que não sobrescrever `post-build`/`post-image`?

Os defconfigs de placas reais podem depender dos scripts de pós-build/pós-imagem do Buildroot. O `prepare-config` só altera hostname/issue/senha/DL_DIR/OVERLAY; ele **não** toca nesses scripts.

## 8. Workflow

### `.github/workflows/build-linux-arm64.yml`

- `validate`: valida devices e roda testes.
- `discover`: gera a matriz.
- `build`: matriz de jobs, instala dependências, baixa Buildroot, compila, escreve resumo com SHA256 e publica artefato.
- Entradas manuais: `device`, `arch` (arm64/x86_64/arm), `buildroot_version`.
- Cache: `.cache/downloads` + `.cache/buildroot-dl` + `.cache/ccache`.
- O job `build` roda um passo **Free disk space** antes de compilar: remove `/usr/share/dotnet`, `/usr/local/lib/android`, `/opt/ghc`, `/opt/hostedtoolcache/CodeQL`, `/usr/local/share/boost` (~20-25 GB). Sem isso o disco enche no meio do build.
- Secret opcional: `GIOCHI_SYSTEM_ROOT_PASSWORD`.
- `permissions: contents: read`.
- Timeout por device (`timeoutMinutes`, máximo 360).
- Artefatos ficam 14 dias.
- O workflow padrão é ARM64.

### `.github/workflows/validate.yml`

Roda em PRs e pushes de configuração; não compila imagem.

## 9. Comandos

```bash
node scripts/validate-devices.mjs
node tests/run-all.mjs
node scripts/list-devices.mjs
node scripts/list-devices.mjs --github-matrix
node scripts/device-info.mjs qemu-aarch64 json
bash scripts/build-device.sh qemu-aarch64
```

`tests/run-all.mjs` roda todos os testes num só processo. Não use `node --test tests/`:
o runner spawna um processo por arquivo e sob sandbox isso falha com `spawn EPERM`.

Variáveis do build:

- `BUILDROOT_VERSION`
- `ROOT_PASSWORD` (8–128; letras, números, `.`, `-`, `_`, `@`)
- `GIOCHI_SYSTEM_WORK_DIR` (padrão `/tmp/giochi-system-work`)
- `GIOCHI_SYSTEM_CACHE_DIR` (padrão `/tmp/giochi-system-cache`)
- `GIOCHI_SYSTEM_CCACHE_DIR` (padrão `<cache>/ccache`)
- `GIOCHI_SYSTEM_MIN_FREE_GB` (padrão `15`)
- `GIOCHI_SYSTEM_ABORT_FREE_GIB` (padrão `2`) — piso que aborta o build em execução
- `GIOCHI_SYSTEM_DISK_POLL_SECONDS` (padrão `20`)
- `GIOCHI_SYSTEM_GROWTH_LIMIT_MIB` (padrão `4096`) — consumo por intervalo que indica cópia recursiva
- `GIOCHI_SYSTEM_OUT_DIR`
- `JOBS`
- `ALLOW_DRAFT=1`

## 10. Testes realizados

- `node tests/run-all.mjs`: **22/22** (10 de devices + 12 de assert-config).
- `node scripts/validate-devices.mjs`: OK.
- Matriz:
  ```json
  {"include":[{"device":"qemu-aarch64","name":"QEMU AArch64 Virt","arch":"arm64","runner":"ubuntu-24.04","timeout":360}]}
  ```
- `prepare-config.mjs` com `.config` falso: OK, incluindo `BR2_CCACHE*` quando `--ccache-dir` é passado.
- `assert-config.mjs` verificado nos quatro cenários: sobrevive, desaparece, cai de `=y` para `=m`, pedido-desligado-veio-ligado.
- Teste manual do workflow YAML: revisão visual; não há parser YAML instalado. Verificar no GitHub Actions na primeira execução.
- Build Buildroot completo: **não executado** (ambiente Windows sem bash/WSL).

## 11. Adicionar um dispositivo real

1. Copiar `device/_template/` para `device/<nome>/`.
2. Editar `device.json`:
   - id slug;
   - arch;
   - hostname;
   - `buildrootDefconfig` válido no Buildroot 2024.02 ou em árvore externa;
   - artefatos e runner.
3. Editar `buildroot.fragment` com kernel/DTB/U-Boot/genimage/firmware.
4. Colocar arquivos únicos em `rootfs-overlay/`.
5. Registrar em `device/devices.json` com `enabled: false`.
6. Validar.
7. Construir com `ALLOW_DRAFT=1`.
8. Testar em hardware real.
9. Trocar `status` para `ready` e `enabled` para `true`.
10. Commit/push.

### Powkiddy X55

- Pasta: `device/powkiddy x55/`.
- Arch: `arm64`.
- SoC: Rockchip RK3566.
- Pendente: defconfig, kernel, DTS/DTB, U-Boot, genimage, firmware, tela/botões, validação.
- `buildrootDefconfig` está vazio; `enabled: false`.

### Steam Deck

- Pasta: `device/steamdeck/`.
- Arch: `x86_64` (não entra no build ARM64 padrão).
- Pendente: kernel, firmware, áudio, Wi-Fi, Bluetooth, controle, layout de armazenamento/recuperação.
- `buildrootDefconfig` está vazio; `enabled: false`.
- Para construir no futuro: preencher defconfig, `status: ready`, `enabled: true`, rodar workflow com `arch=x86_64`.

## 12. Próximos passos recomendados

1. **Criar o repositório no GitHub** e enviar o projeto (git não está instalado neste ambiente).
2. **Rodar o workflow** manualmente com `device=all`, `arch=arm64` para validar o Buildroot no CI.
3. **Corrigir eventuais erros do primeiro build** (pacotes, tamanho de rootfs, versão Buildroot).
4. **Adicionar o primeiro device ARM real** (por exemplo, Powkiddy X55) com defconfig/kernel/DTB/U-Boot.
5. **Adicionar um artifício de release** para anexar imagens a tags, se desejado.
6. **Fixar SHA256 do tarball do Buildroot** para supply-chain mais forte.
7. **Configurar `GIOCHI_SYSTEM_ROOT_PASSWORD`** e evitar a senha padrão.
8. **Testar imagens em hardware real** antes de publicar.
9. **Adicionar toolchain externa** se o tempo de CI continuar alto mesmo com ccache.
10. **Atualizar a documentação e o README do device** com os resultados reais.

## 13. Decisões e justificativas

- **Buildroot em vez de um fork de distro:** gera kernel/rootfs/imagem com configuração declarativa e funciona em runners x86_64.
- **Node.js nos scripts de metadados/validação:** sem dependências externas, portável e testável.
- **qemu-aarch64 habilitado:** mantém o pipeline executável enquanto os devices ARM reais não existem.
- **Powkiddy/Steam Deck desabilitados:** evita publicar imagens que não inicializam.
- **Pasta com espaço suportada:** atende ao exemplo do usuário (`powkiddy x55`) sem quebrar o Buildroot, via staging.
- **Arquitetura por device:** Steam Deck é x86_64; o workflow filtra por `arch` e o build padrão é arm64.
- **Senha de root via secret:** evita credenciais fixas no Git; fallback documentado para desenvolvimento.
- **Config final redigido no artefato:** evita vazar a senha no `buildroot.config` publicado.

## 14. Decisões de arquitetura (02/11/2026)

O usuário definiu a organização do projeto:

- **Giochi System** (`Giochi System/`, ex-`Linuxlimpo`) é a **área de criação do sistema Linux limpo**. Produz apenas o sistema operacional pronto para cada aparelho — kernel, rootfs, boot, drivers e painel. Sem UI, sem loja.
- **Giochi app** (`Giochi app/`) é a aplicação/camada de experiência, projeto separado que consome as imagens geradas.
- **Giochi os** (`Giochi os/`) é a **área de junção dos dois repositórios**: recebe o sistema vindo de Giochi System e os apps vindos de Giochi app e monta o sistema operacional final por aparelho.
- Cada pasta é **repositório Git individual** e **raiz da sua própria função** — sem imports cruzados, sem leitura implícita de pasta irmã. A comunicação entre elas é sempre por **artefato ou arquivo declarado explicitamente**, nunca por caminho relativo presumido.
- A pasta **`devices`** fica **dentro de `Giochi System`**. Ela contém, para cada aparelho, a configuração e os **fragmentos de driver** (incluindo driver de painel).

### Antecessor: `GIOCHI-KONSOL-OS`

O projeto tem um **antecessor monolítico** público em [github.com/xtrempkch-droid/GIOCHI-KONSOL-OS](https://github.com/xtrempkch-droid/GIOCHI-KONSOL-OS). Ele **não** é o alvo: é a **fonte de fragmentos comprovados** — configurações, caminhos e soluções de build que já funcionaram em hardware real.

O que existe lá (verificado em 02/11/2026):

| Caminho | Conteúdo |
| --- | --- |
| `device/` | Dispositivos reais (mesmo nome de pasta que usamos) |
| `docs/architecture-v1.1.md`, `architecture-v1.2.md` | Spec de arquitetura (35 KB cada) |
| `docs/hardware-e-drivers.md` | Drivers e painel (35 KB) |
| `docs/DEVICES.md`, `APPS.md`, `APP-SDK.md`, `GAMES.md` | Modelos de device e app |
| `docs/BUILD.md`, `BOOT-DEBUG.md` | Pipeline de build e depuração de boot |
| `schemas/` | 7 JSON Schemas (`engines`, `layout`, `settings`, `theme`, `metadata`, `default-games`, `forge`) |
| `apps/`, `Jogos/` | Apps e jogos **dentro do mesmo repo** — o que estamos separando |
| `buildroot/`, `src/`, `tools/`, `tests/`, `assets/` | Build e código |

**Regra ao reaproveitar:** copiar de lá exige conferir que ainda se aplica — é antecessor, não verdade atual. Trechos entram em `device/<pasta>/`, `config/` ou `docs/` só depois de entendidos, nunca por cópia cega.

**Risco de divergência:** o `docs/architecture.md` deste repositório foi escrito sem consultar `architecture-v1.2.md` do antecessor. Se os dois conflitarem, o antecessor tem precedência histórica e a divergência precisa ser resolvida explicitamente, não por omissão.

### Contrato de dependências: `forge.json`

> **Superado.** Os parágrafos seguintes descrevem o desenho inicial em `DEPENDENCIAS.yaml`, **revertido** em favor de `forge.json`. Ficam como registro do raciocínio; a decisão válida está em "DECISÃO" mais abaixo e em [docs/dependencies-manifest.md](docs/dependencies-manifest.md).

O **Giochi app** publica na raiz do seu repositório um arquivo **`DEPENDENCIAS.yaml`** — YAML puro, sem acentuação no nome (o acento quebra com normalização NFC/NFD entre Linux, macOS e `git`). O **Giochi System** consome esse arquivo para gerar o fragmento com as dependências necessárias para os apps funcionarem.

`Giochi System` **não** lê a pasta `Giochi app` por conta própria. O manifesto entra como **input explícito**:

```bash
bash scripts/build-device.sh qemu-aarch64 --apps-manifest ../"Giochi app"/DEPENDENCIAS.yaml
```

Sem o parâmetro, o build gera a **base limpa** e avisa — nunca falha por ausência do manifesto.

Fluxo:

```text
Giochi app ──► DEPENDENCIAS.yaml (publicado, versionado no repo dele)
                        │
                        ▼
Giochi os  ──► busca o manifesto ──► repassa a Giochi System
                        │
                        ▼
Giochi System ──► lê YAML ──► config/apps.fragment ──► build
                        │
                        ▼
Giochi os  ──► junta imagem do sistema + apps ──► imagem final por device
```

A mediação por `Giochi os` preserva a independência: `Giochi System` não conhece URL nem caminho do `Giochi app`; apenas recebe um arquivo.

**CORREÇÃO (02/11/2026 — verificado no antecessor): o modelo acima estava errado.**

O `GIOCHI-KONSOL-OS` **não tem** manifesto de dependências, e o desenho anterior (app declarando `BR2_PACKAGE_*`) não corresponde a nada comprovado. Fatos:

- `metadata.json` do pacote `.giochi` tem `"additionalProperties": false` e as únicas chaves são `title, developer, version, arch, runtime, entrypoint`. Não existe `dependencies`/`requires`/lista de pacotes.
- **App não declara `BR2_PACKAGE_*`.** Quem declara é o `Config.in` do pacote de sistema, via `select`. Exemplo literal de `giochi-launcher/Config.in`: `select BR2_PACKAGE_SDL2`. E `giochi-portmaster/Config.in` declara `select BR2_PACKAGE_BASH LIBCURL ZIP` — "exigências de runtime" do app, mas escritas pelo **sistema**.

O acoplamento real estava em três mecanismos separados:

| Mecanismo | Lado | Papel |
| --- | --- | --- |
| `forge.json` (JSON Schema draft-07) | **app**, na raiz do projeto Godot, **fora** do pacote | requisitos: `arch`, `runtime`, `graphics_api_min`, `graphics_api_fallback`, `godot_version`, `ram_min_mb`, `vram_min_mb`, `display_min_width/height`, `touchscreen_required` |
| `device_profile.json` | **sistema**, publicado em `/user/.giochi/`, regenerado a cada boot | capacidades: `soc`, `cpu.*`, `gpu.*`, `ram_mb`, `vram_mb`, `graphics_api.*`, `display.*`, `engine.godot_min/max`, `input.*`, `proton.*` |
| `Config.in` + `select` | **sistema** | dependência real de pacote Buildroot |

A compatibilidade é **calculada**, não declarada: compara `forge.json` × `device_profile.json` → `Compatível` / `Parcial` / `Incompatível`, com `NEAR_LIMIT_RATIO = 0.80` (80–100% de um recurso vira "Parcial", risco de swap). Veredito é o pior caso, listando **todas** as exigências não atendidas.

**Consequência para o desenho:** o manifesto correto declara **capacidade exigida**, não pacote. Um app não deve escolher símbolo Buildroot — ele não conhece o empacotamento do sistema, e `BR2_PACKAGE_*` quebra a abstração de arquitetura. As dependências de pacote pertencem ao `Giochi System`, que sabe quais pacotes a imagem tem.

**Limitação herdada a resolver:** o `device_profile.json` **não tem JSON Schema** no antecessor — é validado só no código Python (`profile.py`). O schema não existe em `schemas/`.

**DECISÃO (02/11/2026): adotar `forge.json`.** O YAML próprio fica revertido — o arquivo **não** se chama `DEPENDENCIAS.yaml`. Motivo: o antecessor já tem formato **e validador** testados; reescrever o validador em YAML custaria meses de bugs silenciosos. O contrato completo está em [docs/dependencies-manifest.md](docs/dependencies-manifest.md). O que continua pendente é o `device_profile.json` (o lado do sistema), que o antecessor **não** tinha schema — validava só em Python.

**Estado:** nada implementado. `Giochi app/` e `Giochi os/` estão **vazias**. `build-device.sh` não aceita `--apps-manifest`.

**Estado:** a pasta de devices existente hoje é **`device/`** (singular). O usuário chamou de "devices". Nenhuma renomeação foi feita ainda — renomear exige atualizar `devices.json`, todos os paths de `device.json`, os scripts em `scripts/lib/`, os workflows e a documentação.

**Renomeação Linuxlimpo → Giochi System (concluída em 02/11/2026):**

- `package.json` → `giochi-system`; `LICENSE` → "Giochi System contributors".
- Preview de senha de root padrão: `giochi` (antes `linuxlimpo`).
- Variáveis: `LINUXLIPPO_*` → `GIOCHI_SYSTEM_*` (`ROOT_PASSWORD`, `WORK_DIR`, `CACHE_DIR`, `OUT_DIR`, `VERSION`).
- Secret do CI: `GIOCHI_SYSTEM_ROOT_PASSWORD`. **Precisa ser criado de novo no GitHub** — o secret antigo não é lido.
- Pastas/files do rootfs: `etc/linuxlimpo/` → `etc/giochi-system/`, `linuxlimpo-release` → `giochi-system-release`, `profile.d/linuxlimpo.sh` → `profile.d/giochi-system.sh`.
- Staging de overlays: `linuxlimpo-overlays` → `giochi-system-overlays`.
- Hostnames: `giochi-system-qemu`, `giochi-system-x55`, `giochi-system-steamdeck`, `giochi-system-example`.
- Workflow, artefatos e caches: prefixo `giochi-system-`.
- O nome do arquivo de workflow (`.github/workflows/build-linux-arm64.yml`) **não** foi renomeado.

**Camada de drivers/painel foi apenas documentada** (não implementada) em `docs/architecture.md` e `device/README.md`. Os campos `buildrootFragments`, `kernelPatches` e `firmwareFiles` em `device.json` estão especificados mas o `validate-devices.mjs` e o `build-device.sh` ainda **não** os consomem.

## 15. Limitações conhecidas

- Build completo não validado nesta sessão.
- Nenhum repositório Git/remote.
- Placeholders de Powkiddy/Steam Deck não são imagens funcionais.
- `qemu-aarch64` é referência, não hardware de produção.
- Sem assinatura de imagem, OTA ou atualização.
- Sem SHA256 fixo do tarball Buildroot.
- Sem parser YAML no ambiente; workflow validado visualmente e deverá ser testado no GitHub.
- O `.config` interno em `work/` contém a senha real; não publique `work/`.
- `buildroot.config` no artefato é redigido; o hash do SHA256SUMS é do arquivo redigido, não do `.config` real.

## 16. Como retomar

```bash
cd "C:\Users\Jussara dias\Desktop\Giochi System"
node scripts/validate-devices.mjs
node tests/run-all.mjs
node scripts/list-devices.mjs --github-matrix
```

Para build real:

```bash
# Em Linux/WSL2, clone/copie para um caminho sem espaços
cd ~/giochi-system
bash scripts/build-device.sh qemu-aarch64
```

Para publicar no GitHub:

```bash
git init
git add .
git commit -m "Initial Giochi System device tree"
git branch -M main
git remote add origin https://github.com/xtrempkch-droid/GIOCHI-SYSTEM.git
git push -u origin main
```

Depois, no GitHub:

1. Actions → **Build Giochi System ARM64** → Run workflow.
2. `device=all`, `arch=arm64`.
3. Configurar `GIOCHI_SYSTEM_ROOT_PASSWORD` (opcional, recomendado).
4. Baixar artefato.

## 17. Arquivos que não devem ser commitados

- `out/`, `work/`, `.cache/` (builds locais);
- imagens `.img`, `.ext4`, `.ext2`;
- logs;
- `.env`/segredos;
- `node_modules/` (não usado hoje).

O `.gitignore` cobre esses casos.

## 18. Contato com o pedido original

O usuário pediu explicitamente:

- pasta `Giochi System` no Desktop — **criada**;
- estrutura para GitHub — **criada**;
- pasta `device` com dispositivos/configurações/arquivos únicos — **criada**, com `qemu-aarch64`, `powkiddy x55`, `steamdeck` e template;
- workflow para criar Linux ARM64 conforme devices — **criado**;
- pasta `docs` — **criada**;
- `AGENTS.md` na raiz — **criado**.

## 19. Blindagem do build (02/11/2026)

Três falhas silenciosas foram fechadas. Todas têm o mesmo formato: o build fica **verde** e entrega uma imagem errada, sem nenhuma mensagem de erro.

### 19.1 `olddefconfig` descartando símbolos

O Buildroot descarta símbolo em silêncio quando o nome não existe, quando ele virou legacy, ou quando o pai está unset. Sintoma real no antecessor: imagem sem áudio porque `CONFIG_SND_SOC_ROCKCHIP_I2S=y` caiu sem aviso.

Correção: [`scripts/assert-config.mjs`](scripts/assert-config.mjs) roda depois do `olddefconfig` e **falha o build** listando cada símbolo que desapareceu ou mudou de valor. Núcleo testável em [`scripts/lib/assert-config.mjs`](scripts/lib/assert-config.mjs), 12 testes em [`tests/assert-config.test.mjs`](tests/assert-config.test.mjs).

Exceção justificada, escrita no próprio fragmento:

```make
# giochi-system:allow-drop BR2_PACKAGE_MESA3D motivo curto
```

Regra: **não** silencie com `allow-drop` sem escrever o motivo. O ponto da checagem é justamente impedir que um símbolo suma sem ninguém notar.

### 19.2 ccache

O antecessor não tinha ccache e o build levava 1–3 h. Agora:

- `build-device.sh` detecta `ccache` no PATH e passa `--ccache-dir` para o `prepare-config`;
- `prepare-config.mjs` emite `BR2_CCACHE=y`, `BR2_CCACHE_DIR` e **`BR2_CCACHE_USE_BASEDIR=y`** — sem o último, o cache do CI nunca acerta, porque cada runner monta o repositório num caminho absoluto diferente;
- o workflow instala `ccache`, cacheia `.cache/ccache` com chave por device + versão do Buildroot, e expõe `GIOCHI_SYSTEM_CCACHE_DIR`.

Sem `ccache` instalado o build continua, apenas avisa.

### 19.3 Cópia recursiva enchendo o disco

**Este foi o bug real** — não era só "disco pequeno". Uma pasta copiava o repositório inteiro para dentro de si mesma, em loop. O disco enchia progressivamente e o build morria horas depois sem mensagem que ligasse o sintoma à causa. No antecessor isso gerou uma árvore de **66 GB** e o build travou em `Syncing from source dir`.

Mecanismo: `SITE_METHOD = local` com `SITE` apontando para a raiz do repositório, quando o diretório de saída fica **dentro** dele. O rsync copia o próprio `output/`, que na volta seguinte é copiado de novo — crescimento exponencial.

Três defesas implementadas:

1. **Piso de espaço livre** — `build-device.sh` aborta antes de começar se houver menos de `GIOCHI_SYSTEM_MIN_FREE_GB` (padrão **15**). Falha em 2 s em vez de 3 h.
2. **Monitor de disco durante o build** — mede o espaço a cada `GIOCHI_SYSTEM_DISK_POLL_SECONDS` (padrão 20 s) e aborta por dois critérios:
   - espaço livre abaixo de `GIOCHI_SYSTEM_ABORT_FREE_GIB` (padrão 2);
   - consumo acima de `GIOCHI_SYSTEM_GROWTH_LIMIT_MIB` (padrão 4096) num único intervalo — **isso pega a espiral mesmo com disco grande**, que era o caso original.
   O `make` roda sob `setsid`, então o `kill` derruba também os compiladores filhos. A mensagem de erro aponta a causa provável em vez de só dizer "falhou".
3. **Aviso de aninhamento** — se `BUILD_DIR` ou `OUT_DIR` estiver dentro do repositório, o script avisa que a combinação com `SITE_METHOD = local` produz a recursão.

**Ao empacotar o `Giochi app` como fonte local, isso volta:** use um snapshot congelado das fontes (ex.: `out/<device>/pkg-src`) e aponte `SITE` para ele, **nunca** para a raiz do repositório. Ver `docs/troubleshooting.md`, seção "Cópia recursiva".
4. **Free disk space no CI** — o workflow remove `/usr/share/dotnet`, `/usr/local/lib/android`, `/opt/ghc`, `/opt/hostedtoolcache/CodeQL`, `/usr/local/share/boost` (~20–25 GB que o runner traz e este build não usa).

### 19.4 Runner de testes

`node --test tests/` **não funciona** no ambiente com sandbox: o runner spawna um processo por arquivo e recebe `EPERM`. Use `node tests/run-all.mjs`, que importa todos os arquivos num processo só. É o comando usado no `package.json` e nos dois workflows.

### 19.5 O que ainda NÃO foi executado — testar no primeiro push

**Decisão do usuário (02/11/2026): não testar localmente, é perda de tempo. Validar quando o repositório subir para o GitHub.**

Este ambiente é Windows **sem `bash`**. Nada em `scripts/build-device.sh` foi executado nem passou por `bash -n`. O código foi apenas revisado à mão. Ordem de teste sugerida no primeiro push:

| # | O que testar | Como | Sinal de sucesso |
| --- | --- | --- | --- |
| 1 | Sintaxe do shell | `bash -n scripts/build-device.sh` (WSL ou CI) | sai com 0, sem mensagem |
| 2 | Parser de config | `node scripts/prepare-config.mjs --config <fake> --hostname x --root-password senha12345 --dl-dir /tmp/dl --fragment config/common.fragment` | `.config` contém `BR2_CCACHE` e `BR2_ROOTFS_OVERLAY` |
| 3 | Asserção de símbolos | `node tests/run-all.mjs` | 22/22 |
| 4 | Workflow de validação | push em PR | job `Validate device tree` verde |
| 5 | Build real | Actions → run com `device=qemu-aarch64`, `arch=arm64` | artefato `giochi-system-qemu-aarch64` publicado |
| 6 | **Monitor de disco** | ver abaixo | aborta com mensagem de cópia recursiva |
| 7 | ccache | rodar o build **duas vezes** | segunda execução bem mais rápida; `.cache/ccache` não vazio |

**Teste do monitor de disco (item 6)** — só faz sentido se você quiser provar que ele funciona antes de confiar:

```bash
# Simula a espiral sem esperar 3 h: limite baixo + arquivo grande em loop
GIOCHI_SYSTEM_GROWTH_LIMIT_MIB=64 \
GIOCHI_SYSTEM_ABORT_FREE_GIB=1 \
bash scripts/build-device.sh qemu-aarch64
```

Antes disso, dentro de `work/qemu-aarch64/`, rode um laço que escreve arquivos grandes para forçar o consumo. Se o monitor estiver correto, o build para em ≤20 s com "padrão de cópia recursiva".

**Prioridade:** os itens 1–4 são baratos e pegam erro de sintaxe — que é o risco real, porque esse código nunca rodou. Os itens 5–7 validam o comportamento.
