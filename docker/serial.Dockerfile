# Ferramentas de console serial (logger, sessão de comandos, YMODEM).
FROM alpine:3.20
RUN apk add --no-cache python3 py3-pyserial
WORKDIR /work
COPY serial-log.py uboot-serial.py serial-boot.py serial-interrupt.py ymodem-send.py \
     baud-scan.py serial-listen.py serial-watch.py serial-loopback.py /work/
