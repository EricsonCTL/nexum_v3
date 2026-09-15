# Nexum Online

Esta pasta é gerada pela raiz do projeto. Ela contém a aplicação pública, a
fotografia consolidada em `data/nexum-public.json` e, quando aplicável, PDFs
já validados em `public/pdf/`.

## Visualização local

Com o motor local aberto na raiz em `http://localhost:3000`, abra outro
terminal, entre nesta pasta e execute `npm start`. A cópia online abre em
`http://localhost:3001` e expõe somente leitura em `/api/public-data`.

Não adicione aqui importadores, processadores, rotinas de gestão ou dados de
entrada. Para publicar na Vercel, use esta pasta como **Root Directory**.

A raiz sincroniza este pacote automaticamente ao consolidar dados. Para
republicar também alterações de interface feitas fora de um processamento,
execute `npm run export:online` na raiz.
