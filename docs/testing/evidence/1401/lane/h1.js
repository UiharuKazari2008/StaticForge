(async()=>{const s=JSON.parse(AndroidDevice.getRadioMode());const L=CafeTasks.lib.radio;const mask=L.maskFor("lte",s.supported,s.baseline);
const f=t=>{const d=new Date(t);const p=(n,w)=>String(n).padStart(w||2,"0");return p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())+"."+p(d.getMilliseconds(),3)};
const got=new Promise(res=>{const h=e=>{if(e.detail&&e.detail.result&&e.detail.result.op==="set"){window.removeEventListener("dreamscape:radiomode",h);res({t:Date.now(),r:e.detail.result})}};window.addEventListener("dreamscape:radiomode",h);setTimeout(()=>res("no event in 25 s"),25000)});
const t0=Date.now();const answer=AndroidDevice.setRadioMode("lte",mask);const t1=Date.now();const ev=await got;
return {mask,call:f(t0),returned:f(t1),answer,eventAt:ev.t?f(ev.t):null,result:ev.r||ev}})()
