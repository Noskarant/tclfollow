import { DEFAULT_VIEW, MAP_STYLE, COLORS } from "./config.js";
import { geojsonForDemo } from "./data.js";

const GL = globalThis.maplibregl;
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
const emptyFC = () => ({ type: "FeatureCollection", features: [] });
const lerp = (a,b,t) => a + (b - a) * t;
const mixedBearing = (a,b,t) => a + (((b-a+540)%360)-180)*t;

class VehicleLayer {
  constructor(map) {
    this.id = "tcl-3d-vehicles";
    this.type = "custom";
    this.renderingMode = "3d";
    this.map = map;
    this.models = new Map();
    this.positions = [];
    this.selectedId = null;
    this.enabled = true;
    this.THREE = null;
    this.available = false;
  }
  async loadThree() {
    try {
      this.THREE = await import(THREE_URL);
      this.available = true;
      if (this.map.loaded() && !this.map.getLayer(this.id)) this.map.addLayer(this);
    } catch (err) {
      console.warn("3D models unavailable. 2D overlay remains active.", err);
      this.available = false;
    }
  }
  onAdd(map, gl) {
    const T = this.THREE;
    if (!T) return;
    this.scene = new T.Scene();
    this.camera = new T.Camera();
    this.scene.add(new T.AmbientLight(0xffffff, 2.4));
    const sun = new T.DirectionalLight(0xe8efff, 2.5);
    sun.position.set(0.3, -0.5, 1);
    this.scene.add(sun);
    this.renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true, alpha: true });
    this.renderer.autoClear = false;
    this.renderModels(this.positions);
  }
  material(color, options = {}) {
    return new this.THREE.MeshStandardMaterial({ color, roughness: .58, metalness: .18, ...options });
  }
  makeVehicle(v) {
    const T = this.THREE;
    const root = new T.Group();
    const mode = v.mode;
    const length = mode === "tram" ? 26 : mode === "metro" ? 18 : mode === "funicular" ? 10 : 11.6;
    const width = mode === "tram" || mode === "metro" ? 2.6 : 2.48;
    const high = mode === "tram" ? 3.0 : 3.1;
    const body = this.material(v.color || COLORS[mode] || "#ffb86c");
    const glass = this.material("#142a38", { metalness: .3, roughness: .17 });
    const roof = this.material("#d1dce2", { metalness: .35 });
    const under = this.material("#18212a");
    const white = this.material("#e9faff", { emissive: "#98bacc", emissiveIntensity: .35 });
    const red = this.material("#ff526b", { emissive: "#9b182e", emissiveIntensity: .3 });
    const addBox = (material, x,y,z, a,b,c, parent = root) => {
      const mesh = new T.Mesh(new T.BoxGeometry(a,b,c), material);
      mesh.position.set(x,y,z);
      parent.add(mesh);
      return mesh;
    };
    addBox(under, 0,0,.52,length*.95,width*.98,.7);
    addBox(body, 0,0,1.84,length,width,2.2);
    addBox(roof, 0,0,3.0,length*.93,width*.9,.23);
    addBox(glass, length / 2 + .013,0,2.05,.05,width*.80,1.16);
    addBox(glass, -length / 2 - .013,0,2.04,.045,width*.8,1.05);
    for (const side of [-1,1]) {
      const n = mode === "tram" ? 13 : mode === "metro" ? 9 : 6;
      for(let i=0;i<n;i++) {
        const windowLength = (length - 1.8) / n * .72;
        const x=-length/2+1+(i+.5)*(length-2)/n;
        addBox(glass,x,side*(width/2+.025),2.19,windowLength,.045,.76);
      }
      addBox(this.material("#e4eff8", {emissive:"#e4eff8", emissiveIntensity:.7}),length/2+.045,side*(width/2-.4),1.08,.06,.32,.18);
      addBox(red,-length/2-.045,side*(width/2-.4),1.02,.065,.29,.14);
    }
    if (mode === "bus") {
      for (const x of [-length*.34,length*.34]) {
        for(const side of [-1,1]) {
          const wheel = new T.Mesh(new T.CylinderGeometry(.47,.47,.18,12),under);
          wheel.rotation.x = Math.PI/2;
          wheel.position.set(x,side*width/2,.45);
          root.add(wheel);
        }
      }
    } else {
      const segments = mode === "tram" ? 3 : 2;
      for(let i=1;i<segments;i++) {
        const x=-length/2+i*length/segments;
        addBox(under,x,0,1.35,.18,width+.15,.75);
      }
    }
    addBox(white,length*.27,0,3.16,mode==="bus" ? 2.4 : 1.8,1.5,.14);
    root.userData.vehicleId = v.id;
    return root;
  }
  renderModels(vehicles) {
    if (!this.scene || !this.THREE) return;
    const keep = new Set();
    const shown = vehicles.slice(0, 650);
    for (const v of shown) {
      const id = String(v.id);
      keep.add(id);
      let record = this.models.get(id);
      if (!record || record.mode !== v.mode || record.color !== v.color) {
        if (record) this.scene.remove(record.mesh);
        const mesh = this.makeVehicle(v);
        this.scene.add(mesh);
        record = { mesh, id, mode:v.mode, color:v.color, current:{...v}, target:{...v}, start: performance.now(), duration: 1 };
        this.models.set(id, record);
      }
      record.target = { ...v };
      record.start = performance.now();
      record.duration = v.isDemo ? 220 : 2500;
      if (record.current.lng !== v.lng || record.current.lat !== v.lat) record.moving = true;
      record.mesh.visible = this.enabled;
    }
    for (const [id, record] of this.models.entries()) {
      if (!keep.has(id)) {
        this.scene.remove(record.mesh);
        this.models.delete(id);
      }
    }
    this.map.triggerRepaint();
  }
  setVehicles(vehicles) {
    this.positions = vehicles;
    this.renderModels(vehicles);
  }
  setSelected(id) {
    this.selectedId = id;
    this.map.triggerRepaint();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    for (const record of this.models.values()) record.mesh.visible = enabled;
    this.map.triggerRepaint();
  }
  render(gl, matrix) {
    if (!this.THREE || !this.renderer || !this.scene || !this.enabled) return;
    const values = matrix?.defaultProjectionData?.mainMatrix || matrix?.modelViewProjectionMatrix || matrix;
    if (!values || !this.camera) return;
    this.camera.projectionMatrix.fromArray(values);
    const now=performance.now();
    let transitioning = false;
    for (const record of this.models.values()) {
      const t = Math.min(1,(now-record.start)/record.duration);
      const eased = t*t*(3-2*t);
      const current = record.current, target = record.target;
      const lng=lerp(current.lng,target.lng,eased);
      const lat=lerp(current.lat,target.lat,eased);
      const bearing=mixedBearing(current.bearing||0,target.bearing||0,eased);
      const merc=GL.MercatorCoordinate.fromLngLat({lng,lat},0);
      const scale=merc.meterInMercatorCoordinateUnits();
      record.mesh.position.set(merc.x,merc.y,merc.z);
      record.mesh.scale.set(scale,scale,scale);
      record.mesh.rotation.z=(bearing-90)*Math.PI/180;
      if (record.id === this.selectedId) record.mesh.scale.multiplyScalar(1.22);
      if (t<1) transitioning=true;
      else record.current = { ...target };
    }
    this.renderer.resetState();
    this.renderer.render(this.scene,this.camera);
    if (transitioning) this.map.triggerRepaint();
  }
}

export class TransitMap {
  constructor(container, handlers = {}) {
    this.handlers = handlers;
    this.map = new GL.Map({
      container,
      style: MAP_STYLE,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      pitch: DEFAULT_VIEW.pitch,
      bearing: DEFAULT_VIEW.bearing,
      maxPitch: 80,
      minZoom: 9,
      attributionControl: false,
      antialias: true
    });
    this.ready = false;
    this.vehicles = [];
    this.selected = null;
    this.routes = geojsonForDemo("all");
    this.overlay3d = new VehicleLayer(this.map);
    this.map.addControl(new GL.AttributionControl({ compact:true }), "bottom-right");
    this.map.on("load", () => {
      this.ready = true;
      this.attachLayers();
      this.overlay3d.loadThree();
      this.setVehicles(this.vehicles);
      this.handlers.onReady?.();
    });
    this.map.on("error", (e) => { console.warn("Map error", e.error); });
    this.map.on("click","vehicle-hit", (evt) => {
      const id = evt.features?.[0]?.properties?.id;
      if (id) this.handlers.onVehicleClick?.(id);
    });
    this.map.on("mouseenter", "vehicle-hit", () => { this.map.getCanvas().style.cursor = "pointer"; });
    this.map.on("mouseleave", "vehicle-hit", () => { this.map.getCanvas().style.cursor = ""; });
  }
  attachLayers() {
    const map=this.map;
    const before=map.getStyle().layers?.find(x=>x.type==="symbol")?.id;
    if (map.getSource("openmaptiles")) {
      map.addLayer({
        id:"tcl-3d-buildings",type:"fill-extrusion",source:"openmaptiles","source-layer":"building",
        minzoom:14, paint:{
          "fill-extrusion-color":["interpolate",["linear"],["get","render_height"],0,"#222c3b",120,"#37485a"],
          "fill-extrusion-height":["coalesce",["get","render_height"],["get","height"],9],
          "fill-extrusion-base":["coalesce",["get","render_min_height"],0],
          "fill-extrusion-opacity":["interpolate",["linear"],["zoom"],14,0,15,.72]
        }
      },before);
    }
    map.addSource("tcl-routes",{type:"geojson",data:this.routes});
    map.addLayer({id:"tcl-routes-line",type:"line",source:"tcl-routes",paint:{
      "line-color":["coalesce",["get","color"],"#8495b0"],
      "line-opacity":.76,"line-width":["interpolate",["linear"],["zoom"],11,1.1,15,3.4,18,5.2]
    },layout:{"line-cap":"round","line-join":"round"}},before);
    map.addSource("tcl-vehicles",{type:"geojson",data:emptyFC()});
    map.addLayer({id:"vehicle-aura",type:"circle",source:"tcl-vehicles",paint:{
      "circle-color":["get","color"],"circle-radius":["interpolate",["linear"],["zoom"],11,3,14,8,17,13],
      "circle-blur":.8,"circle-opacity":.38
    }});
    map.addLayer({id:"vehicle-hit",type:"circle",source:"tcl-vehicles",paint:{
      "circle-color":["get","color"],"circle-radius":["interpolate",["linear"],["zoom"],11,4,14,9,17,14],
      "circle-stroke-color":"#0a1322","circle-stroke-width":2,"circle-opacity":.92
    }});
    map.addLayer({id:"vehicle-label",type:"symbol",source:"tcl-vehicles",layout:{
      "text-field":["get","line"],"text-size":11,"text-font":["Open Sans Bold","Arial Unicode MS Bold"],
      "text-offset":[0,1.7],"text-optional":true,"text-allow-overlap":false
    },paint:{"text-color":"#f7f9fc","text-halo-color":"#101722","text-halo-width":1.2}});
    map.addSource("tcl-selected",{type:"geojson",data:emptyFC()});
    map.addLayer({id:"selected-halo",type:"circle",source:"tcl-selected",paint:{
      "circle-color":"#fff","circle-opacity":.1,"circle-radius":22,
      "circle-stroke-color":"#fff","circle-stroke-width":2.3,"circle-stroke-opacity":.8
    }});
  }
  setVehicles(vehicles) {
    this.vehicles=vehicles;
    if (!this.ready) return;
    const collection={ type:"FeatureCollection",features:vehicles.map(v=>({
      type:"Feature",properties:{id:String(v.id),line:String(v.line),color:String(v.color),mode:v.mode},
      geometry:{type:"Point",coordinates:[v.lng,v.lat]}
    }))};
    this.map.getSource("tcl-vehicles")?.setData(collection);
    this.overlay3d.setVehicles(vehicles);
    this.highlight(this.selected);
  }
  setRoutes(geojson) {
    this.routes=geojson;
    if (this.ready) this.map.getSource("tcl-routes")?.setData(geojson);
  }
  highlight(id) {
    this.selected=id;
    this.overlay3d.setSelected(id);
    if (!this.ready) return;
    const v=this.vehicles.find(x=>String(x.id)===String(id));
    this.map.getSource("tcl-selected").setData(v ? {
      type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Point",coordinates:[v.lng,v.lat]},properties:{}}]
    } : emptyFC());
  }
  focus(vehicle, zoom=16.8) {
    if (!vehicle) return;
    this.highlight(vehicle.id);
    this.map.flyTo({center:[vehicle.lng,vehicle.lat],zoom:Math.max(zoom,this.map.getZoom()),pitch:65,duration:1150,essential:true});
  }
  flyHome() {
    this.highlight(null);
    this.map.flyTo({ ...DEFAULT_VIEW,duration:1400,essential:true });
  }
  set3D(enabled) {
    this.overlay3d.setEnabled(enabled);
    this.map.easeTo({pitch:enabled?62:0,bearing:enabled?-24:0,duration:700});
    if(this.map.getLayer("tcl-3d-buildings"))this.map.setLayoutProperty("tcl-3d-buildings","visibility",enabled?"visible":"none");
    for(const layer of ["vehicle-aura","vehicle-hit"])this.map.setPaintProperty(layer,"circle-opacity",enabled?(layer==="vehicle-hit"?.20:.28):.95);
  }
  follow(vehicle) {
    if (!vehicle) return;
    this.map.easeTo({center:[vehicle.lng,vehicle.lat],bearing:vehicle.bearing-25,zoom:Math.max(this.map.getZoom(),16),pitch:67,duration:900});
  }
  locate() {
    if (!navigator.geolocation) throw new Error("Géolocalisation non disponible");
    navigator.geolocation.getCurrentPosition(
      pos=>this.map.flyTo({center:[pos.coords.longitude,pos.coords.latitude],zoom:15,duration:1100}),
      ()=>this.handlers.onError?.("Impossible d'obtenir votre position."),
      {enableHighAccuracy:false,timeout:8000}
    );
  }
}
