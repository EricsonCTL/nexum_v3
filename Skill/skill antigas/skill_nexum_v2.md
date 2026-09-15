---
name: skill_nexum_v2
description: Pesquisa, reconcilia e transforma tabelas imobiliárias em JSON compatível com o módulo Gestão do NEXUM, preservando identidade, histórico, proveniência, comparação entre tabelas e revisão humana.
---

# Skill NEXUM — geração de JSON compatível

## Objetivo

Receber PDF, planilha, texto ou JSON de uma tabela imobiliária, pesquisar e completar os dados confiáveis do empreendimento, comparar com tabelas anteriores e gerar uma saída JSON que o importador da Gestão do NEXUM consiga ler sem conversão manual.

Não criar arquivos intermediários fora do JSON final. Não modificar o Cadastro Central diretamente: a persistência, os IDs técnicos e a gravação definitiva são responsabilidades do NEXUM.

## Formato de saída obrigatório

O JSON final deve conter um objeto na raiz com, no mínimo:

```json
{
  "schema": "nexum-skill-json",
  "schema_version": "2.0",
  "status_processamento": "CONSOLIDADO",
  "empreendimento": {},
  "tabela": {},
  "tabela_comercial": {},
  "resumo_comercial": {},
  "validacoes": [],
  "pendencias": [],
  "auditoria": [],
  "fontes": []
}
```

Use `tabela` quando houver uma tabela por arquivo. Use `tabela_comercial` quando esse for o nome do modelo adotado. Não misture as duas estruturas no mesmo arquivo sem necessidade.

O objeto da tabela deve conter:

```json
{
  "id": "NOZ_ATUAL_2026-08-10",
  "tipo": "PRECO_ATUAL",
  "data_tabela": "2026-08-10",
  "arquivo_origem": "nome-do-arquivo.pdf",
  "unidades_apresentadas": 44,
  "unidades": []
}
```

`data_tabela` aceita `YYYY-MM-DD` ou `YYYY-MM`. Nunca inventar o dia. Se só houver mês, o importador normaliza para o primeiro dia e registra a precisão reduzida.

## Estruturas que devem ser aceitas pelo gerador

O gerador deve sempre produzir uma destas formas compatíveis:

1. `tabela.unidades[]`;
2. `tabela_comercial.unidades[]`;
3. `tabelaProcessada.unidades[]`.

Para máxima compatibilidade legada, `unidades[]` na raiz também pode ser incluído, mas não é obrigatório quando a tabela já contém o array.

Antes de finalizar, verificar programaticamente:

```text
Array.isArray(tabela.unidades)
```

Se não houver unidades, gerar `status_processamento: "REVISAO"` e uma pendência objetiva; nunca gerar um JSON aparentemente consolidado.

## Empreendimento

Preencher apenas com evidência observada ou pesquisada. Manter separados:

- `empreendimento.nome`;
- `empreendimento.incorporadora`;
- `empreendimento.construtora`;
- `empreendimento.endereco`;
- `empreendimento.coordenadas`;
- `empreendimento.fase`;
- `empreendimento.datas`;
- `empreendimento_caracteristicas`, quando houver.

Não inventar CNPJ, CEP, coordenadas, datas, empresa ou características. Campos desconhecidos permanecem `null` ou string vazia conforme o tipo, com registro em `pendencias`.

Fases canônicas:

```text
LANCAMENTO | NOVO | EM_OBRAS | ENTREGUE | NAO_DETERMINADO
```

O valor de fase deve ser acompanhado de evidência. `PRONTO_PARA_MORAR`, `PRONTO` e `CONCLUIDO` significam `ENTREGUE` somente quando o contexto sustentar essa interpretação.

## Unidade

Cada item de `unidades[]` deve preservar o texto original e usar, quando disponíveis, estes campos:

```json
{
  "apartamento": "101",
  "area_m2": 57.79,
  "posicao": "SUL",
  "status": "DISPONIVEL",
  "investimento": 353611.21,
  "sinal_10": 35361.12,
  "mensais_15": 53041.98,
  "saldo_banco": 247527.85
}
```

Também são aceitos os nomes equivalentes `unidade`, `numero`, `chave`, `valorVenda`, `preco`, `area_coberta_m2` e `area_descoberta_m2`. Não remover o campo original ao criar um campo normalizado.

## Situações comerciais

Usar os valores documentais em maiúsculas no JSON de origem:

```text
DISPONIVEL | VENDIDO | RESERVADO | BLOQUEADO | INDISPONIVEL | RETIRADO | NAO_IDENTIFICADO
```

Regra do NEXUM: `RESERVADO` deve entrar nos indicadores como vendido quando não houver regra específica mais recente do operador. Preservar a evidência:

```json
{
  "status": "RESERVADO",
  "status_original": "RESERVADO",
  "status_regra": "RESERVADA_CONSIDERADA_VENDIDA"
}
```

Não transformar unidade ausente entre tabelas em venda. Ausência deve aparecer em `comparacao.ausentes` e `pendencias` para revisão.

Exceção autorizada por decisão explícita do operador: quando o operador declarar
que, para um empreendimento e uma fotografia específicos, toda unidade ausente
da tabela atual deve ser considerada vendida, registrar essa regra no histórico,
classificar cada chave ausente como `VENDIDA` e manter a observação da decisão.
Essa exceção não pode ser aplicada automaticamente a outros empreendimentos.

## Datas, histórico e comparação

Separar:

- data de lançamento do empreendimento;
- início de obras;
- entrega prevista;
- entrega efetiva;
- data da tabela comercial.

Quando forem fornecidos dois JSONs do mesmo empreendimento, produzir dois arquivos válidos ou um lote explicitamente identificado. O operador deve importar primeiro a tabela mais antiga e depois a mais recente, mantendo a mesma identidade do empreendimento.

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

Comparar pela chave natural formada por empreendimento, bloco/torre/quadra e unidade. UUID técnico não é chave de comparação.

## Proveniência e classificação

Toda informação deve ser classificada como `observado`, `pesquisado`, `inferido`, `confirmado` ou `nao_determinado`. Manter `fontes`, `auditoria` e `validacoes` separados dos valores comerciais.

## Validação final obrigatória

Antes de entregar o JSON:

- confirmar que a raiz é um objeto;
- confirmar que existe `tabela.unidades[]`, `tabela_comercial.unidades[]` ou `tabelaProcessada.unidades[]`;
- conferir que `unidades_apresentadas` equivale à quantidade do array;
- conferir duplicidades de apartamento/chave;
- conferir contagens por status;
- conferir datas e modalidade;
- conferir se o empreendimento é novo ou existente;
- conferir que a tabela anterior e a atual não foram misturadas;
- conferir que ausências não foram convertidas em vendas;
- registrar divergências financeiras como alertas, sem apagar valores originais.

O status só pode ser `CONSOLIDADO` quando a tabela e suas unidades estiverem presentes. Se houver conflito de identidade, data, modalidade ou fonte, usar `REVISAO` e explicar a decisão necessária em `pendencias`.

## Contrato de entrega ao operador

Entregar sempre:

1. o arquivo JSON final;
2. o nome do empreendimento;
3. a data e o tipo da tabela;
4. a quantidade de unidades;
5. a distribuição por situação;
6. as pendências e alertas;
7. uma indicação explícita se existe tabela anterior para comparação.

Nunca declarar que o cadastro foi persistido no NEXUM. O arquivo é a entrada estruturada; a confirmação e a persistência pertencem ao módulo Gestão.
