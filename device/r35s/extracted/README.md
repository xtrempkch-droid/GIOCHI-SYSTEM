# Artefatos extraídos do R35S — 06/11/2026

Tudo aqui saiu **do aparelho**, pela console serial, depois da solda no TTL. Não é
cópia de receita nem dedução: é o que o hardware reportou.

O firmware que estava no cartão é ROCKNIX (`20261101`, kernel vendor `7.1.2`), não
o nosso. Serve como **fonte de fatos** sobre o hardware, não como configuração a
copiar — o nosso kernel é mainline 6.12.

## `kernel-config.gz` (41 849 bytes)

`/proc/config.gz` do kernel **que boota nesta placa**.

```text
md5  93bf213f1cbaed4f5867236cdfb4c13c
```

Extraído por `docker/serial-pull.py`, que **verifica o md5 dos dois lados** e se
recusa a gravar quando divergem — um gzip corrompido abre com mensagem que não
aponta para o transporte.

Ler:

```bash
gunzip -c device/r35s/extracted/kernel-config.gz | grep -E '^CONFIG_(DRM|MMC|SND)'
```

Uso: é a referência de quais drivers este hardware **precisa**. O
`device/r35s/linux.fragment` saiu daqui, com cada símbolo conferido contra o
Kconfig do 6.12 (63 de 63 existem; `ROCKCHIP_CPUINFO` foi removido no 6.12 e
ficou de fora — §12.9).

## `os-release.txt` (341 bytes)

```text
OS_NAME="ROCKNIX"
OS_VERSION="20261101"
OS_BUILD="official"
```

Verificação de que o firmware é o oficial e de que a extração não truncou (o
tamanho bate com o `wc -c` do aparelho).

## O que NÃO está aqui, e por quê

| Artefato | Por que não |
| --- | --- |
| `KERNEL` (24 MB) e `SYSTEM` (1,24 GB) | binários de um sistema que não é o nosso; baixar 1,2 GB por serial a 6 kB/s levaria 2 dias |
| `boot.scr` (3,3 kB) | é do U-Boot do vendor; só teria valor se fôssemos reusar o carregador dele |
| módulos `.ko` | compilados para o kernel 7.1.2 — `vermagic` diferente, não carregam no 6.12. O que importa são os **fontes**, vendorizados em `../kernel-modules/` |
| DTB | já versionado em `../dts/`, e o `compatible` da unidade é idêntico ao do arquivo |

## Fatos medidos que vivem nos documentos, não em arquivo

Estão em [`../README.md`](../README.md) e no `AGENTS.md` §13-A, para não
duplicar: linha de comando, painel, entrada, memória e layout do cartão.
