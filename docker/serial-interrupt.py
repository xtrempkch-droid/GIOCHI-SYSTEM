#!/usr/bin/env python3
"""Espera o aparelho ligar e interrompe o autoboot do U-Boot.

Uso: serial-interrupt.py <porta> <baud> <segundos>

Por que existe: depois de um kernel panic a CPU fica parada e só um ciclo de
energia recupera. Quando o U-Boot imprime "Hit any key to stop autoboot", há ~2
segundos para interromper — mais rápido do que qualquer comando manual por
serial. Este script fica martelando teclas assim que vê o aviso.
"""
import sys
import time

import serial

port, baud, seconds = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
saw_boot = False
interrupted = False

with serial.Serial(port, baud, timeout=0.05) as link:
    deadline = time.monotonic() + seconds
    buffer = ""
    while time.monotonic() < deadline:
        chunk = link.read(256)
        if chunk:
            text = chunk.decode("utf-8", "replace")
            buffer += text
            sys.stdout.write(text)
            sys.stdout.flush()
            if "U-Boot" in buffer or "SPL" in buffer:
                saw_boot = True
            if "Hit any key" in buffer or "stop autoboot" in buffer:
                for _ in range(40):
                    link.write(b" ")
                    link.flush()
                    time.sleep(0.03)
                interrupted = True
                buffer = ""
            if interrupted and "=>" in buffer:
                print("\n=== U-BOOT PROMPT ALCANCADO ===", flush=True)
                break
        else:
            if not saw_boot:
                link.write(b"\r")
                link.flush()

print("\n=== fim: boot=%s interrompido=%s ===" % (saw_boot, interrupted), flush=True)
