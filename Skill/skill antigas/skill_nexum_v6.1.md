---
description: Motor de pesquisa imobiliária, cadastro, reconciliação,
  reconstrução histórica e geração de JSON compatível com o módulo
  Gestão do NEXUM. Preserva o contrato da V3/V5 e adiciona fluxo
  obrigatório de decisão sobre cadastro e Tabela Zero, reconstrução de
  estoque inicial, pesquisa histórica de preços e ampliação do cadastro
  comercial.
name: skill_nexum_v6_1
---

# SKILL NEXUM V6.1

## 1. OBJETIVO

Receber PDF, planilha, texto, imagem, anúncio ou JSON de tabela
imobiliária e:

1.  extrair integralmente os dados;
2.  preservar o contrato estrutural NEXUM;
3.  aplicar as regras de precisão da V6.1;
4.  identificar e desambiguar o empreendimento;
5.  pesquisar informações atuais e históricas;
6.  priorizar construtora/incorporadora, depois Investlar, depois
     imobiliárias/corretores locais e depois portais/documentos;
7.  validar endereço, CEP e coordenadas;
8.  pesquisar total de unidades, tipologias, quartos, suítes, vagas e
     características;
9.  investigar data de lançamento e previsão de entrega;
10. decidir se deve existir Tabela Zero;
11. reconstruir Tabela Zero quando autorizada;
12. reconstruir todas as unidades estruturais quando o total e a
     distribuição forem comprovados;
13. pesquisar preços históricos e simular preços por unidade quando
     necessário;
14. registrar conflitos, evidências, confiança, pendências e
     metodologia;
15. gerar JSON válido e pronto para ingestão;
16. validar programaticamente unidades e estrutura antes da entrega.

A V6 NÃO executa os indicadores analíticos do NEXUM, como IVV, IVO,
pressão, reajustes, correlações ou demais métricas de gestão, salvo
solicitação explícita.

------------------------------------------------------------------------

# 2. PRIMEIRA PERGUNTA OBRIGATÓRIA

Antes de iniciar o fluxo de Tabela Zero, perguntar:

> **Este empreendimento já está cadastrado no NEXUM e já possui alguma
> tabela cadastrada?**

## 2.1 Sim, já cadastrado + já possui tabela

Não gerar Tabela Zero.

Tratar a nova tabela como nova fotografia comercial e preservar
identidade/histórico.

Mensagem operacional:

> "Perfeito. O empreendimento já está cadastrado e já possui tabela. Não
> é necessário gerar a Tabela Zero. Vou processar esta tabela como uma
> nova fotografia comercial."

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

A Skill não deve gerar Tabela Zero silenciosamente quando a autorização
do usuário for necessária.

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

As 80 ausentes NÃO devem ser automaticamente classificadas como VENDIDAS
pela Skill.

A interpretação da ausência como venda pertence ao fluxo do NEXUM.

------------------------------------------------------------------------

# 4. CONTRATO DE IMPORTAÇÃO --- REGRA ABSOLUTA

A estrutura da V3 é o contrato.

A V6 pode adicionar:

-   proveniência;
-   auditoria;
-   fontes;
-   linha do tempo;
-   conflitos;
-   pendências;
-   informações cadastrais;
-   informações históricas;
-   metodologia de simulação.

A V6 não pode:

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
  "schema_version": "6.1",
  "status_processamento": "CONSOLIDADO",
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

`status_processamento`, `auditoria` e `fontes` são obrigatórios.

## 4.1 REGRA CRÍTICA — DATA DA TABELA X TÍTULO DO DOCUMENTO

Nunca assumir que o mês/ano escrito no título do PDF é a data efetiva da fotografia comercial.

Quando existirem datas diferentes no mesmo documento, distinguir e preservar: 

``` text
data_tabela = data efetiva da tabela/fotografia, quando comprovada
data_geracao = data em que o documento foi gerado, quando informada
titulo_original = título literal do documento
data_referencia_original = referência temporal literal do título, quando aplicável
```

Se houver, por exemplo, título `MARÇO 2026`, mas o documento registrar `Gerado dia 25/08/2026`, não substituir silenciosamente uma data pela outra. Registrar ambas, atribuir proveniência a cada uma e explicar a decisão na auditoria.

Se a data efetiva da fotografia não puder ser determinada, usar `NAO_DETERMINADO`/pendência em vez de inventar.

------------------------------------------------------------------------

# 5. UNIDADES NUNCA PODEM SER PERDIDAS

Se uma fonte contém unidades individualizadas, todas devem aparecer
individualmente em `tabela.unidades[]`.

Obrigatório:

``` text
unidades_apresentadas == quantidade(tabela.unidades)
```

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

Nunca perder o valor original.

## 6.1 REGRA CRÍTICA — VAGA QUANTIDADE X IDENTIFICADOR DE GARAGEM

Quando a tabela apresentar uma coluna como `GARAGEM` contendo números individuais (por exemplo, 5, 17, 23), NÃO interpretar automaticamente esse número como quantidade de vagas.

Regra obrigatória:

``` text
vaga = quantidade de vagas do imóvel
identificador da garagem/vaga = número da vaga quando a fonte o informar
```

Se a descrição disser `+1 VAGA`, o campo canônico `vaga` deve representar 1 vaga.
O número da garagem/vaga deve ser preservado separadamente em campo compatível com o contrato V3/V5, quando disponível (por exemplo, `numero_vaga`, `vaga_numero` ou `garagem`), sem substituir o campo `vaga`.

Se não houver campo estrutural compatível para armazenar o identificador, preservar o valor na `descricao_original` e/ou em metadado de proveniência, sem perder a informação.

Nunca converter um identificador de garagem em quantidade de vagas.

## 6.2 REGRA CRÍTICA — VALOR ORIGINAL

Campos `*_original` devem preservar a representação original da fonte, incluindo capitalização, acentuação, símbolos e texto, quando tecnicamente possível.

Exemplo:

``` json
"status": "DISPONIVEL",
"status_original": "Disponível"
```

O campo normalizado serve para classificação; o campo original serve para rastreabilidade.

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

Nunca transformar ausência da tabela em venda.

------------------------------------------------------------------------

# 8. CADASTRO DO EMPREENDIMENTO

A V6 deve pesquisar os campos correspondentes ao cadastro do NEXUM.

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

### Regra V6.1 — site oficial do empreendimento é a fonte máxima para dados estruturais quando contiver a informação

Quando a página oficial específica do empreendimento informar determinado dado estrutural ou cadastral, ela deve ser a referência primária para esse dado. Isso inclui, quando disponíveis: endereço, CEP, metragem, tipologias, quartos, suítes, vagas, características, lazer, status e previsão de entrega.

O sistema comercial oficial, documentos oficiais e demais fontes continuam sendo pesquisados para complementar, confirmar ou registrar divergências.

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

1.  página oficial específica do empreendimento;
2.  site oficial da construtora/incorporadora;
3.  sistema comercial oficial;
4.  documentos oficiais/registros/documentos públicos;
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

A interpretação de ausência como venda e os indicadores de gestão
pertencem ao NEXUM.

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

## Skill V6

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
interpretação de ausências como vendas, conforme regra do NEXUM
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

# 34. CHECKLIST FINAL V6

## Fluxo inicial

-   [ ] perguntou se empreendimento já está cadastrado;
-   [ ] perguntou se já existe tabela;
-   [ ] se já existe tabela, não gerou Tabela Zero;
-   [ ] se não existe tabela, perguntou se deseja Tabela Zero;
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
-   [ ] status original preservado;
-   [ ] quantidade de vagas separada do identificador da vaga/garagem;
-   [ ] valores e textos originais preservados;
-   [ ] data da tabela reconciliada com data de geração/título quando houver divergência.

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

------------------------------------------------------------------------

# 35. CONTRATO DE ENTREGA

Entregar sempre:

1.  JSON final;
2.  nome do empreendimento;
3.  data da tabela;
4.  tipo da tabela;
5.  status de cadastro;
6.  quantidade de unidades;
7.  distribuição por situação;
8.  pendências;
9.  alertas;
10. tabela anterior;
11. indicação de Tabela Zero;
12. data de lançamento;
13. fontes;
14. separação entre observado, pesquisado, confirmado, inferido,
    calculado e simulado;
15. metodologia da Tabela Zero;
16. nível de confiança.

Nunca declarar que o cadastro foi persistido no NEXUM.

------------------------------------------------------------------------

# 36. PRINCÍPIO-MESTRE

``` text
PERGUNTAR SOBRE CADASTRO/TABELA
→ IDENTIFICAR
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
→ AUDITAR
→ VALIDAR UNIDADES
→ VALIDAR JSON
→ GERAR
```

Regra final:

``` text
A V6.1 pode melhorar a inteligência.
A V6.1 pode melhorar a pesquisa.
A V6.1 pode reconstruir história quando autorizada.
A V6.1 pode simular uma Tabela Zero quando não existir tabela histórica completa.
A V6.1 pode ampliar o cadastro do empreendimento.

A V6.1 NÃO pode quebrar a importação existente.
A V6.1 NÃO pode inventar dados sem classificação.
A V6.1 NÃO pode transformar ausência em venda.
A V6.1 NÃO pode confundir tabela atual com estoque total.
A V6.1 NÃO pode confundir Tabela Zero Simulada com tabela histórica original.
A V6.1 NÃO deve executar indicadores analíticos que pertencem ao NEXUM.
```

A estrutura da V3 é o contrato. A inteligência de pesquisa da V4 é a
evolução. A V5 consolidou pesquisa, auditoria e validação. A V6 acrescentou fluxo de cadastro, decisão sobre Tabela Zero, reconstrução estrutural, pesquisa histórica de preços e simulação transparente. A V6.1 corrige o fluxo de cadastro, decisão sobre Tabela Zero, reconstrução
estrutural, pesquisa histórica de preços e simulação transparente.
