# Rede de Corretores — baseline e atualização

## Baseline preservado

Os três arquivos históricos desta pasta são o snapshot imutável incorporado ao NEXUM. Eles não são reprocessados:

- `manifest.json`
- `opportunities.json`
- `sender_directory.json`

```text
Registros:               21.662
Investlar:               0.2.0
Pipeline/classificador:  ruleset_0.1
Lote:                    2026_07_03_whatsapp_cg
Hash histórico:          4665749183e3f1545bfe38b1ddfebd8b0e3d58def572e2fdbf698d21265da85e
Checkpoint:              03/05/2026 12:26 · +55 83 8862-5551
```

## Atualização incremental

A atualização é feita em **Rede → Importar Conversas**. O servidor executa o motor incorporado em `engine/investlar`, usando o Python local (`python`) ou o executável definido em `NEXUM_PYTHON`.

O TXT é usado somente para localizar o checkpoint e processar o trecho novo. Conversas brutas não são persistidas. Cada confirmação cria um lote imutável em `ingestion/batches`; `ingestion/catalog.json` mantém o checkpoint, o histórico e os overlays auditados.

Não substitua manualmente o snapshot histórico. Para validar o motor e a transação incremental, execute:

```powershell
npm run test:rede
```

## Privacidade

Esta pasta não é servida como conteúdo estático. O navegador recebe apenas agregados, detalhes mascarados de revisão e metadados de auditoria pelas rotas locais da Rede.
