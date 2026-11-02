# `giochi-init`

Primeiro processo da interface. Mantém o launcher vivo, restaura brilho e abre o
configurador de controles quando necessário.

Arquivo: `device/common/rootfs-overlay/usr/bin/giochi-init`

## Por que ele é obrigatório

O launcher **não faz `fork`** para abrir um jogo — faz `exec`, substituindo o
próprio processo. Isso evita dois processos disputando o DRM: quando o jogo assume
a tela, o launcher deixa de existir.

O efeito colateral é que, quando o jogo termina, **não sobra ninguém** para
desenhar o launcher. Quem reinicia é este script.

```text
giochi-init ──▶ launcher ──exec──▶ jogo
     ▲                              │
     └────────── jogo termina ──────┘
```

O custo é o launcher subir do zero (~1 s) ao voltar do jogo. É o que consoles
fazem.

## O que ele faz

| Etapa | Por quê |
| --- | --- |
| Restaura o brilho salvo | sem isso o aparelho volta ao máximo a cada boot |
| Abre o configurador de controles, se o sinalizador existir | mapeamento errado impede navegar até a configuração |
| Roda o launcher em laço | ver acima |
| Limita reinícios | launcher quebrado em laço pisca a tela sem parar |

## O limite de reinícios

5 reinícios em 60 s → para de tentar e dorme.

Sem isso, um launcher quebrado produz uma tela piscando a cada segundo, que é pior
que uma tela parada: não dá para ler mensagem nenhuma. A janela deslizante zera a
contagem quando passa tempo suficiente, então um launcher saudável nunca chega
perto do limite.

Depois de desistir, o processo continua **vivo** dormindo — se o PID 1 morrer, o
kernel entra em pânico, e um console que reinicia sozinho é pior que um travado.

## Como é iniciado

O Buildroot usa BusyBox init, que lê `/etc/inittab`. A opção menos invasiva é uma
linha no overlay do rootfs:

```text
# /etc/inittab
::respawn:/usr/bin/giochi-init
```

Assim o BusyBox continua sendo o init (trata sinal, monta `/proc`, roda
`sysinit`), e o `respawn` garante que o próprio `giochi-init` volte se cair.

**Não** substituir `/sbin/init` pelo `giochi-init`: perderia o `sysinit` do
BusyBox, que monta `/proc`, `/sys` e `/dev` — e sem isso nada funciona.

## O sinalizador de configuração de controles

```text
/user/.config/giochi/controller-setup
```

Se existir, o configurador roda **antes** do launcher e o arquivo é removido ao
final.

Três formas de criar:

| Como | Quando serve |
| --- | --- |
| `home` segurado no boot | controle funciona, mapeamento errado |
| Arquivo criado pelo PC (cartão no leitor) | controle não funciona de jeito nenhum |
| Launcher não recebeu evento em 10 s | aparelho novo, mapa errado |

A terceira ainda **não está implementada** — depende do launcher detectar a
ausência de eventos e criar o sinalizador.

## Variáveis

| Variável | Padrão |
| --- | --- |
| `GIOCHI_LAUNCHER` | `/opt/giochi/apps/launcher/bin/giochi-launcher` |
| `GIOCHI_CONTROLLERS` | `/opt/giochi/apps/controllers/bin/giochi-controllers` |
| `GIOCHI_CONFIG_DIR` | `/user/.config/giochi` |

## O que ainda falta

1. **Instalar o `giochi-init` e o `inittab`** — os arquivos existem no overlay
   comum, mas o `post-build` do Buildroot precisa deixar o `giochi-init`
   executável (o `chmod`) e o `/etc/inittab` precisa da linha. Sem isso, o script
   está no rootfs e ninguém o chama.
2. **Instalar `buttons.map` do aparelho** em `/etc/giochi/buttons.map`. Hoje o
   mapa mora em `device/<pasta>/buttons.map` e o staging não o copia.
3. **O configurador `giochi-controllers` não existe** — só o desenho em
   [Giochi app/docs/controles.md](../../Giochi%20app/docs/controles.md).
4. **Nunca executado.** Sem `sh` nesta máquina, nem `sh -n`. É o mesmo risco do
   `build-device.sh`: erro de sintaxe não aparece em revisão visual.

## Por que o mapa e o init não estão ligados ainda

Ligar exige mexer no `build-device.sh` (copiar o mapa para o staging) e no
`post-build` (permissão e `inittab`). São mudanças pequenas, mas em scripts que
**nunca rodaram** — e um `cp` no lugar errado falha o build inteiro em vez de
avisar. Ficam registradas aqui para serem feitas junto com o primeiro build real,
onde o erro aparece com mensagem em vez de escondido.
