# Nexo Radar Imobiliário

Módulo 01: cadastro de empreendimentos e versionamento de tabelas comerciais.

## Executar

```powershell
npm start
```

Abra `http://localhost:3030`.

O acesso demonstrativo continua sem senha. Use **Marcos / Administrador** para cadastrar empreendimentos e tabelas.

## Persistência local

- Dados estruturados: `data/nexo-radar.json` (criado no primeiro início)
- Entrada de PDF: `pdf/entrada/`
- Processamento: `pdf/processando/`
- PDFs registrados: `pdf/cadastrados/`
- Falhas de organização: `pdf/erro/`

O upload pela interface copia o arquivo, gera SHA-256 para detectar duplicidade e somente o considera cadastrado após a validação. O PDF original não é alterado.

## Processamento

O servidor usa `pdftotext` (Poppler) disponível no ambiente local. A extração preserva o texto original e cria valores separados para extraído, interpretado e validado. Quando a leitura não reconhecer dados suficientes, a tabela fica em validação pendente.

## Limite atual

Esta é uma base local com armazenamento JSON, deliberadamente simples. A separação entre empreendimento, tabela, unidades, documento, comparação e auditoria permite migrar a persistência para PostgreSQL sem refazer a regra de negócio.
