const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const port=32171;
const base=`http://127.0.0.1:${port}`;
const headers={'x-nexum-user':'TESTE-SKILL-V8'};

async function waitForServer(){for(let attempt=0;attempt<50;attempt++){try{const response=await fetch(`${base}/api/gestao/json-entrada`,{headers});if(response.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Servidor isolado não iniciou.')}
async function upload(source,name){const form=new FormData();form.append('file',new Blob([JSON.stringify(source)],{type:'application/json'}),name);const response=await fetch(`${base}/api/gestao/json-entrada/processar`,{method:'POST',headers,body:form});const body=await response.json();assert.equal(response.status,200,body.error);return body.job}
async function confirm(job,enterpriseId){const response=await fetch(`${base}/api/gestao/json-entrada/confirmar`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({jobId:job.id,enterpriseId,name:job.preview.table.name,validityDate:job.preview.table.validityDate,tipoTabela:'PADRAO'})});const body=await response.json();assert.equal(response.status,201,body.error);return body}
async function validate(enterpriseId,table){const response=await fetch(`${base}/api/empreendimentos/${enterpriseId}/tabelas/${table.id}/validar`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({unidades:table.unidades,regrasComerciais:'',confirmarAlertasCriticos:true,confirmarRegraInterpretada:true,naturezasRegra:[],basesRegra:[]})});const body=await response.json();assert.equal(response.status,200,body.error);return body}
async function remove(job){const response=await fetch(`${base}/api/gestao/json-entrada/excluir`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({jobId:job.id})});assert.equal(response.status,200,await response.text())}
function json(nome,id,status='DISPONIVEL'){return{schema:'nexum-skill-json',schema_version:'8.0',status_processamento:'CONSOLIDADO',operacao:id?'ADICIONAR_TABELA_A_EMPREENDIMENTO_EXISTENTE':'CADASTRAR_EMPREENDIMENTO_E_TABELA_BASE',empreendimento:{id,nome,construtora:'Construtora Teste',tipo:'Apartamento',padrao:'Popular/MCMV',fase:'Em obras',datas:{lancamento:'2025-01-01',entrega_prevista:'2027-01-01'},endereco:{logradouro:'Rua Teste',numero:'10',bairro:'Centro',cidade:'Campina Grande',uf:'PB',cep:'58400-000'}},tabela:{tipo:'TABELA_COMERCIAL',tipoTabela:'PADRAO',data_tabela:'2026-09-01',arquivo_origem:'teste-v8',unidades_apresentadas:1,unidades:[{apartamento:'101',status,status_original:status,preco:250000,area_m2:50}]},pendencias:[],auditoria:[],fontes:[]}}

(async()=>{
  const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'nexum-skill-v8-'));
  const dataFile=path.join(tempDir,'nexo-radar.test.json');
  const priorUnits=[{id:'U-101',chave:'EMP-000001:Torre_unica:101',quadra:'Torre única',unidade:'101',situacaoExtraida:'Disponível',situacaoPublicada:'Disponível',valorExtraido:250000,valorInterpretado:250000,areaPrivativa:50},{id:'U-102',chave:'EMP-000001:Torre_unica:102',quadra:'Torre única',unidade:'102',situacaoExtraida:'Disponível',situacaoPublicada:'Disponível',valorExtraido:255000,valorInterpretado:255000,areaPrivativa:50}];
  await fs.writeFile(dataFile,JSON.stringify({version:10,sequences:{empreendimento:1,tabela:1,unidade:0},empreendimentos:[{id:'EMP-000001',nome:'Residencial Existente',construtora:'Construtora Teste',endereco:'Rua Teste',numero:'10',bairro:'Centro',cidade:'Campina Grande',estado:'PB',cep:'58400-000',tipo:'Apartamento',padrao:'Popular/MCMV',fase:'Em obras',status:'active',tabelaBaseId:'TAB-BASE',tabelaPadraoTableId:'TAB-BASE',tabelaPadraoTipo:'PADRAO',tabelas:[{id:'TAB-BASE',name:'Tabela base',tipoTabela:'PADRAO',tipoTabelaLabel:'Tabela geral / não informado',validityDate:'2026-08-01',status:'registered',createdAt:'2026-08-01T00:00:00.000Z',validatedAt:'2026-08-01T00:00:00.000Z',unidades:priorUnits,comparacao:{},alertas:[],auditoria:[]}],unidades:priorUnits,pontosQuentes:[],tabelasExcluidas:[],fatosComerciais:[],intervalosComerciais:[],auditoria:[]}],dicionario:[],logs:[]},null,2));
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),NEXO_DATA_FILE:dataFile},stdio:'ignore',windowsHide:true});
  const jobs=[];
  try{
    await waitForServer();
    const existingJob=await upload(json('Residencial Existente','EMP-000001','RESERVADO'),`skill-v8-existing-${Date.now()}.json`);jobs.push(existingJob);const existingResult=await confirm(existingJob,'EMP-000001');assert.equal(existingResult.table.unidades[0].situacaoExtraida,'Vendida');assert.equal(existingResult.table.unidades[0].statusRegra,'RESERVADA_CONSIDERADA_VENDIDA');assert.ok(existingResult.table.alertas.some(item=>item.tipo==='RESERVA_CONSIDERADA_VENDA'));assert.ok(existingResult.table.alertas.some(item=>item.tipo==='UNIDADE_AUSENTE'));
    await validate('EMP-000001',existingResult.table);
    let data=JSON.parse(await fs.readFile(dataFile,'utf8'));assert.equal(data.empreendimentos.length,1,'empreendimento existente não pode ser duplicado');assert.equal(data.empreendimentos[0].tabelas.length,2,'deve adicionar somente uma nova tabela');const existing=data.empreendimentos[0],unit101=existing.unidades.find(item=>item.unidade==='101'),unit102=existing.unidades.find(item=>item.unidade==='102');assert.equal(unit101.situacaoComercial,'Vendida','reserva deve valer como venda');assert.equal(unit102.situacaoComercial,'Vendida','ausência deve valer como venda');assert.ok(existing.pontosQuentes.some(item=>item.unidade==='102'&&item.status==='aberto'),'ausência deve continuar crítica');assert.ok(existing.fatosComerciais.some(item=>item.unidadeChave===unit102.chave&&item.tipo==='VENDA_IDENTIFICADA'&&item.origem==='ausencia_assumida_venda'));
    await remove(existingJob);jobs.pop();
    const newJob=await upload(json('Residencial Novo',null),`skill-v8-new-${Date.now()}.json`);jobs.push(newJob);const newResult=await confirm(newJob,'__new__');await validate(new URL(newResult.reviewUrl,base).searchParams.get('id'),newResult.table);data=JSON.parse(await fs.readFile(dataFile,'utf8'));assert.equal(data.empreendimentos.length,2,'novo empreendimento deve ser criado');const created=data.empreendimentos.find(item=>item.nome==='Residencial Novo');assert.ok(created);assert.equal(created.tabelas.length,1);assert.equal(created.tabelaBaseId,created.tabelas[0].id);assert.equal(created.endereco,'Rua Teste');assert.equal(created.launchDate,'2025-01-01');
    await remove(newJob);jobs.pop();
    console.log('OK: existente recebe só a tabela; novo recebe cadastro + base; reserva/ausência valem como venda e continuam críticas.');
  }finally{
    child.kill();
    for(const job of jobs)await remove(job).catch(()=>{});
    await fs.rm(tempDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
