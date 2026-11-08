# Ferramentas de console serial (logger, sessão de comandos, YMODEM).
FROM alpine:3.20
RUN apk add --no-cache python3 py3-pyserial
WORKDIR /work
# `COPY *.py` e não uma lista de nomes.
#
# A lista existia e ficou desatualizada em SILÊNCIO: `serial-cmd.py`,
# `serial-pull.py` e `serial-push-blob.py` estavam no repositório e não iam para
# a imagem, então quem seguisse o comando do doc (sem `-v ./docker:...`) morria
# em `python3: can't open file '/work/serial-push-blob.py': No such file or
# directory` — erro que não diz que faltou o COPY. Foi o que já tinha acontecido
# com o `serial-watch.py`, e a correção da época foi acrescentar UM nome à lista,
# que é o §12.50 aplicado a Dockerfile: o teste cobrindo o caso em vez da classe.
#
# `serial-log.py` roda também no `serial-logger.Dockerfile`, que o copia
# sozinho de propósito (imagem mínima para um trabalho só).
COPY *.py /work/
