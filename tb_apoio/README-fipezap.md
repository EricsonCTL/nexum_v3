# Referência externa FipeZAP

O NEXUM lê primeiro `tabela_fipezap.csv`, a tabela resumida de Brasil, João Pessoa e Campina Grande utilizada no simulador. Seus dados aparecem como referência comparativa e não entram na fórmula do Índice NEXUM.

Para manter uma série histórica oficial por competência, use `tb_apoio_fipezap.csv` em UTF-8, mantendo o cabeçalho e acrescentando uma linha por cidade/competência. Não apague meses anteriores.

- Cidades: Brasil, João Pessoa, Campina Grande.
- Competência: AAAA-MM (ex.: 2026-05).
- Percentuais: número em pontos percentuais, sem `%`; use ponto decimal. Variação no ano é opcional.
- Fonte: informe a publicação oficial ou seu endereço. Status: `oficial` ou `sem_serie_oficial`.
- Para `oficial`, a variação em 12 meses é obrigatória. Para `sem_serie_oficial`, deixe as duas variações vazias.
- Textos com vírgulas devem ficar entre aspas. Não repita cidade e competência: duplicidades são sinalizadas e aquela competência não é utilizada.

O arquivo começa sem valores: os exemplos da solicitação não foram tratados como comprovação de dados oficiais. A interface mostra a última linha válida de cada cidade e a competência própria do FipeZAP, sempre referente a 12 meses. Valores negativos e zero oficiais são aceitos. Competências inválidas e valores ausentes não viram zero.

Valores marcados como estimados permanecem identificados como tal na interface; eles não são transformados em série oficial. Reabra o simulador após editar o arquivo. A leitura é local, sem scraping, sem consulta à internet e sem gravação pelo NEXUM. FipeZAP não participa da fórmula do Índice NEXUM.
