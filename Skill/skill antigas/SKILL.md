---
name: cadastro-central
description: Pesquisa, identifica e prepara cadastros imobiliários e tabelas comerciais JSON para o NEXUM, com Tabela Zero simulada, pagamentos e validação de compatibilidade.
---

# NEXUM Empreendimentos V1

Antes de pesquisar, gerar ou avaliar um JSON, leia integralmente [skill_nexum_empreendimentos_v1.md](skill_nexum_empreendimentos_v1.md). Essa é a versão atual consolidada, com todas as melhorias da antiga V11, autossuficiente inclusive para uso no ChatGPT. As versões anteriores ficam preservadas como histórico. O contrato JSON continua com schema_version 11.0; a nova numeração do arquivo não altera a compatibilidade técnica.

## Regras essenciais

- Pesquisa e normalização nos campos efetivamente consumidos pelo importador.
- Vínculo de cadastro confirmado, sem criar duplicado por falta de ID.
- Uma fotografia por arquivo; identidade de unidades preservada entre fotografias.
- Tabela Zero simulada completa, com preços e pagamentos por unidade, hipóteses explícitas e identidade reconciliável.
- Reserva/ausência observada permanece identificada na entrada; o NEXUM aplica a venda presumida e mantém criticidade.
- Não importar nem modificar situações quando o pedido é apenas gerar ou avaliar arquivo.
- Não alegar compatibilidade financeira para componentes que o leitor ignora.

## Verificação local

Depois de gerar ou converter o arquivo, execute [scripts/validate-nexum-json.cjs](scripts/validate-nexum-json.cjs):

```powershell
node Skill/scripts/validate-nexum-json.cjs "arquivo.json"
node Skill/scripts/validate-nexum-json.cjs "zero.json" --reference "atual.json"
```

O teste usa o importador local em memória e não cadastra. Leia o relatório completo: saída 0 significa contrato sem erros, não aprovação de evidências ou dispensa de revisão. Sem execução disponível, use as verificações de Empreendimentos V1 e declare a limitação.

Testes de regressão: `npm run test:skill`.

Versionamento desta série: ajustes compatíveis seguem Empreendimentos V1.1, V1.2; próxima mudança estrutural, V2. Preserve os arquivos de versões anteriores. Não alterar schema_version sem atualização compatível do contrato técnico.
