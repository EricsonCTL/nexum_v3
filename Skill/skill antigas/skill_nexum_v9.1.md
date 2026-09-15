---
name: nexum-cadastro-inteligente
description: Pesquisa empreendimentos e tabelas imobiliárias, normaliza os dados no contrato de importação do NEXUM e prepara Tabela Zero somente com evidência e autorização. Use para cadastro, fotografia comercial, reconstrução histórica ou revisão de JSON.
---

# Skill NEXUM V9.1 — Cadastro, pesquisa e Tabela Zero

## Objetivo

Transformar PDF, planilha, imagem, anúncio ou JSON em uma fotografia comercial pesquisada, rastreável e importável no NEXUM. A skill pesquisa o máximo de informações públicas verificáveis e as coloca nos campos que o importador reconhece. Dado não encontrado permanece `null` com pendência; nunca vira zero, `não` ou fato inventado.

Emitir `schema: "nexum-skill-json"` e `schema_version: "9.1"`.

## Fluxo obrigatório

`PESQUISAR → CONFIRMAR IDENTIDADE → EXTRAIR → NORMALIZAR → PRÉ-VALIDAR → ENTREGAR`

1. Pesquisar fontes oficiais da construtora/incorporadora, documentos públicos datados, sistema comercial, Investlar, imobiliárias/corretores e portais. Abrir as fontes: resultado de busca não comprova fato.
2. Separar evidência atual de evidência histórica. Uma condição atual não é condição de lançamento.
3. Para cada fato crítico, registrar fonte, data de publicação quando houver, data de consulta e evidência curta.
4. Executar uma segunda pesquisa dirigida aos campos vazios: tipo, padrão, obra, lançamento, entrega, endereço, CEP, coordenadas, tipologias, áreas, vagas, lazer, piscina, financiamento e pagamentos.
5. Converter somente dados comprovados para campos canônicos. Preservar bruto, conflitos e limitações em `auditoria`, `fontes`, `cobertura_cadastral` e `pendencias`.

Sem navegação ou acesso ao cadastro, declarar a limitação. Não afirmar pesquisa ou prévia NEXUM executada sem executá-las.

## Decisão de vínculo

Use exatamente uma operação:

```text
ADICIONAR_TABELA_A_EMPREENDIMENTO_EXISTENTE
CADASTRAR_EMPREENDIMENTO_E_TABELA_BASE
REVISAO_DE_IDENTIDADE
```

Para empreendimento existente, só emitir `empreendimento.id` se o ID interno estiver confirmado. Sem ele, use `null`, preserve a operação de vínculo e crie pendência para seleção na prévia. Nunca crie novo empreendimento por ausência de ID.

## Contrato importável

| Dado | Campo canônico |
|---|---|
| Nome | `empreendimento.nome` |
| Construtora e incorporadora | `empreendimento.construtora`, `empreendimento.incorporadora` |
| Tipo | `empreendimento.tipo`: `Apartamento`, `Casa`, `Lote / Terreno`, `Comercial`, `Outro` |
| Padrão | `empreendimento.padrao`: `Popular/MCMV`, `Médio`, `Alto`, `Luxo`, `Não aplicável`, `Indefinido` |
| Fase | `empreendimento.fase`: `Lançamento`, `Novo`, `Em obras`, `Entregue` |
| Status físico | `empreendimento.status_obra`: `EM_OBRAS`, `OBRA_AVANCADA`, `OBRA_CONCLUIDA`, `ENTREGUE` ou `null` |
| Lançamento e entrega | `empreendimento.data_lancamento`, `empreendimento.data_entrega` em `AAAA-MM-DD` ou `null` |
| Natureza da tabela | `tabela.tipo`: `TABELA_COMERCIAL`, `TABELA_ZERO_ORIGINAL`, `TABELA_ZERO_SIMULADA` |
| Modalidade | `tabela.tipoTabela`: `PADRAO`, `A_VISTA`, `FINANCIAMENTO_CEF`, `FINANCIAMENTO_BANCARIO`, `DIRETO_CONSTRUTORA`, `OUTRO` |
| Unidade, preço, área e tipologia | `unidade`, `preco`, `area_m2`, `tipologia` |
| Situação | `status` e `status_original` |
| Pagamento por unidade | `condicoes` |

`preco_zero`, `tipo`, `marcacao_original` e campos livres são auxiliares; nunca podem ser a única origem do dado importável. `preco` precisa ser número em reais. `tipologia` precisa ser texto. `preco = 0` ou `area_m2 = 0` exige pendência explícita.

### Datas

- Dia conhecido: preservar `AAAA-MM-DD` e precisão `DIA`.
- Somente mês/ano: converter `MM/AAAA` ou `AAAA-MM` em `AAAA-MM-01`, com precisão `MES`, expressão original e auditoria de que o dia 01 é convenção técnica.
- Somente ano: data `null`, precisão `ANO` e pendência. Não inventar mês.
- Data de entrega em até 90 dias após contrato é condição comercial, não data de entrega do empreendimento.

### Obra e fase

`Pronto`, `pronto para morar` ou conclusão física comprovam `OBRA_CONCLUIDA`; não usar `ENTREGUE` apenas por essa expressão. `ENTREGUE` requer evidência de entrega/ocupação/chaves. Se a fase comercial não for comprovada, registrar a lacuna e não apresentá-la como evidência pesquisada. `percentual_obra: 100` também não substitui comprovação de entrega.

### Características

Emitir em `empreendimento.caracteristicas`:

```json
{
  "dormitorios": ["2"],
  "atributos": {
    "suite": "sim",
    "area_lazer": "sim",
    "piscina": "sim",
    "mobiliado": null,
    "financiavel": "sim",
    "condominio_fechado": "sim",
    "vaga_coberta": null
  },
  "vagas": { "possui": "sim", "quantidades": ["1"] }
}
```

Triestados aceitos: `sim`, `nao`, `null`. Área de lazer é triestado: metragem e equipamentos ficam em `leitura_comercial.caracteristicas_comerciais`. Não usar `"7900 m²"` como valor de `area_lazer`. Não inferir dormitórios, suítes ou garagem a partir do nome do produto.

## Unidades, pagamento e marcadores

Cada linha original deve virar uma unidade. A chave natural é `agrupadorOriginal` ou `quadra`/`bloco`/`torre` + `unidade`; não usar UUID para comparar tabelas. Não deduplicar códigos iguais de blocos distintos.

Preservar a linha extraída em `linhaOriginal`. Marcador sem legenda, como `*`, não deve receber significado. Registrá-lo em `linhaOriginal`, `status_original` quando fizer parte da situação e em pendência/auditoria. Emitir `marcacaoVGM: true` somente quando a fonte identificar expressamente VGM.

Planos precisam usar `condicoes`, não campos soltos como `mensal_12_meses`:

```json
{
  "unidade": "0028-01",
  "tipologia": "Lote",
  "area_m2": 126,
  "preco": 126406.58,
  "status": "DISPONIVEL",
  "status_original": "Disponível",
  "condicoes": {
    "entrada": 25281.32,
    "planos": [
      {
        "codigo": "PLANO_12_MESES",
        "nome": "12 meses",
        "prazoMeses": 12,
        "entrada": 25281.32,
        "mensal": { "parcelas": 12, "valor": 8427.11 }
      },
      {
        "codigo": "PLANO_36_MESES",
        "nome": "36 meses",
        "prazoMeses": 36,
        "entrada": 25281.32,
        "mensal": { "parcelas": 36, "valor": 1580.08 },
        "intercaladas": { "quantidade": 3, "valor": 14747.43, "periodicidade": "anual" }
      }
    ]
  }
}
```

Cada plano deve reproduzir somente os componentes publicados para ele. Não somar alternativas de pagamento, juros, taxas ou valores de bases diferentes para forçar 100%.

`RESERVADO` e `AUSENTE` chegam com o status de origem. O NEXUM aplicará venda presumida e manterá criticidade; não pré-converter para `VENDIDO`.

## Fotografia, total estrutural e comparação

Total estrutural, unidades presentes na fotografia e unidades de uma Tabela Zero são métricas distintas.

```text
total_estrutural_comprovado = unidades aprovadas do empreendimento
unidades_apresentadas = linhas identificadas no documento daquela data
unidades_nao_listadas_na_fotografia = total estrutural − unidades apresentadas
```

O terceiro número apenas descreve cobertura. Não é venda, remoção, ausência operacional, nem estoque.

Só popular `comparacao.removidas`, `novas`, `mantidas`, alterações de preço/status e qualquer venda por ausência depois de comparar duas fotografias realmente vinculadas, com mesma modalidade e chaves naturais compatíveis. Sem tabela anterior, emitir:

```json
"comparacao": {
  "status": "NAO_EXECUTADA_SEM_TABELA_ANTERIOR",
  "previousTableId": null,
  "novas": [], "mantidas": [], "removidas": [], "retornadas": [],
  "alteracoesValor": [], "alteracoesStatus": [], "alteracoesComerciais": []
}
```

É proibido preencher `removidas` pela diferença entre total estrutural e tabela parcial. Para o Village Sudoeste, a referência declarada pelo usuário é **918 lotes**; enquanto a tabela de março tem 122 linhas, a diferença é **796 lotes estruturais não listados**, não 796 removidos.

## Tabela Zero

Criar somente após autorização explícita do usuário. Tabela Zero original exige material histórico; simulada exige:

1. lançamento datado ou precisão explicitada;
2. total estrutural comprovado;
3. padrão de numeração/distribuição sustentado por plantas, book, memorial, tabela ou múltiplas unidades observadas;
4. tipologias e áreas sustentadas por evidência;
5. pesquisa de preços históricos em mais de uma fonte quando possível, ou simulação declarada.

Para Village Sudoeste, o total de 918 é condição suficiente apenas para a contagem final; ainda é necessário comprovar como os 918 códigos se distribuem antes de gerar as unidades. A Zero simulada usa `status: "DISPONIVEL"` por convenção, `natureza_preco: "SIMULADO"`, `classificacao: "SIMULADO"`, método, fontes, confiança e limitações em cada unidade ou grupo homogêneo. Ela nunca é apresentada como tabela histórica original.

## Pesquisa e cobertura

Pesquisar: construtora, incorporadora, tipo, padrão, fase, status/percentual de obra, lançamento, entrega, endereço do empreendimento, CEP, coordenadas, total estrutural, tipologias, áreas, vagas, lazer, piscina, financiamento, pagamento, contatos e imagem pública.

Emitir para todos os itens avaliados:

```json
{
  "campo": "data_entrega",
  "valor": null,
  "situacao": "NAO_ENCONTRADO",
  "fonte": "fontes consultadas",
  "observacao": "Não encontrada data documental de entrega."
}
```

Situações permitidas: `PREENCHIDO`, `NAO_ENCONTRADO`, `CONFLITANTE`, `NAO_APLICAVEL`, `MAPEAMENTO_A_VERIFICAR`. Não marcar `PREENCHIDO` quando o valor é inferência técnica ou fallback.

## Validação antes da entrega

1. JSON parseável; sem `NaN`, comentários, texto em campos numéricos ou datas inválidas.
2. Contagem de unidades igual a `unidades_apresentadas`; chaves naturais únicas.
3. Validar quantidade de preços positivos, nulos, zero e simulados; conferir soma, mínimo e máximo com a fonte.
4. Confirmar que todos os preços estão em `preco`, todas as áreas em `area_m2`, todas as tipologias em `tipologia` e todos os planos em `condicoes`.
5. Conferir que nenhum total estrutural gerou remoções, vendas ou estoque artificial.
6. Validar que marcador sem semântica não foi interpretado.
7. Validar status físico, fase e entrega separadamente.
8. Se houver ambiente NEXUM, executar somente prévia e comparar: contagem, preço, área, tipologia, agrupador, status, planos e marcas brutas. Sem prévia, declarar: `Validado contra o contrato V9.1; prévia NEXUM não executada.`
9. Havendo conflito relevante, emitir `status_processamento: "REVISAO"` com objeto de pendência concreto. Falta de ID técnico, sozinha, não autoriza criar um ativo novo.

## Entrega

Entregar JSON, operação, natureza/modalidade, data, total estrutural, linhas da fotografia, síntese de preços, cobertura cadastral, fontes e pendências. Dizer explicitamente se a Tabela Zero é inexistente, original ou simulada. Nunca declarar persistência no NEXUM sem a gravação real.
