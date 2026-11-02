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
- `.cache/buildroot-dl` — fontes e pacotes baixados pelo Buildroot.

A chave inclui device, versão do Buildroot e hash de `device/`, `config/` e `buildroot.version`. O primeiro build de cada combinação ainda baixa e compila tudo.

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
