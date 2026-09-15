const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:process.env.CHECK_ZOOM ? {width:1094,height:656} : {width:1368,height:820}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3000/index.html');
  await page.evaluate(()=>setCTIUser('ADMIN'));
  // Read current workspace assets; the server supplies real data read-only.
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    const files={'/inicio.html':'inicio.html','/gestao/empreendimento':'empreendimento.html','/gestao/importar-json':'gestao/importar-json.html','/nexo.css':'nexo.css'};
    if(u.hostname==='localhost'&&files[u.pathname])return route.fulfill({path:path.resolve(__dirname,'..',files[u.pathname]),contentType:u.pathname.endsWith('.css')?'text/css':'text/html'});
    return route.continue();
  });
  await page.goto('http://localhost:3000/inicio.html');
  await page.waitForSelector('.home-module-arrow');
  await page.waitForSelector('#demand-list strong');
  await page.screenshot({path:'tmp/pdfs/trello-review/home.png',fullPage:true});
  console.log('HOME',await page.locator('.home-module-arrow').evaluateAll(nodes=>nodes.map(n=>{const a=n.getBoundingClientRect(),c=n.closest('.home-module-card').getBoundingClientRect();return {visible:a.left>=c.left&&a.right<=c.right,width:a.width}})));
  await page.goto('http://localhost:3000/gestao/empreendimento?id=EMP-000001&revisarTabela=TAB-000002');
  await page.waitForSelector('#review-table-type');
  await page.screenshot({path:'tmp/pdfs/trello-review/review.png',fullPage:true});
  console.log('REVIEW',await page.evaluate(()=>({removals:document.querySelectorAll('[data-removal-key]').length,footerZ:getComputedStyle(document.querySelector('#modal')).zIndex,footerBottom:document.querySelector('#modal .modal-footer').getBoundingClientRect().bottom,viewport:innerHeight})));
  await page.locator('#modal [data-close]').first().click();
  await page.locator('#edit').click();
  await page.locator('[data-parking-present]').selectOption('sim');
  await page.locator('[data-parking-options]').scrollIntoViewIfNeeded();
  await page.screenshot({path:'tmp/pdfs/trello-review/parking.png',fullPage:true});
  await page.goto('http://localhost:3000/gestao/importar-json');
  await page.waitForFunction(()=>typeof openReview==='function');
  await page.evaluate(()=>openReview({id:'test',fileName:'Mirante.json',preview:{enterprise:{nome:'Mirante Golden'},table:{tipoTabela:'PADRAO'},unitCount:1}},[{id:'EMP-test',nome:'Mirante Golden',construtora:'Construtora'}]));
  console.log('MATCH',await page.locator('[name="enterpriseId"]').inputValue());
  await page.screenshot({path:'tmp/pdfs/trello-review/json.png',fullPage:true});
  console.log('ERRORS',errors);
  await browser.close();
  if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
