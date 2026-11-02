# Build local

## Requisitos

- Linux nativo, WSL2 (Ubuntu 22.04/24.04) ou container Linux.
- Node.js 20+.
- Bash 4+.
- Espaço em disco: pelo menos **30 GB** livres por device (toolchain + kernel + output).
- Rede para baixar Buildroot e os pacotes.
- Buildroot **não roda nativamente no Windows**. Use WSL2.

> O caminho do repositório pode conter espaços. O script baixa o Buildroot e monta os overlays em `/tmp` por padrão, evitando a limitação de espaços do Buildroot. Ainda assim, caminhos sem espaços são mais seguros.

## Dependências no Ubuntu/WSL

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  autoconf automake bc bison build-essential bzip2 ca-certificates \
  cpio curl device-tree-compiler dosfstools e2fsprogs file flex \
  gettext gperf git help2man libelf-dev libncurses-dev libssl-dev \
  libtool libudev-dev mtools parted patch perl pkg-config python3 \
  python3-dev python3-setuptools rsync swig tar texinfo unzip wget \
  xz-utils
```

## Validar

```bash
node scripts/validate-devices.mjs
node tests/devices.test.mjs
node scripts/list-devices.mjs
```

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
| `ROOT_PASSWORD` | `giochi` | Senha de root da imagem (8–128 caracteres seguros). |
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
