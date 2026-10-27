import * as B from './exposoft.test.mjs';
import * as R from './racedir.test.mjs';
import wd from 'wix-data';
const DB=global.__DB;
let pass=0,fail=0;const bad=[];
const ok=(c,m)=>{if(c)pass++;else{fail++;bad.push(m);console.log('  FAIL',m)}};
const err=async(p)=>{try{await p;return ''}catch(e){return e.message}};
const SA={suppressAuth:true};
const JPG='data:image/jpeg;base64,'+'A'.repeat(1200);
const PK={by:'self',method:'selfie',selfie:JPG};
const PKF={by:'friend',friendName:'Ravi K',friendPhone:'9999999999',method:'selfie',selfie:JPG};
const D1='Desk 1 - BIB',D2='Desk 2 - Tshirt',D3='Desk 3 - Misc';
await wd.insert('ExpoConfig',{_id:'Import910',name:'VHM',json:JSON.stringify({bibLot:100,shirtLot:{XS:0,S:1,M:5,L:5,XL:0,XXL:0}})},SA);
for(const [u,d,r] of [['bibuser','1',''],['shirtuser','Tshirt',''],['miscuser','Desk 3',''],['boss','','admin'],['floater','','']])
  await wd.insert('ExpoStaff',{username:u,password:'pw-'+u,role:r,desks:d,name:u,failCount:'0',lockUntil:''},SA);
let rn=0;
async function runner(o={}){rn++;const bib='B'+rn;const row=Object.assign({_id:'Import910~'+bib,event:'Import910',bib,name:'Runner '+rn,cat:'21K',size:'M',phone:'9000000000',email:'',example:'',checkedInAt:'',checkedInDesk:'',bibAt:'',bibDesk:'',shirtSize:'',shirtAt:'',shirtDesk:''},o);await wd.insert('Runners',row,SA);return row._id}
// One login for everything: log in to RaceOS, then start the Expo desk with the same token (what the /rd page does).
const LG=async(u)=>{const r=await R.login({username:u,password:'pw-'+u});const e=await B.enter({token:r.token});return Object.assign({token:r.token},e)};
const L=async(u,desk)=>{const r=await LG(u);if(desk&&r.desk!==desk)await B.chooseDesk({token:r.token,desk});return r.token};
const get=(id)=>wd.get('Runners',id,SA);

// ---- login sets desk / can map
const t1=await L('bibuser'),t2=await L('shirtuser'),t3=await L('miscuser');
const w1=await B.whoami({token:t1}),w2=await B.whoami({token:t2}),w3=await B.whoami({token:t3});
ok(w1.desk===D1&&w1.can.give.join()==='check,bib','bib login: desk 1, may give check+bib');
ok(w2.desk===D2&&w2.can.give.join()==='shirt','tshirt login: desk 2, may give shirt');
ok(w3.desk===D3&&w3.can.give.length===0&&w3.can.addRunner,'misc login: gives nothing, may add runner');

// ---- BIB desk
let a=await runner();
ok((await err(B.issue({token:t1,id:a,shirtSize:'M',pickup:PK})))==='wrong_desk','BIB desk cannot give T-shirt');
ok((await get(a)).shirtAt==='','  nothing saved after refused T-shirt');
ok((await err(B.issue({token:t1,id:a,bib:true,shirtSize:'M',check:true,pickup:PK})))==='wrong_desk','BIB desk: bib+check+shirt mixed request refused whole');
let g=await get(a);ok(g.bibAt===''&&g.checkedInAt==='','  mixed request saved nothing (no partial)');
let r=await B.issue({token:t1,id:a,check:true,bib:true,pickup:PK});
ok(r.done.join()==='check,bib','BIB desk: check-in + bib OK');
g=await get(a);ok(g.bibDesk===D1&&g.checkedInDesk===D1&&g.shirtAt==='','  recorded desk 1, no shirt');
ok((await err(B.issue({token:t1,id:await runner(),check:true})))==='verify_needed','BIB desk check-in needs selfie');
let b=await runner();
ok((await err(B.issue({token:t1,id:b,bib:true})))==='','BIB desk: bib only needs no selfie');
ok((await err(B.issue({token:t1,id:b})))==='nothing_to_do','empty request refused');
ok((await B.issue({token:t1,id:b,bib:true})).clash.join()==='bib','bib twice -> clash, not double');
// friend
let f=await runner();r=await B.issue({token:t1,id:f,check:true,bib:true,pickup:PKF});
ok(r.done.length===2,'BIB desk: friend pickup OK');
ok((await B.getPickup({token:t1,id:f})).pickup.by==='friend','  friend recorded');
ok((await err(B.issue({token:t1,id:await runner(),check:true,pickup:{by:'friend',friendName:'',method:'selfie',selfie:JPG}})))==='friend_needed','friend needs name');

// ---- T-shirt desk
let c=await runner();
ok((await err(B.issue({token:t2,id:c,bib:true})))==='wrong_desk','T-shirt desk cannot give bib');
ok((await err(B.issue({token:t2,id:c,check:true,pickup:PK})))==='wrong_desk','T-shirt desk cannot check in');
ok((await err(B.issue({token:t2,id:c,bib:true,shirtSize:'M',pickup:PK})))==='wrong_desk','T-shirt desk mixed bib+shirt refused');
g=await get(c);ok(g.bibAt===''&&g.shirtAt==='','  mixed saved nothing');
ok((await err(B.issue({token:t2,id:c,shirtSize:'M'})))==='verify_needed','T-shirt desk needs selfie');
ok((await err(B.issue({token:t2,id:c,shirtSize:'L',pickup:PK})))==='size_locked','T-shirt size cannot differ from registration');
r=await B.issue({token:t2,id:c,shirtSize:'M',pickup:PK});
ok(r.done.join()==='shirt','T-shirt desk gives T-shirt with selfie');
g=await get(c);ok(g.shirtDesk===D2&&g.shirtSize==='M'&&g.bibAt===''&&g.checkedInAt==='','  only shirt recorded, desk 2');
ok((await B.getPickup({token:t2,id:c})).shirtPickup.method==='selfie','  shirt selfie stored');
ok((await B.issue({token:t2,id:c,shirtSize:'M',pickup:PK})).clash.join()==='T-shirt','shirt twice -> clash');
let ns=await runner({size:''});
ok((await err(B.issue({token:t2,id:ns,shirtSize:'M',pickup:PK})))==='no_registered_size','no registered size -> refused');
let xl=await runner({size:'S'});await B.issue({token:t2,id:xl,shirtSize:'S',pickup:PK});
let xl2=await runner({size:'S'});
ok((await err(B.issue({token:t2,id:xl2,shirtSize:'S',pickup:PK})))==='out_of_stock','lot of 1 for S: second S refused');
let big=await runner({size:'XL'});
ok((await err(B.issue({token:t2,id:big,shirtSize:'XL',pickup:PK})))==='','size with lot 0 = not tracked, allowed');

// ---- MISC desk
let m=await runner();
for(const [lbl,arg] of [['bib',{bib:true}],['check',{check:true,pickup:PK}],['shirt',{shirtSize:'M',pickup:PK}]])
  ok((await err(B.issue({token:t3,id:m,...arg})))==='wrong_desk','Misc desk cannot give '+lbl);
g=await get(m);ok(!g.bibAt&&!g.shirtAt&&!g.checkedInAt,'  Misc saved nothing');
ok((await err(B.addRunner({token:t3,ev:'Import910',bib:'NEW1',name:'New One',size:'M'})))==='','Misc desk can add runner');
ok((await err(B.addRunner({token:t1,ev:'Import910',bib:'NEW2',name:'New Two'})))==='wrong_desk','BIB desk cannot add runner');
ok((await err(B.addRunner({token:t2,ev:'Import910',bib:'NEW3',name:'New Three'})))==='wrong_desk','T-shirt desk cannot add runner');

// ---- undo matrix
let u=await runner();await B.issue({token:t1,id:u,check:true,bib:true,pickup:PK});await B.issue({token:t2,id:u,shirtSize:'M',pickup:PK});
ok((await err(B.revert({token:t1,id:u,items:['shirt']})))==='wrong_desk','BIB desk cannot undo T-shirt');
ok((await err(B.revert({token:t2,id:u,items:['bib']})))==='wrong_desk','T-shirt desk cannot undo bib');
ok((await err(B.revert({token:t2,id:u,items:['check']})))==='wrong_desk','T-shirt desk cannot undo check-in');
ok((await err(B.revert({token:t2,id:u,items:['shirt','bib']})))==='wrong_desk','mixed undo refused whole');
g=await get(u);ok(g.bibAt&&g.shirtAt&&g.checkedInAt,'  nothing undone by refused calls');
ok((await err(B.revert({token:t1,id:u,items:[]})))==='nothing_to_do','empty undo refused');
ok((await err(B.revert({token:t1,id:u,items:['junk']})))==='nothing_to_do','unknown undo item ignored');
await B.revert({token:t1,id:u,items:['bib']});g=await get(u);ok(!g.bibAt&&g.shirtAt&&g.checkedInAt,'BIB desk undoes bib only');
await B.revert({token:t1,id:u,items:['check']});g=await get(u);ok(!g.checkedInAt,'BIB desk undoes check-in; selfie record removed');
ok(!(await wd.get('ExpoCheckins',u,SA)),'  check-in selfie record removed');
await B.revert({token:t2,id:u,items:['shirt']});g=await get(u);ok(!g.shirtAt&&!g.shirtSize,'T-shirt desk undoes its T-shirt');
ok(!(await wd.get('ExpoCheckins',u+'#shirt',SA)),'  shirt selfie removed');
// stock returns after undo
let again=await runner({size:'S'});
ok((await err(B.issue({token:t2,id:again,shirtSize:'S',pickup:PK})))==='out_of_stock','S still out (not undone)');
await B.revert({token:t3,id:xl,items:['shirt']});
ok((await err(B.issue({token:t2,id:again,shirtSize:'S',pickup:PK})))==='','Misc undo returns stock; S available again');
let mu=await runner();await B.issue({token:t1,id:mu,check:true,bib:true,pickup:PK});
await B.revert({token:t3,id:mu,items:['check','bib','shirt']});g=await get(mu);ok(!g.bibAt&&!g.checkedInAt,'Misc desk can undo all');

// ---- admin: bound to chosen desk, no exemption
const ta=await L('boss');let wa=await B.whoami({token:ta});
ok(wa.desk===''&&wa.can.give.length===0,'admin with no desk chosen: can do nothing');
let ad=await runner();
ok((await err(B.issue({token:ta,id:ad,bib:true})))==='no_desk','admin without desk cannot hand over');
await B.chooseDesk({token:ta,desk:D1});
ok((await err(B.issue({token:ta,id:ad,shirtSize:'M',pickup:PK})))==='wrong_desk','admin at BIB desk cannot give T-shirt');
ok((await err(B.issue({token:ta,id:ad,bib:true})))==='','admin at BIB desk gives bib');
await B.chooseDesk({token:ta,desk:D2});
ok((await err(B.issue({token:ta,id:await runner(),bib:true})))==='wrong_desk','same admin at T-shirt desk cannot give bib');
ok((await err(B.saveConfig({token:ta,ev:'Import910',bibLot:120,shirtLot:{M:6}})))==='','admin still sets stock from any desk');
for(const [n,t] of [['bib',t1],['tshirt',t2],['misc',t3]])
  ok((await err(B.saveConfig({token:t,ev:'Import910',bibLot:1,shirtLot:{M:1}})))==='admin_only','non-admin '+n+' desk cannot change stock lot');
ok((await err(B.importRunners({token:t1,ev:'Import910',rows:[{bib:'Z1',name:'Z'}]})))==='admin_only','desk user cannot import');
ok((await err(B.syncFromFindMyBib({token:t2,ev:'Import910'})))==='admin_only','desk user cannot sync');
ok((await err(B.removeSample({token:t3,ev:'Import910'})))==='admin_only','desk user cannot remove sample');

// ---- floater (no desk restriction) picks desk, rules follow the chosen desk
const tf=await L('floater');
ok((await err(B.issue({token:tf,id:await runner(),bib:true})))==='no_desk','login with several desks: no hand-over before choosing');
await B.chooseDesk({token:tf,desk:D3});
ok((await err(B.issue({token:tf,id:await runner(),bib:true})))==='wrong_desk','floater at Misc cannot give bib');
// ---- a limited login cannot choose another desk
ok((await err(B.chooseDesk({token:t1,desk:D2})))==='bad_desk','Desk-1-only login cannot switch to T-shirt desk');
// ---- client-supplied desk text ignored
let sp=await runner();
await B.issue({token:t1,id:sp,bib:true,desk:D2});g=await get(sp);ok(g.bibDesk===D1,'client-sent desk text ignored; server desk recorded');
// ---- no token / bad token
ok((await err(B.issue({id:sp,bib:true})))==='not_logged_in','no token refused');
ok((await err(B.issue({token:'x'.repeat(40),id:sp,bib:true})))==='not_logged_in','forged token refused');
// ---- one login one desk
const t1b=await L('bibuser');
ok((await err(B.chooseDesk({token:t1b,desk:D2})))==='bad_desk','second session of desk-1 login cannot move to desk 2');
await R.logout({token:t1});await R.logout({token:t1b});
// ---- race names and race lock
ok((await B.listEvents({token:ta})).map(r=>r.name).join()==='VHM','one race known: named VHM from RACE_NAMES');
global.__COLS.add('Import909');
let evs=await B.listEvents({token:ta});ok(evs.length===2&&evs.some(r=>r.id==='Import909'&&r.name==='Import909'),'new Import909 collection appears (name = ID until renamed)');
ok((await err(B.saveConfig({token:t3,ev:'Import909',name:'Hacked'})))==='admin_only','desk user cannot rename a race');
ok((await err(B.saveConfig({token:ta,ev:'Import909',name:'X',bibLot:0,shirtLot:{}})))==='bad_name','1-letter name refused');
await B.saveConfig({token:ta,ev:'Import909',name:'  Ultribe   Paderu ',bibLot:50,shirtLot:{M:10}});
evs=await B.listEvents({token:ta});ok(evs.find(r=>r.id==='Import909').name==='Ultribe Paderu','admin-typed race name saved (spaces tidied)');
evs=await B.listEvents({token:ta});ok(evs.find(r=>r.id==='Import909').name==='Ultribe Paderu','  name not overwritten by the next listing');
await B.saveConfig({token:ta,ev:'Import909',bibLot:50,shirtLot:{M:10}});
ok((await B.listEvents({token:ta})).find(r=>r.id==='Import909').name==='Ultribe Paderu','  saving the lot without a name keeps the name');
await B.saveConfig({token:ta,ev:'Import910',name:'Vizag Half Marathon',bibLot:100,shirtLot:{M:5}});
ok((await B.listEvents({token:ta})).find(r=>r.id==='Import910').name==='Vizag Half Marathon','VHM renamed in app');
await B.saveConfig({token:ta,ev:'Import910',name:'',bibLot:100,shirtLot:{M:5}});
ok((await B.listEvents({token:ta})).find(r=>r.id==='Import910').name==='VHM','empty name goes back to CMS/RACE_NAMES name');
await wd.insert('ExpoStaff',{username:'ult1',password:'pw-ult1',role:'',desks:'Desk 2',race:'ultribe paderu',name:'u',failCount:'0',lockUntil:''},SA);
await wd.insert('ExpoStaff',{username:'vhm1',password:'pw-vhm1',role:'',desks:'Desk 1',race:'Import910',name:'v',failCount:'0',lockUntil:''},SA);
await wd.insert('ExpoStaff',{username:'typo1',password:'pw-typo1',role:'',desks:'Desk 1',race:'Nowhere',name:'t',failCount:'0',lockUntil:''},SA);
ok((await err(LG('bibuser')))==='no_race','desk login with no race and several races is refused (no_race)');
ok((await err(LG('typo1')))==='bad_race','unknown race on a login -> bad_race');
const rw=await LG('ult1');
ok(rw.race==='Import909'&&rw.raceName==='Ultribe Paderu'&&rw.desk===D2&&rw.deskChosen,'login by race NAME locks race + single desk, ready to work');
const rv=await LG('vhm1');ok(rv.race==='Import910','login by Import id also works');
ok((await B.listEvents({token:rw.token})).map(r=>r.id).join()==='Import909','locked user sees only their race');
await wd.insert('Runners',{_id:'Import909~Q1',event:'Import909',bib:'Q1',name:'Q One',cat:'10K',size:'M',phone:'',email:'',example:'',checkedInAt:'',checkedInDesk:'',bibAt:'',bibDesk:'',shirtSize:'',shirtAt:'',shirtDesk:''},SA);
let lp=await B.loadPage({token:rw.token,ev:'Import910'});
ok(lp.runners.every(x=>x.id.startsWith('Import909~'))&&lp.runners.length===1,'locked user asking for another race still gets only their own');
ok((await err(B.issue({token:rw.token,id:'Import910~'+'B1',shirtSize:'M',pickup:PK})))==='not_found','locked user cannot hand over to another race runner');
ok((await err(B.revert({token:rw.token,id:'Import910~B1',items:['shirt']})))==='not_found','locked user cannot undo in another race');
ok((await err(B.getPickup({token:rw.token,id:'Import910~B1'})))==='not_found','locked user cannot read another race selfie');
ok((await err(B.issue({token:rw.token,id:'Import909~Q1',shirtSize:'M',pickup:PK})))==='','locked user works in own race');
ok((await B.whoami({token:rw.token})).race==='Import909','whoami keeps race');
// admin with no race can still choose
ok((await B.whoami({token:ta})).race==='','admin without race column is not locked');
// ---- source collection never written
ok(!DB['Import910']&&!DB['Import909'],'nothing ever written to Import collections');
// ---- findmybib column names written in different styles
await wd.insert('Import910',{'Name':'Test Runner','Bib Name':'TESTY','Bib Number':'9001','Email Id':'T@x.com','Phone Number':'9876543210','Tshirt Size':'L','Category':'25 K'},SA);
const pv=await B.previewFindMyBib({token:ta,ev:'Import910'});
ok(pv.withBib===1&&pv.sample[0].name==='Test Runner'&&pv.sample[0].bib==='9001'&&pv.sample[0].size==='L'&&pv.sample[0].cat==='25 K','findmybib: Name / Bib Number / Tshirt Size style columns are found');
ok(pv.fields.phone==='Phone Number'&&pv.fields.email==='Email Id','findmybib: Phone Number and Email Id found');
ok(pv.sample.length===1&&pv.fields.bibName==='Bib Name'&&pv.fields.bib==='Bib Number','findmybib: Bib Number and Bib Name are two separate columns');
await B.syncFromFindMyBib({token:ta,ev:'Import910'});
const synced=DB.Runners.get('Import910~9001');
ok(synced&&synced.bibName==='TESTY'&&synced.name==='Test Runner'&&synced.bib==='9001','sync: bib name saved apart from the registered name');
// ---- stock count sanity
const given=[...DB.Runners.values()].filter(x=>x.shirtSize==='M'&&x.shirtAt).length;
ok(given>0,'stock: M T-shirts counted '+given);
console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
