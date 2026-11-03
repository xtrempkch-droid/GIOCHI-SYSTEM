#!/usr/bin/env python3
"""Envia um comando na console serial e grava tudo o que vier depois.

Uso: serial-boot.py <porta> <baud> <arquivo> <segundos> [comando...]

Diferente do uboot-serial.py (que espera o comando terminar), aqui o objetivo é
um reboot: o comando é enviado, nada mais é escrito, e a saída é capturada pelo
tempo pedido. Dois leitores no mesmo tty dividem os bytes, então quem lê é só
este processo.
"""
import sys
import time

import serial

port = sys.argv[1]
baud = int(sys.argv[2])
path = sys.argv[3]
seconds = float(sys.argv[4])
commands = sys.argv[5:]

with serial.Serial(port, baud, timeout=0.3) as link, open(
    path, "a", encoding="utf-8", errors="replace"
) as log:
    def emit(text):
        log.write(text)
        log.flush()
        sys.stdout.write(text)
        sys.stdout.flush()

    log.write("\n=== %s: %d s de captura após %r ===\n" % (time.strftime("%H:%M:%S"), seconds, commands))
    log.flush()
    link.reset_input_buffer()
    for command in commands:
        link.write(command.encode() + b"\r")
        time.sleep(1.0)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        chunk = link.read(4096)
        if chunk:
            emit(chunk.decode("utf-8", "replace"))
    emit("\n=== fim da captura ===\n")
