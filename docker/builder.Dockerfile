# Host de build do Giochi System.
#
# Existe porque as dependências do Buildroot no host exigem root
# (`apt-get install`) e um build nunca deve depender de privilégio no host.
# A lista abaixo é a mesma que `scripts/check-host.sh` audita, mais Node.js
# (scripts de metadados, que o CI também usa) e ccache.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# Dependências do Buildroot (Buildroot manual §2.2) + as deste repositório.
RUN apt-get update && apt-get install -y --no-install-recommends \
        autoconf automake bc bison build-essential bzip2 ca-certificates \
        ccache cpio curl device-tree-compiler dosfstools e2fsprogs fdisk file flex \
        gawk gettext gperf git help2man libelf-dev libncurses-dev libssl-dev \
        libtool libudev-dev libpython3-dev mtools parted patch perl \
        pkg-config python3 python3-dev python3-pip python3-setuptools \
        rsync swig tar texinfo unzip u-boot-tools util-linux wget xz-utils \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Node.js oficial (o do apt do 24.04 é 18, e o projeto exige 20+).
ARG NODE_VERSION=24.22.2
ARG TARGETARCH=amd64
RUN case "$TARGETARCH" in \
        amd64) NODE_ARCH=x64 ;; \
        arm64) NODE_ARCH=arm64 ;; \
        *) echo "arquitetura não suportada: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
        | tar -xJ -C /usr/local --strip-components=1 \
    && node --version

# Usuário sem privilégio com o mesmo UID/GID do host: os arquivos gerados
# (out/, work/) ficam com dono certo e não exigem `chown` depois.
ARG USER_ID=1000
ARG GROUP_ID=1000
# `-o` permite UID/GID repetido: a imagem base já traz o usuário `ubuntu` com
# 1000:1000, e o container precisa rodar com o UID do host de qualquer forma.
RUN groupadd -o -g "$GROUP_ID" builder \
    && useradd -o -u "$USER_ID" -g "$GROUP_ID" --create-home --shell /bin/bash builder

ENV CCACHE_DIR=/work/.cache/ccache
ENV CCACHE_MAXSIZE=5G

WORKDIR /work
USER builder
CMD ["/bin/bash"]
