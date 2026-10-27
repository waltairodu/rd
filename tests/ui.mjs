import fs from 'fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import * as B from './exposoft.test.mjs';
import * as R from './racedir.test.mjs';
import wd from 'wix-data';
const SA={suppressAuth:true};
let html=fs.readFileSync('../wix/expo/exposoft-embed.html','utf8');
const tail='})();\n</script>';if(!html.includes(tail))throw new Error('tail');
html=html.replace(tail,'window.__t={get S(){return S},openRunner:openRunner,renderPanel:renderPanel,api:api,renderSetupLive:renderSetupLive};'+tail);
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  FAIL',m)}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const JPG='data:image/jpeg;base64,'+'A'.repeat(1200);
await wd.insert('ExpoConfig',{_id:'Import910',name:'VHM',json:JSON.stringify({bibLot:100,shirtLot:{M:50,L:50}})},SA);
for(const [u,d,r] of [['d1','1',''],['d2','2',''],['d3','3',''],['adm','','admin']])
  await wd.insert('ExpoStaff',{username:u,password:'pw',role:r,desks:d,name:u,failCount:'0',lockUntil:''},SA);
let n=0;const mk=async(o={})=>{n++;const id='Import910~U'+n;await wd.insert('Runners',Object.assign({_id:id,event:'Import910',bib:'U'+n,name:'Name '+n,cat:'21K',size:'M',phone:'9000000000',email:'',example:'',checkedInAt:'',checkedInDesk:'',bibAt:'',bibDesk:'',shirtSize:'',shirtAt:'',shirtDesk:''},o),SA);return id};
const fresh=await mk(),full=await mk({checkedInAt:'2026-10-18T05:00:00Z',checkedInDesk:'Desk 1 - BIB',bibAt:'2026-10-18T05:00:00Z',bibDesk:'Desk 1 - BIB',shirtSize:'M',shirtAt:'2026-10-18T05:05:00Z',shirtDesk:'Desk 2 - Tshirt'});
const fresh2=await mk(),fresh3=await mk();

async function open(user,desk){
  // One login: the person logs in to RaceOS; the page that holds the Expo desk adds that session token to every call.
  const rl=await R.login({username:user,password:'pw'});const tok=rl.token;
  const vc=new VirtualConsole();vc.on('jsdomError',e=>console.log('JSERR',e.message,(e.detail&&e.detail.stack||'').split('\n')[0]));const dom=new JSDOM(html,{virtualConsole:vc,runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/',beforeParse(w){w.HTMLElement.prototype.scrollIntoView=()=>{};}});
  const w=dom.window,d=w.document;
  // The desk page believes an answer only from the page that holds it (window.parent), so the answers are delivered as coming from there.
  const answer=(data)=>w.dispatchEvent(new w.MessageEvent('message',{data,source:w.parent}));
  w.addEventListener('message',async(e)=>{const m=e.data;if(!m||m.kind!=='call')return;
    try{const r=await B[m.method](Object.assign({},m.arg,{token:tok}));answer({kind:'result',id:m.id,ok:true,result:JSON.parse(JSON.stringify(r===undefined?null:r))})}
    catch(x){answer({kind:'result',id:m.id,ok:false,error:x.message})}});
  await sleep(550);
  if(!d.querySelector('#pickForm').hidden){
    const sel=d.querySelector('#pkDesk');if(desk)sel.value=desk;
    d.querySelector('#pickForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(700)}
  return {w,d,tok};
}
async function pickRunner(w,d,id){
  d.querySelector('#q').value='';w.__t.S.q='';
  w.__t.openRunner(id);await sleep(100);
  return d.querySelector('#panel');
}
const txt=(el)=>el.textContent.replace(/\s+/g,' ');
// ---- Desk 1
{const {w,d}=await open('d1');
 ok(!d.querySelector('#app').hidden,'desk1 app open');
 ok(w.__t.S.me.desk==='Desk 1 - BIB','desk1 desk is BIB');
 let p=await pickRunner(w,d,fresh);
 ok(!!p.querySelector('[data-item="check"][data-act="pick"]'),'D1 shows check-in toggle');
 ok(!!p.querySelector('[data-item="bib"][data-act="pick"]'),'D1 shows bib toggle');
 ok(!p.querySelector('[data-item="shirt"][data-act="pick"]'),'D1 has NO T-shirt toggle');
 ok(/Desk 2 - Tshirt/.test(txt(p)),'D1 tells to go to the T-shirt desk');
 ok(w.__t.S.pick.shirt===false,'D1 shirt never preselected');
 ok(p.querySelector('[data-act="confirm"]').disabled,'D1 confirm waits for selfie');
 w.__t.S.pickup.selfie=JPG;w.__t.renderPanel();
 const btn=d.querySelector('#panel [data-act="confirm"]');ok(!btn.disabled,'D1 confirm enabled after selfie');ok(/Check in \+ hand over bib/i.test(txt(btn)),'D1 button label: '+txt(btn));
 btn.click();await sleep(500);
 const row=await wd.get('Runners',fresh,SA);ok(row.bibAt&&row.checkedInAt&&!row.shirtAt,'D1 UI hand-over saved bib+check only');
 // forced tamper: call T-shirt via api
 let e='';try{await w.__t.api('issue',{id:fresh2,shirtSize:'M',pickup:{by:'self',method:'selfie',selfie:JPG}})}catch(x){e=x.message}
 ok(e==='wrong_desk','D1 tampered T-shirt call refused by server');
 p=await pickRunner(w,d,full);
 ok(!!p.querySelector('[data-act="undo-item"][data-item="bib"]')&&!!p.querySelector('[data-act="undo-item"][data-item="check"]'),'D1 undo for bib + check');
 ok(!p.querySelector('[data-act="undo-item"][data-item="shirt"]'),'D1 no undo for T-shirt');
 w.close();}
// ---- Desk 2
{const {w,d}=await open('d2');
 ok(w.__t.S.me.desk==='Desk 2 - Tshirt','desk2 desk is Tshirt');
 let p=await pickRunner(w,d,fresh2);
 ok(!!p.querySelector('[data-item="shirt"][data-act="pick"]'),'D2 shows T-shirt toggle');
 ok(!p.querySelector('[data-item="bib"][data-act="pick"]')&&!p.querySelector('[data-item="check"][data-act="pick"]'),'D2 has NO bib / check-in toggles');
 ok(/Desk 1 - BIB/.test(txt(p)),'D2 tells to go to the BIB desk');
 ok(/Size M/.test(txt(p))&&!p.querySelector('select'),'D2 size is fixed text, no size picker');
 ok(p.querySelector('[data-act="confirm"]').disabled,'D2 confirm waits for selfie');
 w.__t.S.pickup.selfie=JPG;w.__t.renderPanel();
 const btn=d.querySelector('#panel [data-act="confirm"]');ok(!btn.disabled&&/T-shirt/.test(txt(btn)),'D2 confirm enabled: '+txt(btn));
 btn.click();await sleep(500);
 const row=await wd.get('Runners',fresh2,SA);ok(row.shirtAt&&row.shirtSize==='M'&&!row.bibAt&&!row.checkedInAt,'D2 UI saved T-shirt only');
 let e='';try{await w.__t.api('issue',{id:fresh3,bib:true})}catch(x){e=x.message}ok(e==='wrong_desk','D2 tampered bib call refused');
 p=await pickRunner(w,d,full);
 ok(!!p.querySelector('[data-act="undo-item"][data-item="shirt"]')&&!p.querySelector('[data-act="undo-item"][data-item="bib"]'),'D2 undo only for T-shirt');
 w.close();}
// ---- Desk 3
{const {w,d}=await open('d3');
 ok(w.__t.S.me.desk==='Desk 3 - Misc','desk3 desk is Misc');
 let p=await pickRunner(w,d,fresh3);
 ok(!p.querySelector('[data-act="pick"]'),'D3 has no hand-over toggles');
 const btn=p.querySelector('[data-act="confirm"]');ok(btn.disabled&&/Nothing is handed over/.test(txt(btn)),'D3 button disabled: '+txt(btn));
 p=await pickRunner(w,d,full);
 ok(['check','bib','shirt'].every(i=>!!p.querySelector('[data-act="undo-item"][data-item="'+i+'"]')),'D3 can undo all three');
 ok(d.querySelector('#addForm').parentNode.hidden===false,'D3 sees Add runner');
 w.close();}
// ---- Desk 1 does not see add runner; admin on desk 2
{const {w,d}=await open('d1');w.__t.renderSetupLive();ok(d.querySelector('#addForm').parentNode.hidden===true,'D1 Add runner hidden');w.close();}
{const {w,d}=await open('adm','Desk 2 - Tshirt');
 ok(w.__t.S.me.desk==='Desk 2 - Tshirt','admin picked T-shirt desk');
 let p=await pickRunner(w,d,fresh3);ok(!p.querySelector('[data-item="bib"][data-act="pick"]')&&!!p.querySelector('[data-item="shirt"][data-act="pick"]'),'admin at T-shirt desk: T-shirt only');
 ok(w.__t.S.canAdmin,'admin still has setup tools');w.close();}
// ---- no pick screens for locked logins
{const {w,d}=await open('d1');
 ok(d.querySelector('#gate').hidden&&!d.querySelector('#app').hidden,'D1: login and pick screens are gone after login');
 ok(d.querySelector('#raceSel').parentNode.hidden,'D1: race selector hidden');
 ok(d.querySelector('[data-act="change-desk"]').hidden,'D1: "Change race or desk" hidden');
 ok(d.querySelector('#deskName').readOnly&&d.querySelector('#deskName').value==='Desk 1 - BIB','D1: desk shown as read-only text');
 w.close();}
{const {w,d}=await open('adm');
 ok(!d.querySelector('#pickForm').hidden&&d.querySelector('#pkRace').parentNode.hidden&&!d.querySelector('#pkDesk').parentNode.hidden,'admin with several desks: only the desk is asked (one race only)');
 w.close();}
// two races: locked user by race name, rename in the app
await wd.insert('ExpoConfig',{_id:'Import909',name:'Import909',json:JSON.stringify({bibLot:10,shirtLot:{M:10}})},SA);
global.__COLS.add('Import909');global.__COLS.add('Import910');
await wd.insert('ExpoStaff',{username:'u9',password:'pw',role:'',desks:'Desk 2',race:'Import909',name:'u9',failCount:'0',lockUntil:''},SA);
await wd.insert('ExpoStaff',{username:'adm2',password:'pw',role:'admin',desks:'Desk 3',race:'',name:'adm2',failCount:'0',lockUntil:''},SA);
{const {w,d}=await open('u9');
 ok(d.querySelector('#pickForm').hidden&&!d.querySelector('#app').hidden,'locked race+desk: straight into the app with two races existing');
 ok(d.querySelector('#raceSel').parentNode.hidden,'  race selector hidden');w.close();}
{const {w,d,tok}=await open('adm2');
 ok(!d.querySelector('#pickForm').hidden&&!d.querySelector('#pkRace').parentNode.hidden&&d.querySelector('#pkDesk').parentNode.hidden,'admin with 2 races and one desk: only the race is asked');
 d.querySelector('#pkRace').value='Import909';
 d.querySelector('#pickForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(700);
 ok(!d.querySelector('#app').hidden&&!d.querySelector('#raceSel').parentNode.hidden,'  admin enters; race selector visible');
 w.__t.S.tab='stock';
 const nm=d.querySelector('#cfgName');ok(!!nm&&!nm.disabled,'  admin sees race name box');
 nm.value='Ultribe Paderu';
 d.querySelector('#saveCfg').click();await sleep(600);
 ok(d.querySelector('#raceSel').textContent.includes('Ultribe Paderu'),'  race dropdown shows the new name');
 ok((await B.listEvents({token:tok})).some(r=>r.name==='Ultribe Paderu'),'  name stored on the server');
 w.close();}
console.log(`\nUI: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
