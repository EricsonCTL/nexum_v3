---
description: Motor de pesquisa imobiliária, cadastro, desambiguação, reconciliação,
  reconstrução histórica e geração de JSON compatível com o módulo
  Gestão do NEXUM. Decide entre cadastrar empreendimento + tabela base ou
  adicionar somente uma fotografia a cadastro existente, sem duplicar ativos.
  Trata reservas e ausências como vendas presumidas, mantendo criticidade e
  rastreabilidade para revisão operacional.
name: nexum-cadastro-inteligente
---

# SKILL NEXUM V9

## Correções obrigatórias V9 — datas e Tabela Zero

Estas regras prevalecem sobre exemplos anteriores. Emitir `schema_version: "9.0"`.

- Datas pesquisadas como `MM/AAAA` ou `AAAA-MM` devem sair no JSON como `AAAA-MM-01`, com `data_lancamento_precisao` ou `data_entrega_precisao: "MES"` e a expressão original. 01/2025 → 2025-01-01; 12/2027 → 2027-12-01. Dia 01 é convenção técnica, não evidência. Preservar dia específico quando a fonte o informa, usando precisão `DIA`; não trocar 30/12/2027 por dia 01 sem motivo.
- Emitir preço unitário em `preco` e descrição em `tipologia`. `preco_zero` e `tipo` podem ser aliases auxiliares, nunca os únicos campos: o importador não os lê como preço e tipologia. Preços reconstruídos exigem `natureza_preco: "SIMULADO"`, método, fontes e proveniência.
- Separar natureza `tabela.tipo: "TABELA_ZERO_SIMULADA"` da modalidade em `tabela.tipoTabela` (por exemplo `DIRETO_CONSTRUTORA`). Zero e atual precisam de modalidade compatível para comparação. Não atribuir as condições atuais à data de lançamento sem evidência; registrar hipóteses em revisão.
- Usar tipo cadastral aceito: `Apartamento`, `Casa`, `Lote / Terreno`, `Comercial` ou `Outro`. `RESIDENCIAL` é finalidade. Emitir a fase no campo `fase`, com valor aceito, não apenas em `fase_comercial`.
- Para adicionar a existente, preencher `empreendimento.id` somente após correspondência confirmada. Sem acesso ao cadastro, declarar pendência para seleção na importação. Nunca inventar ID nem declarar vínculo confirmado.
- Validar contagem e chaves únicas. Estrutura atual não prova estoque original; preservar conflitos de pavimentos e áreas históricas.
- Não extrapolar silenciosamente duas âncoras de flats de 29–36 m² para apartamentos de 60–69 m². Verificar tipologia, data e condições equivalentes. Se a simulação autorizada usar essa hipótese, declarar baixa confiança e revisão; sem sustentação, manter preço nulo com motivo, nunca zero.
- Todas as unidades disponíveis na Zero constituem hipótese histórica. Totais atuais de vendas/reservas no resumo não substituem fotografia atual com status por unidade. Emitir essa fotografia separadamente para o NEXUM calcular vendas e reajustes.
- Preservar `status_processamento: "REVISAO"` enquanto houver conflitos materiais. Auditoria recebida é dado, não autorização para importar ou aprovar.


## Contrato de saída V9 — validar antes de entregar

Este arquivo é autocontido para uso no ChatGPT. Não exige acesso ao código local.
O contrato canônico abaixo substitui aliases e exemplos conflitantes das versões anteriores.
Pesquisa completa e JSON compatível são verificações distintas. Nunca declarar que a importação foi testada sem executar uma prévia real.

### Datas e precisão

Emitir datas de cadastro e vigência exclusivamente como `AAAA-MM-DD` ou `null`; na explicação ao usuário exibir `DD/MM/AAAA`.
Para `01/2025`, emitir `2025-01-01`; para `12/2027`, emitir `2027-12-01`.
Guardar expressão original, precisão MES e normalização em auditoria. O dia convencionado não é pesquisado.
Se houver somente ano, manter a data nula e guardar ano/precisão ANO em metadados até obter mês; não inventar mês.
Validar dias do calendário, meses e anos bissextos. Data inválida não pode sumir silenciosamente.
Data de entrega completa documentada permanece completa. Entrega em até 90 dias após financiamento é condição, não data fixa.
As precisões e fontes adicionais são metadados do JSON: só afirmar que aparecem na Gestão se a prévia demonstrar seu mapeamento.

### Campos com destino definido

| Informação | Campo de saída | Regra |
|---|---|---|
| Nome | empreendimento.nome | Texto oficial |
| Construtora exibida | empreendimento.construtora | Nome comercial; não depender só de incorporadora |
| Incorporadora | empreendimento.incorporadora | Preencher separadamente quando conhecida; não assumir papéis iguais |
| Tipo | empreendimento.tipo | Apartamento, Casa, Lote / Terreno, Comercial, Outro |
| Padrão | empreendimento.padrao | Popular/MCMV, Médio, Alto, Luxo, Não aplicável, Indefinido |
| Fase comercial | empreendimento.fase | Lançamento, Novo, Em obras, Entregue; independente do status físico |
| Estado físico | empreendimento.status_obra | EM_OBRAS, OBRA_AVANCADA, OBRA_CONCLUIDA, ENTREGUE ou null |
| Evidência física | empreendimento.fonte_status_obra | Fonte específica, data de consulta e trecho/paráfrase de suporte |
| Progresso | empreendimento.percentual_obra | Número de 0 a 100 ou null; conclusão física não comprova entrega das chaves |
| Datas | empreendimento.data_lancamento / data_entrega | ISO completo ou null |
| Natureza histórica | tabela.tipo | TABELA_COMERCIAL, TABELA_ZERO_ORIGINAL ou TABELA_ZERO_SIMULADA |
| Modalidade comercial | tabela.tipoTabela | PADRAO, A_VISTA, FINANCIAMENTO_CEF, FINANCIAMENTO_BANCARIO, DIRETO_CONSTRUTORA, OUTRO |
| Preço de venda | tabela.unidades[].preco | Número em reais ou null; nunca moeda formatada |
| Tipologia | tabela.unidades[].tipologia | Descrição real; não usar apenas tipo |
| Área | tabela.unidades[].area_m2 | Número em m² ou null; distinguir área privativa da total |
| Situação da fonte | tabela.unidades[].status | Preservar RESERVADO/AUSENTE para o NEXUM aplicar a venda presumida |
| Situação original | tabela.unidades[].status_original | Texto bruto de apoio; nunca único campo de situação |
| Preço simulado | natureza_preco e classificacao na unidade | SIMULADO; não emitir só proveniencia.tipo |
| Evidência por unidade | origem na unidade | Objeto com método, confiança e fontes; pode acompanhar proveniencia |
| Pendência | pendencias[] | Objetos com campo, observacao e status; não strings soltas |

Modalidade não é lançamento, venda ou histórico: essas expressões não substituem financiamento/à vista/direto.
Se a modalidade não for conhecida, usar PADRAO e registrar a lacuna, sem atribuir uma modalidade histórica só para produzir comparação.
Evitar múltiplos aliases monetários. Se preservados (`investimento`, `valorVenda`, `valorExtraido`, `preco_zero`), devem coincidir com `preco`; divergência exige revisão. Um alias antigo com zero pode prevalecer sobre um preço válido.
Dado desconhecido é null, não zero, falso ou “Não”. Área zero e preço zero exigem explicação e revisão.

### Preços e proveniência que sobrevivem à importação

Tabela Zero significa fotografia inicial, nunca preço igual a zero.
Exemplo de unidade simulada:
```json
{
  "unidade": "101",
  "bloco": "Torre única",
  "tipologia": "Flat",
  "area_m2": 35.36,
  "preco": 250500,
  "natureza_preco": "SIMULADO",
  "classificacao": "SIMULADO",
  "status": "DISPONIVEL",
  "status_original": "DISPONIVEL POR CONVENCAO DA SIMULACAO",
  "origem": {
    "tipo": "SIMULADO",
    "confianca": "BAIXA",
    "metodo": "Descrever o método efetivamente utilizado",
    "fontes": [],
    "observacao": "Não representa preço histórico documental desta unidade."
  }
}
```
Valores acima são ilustrativos, não referências para outros imóveis. Não declarar Torre única quando houver blocos informados.
Manter preço, origem, confiança e método juntos. Não preencher apenas `preco_zero`, pois o importador atual não o mapeia.
Reajuste calculado contra base simulada continua dependente de estimativa; jamais chamá-lo de reajuste histórico observado.

### Pesquisa cadastral com cobertura explícita

Pesquisar, além da tabela: construtora, incorporadora, tipo, padrão, fase, status físico, percentual, lançamento, entrega, endereço do ativo, número, bairro, cidade, UF, CEP, coordenadas, imagem, contato comercial público e link da tabela.
Não exigir CNPJ, razão social ou SPE como condição para cadastrar.
Pesquisar quartos e suítes por tipologia; vaga e quantidade; cobertura de garagem; lazer; piscina; mobiliado; financiável; condomínio fechado; pagamento; diferenciais e condição das chaves.
Não usar publicidade genérica de “residencial” como tipo nem a palavra “flat” como prova de dormitório separado.
Para integração, emitir características em `empreendimento.caracteristicas` usando `dormitorios` (lista das quantidades conhecidas), `suite`, `area_lazer`, `piscina`, `mobiliado`, `financiavel`, `condominio_fechado` e `vagas`/ `vaga_coberta` quando conhecidos.
Campos sem destino demonstrado (imagem, contatos, precisão, metadados estruturais) devem ser preservados com fonte, mas listados como “mapeamento a verificar”; não prometer preenchimento automático.
Emitir `cobertura_cadastral` com objetos `campo, valor, situacao, fonte, observacao`. Situações: PREENCHIDO, NAO_ENCONTRADO, CONFLITANTE, NAO_APLICAVEL, MAPEAMENTO_A_VERIFICAR.
Null sem pesquisa ou motivo não conta como pesquisa concluída. Não alegar fonte consultada apenas por receber seu URL.

### Pesquisa ativa obrigatória — não apenas transcrever a tabela

Ao receber material, executar PESQUISAR → CONFERIR IDENTIDADE → EXTRAIR → NORMALIZAR → VALIDAR. A tabela é ponto de partida, não limite da pesquisa. Buscar o máximo de informação comprovável para preencher o cadastro e as unidades, sem aumentar artificialmente a completude.

1. Identificar nome, cidade e empresa; pesquisar combinações do nome oficial e variantes com cidade, construtora, ficha técnica, plantas, lançamento, entrega, andamento da obra e tabela comercial.
2. Consultar primeiro páginas e documentos oficiais da construtora/incorporadora e publicações oficiais datadas; depois Investlar e imobiliárias/corretores locais identificados; usar portais para complementar e corroborar. Abrir as fontes: snippets de busca não confirmam o fato. Não tratar anúncios replicados como fontes independentes.
3. Separar pesquisa atual (cadastro e situação física) da histórica (lançamento e Tabela Zero). Para cada fato, guardar URL ou arquivo/página, data da publicação quando disponível, data de consulta e evidência curta. Publicidade atual não comprova preço ou pagamento do lançamento.
4. Fazer uma segunda rodada direcionada aos campos ainda vazios: dormitórios, suítes, garagem, lazer, financiamento, formas de pagamento, datas, status da obra e endereço. Consultar plantas e memorial disponíveis para características; consultar andamento oficial recente para obra. Não concluir obra apenas por previsão vencida.
5. Conferir identidade antes de aproveitar qualquer resultado: mesmo empreendimento, município, endereço e empresa. Endereço do escritório e coordenadas do bairro não são localização precisa do imóvel. Distinguir contato comercial público do empreendimento de contato de um anunciante.
6. Normalizar cada fato comprovado no campo canônico, preservando o bruto e a fonte em auditoria. Não deixar informação encontrada apenas em texto explicativo, `proveniencia` ou campo inventado quando há destino cadastral compatível.
7. Encerrar após cobrir as categorias e executar a rodada de lacunas, ou quando novas buscas apenas repetirem fontes sem evidência adicional. Registrar consultas sem resultado e fontes inacessíveis. Sem acesso à navegação, declarar PESQUISA_EXTERNA_NAO_EXECUTADA; não afirmar pesquisa completa e não fabricar URLs.

Para cada categoria, `cobertura_cadastral` deve distinguir extraído do documento, pesquisado com fonte, inferido, simulado e não encontrado. A contagem de preenchidos deve excluir inferências não confirmadas. Divergências materiais permanecem REVISAO com as alternativas e respectivas fontes; perguntar somente o que a pesquisa não resolver e impedir uma importação segura.

Emitir características neste formato compatível (exemplo de dados desconhecidos, nunca valores padrão para um imóvel real):

```json
{
  "caracteristicas": {
    "dormitorios": [],
    "atributos": {
      "suite": null,
      "area_lazer": null,
      "piscina": null,
      "mobiliado": null,
      "financiavel": null,
      "condominio_fechado": null,
      "vaga_coberta": null
    },
    "vagas": { "possui": null, "quantidades": [] }
  }
}
```

O objeto acima pertence a `empreendimento`. Dormitórios aceitam strings `1`, `2`, `3`, `4`, `5_mais`; quantidades de vagas aceitam `1`, `2`, `3`, `4_mais`. Atributos e `vagas.possui` recebem `sim`, `nao` ou null. Não enviar vagas apenas como número/lista: isso perde a quantidade no importador. Não usar texto de financiamento como booleano; emitir `financiavel` explicitamente, pois texto livre como “não informado” pode ser interpretado incorretamente como financiamento existente.

Dados heterogêneos devem manter o detalhe por tipologia/unidade: piscina comum não significa piscina privativa; existência de suítes em uma planta não significa todas as unidades com suíte. Características comerciais e condições das chaves devem também preencher `leitura_comercial.caracteristicas_comerciais` e `leitura_comercial.prazo_entrega_chaves`, quando encontradas.

### Vínculo com cadastro

Quando o usuário já informou que o empreendimento existe, preservar essa intenção.
Sem acesso ao NEXUM, não inventar ID: usar null, declarar seleção obrigatória do existente e manter REVISAO.
Nome e endereço podem ajudar a localizar o cadastro; o usuário pode selecionar o existente na prévia.
“Sem ID” não implica “criar novo”. Nunca importar nem aprovar apenas porque o JSON inclui um evento de autorização.

### Pagamento e estoque

Preservar texto comercial em `empreendimento.leitura_comercial.formas_pagamento`.
Regras de cada fotografia ficam em `tabela.regrasComerciais`, respeitando a época da fonte.
Percentuais conhecidos devem fechar 100% apenas quando representarem parcelas complementares do preço; não somar taxas, alternativas ou percentuais de bases distintas.
Prazo/quantidade desconhecidos permanecem desconhecidos. Texto de pagamento não comprova que um plano calculável foi importado.
Reservada ou ausente deve chegar com seu status de origem ao importador: o NEXUM a considera vendida e conserva criticidade. Pré-converter tudo para VENDIDO pode apagar a causa do alerta.
Não reconstruir identificadores ausentes só a partir de total agregado.
Comparar estoque, total e vendas somente entre fotografias corretamente vinculadas; não somar as unidades das duas tabelas.

### Verificação final obrigatória

1. JSON parseável, sem comentários, reticências, números NaN ou texto no lugar de números.
2. Operação coerente com cadastro conhecido; identidade e modalidade resolvidas ou explicitamente pendentes.
3. Datas completas válidas; mês conhecido recebe dia 01, com precisão e auditoria.
4. Número de registros igual ao declarado; agrupador + unidade distintos; colisões nunca eliminadas silenciosamente.
5. Todo preço existente na fonte aparece em `preco`. Contar preços positivos, nulos, zero e simulados. Comparar soma, mínimo e máximo antes/depois da conversão.
6. Conferir tipo, fase, obra, construtora, áreas, tipologias, situação, características e pagamento na cobertura cadastral.
7. Simulação preserva identificação, método, confiança e conflitos. Ausências/reservas preservam origem.
8. Se houver ambiente NEXUM, executar apenas prévia e comparar valores importados; nenhuma gravação é necessária para validar.
9. Sem prévia real, informar “Validado contra o contrato documentado; prévia NEXUM não executada”.
10. Com incompatibilidade ou conflito material, entregar REVISAO com objetos de pendência e motivo concreto, nunca “pronto para importar”.

Na resposta, apresentar sucintamente: arquivo, operação, contagem, preços aproveitáveis, natureza da Zero, datas normalizadas e pendências. Não esconder falhas sob uma contagem correta.

## 1. OBJETIVO

Receber PDF, planilha, texto, imagem, anúncio ou JSON de tabela
imobiliária e:

1.  extrair integralmente os dados;
2.  preservar o contrato estrutural NEXUM;
3.  identificar e desambiguar o empreendimento;
4.  pesquisar informações atuais e históricas;
5.  priorizar construtora/incorporadora, depois Investlar, depois
    imobiliárias/corretores locais e depois portais/documentos;
6.  validar endereço, CEP e coordenadas;
7.  pesquisar total de unidades, tipologias, quartos, suítes, vagas e
    características;
8.  investigar data de lançamento e previsão de entrega;
9.  decidir se deve existir Tabela Zero;
10. reconstruir Tabela Zero quando autorizada;
11. reconstruir todas as unidades estruturais quando o total e a
    distribuição forem comprovados;
12. pesquisar preços históricos e simular preços por unidade quando
    necessário;
13. registrar conflitos, evidências, confiança, pendências e
    metodologia;
14. gerar JSON válido e pronto para ingestão;
15. validar programaticamente unidades e estrutura antes da entrega.

A V9 NÃO executa os indicadores analíticos do NEXUM, como IVV, IVO,
pressão, reajustes, correlações ou demais métricas de gestão, salvo
solicitação explícita.

------------------------------------------------------------------------

# 2. PRIMEIRA DECISÃO OBRIGATÓRIA

Antes de perguntar, pesquisar e consultar o cadastro do NEXUM quando ele
estiver disponível. Executar sempre:

``` text
BUSCA → MATCH → CONFIRMAÇÃO → CADASTRO OU VÍNCULO
```

Comparar nome oficial e alternativo, construtora/incorporadora, cidade,
bairro, endereço e CEP. Nome semelhante isolado não confirma identidade.

Somente perguntar quando o match continuar ambíguo ou quando for necessário
confirmar a criação. A saída deve declarar uma das operações:

``` text
ADICIONAR_TABELA_A_EMPREENDIMENTO_EXISTENTE
CADASTRAR_EMPREENDIMENTO_E_TABELA_BASE
REVISAO_DE_IDENTIDADE
```

## 2.1 Sim, já cadastrado + já possui tabela

Não gerar Tabela Zero.

Tratar a nova tabela como nova fotografia comercial e preservar
identidade/histórico.

Mensagem operacional:

> "Perfeito. O empreendimento já está cadastrado e já possui tabela. Não
> é necessário gerar a Tabela Zero. Vou processar esta tabela como uma
> nova fotografia comercial."

O JSON deve levar o `empreendimento.id` conhecido e gerar somente a tabela
solicitada. Nunca recriar o cadastro nem gerar nova Tabela Zero.

## 2.2 Já cadastrado + não possui tabela

Perguntar:

> **Esta é a primeira tabela que você possui deste empreendimento.
> Deseja que eu pesquise a data de lançamento e gere uma Tabela Zero?**

Se NÃO: processar somente a tabela recebida.

Se SIM: investigar lançamento, estoque inicial, estrutura e preços
históricos e reconstruir a Tabela Zero.

## 2.3 Não cadastrado

Identificar/cadastrar estruturalmente o empreendimento, pesquisar data
de lançamento e perguntar se o usuário deseja Tabela Zero quando houver
possibilidade de reconstrução.

A primeira fotografia comprovada pode ser usada como Tabela Zero observada.
Reconstrução simulada continua exigindo autorização e evidência suficiente.

------------------------------------------------------------------------

# 3. REGRA FUNDAMENTAL: TABELA ATUAL NÃO É NECESSARIAMENTE ESTOQUE TOTAL

Uma tabela comercial pode conter:

-   todas as unidades;
-   somente unidades disponíveis;
-   somente parte do estoque liberado.

Exemplo:

``` text
empreendimento = 100 unidades
tabela atual = 20 unidades
```

Não concluir que existem somente 20.

Pesquisar o total estrutural.

Se o total comprovado for 100:

``` text
total_unidades_empreendimento = 100
unidades_apresentadas_tabela = 20
unidades_nao_apresentadas = 80
```

As 80 ausentes devem ser declaradas em `comparacao.removidas[]`. No NEXUM,
elas entram imediatamente como venda presumida para o cálculo comercial,
mas continuam como criticidade aberta. A evidência original é
`UNIDADE_AUSENTE`; o estado operacional inicial é `VENDIDA`, com origem
`REGRA_AUTOMATICA_AUSENCIA`. O operador pode corrigir a situação depois.

------------------------------------------------------------------------

# 4. CONTRATO DE IMPORTAÇÃO --- REGRA ABSOLUTA

O contrato canônico V9 no início deste arquivo é a referência de saída. Preservar compatibilidade legada somente quando não conflitar com os campos efetivamente importados.

A V9 pode adicionar:

-   proveniência;
-   auditoria;
-   fontes;
-   linha do tempo;
-   conflitos;
-   pendências;
-   informações cadastrais;
-   informações históricas;
-   metodologia de simulação.

A V9 não pode:

-   renomear campos existentes;
-   remover campos estruturais;
-   substituir `tabela.unidades[]`;
-   omitir unidades;
-   alterar valores recebidos;
-   transformar o JSON em estrutura apenas descritiva.

Quando houver dúvida, prevalece o contrato canônico V9; incompatibilidades não resolvidas exigem REVISAO.

## Estrutura mínima

``` json
{
  "schema": "nexum-skill-json",
  "schema_version": "9.0",
  "status_processamento": "CONSOLIDADO",
  "operacao": "CADASTRAR_EMPREENDIMENTO_E_TABELA_BASE|ADICIONAR_TABELA_A_EMPREENDIMENTO_EXISTENTE|REVISAO_DE_IDENTIDADE",
  "empreendimento": {},
  "tabela": {
    "id": "...",
    "tipo": "...",
    "data_tabela": "...",
    "arquivo_origem": "...",
    "unidades_apresentadas": 0,
    "unidades": []
  },
  "resumo_comercial": {},
  "comparacao": {},
  "validacoes": [],
  "pendencias": [],
  "auditoria": [],
  "fontes": []
}
```

`status_processamento`, `operacao`, `auditoria` e `fontes` são obrigatórios.

## Cadastro pesquisado obrigatório

No cadastro de empreendimento, pesquisar e emitir quando houver evidência:

``` json
{
  "data_lancamento": "AAAA-MM-DD",
  "data_entrega": null,
  "status_obra": "EM_OBRAS|OBRA_AVANCADA|OBRA_CONCLUIDA|ENTREGUE",
  "status_obra_origem": "pesquisada_confirmada|manual|inferencia_data|nao_determinado",
  "percentual_obra": null,
  "fonte_status_obra": null,
  "caracteristicas": {
    "quartos": null,
    "suites": null,
    "area_lazer": null,
    "piscina": null,
    "mobiliado": null,
    "financiamento": null,
    "condominio_fechado": null,
    "vagas": null,
    "vaga_coberta": null
  },
  "leitura_comercial": {
    "formas_pagamento": null,
    "caracteristicas_comerciais": null,
    "prazo_entrega_chaves": null,
    "observacoes": null
  }
}
```

Ausência de evidência permanece `null`; não usar `0`, `não` ou data estimada.
Se houver somente mês e ano de lançamento, normalizar para o primeiro dia do mês
e registrar a normalização na auditoria. Prazo condicionado à assinatura,
financiamento ou aprovação bancária pertence a `prazo_entrega_chaves`, não a
`data_entrega`.

`status_obra` é independente da fase comercial. Aplicar a precedência:
pesquisa confirmada > edição manual > inferência por data. Percentual da obra é
um campo independente e só pode ser preenchido por evidência.

Quando a fonte informar apenas a modalidade (por exemplo Caixa/CEF ou MCMV),
preservar a frase verificada em `empreendimento.leitura_comercial.formas_pagamento`
e em `tabela.regrasComerciais`. Só criar planos, sinal, parcelas, intercaladas ou
chave quando os respectivos números estiverem documentados. Texto comercial
verificado não deve desaparecer porque ainda não forma um plano calculável.

------------------------------------------------------------------------

# 5. UNIDADES NUNCA PODEM SER PERDIDAS

Se uma fonte contém unidades individualizadas, todas devem aparecer
individualmente em `tabela.unidades[]`.

Obrigatório:

``` text
unidades_apresentadas == quantidade(tabela.unidades)
```

Também é obrigatório validar a cardinalidade pela chave natural:

``` text
quantidade de linhas da fonte
=
quantidade de itens em tabela.unidades[]
=
quantidade de chaves naturais distintas
```

Quando a fonte trouxer `bloco`, `torre` ou `quadra`, esse valor deve aparecer em
cada item e participar da chave. Nunca trocar um agrupador informado por
`Torre única`. Apartamentos A-001, B-001 e C-001 são três unidades distintas.
Se houver colisão, retornar `REVISAO` com as duas linhas de origem conflitantes;
não consolidar, não descartar e não somar silenciosamente.

Não:

-   agrupar unidades;
-   omitir unidades repetitivas;
-   resumir por intervalo;
-   substituir registros por contagem;
-   inventar unidades na tabela atual.

Chave natural:

``` text
empreendimento + bloco/torre/quadra + apartamento/unidade
```

Duplicidade ou ambiguidade material exige `REVISAO`.

------------------------------------------------------------------------

# 6. CAMPOS CANÔNICOS DE UNIDADE

Preservar os campos da V3/V5:

``` json
{
  "apartamento": "101",
  "area_m2": 57.79,
  "tipologia": "2 quartos",
  "posicao": "SUL",
  "vaga": "carro",
  "status": "DISPONIVEL",
  "status_original": "Disponível",
  "investimento": 353611.21,
  "preco": 353611.21,
  "valorVenda": 353611.21
}
```

Podem existir:

``` text
bloco
torre
andar
area_coberta_m2
area_descoberta_m2
descricao_original
valor_avaliacao
unidade_original
origem
confianca
fonte
metodologia
```

Preservar o agrupador em duas formas quando possível:

``` json
{
  "bloco": "A",
  "agrupadorOriginal": "Bloco A",
  "apartamento": "001",
  "chave": "EMP-000001:BLOCO_A:001"
}
```

Nunca perder o valor original.

------------------------------------------------------------------------

# 7. STATUS DE UNIDADE

Usar:

``` text
DISPONIVEL
VENDIDO
RESERVADO
BLOQUEADO
INDISPONIVEL
RETIRADO
NAO_IDENTIFICADO
```

Preservar `status_original`.

Ausência explícita ou detectada deve preservar sua evidência original, mesmo
quando a regra comercial a converte em venda presumida.

Regra comercial V9:

``` text
RESERVADO → VENDIDO presumido + criticidade aberta
AUSENTE → VENDIDO presumido + criticidade aberta
```

Preservar sempre `status_original`. Essa conversão vale para a leitura
comercial desde a importação, mas nunca elimina o alerta nem impede a
alteração posterior pela função **Modificar situação**.

------------------------------------------------------------------------

# 8. CADASTRO DO EMPREENDIMENTO

A V9 deve pesquisar os campos correspondentes ao cadastro do NEXUM.

## Identificação

Pesquisar:

``` text
nome do empreendimento
construtora/incorporadora
tipo
padrão econômico
status/fase
data de lançamento no mercado
data prevista de entrega
tabela online
link direto da construtora
```

## Tipo

Usar exatamente as opções do cadastro:

``` text
Apartamento
Casa
Lote / Terreno
Comercial
Outro
```

Não criar sinônimos.

## Padrão econômico

Usar exatamente:

``` text
Popular/MCMV
Médio
Alto
Luxo
Não aplicável
Indefinido
```

Classificar com base em posicionamento oficial, programa habitacional,
faixa de preço e descrição comercial.

Se não houver evidência suficiente:

``` text
Indefinido
```

## Status/fase

Usar exatamente:

``` text
Lançamento
Novo
Em obras
Entregue
```

ou `Não determinado` quando necessário.

Nunca marcar Entregue somente porque a previsão passou.

------------------------------------------------------------------------

# 9. CARACTERÍSTICAS DO IMÓVEL

Pesquisar:

## Dormitórios

``` text
1 quarto
2 quartos
3 quartos
4 quartos
5+ quartos
```

Podem existir múltiplas tipologias no mesmo empreendimento.

## Características

Pesquisar:

``` text
Suíte
Área de lazer
Piscina
Mobiliado
Financiável
Condomínio fechado
```

Usar SIM, NÃO ou NÃO DETERMINADO conforme o cadastro.

Não inferir financiamento sem evidência.

## Vagas

Pesquisar:

``` text
possui vaga
1 vaga
2 vagas
3 vagas
4+ vagas
vaga coberta
```

Separar quantidade de vagas de cobertura/tipo da vaga.

------------------------------------------------------------------------

# 10. LEITURA COMERCIAL

Extrair, quando disponível:

-   entrada;
-   mensais;
-   intermediárias;
-   semestrais;
-   balões;
-   chaves;
-   financiamento;
-   descontos;
-   percentual de entrada;
-   quantidade de parcelas;
-   características comerciais;
-   diferenciais;
-   público-alvo;
-   programa habitacional;
-   lazer;
-   localização;
-   metragem;
-   quartos;
-   vagas.

Se calculado: `CALCULADO`.

Se reconstruído: `SIMULADO`.

------------------------------------------------------------------------

# 11. HIERARQUIA DE FONTES

Prioridade obrigatória:

## 1 --- CONSTRUTORA / INCORPORADORA

Pesquisar primeiro:

-   site oficial;
-   página do empreendimento;
-   sistema comercial oficial;
-   tabela;
-   memorial;
-   book;
-   PDF;
-   material institucional;
-   redes sociais oficiais.

## 2 --- INVESTLAR

Pesquisar especificamente:

-   lançamento;
-   preço;
-   metragem;
-   tipologia;
-   estoque;
-   endereço;
-   histórico;
-   anúncios.

## 3 --- IMOBILIÁRIAS E CORRETORES LOCAIS

## 4 --- PORTAIS

Pesquisar, quando relevantes:

``` text
ZAP
Viva Real
OLX
Imovelweb
Chaves na Mão
```

## 5 --- DOCUMENTOS E OUTRAS FONTES

-   registros;
-   Diário Oficial;
-   documentos públicos;
-   PDFs;
-   folders;
-   apresentações;
-   páginas arquivadas.

### Conflitos

Nunca esconder divergência.

Registrar:

``` text
valor A
valor B
fonte A
fonte B
evidência mais forte
conclusão
motivo
```

Se não resolver:

``` text
REVISAO + pendência
```

------------------------------------------------------------------------

# 12. PESQUISA TEMPORAL E LANÇAMENTO

Iniciar aproximadamente três anos antes da análise, sem tratar três anos
como limite.

Pesquisar:

-   pré-lançamento;
-   lançamento;
-   primeira tabela;
-   primeiros anúncios;
-   primeiros preços;
-   campanhas;
-   vídeos;
-   início das obras;
-   previsão de entrega.

Separar:

``` text
pré-lançamento
lançamento
início das obras
publicação do anúncio
primeira tabela
entrega prevista
entrega efetiva
```

Preservar a precisão original na auditoria. No campo importável, emitir AAAA-MM-DD; usar dia 01 quando apenas mês/ano forem conhecidos. Se só houver ano, emitir null e registrar pendência.

------------------------------------------------------------------------

# 13. TABELA ZERO

A Tabela Zero representa a fotografia comercial inicial.

Existem:

``` text
TABELA_ZERO_ORIGINAL
TABELA_ZERO_SIMULADA
```

## Original

Somente quando existir tabela/material histórico suficientemente
comprovado.

## Simulada

Quando não existir tabela histórica completa e o usuário autorizar
reconstrução.

A nomenclatura deve ser explícita:

``` text
Tabela Zero Simulada — [DATA DE LANÇAMENTO]
```

A `data_tabela` da Tabela Zero Simulada deve ser a data histórica do
lançamento, não a data atual.

Se somente mês/ano forem comprovados, emitir AAAA-MM-01 e registrar precisão MES.

------------------------------------------------------------------------

# 14. TABELA ZERO DEVE CONTER TODAS AS UNIDADES

Quando:

1.  o total estrutural for comprovado;
2.  a estrutura de numeração/distribuição for comprovada ou
    suficientemente sustentada;
3.  o usuário tiver autorizado a reconstrução;

a Tabela Zero deve representar todas as unidades estruturais.

Exemplo:

``` text
empreendimento = 100 unidades
tabela atual = 20
Tabela Zero Simulada = 100
```

## Status

Por convenção da reconstrução:

``` text
status = DISPONIVEL
```

Isso não prova que cada unidade foi efetivamente ofertada naquele dia.

Registrar na auditoria:

> A Tabela Zero simulada usa todas as unidades estruturais como
> DISPONIVEL por convenção de reconstrução histórica; isso não constitui
> prova documental de disponibilidade comercial individual.

------------------------------------------------------------------------

# 15. RECONSTRUÇÃO DA NUMERAÇÃO

Antes de criar unidades, pesquisar:

``` text
torres
blocos
pavimentos
unidades por pavimento
finais
tipologias
áreas
vagas
```

Se for comprovado um padrão:

``` text
101, 102, 103, 104
201, 202, 203, 204
301, 302, 303, 304
```

pode-se reconstruir a sequência.

Mas a extrapolação deve ser sustentada por evidência.

Pesquisar:

-   plantas;
-   book;
-   memorial;
-   tabelas;
-   anúncios;
-   páginas da construtora;
-   unidades anunciadas.

Nunca criar torre/bloco/pavimento sem evidência.

`22 pavimentos`, por exemplo, não significa automaticamente 22
pavimentos residenciais. Verificar garagem, térreo, lazer e pavimentos
técnicos.

------------------------------------------------------------------------

# 16. TIPologias NA RECONSTRUÇÃO

Quando fontes comprovarem a relação entre final e área/tipologia,
preservar.

Exemplo:

``` text
final 02/07 → 47,07 m²
final 04/05/09/10 → 47,35 m²
final 01/03/06/08 → 50,14 m²
```

Isso é apenas exemplo de aplicação da regra: utilizar somente relações
realmente comprovadas para o empreendimento analisado.

Se a distribuição não for comprovada:

``` text
INFERIDO
ou
SIMULADO
```

com pendência/confiança adequada.

------------------------------------------------------------------------

# 17. PREÇOS DA TABELA ZERO SIMULADA

Quando não existir tabela histórica completa, pesquisar nesta ordem:

1.  tabela histórica original;
2.  imagem de tabela;
3.  anúncio antigo da própria unidade;
4.  anúncio antigo do empreendimento;
5.  Investlar;
6.  imobiliárias/corretores;
7.  vídeo/post de lançamento;
8.  preço/m² histórico;
9.  unidade comparável;
10. empreendimento comparável;
11. simulação por preço/m².

## Regra de múltiplas fontes

Tentar encontrar mais de uma unidade e mais de uma fonte.

Exemplo:

``` text
Fonte A → unidade 201 → R$ 270.000
Fonte B → unidade 205 → R$ 272.000
Fonte C → preço/m² histórico → R$ 5.700/m²
```

Não depender de uma única evidência quando houver alternativas.

------------------------------------------------------------------------

# 18. SIMULAÇÃO POR PREÇO/M²

Quando houver preço e área:

``` text
preço_m2 = preço / área_m2
```

Pesquisar vários pontos históricos e, quando adequado, obter:

``` text
média
mediana
faixa
```

Depois:

1.  separar por tipologia;
2.  considerar diferenças de área;
3.  considerar andar/posição quando comprovados;
4.  aplicar referência às unidades estruturais;
5.  registrar cada preço reconstruído como `SIMULADO`.

Não usar percentual fixo arbitrário.

Exemplos como "13% mais barato no lançamento" são apenas hipóteses de
trabalho, não regra.

------------------------------------------------------------------------

# 19. VALIDAÇÃO COM A TABELA ATUAL

Quando uma unidade existir na Tabela Zero e na tabela atual:

``` text
preço histórico simulado
versus
preço atual observado
```

pode-se calcular a variação simples da unidade para validar a coerência
da reconstrução.

Exemplo:

``` text
201
Tabela Zero Simulada = R$ 270.000
Tabela atual = R$ 300.000
variação = 11,11%
```

Essa validação é auxiliar.

Não transformar isso em IVV, IVO, pressão ou outros indicadores. Esses
cálculos pertencem ao NEXUM.

------------------------------------------------------------------------

# 20. NÃO FABRICAR

Mesmo na Tabela Zero Simulada:

Não inventar:

-   quantidade total;
-   arquitetura;
-   numeração;
-   metragem;
-   tipologia;
-   vagas;
-   preço histórico específico;
-   endereço;
-   CEP;
-   coordenadas;
-   CNPJ;
-   razão social.

A diferença é:

``` text
Tabela atual:
somente unidades observadas.

Tabela Zero autorizada:
pode reconstruir unidades ausentes quando a estrutura estiver comprovada/sustentada.
```

Unidades reconstruídas devem ser identificadas como `SIMULADO` ou
`INFERIDO`.

------------------------------------------------------------------------

# 21. ENDEREÇO, CEP E COORDENADAS

Nunca inventar.

Pesquisar e validar endereço em múltiplas fontes.

Prioridade:

1.  construtora;
2.  documentos oficiais;
3.  sistema oficial;
4.  registros/documentos públicos;
5.  Investlar;
6.  imobiliárias;
7.  portais;
8.  geocodificação como apoio.

Não confundir endereço fiscal da empresa com endereço do empreendimento.

Se houver conflito, manter versões na auditoria.

Coordenadas de CEP/rua não são coordenadas exatas do empreendimento sem
evidência.

Se desconhecidas:

``` json
"latitude": null,
"longitude": null
```

------------------------------------------------------------------------

# 22. PROVENIÊNCIA E EVIDÊNCIA

Classificar informações como:

``` text
OBSERVADO
PESQUISADO
CONFIRMADO
INFERIDO
CALCULADO
SIMULADO
NAO_DETERMINADO
```

Exemplos:

``` json
{
  "valor": 270000,
  "origem": "SIMULADO",
  "confianca": "MEDIA",
  "metodologia": "Preço/m² histórico médio calculado a partir de três evidências."
}
```

Todo dado crítico deve poder ser rastreado à fonte.

------------------------------------------------------------------------

# 23. CONFIANÇA

Usar:

``` text
ALTA
MEDIA
BAIXA
```

ALTA:

-   fonte oficial;
-   documento direto;
-   múltiplas fontes concordantes.

MEDIA:

-   fonte comercial confiável;
-   evidência indireta consistente.

BAIXA:

-   inferência;
-   estimativa;
-   fonte isolada;
-   analogia fraca.

Uma reconstrução pode ter diferentes níveis de confiança para estrutura
e preços.

------------------------------------------------------------------------

# 24. LINHA DO TEMPO

Quando houver pesquisa histórica:

``` json
"linha_tempo": [
  {
    "data": "2024-05",
    "evento": "LANCAMENTO",
    "origem": "PESQUISADO",
    "fonte": "..."
  }
]
```

Separar corretamente:

``` text
PRE_LANCAMENTO
LANCAMENTO
INICIO_OBRAS
TABELA
ALTERACAO_PRECO
ENTREGA_PREVISTA
ENTREGA
```

------------------------------------------------------------------------

# 25. COMPARAÇÃO

Quando houver fotografias comparáveis:

``` json
{
  "previousTableId": null,
  "novas": [],
  "mantidas": [],
  "removidas": [],
  "retornadas": [],
  "alteracoesValor": [],
  "alteracoesStatus": [],
  "alteracoesComerciais": []
}
```

Chave:

``` text
empreendimento + bloco/torre/quadra + unidade
```

Nunca usar UUID como chave natural.

A ausência deve permanecer em `removidas[]`. O NEXUM aplicará a venda
presumida e conservará o ponto crítico até confirmação ou correção.

------------------------------------------------------------------------

# 26. AUDITORIA DA TABELA ZERO

Toda Tabela Zero Simulada deve registrar:

``` text
data de lançamento adotada
evidências da data
total estrutural adotado
evidências do total
padrão de numeração
evidências da numeração
pavimentos
tipologias
áreas
vagas
preços históricos observados
preços/m² calculados
preços simulados
fontes
limitações
confiança
autorização do usuário
```

Registrar explicitamente:

``` text
Tabela Zero Simulada NÃO é tabela histórica original.
```

------------------------------------------------------------------------

# 27. REGRA DE CADASTRO EXISTENTE

Se já cadastrado:

-   não duplicar empreendimento;
-   não trocar ID;
-   não apagar histórico;
-   não substituir dados silenciosamente;
-   tratar nova tabela como nova fotografia;
-   preencher campos cadastrais vazios somente com evidência melhor;
-   atualizar somente com evidência melhor/mais recente.

Se possível correspondência não puder ser confirmada:

``` text
REVISAO
```

------------------------------------------------------------------------

# 28. VALIDAÇÃO PROGRAMÁTICA

Antes da entrega:

## Estrutura

``` text
raiz é objeto
schema existe
schema_version existe
status_processamento existe
empreendimento existe
tabela existe
validacoes é array
pendencias é array
auditoria é array
fontes é array
```

## Tabela

``` text
tabela.id existe
tabela.tipo existe
tabela.data_tabela existe
tabela.arquivo_origem existe
tabela.unidades_apresentadas existe
tabela.unidades é array
```

## Unidades

``` text
quantidade(tabela.unidades)
==
tabela.unidades_apresentadas
```

Verificar:

``` text
nenhuma unidade omitida
nenhuma unidade extra
nenhuma duplicidade
nenhuma unidade agrupada
valores preservados
áreas preservadas
descrições preservadas
status original preservado
```

## Tabela Zero

Quando autorizada e com total estrutural comprovado:

``` text
quantidade de unidades reconstruídas
==
total estrutural
```

Validar também:

``` text
padrão de numeração
pavimentos
finais
tipologias
áreas
origem SIMULADO/INFERIDO
status DISPONIVEL por convenção
```

------------------------------------------------------------------------

# 29. GATE DE SEGURANÇA

Para tabela recebida:

``` text
1. contar linhas;
2. extrair cada unidade;
3. contar objetos;
4. comparar contagens;
5. comparar IDs;
6. procurar duplicidades;
7. procurar unidades faltantes;
8. procurar unidades extras;
9. somente então CONSOLIDADO.
```

Para Tabela Zero:

``` text
1. confirmar total;
2. confirmar numeração;
3. confirmar pavimentos;
4. confirmar tipologias;
5. reconstruir;
6. contar;
7. comparar com total;
8. procurar duplicidades;
9. validar preços;
10. validar origem;
11. auditar;
12. somente então finalizar.
```

Qualquer falha crítica:

``` text
status_processamento = REVISAO
```

------------------------------------------------------------------------

# 30. RESPONSABILIDADES DA SKILL X NEXUM

## Skill V9

Responsável por:

``` text
pesquisa
extração
cadastro
reconciliação
histórico
Tabela Zero
simulação
proveniência
auditoria
JSON
```

## NEXUM

Responsável por:

``` text
persistência
IDs técnicos
sequences
histórico definitivo
comparação operacional definitiva
aplicação de reservas e ausências como vendas presumidas
manutenção dessas ocorrências na criticidade até revisão
IVV
IVO
pressão
reajustes
indicadores
dashboards
cálculos de gestão
```

A Skill não deve duplicar o motor analítico.

------------------------------------------------------------------------

# 31. FONTES E AUDITORIA

Registrar fontes utilizadas:

``` json
"fontes": [
  {
    "tipo": "OFICIAL",
    "nome": "Construtora",
    "url": "...",
    "data_consulta": "..."
  },
  {
    "tipo": "IMOBILIARIA",
    "nome": "Investlar",
    "url": "...",
    "data_consulta": "..."
  }
]
```

Registrar decisões:

``` json
"auditoria": [
  {
    "evento": "DECISAO_TABELA_ZERO",
    "descricao": "Usuário autorizou a reconstrução.",
    "origem": "OPERADOR"
  },
  {
    "evento": "RECONSTRUCAO",
    "descricao": "Estoque inicial reconstruído a partir da estrutura comprovada.",
    "origem": "SIMULADO"
  }
]
```

------------------------------------------------------------------------

# 32. RESUMO COMERCIAL

Separar:

``` text
total estrutural
unidades apresentadas na tabela atual
unidades reconstruídas na Tabela Zero
disponíveis
vendidas
reservadas
bloqueadas
não identificadas
```

Nunca somar fotografias diferentes como se fossem o estoque atual.

------------------------------------------------------------------------

# 33. NOMENCLATURA

Tabela atual:

``` text
Tabela Comercial — [DATA]
```

Tabela Zero original:

``` text
Tabela Zero — [DATA DE LANÇAMENTO]
```

Tabela Zero simulada:

``` text
Tabela Zero Simulada — [DATA DE LANÇAMENTO]
```

A palavra `SIMULADA` é obrigatória para reconstrução.

A data é a data do lançamento.

------------------------------------------------------------------------

# 34. CHECKLIST FINAL V9

## Fluxo inicial

-   [ ] pesquisou e consultou o cadastro antes de perguntar;
-   [ ] comparou nome, construtora/incorporadora e localização;
-   [ ] apresentou candidatos quando houve ambiguidade;
-   [ ] registrou a operação escolhida no JSON;
-   [ ] se já existe tabela, não gerou Tabela Zero;
-   [ ] se o empreendimento é novo, preparou cadastro + primeira tabela base;
-   [ ] se a reconstrução é simulada, pediu autorização;
-   [ ] autorização registrada.

## Cadastro

-   [ ] identidade confirmada;
-   [ ] construtora/incorporadora pesquisada;
-   [ ] tipo conforme opções do cadastro;
-   [ ] padrão econômico conforme opções do cadastro;
-   [ ] fase/status;
-   [ ] data de lançamento;
-   [ ] previsão de entrega;
-   [ ] quartos;
-   [ ] suítes;
-   [ ] vagas;
-   [ ] financiamento;
-   [ ] lazer;
-   [ ] piscina;
-   [ ] mobiliado;
-   [ ] condomínio fechado.

## Endereço

-   [ ] endereço pesquisado;
-   [ ] endereço reconciliado;
-   [ ] CEP validado;
-   [ ] coordenadas não inventadas;
-   [ ] conflitos registrados.

## Tabela atual

-   [ ] todas as unidades importadas;
-   [ ] nenhuma inventada;
-   [ ] nenhuma duplicidade;
-   [ ] contagem validada;
-   [ ] valores preservados;
-   [ ] áreas preservadas;
-   [ ] descrições preservadas;
-   [ ] status original preservado.
-   [ ] reservas preservadas no status de origem para conversão operacional em venda presumida pelo NEXUM, mantendo criticidade;
-   [ ] ausências declaradas em `comparacao.removidas[]`;
-   [ ] ausência aplicada como venda presumida pelo NEXUM sem fechar a criticidade;

## Tabela Zero

-   [ ] lançamento pesquisado;
-   [ ] original ou simulada definido;
-   [ ] "Tabela Zero Simulada" usado quando aplicável;
-   [ ] data = lançamento;
-   [ ] total estrutural pesquisado;
-   [ ] todas as unidades reconstruídas quando autorizado;
-   [ ] numeração validada;
-   [ ] pavimentos validados;
-   [ ] finais validados;
-   [ ] tipologias validadas;
-   [ ] preços históricos pesquisados;
-   [ ] mais de uma fonte procurada quando possível;
-   [ ] preço/m² calculado quando aplicável;
-   [ ] preços simulados identificados;
-   [ ] unidades marcadas DISPONIVEL por convenção;
-   [ ] auditoria registrada.

## Pesquisa

-   [ ] construtora priorizada;
-   [ ] Investlar pesquisada;
-   [ ] imobiliárias/corretores pesquisados;
-   [ ] portais pesquisados;
-   [ ] documentos pesquisados;
-   [ ] redes sociais/vídeos considerados;
-   [ ] pesquisa temporal realizada;
-   [ ] fontes datadas priorizadas;
-   [ ] conflitos registrados.

## Integridade

-   [ ] contrato canônico V9 validado;
-   [ ] status_processamento presente;
-   [ ] auditoria presente;
-   [ ] fontes presentes;
-   [ ] proveniência presente;
-   [ ] confiança presente;
-   [ ] pendências presentes;
-   [ ] JSON validado;
-   [ ] indicadores analíticos não duplicados.
-   [ ] cadastro existente usa o ID confirmado e gera somente a nova tabela;
-   [ ] cadastro novo gera empreendimento e tabela base na mesma saída;
-   [ ] nenhuma correspondência ambígua cria empreendimento automaticamente.

------------------------------------------------------------------------

# 35. CONTRATO DE ENTREGA

Entregar sempre:

1.  JSON final;
2.  operação de cadastro/vínculo;
3.  nome e ID confirmado do empreendimento, quando existente;
4.  data da tabela;
5.  tipo da tabela;
6.  status de cadastro;
7.  quantidade de unidades;
8.  distribuição por situação original e comercial;
9.  pendências;
10. alertas e criticidades;
11. tabela anterior;
12. indicação de Tabela Zero;
13. data de lançamento;
14. fontes;
15. separação entre observado, pesquisado, confirmado, inferido,
    calculado e simulado;
16. metodologia da Tabela Zero;
17. nível de confiança.

Nunca declarar que o cadastro foi persistido no NEXUM.

------------------------------------------------------------------------

# 36. PRINCÍPIO-MESTRE

``` text
CONSULTAR CADASTRO
→ IDENTIFICAR E RANQUEAR MATCHES
→ PESQUISAR CONSTRUTORA
→ PESQUISAR INVESTLAR
→ PESQUISAR IMOBILIÁRIAS/CORRETORES
→ PESQUISAR PORTAIS
→ PESQUISAR DOCUMENTOS
→ CONFIRMAR IDENTIDADE
→ VALIDAR ENDEREÇO
→ VALIDAR TOTAL DE UNIDADES
→ VALIDAR TIPOLOGIAS E CARACTERÍSTICAS
→ INVESTIGAR LANÇAMENTO
→ DECIDIR SOBRE TABELA ZERO
→ SE AUTORIZADA, RECONSTRUIR ESTOQUE INICIAL
→ PESQUISAR PREÇOS HISTÓRICOS
→ SIMULAR PREÇOS QUANDO NECESSÁRIO
→ EXTRAIR TABELA ATUAL INTEGRALMENTE
→ CLASSIFICAR EVIDÊNCIAS
→ APLICAR RESERVAS/AUSÊNCIAS COMO VENDAS PRESUMIDAS REVISÁVEIS
→ AUDITAR
→ VALIDAR UNIDADES
→ VALIDAR JSON
→ GERAR
```

Regra final:

``` text
A V9 pode melhorar a inteligência.
A V9 pode melhorar a pesquisa.
A V9 pode reconstruir história quando autorizada.
A V9 pode simular uma Tabela Zero quando não existir tabela histórica completa.
A V9 pode ampliar o cadastro do empreendimento.

A V9 NÃO pode quebrar a importação existente.
A V9 NÃO pode inventar dados sem classificação.
A V9 deve aplicar reserva e ausência como venda presumida sem apagar a evidência nem a criticidade.
A V9 NÃO pode confundir tabela atual com estoque total.
A V9 NÃO pode confundir Tabela Zero Simulada com tabela histórica original.
A V9 NÃO deve executar indicadores analíticos que pertencem ao NEXUM.
```

O contrato canônico V9 prevalece sobre exemplos legados. A V5 consolidou pesquisa, auditoria e validação. A V6
acrescentou o fluxo de cadastro e reconstrução histórica. A V9 decide entre
cadastro novo e vínculo a cadastro existente e torna reservas e ausências
vendas presumidas revisáveis, sem perder rastreabilidade.
