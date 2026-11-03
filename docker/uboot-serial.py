#!/usr/bin/env python3
"""Sessão de comandos na console serial do aparelho (U-Boot ou shell Linux).

Uso: uboot-serial.py <porta> <baud> <arquivo-de-log> <cmd1> [cmd2 ...]
     uboot-serial.py <porta> <baud> <arquivo-de-log> @arquivo-de-comandos

Com `@arquivo`, cada linha do arquivo é um comando. Existe porque a console
serial tem buffer de linha curto: mandar um comando de 1 KB numa linha só faz o
shell entrar em continuação (`>`) e a sessão trava. Em arquivo, cada linha fica
abaixo do limite.

Envia cada comando seguido de CR, espera o eco terminar e grava tudo no log.
Não faz nada além de escrever linhas: quem decide o que é seguro é quem chama
este script — `mmc write`/`sf erase` na lista de comandos apaga o aparelho.
"""
import os
import sys
import time

import serial

port = sys.argv[1]
baud = int(sys.argv[2])
log_path = sys.argv[3]
if len(sys.argv) > 4 and sys.argv[4].startswith("@"):
    with open(sys.argv[4][1:], encoding="utf-8") as source:
        commands = [line.rstrip("\n") for line in source if line.strip()]
else:
    commands = sys.argv[4:]

IDLE_AFTER_CMD = 2.5      # silêncio que consideramos "comando terminou"
# Teto por comando. Precisa ser configurável porque `gzwrite` de um rootfs de
# 1 GB leva minutos e, com teto curto, o leitor desiste enquanto o U-Boot ainda
# está gravando — sem erro visível.
MAX_WAIT_PER_CMD = float(os.environ.get("UBOOT_MAX_WAIT", "25"))


def drain(link, log, idle_timeout, max_wait):
    deadline = time.monotonic() + max_wait
    last = time.monotonic()
    while time.monotonic() < deadline:
        chunk = link.read(4096)
        if chunk:
            text = chunk.decode("utf-8", "replace")
            log.write(text)
            log.flush()
            sys.stdout.write(text)
            sys.stdout.flush()
            last = time.monotonic()
        elif time.monotonic() - last > idle_timeout:
            return
    return


with serial.Serial(port, baud, timeout=0.3) as link, open(
    log_path, "a", encoding="utf-8", errors="replace"
) as log:
    header = "\n=== sessão de comandos %s ===\n" % time.strftime("%Y-%m-%d %H:%M:%S")
    log.write(header)
    log.flush()
    sys.stdout.write(header)

    link.reset_input_buffer()
    link.write(b"\r")
    drain(link, log, IDLE_AFTER_CMD, 6)

    for command in commands:
        sys.stdout.write("\n>>> %s\n" % command)
        log.write("\n>>> %s\n" % command)
        log.flush()
        link.write(command.encode() + b"\r")
        drain(link, log, IDLE_AFTER_CMD, MAX_WAIT_PER_CMD)

    log.write("\n=== fim ===\n")
    log.flush()
