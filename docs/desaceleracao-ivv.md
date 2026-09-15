# Curva oficial de desaceleração do IVV

O motor existente continua em `server.js:buildMaturityProjection`: converte IVV mensal em vendas e saldo, limita vendas ao estoque residual e fornece as curvas de IVV, disponibilidade e absorção para `analytics.html`. A fonte anterior calculava oito faixas usando apenas o último intervalo e substituía o IVV do ativo pela média da carteira. Essa fonte foi substituída por `ivv-curves.js`.

## Dados e cálculo

Cadastro: `data/nexo-radar.json`. Versões: `data/ivv-curves.json` (ou junto ao arquivo definido em NEXO_DATA_FILE para execução isolada).

- Carteira ativa; todos os pares de fotografias consecutivas da modalidade base (ou última modalidade). Sem filtros de tela.
- Idade no fechamento do intervalo desde `launchDate`; 12 faixas semiabertas de três meses, [0,3) até [33,36).
- Cada intervalo é uma observação na faixa de fechamento. Não se distribui um IVV de intervalo longo como evidência real em trimestres anteriores.
- Média dentro de cada empreendimento/faixa, depois média entre empreendimentos. Taxa = média atual / média anterior - 1.
- IVV observado zero é mantido. Denominador zero ou ausência não produz taxa.
- Lacunas de taxas são interpoladas ou extrapoladas linearmente com duas taxas observadas próximas. Quando faltam taxas adjacentes, estimam-se níveis positivos de IVV por interpolação/extrapolação logarítmica local e usam-se as razões entre níveis.
- Taxas positivas, abaixo de -95% ou não finitas exigem revisão. Não são silenciosamente truncadas. IVVs reais e projetados não têm piso artificial: uma referência abaixo de 2 un./mês permanece abaixo de 2.

## Modelo e fluxo

`versions[]`: ID, número, datas/autor, status REVISAO ou VALIDADA, versão de origem, metodologia, hash das evidências, cobertura, exclusões e faixas.

Cada faixa preserva IVV real/estimado, Δ observado, taxa calculada, taxa validada, origem calculada/validada, alteração manual, amostra, método, alertas e participantes com IDs das fotografias.

`activeId`: única versão vigente. `events[]`: criação, validação e ativações com ator, timestamp, versão anterior e nova. O histórico é cumulativo; validar uma edição sempre cria outra versão. Ativar ou reativar modifica apenas o ponteiro e acrescenta um evento. Persistência serializada, com substituição atômica do arquivo.

Gestão → Parâmetros · IVV: Atualizar curva cria REVISAO; Salvar versão validada cria VALIDADA; Tornar vigente publica seus percentuais para novas projeções. Nunca há atualização automática. Sem versão vigente, projeções informam a pendência. Leituras reais continuam disponíveis.

## Aplicação

O último intervalo comercial válido do empreendimento fornece IVV e data de referência, independentemente do período de leitura. A idade nessa data posiciona o ativo na curva. O primeiro trecho mantém esse IVV sem aumento artificial; ao entrar em nova faixa comercial, multiplica por `1 + validada`. Se a referência estiver no meio de uma faixa, o primeiro trecho cobre somente seus meses restantes. Depois de 36 meses mantém o último IVV projetado, sem repetir indefinidamente uma taxa. O horizonte técnico é de 120 meses; saldo residual é informado quando não há esgotamento nele.

Não se ativa automaticamente a primeira versão. Dados calculados inconsistentes precisam de decisão do gestor.

## Verificação

`node scripts/test-ivv-curves.js` (também chamado por `test-maturity-projection.js`): histórico completo, lacunas, zero observado, taxas inválidas, versões imutáveis, ativação/reativação, independência de filtros, ancoragem no IVV real e estoque residual.
