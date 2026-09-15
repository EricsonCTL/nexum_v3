# Índice NEXUM — Custo e Pressão Econômica

O simulador está em Analytics → Simulador de Reajuste. O rodapé apresenta sua taxa mensal equivalente, independente dos filtros. O reajuste observado da carteira permanece um indicador distinto.

## Fórmula

Todos os cálculos internos usam frações: 0,0661 equivale a 6,61%.

- Custo = (INCC + CUB) / 2.
- Pressão econômica = (IPCA + IGP-M) / 2.
- Pressão setorial = máximo(0, custo − pressão econômica).
- Índice NEXUM = custo + pressão setorial.

Quando custo supera pressão econômica, equivale a 2 × custo − pressão econômica. O piso zero da pressão setorial atende à orientação de não criar pressão setorial negativa. Não existem pesos configuráveis. FipeZAP, Selic e dados da carteira não entram na fórmula nem no endpoint que a calcula.

O exemplo INCC 6,61%, CUB 4,51%, IPCA 4,22%, IGP-M 2,18% resulta em custo 5,56%, pressão econômica 3,20%, pressão setorial 2,36 p.p. e índice 7,92%. Esses valores são somente testes; produção usa as séries armazenadas.

## Competências e prazo

Cada indicador usa sua última janela completa de 12 competências: produto de (1 + variação mensal / 100), menos 1. A fórmula é aplicada a esses acumulados. Datas de divulgação distintas continuam permitidas e visíveis por componente. Lacunas não são zero; se houver uma janela anterior completa, ela é explicitamente indicada. Sem 12 competências válidas em qualquer componente, o índice fica indisponível.

Taxa mensal equivalente = (1 + índice de 12 meses)^(1/12) − 1.
Equivalência para N meses = (1 + taxa mensal)^N − 1.

O campo de meses mantém padrão 6 e aceita inteiros de 1 a 120. A interface identifica a equivalência do prazo e o cálculo-base de 12 meses; não chama a equivalência de inflação efetivamente observada naquele prazo. O índice é referência de recomposição estrutural, não previsão de valorização, retorno ou preço.

## Fontes e armazenamento preservados

INCC: SGS 192, FGV / Banco Central. IPCA: SGS 433, IBGE / Banco Central. IGP-M: SGS 189, FGV / Banco Central. CUB-PB: Sinduscon-João Pessoa, média das variações por competência dos padrões oficiais não desonerados disponíveis, sem filtro por padrão do empreendimento.

O simulador lê `data/economic-reference-cache.json`. A rotina existente atualiza as séries conforme divulgação oficial, preservando competências já armazenadas. A consulta do simulador reaproveita esse cache. A revisão não modifica o agendamento nem as fontes econômicas.

## Referência externa — FipeZAP

`fipezap-reference.js` lê exclusivamente `tb_apoio/tb_apoio_fipezap.csv`, em UTF-8. Não faz rede nem grava o arquivo. O endpoint `/api/fipezap-reference` é separado de `/api/reajuste-reference`. A cada abertura da janela, a interface lê novamente a base local.

Mostra Brasil, João Pessoa e Campina Grande; seleciona a última competência válida e única de cada cidade, preservando o histórico. O CSV aceita variação 12m obrigatória para status oficial, YTD opcional e status sem_serie_oficial com valores vazios. Dados inválidos e duplicidades geram avisos; duplicidades excluem aquela cidade/competência da seleção. Valores negativos e zero oficiais são válidos. Não há estimativa, interpolação ou cópia entre cidades.

O arquivo entregue contém somente cabeçalho. Os exemplos do pedido não comprovam dados oficiais. Campina Grande sem cadastro oficial mostra “Sem série oficial FipeZAP disponível na base local”. A própria competência do FipeZAP e a indicação “12 meses” aparecem separadas do prazo do simulador.

## Funções e verificação

`reajuste-service.js`: calculateConstructionCost, calculateEconomicPressure, calculateSectorPressure, calculateNexumIndex, calculateReference e getReference.

`fipezap-reference.js`: loadFipezapReference e getLatestFipezapByCity.

Execute `node scripts/test-reajuste-reference.cjs`: exemplo 7,92%, piso setorial zero, indicadores faltantes, CUB nulo, competências independentes, duplicidades, ausência de série, FipeZAP independente e arquivo somente leitura.

Nenhuma regra de IVV, vendas, estoque, absorção, desaceleração ou pressão territorial faz parte desta alteração.
