# Logger de console serial para diagnóstico no aparelho.
#
# Existe porque o host deste projeto não tem `sudo` disponível e o usuário não
# está no grupo `dialout`: sem isto, ler /dev/ttyUSB0 exige senha de root.
# O container recebe só o dispositivo de serial e escreve num arquivo do host.
FROM alpine:3.20

RUN apk add --no-cache python3 py3-pyserial

WORKDIR /work
COPY serial-log.py /work/serial-log.py

ENTRYPOINT ["python3", "/work/serial-log.py"]
