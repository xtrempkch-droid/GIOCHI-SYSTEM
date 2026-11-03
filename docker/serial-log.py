#!/usr/bin/env python3
"""Anexa a console serial do aparelho a um arquivo, sem perder bytes.

Uso (dentro do container): serial-log.py <porta> <baud> <arquivo>
Grava uma linha de cabeçalho por sessão e faz flush a cada leitura, para que o
log seja lido de fora enquanto o aparelho ainda está bootando.
"""
import sys
import time
from datetime import datetime, timezone

import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 1500000
path = sys.argv[3] if len(sys.argv) > 3 else "/work/serial.log"

while True:
    try:
        with serial.Serial(port, baud, timeout=0.5) as link:
            link.reset_input_buffer()
            with open(path, "a", encoding="utf-8", errors="replace") as log:
                log.write(
                    "\n=== %s sessão aberta em %s a %d baud ===\n"
                    % (
                        datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                        port,
                        baud,
                    )
                )
                log.flush()
                idle_since = time.monotonic()
                while True:
                    chunk = link.read(4096)
                    if chunk:
                        idle_since = time.monotonic()
                        log.write(chunk.decode("utf-8", "replace"))
                        log.flush()
                        continue
                    if time.monotonic() - idle_since > 3600:
                        break
    except (serial.SerialException, OSError) as error:
        print("serial indisponível (%s); nova tentativa em 5 s" % error, flush=True)
        time.sleep(5)
