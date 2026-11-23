(function(){
  const API = "https://script.google.com/macros/s/AKfycbzTmmkG8GP5tURbAXGbt9yafDcZkEu2s3BHfEJZAv3t9O-scNglmxffl5cfTcA5TOA5/exec";
  const K_FILA="usoCarroFila", K_CACHE="usoCarroCache", K_FALHAS="usoCarroFalhas", K_NOME="usoCarroNome";
  const $ = id => document.getElementById(id);
  let servidor = [], loaded = false, online = null, selOpenId = null, enviando = false, ultimaSync = null;
  const seg = { s_comb: null, c_comb: null };

  // ---------- armazenamento no celular ----------
  const ler = (k,def) => { try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch(e){ return def; } };
  // fila e recusados ficam no IndexedDB, que o app e o envio em segundo plano (Android) conseguem ler
  let FILA = [], FALHAS = [];
  function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open("usoCarro",1); r.onupgradeneeded=()=>r.result.createObjectStore("kv"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function idbGet(k){ const d=await idb(); return new Promise(res=>{ const q=d.transaction("kv").objectStore("kv").get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>res(undefined); }); }
  async function idbSet(k,v){ const d=await idb(); return new Promise(res=>{ const t=d.transaction("kv","readwrite"); t.objectStore("kv").put(v,k); t.oncomplete=()=>res(); t.onerror=()=>res(); }); }
  async function recarregarFila(){ try{ FILA=(await idbGet(K_FILA))||[]; FALHAS=(await idbGet(K_FALHAS))||[]; }catch(e){} }
  const gravar = (k,v) => {
    if(k===K_FILA){ FILA=v; return idbSet(k,v); }
    if(k===K_FALHAS){ FALHAS=v; return idbSet(k,v); }
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){}
  };
  const fila = () => FILA.slice();
  const falhas = () => FALHAS.slice();
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  const AVISO_ENVIO = IOS ? "Abra o app quando tiver internet para enviar." : "Será enviado sozinho quando a internet voltar, mesmo com o app fechado.";
  function pedirSync(){ if("serviceWorker" in navigator){ navigator.serviceWorker.ready.then(r=>{ if(r.sync) return r.sync.register("enviar-fila"); }).catch(()=>{}); } }
  servidor = ler(K_CACHE, {registros:[]}).registros || [];
  ultimaSync = ler(K_CACHE, {}).quando || null;

  // ---------- helpers ----------
  const pad = n => String(n).padStart(2,"0");
  const hoje = () => { const d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); };
  const agora = () => { const d=new Date(); return pad(d.getHours())+":"+pad(d.getMinutes()); };
  const ts = (data,hora) => { const t=new Date(data+"T"+(hora||"00:00")); return isNaN(t)?Date.now():t.getTime(); };
  const br = iso => { const [y,m,d]=iso.split("-"); return d+"/"+m+"/"+y; };
  const fmtKm = n => (n==null||n==="")?"—":Number(n).toLocaleString("pt-BR");
  const comb = (v,n) => !v ? "—" : (v==="Não completo" && n ? v+" ("+n+")" : v);
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid = () => "m" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,10);
  const horaTxt = t => { const d=new Date(t); return pad(d.getDate())+"/"+pad(d.getMonth()+1)+" "+pad(d.getHours())+":"+pad(d.getMinutes()); };
  function showMsg(el,type,text){ el.className="msg "+type; el.textContent=text; if(type==="ok") setTimeout(()=>{ if(el.firstChild && el.firstChild.textContent===text) el.className="msg"; },60000); }


  // ---------- aviso no WhatsApp ----------
  const ZAP = "5512985997740";
  function abrirZap(texto){
    const t = encodeURIComponent(texto);
    const app = "whatsapp://send?phone="+ZAP+"&text="+t, web = "https://wa.me/"+ZAP+"?text="+t;
    let saiu = false; const marca = ()=>{ saiu = true; };
    document.addEventListener("visibilitychange", marca, { once:true });
    window.location.href = app; // abre o WhatsApp direto (funciona sem internet: a mensagem fica na fila do WhatsApp)
    setTimeout(()=>{ if(!saiu && !document.hidden) window.open(web, "_blank"); }, 1500);
  }
  function botaoZap(el, texto){
    const b=document.createElement("button"); b.type="button"; b.className="btn zap"; b.textContent="Enviar aviso no WhatsApp";
    b.addEventListener("click",()=>abrirZap(texto)); el.appendChild(document.createElement("br")); el.appendChild(b);
  }
  function txtSaida(d){
    return "🚗 *SAÍDA DO CARRO*\nNome: "+d.nome+"\nDestino: "+d.destino+"\nFinalidade: "+d.finalidade+
      "\nData: "+d.saidaData+" às "+d.saidaHora+"\nKM inicial: "+fmtKm(d.kmInicial)+"\nTanque: "+comb(d.combSaida,d.nivelSaida)+
      (d.obsSaida?"\nObs.: "+d.obsSaida:"");
  }
  function txtChegada(r,d){
    return "🏁 *CHEGADA DO CARRO*\nNome: "+r.nome+"\nDestino: "+r.destino+"\nSaída: "+r.saidaData+" às "+r.saidaHora+
      "\nChegada: "+d.chegadaData+" às "+d.chegadaHora+"\nKM inicial: "+fmtKm(r.kmInicial)+" · KM final: "+fmtKm(d.kmFinal)+
      "\nKM rodados: "+fmtKm(d.kmFinal-r.kmInicial)+"\nTanque: "+comb(d.combChegada,d.nivelChegada)+(d.obsChegada?"\nObs.: "+d.obsChegada:"");
  }

  // registros = planilha + o que ainda está guardado no celular
  function registros(){
    const lista = servidor.map(r=>Object.assign({}, r));
    for(const it of fila()){
      if(it.acao==="saida"){
        if(!lista.find(r=>r.id===it.dados.id)) lista.push(Object.assign({status:"Em uso", pendente:true}, it.dados));
      } else if(it.acao==="chegada"){
        const r=lista.find(x=>x.id===it.id);
        if(r && r.status!=="Finalizado") Object.assign(r, it.dados, {status:"Finalizado", pendente:true});
      }
    }
    return lista;
  }
  function lastKm(){
    let best=null;
    for(const r of registros()){
      const k = r.kmFinal!=null ? r.kmFinal : r.kmInicial, t = r.chegadaTs || r.saidaTs || 0;
      if(k!=null && (!best || t>best.t)) best={k:Number(k),t};
    }
    return best?best.k:null;
  }
  const abertos = () => registros().filter(r=>r.status==="Em uso").sort((a,b)=>b.saidaTs-a.saidaTs);

  // ---------- abas ----------
  const tabs = document.querySelectorAll(".tabs button");
  function goTab(name){
    tabs.forEach(b=>b.classList.toggle("on", b.dataset.tab===name));
    ["saida","chegada","historico"].forEach(t=>$("tab-"+t).classList.toggle("hidden", t!==name));
  }
  tabs.forEach(b=>b.addEventListener("click",()=>{ goTab(b.dataset.tab); sincronizar(); }));

  document.querySelectorAll(".seg").forEach(g=>{
    g.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
      g.querySelectorAll("button").forEach(x=>x.classList.remove("on"));
      b.classList.add("on"); seg[g.dataset.seg]=b.dataset.v;
      (g.dataset.seg==="s_comb"?$("s_nivelBox"):$("c_nivelBox")).classList.toggle("hidden", b.dataset.v!=="Não completo");
    }));
  });
  function resetSeg(key){
    seg[key]=null;
    document.querySelectorAll('[data-seg="'+key+'"] button').forEach(x=>x.classList.remove("on"));
    (key==="s_comb"?$("s_nivelBox"):$("c_nivelBox")).classList.add("hidden");
  }
  $("s_finalidade").addEventListener("change",e=>$("s_outroBox").classList.toggle("hidden", e.target.value!=="Outro"));

  function defaultsSaida(){
    $("s_data").value=br(hoje()); $("s_hora").value=agora();
    const n=ler(K_NOME,""); if(n && !$("s_nome").value) $("s_nome").value=n;
  }
  defaultsSaida();

  // ---------- telas ----------
  function renderConexao(){
    const q=fila().length, el=$("conn");
    if(online===false){
      el.className="conn off";
      el.textContent = "Sem internet — pode registrar normalmente." + (q? " ⚠️ "+q+" registro(s) guardado(s) no celular, aguardando envio. "+AVISO_ENVIO:"");
    } else if(q){
      el.className="conn wait"; el.textContent = "Enviando "+q+" registro(s) guardado(s) no celular…";
      const b=document.createElement("button"); b.type="button"; b.className="btn ghost"; b.textContent="Enviar agora";
      b.addEventListener("click",()=>sincronizar()); el.appendChild(document.createTextNode(" ")); el.appendChild(b);
    } else { el.className="conn hidden"; el.textContent=""; }
    const f=falhas(), fb=$("falhas");
    if(!f.length){ fb.classList.add("hidden"); fb.innerHTML=""; return; }
    fb.classList.remove("hidden");
    fb.innerHTML='<b>Registros recusados</b><div class="sub2">Não foram para a planilha. Confira e registre de novo se precisar.</div>'+
      f.map((x,i)=>'<div class="falha"><div>'+esc(x.resumo)+'<br><span>Motivo: '+esc(x.erro)+'</span></div><button class="btn ghost" data-dis="'+i+'">Dispensar</button></div>').join("");
    fb.querySelectorAll("[data-dis]").forEach(b=>b.addEventListener("click",()=>{ const l=falhas(); l.splice(Number(b.dataset.dis),1); gravar(K_FALHAS,l); renderAll(); }));
  }
  function renderStatus(){
    const st=$("status"), ab=abertos();
    if(!loaded && !servidor.length && online===null){ return; }
    if(ab.length){
      const r=ab[0]; st.className="status busy";
      st.innerHTML='<div class="dot"></div><div><b>Carro em uso</b><span>'+esc(r.nome)+' saiu '+esc(r.saidaData)+' às '+esc(r.saidaHora)+' → '+esc(r.destino)+'</span></div>';
    } else {
      const k=lastKm(); st.className="status free";
      st.innerHTML='<div class="dot"></div><div><b>Carro disponível</b><span>'+(k!=null?'Último KM registrado: '+fmtKm(k):'Nenhum registro ainda')+'</span></div>';
    }
    if(online===false && ultimaSync){ st.querySelector("span").textContent += " · dados de "+horaTxt(ultimaSync); }
  }
  function renderSaidaHints(){
    const k=lastKm(), regs=registros();
    $("s_kmHint").textContent = k!=null ? "Último KM registrado: "+fmtKm(k) : "";
    if(k!=null && !$("s_km").value) $("s_km").value=k;
    const nomes=[...new Set(regs.map(r=>r.nome).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("nomes").innerHTML=nomes.map(n=>'<option value="'+esc(n)+'">').join("");
    const dest=[...new Set(regs.map(r=>r.destino).filter(Boolean))].slice(0,60);
    $("destinos").innerHTML=dest.map(n=>'<option value="'+esc(n)+'">').join("");
  }
  function renderAbertos(){
    const ab=abertos(), box=$("openList");
    if(!ab.length){ box.innerHTML='<div class="empty">Nenhuma saída em aberto. Registre a saída primeiro.</div>'; $("formChegada").classList.add("hidden"); selOpenId=null; return; }
    if(!ab.find(r=>r.id===selOpenId)) selOpenId=ab[0].id;
    box.innerHTML=ab.map(r=>'<div class="open-trip'+(r.id===selOpenId?' sel':'')+'" data-id="'+esc(r.id)+'"><b>'+esc(r.nome)+' → '+esc(r.destino)+'</b><div>Saída '+esc(r.saidaData)+' às '+esc(r.saidaHora)+' · KM inicial '+fmtKm(r.kmInicial)+' · '+esc(r.finalidade)+(r.pendente?' · <i>aguardando envio</i>':'')+'</div></div>').join("");
    box.querySelectorAll(".open-trip").forEach(el=>el.addEventListener("click",()=>{ selOpenId=el.dataset.id; renderAbertos(); }));
    const f=$("formChegada");
    if(f.classList.contains("hidden")){ $("c_data").value=br(hoje()); $("c_hora").value=agora(); }
    f.classList.remove("hidden"); calcKm();
  }
  function calcKm(){
    const r=registros().find(x=>x.id===selOpenId), v=$("c_km").value;
    if(!r){ $("c_kmCalc").textContent=""; return; }
    if(v===""){ $("c_kmCalc").innerHTML="KM inicial desta saída: <b>"+fmtKm(r.kmInicial)+"</b>"; return; }
    const d=Number(v)-Number(r.kmInicial);
    $("c_kmCalc").innerHTML = d<0 ? '<span style="color:var(--red)">KM final menor que o inicial ('+fmtKm(r.kmInicial)+')</span>' : "KM rodados: <b>"+fmtKm(d)+"</b>";
  }
  $("c_km").addEventListener("input",calcKm);

  function filtrados(){
    const mes=$("f_mes").value, nome=$("f_nome").value.trim().toLowerCase();
    return registros().filter(r=>{
      if(mes){ const d=new Date(r.saidaTs); if((d.getFullYear()+"-"+pad(d.getMonth()+1))!==mes) return false; }
      return !nome || (r.nome||"").toLowerCase().includes(nome);
    }).sort((a,b)=>b.saidaTs-a.saidaTs);
  }
  function renderLista(){
    const box=$("lista"), list=filtrados();
    let km=0, ab=0;
    list.forEach(r=>{ if(r.status==="Finalizado" && r.kmFinal!=null) km+=r.kmFinal-r.kmInicial; else ab++; });
    $("t_viagens").textContent=list.length; $("t_km").textContent=fmtKm(km); $("t_aberto").textContent=ab;
    if(!list.length){ box.innerHTML='<div class="empty">'+(registros().length?'Nenhum registro com esses filtros.':(loaded||servidor.length?'Ainda não há registros.':'Conecte à internet uma vez para carregar o histórico.'))+'</div>'; return; }
    box.innerHTML=list.map(r=>{
      const fin=r.status==="Finalizado";
      return '<div class="rec"><div class="top"><div><div class="name">'+esc(r.nome)+' → '+esc(r.destino)+'</div>'+
        '<div class="meta">'+esc(r.finalidade)+'<br>Saída: '+esc(r.saidaData)+' '+esc(r.saidaHora)+' · KM '+fmtKm(r.kmInicial)+' · Comb.: '+esc(comb(r.combSaida,r.nivelSaida))+'<br>'+
        (fin?'Chegada: '+esc(r.chegadaData)+' '+esc(r.chegadaHora)+' · KM '+fmtKm(r.kmFinal)+' · Comb.: '+esc(comb(r.combChegada,r.nivelChegada)):'Chegada ainda não registrada')+
        (r.obsSaida?'<br>Obs. saída: '+esc(r.obsSaida):'')+(r.obsChegada?'<br>Obs. chegada: '+esc(r.obsChegada):'')+
        (r.pendente?'<br><i>Guardado no celular, aguardando envio</i>':'')+
        '</div></div>'+(fin?'<span class="pill g">'+fmtKm(r.kmFinal-r.kmInicial)+' km</span>':'<span class="pill a">Em uso</span>')+'</div></div>';
    }).join("");
  }
  $("f_mes").addEventListener("input",renderLista);
  $("f_nome").addEventListener("input",renderLista);
  $("btnAtualizar").addEventListener("click",()=>sincronizar());

  function renderAll(){ renderConexao(); renderStatus(); renderSaidaHints(); renderAbertos(); renderLista(); }

  // ---------- comunicação com a planilha ----------
  function resumo(it){
    if(it.acao==="saida") return "Saída de "+it.dados.nome+" → "+it.dados.destino+" ("+it.dados.saidaData+" "+it.dados.saidaHora+")";
    const r=registros().find(x=>x.id===it.id);
    return "Chegada"+(r?" de "+r.nome+" → "+r.destino:"")+" ("+it.dados.chegadaData+" "+it.dados.chegadaHora+")";
  }
  async function enviarFila(){
    if(enviando) return; enviando=true; await recarregarFila();
    try{
      while(fila().length){
        const it=fila()[0];
        let resp;
        try{
          const r = await fetch(API, { method:"POST", body: JSON.stringify(it), headers:{ "Content-Type":"text/plain;charset=utf-8" } });
          resp = await r.json();
        }catch(e){ online=false; break; }
        online=true;
        await recarregarFila(); const q=fila(); const ix=q.findIndex(x=>JSON.stringify(x)===JSON.stringify(it)); if(ix<0) continue; q.splice(ix,1);
        if(!resp.ok){
          const f=falhas(); f.push({ resumo: resumo(it), erro: resp.erro || "Erro desconhecido" });
          if(it.acao==="saida"){
            for(let i=q.length-1;i>=0;i--) if(q[i].acao==="chegada" && q[i].id===it.dados.id){
              f.push({ resumo: resumo(q[i]), erro: "A saída correspondente foi recusada." }); q.splice(i,1);
            }
          }
          gravar(K_FALHAS,f);
        }
        await gravar(K_FILA,q);
      }
    } finally { enviando=false; }
  }
  async function baixar(){
    try{
      const r = await fetch(API+"?api=listar&t="+Date.now());
      const j = await r.json();
      if(j && j.ok){ servidor=j.registros||[]; ultimaSync=Date.now(); gravar(K_CACHE,{registros:servidor, quando:ultimaSync}); online=true; loaded=true; }
    }catch(e){ online=false; }
  }
  async function sincronizar(){
    await enviarFila();
    if(online!==false) await baixar();
    renderAll();
  }
  function colocarNaFila(item){
    const q=fila(); q.push(item); gravar(K_FILA,q).then(pedirSync);
    renderAll();
    sincronizar();
  }

  // ---------- SAÍDA ----------
  $("formSaida").addEventListener("submit",ev=>{
    ev.preventDefault();
    const m=$("s_msg");
    const nome=$("s_nome").value.trim(), destino=$("s_destino").value.trim(), outro=$("s_outro").value.trim(), km=$("s_km").value;
    let fin=$("s_finalidade").value;
    if(!nome||!destino||!fin||km===""){ showMsg(m,"err","Preencha todos os campos obrigatórios."); return; }
    if(fin==="Outro"){ if(!outro){ showMsg(m,"err","Descreva a finalidade da utilização."); return; } fin="Outro: "+outro; }
    if(!seg.s_comb){ showMsg(m,"err","Informe se o tanque está completo."); return; }
    $("s_data").value=br(hoje());
    if(!$("s_hora").value || $("s_hora").value>agora()){ showMsg(m,"err","A hora da saída não pode ser no futuro."); return; }
    const k=lastKm();
    if(k!=null && Number(km)<k){ showMsg(m,"err","KM inicial menor que o último KM registrado ("+fmtKm(k)+"). Confira o painel."); return; }
    const ab=abertos();
    if(ab.length && !$("s_btn").dataset.force){
      $("s_btn").dataset.force="1";
      showMsg(m,"warn","Atenção: há uma saída em aberto ("+ab[0].nome+" → "+ab[0].destino+"). Registre a chegada dela na aba Chegada, ou toque em Registrar saída de novo para registrar mesmo assim.");
      return;
    }
    delete $("s_btn").dataset.force;
    const semNet = online===false || navigator.onLine===false;
    const dS={ id:uid(), nome, destino, finalidade:fin, saidaData:br(hoje()), saidaHora:$("s_hora").value,
      saidaTs:ts(hoje(),$("s_hora").value), kmInicial:Number(km), combSaida:seg.s_comb,
      nivelSaida: seg.s_comb==="Não completo"?$("s_nivel").value:"", obsSaida:$("s_obs").value.trim(), regTs:Date.now() };
    const zS=txtSaida(dS);
    colocarNaFila({ acao:"saida", dados:dS });
    abrirZap(zS);
    gravar(K_NOME,nome);
    $("s_destino").value=""; $("s_finalidade").value=""; $("s_outro").value=""; $("s_outroBox").classList.add("hidden");
    $("s_obs").value=""; $("s_km").value=""; resetSeg("s_comb"); defaultsSaida(); renderAll();
    showMsg(m,"ok", semNet ? "Saída guardada no celular. "+AVISO_ENVIO : "Saída registrada. Boa viagem! Na volta, registre a chegada na aba Chegada.");
    botaoZap(m, zS);
  });

  // ---------- CHEGADA ----------
  $("formChegada").addEventListener("submit",ev=>{
    ev.preventDefault();
    const m=$("c_msg"), r=registros().find(x=>x.id===selOpenId), km=$("c_km").value;
    if(!r){ showMsg(m,"err","Selecione a saída em aberto."); return; }
    if(km===""){ showMsg(m,"err","Informe o KM final."); return; }
    if(Number(km)<Number(r.kmInicial)){ showMsg(m,"err","KM final não pode ser menor que o KM inicial ("+fmtKm(r.kmInicial)+")."); return; }
    if(!seg.c_comb){ showMsg(m,"err","Informe se o tanque está completo."); return; }
    $("c_data").value=br(hoje());
    if(!$("c_hora").value || $("c_hora").value>agora()){ showMsg(m,"err","A hora da chegada não pode ser no futuro."); return; }
    const cTs=ts(hoje(),$("c_hora").value);
    if(cTs<r.saidaTs){ showMsg(m,"err","Data/hora da chegada é anterior à saída."); return; }
    const rod=Number(km)-Number(r.kmInicial);
    const semNet = online===false || navigator.onLine===false;
    const dC={ chegadaData:br(hoje()), chegadaHora:$("c_hora").value, chegadaTs:cTs,
      kmFinal:Number(km), combChegada:seg.c_comb, nivelChegada: seg.c_comb==="Não completo"?$("c_nivel").value:"", obsChegada:$("c_obs").value.trim(), regTs:Date.now() };
    const zC=txtChegada(r,dC);
    colocarNaFila({ acao:"chegada", id:r.id, dados:dC });
    abrirZap(zC);
    $("c_km").value=""; $("c_obs").value=""; resetSeg("c_comb"); $("formChegada").classList.add("hidden"); renderAll();
    showMsg(m,"ok", semNet ? "Chegada guardada no celular ("+fmtKm(rod)+" km). "+AVISO_ENVIO : "Chegada registrada: "+fmtKm(rod)+" km rodados. Obrigado!");
    botaoZap(m, zC);
  });

  // ---------- início ----------
  recarregarFila().then(()=>{ renderAll(); sincronizar(); });
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) recarregarFila().then(sincronizar); });
  window.addEventListener("online", ()=>{ online=null; sincronizar(); });
  window.addEventListener("offline", ()=>{ online=false; renderAll(); });
  setInterval(()=>{ $("s_data").value=br(hoje()); if($("c_data").value) $("c_data").value=br(hoje()); sincronizar(); }, 30000);
  if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
})();
