#!/usr/bin/env python3
"""Puxa um arquivo do aparelho pela console serial, em base64.

Uso: serial-pull.py <porta> <baud> <caminho-remoto> <arquivo-local>

Por que existe: para trazer a config do kernel de um aparelho que não e' nosso nao
ha rede, nao ha `scp`, e o cartao esta' dentro do aparelho. O unico canal e' a
console. `serial-push.py` faz o inverso.

Quatro decisoes, cada uma vinda de erro medido:

  1. **Marcador com caractere fora do alfabeto base64 (`:`).** Um marcador feito
     de letras apareceria tambem dentro do payload e o recorte pegaria a metade
     errada.
  2. **O marcador aparece DUAS vezes: no eco do comando e na saida.** O recorte
     usa o SEGUNDO `START`, nao o primeiro — o primeiro e' o eco.
  3. **md5 do arquivo DECODIFICADO, comparado dos dois lados.** Comparar o md5 do
     texto base64 daria divergencia sempre, porque `base64` quebra linha a 76 e a
     reconstrucao local nao tem as mesmas quebras.
  4. **Nada e' gravado quando a verificacao falha.** Analisar arquivo corrompido e'
     pior que nao ter arquivo: o gzip abre lixo com mensagem que nao aponta para o
     transporte.
"""
import base64
import hashlib
import re
import sys
import time

import serial

START = ":::GIOCCHI-B64-START:::"
END = ":::GIOCCHI-B64-END:::"

port = sys.argv[1]
baud = int(sys.argv[2])
remote = sys.argv[3]
local = sys.argv[4]


def main():
    with serial.Serial(port, baud, timeout=0.3) as link:
        def read_for(seconds):
            end = time.monotonic() + seconds
            collected = bytearray()
            while time.monotonic() < end:
                piece = link.read(8192)
                if piece:
                    collected.extend(piece)
            return bytes(collected)

        def send(line, wait=0.6):
            link.write(line.encode() + b"\r")
            time.sleep(wait)
            return read_for(min(wait, 0.4))

        link.reset_input_buffer()
        read_for(0.4)

        print("remoto: %s" % remote)
        text = send("wc -c < %s" % remote, 0.8).decode("latin-1").replace("\r", "\n")
        sizes = [int(t) for t in re.findall(r"\b(\d+)\b", text) if int(t) > 10]
        if not sizes:
            print("ERRO: nao consegui o tamanho de %s" % remote)
            return 2
        remote_size = max(sizes)

        text = send("md5sum %s" % remote, 0.9).decode("latin-1").replace("\r", "\n")
        match = re.search(r"\b([0-9a-f]{32})\b", text)
        remote_md5 = match.group(1) if match else None
        print("  %d bytes, md5 %s" % (remote_size, remote_md5 or "(nao lido)"))

        print("  gerando base64 no aparelho...")
        send("base64 %s > /tmp/_pull.b64" % remote, 1.0)

        # ~1500000 baud teoricos, mas o console do aparelho nao entrega isso.
        # Estimativa conservadora, com piso e teto.
        seconds = min(240.0, max(15.0, remote_size * 1.4 / 6000.0 + 10.0))
        print("  lendo por %.0f s..." % seconds)
        sys.stdout.flush()
        link.write(("echo %s; cat /tmp/_pull.b64; echo %s\r" % (START, END)).encode())
        raw = read_for(seconds)

        with open(local + ".raw", "wb") as handle:
            handle.write(raw)
        parts = raw.split(START.encode())
        if len(parts) < 3:
            print("ERRO: marcador de inicio apareceu %d vez(es), esperava 2" % (len(parts) - 1))
            return 3
        body = parts[2].split(END.encode())[0]

        payload = re.sub(rb"[^A-Za-z0-9+/=]", b"", body)
        if not payload:
            print("ERRO: nenhum dado base64 entre os marcadores")
            return 3

        try:
            data = base64.b64decode(payload, validate=True)
        except Exception as error:
            print("ERRO: base64 invalido (o transporte perdeu byte): %s" % error)
            return 3

        if len(data) != remote_size:
            print("ERRO: %d bytes decodificados, %d no aparelho" % (len(data), remote_size))
            return 3
        local_md5 = hashlib.md5(data).hexdigest()
        if remote_md5 and local_md5 != remote_md5:
            print("ERRO: md5 diverge — remoto %s, local %s" % (remote_md5, local_md5))
            return 3

        print("  ok: %d bytes, md5 %s" % (len(data), local_md5))
        with open(local, "wb") as handle:
            handle.write(data)
        print("gravado %s" % local)
        return 0


if __name__ == "__main__":
    sys.exit(main())
