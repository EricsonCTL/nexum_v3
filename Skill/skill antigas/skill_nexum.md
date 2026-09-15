---
name: skill_nexum
description: Enriquece e processa cadastros imobiliários do Nexum, identificando empreendimento, incorporadora/construtora, fase comercial da obra, datas de lançamento e entrega, endereço completo, CEP e geolocalização, características do imóvel e informações comerciais. Pesquisa a internet para completar dados faltantes, reconcilia novas tabelas com empreendimentos já cadastrados, preserva histórico e gera JSON compatível com o Cadastro Central/Codex. Quando houver dúvida que possa alterar o cadastro, pergunta ao operador antes de gerar o JSON final.
---

# Skill: skill_nexum

## 1. Objetivo

Transformar uma tabela comercial, PDF, planilha ou texto de empreendimento imobiliário em um cadastro Nexum o mais completo e confiável possível.

A Skill deve fazer duas coisas simultaneamente:

1. **processar a fotografia comercial recebida**;
2. **enriquecer o cadastro do empreendimento e de suas unidades** com informações verificadas em fontes externas.

Arquitetura obrigatória:

```text
Entrada
→ identificação do empreendimento
→ identificação/reconciliação do cadastro existente
→ pesquisa externa e enriquecimento
→ classificação da fase/status do empreendimento
→ extração da tabela
→ normalização
→ comparação com histórico
→ identificação de dúvidas
→ confirmação humana quando necessário
→ JSON final
```

A Skill deve preservar a distinção entre:

```text
observado
inferido
pesquisado
confirmado
não determinado
```

Nunca apresentar uma informação pesquisada ou inferida como se estivesse diretamente no documento original.

---

# 2. Regra central: completar o cadastro antes de gerar o JSON

Ao receber uma nova tabela, a Skill NÃO deve simplesmente extrair as unidades e gerar JSON.

Primeiro deve verificar:

- se o empreendimento já existe no Cadastro Nexum/Cadastro Central;
- se o empreendimento é realmente o mesmo;
- se a nova tabela é uma nova fotografia do empreendimento já existente;
- se existe informação suficiente sobre incorporadora/construtora;
- fase atual do empreendimento;
- data de lançamento, quando aplicável;
- data prevista ou efetiva de entrega, quando aplicável;
- endereço completo;
- CEP;
- latitude;
- longitude;
- bairro;
- cidade;
- UF;
- características do empreendimento;
- características das unidades;
- informações comerciais;
- formas de pagamento;
- observações;
- demais campos relevantes encontrados no documento ou na pesquisa.

A regra é:

```text
cadastro incompleto
→ pesquisar
→ cruzar fontes
→ preencher o que for confiável
→ marcar o que continuar desconhecido
→ perguntar somente o que realmente exigir decisão humana
→ gerar JSON
```

---

# 3. Identificação do empreendimento

Antes de criar um novo empreendimento, procurar correspondência no cadastro existente.

A identificação deve considerar, em conjunto:

- nome comercial;
- nome jurídico ou nome de registro, se encontrado;
- incorporadora;
- construtora;
- endereço;
- bairro;
- cidade;
- UF;
- CEP;
- coordenadas;
- quantidade/configuração de unidades;
- características físicas;
- nomes alternativos;
- nomes antigos;
- informações presentes nas tabelas;
- fontes externas.

Nunca considerar apenas o nome como prova suficiente de identidade quando houver homônimos.

## 3.1 Empreendimento já cadastrado

Se houver correspondência segura:

```text
empreendimento_existente = true
```

A nova tabela deve ser tratada como:

```text
nova fotografia comercial do empreendimento existente
```

Nesse caso:

- NÃO criar empreendimento duplicado;
- NÃO trocar o ID existente;
- NÃO substituir silenciosamente dados antigos;
- atualizar somente campos com evidência melhor ou mais recente;
- preservar o histórico;
- comparar a nova tabela com a fotografia compatível anterior;
- registrar quais informações foram enriquecidas.

## 3.2 Possível correspondência, mas não conclusiva

Se houver dois ou mais candidatos plausíveis:

```text
status = "RECONCILIACAO_PENDENTE"
```

A Skill deve perguntar ao operador qual empreendimento é o correto.

Não gerar um novo empreendimento apenas para evitar a pergunta.

## 3.3 Empreendimento novo

Se não houver correspondência confiável:

```text
empreendimento_existente = false
```

Criar cadastro provisório apenas quando a identidade estiver suficientemente estabelecida.

---

# 4. Pesquisa obrigatória na internet

A Skill deve utilizar pesquisa na internet quando existirem dados faltantes, ambíguos ou importantes para completar o cadastro.

A pesquisa não deve ser limitada ao nome do PDF.

Pesquisar combinações como:

```text
"nome exato do empreendimento" + cidade
"nome exato do empreendimento" + construtora
"nome exato do empreendimento" + incorporadora
"nome exato do empreendimento" + lançamento
"nome exato do empreendimento" + entrega
"nome exato do empreendimento" + endereço
"nome exato do empreendimento" + CEP
```

Quando necessário:

```text
"nome" + bairro
"nome" + rua
"nome" + condomínio
"nome" + registro
"nome" + memorial
"nome" + apartamento
```

## 4.1 Hierarquia de fontes

Priorizar, nesta ordem, quando disponíveis:

1. site oficial da incorporadora/construtora;
2. página oficial do empreendimento;
3. documentação oficial do empreendimento;
4. órgãos públicos e bases oficiais;
5. registros e documentos públicos;
6. portais imobiliários reconhecidos;
7. imobiliárias/corretores;
8. notícias e publicações;
9. agregadores e diretórios.

Fontes conflitantes devem ser registradas.

Não escolher silenciosamente um valor quando duas fontes confiáveis divergem em informação relevante.

---

# 5. Proveniência da pesquisa externa

Toda informação obtida externamente deve registrar, quando disponível:

```json
{
  "campo": "deliveryDate",
  "valor": "2028-12-01",
  "classificacao": "pesquisado",
  "fonte": {
    "titulo": "...",
    "url": "...",
    "tipo": "site_oficial",
    "dataConsulta": "..."
  },
  "confianca": "alta"
}
```

Se uma fonte não puder ser vinculada diretamente no JSON final, registrar pelo menos:

- nome da fonte;
- domínio;
- título;
- data da consulta;
- contexto da evidência.

A informação original do documento deve continuar separada da informação pesquisada.

---

# 6. Fase do empreendimento

A Skill deve identificar explicitamente a fase comercial/operacional do empreendimento.

Valores canônicos:

```text
LANCAMENTO
NOVO
EM_OBRAS
ENTREGUE
NAO_DETERMINADO
```

## 6.1 LANCAMENTO

Usar quando houver evidência de que o empreendimento está em fase de lançamento comercial ou início de comercialização.

Exemplos de evidência:

- "lançamento";
- "breve lançamento" quando houver contexto suficiente;
- "pré-lançamento";
- campanha oficial de lançamento;
- abertura recente de vendas.

Não classificar como LANCAMENTO apenas porque a tabela é recente.

## 6.2 NOVO

Usar quando o empreendimento for comercializado como novo, mas não houver evidência suficiente para classificá-lo especificamente como lançamento.

`NOVO` não significa automaticamente "lançado recentemente".

## 6.3 EM_OBRAS

Usar quando houver evidência de construção em andamento.

Exemplos:

- obra iniciada;
- canteiro ativo;
- percentual de obra;
- fotos/relatórios de obra;
- cronograma indicando construção em andamento;
- comunicação oficial "em obras".

## 6.4 ENTREGUE

Usar quando houver evidência de entrega/conclusão/habite-se/ocupação compatível.

Quando houver data de entrega efetiva, registrar separadamente.

## 6.5 Conflitos

Se fontes indicarem fases diferentes:

```text
fase.status = "CONFLITO"
```

e gerar revisão.

Não resolver conflito apenas por preferência da fonte se a diferença puder alterar o cadastro comercial.

---

# 7. Datas do empreendimento

Separar rigorosamente:

### Lançamento

```text
launchDate
```

Pode representar a data de lançamento comercial.

### Início de obras

```text
constructionStartDate
```

Somente preencher se houver evidência.

### Entrega prevista

```text
deliveryDate
```

Quando for previsão.

### Entrega efetiva

```text
actualDeliveryDate
```

Quando houver confirmação da entrega.

### Habite-se

```text
occupancyPermitDate
```

Quando disponível e relevante.

Nunca converter uma previsão em data efetiva.

Exemplo:

```json
{
  "deliveryDate": {
    "value": "2028-06-01",
    "tipo": "prevista",
    "classificacao": "pesquisado"
  },
  "actualDeliveryDate": null
}
```

---

# 8. Endereço e geolocalização

O cadastro do empreendimento deve tentar obter:

- logradouro;
- número;
- complemento;
- bairro;
- cidade;
- estado;
- UF;
- CEP;
- latitude;
- longitude.

Estrutura recomendada:

```json
"endereco": {
  "logradouro": null,
  "numero": null,
  "complemento": null,
  "bairro": null,
  "cidade": null,
  "estado": null,
  "uf": null,
  "cep": null,
  "enderecoCompleto": null
},
"geolocalizacao": {
  "latitude": null,
  "longitude": null,
  "fonte": null,
  "classificacao": "nao_determinado"
}
```

## 8.1 Geocodificação

Latitude e longitude devem representar o empreendimento ou seu endereço, não coordenadas genéricas da cidade.

Se houver mais de uma localização plausível, não escolher arbitrariamente.

Perguntar ao operador.

Se a coordenada vier de geocodificação aproximada, marcar:

```text
classificacao = "inferido"
```

Se vier de fonte oficial ou localização inequívoca:

```text
classificacao = "pesquisado"
```

---

# 9. Construtora e incorporadora

A Skill deve procurar separar:

```text
construtora
incorporadora
```

mesmo que a estrutura histórica do Nexum tenha tratado a construtora como texto.

Não inventar CNPJ, razão social ou relacionamento empresarial.

Quando a fonte disser explicitamente:

```text
Incorporadora: X
Construtora: Y
```

preservar os dois papéis.

Se a mesma empresa exercer ambos:

```json
{
  "incorporadora": "Empresa X",
  "construtora": "Empresa X"
}
```

Se apenas houver "realização", "desenvolvimento" ou "construção" sem clareza jurídica, preservar o texto e marcar a interpretação.

---

# 10. Características do imóvel

A Skill deve preencher o cadastro de características tanto quanto os dados permitirem.

## 10.1 Dormitórios

Normalizar:

```text
1 quarto
2 quartos
3 quartos
4 quartos
5+ quartos
```

Preservar também o valor original.

Quando o empreendimento possuir múltiplas tipologias, não reduzir tudo a um único número.

Exemplo:

```json
"dormitorios": {
  "opcoes": [1, 2, 3],
  "classificacao": "pesquisado"
}
```

## 10.2 Suíte

```json
"suíte": {
  "valor": "sim|nao|nao_informado|varia_por_tipologia",
  "observacao": null
}
```

## 10.3 Área de lazer

```json
"areaDeLazer": {
  "valor": "sim|nao|nao_informado",
  "itens": []
}
```

## 10.4 Piscina

```json
"piscina": {
  "valor": "sim|nao|nao_informado",
  "tipo": null
}
```

## 10.5 Mobiliado

```json
"mobiliado": {
  "valor": "sim|nao|nao_informado|opcional"
}
```

Não confundir "decorado" com "mobiliado".

## 10.6 Financiável

```json
"financiavel": {
  "valor": "sim|nao|nao_informado",
  "modalidades": []
}
```

Não inferir financiabilidade apenas porque existe uma tabela de financiamento.

## 10.7 Condomínio fechado

```json
"condominioFechado": {
  "valor": "sim|nao|nao_informado"
}
```

## 10.8 Vagas

```json
"vagas": {
  "possui": "sim|nao|nao_informado",
  "quantidades": [],
  "observacao": null
}
```

Quando houver variação por tipologia, registrar a faixa ou distribuição.

---

# 11. Leitura comercial

A Skill deve capturar a leitura comercial do empreendimento e da tabela.

Campos:

```text
formasPagamento
caracteristicasComerciais
observacoes
```

## 11.1 Formas de pagamento

Usar as modalidades existentes no Nexum quando aplicáveis:

```text
FINANCIAMENTO_CEF
FINANCIAMENTO_BANCARIO
DIRETO_CONSTRUTORA
A_VISTA
```

Também preservar descrições livres.

Não assumir que uma modalidade não citada inexiste.

## 11.2 Características comerciais

Capturar informações como:

- entrada;
- parcelas;
- reforços;
- balões;
- financiamento;
- descontos;
- condições promocionais;
- correção monetária;
- juros;
- comissão;
- sinal;
- saldo;
- prazo;
- condições especiais.

Toda regra financeira inferida deve permanecer marcada como `inferido`.

## 11.3 Observações

Preservar observações relevantes do documento e da pesquisa sem transformar texto comercial em regra estrutural sem evidência.

---

# 12. Processamento da tabela

Depois do enriquecimento do empreendimento, processar a tabela comercial seguindo a lógica do Cadastro Central existente.

A fotografia deve continuar imutável.

Para cada unidade/lote:

- preservar texto original;
- preservar linha original quando disponível;
- normalizar identificadores;
- criar chave lógica;
- extrair área;
- extrair vagas;
- extrair tipologia;
- extrair preço;
- extrair preço por m²;
- extrair condições;
- extrair situação/status;
- registrar origem.

A chave lógica permanece:

```text
empreendimento_id:bloco_ou_quadra_normalizado:unidade_normalizada
```

O UUID técnico não substitui a chave lógica.

---

# 13. Nova tabela de empreendimento já existente

Este é um caso obrigatório.

Se:

```text
empreendimento encontrado
+
nova tabela
```

então:

1. reutilizar `empreendimento.id`;
2. não criar empreendimento novo;
3. identificar a modalidade da nova tabela;
4. localizar tabela anterior comparável;
5. comparar unidades pela chave lógica;
6. identificar novas;
7. identificar mantidas;
8. identificar ausentes;
9. identificar retornadas;
10. identificar alterações de preço;
11. identificar alterações de status;
12. identificar alterações comerciais;
13. atualizar o Cadastro Central;
14. preservar todas as fotografias anteriores;
15. registrar o enriquecimento do empreendimento;
16. registrar a auditoria.

---

# 14. Ausência não é venda

Manter a regra do Cadastro Central:

```text
unidade ausente ≠ venda
```

Uma ausência gera:

```text
UNIDADE_AUSENTE
```

com:

```text
revisao_pendente
```

Somente confirmação humana ou evidência suficiente pode gerar:

```text
VENDA_IDENTIFICADA
```

Não usar pesquisa genérica na internet como prova automática de venda de uma unidade específica.

---

# 15. Comparação de tabelas

Antes da comparação, verificar:

```text
mesmo empreendimento
+
modalidade compatível
+
contexto temporal
```

Classificações:

```text
UNIDADE_NOVA
UNIDADE_MANTIDA
UNIDADE_AUSENTE
UNIDADE_RETORNADA
ALTERACAO_VALOR
ALTERACAO_STATUS
ALTERACAO_CONDICAO
ALTERACAO_ATRIBUTO
REAJUSTE_PRECO
```

Não comparar modalidades diferentes como se fossem a mesma fotografia.

---

# 16. Perguntas ao operador

A Skill deve ser autônoma para pesquisar e preencher dados, mas deve perguntar quando a resposta humana for necessária para evitar cadastro errado.

Perguntar somente quando:

- houver dois empreendimentos plausíveis;
- houver conflito sério entre fontes;
- a fase não puder ser determinada e for importante para o cadastro;
- a construtora/incorporadora tiver identidade ambígua;
- o endereço puder corresponder a locais diferentes;
- a tabela tiver modalidade ambígua e isso afetar a reconciliação;
- uma unidade não puder ser identificada de forma segura;
- houver conflito entre dados do documento e fontes externas;
- houver uma decisão que altere o histórico de maneira irreversível.

## 16.1 Formato das perguntas

Ser direto e apresentar opções quando possível.

Exemplo:

```text
Encontrei dois empreendimentos com o nome "Lago dos Ipês":

1. Lago dos Ipês — Bairro X — Construtora Y
2. Lago dos Ipês — Bairro Z — Construtora W

Qual deles corresponde à tabela enviada?
```

Depois da resposta:

```text
continuar processamento
→ consolidar
→ gerar JSON
```

Não gerar um JSON definitivo antes da confirmação quando a dúvida afetar a identidade.

---

# 17. Regra de preenchimento por campo

Cada campo deve possuir uma classificação epistemológica.

Exemplo:

```json
{
  "valor": "Empresa X",
  "classificacao": "pesquisado",
  "fonte": "site oficial",
  "confianca": "alta"
}
```

Categorias:

### observado

Está no documento/tabela recebida.

### pesquisado

Foi encontrado em fonte externa.

### inferido

Foi derivado por interpretação ou regra.

### confirmado

Foi confirmado pelo operador ou por evidência suficiente.

### não_determinado

Não existe evidência suficiente.

---

# 18. Não inventar dados

Nunca inventar:

- CNPJ;
- razão social;
- número do endereço;
- CEP;
- coordenadas;
- data de lançamento;
- data de entrega;
- construtora;
- incorporadora;
- quantidade de quartos;
- suítes;
- vagas;
- piscina;
- financiamento;
- status;
- fase.

Quando não houver evidência:

```json
null
```

e:

```text
classificacao = "nao_determinado"
```

---

# 19. Prioridade entre fontes

Quando houver conflito, usar esta lógica:

1. documento oficial do empreendimento;
2. fonte oficial da incorporadora/construtora;
3. fonte pública oficial;
4. documento comercial mais recente;
5. fonte imobiliária confiável;
6. demais fontes.

Entretanto, a data também importa.

Para informações temporais:

```text
fonte confiável + data mais recente
```

pode prevalecer sobre fonte antiga.

Nunca apagar o valor histórico. Registrar a mudança.

---

# 20. Cadastro do empreendimento

Estrutura recomendada:

```json
{
  "id": null,
  "nome": null,
  "nomeOriginal": null,
  "nomesAlternativos": [],
  "incorporadora": null,
  "construtora": null,
  "fase": {
    "status": "LANCAMENTO|NOVO|EM_OBRAS|ENTREGUE|NAO_DETERMINADO",
    "classificacao": "observado|pesquisado|inferido|confirmado|nao_determinado",
    "evidencias": []
  },
  "datas": {
    "launchDate": null,
    "constructionStartDate": null,
    "deliveryDate": null,
    "actualDeliveryDate": null,
    "occupancyPermitDate": null
  },
  "endereco": {
    "logradouro": null,
    "numero": null,
    "complemento": null,
    "bairro": null,
    "cidade": null,
    "estado": null,
    "uf": null,
    "cep": null,
    "enderecoCompleto": null
  },
  "geolocalizacao": {
    "latitude": null,
    "longitude": null,
    "fonte": null,
    "classificacao": "nao_determinado"
  },
  "caracteristicasImovel": {
    "dormitorios": {
      "opcoes": []
    },
    "suite": null,
    "areaDeLazer": null,
    "piscina": null,
    "mobiliado": null,
    "financiavel": null,
    "condominioFechado": null,
    "vagas": null
  },
  "leituraComercial": {
    "formasPagamento": [],
    "caracteristicasComerciais": [],
    "observacoes": []
  },
  "fontesPesquisa": [],
  "historicoEnriquecimento": []
}
```

---

# 21. Cadastro da tabela

Manter compatibilidade com a estrutura existente:

```json
{
  "id": null,
  "name": null,
  "empreendimentoId": null,
  "validityDate": null,
  "tipoTabela": null,
  "tipoTabelaLabel": null,
  "status": "registered",
  "documento": {},
  "extracao": {},
  "comparacao": {},
  "origem": {},
  "confiancaLeitura": null,
  "regraInterpretada": {},
  "auditoria": [],
  "fatosGeradosIds": []
}
```

---

# 22. Unidade

Manter os campos já utilizados pelo Cadastro Central:

```text
id
chave
empreendimentoId
quadra/bloco/torre
unidade
areaPrivativa
vagas
descricaoExtraida
situacaoExtraida
situacaoPublicada
valorExtraido
valorInterpretado
valorValidado
valorPublicado
valorAvaliacaoExtraido
valorM2Extraido
condicoes
linhaOriginal
status
alertasFinanceiros
```

Adicionar, quando houver evidência:

```text
tipologia
dormitorios
suites
caracteristicas
origemDados
```

Não forçar características do empreendimento para todas as unidades se elas variarem por tipologia.

---

# 23. Auditoria do enriquecimento

Além da auditoria da tabela, registrar:

```json
{
  "evento": "ENRIQUECIMENTO_EMPREENDIMENTO",
  "campo": "cep",
  "valorAnterior": null,
  "valorNovo": "58000-000",
  "origem": "pesquisa_externa",
  "fonte": "...",
  "classificacao": "pesquisado",
  "data": "..."
}
```

Tipos sugeridos:

```text
IDENTIFICACAO_EMPREENDIMENTO
CONFIRMACAO_EMPREENDIMENTO
ENRIQUECIMENTO_ENDERECO
ENRIQUECIMENTO_GEOCODIFICACAO
ENRIQUECIMENTO_CONSTRUTORA
ENRIQUECIMENTO_INCORPORADORA
ENRIQUECIMENTO_FASE
ENRIQUECIMENTO_DATA_LANCAMENTO
ENRIQUECIMENTO_DATA_ENTREGA
ENRIQUECIMENTO_CARACTERISTICAS
ENRIQUECIMENTO_COMERCIAL
CONFLITO_FONTE
CONFIRMACAO_HUMANA
```

---

# 24. Saída final

A saída deve combinar o enriquecimento do empreendimento com o processamento comercial:

```json
{
  "diagnostico": {
    "status": "sucesso|revisao|erro",
    "confianca": null,
    "avisos": [],
    "erros": []
  },
  "identificacao": {
    "empreendimentoExistente": false,
    "empreendimentoId": null,
    "confiancaIdentificacao": null,
    "candidatos": []
  },
  "empreendimento": {},
  "tabelaProcessada": {},
  "unidades": [],
  "comparacao": {
    "novas": [],
    "mantidas": [],
    "ausentes": [],
    "retornadas": [],
    "alteracoesValor": [],
    "alteracoesStatus": [],
    "alteracoesAtributos": [],
    "alteracoesComerciais": []
  },
  "cadastroCentral": {
    "empreendimentoNovo": false,
    "novas": [],
    "atualizadas": [],
    "revisaoPendente": []
  },
  "historico": [],
  "fatosComerciais": [],
  "fontesPesquisa": [],
  "confirmacoesNecessarias": [],
  "alertas": [],
  "auditoria": []
}
```

---

# 25. Critério de conclusão

A Skill só deve declarar:

```text
status = "sucesso"
```

quando:

- o empreendimento estiver identificado com segurança;
- a tabela estiver processada;
- a modalidade estiver determinada ou explicitamente aceita como desconhecida;
- as unidades estiverem normalizadas;
- o cadastro do empreendimento tiver sido enriquecido tanto quanto possível;
- conflitos relevantes estiverem resolvidos;
- nenhuma decisão irreversível tiver sido tomada sem confirmação.

Se houver dúvida que impeça a identificação ou reconciliação:

```text
status = "revisao"
```

e `confirmacoesNecessarias` deve conter perguntas objetivas.

---

# 26. Checklist obrigatório antes do JSON

### Identidade

- [ ] Empreendimento pesquisado
- [ ] Verificado se já existe
- [ ] ID existente reutilizado quando aplicável
- [ ] Duplicidade descartada

### Empresa

- [ ] Incorporadora pesquisada
- [ ] Construtora pesquisada
- [ ] Papéis separados quando possível

### Fase

- [ ] Lançamento avaliado
- [ ] Novo avaliado
- [ ] Em obras avaliado
- [ ] Entregue avaliado
- [ ] Conflitos registrados

### Datas

- [ ] Lançamento
- [ ] Início de obras
- [ ] Entrega prevista
- [ ] Entrega efetiva
- [ ] Habite-se, se disponível

### Localização

- [ ] Logradouro
- [ ] Número
- [ ] Bairro
- [ ] Cidade
- [ ] UF
- [ ] CEP
- [ ] Latitude
- [ ] Longitude

### Características

- [ ] Dormitórios
- [ ] Suíte
- [ ] Área de lazer
- [ ] Piscina
- [ ] Mobiliado
- [ ] Financiável
- [ ] Condomínio fechado
- [ ] Vagas

### Comercial

- [ ] Formas de pagamento
- [ ] Características comerciais
- [ ] Observações
- [ ] Modalidade da tabela
- [ ] Condições financeiras

### Histórico

- [ ] Tabela anterior localizada
- [ ] Comparação executada
- [ ] Novas identificadas
- [ ] Ausentes identificadas
- [ ] Alterações registradas
- [ ] Ausência não convertida automaticamente em venda

### Proveniência

- [ ] Fonte do documento
- [ ] Hash quando disponível
- [ ] Fontes externas registradas
- [ ] Classificação epistemológica registrada
- [ ] Auditoria registrada

---

# 27. Integração com o Codex

A Skill não deve substituir o módulo do Codex.

Separação:

```text
SKILL_NEXUM
    ↓
identificação + pesquisa + normalização + decisão/revisão + JSON
    ↓
CODEX
    ↓
persistência + IDs + sequences + histórico + Cadastro Central + regras de aplicação
```

O Codex deve continuar sendo a camada responsável por:

- persistência;
- geração de IDs;
- sequences;
- gravação das entidades;
- reconciliação final;
- histórico;
- fatos comerciais;
- integridade referencial;
- atualização do Cadastro Central.

A Skill pode sugerir um novo empreendimento, mas o Codex deve ser responsável pela persistência definitiva.

---

# 28. Regra especial para nova tabela de empreendimento existente

Quando uma tabela nova chegar para um empreendimento já existente:

```text
NÃO criar novo empreendimento
NÃO duplicar construtora
NÃO duplicar endereço
NÃO duplicar cadastro
```

Executar:

```text
localizar empreendimento
→ enriquecer cadastro
→ registrar nova tabela
→ localizar tabela comparável
→ comparar unidades
→ atualizar estado atual
→ preservar histórico
→ registrar fatos
→ gerar JSON
```

Se o empreendimento já possuir dados melhores do que a nova fonte, manter o dado existente e registrar que a nova fonte foi consultada.

---

# 29. Regra de atualização de dados existentes

Para cada campo enriquecido:

```text
valor existente
+
novo valor
+
qualidade da fonte
+
recência
```

decidir:

### Melhor evidência

Atualizar o campo atual e registrar histórico.

### Evidência equivalente

Manter o valor atual e registrar a nova fonte.

### Evidência conflitante

Não substituir automaticamente.

Gerar:

```text
CONFLITO_FONTE
```

e, se necessário:

```text
CONFIRMACAO_NECESSARIA
```

---

# 30. Compatibilidade com o Cadastro Central existente

Esta Skill incorpora e preserva os princípios da Skill `cadastro-central` existente:

- tabela como fotografia versionada;
- Cadastro Central acumulativo;
- chave lógica da unidade;
- histórico;
- fatos comerciais;
- auditoria;
- proveniência;
- separação entre observado, inferido e confirmado;
- ausência diferente de venda;
- comparação por empreendimento e modalidade;
- preservação do documento original.

A nova responsabilidade adicionada é:

```text
ENRIQUECIMENTO DO EMPREENDIMENTO + PESQUISA EXTERNA + RECONCILIAÇÃO DE IDENTIDADE
```

---

# 31. Princípio final

A prioridade da `skill_nexum` é:

```text
IDENTIDADE CORRETA
>
DADOS COMPLETOS
>
EVIDÊNCIA
>
PROVENIÊNCIA
>
HISTÓRICO
>
AUTOMAÇÃO
```

E, em qualquer conflito:

```text
não inventar
→ pesquisar
→ cruzar fontes
→ perguntar quando necessário
→ somente então gerar o JSON definitivo
```
