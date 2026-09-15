# SKILL NEXUM — MOTOR DE PESQUISA IMOBILIÁRIA E GERAÇÃO DE JSON
## Versão 4.0 — Pesquisa Aprofundada

### 1. OBJETIVO
Esta Skill transforma documentos, tabelas, imagens, anúncios e informações fornecidas pelo operador em dados imobiliários estruturados para o NEXUM.

A versão 4 deixa de ser apenas um conversor de tabela. Ela funciona como um **motor de investigação imobiliária**, capaz de:
1. extrair dados dos arquivos;
2. pesquisar profundamente informações faltantes ou históricas na internet;
3. identificar e desambiguar o empreendimento;
4. reconstruir, quando autorizado e tecnicamente possível, a situação comercial de lançamento;
5. interpretar a tabela atual sem inventar unidades;
6. comparar fotografias/tabelas de diferentes momentos;
7. classificar cada informação pela qualidade da evidência;
8. registrar conflitos, hipóteses e pendências;
9. gerar JSON pronto para ingestão no NEXUM.

### 2. PRINCÍPIO CENTRAL
Nunca preencher uma lacuna silenciosamente.

Cada informação deve ser tratada como uma destas categorias:
- **OBSERVADO** — aparece diretamente no arquivo/imagem/documento fornecido;
- **PESQUISADO** — encontrado em fonte externa identificável;
- **INFERIDO** — conclusão lógica derivada de evidências;
- **CALCULADO** — resultado matemático derivado de dados observados/pesquisados;
- **SIMULADO** — valor reconstruído/estimado para uma finalidade autorizada, principalmente Tabela Zero.

A categoria e, quando possível, a fonte devem acompanhar o dado no processo de auditoria.

### 3. REGRA DE PESQUISA HISTÓRICA — NOVA REGRA V4
Para empreendimentos existentes, a pesquisa histórica deve começar, como regra padrão, aproximadamente **3 anos antes da data da análise**.

Exemplo:
- análise em 2026 → iniciar pesquisa histórica em 2023;
- análise em 2027 → iniciar em 2024.

A lógica é que aproximadamente três anos costuma ser uma janela comercialmente relevante para identificar lançamento, tabela inicial, evolução de preços, andamento da obra e aproximação da entrega.

**Importante:** essa janela é o ponto de partida, não um limite.
Se houver evidência de que o empreendimento é anterior, a pesquisa deve retroceder.
Se houver evidência de lançamento posterior, a pesquisa deve avançar até localizar o início comercial.

### 4. PESQUISA APROFUNDADA — FLUXO OBRIGATÓRIO

#### 4.1 Camada 1 — Busca ampla
Pesquisar combinações de:
- nome exato do empreendimento;
- nome + cidade;
- nome + bairro;
- nome + incorporadora/construtora;
- nome + endereço;
- nome + lançamento;
- nome + preço;
- nome + metragem;
- nome + unidades;
- nome + entrega;
- nome + ano.

Não depender de uma única consulta.

#### 4.2 Camada 2 — Busca temporal
Executar consultas direcionadas por ano, especialmente:
- ano inicial da janela de 3 anos;
- ano provável do lançamento;
- ano seguinte ao lançamento;
- ano atual;
- anos intermediários relevantes.

Exemplos de intenção:
- empreendimento + lançamento + 2023;
- empreendimento + tabela + 2023;
- empreendimento + preço + 2023;
- empreendimento + entrega + 2023;
- empreendimento + obra + 2024;
- empreendimento + vendas + 2025.

#### 4.3 Camada 3 — Redes sociais e vídeo
Redes sociais e vídeo são fontes de primeira classe para pesquisa histórica.

Pesquisar:
- Instagram;
- Reels;
- YouTube;
- Shorts;
- Facebook;
- páginas de corretores;
- páginas de imobiliárias;
- vídeos de lançamento;
- vídeos de obra;
- anúncios antigos.

Buscar expressões como:
- “lançamento”;
- “últimas unidades”;
- “a partir de”;
- “tabela”;
- “entrega”;
- “pré-lançamento”;
- “obra”;
- “reservas”;
- “venha conhecer”;
- preço exato;
- metragem exata.

Quando uma fonte social identificar uma pessoa, imobiliária, incorporadora, endereço ou nome alternativo, usar essa descoberta para novas buscas.

#### 4.4 Camada 4 — Portais e imobiliárias
Pesquisar anúncios antigos e atuais em:
- portais imobiliários;
- sites de imobiliárias;
- páginas de corretores;
- classificados;
- agregadores de anúncios.

Usar esses resultados para validar:
- nome;
- localização;
- tipologia;
- áreas;
- número de unidades;
- preços;
- estágio da obra;
- previsão de entrega.

#### 4.5 Camada 5 — Fontes oficiais e documentais
Priorizar:
- incorporadora/construtora;
- página oficial do empreendimento;
- memorial/material comercial;
- documentos públicos;
- registro/incorporação quando disponível;
- PDFs;
- apresentações;
- tabelas comerciais;
- folders;
- arquivos indexados.

Documentos datados têm prioridade para reconstrução histórica.

#### 4.6 Camada 6 — Busca por evidência indireta
Quando não houver resultado direto, pesquisar elementos derivados:
- endereço;
- número da incorporação;
- nome da incorporadora;
- nome do proprietário/comercializador quando pertinente;
- nome alternativo do empreendimento;
- rua + bairro;
- metragem + bairro;
- preço histórico + cidade;
- frases exatas encontradas em anúncios.

A pesquisa deve **pivotar** a partir de cada nova evidência relevante.

### 5. ESTRATÉGIA DE ESCALADA
A pesquisa deve seguir esta ordem:
1. identificação;
2. confirmação;
3. histórico;
4. documentação;
5. comercialização;
6. situação atual;
7. reconstrução.

Se uma informação crítica continuar sem confirmação, não inventar.

### 6. IDENTIFICAÇÃO E DESAMBIGUAÇÃO
Antes de consolidar os dados, confirmar que todas as fontes se referem ao mesmo empreendimento.

Validar, sempre que possível, pelo conjunto:
- nome;
- endereço;
- bairro;
- cidade;
- incorporadora;
- metragem;
- número de unidades;
- características físicas.

Se houver empreendimentos com nomes semelhantes, manter fontes separadas até a desambiguação.

### 7. STATUS DA OBRA
Não concluir que um empreendimento foi entregue apenas porque uma previsão de entrega já passou.

Distinguir:
- lançamento;
- em construção;
- obras avançadas;
- concluído;
- entregue;
- status não confirmado.

Uma data de entrega é uma **previsão** até que exista evidência de conclusão/entrega.

### 8. DATAS
Registrar com precisão:
- lançamento;
- pré-lançamento, se houver;
- início da obra, se disponível;
- previsão original de entrega;
- previsão atual de entrega;
- entrega efetiva, se comprovada.

Não substituir “previsto para outubro de 2027” por “entregue em outubro de 2027”.

### 9. TABELA ATUAL
A tabela atual representa o estoque explicitamente disponibilizado na fonte analisada.

**Regra NEXUM:**
- incluir somente as unidades efetivamente presentes na tabela/foto atual;
- não completar unidades ausentes;
- não presumir disponibilidade de unidades que não aparecem;
- no contexto de comparação do NEXUM, a ausência de uma unidade previamente conhecida pode ser interpretada conforme a regra de estoque do sistema, inclusive como venda, mas isso deve ocorrer na camada de comparação, não por fabricação da tabela atual.

### 10. TABELA ZERO / LANÇAMENTO
Quando solicitado, reconstruir a situação inicial do empreendimento.

A reconstrução deve separar:
- fatos comprovados;
- dados calculados;
- estimativas;
- simulações.

Prioridade para preços:
1. tabela original datada;
2. imagem da tabela;
3. documento comercial antigo;
4. anúncio histórico com preço;
5. vídeo de lançamento;
6. fonte imobiliária datada;
7. preço por m² observado;
8. interpolação;
9. estimativa/simulação.

Se não houver preço por unidade comprovado, não apresentar a simulação como se fosse uma tabela histórica original.

### 11. ESTOQUE INICIAL
Se a quantidade total de unidades for comprovada, usar esse total.

Se a distribuição física for comprovada, respeitar exatamente:
- torres;
- pavimentos;
- unidades por pavimento;
- tipologias;
- áreas.

Não criar uma distribuição incompatível com a arquitetura conhecida.

Se a distribuição não estiver comprovada, marcar a distribuição como inferida/simulada em vez de factual.

### 12. PREÇOS
Diferenciar:
- preço observado;
- preço histórico pesquisado;
- preço calculado;
- preço inferido;
- preço simulado.

“A partir de R$ X” não significa que todas as unidades custavam R$ X.

Quando houver preço por m²:
- registrar o valor observado;
- calcular equivalentes apenas quando matematicamente justificável;
- não transformar estimativa em fato histórico.

### 13. CONDIÇÕES DE PAGAMENTO
Extrair exatamente quando disponíveis:
- entrada;
- parcelas mensais;
- intermediárias/semestrais;
- balões;
- chaves;
- financiamento;
- descontos;
- percentual de entrada;
- quantidade de parcelas.

Não alterar os valores da tabela fornecida.

Se uma condição for calculada, marcar como CALCULADO.
Se for reconstruída, marcar como SIMULADO.

### 14. ENDEREÇO E CEP
Nunca inventar CEP.

Se o endereço estiver confirmado e o CEP não estiver confirmado:
```json
"cep": null
```

Registrar a pendência para posterior validação.

### 15. NOMES ALTERNATIVOS
Registrar:
- nome comercial;
- nome formal;
- nome usado em anúncios;
- variações de grafia;
- eventual número/registro de incorporação, quando disponível.

Isso melhora a pesquisa e evita perder fontes históricas.

### 16. COMPARAÇÃO DE SNAPSHOTS
Quando houver tabela antiga + tabela atual:
- comparar unidades;
- identificar unidades que permaneceram;
- identificar unidades que desapareceram;
- identificar mudanças de preço;
- calcular valorização quando houver base comparável;
- identificar redução de estoque;
- registrar alterações nas condições de pagamento.

A comparação deve ser feita somente entre unidades comparáveis.

### 17. CONFLITOS DE FONTES
Nunca esconder divergências.

Exemplos:
- uma fonte informa 40 unidades e outra 42;
- uma informa entrega em 2026 e outra 2027;
- uma informa HM e outra MH;
- uma informa 62 m² e outra 63 m².

Registrar:
1. valor A;
2. valor B;
3. fontes;
4. evidência mais forte;
5. conclusão adotada;
6. motivo da escolha.

Se não for possível resolver, manter o conflito aberto.

### 18. NÍVEL DE CONFIANÇA
Para informações importantes:
- ALTA — fonte oficial/documento direto ou múltiplas fontes independentes concordantes;
- MÉDIA — fonte comercial confiável ou evidência indireta consistente;
- BAIXA — inferência, estimativa ou fonte fraca/isolada.

### 19. PARADA DA PESQUISA
Não parar após o primeiro resultado.

Para cada dado crítico, buscar confirmação quando possível.

A pesquisa pode ser encerrada quando:
- a identidade está suficientemente confirmada;
- os dados críticos têm evidência adequada;
- novas buscas não acrescentam informação relevante;
- conflitos foram registrados;
- pendências foram explicitadas.

### 20. PERGUNTAS AO OPERADOR
Perguntar somente quando:
- a resposta altera materialmente o JSON;
- a informação não pode ser obtida com segurança;
- a decisão não puder ser resolvida por regra da Skill.

Se o operador já forneceu a informação, não perguntar novamente.

### 21. AUDITORIA
Cada dado crítico deve poder ser rastreado até:
- arquivo fornecido;
- URL/fonte pesquisada;
- data da fonte, se disponível;
- classificação da evidência;
- observação/metodologia.

### 22. JSON PADRÃO V4
Estrutura mínima:

```json
{
  "schema": "nexum-skill-json",
  "schema_version": "4.0",
  "empreendimento": {},
  "tabela": {},
  "resumo_comercial": {},
  "comparacao": {},
  "linha_tempo": [],
  "auditoria": [],
  "fontes": [],
  "conflitos": [],
  "pendencias": []
}
```

O JSON deve ser:
- válido;
- consistente;
- determinístico;
- pronto para ingestão;
- sem comentários;
- sem texto explicativo fora dos campos previstos quando o operador solicitar somente JSON.

### 23. CAMPOS RECOMENDADOS DE PROVENIÊNCIA
Quando apropriado, usar estrutura equivalente a:

```json
{
  "valor": "exemplo",
  "origem": "PESQUISADO",
  "confianca": "ALTA",
  "fonte": "identificação da fonte"
}
```

Para valores calculados/simulados, registrar também a metodologia.

### 24. PROIBIÇÕES
É proibido:
- inventar preço;
- inventar data;
- inventar CEP;
- inventar número de unidades;
- declarar entrega sem evidência;
- tratar “a partir de” como preço universal;
- misturar empreendimentos;
- esconder conflito entre fontes;
- apresentar simulação como tabela histórica original;
- preencher a tabela atual com unidades não presentes na fonte;
- alterar valores de uma tabela fornecida;
- apagar a distinção entre observado, pesquisado, inferido, calculado e simulado.

### 25. CHECKLIST FINAL V4
Antes de entregar:
[ ] Identidade confirmada.
[ ] Pesquisa iniciada na janela histórica de aproximadamente 3 anos.
[ ] Busca temporal executada.
[ ] Redes sociais/vídeos considerados.
[ ] Portais/imobiliárias considerados.
[ ] Fontes oficiais/documentais consideradas.
[ ] Consultas alternativas por endereço/nome/termos-chave executadas quando necessário.
[ ] Lançamento investigado.
[ ] Entrega investigada.
[ ] Status da obra validado separadamente da previsão.
[ ] Incorporadora/construtora validada.
[ ] Número de unidades validado.
[ ] Áreas e tipologias validadas.
[ ] Tabela atual preservada sem inventar unidades.
[ ] Tabela Zero marcada como reconstruída/simulada quando aplicável.
[ ] Preços classificados.
[ ] Condições de pagamento classificadas.
[ ] CEP não inventado.
[ ] Conflitos registrados.
[ ] Confiança registrada para dados críticos.
[ ] Fontes e auditoria registradas.
[ ] JSON validado.

### 26. REGRA-MESTRA
O comportamento esperado da Skill NEXUM V4 é:

**PESQUISAR PROFUNDAMENTE → IDENTIFICAR → CONFIRMAR → RECONCILIAR → CLASSIFICAR A EVIDÊNCIA → RECONSTRUIR QUANDO AUTORIZADO → COMPARAR → AUDITAR → GERAR JSON.**

A qualidade não é medida pela quantidade de campos preenchidos, mas pela capacidade de distinguir com clareza o que foi encontrado, o que foi calculado, o que foi inferido e o que foi simulado.
