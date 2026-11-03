# canal: Giochi System ↔ Giochi app

**Este arquivo é só um ponteiro.** A conversa entre as duas equipes não mora no
repositório — mora num arquivo local, numa máquina específica.

| | |
| --- | --- |
| **Arquivo do chat** | `/home/charles/Giochi/chat_de_equipe.txt` |
| **Máquina** | `charles-X99-V9S` |
| **Usuário** | `charles` |
| **Quem escreve** | as duas equipes, no mesmo arquivo |

## Por que fora do repositório

O arquivo foi copiado de um lado para o outro três vezes e numa delas chegou
truncado — 14 422 bytes viraram 11 150, e mensagem já escrita se perdeu no meio.
Trocar arquivo inteiro é o problema; um arquivo único, num só lugar, não tem o
que sincronizar.

## Como usar

1. Ler o arquivo **antes** de responder. A última mensagem pode ter mudado o que
   se ia dizer — já aconteceu.
2. Acrescentar no fim, com data e de quem é.
3. Não editar mensagem da outra equipe. Corrigir na sua, citando a anterior.
4. Quando a conversa virar **decisão**, a decisão vai para o documento de
   referência e o chat só aponta o link. Sem isso o arquivo vira uma segunda
   fonte da verdade que diverge da primeira em silêncio — a mesma classe de
   problema do §12.1 do `AGENTS.md`.

## Onde ficam as decisões (a referência, não o correio)

| Assunto | Documento |
| --- | --- |
| contrato do launcher, stack de texto, camada de boot | [`launcher.md`](launcher.md) |
| SSH por USB, log de boot, dono do mixer ALSA | [`sistema-base.md`](sistema-base.md) |
| o que o `giochi-init` é e por que é obrigatório | [`giochi-init.md`](giochi-init.md) |
| mapa de botões por aparelho | [`button-maps.md`](button-maps.md) |
| medida do X55 / X35H em hardware | [`x55-bringup.md`](x55-bringup.md), [`x35h-bringup.md`](x35h-bringup.md) |

## Acesso à máquina que tem o chat

Na rede local (`192.168.1.5`), por SSH, como `charles`:

```bash
ssh charles@192.168.1.5
less /home/charles/Giochi/chat_de_equipe.txt
```

Se a máquina não estiver na mesma rede, o arquivo tem de ser trazido por outro
meio — e nesse caso **copiar de volta para cá não é opção**: leia, responda no
chat, e registre aqui só a decisão.

---

*Se este ponteiro ficar velho (máquina trocada, arquivo movido), corrija a tabela
acima. Não recrie o chat dentro do repositório.*
