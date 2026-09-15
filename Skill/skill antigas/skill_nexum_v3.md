---
name: skill_nexum_v3
description: Pesquisa profundamente, reconcilia e transforma tabelas imobiliárias em JSON compatível com o módulo Gestão do NEXUM, com pesquisa web obrigatória, confirmação humana, reconstrução histórica opcional, proveniência e comparação entre fotografias comerciais.
---

# Skill NEXUM v3.0 — pesquisa, reconstrução histórica e geração de JSON

## Objetivo

Receber PDF, planilha, texto, imagem ou JSON de uma tabela imobiliária, identificar corretamente o empreendimento, pesquisar e completar os dados confiáveis disponíveis na web, verificar se o empreendimento já está cadastrado no NEXUM, definir o tipo da tabela, comparar com tabelas anteriores e gerar uma saída JSON compatível com o módulo Gestão do NEXUM.

A Skill deve trabalhar como um processo de investigação e reconciliação, e não apenas como um conversor de tabela.

Não criar arquivos intermediários fora do JSON final, salvo quando necessário para validação técnica. Não modificar o Cadastro Central diretamente: persistência, IDs técnicos e gravação definitiva são responsabilidades do NEXUM.

---

## 1. Perguntas obrigatórias antes de gerar o JSON

Antes de gerar qualquer JSON, confirmar com o operador, quando a informação ainda não estiver explícita:

1. **Qual é o tipo da tabela?**
2. **Qual é a data de vigência da tabela?**
3. **O empreendimento já está cadastrado no NEXUM?**
4. **Existe alguma tabela anterior conhecida para comparação?**
5. Quando necessário, **o operador autoriza reconstrução/simulação de uma tabela histórica de lançamento?**

Não gerar o arquivo final enquanto houver dúvida material sobre o tipo da tabela ou a identidade do empreendimento.

### Tipos usuais de tabela

Usar, conforme o caso:

```text
LANCAMENTO
PRECO_ATUAL
ATUALIZACAO
HISTORICA
ESTOQUE_INICIAL_SIMULADO
OUTRA
```

Se o tipo vier em linguagem diferente, preservar o texto original em auditoria e normalizar para o valor canônico mais adequado.

---

## 2. Regra de cadastro do empreendimento

### 2.1 Empreendimento já cadastrado

Quando o operador confirmar que o empreendimento **já está cadastrado no NEXUM**:

- tratar a nova tabela como uma nova fotografia comercial;
- preservar a identidade do empreendimento;
- comparar com a fotografia anterior, quando disponível;
- não criar tabela zero nem reconstrução de lançamento automaticamente;
- não substituir dados cadastrais já confirmados sem evidência melhor e sem registrar a alteração;
- gerar somente a tabela solicitada, salvo pedido explícito do operador.

### 2.2 Empreendimento ainda não cadastrado

Quando o operador informar que o empreendimento **não está cadastrado**:

1. pesquisar profundamente o empreendimento;
2. localizar, quando possível, construtora e incorporadora;
3. procurar o site oficial da construtora/incorporadora;
4. procurar materiais comerciais, folders, anúncios e tabelas antigas;
5. investigar data de lançamento, início das obras, entrega prevista, entrega efetiva e situação atual;
6. investigar endereço, bairro, CEP e coordenadas;
7. investigar tipologias, áreas, número de quartos, vagas, torres/blocos, lazer e demais características;
8. investigar quantidade total de unidades, quando houver evidência;
9. procurar preços históricos próximos ao lançamento;
10. avaliar se existe evidência suficiente para criar uma **tabela zero** ou **fotografia inicial simulada**.

A tabela zero nunca deve ser apresentada como documento histórico real quando não houver uma tabela original. Deve ser marcada como simulada/inferida e depender de confirmação do operador.

---

## 3. Pesquisa web obrigatória

Quando faltarem informações cadastrais, históricas ou comerciais, realizar pesquisa na web antes de declarar o dado como não encontrado.

A pesquisa deve combinar:

### 3.1 Busca ampla na web

Fazer busca geral com múltiplas combinações, por exemplo:

```text
"Nome do empreendimento" + cidade
"Nome do empreendimento" + apartamento
"Nome do empreendimento" + construtora
"Nome do empreendimento" + lançamento
"Nome do empreendimento" + tabela
"Nome do empreendimento" + preço
"Nome do empreendimento" + entrega
"Nome do empreendimento" + endereço
"Nome do empreendimento" + CEP
"Nome do empreendimento" + "pronto para morar"
"Nome do empreendimento" + Instagram
"Nome do empreendimento" + Facebook
```

A busca ampla deve ser usada para descobrir fontes que não estavam previamente conhecidas.

### 3.2 Sites prioritários de anúncios e imobiliárias

Pesquisar, quando houver resultados relevantes:

- Investlar;
- OLX;
- ZAP Imóveis;
- Viva Real;
- Chaves na Mão;
- Imovelweb;
- Facebook;
- Instagram;
- sites de imobiliárias locais;
- sites de corretores;
- portais imobiliários regionais;
- páginas antigas indexadas por mecanismos de busca.

Em Campina Grande/PB, dar atenção especial a imobiliárias e portais locais, inclusive **Investlar**, quando houver anúncio do empreendimento.

### 3.3 Fonte oficial prioritária

Assim que a construtora ou incorporadora for identificada:

1. pesquisar o site oficial;
2. pesquisar páginas específicas do empreendimento;
3. verificar se existem folders, memoriais, plantas, tabelas de preços ou arquivos PDF;
4. procurar informações de lançamento, andamento da obra e entrega;
5. procurar CNPJ e razão social apenas quando houver fonte confiável;
6. registrar se a construtora disponibiliza ou disponibilizou tabelas comerciais.

A fonte oficial tem prioridade para dados institucionais, mas anúncios de imobiliárias podem ser usados para histórico comercial quando a fonte oficial não preservar dados antigos.

### 3.4 Pesquisa histórica de preço

Quando o empreendimento for novo no NEXUM, procurar anúncios antigos para responder:

- qual era o preço “a partir de” no lançamento;
- se havia diferenças por posição, pavimento ou tipologia;
- quais unidades aparecem em materiais históricos;
- quais campanhas comerciais existiam;
- se é possível reconstruir um intervalo plausível de preços de lançamento.

Não transformar automaticamente um anúncio “a partir de R$ X” no preço exato de todas as unidades.

Quando houver simulação por posição/tipologia, registrar explicitamente:

```text
classificacao: inferido
origem: simulacao_autorizada_pelo_operador
```

---

## 4. Hierarquia de confiança das fontes

Priorizar evidências na seguinte ordem, sem tratar a ordem como absoluta quando houver conflito:

1. documento oficial do empreendimento;
2. site oficial da construtora/incorporadora;
3. tabela comercial original;
4. registro público ou fonte institucional;
5. site de imobiliária com anúncio detalhado;
6. portal imobiliário consolidado;
7. publicação de corretor;
8. rede social;
9. trecho indexado por mecanismo de busca;
10. inferência.

Quando duas fontes divergirem, não escolher silenciosamente. Registrar a divergência e solicitar decisão do operador quando ela afetar identidade, endereço, datas, quantidade de unidades ou valores.

---

## 5. Confirmação humana antes de consolidar pesquisa

Após a pesquisa, apresentar ao operador um resumo dos dados encontrados quando houver informação relevante nova ou inferida.

Separar claramente:

- **observado**: veio diretamente da tabela/documento recebido;
- **pesquisado**: encontrado em fonte externa;
- **confirmado**: validado explicitamente pelo operador;
- **inferido**: reconstruído por lógica ou simulação;
- **nao_determinado**: não foi possível estabelecer.

Dados inferidos que alterem histórico comercial, datas ou quantidade total de unidades devem ser confirmados pelo operador antes de serem usados como base histórica consolidada.

---

## 6. Datas e precisão temporal

Manter separados:

- data de lançamento;
- início das obras;
- entrega prevista;
- entrega efetiva;
- data da tabela comercial;
- data de vigência informada pelo operador.

### 6.1 Data exata conhecida

Usar:

```text
YYYY-MM-DD
```

### 6.2 Somente mês conhecido

Pode usar:

```text
YYYY-MM
```

ou, quando o fluxo do NEXUM exigir uma data completa e o operador autorizar a normalização:

```text
primeiro dia do mês
```

Registrar a precisão reduzida em auditoria.

### 6.3 Intervalo ou período aproximado

Quando a fonte trouxer apenas uma faixa, usar uma data operacional somente com lógica explícita e rastreável.

Exemplos autorizados pelo padrão operacional:

- “março ou abril de 2024” → pode ser normalizado para `2024-04-01`;
- “primeiro semestre de 2025” → pode ser normalizado para `2025-06-01`;
- “segundo semestre de 2025” → pode ser normalizado para `2025-12-01`.

Nesses casos, registrar:

```json
{
  "classificacao": "inferido",
  "precisao": "PERIODO_APROXIMADO",
  "criterio_normalizacao": "..."
}
```

Não apresentar a data normalizada como se o dia exato tivesse sido publicado.

---

## 7. Reconstrução da tabela zero / lançamento

Quando o empreendimento não estiver cadastrado e não houver tabela histórica completa, a Skill deve avaliar a possibilidade de criar uma fotografia inicial para permitir comparação futura no NEXUM.

### 7.1 Condições mínimas

A reconstrução deve ter, idealmente:

- lista confiável de unidades ou estrutura completa do edifício;
- áreas/tipologias conhecidas;
- evidência de preço de lançamento ou intervalo plausível;
- data de lançamento aproximada;
- confirmação do operador.

### 7.2 Status da tabela zero

Se o operador decidir que a fotografia inicial representará o estoque completo do lançamento:

- todas as unidades podem ser registradas como `DISPONIVEL`;
- registrar que o status foi definido por decisão do operador;
- não afirmar que uma tabela histórica original comprovou essa disponibilidade;
- preservar a lista real de unidades conhecida;
- valores simulados devem ser marcados como inferidos.

### 7.3 Preços simulados

Se houver apenas “a partir de R$ X” ou preços parciais:

- usar diferenças por posição, pavimento, área ou tipologia somente quando houver indício razoável;
- não criar precisão falsa;
- manter a lógica da simulação em `auditoria`;
- registrar cada preço como `inferido`;
- solicitar confirmação do operador antes da geração final.

---

## 8. Formato de saída obrigatório

O JSON final deve conter um objeto na raiz com, no mínimo:

```json
{
  "schema": "nexum-skill-json",
  "schema_version": "3.0",
  "status_processamento": "CONSOLIDADO",
  "empreendimento": {},
  "tabela": {},
  "resumo_comercial": {},
  "comparacao": {},
  "validacoes": [],
  "pendencias": [],
  "auditoria": [],
  "fontes": []
}
```

Use `tabela` quando houver uma tabela por arquivo.

`tabela_comercial` e `tabelaProcessada` podem ser aceitos para compatibilidade, mas não misturar estruturas sem necessidade.

O objeto da tabela deve conter:

```json
{
  "id": "EMPREENDIMENTO_ATUAL_2026-08-01",
  "tipo": "PRECO_ATUAL",
  "data_tabela": "2026-08-01",
  "arquivo_origem": "nome-do-arquivo.pdf",
  "unidades_apresentadas": 44,
  "unidades": []
}
```

---

## 9. Estruturas de unidades aceitas

O gerador deve produzir uma destas formas compatíveis:

1. `tabela.unidades[]`;
2. `tabela_comercial.unidades[]`;
3. `tabelaProcessada.unidades[]`.

Para compatibilidade legada, `unidades[]` na raiz também pode ser incluído, mas não é obrigatório quando a tabela já contém o array.

Antes de finalizar, verificar programaticamente:

```text
Array.isArray(tabela.unidades)
```

Se não houver unidades, gerar:

```text
status_processamento: REVISAO
```

e registrar uma pendência objetiva.

---

## 10. Empreendimento

Preencher com evidência observada, pesquisada, confirmada ou inferida explicitamente.

Manter separados:

- `empreendimento.nome`;
- `empreendimento.incorporadora`;
- `empreendimento.construtora`;
- `empreendimento.endereco`;
- `empreendimento.coordenadas`;
- `empreendimento.fase`;
- `empreendimento.datas`;
- `empreendimento_caracteristicas`.

Não inventar CNPJ, CEP, coordenadas, empresa ou características.

Campos desconhecidos permanecem `null` ou vazios conforme o tipo e devem ser registrados em `pendencias`.

Fases canônicas:

```text
LANCAMENTO | NOVO | EM_OBRAS | ENTREGUE | NAO_DETERMINADO
```

`PRONTO_PARA_MORAR`, `PRONTO` e `CONCLUIDO` significam `ENTREGUE` somente quando o contexto sustentar essa interpretação.

---

## 11. Unidade

Cada item de `unidades[]` deve preservar o texto original e usar, quando disponíveis:

```json
{
  "apartamento": "101",
  "area_m2": 57.79,
  "tipologia": "2 quartos",
  "posicao": "SUL",
  "vaga": "carro",
  "status": "DISPONIVEL",
  "status_original": "DISPONIVEL",
  "investimento": 353611.21,
  "preco": 353611.21,
  "valorVenda": 353611.21
}
```

Também são aceitos os nomes equivalentes:

```text
unidade
numero
chave
valorVenda
preco
area_coberta_m2
area_descoberta_m2
```

Não remover o campo original ao criar um campo normalizado.

---

## 12. Situações comerciais

Usar os valores documentais em maiúsculas:

```text
DISPONIVEL
VENDIDO
RESERVADO
BLOQUEADO
INDISPONIVEL
RETIRADO
NAO_IDENTIFICADO
```

Preservar o status real da tabela.

Exemplo:

```json
{
  "status": "RESERVADO",
  "status_original": "RESERVADO"
}
```

Regras de indicador pertencentes ao NEXUM não devem alterar o status documental no JSON de origem quando o operador pedir preservação literal.

Se existir uma regra de negócio que trate `RESERVADO` como vendido nos indicadores, ela pode ser registrada separadamente em auditoria ou metadados, sem substituir `status: RESERVADO`.

Não transformar unidade ausente entre tabelas em venda automaticamente.

Ausência deve aparecer em comparação e/ou pendências.

Exceção: somente quando o operador declarar explicitamente que, para um empreendimento e fotografia específicos, toda unidade ausente deve ser considerada vendida.

Essa decisão não pode ser reutilizada automaticamente em outro empreendimento.

---

## 13. Histórico e comparação

Quando houver duas ou mais fotografias do mesmo empreendimento, importar em ordem cronológica.

Manter a mesma identidade do empreendimento.

Para tabelas comparáveis, gerar:

```json
"comparacao": {
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

Comparar pela chave natural formada por:

```text
empreendimento + bloco/torre/quadra + unidade
```

UUID técnico não é chave de comparação.

O JSON não precisa calcular IVV, VSO, absorção ou outros indicadores quando esses cálculos pertencem ao NEXUM. O objetivo é fornecer fotografias comerciais coerentes, datadas e comparáveis.

---

## 14. Proveniência e fontes

Toda informação relevante deve ter uma classificação:

```text
observado
pesquisado
confirmado
inferido
nao_determinado
```

Registrar em `fontes`:

- URL ou identificação da fonte;
- tipo da fonte;
- informação que ela sustenta;
- data da consulta, quando disponível;
- nível de confiança, quando relevante.

Não esconder a origem de informações simuladas.

---

## 15. Validação final obrigatória

Antes de entregar o JSON:

- confirmar que a raiz é um objeto;
- confirmar que existe um array de unidades válido;
- conferir que `unidades_apresentadas` equivale à quantidade do array;
- conferir duplicidades de apartamento/chave;
- conferir contagens por status;
- conferir tipo da tabela;
- conferir data da tabela;
- conferir se o empreendimento é novo ou já cadastrado;
- conferir identidade do empreendimento e evitar confusão com empreendimentos de nome semelhante;
- conferir que tabela histórica e atual não foram misturadas;
- conferir que ausências não foram convertidas em vendas sem autorização;
- conferir valores, promoções, descontos e status;
- registrar divergências financeiras como alertas sem apagar o valor original;
- conferir se dados pesquisados possuem fonte;
- conferir se dados inferidos estão identificados como inferidos;
- conferir se uma tabela zero simulada foi explicitamente autorizada.

O status só pode ser `CONSOLIDADO` quando a tabela e suas unidades estiverem presentes e não houver conflito material não resolvido.

Se houver conflito de identidade, data, modalidade, fonte ou reconstrução histórica, usar:

```text
status_processamento: REVISAO
```

e explicar a decisão necessária em `pendencias`.

---

## 16. Fluxo operacional resumido

```text
1. Receber a tabela.
2. Identificar o empreendimento.
3. Perguntar o tipo da tabela.
4. Perguntar a data de vigência, se não estiver clara.
5. Perguntar se o empreendimento já está cadastrado no NEXUM.
6. Pesquisar o empreendimento na web.
7. Identificar construtora/incorporadora.
8. Pesquisar primeiro a fonte oficial disponível.
9. Pesquisar Investlar, OLX, ZAP, Viva Real e demais portais/imobiliárias.
10. Fazer busca ampla na web por anúncios antigos e informações históricas.
11. Verificar lançamento, entrega, endereço, CEP, coordenadas, tipologia, áreas e características.
12. Se o empreendimento for novo, procurar evidência para uma tabela zero.
13. Apresentar achados e inferências relevantes ao operador.
14. Obter confirmação quando houver reconstrução ou data aproximada relevante.
15. Gerar o JSON.
16. Validar estrutura, unidades, status, datas, preços e proveniência.
17. Entregar arquivo e resumo.
```

---

## 17. Contrato de entrega ao operador

Entregar sempre:

1. arquivo JSON final;
2. nome do empreendimento;
3. data da tabela;
4. tipo da tabela;
5. indicação se o empreendimento já estava cadastrado ou é novo;
6. quantidade de unidades;
7. distribuição por situação;
8. pendências e alertas;
9. indicação explícita de tabela anterior;
10. indicação explícita de tabela zero/reconstrução histórica, quando existir;
11. resumo das fontes pesquisadas;
12. separação clara entre valores observados e valores simulados.

Nunca declarar que o cadastro foi persistido no NEXUM.

O JSON é a entrada estruturada. A confirmação, os cálculos de indicadores e a persistência pertencem ao módulo Gestão do NEXUM.

---

## 18. Princípio central da Skill v3.0

A Skill não deve se limitar ao conteúdo da tabela recebida.

Ela deve:

- investigar;
- pesquisar;
- comparar;
- encontrar fontes;
- questionar dados insuficientes;
- evitar concordar automaticamente com inferências frágeis;
- distinguir fato, pesquisa e simulação;
- pedir confirmação quando necessário;
- preservar o histórico comercial;
- entregar ao NEXUM fotografias coerentes e auditáveis.
