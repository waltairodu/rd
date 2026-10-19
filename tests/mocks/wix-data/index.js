const DB=global.__DB||(global.__DB={});let n=0;
const tbl=(c)=>DB[c]||(DB[c]=new Map());
const cl=(o)=>o==null?o:JSON.parse(JSON.stringify(o));
class Q{constructor(c){this.c=c;this.f=[];this.o=null;this.s=0;this.l=50}
eq(k,v){this.f.push(r=>r[k]===v);return this}
hasSome(k,a){this.f.push(r=>a.includes(r[k]));return this}
lt(k,v){this.f.push(r=>String(r[k])<String(v));return this}
ge(k,v){this.f.push(r=>new Date(r[k])>=new Date(v));return this}
ascending(k){this.o=k;return this}skip(n){this.s=n;return this}limit(n){this.l=n;return this}
rows(){let r=[...tbl(this.c).values()].filter(x=>this.f.every(f=>f(x)));if(this.o)r.sort((a,b)=>String(a[this.o]).localeCompare(String(b[this.o])));return r}
async find(){const r=this.rows();return{items:r.slice(this.s,this.s+this.l).map(cl),totalCount:r.length}}
async count(){return this.rows().length}}
const stamp=(o)=>{o._updatedDate=new Date();return o};
module.exports={query:(c)=>new Q(c),
get:async(c,id)=>cl(tbl(c).get(id))||null,
insert:async(c,o)=>{const x=cl(o);x._id=x._id||('i'+(++n));if(tbl(c).has(x._id))throw new Error('dup');tbl(c).set(x._id,stamp(x));return cl(x)},
update:async(c,o)=>{if(!tbl(c).has(o._id))throw new Error('nf');tbl(c).set(o._id,stamp(cl(o)));return cl(o)},
save:async(c,o)=>{const x=cl(o);x._id=x._id||('i'+(++n));tbl(c).set(x._id,stamp(x));return cl(x)},
bulkInsert:async(c,a)=>{a.forEach(o=>tbl(c).set(o._id,stamp(cl(o))));return{inserted:a.length}},
bulkUpdate:async(c,a)=>{a.forEach(o=>tbl(c).set(o._id,stamp(cl(o))));return{updated:a.length}},
bulkRemove:async(c,ids)=>{ids.forEach(i=>tbl(c).delete(i));return{removed:ids.length}}};
