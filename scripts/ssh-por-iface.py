#!/usr/bin/env python3
"""ssh-por-iface — fala TCP por uma interface de rede específica.

Por que isto existe
===================

O gadget USB de todo aparelho usa **MAC e IP fixos** (`giochi-usbnet`:
`DEV_MAC=02:47:49:4f:43:49`, aparelho em `10.55.0.2`). Com dois aparelhos
plugados no mesmo PC, os dois respondem a `10.55.0.2` e apresentam o mesmo MAC —
o roteamento escolhe a interface de menor métrica e não há como pedir "o outro".

`ssh -o BindInterface=` não resolveu no teste de 08/11/2026: o tráfego continuou
saindo pela interface do primeiro aparelho (conferido nos contadores
`/sys/class/net/*/statistics`). `SO_BINDTODEVICE`, que é o que o `ping -I` usa,
funciona — e neste kernel não exige root.

Uso como ProxyCommand do SSH:

    ssh -o "ProxyCommand=python3 scripts/ssh-por-iface.py --iface usb0 %h %p" root@10.55.0.2

O `%h`/`%p` são substituídos pelo próprio SSH. `scripts/gpu-bench.sh --iface` já
monta isso.
"""

import argparse
import errno
import os
import select
import socket
import sys

SO_BINDTODEVICE = 25


def main() -> int:
    ap = argparse.ArgumentParser(description="TCP por interface específica")
    ap.add_argument("host")
    ap.add_argument("port", nargs="?", type=int, default=22)
    ap.add_argument("--iface", required=True, help="ex.: usb0, enx0247494f4348")
    a = ap.parse_args()

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, SO_BINDTODEVICE, a.iface.encode() + b"\0")
    except OSError as e:
        print(f"ssh-por-iface: SO_BINDTODEVICE {a.iface}: {e}", file=sys.stderr)
        return 2
    try:
        s.settimeout(10)
        s.connect((a.host, a.port))
    except OSError as e:
        print(f"ssh-por-iface: {a.host}:{a.port} por {a.iface}: {e}", file=sys.stderr)
        return 2
    s.setblocking(False)

    fin = sys.stdin.fileno()
    fout = sys.stdout.fileno()
    para_socket = b""
    para_stdout = b""
    stdin_aberto = True

    while True:
        rlist = [s]
        if stdin_aberto:
            rlist.append(fin)
        wlist = []
        if para_socket:
            wlist.append(s)
        if para_stdout:
            wlist.append(fout)

        try:
            r, w, _ = select.select(rlist, wlist, [], 60)
        except InterruptedError:
            continue
        if not r and not w:
            return 0

        if fin in r:
            try:
                dados = os.read(fin, 65536)
            except OSError:
                dados = b""
            if dados:
                para_socket += dados
            else:
                stdin_aberto = False
                try:
                    s.shutdown(socket.SHUT_WR)
                except OSError:
                    pass

        if s in r:
            try:
                dados = s.recv(65536)
            except OSError as e:
                if e.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                    dados = b""
                else:
                    dados = b"\0"  # nada a fazer neste ciclo
            if dados == b"":
                # Fim do fluxo: espera o stdout esvaziar e sai.
                while para_stdout:
                    _, w, _ = select.select([], [fout], [], 5)
                    if fout in w:
                        n = os.write(fout, para_stdout)
                        para_stdout = para_stdout[n:]
                    else:
                        break
                return 0
            if dados != b"\0":
                para_stdout += dados

        if s in w and para_socket:
            try:
                n = s.send(para_socket)
                para_socket = para_socket[n:]
            except OSError:
                pass

        if fout in w and para_stdout:
            try:
                n = os.write(fout, para_stdout)
                para_stdout = para_stdout[n:]
            except OSError:
                return 0


if __name__ == "__main__":
    sys.exit(main())
