# SDD — CTI Investlar MVP
## Central de Tabelas Investlar

**Tipo:** Spec-Driven Development  
**Base:** projeto anterior VGV Price/VGV Plus existente nesta pasta  
**Empreendimento piloto:** Novo Horizonte  
**Estágio:** MVP demonstrativo  
**Prioridade:** Mobile First

---

# 1. INSTRUÇÃO PRINCIPAL AO CODEX

Você está dentro da pasta de um projeto anterior do **VGV Price/VGV Plus**.

O projeto já contém telas, componentes, dados, tabelas, indicadores, cálculos e visualizações administrativas do empreendimento **Novo Horizonte**.

Sua tarefa é transformar o projeto existente em um MVP chamado:

# CTI Investlar
## Central de Tabelas Investlar

Não reescreva a aplicação do zero.

Antes de alterar qualquer arquivo:

1. Analise todo o repositório.
2. Identifique a stack, versões, arquitetura e estrutura de pastas.
3. Execute o projeto atual.
4. Execute os testes existentes, caso existam.
5. Localize os dados do Novo Horizonte.
6. Localize cards, tabelas, filtros, gráficos e indicadores.
7. Localize os cálculos de VGV.
8. Localize preço anterior, preço atual e histórico de preços.
9. Localize os status de unidades.
10. Localize a implementação atual de usuários ou login.
11. Localize qualquer recurso de PDF ou exportação.
12. Localize todas as referências visíveis à marca anterior, principalmente “Lançar”.
13. Registre o que será reutilizado, adaptado, ocultado por perfil ou criado.

Depois da auditoria, prossiga com a implementação completa.

Não pare apenas no diagnóstico, salvo se existir um bloqueio técnico real.

Este documento é a fonte principal de verdade funcional do MVP.

---

# 2. VISÃO DO PRODUTO

O CTI Investlar será uma central digital para:

- consultar empreendimentos;
- visualizar tabelas comerciais;
- consultar unidades disponíveis;
- visualizar preços e condições de pagamento;
- personalizar propostas dentro dos limites da construtora;
- gerar propostas comerciais em PDF;
- preservar uma área administrativa com estoque, preços, histórico e VGV.

O sistema terá duas experiências:

1. **Corretor:** consulta comercial, cálculo e proposta.
2. **Administrador:** tabela completa, estoque, preços, evolução e VGV.

---

# 3. IDENTIDADE DO PRODUTO

## 3.1 Nome oficial

**CTI Investlar**

## 3.2 Nome expandido

**Central de Tabelas Investlar**

## 3.3 Substituição da identidade anterior

A interface não deve mais exibir a marca ou o nome **Lançar**.

Substituir, quando aplicável:

- logotipo;
- favicon;
- título das páginas;
- cabeçalho;
- rodapé;
- menus;
- metadados;
- manifest/PWA;
- tela inicial;
- marca d’água;
- PDFs;
- textos alternativos;
- imagens institucionais.

A nova logo do CTI Investlar será fornecida dentro da pasta do projeto.

O Codex deve localizar o arquivo e usá-lo como ativo principal.

Enquanto a logo não estiver disponível, usar apenas o fallback textual:

> CTI Investlar

Não criar uma logo definitiva por conta própria.

Centralizar nome, logo, favicon e textos institucionais em um único arquivo de configuração ou componente de marca.

Não é obrigatório renomear identificadores internos do código quando isso criar risco de regressão. A prioridade é substituir a identidade visível.

---

# 4. CONSTITUIÇÃO DO PROJETO

## C-001 — Reutilizar o projeto existente

O MVP deve ser construído sobre o VGV Price/VGV Plus atual.

## C-002 — Não reescrever sem necessidade

Não substituir framework, roteamento, biblioteca visual, gerenciamento de estado ou arquitetura sem justificativa técnica.

## C-003 — Preservar a área administrativa

Tudo que já funciona para análise do Novo Horizonte deve continuar disponível ao administrador.

## C-004 — Separar os perfis

O corretor terá uma experiência comercial simplificada.

O administrador manterá a experiência analítica completa.

## C-005 — Mobile First

Toda tela nova deve ser projetada primeiro para smartphone.

Validar especialmente:

- 360 px;
- 390 px;
- tablet;
- desktop.

## C-006 — Regras fora da interface

Regras financeiras e comerciais não devem ficar espalhadas dentro dos componentes visuais.

Criar uma camada própria para:

- regras;
- cálculos;
- validações;
- moeda;
- fechamento da proposta.

## C-007 — Limites por CSV

Os limites comerciais do MVP devem ser definidos em um arquivo CSV versionado no projeto.

Não deixar valores mínimos e máximos hard-coded dentro da interface.

## C-008 — Não inventar valores

Os limites devem ser extraídos dos dados e da tabela existente do Novo Horizonte.

Quando um valor não puder ser confirmado:

- não inventar;
- documentar a lacuna;
- manter o campo configurável;
- bloquear condições potencialmente inválidas.

## C-009 — Segurança financeira

Usar centavos inteiros ou biblioteca decimal apropriada.

Não usar ponto flutuante simples em cálculos financeiros críticos.

## C-010 — Sem persistência de dados pessoais

No MVP, não salvar permanentemente:

- nome do cliente;
- nome do corretor;
- telefone;
- observações;
- proposta.

Esses dados devem existir somente durante a sessão necessária para gerar o PDF.

## C-011 — Sem autenticação real

O piloto não terá senha.

O acesso será feito por seleção de usuário.

## C-012 — Fonte principal de dados

Os dados atuais do Novo Horizonte continuam sendo a fonte principal para:

- unidades;
- lotes;
- quadras;
- preços;
- status;
- histórico;
- VGV.

O CSV deve complementar apenas as regras comerciais.

## C-013 — Sem regressão

Não quebrar:

- VGV total;
- VGV por quadra;
- VGV por lote;
- VGV por unidade;
- preço anterior;
- preço atual;
- histórico;
- status;
- filtros;
- gráficos;
- navegação administrativa.

## C-014 — Aviso comercial obrigatório

Toda visualização de unidade e toda proposta devem informar que disponibilidade e condições precisam ser confirmadas.

---

# 5. ESCOPO DO MVP

## 5.1 Empreendimento piloto

O empreendimento principal será:

# Novo Horizonte

Regras:

- não apagar outros empreendimentos;
- não gastar tempo completando empreendimentos incompletos;
- empreendimentos incompletos podem ficar ocultos do corretor;
- o fluxo do Novo Horizonte deve funcionar de ponta a ponta;
- os dados existentes devem ser preservados.

## 5.2 Resultado mínimo esperado

O MVP deve permitir:

1. selecionar Marcos ou Corretor;
2. entrar sem senha;
3. visualizar cards compactos;
4. abrir o Novo Horizonte;
5. ver total de unidades;
6. ver unidades disponíveis;
7. consultar unidades disponíveis;
8. visualizar condição padrão;
9. personalizar uma proposta;
10. validar os limites da construtora;
11. bloquear condições inferiores às permitidas;
12. gerar proposta em PDF;
13. baixar o PDF;
14. compartilhar o PDF quando suportado;
15. manter a área administrativa atual.

---

# 6. USUÁRIOS E PERFIS

## 6.1 Marcos

**Nome exibido:** Marcos  
**Perfil:** Administrador  
**Código sugerido:** `ADMIN`

O administrador poderá visualizar:

- todos os empreendimentos habilitados;
- tabela completa;
- unidades disponíveis;
- unidades reservadas;
- unidades vendidas;
- unidades bloqueadas;
- demais status existentes;
- preço anterior;
- preço atual;
- diferença absoluta;
- diferença percentual;
- histórico e evolução de preços;
- VGV total;
- VGV por quadra;
- VGV por lote;
- VGV por unidade;
- VGV por status;
- VGV disponível;
- VGV vendido;
- gráficos e indicadores atuais;
- calculadora comercial, quando necessário.

## 6.2 Corretor

**Nome exibido:** Corretor  
**Perfil:** Corretor  
**Código sugerido:** `BROKER`

O corretor poderá visualizar:

- cards dos empreendimentos publicados;
- imagem;
- nome;
- localização;
- total de unidades;
- quantidade disponível;
- unidades disponíveis;
- preço atual;
- quadra;
- bloco;
- lote;
- metragem;
- condição padrão;
- calculadora comercial;
- proposta em PDF;
- download;
- compartilhamento.

O corretor não poderá visualizar:

- VGV;
- VGV vendido;
- VGV disponível;
- preço anterior;
- histórico de aumentos;
- margens;
- indicadores internos;
- unidades vendidas;
- unidades reservadas;
- dados administrativos desnecessários.

---

# 7. ACESSO SEM SENHA

Criar uma tela inicial com duas opções.

## Card 1

**Marcos**  
Administrador

Botão:

> Entrar como administrador

## Card 2

**Corretor**  
Corretor

Botão:

> Entrar como corretor

Não solicitar:

- e-mail;
- senha;
- cadastro;
- recuperação de senha;
- autenticação social.

A seleção pode ser mantida em:

- contexto;
- store;
- memória;
- `sessionStorage`;
- solução equivalente já existente.

Deve existir uma ação clara:

> Trocar usuário

ou:

> Sair

Esse mecanismo é somente demonstrativo e não representa autenticação segura.

---

# 8. FLUXO DE NAVEGAÇÃO

```text
Seleção de usuário
│
├── Marcos / Administrador
│   └── Dashboard administrativo
│       └── Novo Horizonte
│           ├── tabela completa
│           ├── todos os status
│           ├── preço anterior
│           ├── preço atual
│           ├── evolução de preços
│           ├── VGV total
│           ├── VGV por quadra
│           ├── VGV por lote
│           └── VGV por unidade
│
└── Corretor
    └── Cards compactos
        └── Novo Horizonte
            ├── total de unidades
            ├── unidades disponíveis
            ├── tabela de disponíveis
            ├── detalhe da unidade
            ├── condição padrão
            ├── calculadora
            ├── proposta
            └── PDF