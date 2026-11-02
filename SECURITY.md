# Security Policy

Giochi System gera imagens de sistema operacional. Trate cada artefato como um binário de distribuição.

## Reportar uma vulnerabilidade

Abra uma issue privada de segurança no GitHub (Security → Report a vulnerability), se disponível, ou entre em contato com os mantenedores do repositório. Não publique detalhes exploráveis em uma issue pública antes da correção.

## Práticas do projeto

- A senha de root padrão é `giochi-system` e deve ser trocada antes de qualquer distribuição.
- O secret `GIOCHI_SYSTEM_ROOT_PASSWORD` deve ser usado no CI para builds sérios.
- O `buildroot.config` publicado tem a senha redigida.
- A versão do Buildroot é fixada em `buildroot.version`.
- O projeto ainda não assina imagens nem implementa atualização OTA.

Leia a documentação completa em [docs/security.md](docs/security.md).
