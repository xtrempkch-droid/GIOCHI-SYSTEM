# Build local

## Requisitos

- Linux nativo, WSL2 (Ubuntu 22.04/24.04) ou container Linux.
- Node.js 20+.
- Bash 4+.
- Espaço em disco: pelo menos **30 GB** livres por device (toolchain + kernel + output).
- Rede para baixar Buildroot e os pacotes.
- Buildroot **não roda nativamente no Windows**. Use WSL2.

> O caminho do repositório pode conter espaços. O script baixa o Buildroot e monta os overlays em `/tmp` por padrão, evitando a limitação de espaços do Buildroot. Ainda assim, caminhos sem espaços são mais seguros.

## Antes de tudo: auditar o host

```bash
bash scripts/check-host.sh        # ou: make check
```

O script não instala nada e não precisa de root. Ele confere sistema, bash,
Node.js, os 36 comandos que o Buildroot usa, os headers de desenvolvimento
(`libssl`, `ncurses`, `libelf`, `libudev`, `zlib`), `ccache`, espaço em disco,
o hash fixado do tarball e se o download está alcançável — e imprime o
`apt-get install` exato que resolve o que falta.

Falha aqui custa dois segundos. A mesma falha descoberta no meio de um build
custa a compilação inteira: `bison`/`flex`/`gperf` morrem nos host tools, `dtc`
morre na compilação dos DTBs, `libelf` morre no `objtool` do kernel.

## Dependências no Ubuntu/WSL

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  autoconf automake bc bison build-essential bzip2 ca-certificates \
  ccache cpio curl device-tree-compiler dosfstools e2fsprogs file flex \
  gawk gettext gperf git help2man libelf-dev libncurses-dev libssl-dev \
  libtool libudev-dev mtools parted patch perl pkg-config python3 \
  python3-dev python3-setuptools rsync swig tar texinfo unzip wget \
  xz-utils zlib1g-dev
```

## Sem root: build em container

Se você não pode instalar pacotes no host (ou não tem `sudo`), use o builder:

```bash
bash scripts/build-in-container.sh --check     # audita dentro do container
bash scripts/build-in-container.sh qemu-aarch64 # build completo
bash scripts/build-in-container.sh --shell      # shell para investigar
```

A imagem `giochi-builder` é definida em
[`docker/builder.Dockerfile`](../docker/builder.Dockerfile) e traz a mesma lista
de dependências que `check-host.sh` audita, mais Node.js 24 e `ccache`. O
container roda com o seu UID/GID, então `out/` e `work/` não ficam com dono
errado.

| Caminho no host | Dentro do container | Papel |
| --- | --- | --- |
| o repositório | `/work` | código e `out/<device>` |
| `~/.cache/giochi-system` | `/cache` | downloads, `work/`, ccache |

Como o cache fica no host, um rebuild não baixa o Buildroot nem os pacotes de
novo. Ajuste com `GIOCHI_CONTAINER_CACHE` e a tag com `GIOCHI_BUILDER_IMAGE`.


## Validar

```bash
node scripts/validate-devices.mjs
node tests/run-all.mjs        # 486 testes, um processo só
node scripts/list-devices.mjs
```

**Não use `node --test tests/`:** o runner spawna um processo por arquivo e sob
sandbox falha com `spawn EPERM`. Use `tests/run-all.mjs`, que importa tudo num
processo só — é o que o `package.json` e os dois workflows usam.

## Construir

```bash
bash scripts/build-device.sh qemu-aarch64
```

O primeiro build baixa o Buildroot e compila a toolchain interna; pode levar de 45 minutos a algumas horas. Builds seguintes reaproveitam o cache de downloads.

Saída:

```text
out/qemu-aarch64/
├── Image
├── rootfs.ext4
├── buildroot.config
├── build-info.txt
├── SHA256SUMS
└── ...
```

## Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `BUILDROOT_VERSION` | conteúdo de `buildroot.version` | Fixa outra versão do Buildroot. |
| `ROOT_PASSWORD` | `giochi-dev` | Senha de root da imagem (8–128 caracteres seguros). |
| `GIOCHI_SYSTEM_WORK_DIR` | `/tmp/giochi-system-work` | Diretório de extração/build. |
| `GIOCHI_SYSTEM_CACHE_DIR` | `/tmp/giochi-system-cache` | Downloads e cache do Buildroot. |
| `GIOCHI_SYSTEM_CCACHE_DIR` | `<cache>/ccache` | Cache de compilação. Vazio desabilita `BR2_CCACHE`. |
| `GIOCHI_SYSTEM_MIN_FREE_GB` | `15` | Espaço livre mínimo exigido antes de começar. |
| `GIOCHI_SYSTEM_OUT_DIR` | `<repo>/out/<device>` | Destino dos artefatos. |
| `JOBS` | `nproc` | Paralelismo do `make`. |
| `ALLOW_DRAFT` | `0` | `1` permite tentar um device draft. |

### Espaço em disco e ccache

Um build completo consome cerca de **15 GiB**. O script mede o espaço livre antes de começar e aborta na hora se faltar — sem isso o build roda por horas e morre no meio com um erro que não explica a causa.

Para builds repetidos, instale `ccache`. Sem ele o script avisa e continua; com ele, o rebuild cai de horas para minutos. Localmente:

```bash
# Debian/Ubuntu
sudo apt-get install -y ccache
```

No GitHub Actions o `ccache` já é instalado e o cache `.cache/ccache` é preservado entre execuções.


Exemplo:

```bash
ROOT_PASSWORD='MinhaSenhaForte123' \
GIOCHI_SYSTEM_CACHE_DIR="$HOME/.cache/giochi-system" \
JOBS=8 \
bash scripts/build-device.sh qemu-aarch64
```

## Build de um device draft

```bash
ALLOW_DRAFT=1 bash scripts/build-device.sh "powkiddy-x55"
```

Isso só funciona depois que `buildrootDefconfig` estiver preenchido.

## Limpeza

```bash
rm -rf out work .cache
# ou
make clean
```

O `make clean` não remove o código-fonte.

## Build em container (opcional)

Se você não quiser instalar as dependências no host, rode em um container Ubuntu 24.04 com o repositório montado e execute os mesmos comandos. O Buildroot não precisa de privilégios extras.

## Logs

- `work/<device>/defconfig.log` — aplicação do defconfig.
- `work/<device>/olddefconfig.log` — resolução do Kconfig.
- `work/<device>/build.log` — compilação completa.

Em caso de falha, o script imprime as últimas 160 linhas do log.
