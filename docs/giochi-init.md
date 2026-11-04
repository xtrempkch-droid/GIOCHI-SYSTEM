# `giochi-init`

Primeiro processo da interface. Mantém o launcher vivo, restaura brilho e abre o
configurador de controles quando necessário.

Arquivo: `device/common/rootfs-overlay/usr/bin/giochi-init`

## Por que ele é obrigatório

Há **dois** motivos, e o primeiro já vale hoje:

1. **Recuperação.** O launcher pode morrer por qualquer motivo (driver, OOM, bug).
   Sem `respawn`, a tela fica congelada e só volta com SSH.
2. **Pré-requisito do `exec` futuro.** O plano do app é o launcher fazer `exec` no
   jogo, substituindo o próprio processo, para nunca haver dois processos
   disputando o DRM master. Quando isso entrar, ninguém sobra para redesenhar a
   interface quando o jogo termina — e quem reinicia é este script.

> **Correção de fato (03/11/2026).** Este documento afirmava que o launcher **já**
> fazia `exec`. Não faz: o único uso de processo no launcher hoje é
> `Command::status()` em `poweroff`/`reboot`, que cria filho e espera. Quem
> corrigiu foi a equipe do app. O argumento continua válido; o tempo verbal não.

```text
                          ┌── jogo termina, launcher continua vivo
                          ▼
giochi-init ──▶ launcher ──fork+wait──▶ jogo     (é o que existe HOJE)
     ▲              │
     └── só quando o launcher MORRE ──────────
```

**Consequência para `RESTART_MAX`, e é a pergunta que a equipe do app fez em
04/11/2026 (item 3):** com `fork`+`wait`, o `giochi-init` fica bloqueado no
`"$LAUNCHER"` durante o jogo inteiro e **não vê saída nenhuma** até o launcher
morrer de verdade. Então toda saída observada ali é **anormal**, e é isso que o
limite conta — `RESTART_MAX=5` em 60 s significa cinco quedas do launcher, não
cinco partidas.

Se o `exec` for implementado (é decisão futura do app, registrada no
`docs/integracao.md` deles), essa premissa muda: cada jogo terminado vira uma
saída de `giochi-init`, e o limite de 5 passaria a derrubar a interface depois
de cinco partidas normais. **Quem implementar o `exec` tem de revisar
`RESTART_MAX` no mesmo commit** — senão o sintoma é o launcher parando de subir
no meio de uma sessão de jogo, sem nenhuma mensagem de erro.

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

**Nada do lado deste repositório.** As quatro pendências que existiam aqui foram
fechadas e verificadas na imagem que saiu em 04/11/2026:

| Pendência antiga | Como está |
| --- | --- |
| 1. `post-build` não punha a linha no `/etc/inittab` | `scripts/post-build.sh` insere `::respawn:/usr/bin/giochi-init` depois do `rcS`. Conferido **dentro** do `rootfs.ext4`: linha 30 |
| | O `chmod` nunca foi necessário: `cp -a` do staging preserva o bit, e o `post-build` **falha o build** se o arquivo não estiver `+x`. Na imagem: `0755` |
| 2. `buttons.map` não chegava ao rootfs | o staging copia `device/<pasta>/buttons.map` → `/etc/giochi/buttons.map`. Na imagem: `0644`, 103 linhas |
| 4. "nunca executado" | `giochi-init` roda sob `sh` real nos testes (`tests/giochi-init.test.mjs`): conta exatamente `RESTART_MAX` tentativas, espera sem launcher, cria o diretório de config e preserva o sinalizador quando o configurador falha |

O que continua pendente é **de fora**:

- **`giochi-controllers` não existe** — só o desenho em
  [Giochi app/docs/controles.md](../../Giochi%20app/docs/controles.md). Tem de ser
  binário separado, iniciado **antes** do launcher: se o mapeamento está errado,
  o usuário não navega até a tela de configuração.
- **O launcher não é desta árvore.** Ele entra por overlay em
  `/opt/giochi/apps/launcher/bin/giochi-launcher`; quando entrar, o `respawn` já
  está lá e ele sobe sozinho.

## O que o `post-build` garante, e o que ele não faz

Ele **acrescenta** uma linha e não toca em nada do que o Buildroot escreveu —
o getty da serial, o `::shutdown` e o `ctrlaltdel` continuam iguais. Também é
idempotente: rodar duas vezes não duplica a linha (é o que acontece num build
retomado com `KEEP_WORK=1`, quando o `target-finalize` roda de novo).

Ele **não** cria o launcher, não valida o `giochi-controllers` e não mexe em
`BR2_ROOTFS_POST_BUILD_SCRIPT` — só é **acrescentado** à lista existente, para
não derrubar o post-build que um defconfig de placa real já tenha.
