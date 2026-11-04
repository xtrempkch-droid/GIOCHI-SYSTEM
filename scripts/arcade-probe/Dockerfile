FROM ubuntu:24.04

# Ambiente fechado para medir o arcade sem tocar no host e sem depender de
# hardware. O driver e o llvmpipe do Mesa (software), sobre Xvfb: o que se mede
# e o COMPORTAMENTO do arcade, nao a velocidade do GPU.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      libgl1-mesa-dri libglx-mesa0 libegl-mesa0 libgbm1 libgl1 libegl1 libgles2 \
      xvfb x11-utils mesa-utils \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /venv
ENV PATH=/venv/bin:$PATH
# Versao fixada: o comportamento medido abaixo e da 3.3.3. Subir sem refazer a
# medicao invalida o registro no README.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir "arcade==3.3.3"

WORKDIR /probe
