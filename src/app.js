import { API_BASE_URL, POLL_MS, COLORS } from "./config.js";
import {
  DEMO_LINES, makeDemoVehicles, normalizePayload, delayLabel, formatClock, getQuality,
  geojsonForDemo, extractGeoJSON, lineFromProperties, safeApiUrl
} from "./data.js";
import { TransitMap } from "./map.js";

const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const initialBase = localStorage.getItem("tclfollow-api") || API_BASE_URL;
const state = {
  apiBase: initialBase,
  mode: localStorage.getItem("tclfollow-mode") === "live" && initialBase ? "live" : "demo",
  vehicles: [], routes: [], fetchedAt: null, apiStatus: "DEMO", error: null,
  selected: null, follow: false, tab: "vehicles", query: "",
  modes: new Set(["bus","tram","metro","funicular"]), favorites: new Set(JSON.parse(localStorage.getItem("tclfollow-favs") || "[]")),
  view3D: true, demoPlaying:true, demoSpeed:1, demoEpoch:Date.now(), demoOffset:0, lastTick:performance.now()
};
let map;
let pollTimer = null;
let uiLastRender = 0;
let lastDemoMapUpdate = 0;
let toastTimer = null;
const SPEEDS = [0.5,1,2,5,10];

function toast(text) {
  const node = el("toast");
  node.textContent = text;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 3200);
}
function uniqueLines(vehicles) {
  return new Map(vehicles.map(v => [v.line, v]));
}
function filteredVehicles() {
  const query = state.query.toLocaleLowerCase("fr-FR");
  return state.vehicles.filter(v => state.modes.has(v.mode) &&
    (!query || [v.line,v.destination,v.id,v.mode].some(s=>String(s).toLocaleLowerCase("fr-FR").includes(query))));
}
function effectiveStatus() {
  if (state.mode === "demo") return "demo";
  if (state.error) return "error";
  if (state.apiStatus !== "OK") return "error";
  if (state.fetchedAt && Date.now()-new Date(state.fetchedAt).getTime()>45000) return "error";
  return "real";
}
function syncStatus() {
  const status=effectiveStatus();
  el("source-state").className="live-indicator " + (status==="real"?"real":status==="error"?"error":"");
  el("source-label").textContent=status==="real"?"POSITIONS SIRI":status==="error"?"DIRECT INDISPONIBLE":"DÉMONSTRATION";
  el("source-card").className="source-card " + (status==="real"?"live":status==="error"?"error":"");
  el("source-bulb").textContent=status==="real"?"◉":status==="error"?"⚠":"◉";
  el("source-caption").textContent=status==="real"?"Positions officielles SIRI":status==="error"?"Connexion au direct indisponible":"Mode démonstration";
  el("source-description").textContent=status==="real"
    ?"Positions observées via le flux SYTRAL. Elles peuvent être retardées ; l'animation est interpolée."
    :status==="error"?(state.error || "Le flux de données ne répond pas. Les positions anciennes ne sont pas actualisées.")
    :"Trajets animés simulés. Connectez le flux officiel pour voir les véhicules réels.";
  el("btn-live").innerHTML=(status==="real"?"Configurer la source":status==="error"?"Vérifier la connexion":"Configurer le direct")+" <span>↗</span>";
  el("timeline-title").textContent=state.mode==="demo"?"SIMULATION ANIMÉE":"SUIVI TEMPS RÉEL";
  el("timeline-status").textContent=status==="real"?"SIRI":status==="error"?"HORS LIGNE":"DÉMO";
  el("map-data-status").textContent=status==="real"?"Observations SIRI · Position interpolée entre relevés":status==="error"?"Aucune donnée simulée ne remplace le direct indisponible":"Mouvements fictifs · Ne représente pas des véhicules réels";
  el("stat-foot").textContent=state.mode==="demo"?"Simulation":status==="real"?"Flux SYTRAL":"Flux indisponible";
  el("hud-subtitle").textContent=state.mode==="demo"?"Une démonstration animée du futur suivi TCL.":status==="real"?"Le réseau TCL, avec les observations officielles disponibles.":"Le flux est indisponible ; dernière position conservée.";
  el("play-btn").disabled=state.mode!=="demo";
  el("speed-btn").disabled=state.mode!=="demo";
  el("timeline").disabled=state.mode!=="demo";
}
function qualityDescription(v) {
  switch(getQuality(v)) {
    case "demo":return "Démo · trajet simulé";
    case "observed":return "Observation récente";
    case "estimated":return "Observation ancienne · affichage indicatif";
    case "stale":return "Position périmée · ne pas utiliser pour se déplacer";
    default:return "Fraîcheur inconnue";
  }
}
function delayDescription(v) {
  return v.isDemo ? "Non simulé" : delayLabel(v.delaySeconds);
}
function renderStats() {
  const items=filteredVehicles();
  el("live-count").textContent=String(items.length);
  el("line-count").textContent=String(uniqueLines(items).size);
}
function resultItem(v) {
  return '<button type="button" class="result-row'+(state.selected===v.id?' selected':'')+'" data-vehicle="'+escapeHtml(v.id)+'">'+
    '<span class="route-badge" style="--line-color:'+escapeHtml(v.color)+'">'+escapeHtml(v.line)+'</span>'+
    '<span class="result-body"><span class="result-title">'+escapeHtml(v.destination)+'</span><span class="result-sub">'+escapeHtml(v.mode==="bus"?"Bus":v.mode==="tram"?"Tramway":v.mode==="metro"?"Métro":"Funiculaire")+' · '+escapeHtml(v.isDemo?"Démo":qualityDescription(v))+'</span></span>'+
    '<span class="result-end">'+(v.delaySeconds!=null && !v.isDemo ? '<strong>'+escapeHtml(delayLabel(v.delaySeconds))+'</strong>' : '<span>⌖</span>')+'<br>Suivre ›</span></button>';
}
function renderList() {
  const items=filteredVehicles(), query=state.query.toLocaleLowerCase("fr-FR");
  let html="";
  if (state.tab==="vehicles") {
    const sorted = [...items].sort((a,b)=>a.line.localeCompare(b.line,"fr",{numeric:true})||a.id.localeCompare(b.id));
    html=sorted.slice(0,100).map(resultItem).join("");
    if (sorted.length>100) html+='<div class="empty-state">100 véhicules affichés dans la liste. Affinez votre recherche pour les autres.</div>';
    el("list-total").textContent=String(sorted.length);
  } else if(state.tab==="lines") {
    const groups = new Map();
    items.forEach(v=>{
      const previous=groups.get(v.line) || {mode:v.mode,color:v.color,line:v.line,count:0,vehicle:v};
      previous.count++;groups.set(v.line,previous);
    });
    for(const group of [...groups.values()].sort((a,b)=>a.line.localeCompare(b.line,"fr",{numeric:true}))) {
      html+='<button class="result-row" data-line="'+escapeHtml(group.line)+'"><span class="route-badge" style="--line-color:'+escapeHtml(group.color)+'">'+escapeHtml(group.line)+'</span><span class="result-body"><span class="result-title">Ligne '+escapeHtml(group.line)+'</span><span class="result-sub">'+escapeHtml(group.vehicle.destination)+'</span></span><span class="result-end">'+group.count+' véhicules<br>Voir ↗</span></button>';
    }
    el("list-total").textContent=String(groups.size);
  } else {
    const favorites=items.filter(v=>state.favorites.has(String(v.id)));
    html=favorites.map(resultItem).join("");
    el("list-total").textContent=String(favorites.length);
  }
  el("sidebar-list").innerHTML=html || '<div class="empty-state">Aucun résultat correspondant.<br>Essayez une autre ligne ou réactivez les filtres.</div>';
}
function renderDetails() {
  const v=state.vehicles.find(x=>String(x.id)===String(state.selected));
  const panel=el("info-panel");
  if(!v){panel.hidden=true;return;}
  panel.hidden=false;
  const observedTime=v.recordedAt && !v.isDemo && !Number.isNaN(Date.parse(v.recordedAt)) ? formatClock(new Date(v.recordedAt)) : "—";
  const isReal=getQuality(v)==="observed";
  el("detail-info").innerHTML='<div class="detail-line"><span class="route-badge" style="--line-color:'+escapeHtml(v.color)+'">'+escapeHtml(v.line)+'</span><div><h3>'+escapeHtml(v.destination)+'</h3><p>'+escapeHtml(v.mode==="bus"?"Bus":v.mode==="tram"?"Tramway":v.mode==="metro"?"Métro":"Funiculaire")+' · '+escapeHtml(v.id)+'</p></div></div>'+
  '<span class="quality-pill '+(isReal?'real':'')+'">'+escapeHtml(qualityDescription(v))+'</span>'+
  '<div class="detail-section"><div class="detail-grid"><div><small>RETARD COMMUNIQUÉ</small><strong>'+escapeHtml(delayDescription(v))+'</strong></div><div><small>DERNIER RELEVÉ</small><strong>'+escapeHtml(observedTime)+'</strong></div><div><small>LATITUDE</small><strong>'+Number(v.lat).toFixed(5)+'</strong></div><div><small>LONGITUDE</small><strong>'+Number(v.lng).toFixed(5)+'</strong></div></div></div>';
  el("follow-btn").textContent=state.follow?"◎  Arrêter le suivi":"◎  Suivre sur la carte";
  el("favorite-btn").textContent=state.favorites.has(String(v.id))?"★":"☆";
  el("detail-notice").textContent=v.isDemo?"Mouvement intégralement simulé. Aucun bus réel n'est représenté.":"Les positions ne sont pas des GPS continus. Un relevé ancien peut être imprécis ; ne vous fiez pas à la carte seule pour votre déplacement.";
}
function selectVehicle(id) {
  const v=state.vehicles.find(x=>String(x.id)===String(id));
  if(!v){ toast("Véhicule indisponible.");return; }
  state.selected=String(v.id);state.follow=false;
  map?.focus(v);
  renderDetails();renderList();
  if(window.innerWidth<=740) el("sidebar").classList.remove("open");
}
function updateMap() {
  if(!map)return;
  const items=filteredVehicles();
  map.setVehicles(items);
  if(state.selected)map.highlight(state.selected);
  if(state.follow) {
    const selected=items.find(v=>String(v.id)===String(state.selected));
    if(selected)map.follow(selected);
  }
}
function render(time = performance.now(), force=false) {
  el("clock").textContent=formatClock(new Date());
  if(!force && time-uiLastRender<800)return;
  uiLastRender=time;
  syncStatus();
  renderStats();
  renderList();
  if(!el("info-panel").hidden)renderDetails();
  el("timeline-label").textContent=state.mode==="demo"?formatClock(new Date(state.demoEpoch)):"Maintenant";
  if(state.mode==="demo") {
    const offset=Math.max(-120,Math.min(0,Math.round((state.demoEpoch-Date.now())/60000)));
    el("timeline").value=String(offset);
  }
}
function animateDemo(time=performance.now()) {
  const dt=Math.min(5000,Math.max(0,time-state.lastTick));
  state.lastTick=time;
  if(state.mode==="demo") {
    if(state.demoPlaying) state.demoEpoch=Math.min(Date.now(),state.demoEpoch+dt*state.demoSpeed);
    if (time - lastDemoMapUpdate > 250) {
      state.vehicles=makeDemoVehicles(state.demoEpoch);
      updateMap();
      lastDemoMapUpdate = time;
    }
  }
  render(time);
}
function startDemo() {
  clearInterval(pollTimer);
  state.mode="demo";state.apiStatus="DEMO";state.error=null;
  state.selected=null;state.follow=false;state.demoEpoch=Date.now();state.demoPlaying=true;
  el("play-btn").textContent="Ⅱ";
  state.fetchedAt=null;
  state.vehicles=makeDemoVehicles(state.demoEpoch);
  map?.setRoutes(geojsonForDemo("all"));
  map?.highlight(null);
  localStorage.setItem("tclfollow-mode","demo");
  render(performance.now(),true);updateMap();
  toast("Mode démonstration activé — trajets fictifs.");
}
async function loadRealRoutes() {
  if(!map || !state.apiBase)return;
  const endpoints=["bus","tram","metro"];
  const requests=await Promise.allSettled(endpoints.map(async mode=>{
    const resp=await fetch(state.apiBase+"/api/lines/"+mode,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
    if(!resp.ok)throw new Error("Routes "+mode+" ("+resp.status+")");
    const geojson=extractGeoJSON(await resp.json());
    return geojson.features.filter(f=>f?.geometry && ["LineString","MultiLineString"].includes(f.geometry.type)).map(f=>{
      const line=lineFromProperties(f.properties||{});
      const actualMode=/^F[12]$/i.test(line)?"funicular":mode;
      return {...f,properties:{...f.properties,line,mode:actualMode,color:COLORS[line]||COLORS[actualMode]||"#9ca8bc"}};
    });
  }));
  if(state.mode!=="live")return;
  const features=requests.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);
  map.setRoutes({type:"FeatureCollection",features});
  if(!features.length)toast("Tracés réels indisponibles : carte de base uniquement.");
}
async function pollLive() {
  if(state.mode!=="live" || !state.apiBase)return;
  try {
    const resp=await fetch(state.apiBase+"/api/vehicles",{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(14000)});
    const payload=await resp.json().catch(()=>({}));
    if(!resp.ok || payload.apiStatus!=="OK")throw new Error(payload.apiStatus==="CONFIG_REQUIRED"?"Identifiants Grand Lyon absents du Worker.":"Flux indisponible ("+(payload.apiStatus||resp.status)+").");
    const data=normalizePayload(payload);
    state.apiStatus=data.status;state.error=null;state.fetchedAt=data.fetchedAt;
    state.vehicles=data.vehicles;
    updateMap();
    render(performance.now(),true);
  } catch(err) {
    state.error=String(err.message||err);
    state.apiStatus="ERROR";
    render(performance.now(),true);
    if(state.vehicles.length)updateMap();
  }
}
function startLive(url) {
  let safe;
  try{safe=safeApiUrl(url);}catch(err){toast(err.message);return false;}
  clearInterval(pollTimer);
  state.apiBase=safe;state.mode="live";state.vehicles=[];state.error="Connexion au flux…";state.apiStatus="CONNECTING";state.selected=null;state.follow=false;state.fetchedAt=null;
  localStorage.setItem("tclfollow-api",safe);localStorage.setItem("tclfollow-mode","live");
  map?.highlight(null);map?.setRoutes({type:"FeatureCollection",features:[]});updateMap();
  loadRealRoutes();
  pollLive();
  pollTimer=setInterval(pollLive,POLL_MS);
  render(performance.now(),true);
  return true;
}
function wire() {
  el("search").addEventListener("input",e=>{state.query=e.target.value.trim();render(performance.now(),true);updateMap();});
  el("clear-search").addEventListener("click",()=>{el("search").value="";state.query="";render(performance.now(),true);updateMap();});
  el("reset-filters").addEventListener("click",()=>{
    state.modes=new Set(["bus","tram","metro","funicular"]);
    document.querySelectorAll("[data-mode]").forEach(x=>x.classList.add("active"));
    render(performance.now(),true);updateMap();
  });
  document.querySelectorAll("[data-mode]").forEach(btn=>btn.addEventListener("click",()=>{
    const key=btn.dataset.mode;
    if(state.modes.has(key))state.modes.delete(key);else state.modes.add(key);
    btn.classList.toggle("active",state.modes.has(key));
    render(performance.now(),true);updateMap();
  }));
  document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    state.tab=btn.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach(x=>{
      const selected=x.dataset.tab===state.tab;
      x.classList.toggle("active",selected);x.setAttribute("aria-selected",String(selected));
    });
    render(performance.now(),true);
  }));
  el("sidebar-list").addEventListener("click",e=>{
    const v=e.target.closest("[data-vehicle]");
    if(v)return selectVehicle(v.dataset.vehicle);
    const line=e.target.closest("[data-line]");
    if(line) {
      const first=state.vehicles.find(x=>x.line===line.dataset.line);
      if(first)selectVehicle(first.id);
    }
  });
  el("sidebar-toggle").addEventListener("click",()=>el("sidebar").classList.toggle("open"));
  el("btn-home").addEventListener("click",()=>{state.follow=false;state.selected=null;map?.flyHome();render(performance.now(),true);});
  el("btn-locate").addEventListener("click",()=>map?.locate());
  el("btn-view").addEventListener("click",()=>{
    state.view3D=!state.view3D;
    map?.set3D(state.view3D);
    el("view-label").textContent=state.view3D?"3D":"2D";
    el("btn-view").classList.toggle("active",state.view3D);
  });
  el("btn-fullscreen").addEventListener("click",async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await el("map-stage").requestFullscreen();}catch(e){toast("Plein écran non autorisé.");}
  });
  el("close-detail").addEventListener("click",()=>{state.selected=null;state.follow=false;map?.highlight(null);renderDetails();renderList();});
  el("follow-btn").addEventListener("click",()=>{
    state.follow=!state.follow;
    const v=state.vehicles.find(x=>x.id===state.selected);
    if(state.follow&&v)map?.follow(v);
    renderDetails();
  });
  el("favorite-btn").addEventListener("click",()=>{
    const id=String(state.selected||"");
    if(!id)return;
    if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);
    localStorage.setItem("tclfollow-favs",JSON.stringify([...state.favorites]));
    renderDetails();renderList();
    toast(state.favorites.has(id)?"Véhicule ajouté aux favoris.":"Favori retiré.");
  });
  const openSettings=()=>{
    el("api-url").value=state.apiBase;
    el("settings-modal").showModal();
  };
  el("btn-settings").addEventListener("click",openSettings);
  el("btn-live").addEventListener("click",openSettings);
  el("close-settings").addEventListener("click",()=>el("settings-modal").close());
  el("use-demo").addEventListener("click",()=>{el("settings-modal").close();startDemo();});
  el("settings-form").addEventListener("submit",e=>{
    e.preventDefault();
    if(startLive(el("api-url").value))el("settings-modal").close();
  });
  el("btn-demo").addEventListener("click",startDemo);
  el("btn-share").addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(location.href);toast("Lien de TCL Follow copié !");}
    catch(e){toast("Adresse : "+location.href);}
  });
  el("play-btn").addEventListener("click",()=>{
    if(state.mode!=="demo")return;
    state.demoPlaying=!state.demoPlaying;
    el("play-btn").textContent=state.demoPlaying?"Ⅱ":"▶";
  });
  el("speed-btn").addEventListener("click",()=>{
    state.demoSpeed=SPEEDS[(SPEEDS.indexOf(state.demoSpeed)+1)%SPEEDS.length];
    el("speed-btn").textContent="×"+state.demoSpeed;
  });
  el("timeline").addEventListener("input",e=>{
    if(state.mode!=="demo")return;
    state.demoEpoch=Date.now()+Number(e.target.value)*60000;
    state.demoPlaying=false;
    el("play-btn").textContent="▶";
    state.vehicles=makeDemoVehicles(state.demoEpoch);
    updateMap();render(performance.now(),true);
  });
  window.addEventListener("keydown",e=>{
    if(e.key==="Escape")el("sidebar").classList.remove("open");
    if(e.key==="/" && document.activeElement?.tagName!=="INPUT"){e.preventDefault();el("search").focus();}
  });
}
function boot() {
  wire();
  if(!globalThis.maplibregl){toast("La bibliothèque cartographique est indisponible.");el("sidebar-list").textContent="Impossible de charger MapLibre. Vérifiez la connexion Internet.";return;}
  map = new TransitMap("map",{
    onReady:()=>{
      state.vehicles=makeDemoVehicles(Date.now());
      if(state.mode==="live"&&state.apiBase)startLive(state.apiBase);
      else startDemo();
    },
    onVehicleClick:selectVehicle,
    onError:toast
  });
  const frame=(now)=>{
    if(!document.hidden)animateDemo(now);
    else state.lastTick=now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
boot();
