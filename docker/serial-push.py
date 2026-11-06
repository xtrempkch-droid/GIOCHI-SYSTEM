#!/usr/bin/env python3
"""Envia um arquivo pela console serial e, opcionalmente, o executa.

Uso: serial-push.py <porta> <baud> <arquivo-local> [comando-para-rodar...]

Por que existe: o aparelho tem `python3`, mas não tem `gcc`, `scp` nem rede — e
neste caso também não tem a nossa imagem. O único caminho é texto pela console.
Colar um script de 9 KB na mão não é opção: um caractere perdido vira erro de
sintaxe numa linha que está certa (§12.25 ao contrário).

O transporte é base64 em blocos, com eco desligado. Três detalhes que fazem
diferença e que já custaram tempo:

  1. **Bloco pequeno (~700 chars).** O buffer da UART do aparelho é limitado, e
     um bloco grande perde bytes no meio sem erro visível — o arquivo chega
     truncado e o Python reclama de sintaxe, não de transporte.
  2. **`printf`, nunca `echo`.** `echo` do busybox interpreta `\\` e acrescenta
     newline; base64 não tem `\\`, mas o hábito evita a classe.
  3. **Conferir o tamanho depois.** O script compara o tamanho em bytes do
     arquivo remoto com o local e falha se divergir. Sem isso, "enviei" e
     "chegou" são a mesma suposição — e a falha aparece longe da causa.
"""
import base64
import os
import sys
import time

import serial

CHUNK = 700
REMOTE = "/tmp/_push.b64"

port = sys.argv[1]
baud = int(sys.argv[2])
local = sys.argv[3]
commands = sys.argv[4:]

with open(local, "rb") as handle:
    payload = handle.read()
encoded = base64.b64encode(payload).decode("ascii")
chunks = [encoded[i : i + CHUNK] for i in range(0, len(encoded), CHUNK)]

with serial.Serial(port, baud, timeout=0.4) as link:
    def drain(seconds=0.15):
        end = time.monotonic() + seconds
        out = bytearray()
        while time.monotonic() < end:
            chunk = link.read(4096)
            if chunk:
                out.extend(chunk)
        return out.decode("utf-8", "replace")

    def send(line, wait=0.05):
        link.write(line.encode() + b"\r")
        time.sleep(wait)

    link.reset_input_buffer()
    drain(0.3)

    # Trunca antes de comecar: se o arquivo ja' existir de uma tentativa anterior
    # e o envio novo for menor, o resto do antigo continuaria la' e o base64
    # decodificaria lixo sem erro.
    send(": > %s" % REMOTE, 0.2)
    drain(0.2)

    for index, chunk in enumerate(chunks, 1):
        send("printf '%%s' '%s' >> %s" % (chunk, REMOTE), 0.12)
        if index % 5 == 0:
            print("  enviados %d/%d blocos" % (index, len(chunks)))
            sys.stdout.flush()
            drain(0.1)

    print("  enviados %d/%d blocos" % (len(chunks), len(chunks)))
    print("  conferindo tamanho do base64 remoto...")
    sys.stdout.flush()
    send("wc -c < %s" % REMOTE, 0.4)
    echo = drain(0.6)
    remote_size = None
    for token in echo.replace("\r", "\n").split("\n"):
        token = token.strip()
        if token.isdigit():
            remote_size = int(token)
    if remote_size is None:
        print("AVISO: nao consegui ler o tamanho remoto; seguindo assim mesmo")
    elif remote_size != len(encoded):
        print(
            "ERRO: base64 remoto tem %d bytes, o local tem %d — envio truncado"
            % (remote_size, len(encoded))
        )
        sys.exit(3)
    else:
        print("  OK: %d bytes de base64, identico ao local" % remote_size)

    send("base64 -d %s > /tmp/_push.bin" % REMOTE, 0.4)
    send("wc -c < /tmp/_push.bin", 0.4)
    echo = drain(0.6)
    decoded = None
    for token in echo.replace("\r", "\n").split("\n"):
        token = token.strip()
        if token.isdigit():
            decoded = int(token)
    if decoded is not None and decoded != len(payload):
        print(
            "ERRO: no aparelho o arquivo tem %d bytes, aqui tem %d"
            % (decoded, len(payload))
        )
        sys.exit(3)
    if decoded is not None:
        print("  OK: %d bytes decodificados no aparelho" % decoded)

    if not commands:
        print("Enviado para /tmp/_push.bin (nao executado).")
        sys.exit(0)

    for command in commands:
        print("--- %s" % command)
        sys.stdout.flush()
        link.write(command.encode() + b"\r")
        end = time.monotonic() + 20
        seen = bytearray()
        while time.monotonic() < end:
            chunk = link.read(4096)
            if chunk:
                seen.extend(chunk)
                sys.stdout.write(chunk.decode("utf-8", "replace"))
                sys.stdout.flush()
                # Prompt e' detectado pelo FORMATO (`algo:~ #` ou `$` no fim da
                # linha), nunca pelo nome do aparelho. Cravar "ROCKNIX:~ #" aqui
                # funcionaria so' neste cartao — e' a mesma divida do §12.24,
                # em que a cmdline da X55 ficou dentro do make-sd-image.
                tail = seen.rstrip()
                if tail.endswith(b"#") or tail.endswith(b"$"):
                    break
        time.sleep(0.3)
