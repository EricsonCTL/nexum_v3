---
name: skill_nexum_v5
description: Motor de pesquisa imobiliária, reconciliação, reconstrução histórica e geração de JSON estritamente compatível com o módulo Gestão do NEXUM. A V5 preserva o contrato estrutural da V3 e incorpora as melhorias de pesquisa da V4, com validações obrigatórias para impedir perda, omissão, renomeação ou alteração indevida de unidades e campos de importação.
---

# SKILL NEXUM V5.0 — MOTOR DE PESQUISA IMOBILIÁRIA E GERAÇÃO DE JSON

## 1. OBJETIVO

Receber PDF, planilha, texto, imagem, anúncio ou JSON de uma tabela imobiliária e:

1. extrair integralmente os dados fornecidos;
2. preservar o contrato de campos utilizado pelo NEXUM;
3. identificar corretamente o empreendimento;
4. pesquisar profundamente informações faltantes, atuais e históricas;
5. identificar e desambiguar incorporadora, construtora, endereço e empreendimento;
6. reconstruir Tabela Zero quando houver autorização/regra aplicável;
7. interpretar a tabela comercial sem inventar unidades;
8. comparar fotografias comerciais;
9. classificar a evidência;
10. registrar conflitos, hipóteses e pendências;
11. gerar JSON válido e pronto para ingestão no NEXUM;
12. validar programaticamente a estrutura antes da entrega.

A V5 é uma evolução da V4. Ela NÃO substitui o contrato estrutural da V3.

---

# 2. REGRA ABSOLUTA — CONTRATO DE IMPORTAÇÃO NEXUM

## 2.1 A estrutura da V3 é o contrato

Os nomes, hierarquia e significado dos campos estruturais já utilizados pelo NEXUM são considerados contrato de integração.

A V5 pode:

- adicionar informação;
- adicionar proveniência;
- adicionar auditoria;
- adicionar fontes;
- adicionar linha do tempo;
- adicionar conflitos;
- adicionar pendências;
- melhorar pesquisa;
- melhorar reconciliação;
- melhorar validação.

A V5 NÃO pode:

- renomear silenciosamente campos existentes;
- remover campos estruturais da V3;
- substituir `tabela.unidades[]` por outra estrutura;
- trocar o nome de campos de unidade;
- omitir unidades presentes no documento;
- alterar valores fornecidos;
- transformar a estrutura de importação em uma estrutura meramente descritiva.

Quando houver dúvida entre uma estrutura nova e a estrutura histórica do NEXUM, a estrutura compatível com a V3 prevalece.

## 2.2 Campos estruturais canônicos

A saída mínima deve preservar:

```json
{
  "schema": "nexum-skill-json",
  "schema_version": "5.0",
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

`status_processamento` deve permanecer presente porque faz parte do contrato de validação da V3.

A V5 pode acrescentar `linha_tempo` e `conflitos`, mas não deve remover os campos acima.

---

# 3. REGRA CRÍTICA — UNIDADES NUNCA PODEM SER PERDIDAS

Esta é uma regra NON-NEGOTIABLE.

Se o documento contém unidades individualizadas, TODAS as unidades explicitamente presentes devem aparecer individualmente em:

```text
tabela.unidades[]
```

Não basta informar apenas:

```json
"unidades_apresentadas": 38
```

É obrigatório haver 38 objetos individuais em `tabela.unidades[]`.

## 3.1 Contagem obrigatória

Sempre verificar:

```text
unidades_apresentadas == quantidade(tabela.unidades)
```

Se o documento contém 38 unidades:

```json
"unidades_apresentadas": 38,
"unidades": [
  {},
  {},
  ...
]
```

deve conter exatamente 38 objetos.

## 3.2 Não resumir unidades

É proibido substituir:

```json
"unidades": [
  {"apartamento": "101"},
  {"apartamento": "102"},
  {"apartamento": "103"}
]
```

por:

```json
"unidades_apresentadas": 3
```

ou por uma descrição textual como:

```text
101-103 disponíveis
```

A unidade deve ser individual.

## 3.3 Não omitir unidades por conveniência

Não omitir unidades porque:

- possuem o mesmo preço;
- possuem a mesma metragem;
- possuem a mesma tipologia;
- são repetitivas;
- pertencem ao mesmo pavimento;
- possuem a mesma descrição.

Cada unidade é um registro independente.

## 3.4 Não criar unidades inexistentes

Ao mesmo tempo, nunca completar uma tabela atual com unidades que não aparecem na fonte.

A regra é:

```text
unidade presente no documento
→ obrigatoriamente importar

unidade ausente no documento
→ NÃO fabricar
```

Ausência pode ser analisada na comparação, mas não pode ser transformada em uma unidade fictícia.

## 3.5 Validação de duplicidades

Verificar duplicidade pela chave natural:

```text
empreendimento + bloco/torre/quadra + apartamento/unidade
```

Se houver duplicidade real ou ambiguidade, usar:

```text
status_processamento: REVISAO
```

e registrar a pendência.

---

# 4. CAMPOS DE UNIDADE — PRESERVAR NOMES DO CONTRATO

Cada unidade deve usar os campos compatíveis com a V3:

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

Podem existir campos adicionais, quando necessários, como:

```text
bloco
torre
andar
area_coberta_m2
area_descoberta_m2
descricao_original
valor_avaliacao
origem
confianca
fonte
metodologia
```

Mas campos estruturais existentes não devem ser removidos.

## 4.1 Regra de preservação

Se a tabela original chama o campo de:

```text
UNIDADE
```

o dado deve ser mapeado para:

```json
"apartamento": "..."
```

sem perder a informação original.

Se necessário, manter também:

```json
"unidade_original": "A101"
```

A normalização não pode causar perda de informação.

---

# 5. STATUS DE UNIDADE

Usar:

```text
DISPONIVEL
VENDIDO
RESERVADO
BLOQUEADO
INDISPONIVEL
RETIRADO
NAO_IDENTIFICADO
```

Preservar também:

```json
"status_original": "Disponível"
```

quando o documento tiver outra grafia.

Nunca transformar ausência em venda automaticamente.

---

# 6. PRINCÍPIO EPISTEMOLÓGICO

Nunca preencher uma lacuna silenciosamente.

Classificar cada informação como:

```text
OBSERVADO
PESQUISADO
CONFIRMADO
INFERIDO
CALCULADO
SIMULADO
NAO_DETERMINADO
```

A classificação deve acompanhar o dado quando apropriado e sempre aparecer na auditoria.

---

# 7. PESQUISA APROFUNDADA — HERDADA DA V4

A V5 mantém o motor de pesquisa aprofundada da V4.

## 7.1 Busca ampla

Pesquisar combinações de:

- nome exato;
- nome + cidade;
- nome + bairro;
- nome + incorporadora;
- nome + construtora;
- nome + endereço;
- nome + lançamento;
- nome + pré-lançamento;
- nome + tabela;
- nome + preço;
- nome + metragem;
- nome + unidades;
- nome + entrega;
- nome + ano.

Nunca depender de uma única consulta.

## 7.2 Pesquisa temporal

Para empreendimentos existentes, iniciar aproximadamente três anos antes da data da análise.

A janela de três anos é ponto de partida, não limite.

Retroceder se houver evidência de existência anterior.

Avançar se houver evidência de lançamento posterior.

Pesquisar especialmente:

- lançamento;
- pré-lançamento;
- tabela;
- preço;
- obra;
- vendas;
- entrega.

## 7.3 Redes sociais e vídeo

Considerar:

- Instagram;
- Reels;
- YouTube;
- Shorts;
- Facebook;
- páginas de corretores;
- imobiliárias;
- vídeos de lançamento;
- vídeos de obra;
- anúncios antigos.

## 7.4 Portais e imobiliárias

Pesquisar quando houver resultados relevantes:

- Investlar;
- OLX;
- ZAP;
- Viva Real;
- Chaves na Mão;
- Imovelweb;
- portais regionais;
- imobiliárias locais;
- corretores;
- agregadores.

## 7.5 Fontes oficiais e documentais

Priorizar:

1. documento oficial;
2. site oficial da incorporadora/construtora;
3. tabela comercial original;
4. memorial;
5. registro/incorporação;
6. documentos públicos;
7. PDFs;
8. folders;
9. apresentações;
10. fontes comerciais.

Documentos datados têm prioridade na reconstrução histórica.

## 7.6 Busca por evidência indireta

Pesquisar, quando necessário:

- endereço;
- número da incorporação;
- nome da incorporadora;
- nomes alternativos;
- rua + bairro;
- metragem + bairro;
- preço histórico + cidade;
- frases exatas encontradas em anúncios.

A pesquisa deve pivotar a partir de cada nova evidência relevante.

---

# 8. IDENTIFICAÇÃO E DESAMBIGUAÇÃO

Antes de consolidar, validar o mesmo empreendimento por conjunto de evidências:

- nome;
- endereço;
- bairro;
- cidade;
- UF;
- incorporadora;
- construtora;
- metragem;
- unidades;
- características físicas;
- nomes alternativos;
- fontes externas.

Se houver homônimos, manter as fontes separadas até a desambiguação.

Nunca misturar projetos.

---

# 9. CADASTRO EXISTENTE

Se o empreendimento já estiver cadastrado:

- tratar a nova tabela como nova fotografia;
- preservar identidade;
- não criar empreendimento duplicado;
- não trocar ID existente;
- não substituir silenciosamente dados antigos;
- comparar com fotografia anterior;
- atualizar somente quando houver evidência melhor/mais recente;
- preservar histórico.

Se houver possível correspondência, mas não conclusão:

```text
status_processamento: REVISAO
```

Se não houver correspondência confiável:

```text
empreendimento_existente = false
```

---

# 10. TABELA ATUAL

A tabela atual representa somente o estoque explicitamente apresentado na fonte.

Obrigatório:

```text
preservar todas as unidades presentes
não criar unidades ausentes
não completar lacunas
não converter ausência em venda
```

A comparação entre fotografias pode interpretar a ausência segundo as regras do NEXUM, mas isso não altera a fotografia original.

---

# 11. TABELA ZERO / PRÉ-LANÇAMENTO

Quando o próprio documento for explicitamente identificado como:

```text
PRÉ-LANÇAMENTO
```

a tabela pode ser tratada como Tabela Zero da fotografia comercial, desde que a interpretação seja registrada em auditoria.

Importante:

```text
PRÉ-LANÇAMENTO no documento
≠ prova automática de estoque físico completo
```

Se a tabela lista somente unidades disponíveis comercialmente, importar somente essas unidades.

Se o operador determinar que a fotografia deve representar estoque inicial completo, somente então reconstruir unidades adicionais, e marcar claramente como inferidas/simuladas.

Nunca apresentar uma reconstrução como tabela histórica original.

---

# 12. ESTOQUE INICIAL

Se o número total de unidades for comprovado:

```text
usar o total comprovado
```

Se a distribuição física for comprovada, respeitar:

- torres;
- blocos;
- pavimentos;
- unidades por pavimento;
- tipologias;
- áreas.

Se a distribuição não for comprovada:

```text
INFERIDO
ou
SIMULADO
```

Nunca inventar arquitetura.

---

# 13. PREÇOS

Distinguir:

```text
OBSERVADO
PESQUISADO
CALCULADO
INFERIDO
SIMULADO
```

“A partir de R$ X” não significa que todas as unidades custavam R$ X.

Prioridade para preço histórico:

1. tabela original datada;
2. imagem da tabela;
3. documento comercial antigo;
4. anúncio histórico com preço;
5. vídeo de lançamento;
6. fonte imobiliária datada;
7. preço/m² observado;
8. interpolação;
9. estimativa/simulação.

Nunca alterar o valor observado da tabela recebida.

---

# 14. CONDIÇÕES DE PAGAMENTO

Extrair exatamente quando disponíveis:

- entrada;
- mensais;
- intermediárias;
- semestrais;
- balões;
- chaves;
- financiamento;
- descontos;
- percentual de entrada;
- quantidade de parcelas.

Se calculado:

```text
CALCULADO
```

Se reconstruído:

```text
SIMULADO
```

---

# 15. DATAS E OBRA

Manter separadas:

- pré-lançamento;
- lançamento;
- início das obras;
- previsão original;
- previsão atual;
- entrega efetiva;
- data da tabela;
- data de vigência.

Nunca considerar um empreendimento entregue somente porque a previsão passou.

Fases:

```text
LANCAMENTO
NOVO
EM_OBRAS
ENTREGUE
NAO_DETERMINADO
```

---

# 16. ENDEREÇO, CEP E COORDENADAS

Nunca inventar:

- CEP;
- latitude;
- longitude;
- endereço;
- CNPJ;
- razão social.

Se desconhecido:

```json
"cep": null
```

e registrar em `pendencias`.

---

# 17. COMPARAÇÃO

Quando houver fotografias comparáveis:

```json
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

Comparar pela chave natural:

```text
empreendimento + bloco/torre/quadra + unidade
```

Nunca usar UUID técnico como chave de comparação.

Não calcular indicadores que pertencem ao módulo Gestão do NEXUM, salvo solicitação explícita.

---

# 18. CONFLITOS

Nunca esconder divergências.

Registrar:

1. valor A;
2. valor B;
3. fontes;
4. evidência mais forte;
5. conclusão adotada;
6. motivo.

Se não for possível resolver:

```text
status_processamento: REVISAO
```

e manter o conflito aberto.

---

# 19. PROVENIÊNCIA

Cada dado crítico deve poder ser rastreado até:

- arquivo original;
- fonte externa;
- URL quando aplicável;
- data da fonte, quando disponível;
- classificação epistemológica;
- metodologia, se calculado/inferido/simulado.

Estrutura recomendada:

```json
{
  "valor": "exemplo",
  "origem": "PESQUISADO",
  "confianca": "ALTA",
  "fonte": "identificação da fonte"
}
```

Para cálculo/simulação:

```json
{
  "valor": 123,
  "origem": "CALCULADO",
  "metodologia": "..."
}
```

---

# 20. NÍVEL DE CONFIANÇA

```text
ALTA
MÉDIA
BAIXA
```

ALTA:
- fonte oficial;
- documento direto;
- múltiplas fontes independentes concordantes.

MÉDIA:
- fonte comercial confiável;
- evidência indireta consistente.

BAIXA:
- inferência;
- estimativa;
- fonte isolada/fraca.

---

# 21. VALIDAÇÃO PROGRAMÁTICA OBRIGATÓRIA

Antes de entregar o JSON, executar mentalmente/programaticamente todas as verificações:

## Estrutura

```text
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

```text
tabela.id existe
tabela.tipo existe
tabela.data_tabela existe
tabela.arquivo_origem existe
tabela.unidades_apresentadas existe
Array.isArray(tabela.unidades) == true
```

## Unidades

```text
quantidade(tabela.unidades)
==
tabela.unidades_apresentadas
```

Além disso:

```text
nenhuma unidade omitida
nenhuma unidade inventada
nenhuma duplicidade
nenhuma unidade agrupada indevidamente
```

## Integridade dos dados

Verificar:

```text
status original preservado
valores originais preservados
áreas originais preservadas
descrições relevantes preservadas
bloco/torre preservado
campos de importação preservados
```

## Pesquisa

Verificar:

```text
dados pesquisados possuem fonte
dados inferidos estão identificados
dados simulados estão identificados
conflitos estão registrados
```

## Histórico

Verificar:

```text
Tabela Zero não foi confundida com tabela atual
tabelas diferentes não foram misturadas
ausências não foram transformadas automaticamente em vendas
```

---

# 22. GATE DE SEGURANÇA DE UNIDADES

Antes de finalizar, executar esta sequência:

```text
1. contar linhas/unidades do documento;
2. extrair cada unidade individualmente;
3. contar objetos em tabela.unidades;
4. comparar as duas contagens;
5. comparar identificadores;
6. procurar duplicidades;
7. verificar se alguma unidade do documento ficou sem correspondente;
8. verificar se alguma unidade do JSON não existe no documento;
9. somente então permitir CONSOLIDADO.
```

Se qualquer etapa falhar:

```text
status_processamento: REVISAO
```

Nunca entregar como CONSOLIDADO.

---

# 23. REGRA DE FALHA SEGURA

Se houver dúvida sobre:

- quantidade de unidades;
- leitura da tabela;
- identificação do empreendimento;
- correspondência de unidade;
- estrutura do JSON;
- campo obrigatório;
- conflito material;

não tentar “embelezar” ou completar.

Fazer:

```text
REVISAO
+
pendencia objetiva
```

A prioridade é integridade da importação, não aparência de completude.

---

# 24. CHECKLIST FINAL V5

Antes da entrega:

- [ ] identidade confirmada;
- [ ] histórico pesquisado;
- [ ] busca temporal realizada;
- [ ] redes sociais/vídeos considerados;
- [ ] portais/imobiliárias considerados;
- [ ] fontes oficiais/documentais consideradas;
- [ ] lançamento investigado;
- [ ] entrega investigada;
- [ ] status da obra separado da previsão;
- [ ] incorporadora/construtora pesquisada;
- [ ] endereço pesquisado;
- [ ] CEP não inventado;
- [ ] coordenadas não inventadas;
- [ ] número total de unidades pesquisado;
- [ ] áreas e tipologias validadas;
- [ ] tabela original preservada;
- [ ] TODAS as unidades presentes na fonte importadas individualmente;
- [ ] nenhuma unidade ausente foi inventada;
- [ ] `tabela.unidades` é array;
- [ ] `unidades_apresentadas` = quantidade do array;
- [ ] nenhuma duplicidade;
- [ ] campos estruturais da V3 preservados;
- [ ] valores originais preservados;
- [ ] status original preservado;
- [ ] Tabela Zero corretamente classificada;
- [ ] simulações identificadas;
- [ ] preços classificados;
- [ ] pagamentos classificados;
- [ ] conflitos registrados;
- [ ] confiança registrada;
- [ ] fontes registradas;
- [ ] auditoria registrada;
- [ ] JSON validado.

---

# 25. CONTRATO DE ENTREGA

Entregar sempre:

1. JSON final;
2. nome do empreendimento;
3. data da tabela;
4. tipo da tabela;
5. status de cadastro;
6. quantidade de unidades;
7. distribuição por situação;
8. pendências;
9. alertas;
10. indicação de tabela anterior;
11. indicação de Tabela Zero;
12. fontes pesquisadas;
13. separação entre observado, pesquisado, inferido, calculado e simulado.

Nunca declarar que o cadastro foi persistido no NEXUM.

A Skill gera a entrada estruturada. Persistência, IDs técnicos, sequences, histórico definitivo e gravação no Cadastro Central pertencem ao NEXUM/Codex.

---

# 26. PRINCÍPIO-MESTRE

A V5 deve operar assim:

```text
PESQUISAR PROFUNDAMENTE
→ IDENTIFICAR
→ CONFIRMAR
→ RECONCILIAR
→ EXTRAIR INTEGRALMENTE
→ PRESERVAR O CONTRATO NEXUM
→ CLASSIFICAR A EVIDÊNCIA
→ RECONSTRUIR QUANDO AUTORIZADO
→ COMPARAR
→ VALIDAR UNIDADES
→ VALIDAR JSON
→ AUDITAR
→ GERAR
```

Regra final:

```text
A V5 pode melhorar a inteligência.
A V5 pode melhorar a pesquisa.
A V5 pode melhorar a auditoria.

A V5 NÃO pode quebrar a importação existente.
```

A estrutura da V3 é o contrato.
A inteligência de pesquisa da V4 é a evolução.
A V5 une as duas sem perder compatibilidade.
