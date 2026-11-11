📄 Relatório 1 — Gamepad (para a Equipe do Sistema / GIOCHI-OS)

Assunto: Estado do suporte a gamepad na GIOCHI-ENGINE-3D e requisitos para o GIOCHI-OS

Status: ✅ Implementado na engine. Nenhuma alteração de código é necessária na engine.

A GIOCHI-ENGINE-3D já expõe o suporte a gamepad através da ABI C estável (libgiochi.so). O contrato da ABI (docs/C_ABI_CONTRACT.md) documenta explicitamente a seção "keyboard, mouse and gamepad queries" e lista as funções disponíveis. A implementação usa o SDL_GameController, que normaliza automaticamente controles de Xbox, PlayStation e Switch Pro para um layout unificado (ABXY / △○✕□).

Funções expostas na ABI C (já disponíveis):

Função Descrição
giochi_gamepad_connected(void) Retorna 1 se um controle estiver conectado, 0 caso contrário
giochi_gamepad_axis(uint32_t axis) Retorna o valor do eixo normalizado entre -1.0 e 1.0 (sticks) ou -1.0 a 1.0 (triggers, convenção SDL)
giochi_gamepad_button_down(uint32_t button) Retorna 1 se o botão estiver pressionado no frame atual

Mapeamento de eixos e botões: Os eixos usam SDL_CONTROLLER_AXIS_* e os botões usam SDL_CONTROLLER_BUTTON_* como uint32_t. O dispositivo de menor índice mapeado como game controller pela SDL é tratado como "jogador um". Eventos de adição/remoção (hot-plug) são tratados; a remoção de outro dispositivo é ignorada. Se o subsistema de controle não estiver disponível, teclado e mouse continuam funcionando e giochi_gamepad_connected retorna 0, com um aviso no log.

Ação necessária para a Equipe do GIOCHI-OS:

1. Garantir que o SDL2 no rootfs do GIOCHI-OS inclua o subsistema de gamepad. O GIOCHI-SYSTEM usa Buildroot (fixado em 2024.02). É preciso verificar se o pacote SDL2 está configurado com SDL_GAMECONTROLLER habilitado. Na prática, o Buildroot já compila o SDL2 com essa opção por padrão, mas a validação explícita evita surpresas em hardware final (ex: Powkiddy X55).
2. Permissões de dispositivo: Em Linux ARM64 com KMSDRM (alvo da engine), o acesso a /dev/input/event* para leitura de controles pode exigir que o usuário do jogo pertença ao grupo input. O GIOCHI-OS deve garantir que o launcher/app rode com essas permissões.
3. Touch (plus): A engine não expõe toque nativamente na ABI C (o contrato cobre teclado, mouse e gamepad). Para o "plus" de touch, será necessário adicionar suporte a SDL_Finger/eventos de toque como uma extensão futura da ABI. Isso é uma tarefa separada, de menor prioridade que a rede, mas deve ser registrada.

📄 Nota — Equipe do GIOCHI-OS (touch / handhelds)

Assunto: Touch como 3ª opção de input e implicações para handhelds

O alvo primário do GIOCHI-OS são handhelds. A ordem de prioridade de input do jogo é:

1. Gamepad (obrigatório — já suportado pela engine via SDL_GameController)
2. Teclado/mouse (desenvolvimento e desktop)
3. Touch (plus — suporte em handhelds com touchscreen)

Implicações para o OS:

· Handhelds com touchscreen (Steam Deck, ROG Ally, Android) devem expor /dev/input/event* de toque ao SDL2 com SDL_TOUCH_MOUSE_EVENTS habilitado.
· Handhelds sem touchscreen (Powkiddy X55) funcionam normalmente via gamepad — o jogo não deve exigir touch para iniciar.
· A engine não expõe SDL_Finger na ABI C hoje. Se quisermos touch real (multi-touch, gestos), será uma extensão futura da ABI. Por ora, touch pode ser emulado via eventos de mouse da SDL (SDL_MOUSE_*), que já estão na ABI — suficiente para joystick virtual e botões na tela.

Ação: validar que o SDL2 no Buildroot expõe eventos de toque como mouse em handhelds com touchscreen. Nenhuma alteração de código na engine é necessária para o "plus".