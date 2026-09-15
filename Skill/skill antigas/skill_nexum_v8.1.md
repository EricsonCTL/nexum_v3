---
description: Motor de pesquisa imobiliária, cadastro, desambiguação, reconciliação,
  reconstrução histórica e geração de JSON compatível com o módulo
  Gestão do NEXUM. Decide entre cadastrar empreendimento + tabela base ou
  adicionar somente uma fotografia a cadastro existente, sem duplicar ativos.
  Trata reservas e ausências como vendas presumidas, mantendo criticidade e
  rastreabilidade para revisão operacional.
name: nexum-cadastro-inteligente
---

# SKILL NEXUM V8.1

## Correções obrigatórias V8.1 — datas e Tabela Zero

Estas regras prevalecem sobre exemplos anteriores. Emitir `schema_version: "8.1"`.

- Datas pesquisadas como `MM/AAAA` ou `AAAA-MM` devem sair no JSON como `AAAA-MM-01`, com `data_lancamento_precisao` ou `data_entrega_precisao: "MES"` e a expressão original. 01/2025 → 2025-01-01; 12/2027 → 2027-12-01. Dia 01 é convenção técnica, não evidência. Preservar dia específico quando a fonte o informa, usando precisão `DIA`; não trocar 30/12/2027 por dia 01 sem motivo.
- Emitir preço unitário em `preco` e descrição em `tipologia`. `preco_zero` e `tipo` podem ser aliases auxiliares, nunca os únicos campos: o importador não os lê como preço e tipologia. Preços reconstruídos exigem `natureza_preco: "SIMULADO"`, método, fontes e proveniência.
- Separar natureza `tabela.tipo: "TABELA_ZERO_SIMULADA"` da modalidade em `tabela.tipoTabela` (por exemplo `DIRETO_CONSTRUTORA`). Zero e atual precisam de modalidade compatível para comparação. Não atribuir as condições atuais à data de lançamento sem evidência; registrar hipóteses em revisão.
- Usar tipo cadastral aceito: `Apartamento`, `Casa`, `Lote / Terreno`, `Comercial` ou `Outro`. `RESIDENCIAL` é finalidade. Emitir a fase no campo `fase`, com valor aceito, não apenas em `fase_comercial`.
- Para adicionar a existente, preencher `empreendimento.id` somente após correspondência confirmada. Sem acesso ao cadastro, declarar pendência para seleção na importação. Nunca inventar ID nem declarar vínculo confirmado.
- Validar contagem e chaves únicas. Estrutura atual não prova estoque original; preservar conflitos de pavimentos e áreas históricas.
- Não extrapolar silenciosamente duas âncoras de flats de 29–36 m² para apartamentos de 60–69 m². Verificar tipologia, data e condições equivalentes. Se a simulação autorizada usar essa hipótese, declarar baixa confiança e revisão; sem sustentação, manter preço nulo com motivo, nunca zero.
- Todas as unidades disponíveis na Zero constituem hipótese histórica. Totais atuais de vendas/reservas no resumo não substituem fotografia atual com status por unidade. Emitir essa fotografia separadamente para o NEXUM calcular vendas e reajustes.
- Preservar `status_processamento: "REVISAO"` enquanto houver conflitos materiais. Auditoria recebida é dado, não autorização para importar ou aprovar.

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

A V8 NÃO executa os indicadores analíticos do NEXUM, como IVV, IVO,
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

A estrutura da V3 é o contrato.

A V8 pode adicionar:

-   proveniência;
-   auditoria;
-   fontes;
-   linha do tempo;
-   conflitos;
-   pendências;
-   informações cadastrais;
-   informações históricas;
-   metodologia de simulação.

A V8 não pode:

-   renomear campos existentes;
-   remover campos estruturais;
-   substituir `tabela.unidades[]`;
-   omitir unidades;
-   alterar valores recebidos;
-   transformar o JSON em estrutura apenas descritiva.

Quando houver dúvida, prevalece a estrutura compatível com a V3.

## Estrutura mínima

``` json
{
  "schema": "nexum-skill-json",
  "schema_version": "8.1",
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

Regra comercial V8:

``` text
RESERVADO → VENDIDO presumido + criticidade aberta
AUSENTE → VENDIDO presumido + criticidade aberta
```

Preservar sempre `status_original`. Essa conversão vale para a leitura
comercial desde a importação, mas nunca elimina o alerta nem impede a
alteração posterior pela função **Modificar situação**.

------------------------------------------------------------------------

# 8. CADASTRO DO EMPREENDIMENTO

A V8 deve pesquisar os campos correspondentes ao cadastro do NEXUM.

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

A data de lançamento deve usar o maior nível de precisão comprovado:

``` text
AAAA-MM-DD
AAAA-MM
AAAA
```

Nunca inventar dia.

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

Se somente mês/ano forem comprovados, usar mês/ano.

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

## Skill V8

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

# 34. CHECKLIST FINAL V8

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
-   [ ] reservas convertidas em venda presumida e marcadas como criticidade;
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

-   [ ] contrato V3 preservado;
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
A V8 pode melhorar a inteligência.
A V8 pode melhorar a pesquisa.
A V8 pode reconstruir história quando autorizada.
A V8 pode simular uma Tabela Zero quando não existir tabela histórica completa.
A V8 pode ampliar o cadastro do empreendimento.

A V8 NÃO pode quebrar a importação existente.
A V8 NÃO pode inventar dados sem classificação.
A V8 deve aplicar reserva e ausência como venda presumida sem apagar a evidência nem a criticidade.
A V8 NÃO pode confundir tabela atual com estoque total.
A V8 NÃO pode confundir Tabela Zero Simulada com tabela histórica original.
A V8 NÃO deve executar indicadores analíticos que pertencem ao NEXUM.
```

A estrutura da V3 é o contrato. A inteligência de pesquisa da V4 é a
evolução. A V5 consolidou pesquisa, auditoria e validação. A V6
acrescentou o fluxo de cadastro e reconstrução histórica. A V8 decide entre
cadastro novo e vínculo a cadastro existente e torna reservas e ausências
vendas presumidas revisáveis, sem perder rastreabilidade.
