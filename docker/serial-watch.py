#!/usr/bin/env python3
"""Vigia a porta serial: espera o adaptador voltar e captura na hora.

Serve para o caso em que o adaptador USB cai do barramento. Quando isso
acontece, o `/dev/ttyUSB0` **desaparece** e qualquer tentativa de abrir falha com
"device disconnected" — a janela em que o aparelho fala passa e ninguém vê.

Este script fica batendo na porta; quando ela volta, abre e captura na hora. Se
ela cai de novo, avisa e volta a esperar. É feito para deixar rodando enquanto
alguém mexe no cabo.

Uso: serial-watch.py <porta> <baud> <arquivo> <segundos_por_janela>
"""
import os
import sys
import time

import serial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 1500000
path = sys.argv[3] if len(sys.argv) > 3 else "/work/log/watch.log"
janela = float(sys.argv[4]) if len(sys.argv) > 4 else 30.0

bin_path = path[:-4] + ".bin" if path.endswith(".log") else path + ".bin"

IMPRIMIVEL = set(range(0x20, 0x7F)) | {0x0A, 0x0D, 0x09}


def resume(dados):
    if not dados:
        return "nada"
    legivel = sum(1 for b in dados if b in IMPRIMIVEL) / len(dados)
    tipo = "TEXTO" if legivel > 0.90 else ("MISTO" if legivel > 0.5 else "RUIDO")
    return f"{len(dados)} bytes ({tipo})"


print(f"Vigiando {port} a {baud} baud. Ctrl+C para parar.")
print(f"Texto: {path} | cru: {bin_path}")
print("Pode mexer no cabo: eu aviso quando a porta aparecer e quando cair.")
print()

ausente_avisado = False
sessoes = 0

try:
    while True:
        if not os.path.exists(port):
            if not ausente_avisado:
                print(f"[{time.strftime('%H:%M:%S')}] {port} AUSENTE — esperando aparecer")
                ausente_avisado = True
            time.sleep(1)
            continue

        ausente_avisado = False
        try:
            link = serial.Serial(port, baud, timeout=0.2)
        except Exception as exc:  # noqa: BLE001
            print(f"[{time.strftime('%H:%M:%S')}] existe mas não abre: {exc}")
            time.sleep(1)
            continue

        sessoes += 1
        print(f"[{time.strftime('%H:%M:%S')}] aberta (sessão {sessoes})")
        dados_janela = bytearray()
        inicio = time.monotonic()
        proximo_enter = inicio

        with open(path, "a", encoding="utf-8", errors="replace") as log, open(
            bin_path, "ab"
        ) as cru:
            log.write(
                f"\n=== {time.strftime('%Y-%m-%dT%H:%M:%S%z')} sessão {sessoes} "
                f"a {baud} baud ===\n"
            )
            log.flush()
            try:
                link.reset_input_buffer()
                while time.monotonic() - inicio < janela:
                    agora = time.monotonic()
                    if agora >= proximo_enter:
                        link.write(b"\r")
                        link.flush()
                        proximo_enter = agora + 2.0
                    pedaco = link.read(4096)
                    if pedaco:
                        dados_janela += pedaco
                        cru.write(pedaco)
                        cru.flush()
                        log.write(pedaco.decode("utf-8", "replace"))
                        log.flush()
                        print(
                            f"  [{agora - inicio:6.2f}s] {len(pedaco)} bytes "
                            f"(total {len(dados_janela)})"
                        )
            except serial.SerialException as exc:
                print(f"[{time.strftime('%H:%M:%S')}] CAIU DURANTE A LEITURA: {exc}")
            finally:
                try:
                    link.close()
                except Exception:  # noqa: BLE001
                    pass

        print(f"[{time.strftime('%H:%M:%S')}] janela fechada: {resume(dados_janela)}")
        print()
except KeyboardInterrupt:
    print(f"\nParado. {sessoes} sessão(ões).")
    if os.path.exists(bin_path):
        tamanho = os.path.getsize(bin_path)
        print(f"Bytes crus gravados: {tamanho} ({bin_path})")
