---
name: nexum-cadastro-inteligente
description: Pesquisa empreendimentos e tabelas imobiliárias, normaliza os dados no contrato de importação do NEXUM e prepara Tabela Zero somente com evidência e autorização. Use para cadastro, fotografia comercial, reconstrução histórica ou revisão de JSON.
---

# Skill NEXUM V10 — Cadastro, pesquisa e Tabela Zero

## Objetivo

Transformar PDF, planilha, imagem, anúncio ou JSON em uma fotografia comercial pesquisada, rastreável e importável no NEXUM. A skill pesquisa o máximo de informações públicas verificáveis e as coloca nos campos que o importador reconhece. No cadastro pesquisado e nas tabelas observadas, dado não encontrado permanece `null` com pendência. Na Tabela Zero simulada, aplicar as regras de estimativa de estrutura, áreas, preços e pagamentos abaixo, preservando a classificação SIMULADO.

Emitir `schema: "nexum-skill-json"` e `schema_version: "10.0"`.

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

Em tabela observada, cada plano reproduz somente os componentes publicados. Na Zero, estimar pagamentos conforme a seção específica V10. Não somar alternativas de pagamento, juros, taxas ou valores de bases diferentes.

Nas fotografias observadas, `RESERVADO` e `AUSENTE` chegam com o status de origem. O NEXUM aplicará venda presumida e manterá criticidade; não pré-converter para `VENDIDO`.

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

## Tabela Zero completa — objetivo obrigatório V10

Ao solicitar uma Tabela Zero simulada, o usuário autoriza a reconstrução provável descrita nesta skill. Não pedir novamente autorização para estimar preços ou pagamentos dentro desse pedido.

Entregar exatamente N objetos em `tabela.unidades[]`, onde N é o total estrutural adotado, cada um com identidade, tipologia, área, preço positivo, situação DISPONIVEL e condição de pagamento. A lista de unidades disponíveis hoje é apenas uma das fontes para a reconstrução. Não entregar essa lista parcial como a Zero completa.

A data da Zero é o lançamento, normalizada conforme a precisão encontrada. Preços e pagamentos simulados não precisam de comprovação histórica individual: precisam de hipótese fundamentada, fórmula e proveniência. Não copiar preços nominais de uma época para outra.

### Total, estrutura e unidades

- Fixar o total adotado e sua origem antes de gerar. Priorizar documento de aprovação final referente ao mesmo projeto/etapa e a informação explicitamente corrigida pelo usuário. Registrar divergências com anúncios sem trocar o total silenciosamente por votação de fontes.
- No contexto do Village, o usuário informou 918 lotes na aprovação final. Manter como total informado pelo operador enquanto o documento não for inspecionado; não afirmar validação documental própria nem promover automaticamente 988.
- Reunir a união dos códigos de todas as tabelas acessíveis, relação de estoque, cadastro existente, planta, memorial, book e distribuição por quadra/bloco. A fotografia mais recente guia os valores atuais; tabelas mais antigas ajudam a recuperar unidades já vendidas.
- Preservar exatamente códigos e agrupadores das unidades conhecidas, inclusive zeros à esquerda e sufixos. Não deduzir que um sufixo significa quadra sem conferir sua convenção.
- Preencher lacunas de numeração por padrão sustentado nas fontes (intervalos por quadra, andares/finais, quantidades por bloco). Classificar cada identificação reconstruída como INFERIDA ou SIMULADA em `origem.identidade`.
- Para área ausente de unidade identificada, estimar pela planta/tipologia equivalente ou pela mediana do grupo observado, registrando método, amostra e `origem.area.tipo: SIMULADO`. Não aplicar a mesma área indiscriminadamente a tipologias distintas.
- A autorização para simular não torna uma numeração arbitrária uma identidade real. Se não houver padrão suficiente, pesquisar as fontes estruturais restantes e identificar exatamente qual distribuição falta. Uma lista fictícia 1..N sem correspondência não resolve o cadastro; o importador atual pode tratá-la como vendas por ausência.
- Se ainda faltarem identidades reconciliáveis, a tarefa de Zero completa permanece pendente. Não declarar concluída por atingir N com placeholders, nem aceitar saída parcial como entrega final. Entregar diagnóstico com quantidade recuperada, lacunas por grupo e fonte estrutural necessária.

### Situação de todas as unidades

Em uma Zero SIMULADA, definir todas as N unidades como `status: DISPONIVEL`, inclusive as que constam vendidas ou reservadas na fonte atual. Guardar a situação atual somente na proveniência, com sua data. Usar `status_original: Disponível por convenção da reconstrução`; não deixar aliases `situacaoExtraida` ou `situacaoPublicada` com status atuais, pois eles prevalecem no importador.

Isso representa o cenário inicial convencionado. A simulação não comprova a data individual da venda nem a disponibilidade documental no lançamento.

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
5. Na Zero, exigir N unidades disponíveis reconstruídas conforme as regras V10; não emitir vendas ou remoções por mera subtração no resumo.
6. Validar que marcador sem semântica não foi interpretado.
7. Validar status físico, fase e entrega separadamente.
8. Se houver ambiente NEXUM, executar somente prévia e comparar: contagem, preço, área, tipologia, agrupador, status, planos e marcas brutas. Sem prévia, declarar: `Validado contra o contrato V10; prévia NEXUM não executada.`
9. Havendo conflito relevante, emitir `status_processamento: "REVISAO"` com objeto de pendência concreto. Falta de ID técnico, sozinha, não autoriza criar um ativo novo.

## Entrega

Entregar JSON, operação, natureza/modalidade, data, total estrutural, linhas da fotografia, síntese de preços, cobertura cadastral, fontes e pendências. Dizer explicitamente se a Tabela Zero é inexistente, original ou simulada. Nunca declarar persistência no NEXUM sem a gravação real.


## Reconstrução de preços por unidade — regra V10

A simulação de preço não exige localizar o preço histórico de cada unidade. Uma referência histórica utilizável, como anúncio ou tabela datados com preço e área, permite estimar as demais unidades comparáveis. Pesquisar referências adicionais para melhorar a estimativa; a falta de tabela histórica completa não impede a simulação autorizada.

1. Separar grupos por tipologia e faixa de área, modalidade/base de preço, posição e demais diferenças comprovadas. Não misturar flats com apartamentos maiores, lotes com casas, preço à vista com soma nominal financiada, nem campanhas de condições incompatíveis.
2. Para cada referência histórica válida: PM2_H = preço histórico / área histórica. Registrar data efetiva da oferta, URL/arquivo e página, área, tipologia, condições e preço. Data de consulta não comprova data histórica. “A partir de” é referência mínima, não preço médio.
3. No mesmo grupo comparável e na fotografia atual escolhida: PM2_A = referência de preço atual por m². Priorizar a mesma unidade quando houver par histórico/atual. Com várias referências comparáveis, usar mediana e registrar amostra e dispersão; não contar anúncios replicados como evidências independentes.
4. Fator de retorno histórico F = PM2_H / PM2_A.
5. Para unidade com preço atual conhecido: PRECO_ZERO_i = arredondar(PRECO_ATUAL_i × F, 2). Equivalentemente, AREA_i × PM2_ATUAL_i × F. Isso preserva os diferenciais atuais da unidade como hipótese explícita; não comprova que esses diferenciais existiam no lançamento.
6. Para unidade estrutural identificada sem preço atual: PRECO_ZERO_i = arredondar(AREA_i × PM2_H_DO_GRUPO, 2). Registrar método PRECO_M2_HISTORICO_POR_TIPOLOGIA. Não fingir que havia preço atual individual.
7. Se existir preço histórico documental da própria unidade na data adequada, preservá-lo como OBSERVADO, mesmo dentro de uma tabela parcialmente simulada.
8. Manter precisão completa nos intermediários; arredondar apenas o preço final. Não impor desconto fixo nem forçar F < 1: resultado inesperado exige conferir fontes e condições, sem corrigir artificialmente.
9. Esta técnica é retroprojeção por fator histórico. Não chamá-la de regressão estatística sem ajustar um modelo com observações suficientes. Sem referência histórica comparável, continuar pesquisa; preço sem suporte permanece null com motivo.
10. Em cada unidade simulada, emitir preco, natureza_preco SIMULADO, classificacao SIMULADO e origem contendo grupo, fontes, confiança, data-base atual, preço/área atuais quando conhecidos, PM2_H, PM2_A, fator, fórmula e limitações. Uma única referência sustenta hipótese de confiança limitada, nunca alta automaticamente.
11. O VGV simulado é a soma dos preços individuais. Total × preço de um lote padrão é apenas estimativa agregada; não substitui a soma quando há áreas ou tipologias diferentes.
12. Preço histórico de anúncio é oferta, não transação confirmada. Data próxima ao lançamento é aproximação temporal declarada. Variação contra preço simulado não é reajuste histórico observado.

Exemplo exclusivamente aritmético: referência histórica de 126 m² por R$ 66.000 e referência atual comparável de 126 m² por R$ 126.406,58 produzem PM2_H = 523,8095238 e F ≈ 0,522125. Aplicar o fator ao preço atual de cada unidade comparável; jamais atribuir R$ 66 mil a todos os lotes independentemente da área. Esses números não validam a existência da fonte histórica.


## Pagamento simulado em cada unidade — V10

Pesquisar primeiro condições históricas. Se disponíveis, usá-las respeitando a natureza do preço. Caso não existam, usar a estrutura de pagamento da tabela mais recente como hipótese para o lançamento: conservar nomes/códigos, quantidades e periodicidades dos planos, mas recalcular seus valores monetários sobre o preço simulado de cada unidade.

1. Separar planos alternativos. Para cada plano, identificar entrada, quantidade de mensais, intercaladas, chaves, saldo financiado e base de preço (à vista ou total nominal).
2. Para a mesma unidade com preço atual conhecido, fator financeiro K = preco_zero / preco_atual. Se os componentes atuais quitam esse preço, componente_zero = componente_atual × K, preservando quantidades. Não manter entrada e parcelas de 2026 quando o preço foi reduzido para 2021.
3. Para unidade reconstruída sem preço atual, extrair a participação de cada componente no preço de unidade-modelo da mesma tipologia/modalidade e aplicar ao seu preco_zero. Declarar a unidade-modelo e a transferência da estrutura comercial.
4. Se a soma atual difere do preço por juros/correção/desconto publicado, preservar e documentar a diferença no plano. Não forçar a soma ao preço à vista nem inventar taxa. Se não for possível explicar diferença material, marcar a condição em revisão antes de declará-la conciliada.
5. Trabalhar em centavos: calcular totais dos componentes antes de dividir em parcelas. Na simulação, absorver apenas resíduo de arredondamento na entrada, registrar o ajuste e manter valor não negativo. Não usar esse ajuste para esconder diferença material. A regra se aplica apenas a componentes em mesma base nominal sem encargos externos.
6. Se a fonte não informa financiamento parcelado, usar somente condição à vista coerente com a modalidade pesquisada; não inventar prazos, juros ou percentuais. Sem qualquer evidência comercial, registrar essa lacuna e usar cenário hipotético à vista explicitamente SIMULADO, sem alegar que foi oferecido historicamente.
7. Emitir `condicoes.entrada` e `condicoes.planos[]` em cada unidade. O leitor atual usa a entrada comum de condicoes; valores diferentes somente dentro de plan.entrada não são plenamente respeitados. Quando houver entradas distintas entre planos, registrar a incompatibilidade para revisão do importador e não declarar leitura completa.
8. Identificar a simulação em `origem.pagamento`: metodo, fonte, data-base, plano-modelo, percentuais, fator, ajuste_centavos e confianca. Em `tabela.regrasComerciais`, emitir texto legível informando a reconstrução proporcional e suas limitações.
9. Guardar as condições atuais originais em `origem.pagamento.referencia_atual`, não em condicoes históricas. Nas tabelas de março/setembro, preservar os valores observados.
10. Validar TODOS os planos de TODAS as unidades, não apenas a primeira linha.

Exemplo aritmético: preço atual 126406,58; Zero 69300,00; entrada 25281,32 e 12 mensais de 8427,11. A simulação sem encargos pode resultar em entrada 13859,88 + 12 × 4620,01 = 69300,00 após ajuste de centavos. Registrar que o parcelamento foi projetado a partir da estrutura atual, não observado em 2021.

### Modalidade e histórico

A Zero reconstruída da tabela atual conserva `tipoTabela` dessa referência para viabilizar comparação operacional, explicitando que a modalidade histórica é assumida quando não documentada. Não trocar DIRETO_CONSTRUTORA por PADRAO só por faltar a tabela original. Havendo modalidade histórica comprovadamente diferente, registrar incompatibilidade e não fabricar equivalência.

Entregar um JSON por fotografia para importação: Zero, março, setembro. Uma fotografia aninhada em `fotografia_comercial_atual` não é automaticamente cadastrada pelo importador. A referência atual pode acompanhar auditoria sem ser apresentada como segunda tabela importável.

Todos os códigos conhecidos das fotografias comparáveis devem existir na Zero, salvo acréscimo posterior comprovado. Verificar antes da entrega a interseção e diferença de chaves naturais. Se a Zero reutiliza apenas os sobreviventes da tabela recente, não representa o estoque inicial e subestima vendas.

IVV, VSO e reajustes ficam a cargo do NEXUM. O arquivo preserva que a base é simulada: indicadores dependentes dela são derivados desse cenário, não observações históricas independentes. Preço retroprojetado pela tabela atual pode reproduzir o próprio fator utilizado no reajuste; informar essa dependência. As flags de origem não garantem, sozinhas, que a interface do NEXUM já as diferencia.

## Contrato completo de saída e conclusão V10

Campos obrigatórios: schema, schema_version, status_processamento, operacao, empreendimento, tabela, resumo_comercial, comparacao, fontes, cobertura_cadastral, auditoria, validacoes, pendencias.

Não substituir tabela por tabela_zero nem mudar o contrato para texto descritivo. Emitir arquivo JSON real com todas as unidades, sem reticências, intervalos, “repita para as demais” ou truncamento. Se necessário gerar em lotes internamente, concatenar, conferir e entregar o arquivo único completo.

Distinguir:
- completude: N linhas e N chaves distintas;
- consistência: preço/área positivos, 100% DISPONIVEL, pagamentos conciliados;
- evidência: identidades observadas/reconstruídas e valores simulados;
- compatibilidade: mesmas chaves/modalidade e leitura efetiva no importador.

Ausência de ID interno não impede gerar todas as unidades; preservar REVISAO para seleção do cadastro. A simulação completa pode permanecer REVISAO por pendências sem ser chamada de parcial.

Antes de concluir:
- quantidade(tabela.unidades) = tabela.unidades_apresentadas = resumo_comercial.total_estrutural = resumo_comercial.unidades_individualizadas;
- unidades_faltantes = 0; unidades_sem_preco = 0; unidades_sem_condicoes = 0;
- todas as unidades DISPONIVEL; nenhuma alias sobrescrevendo o status convencionado;
- VGV = soma dos preços individuais, não contagem × preço padrão quando houver diferenças;
- condições simuladas conciliadas por plano; resíduo e encargos explicados;
- fontes reais consultadas, data e hipóteses por campo;
- validações, pendências, cobertura e resumo recalculados da versão final. Eventos passados podem ficar datados na auditoria; não deixar validação atual com preços antigos ou data de entrega nula após atualização;
- se houve prévia, declarar resultados. Caso contrário, declarar a validação documental sem afirmar teste de importação.

Modelo fictício completo de duas unidades abaixo. É exemplo de formato e cálculo, não fonte para qualquer empreendimento real; não copiar seus valores como evidência.

```json
{
  "schema": "nexum-skill-json",
  "schema_version": "10.0",
  "status_processamento": "REVISAO",
  "operacao": "ADICIONAR_TABELA_A_EMPREENDIMENTO_EXISTENTE",
  "empreendimento": {
    "id": null,
    "nome": "EXEMPLO FICTICIO",
    "construtora": null,
    "incorporadora": null,
    "tipo": "Lote / Terreno",
    "padrao": "Indefinido",
    "fase": null,
    "status_obra": null,
    "data_lancamento": "2021-06-01",
    "data_lancamento_precisao": "MES",
    "data_entrega": null,
    "endereco": {
      "logradouro": null,
      "numero": null,
      "bairro": null,
      "cidade": null,
      "uf": null,
      "cep": null
    }
  },
  "tabela": {
    "id": null,
    "tipo": "TABELA_ZERO_SIMULADA",
    "tipoTabela": "DIRETO_CONSTRUTORA",
    "data_tabela": "2021-06-01",
    "arquivo_origem": "exemplo_ficticio.json",
    "unidades_apresentadas": 2,
    "regrasComerciais": "Condições SIMULADAS por proporções da tabela-modelo atual, sem evidência histórica de oferta.",
    "unidades": [
      {
        "quadra": "A",
        "unidade": "01",
        "tipologia": "Lote",
        "area_m2": 120,
        "preco": 60000,
        "natureza_preco": "SIMULADO",
        "classificacao": "SIMULADO",
        "status": "DISPONIVEL",
        "status_original": "Disponível por convenção da reconstrução",
        "condicoes": {
          "entrada": 12000,
          "planos": [
            {
              "codigo": "PLANO_12_MESES",
              "nome": "12 meses",
              "prazoMeses": 12,
              "entrada": 12000,
              "mensal": {
                "parcelas": 12,
                "valor": 4000
              }
            }
          ]
        },
        "origem": {
          "tipo": "SIMULADO",
          "confianca": "BAIXA",
          "identidade": {
            "tipo": "OBSERVADO",
            "fonte": "EXEMPLO_FICTICIO"
          },
          "area": {
            "tipo": "SIMULADO",
            "metodo": "Tipologia-modelo fictícia"
          },
          "metodo": "FATOR_HISTORICO_POR_TIPOLOGIA",
          "preco_atual": 120000,
          "pm2_historico_referencia": 500,
          "pm2_atual_referencia": 1000,
          "fator": 0.5,
          "formula": "120000 * 0.5",
          "fontes": [],
          "pagamento": {
            "tipo": "SIMULADO",
            "metodo": "PROPORCOES_DA_TABELA_ATUAL",
            "fator": 0.5,
            "ajuste_centavos": 0,
            "referencia_atual": {
              "entrada": 24000,
              "mensal": 8000,
              "quantidade": 12
            }
          },
          "observacao": "Dados fictícios, não importar."
        }
      },
      {
        "quadra": "A",
        "unidade": "02",
        "tipologia": "Lote",
        "area_m2": 150,
        "preco": 75000,
        "natureza_preco": "SIMULADO",
        "classificacao": "SIMULADO",
        "status": "DISPONIVEL",
        "status_original": "Disponível por convenção da reconstrução",
        "condicoes": {
          "entrada": 15000,
          "planos": [
            {
              "codigo": "PLANO_12_MESES",
              "nome": "12 meses",
              "prazoMeses": 12,
              "entrada": 15000,
              "mensal": {
                "parcelas": 12,
                "valor": 5000
              }
            }
          ]
        },
        "origem": {
          "tipo": "SIMULADO",
          "confianca": "BAIXA",
          "identidade": {
            "tipo": "INFERIDO",
            "fonte": "EXEMPLO_FICTICIO"
          },
          "area": {
            "tipo": "SIMULADO",
            "metodo": "Tipologia-modelo fictícia"
          },
          "metodo": "FATOR_HISTORICO_POR_TIPOLOGIA",
          "preco_atual": 150000,
          "pm2_historico_referencia": 500,
          "pm2_atual_referencia": 1000,
          "fator": 0.5,
          "formula": "150000 * 0.5",
          "fontes": [],
          "pagamento": {
            "tipo": "SIMULADO",
            "metodo": "PROPORCOES_DA_TABELA_ATUAL",
            "fator": 0.5,
            "ajuste_centavos": 0,
            "referencia_atual": {
              "entrada": 30000,
              "mensal": 10000,
              "quantidade": 12
            }
          },
          "observacao": "Dados fictícios, não importar."
        }
      }
    ]
  },
  "resumo_comercial": {
    "total_estrutural": 2,
    "unidades_individualizadas": 2,
    "unidades_faltantes": 0,
    "disponiveis": 2,
    "unidades_sem_preco": 0,
    "unidades_sem_condicoes": 0,
    "reconstrucao_completa": true,
    "vgv_zero_simulado": 135000
  },
  "comparacao": {
    "previousTableId": null,
    "novas": [],
    "mantidas": [],
    "removidas": [],
    "retornadas": [],
    "alteracoesValor": [],
    "alteracoesStatus": [],
    "alteracoesComerciais": []
  },
  "fontes": [],
  "cobertura_cadastral": [],
  "auditoria": [
    {
      "evento": "EXEMPLO",
      "descricao": "Duas unidades fictícias; dia 01 convencionado.",
      "origem": "SIMULADO"
    }
  ],
  "validacoes": [
    {
      "regra": "completude_e_pagamento_do_exemplo",
      "resultado": "OK",
      "observacao": "2 unidades, ambas disponíveis; entrada + 12 mensais = preço."
    }
  ],
  "pendencias": [
    {
      "campo": "fontes",
      "observacao": "Exemplo sem fontes reais. Substituir por pesquisa, cadastro e unidades reais/reconstruídas.",
      "status": "PENDENTE"
    }
  ]
}
```

