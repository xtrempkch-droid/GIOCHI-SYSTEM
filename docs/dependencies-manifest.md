# Contrato de dependências — `forge.json`

Contrato entre os três repositórios do projeto Giochi.

## Decisão (02/11/2026)

**Adotar `forge.json`**, o formato JSON + JSON Schema do antecessor `GIOCHI-KONSOL-OS`, em vez de um `DEPENDENCIAS.yaml` próprio.

Motivo: o antecessor já tem o formato **e o validador** escritos e testados. Um YAML próprio obrigaria a reescrever o validador do zero, e validador novo erra em silêncio nos primeiros meses — exatamente o tipo de falha que este projeto já pagou caro para descobrir.

Consequência: a escolha anterior por YAML fica revertida. O arquivo **não** se chama `DEPENDENCIAS.yaml`.

## Quem publica, quem lê

| Repositório | Papel |
| --- | --- |
| **Giochi app** | **Publica** `forge.json` na raiz do projeto do jogo. É a fonte da verdade dos requisitos. |
| **Giochi os** | **Busca e repassa** o manifesto. É o ponto de junção dos dois repositórios. |
| **Giochi System** | **Lê** o `forge.json` e valida contra o perfil do device. Nunca busca o arquivo sozinho. |

`Giochi System` não conhece URL nem caminho do `Giochi app`. O manifesto entra como parâmetro explícito.

## O que o app declara

`forge.json` **não** lista pacotes. Declara **capacidade exigida**:

| Chave | Tipo | Valores |
| --- | --- | --- |
| `arch` | enum | `aarch64` |
| `runtime` | enum | `godot` \| `retroarch` \| `proton` |
| `graphics_api_min` | enum | `gles2` \| `gles3` \| `vulkan` |
| `graphics_api_fallback` | enum | `gles2` \| `gles3` |
| `godot_version` | string | `^[0-9]+\.[0-9]+$` |
| `ram_min_mb` | inteiro ≥ 0 | |
| `vram_min_mb` | inteiro ≥ 0 | |
| `display_min_width` | inteiro ≥ 0 | |
| `display_min_height` | inteiro ≥ 0 | |
| `touchscreen_required` | booleano | |

Todas as chaves são **opcionais** e `additionalProperties: false`. Defaults do classificador: `arch=aarch64`, `runtime=godot`, `graphics_api_min=gles3`, `fallback=gles2`, `ram/vram=0`, `touchscreen=false`.

## Por que pacote Buildroot NÃO entra aqui

Um app não escolhe `BR2_PACKAGE_*` porque:

1. **Não conhece o empacotamento do sistema.** `BR2_PACKAGE_LIBMPG123` não existe — o certo é `BR2_PACKAGE_MPG123`. E o Buildroot **descarta símbolo inexistente em silêncio**: build verde, biblioteca ausente.
2. **Quebra a abstração de arquitetura.** `arch` é enum de um valor só (`aarch64`). O app declara o que precisa, não como compilar.
3. **Quem sabe o que a imagem tem é o `Giochi System`.** As dependências de pacote ficam no `Config.in` do pacote de sistema, via `select` — igual ao antecessor, onde `giochi-portmaster/Config.in` declara `select BR2_PACKAGE_BASH LIBCURL ZIP`.

## O lado do sistema: `device_profile.json`

O `Giochi System` precisa publicar as **capacidades** do aparelho para haver o que comparar. No antecessor esse arquivo vive em `/user/.giochi/device_profile.json` e é regenerado a cada boot pelo `giochi-init`.

Campos obrigatórios: `device_id`, `soc`, `cpu.arch`, `cpu.cores`, `cpu.model`, `cpu.max_mhz`, `gpu.model`, `gpu.driver`, `gpu.gles_max`, `ram_mb`, `vram_mb`, `storage.user_free_mb`, `os.version`, `os.kernel`, `input.touchscreen`, `input.gamepad`, `display.width`, `display.height`, `engine.godot_min`, `engine.godot_max`.

Opcionais: `graphics_api.{gles3,gles2,vulkan}`, `display.refresh_hz` (60), `engine.renderer` (`compatibility`), `network.{wifi_usb,bluetooth_usb,integrated}`, `proton.{supported,reason}`.

`schema_version` é `"1.0"` e só o major é checado.

**Lacuna herdada:** esse arquivo **não tem JSON Schema** no antecessor — é validado só no código Python (`profile.py`). Formalizar o schema é trabalho novo e vale a pena fazer aqui.

## Verdicto de compatibilidade

O veredito é **calculado**, nunca declarado. Compara `forge.json` × `device_profile.json`:

- `Compatível` — atende tudo;
- `Parcial` — algo entre 80% e 100% do recurso (`NEAR_LIMIT_RATIO = 0.80`), sinalizado como risco de swap;
- `Incompatível` — alguma exigência não atendida.

O veredito é o **pior caso** e lista **todas** as exigências não atendidas, nunca só a primeira. `vulkan` em `graphics_api_min` é sempre incompatível: o aparelho só tem GLES 3.0/2.0.

## Estado

Nada implementado. `Giochi app/` e `Giochi os/` estão **vazias**. Não existe `forge.json` neste repositório, e `build-device.sh` ainda não aceita `--apps-manifest`.

## O que falta decidir depois

O `Giochi System` ainda não gera `device_profile.json`. Sem ele não há com o que comparar, então o próximo passo natural é: schema do `device_profile.json` → gerador a partir de `device.json` → leitor de `forge.json`.
