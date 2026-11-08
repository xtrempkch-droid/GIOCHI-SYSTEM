# GitHub Actions

## Workflows

### `build-linux-arm64.yml`

Workflow principal. Gera uma imagem por device habilitado.

Dispara em:

- push na `main` que altere `device/`, `config/`, `scripts/` ou `buildroot.version`;
- execução manual (`workflow_dispatch`).

Entradas manuais:

| Entrada | Padrão | Descrição |
| --- | --- | --- |
| `device` | `all` | ID do device ou `all`. |
| `arch` | `arm64` | `arm64`, `x86_64` ou `arm`. |
| `buildroot_version` | vazio | Sobrescreve `buildroot.version` para um teste pontual. |
| `allow_draft` | `false` | Constrói um **rascunho** que já declare `buildrootDefconfig`. Só vale junto com `device=<id>`; `device=all` nunca puxa rascunho. |

### Rascunhos: por que existe `allow_draft`

Aparelho em `draft` fica `enabled: false` e não entra na matriz — é o que impede
publicar imagem que não boota. Mas é preciso poder **tentar** o build antes de
declarar o aparelho pronto, senão a única opção seria mentir no `devices.json`.

`allow_draft: true` + `device=powkiddy-x55` inclui aquele rascunho específico,
desde que ele declare `buildrootDefconfig`. Sem defconfig o job falharia antes de
começar, então ele simplesmente não entra.

Localmente o equivalente é `ALLOW_DRAFT=1 bash scripts/build-device.sh <id>`, e a
matriz responde a `--allow-draft`.

Etapas:

1. **validate** — roda `validate-devices.mjs` e os testes.
2. **discover** — gera a matriz JSON a partir de `device/devices.json`.
3. **build** — matriz de jobs; cada job usa o runner, timeout e defconfig do device.
4. **upload** — publica `out/<device>/` como artefato do Actions.

### `validate.yml`

Workflow leve para pull requests e pushes que não precisam gerar imagem. Roda validação, testes e imprime a matriz.

## Matriz

A matriz é gerada por:

```bash
node scripts/list-devices.mjs --github-matrix --arch arm64 --device all
```

Exemplo de saída:

```json
{
  "include": [
    {
      "device": "qemu-aarch64",
      "name": "QEMU AArch64 Virt",
      "arch": "arm64",
      "runner": "ubuntu-24.04",
      "timeout": 300
    }
  ]
}
```

Somente devices com `enabled: true`, `status: "ready"` e `buildrootDefconfig` preenchido entram na matriz.

## Artefatos

Cada job publica um artefato `giochi-system-<device>` contendo:

```text
Image / sdcard.img / rootfs.ext4 ...
buildroot.config
device.json
buildroot.fragment
DEVICE.md
build-info.txt
SHA256SUMS
```

Os artefatos ficam disponíveis por 14 dias. Para uma release permanente, baixe o artefato e anexe os arquivos a uma release do GitHub.

## Cache

O workflow usa `actions/cache` para:

- `.cache/downloads` — tarball do Buildroot;
- `.cache/dl` — fontes e pacotes baixados pelo Buildroot (`BR2_DL_DIR`).

> O diretório do segundo item é `dl`, não `buildroot-dl`: é o que
> `build-device.sh` passa em `--dl-dir` (`$GIOCHI_SYSTEM_CACHE_DIR/dl`). Com o
> nome errado aqui e no workflow, o cache era salvo e restaurado vazio, e todo
> build baixava tudo de novo — sem erro nenhum, só lento.

A chave é **estável** — `giochi-system-<device>-<versão>` —, sem `hashFiles`.

A versão anterior usava hash de `device/`, `config/` e `buildroot.version`. O
efeito era o oposto do desejado: toda alteração de fragmento trocava a chave, o
cache nunca era restaurado, e **todo** build era frio — baixando o Buildroot e os
tarballs de novo. Cache do Actions é imutável: chave estável restaura sempre e só
salva na primeira vez.

O ccache usa o mesmo princípio, e depende de `BR2_CCACHE_USE_BASEDIR=y` para o
cache não amarrar no caminho absoluto do workspace.

## Armadilhas já pagas neste workflow

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `discover` falha em 1 s com `Dispositivo desabilitado` | entrada `boolean` chega como **string**, e `'true' == true` é falso em expressão do Actions → `ALLOW_DRAFT=0` | entrada virou `choice false/true`; quem lê aceita `1/true/yes/on` |
| todo build baixa tudo de novo | chave de cache com `hashFiles` | chave estável por device + versão |
| build morre no meio por disco cheio | runner traz ~20–25 GB de SDKs que o build não usa | passo *Free disk space* |
| push novo mata o build em andamento | `cancel-in-progress: true` | de propósito: sem isso a fila nunca esvazia |

## Histórico de execuções (02/11/2026)

| Run | Evento | Resultado |
| --- | --- | --- |
| #14 | push | falhou — *Build image* morreu em 3 s (causa não diagnosticada; o log exige token) |
| #15 | push | **sucesso** — 22 min 45 s, artefato `giochi-system-qemu-aarch64` |
| #17 | dispatch `powkiddy-x55` | falhou em 1 s — armadilha do `allow_draft` acima |

O log de um job **não é público**: `GET /repos/{owner}/{repo}/actions/jobs/{id}/logs`
devolve 403 sem autenticação. Para ler de fora do navegador: `gh run view
--log-failed`.

## Segredos

O workflow lê opcionalmente:

- `GIOCHI_SYSTEM_ROOT_PASSWORD` — senha de root das imagens.

Configure em **Settings → Secrets and variables → Actions → New repository secret**. Se o secret não existir, o build usa `giochi-system` (documentado e inseguro para produção).

O valor não é impresso nos logs nem escrito no `build-info.txt`. O `.config` usado no build contém a senha, mas o `buildroot.config` copiado para o artefato tem a linha `BR2_TARGET_GENERIC_ROOT_PASSWD` **redigida** para `"__REDACTED__"`. Ainda assim, trate logs e artefatos como materiais de distribuição e revise-os antes de publicar uma release.

## Tempo e limites

- O job tem timeout definido em `device.json` (`timeoutMinutes`), limitado pelo script a 360 minutos.
- O Buildroot com toolchain interna é a etapa mais demorada.
- O GitHub Actions pode cancelar jobs com mais de 6 horas; por isso o limite é 360 minutos.
- Se o build crescer, considere uma toolchain externa ou um runner self-hosted.

## Habilitar no GitHub

1. Crie o repositório e envie a branch `main`.
2. Abra **Actions** e confirme que os workflows aparecem.
3. (Opcional) Configure `GIOCHI_SYSTEM_ROOT_PASSWORD`.
4. Rode **Build Giochi System ARM64** manualmente com `device=all`.
5. Baixe o artefato em **Actions → execução → Artifacts**.

## Observação sobre Pages

Este projeto gera imagens, não um site. O GitHub Pages não é necessário. Use **Releases** ou os **Artifacts** do Actions para distribuir as imagens.
