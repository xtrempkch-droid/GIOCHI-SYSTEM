#!/usr/bin/env python3
"""Envia um arquivo ao U-Boot por YMODEM, na mesma sessão em que dispara o comando.

Uso: ymodem-send.py <porta> <baud> <arquivo> <comando>

Por que implementar em vez de usar `sb` do lrzsz: o `loady` do U-Boot pede o
arquivo por YMODEM 1K e o `sb` abriria a porta serial por conta própria, o que
briga com quem enviou o comando. Aqui a porta é aberta uma vez e o protocolo é
controlado bloco a bloco — inclusive retransmissão, que em 73 MB importa.

Protocolo (o que o U-Boot espera em lib/xyzModem.c):
  receptor envia 'C'  →  remetente manda bloco 0 (SOH, 128 B: nome+size)
  receptor ACK + 'C'  →  remetente manda blocos de 1024 B (STX) com CRC16
  receptor ACK por bloco; ao fim, EOT e bloco 0 vazio encerram a sessão.
"""
import os
import sys
import time

import serial

SOH = 0x01
STX = 0x02
EOT = 0x04
ACK = 0x06
NAK = 0x15
CAN = 0x18
CRC_REQUEST = 0x43  # 'C'

ACK_TIMEOUT = 10.0
MAX_RETRIES = 20


def crc16_xmodem(data):
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def xy_checksum(data):
    """Checksum de 1 byte usado quando o receptor pede NAK/checksum (modo antigo)."""
    return sum(data) & 0xFF


class YModem:
    def __init__(self, link):
        self.link = link
        self.crc_mode = True

    def _read_byte(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            byte = self.link.read(1)
            if byte:
                return byte[0]
        return None

    def wait_start(self, timeout=30.0):
        """Espera o 'C' (CRC) ou NAK (checksum) do receptor."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            byte = self._read_byte(timeout - (time.monotonic() - deadline) + timeout)
            if byte is None:
                continue
            if byte in (CRC_REQUEST, NAK):
                self.crc_mode = byte == CRC_REQUEST
                return True
            if byte == CAN:
                return False
        return False

    def _build(self, header, block_number, payload):
        crc = crc16_xmodem(payload) if self.crc_mode else None
        frame = bytearray()
        frame.append(header)
        frame.append(block_number & 0xFF)
        frame.append(0xFF - (block_number & 0xFF))
        frame.extend(payload)
        if self.crc_mode:
            frame.extend(bytes((crc >> 8, crc & 0xFF)))
        else:
            frame.append(xy_checksum(payload))
        return bytes(frame)

    def send_block(self, payload, block_number, header=SOH, size=128):
        padded = payload.ljust(size, b"\x00")
        frame = self._build(header, block_number, padded)
        for attempt in range(MAX_RETRIES):
            self.link.write(frame)
            self.link.flush()
            response = self._read_byte(ACK_TIMEOUT)
            while response is not None and response not in (ACK, NAK, CAN):
                response = self._read_byte(ACK_TIMEOUT)
            if response == ACK:
                return True
            if response == CAN:
                raise RuntimeError("receptor cancelou (CAN)")
            # NAK ou timeout: reenvia o mesmo bloco.
        raise RuntimeError(f"bloco {block_number} não foi confirmado após {MAX_RETRIES} tentativas")

    def send_eot(self):
        for _ in range(MAX_RETRIES):
            self.link.write(bytes((EOT,)))
            self.link.flush()
            response = self._read_byte(ACK_TIMEOUT)
            while response is not None and response not in (ACK, NAK, CAN):
                response = self._read_byte(ACK_TIMEOUT)
            if response == ACK:
                return True
            if response == CAN:
                raise RuntimeError("receptor cancelou no EOT")
        return False


def main():
    port, baud, path, command = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    name = os.path.basename(path)
    size = os.path.getsize(path)

    with serial.Serial(port, baud, timeout=0.05, write_timeout=30) as link:
        link.reset_input_buffer()
        if command:
            link.write(command.encode() + b"\r")
            link.flush()
            time.sleep(0.5)

        modem = YModem(link)
        print(f"aguardando 'C' do U-Boot (comando: {command})...", flush=True)
        if not modem.wait_start(45):
            raise SystemExit("U-Boot não pediu o arquivo; o comando loady não está ativo?")

        print(f"enviando {name} ({size} bytes) em YMODEM{'/CRC' if modem.crc_mode else '/checksum'}...", flush=True)
        header = f"{name}\x00{size}\x00".encode()
        modem.send_block(header, 0, header=SOH, size=128)

        modem.wait_start(20)

        sent = 0
        block = 1
        last_report = time.monotonic()
        with open(path, "rb") as source:
            while True:
                chunk = source.read(1024)
                if not chunk:
                    break
                modem.send_block(chunk, block, header=STX, size=1024)
                sent += len(chunk)
                block += 1
                now = time.monotonic()
                if now - last_report >= 5:
                    rate = sent / (now - last_report)
                    pct = sent * 100.0 / size
                    print(f"  {sent}/{size} ({pct:.1f}%) ~{rate / 1024:.0f} KB/s", flush=True)
                    last_report = now

        print("enviando EOT...", flush=True)
        if not modem.send_eot():
            raise SystemExit("EOT sem ACK")

        # Bloco 0 vazio encerra a sessão de batch.
        modem.wait_start(20)
        modem.send_block(b"\x00", 0, header=SOH, size=128)

        print(f"concluído: {sent} bytes enviados", flush=True)
        time.sleep(0.5)
        tail = link.read(8192)
        if tail:
            sys.stdout.write(tail.decode("utf-8", "replace"))
            sys.stdout.flush()


if __name__ == "__main__":
    main()
