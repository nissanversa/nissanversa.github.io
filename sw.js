// Guarda o app no celular para abrir sem internet
// e, no Android, envia os registros guardados mesmo com o app fechado.
const CACHE = 'uso-carro-v9';
const ARQUIVOS = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const API = "https://script.google.com/macros/s/AKfycbzTmmkG8GP5tURbAXGbt9yafDcZkEu2s3BHfEJZAv3t9O-scNglmxffl5cfTcA5TOA5/exec";

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // planilha do Google vai direto
  e.respondWith(
    fetch(e.request).then(r => {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});

// ---------- envio em segundo plano (Android) ----------
function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open("usoCarro",1); r.onupgradeneeded=()=>r.result.createObjectStore("kv"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function get(k){ const d=await idb(); return new Promise(res=>{ const q=d.transaction("kv").objectStore("kv").get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>res(undefined); }); }
async function set(k,v){ const d=await idb(); return new Promise(res=>{ const t=d.transaction("kv","readwrite"); t.objectStore("kv").put(v,k); t.oncomplete=()=>res(); t.onerror=()=>res(); }); }

async function enviarFila(){
  let fila = (await get('usoCarroFila')) || [];
  while (fila.length) {
    const it = fila[0];
    const r = await fetch(API, { method:'POST', body: JSON.stringify(it), headers:{ 'Content-Type':'text/plain;charset=utf-8' } });
    const resp = await r.json(); // sem internet dá erro aqui e o Android tenta de novo depois
    fila = (await get('usoCarroFila')) || [];
    const ix = fila.findIndex(x => JSON.stringify(x) === JSON.stringify(it));
    if (ix < 0) continue;
    fila.splice(ix, 1);
    if (!resp.ok) {
      const f = (await get('usoCarroFalhas')) || [];
      f.push({
        resumo: it.acao === 'saida'
          ? 'Saída de ' + it.dados.nome + ' → ' + it.dados.destino + ' (' + it.dados.saidaData + ' ' + it.dados.saidaHora + ')'
          : 'Chegada (' + it.dados.chegadaData + ' ' + it.dados.chegadaHora + ')',
        erro: resp.erro || 'Erro desconhecido'
      });
      await set('usoCarroFalhas', f);
    }
    await set('usoCarroFila', fila);
  }
}

self.addEventListener('sync', e => {
  if (e.tag === 'enviar-fila') e.waitUntil(enviarFila());
});
