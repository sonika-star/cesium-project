// URL eventData
const urlParams = new URLSearchParams(window.location.search);
const eventDataString = urlParams.get("eventData");
const eventData = eventDataString ? JSON.parse(eventDataString) : null;

console.log("Event data from URL:", eventData);

// CONFIG
const BASE_API_URL = "http://192.168.1.30:9001/event/event/api";
const ENDPOINTS = {
  ALL_EVENTS: `${BASE_API_URL}/events/`,
  EVENT_BY_ID: (id) => `${BASE_API_URL}/events/${id}/full/`,
};
const REFRESH_INTERVAL = 15000;

// Global state
let map; // Leaflet map
let pointLayer, pathLayerGroup;
let mapMarkers = {},
  polylines = {},
  animated = {};
let selectedEventId = null;
let refreshIntervalId = null;
let lastFetchedRecords = [];
let animationState = {
  isPlaying: false,
  isPaused: false,
  currentEventId: null,
};

// Base map layers
let baseLayers = {
  OpenStreetMap: null,
  Topographic: null,
  Satellite: null,
  Terrain: null,
};

// GIS Layer Management
const gisLayers = {
  admin: null,
  lulc: null,
  airbase: null,
  contours: null,
  railway: null,
  road: null,
  police: null,
  Fire: null,
  religious: null,
  energy: null,
  borders: null,
  hydrology: null,
  Lakes: null,
  Highways: null,
};

// Add this at the top with other global variables
let currentMapMode = "2d"; // Track current map mode
let cesiumViewer = null; // Will hold Cesium viewer instance

// Map switching functionality
function initMapSwitch() {
  const mapToggle = document.getElementById("mapToggle");
  if (!mapToggle) {
    console.error(
      "Map toggle button not found! Make sure element with id 'mapToggle' exists."
    );
    return;
  }

  console.log("Map toggle found, setting up event listener...");

  // Start in 2D mode
  mapToggle.checked = false;
  currentMapMode = "2d";

  mapToggle.addEventListener("change", function () {
    console.log("Toggle clicked! Checked:", this.checked);

    if (this.checked) {
      switchTo3D();
    } else {
      switchTo2D();
    }
  });

  console.log("Map switch initialized successfully");
}

function switchTo3D() {
  console.log("Switching to 3D mode...");
  if (currentMapMode === "3d") return;

  currentMapMode = "3d";

  // Hide 2D map container
  const mapContainer = document.getElementById("map");
  if (mapContainer) {
    mapContainer.style.display = "none";
    console.log("Hidden 2D container");
  }

  // Create or show 3D container
  let cesiumContainer = document.getElementById("cesiumContainer");
  if (!cesiumContainer) {
    console.log("Creating new Cesium container...");
    cesiumContainer = document.createElement("div");
    cesiumContainer.id = "cesiumContainer";
    cesiumContainer.style.width = "100%";
    cesiumContainer.style.height = "100vh";
    cesiumContainer.style.position = "fixed";
    cesiumContainer.style.top = "0";
    cesiumContainer.style.left = "0";
    cesiumContainer.style.zIndex = "1000";
    cesiumContainer.style.backgroundColor = "#000";
    document.body.appendChild(cesiumContainer);
  } else {
    cesiumContainer.style.display = "block";
    console.log("Showing existing 3D container");
  }

  // Initialize Cesium if not already done
  if (!cesiumViewer) {
    console.log("Initializing Cesium 3D...");
    loadCesium3D();
  } else {
    console.log("Cesium already initialized, syncing data...");
    // Sync current data to 3D map
    if (lastFetchedRecords.length > 0) {
      render3DRecords(lastFetchedRecords);
    }

    // Sync selected event
    if (selectedEventId) {
      highlight3DEvent(selectedEventId);
    }
  }

  console.log("Successfully switched to 3D map");
}

function highlight3DEvent(eventId) {
  if (!cesiumViewer) return;

  // Reset all entities to default style
  cesiumViewer.entities.values.forEach((entity) => {
    if (entity.point) {
      entity.point.pixelSize = 8;
      entity.point.color = getColorForSeverity3D(1);
      entity.label.show = false;
    }
  });

  // Highlight selected event entities
  cesiumViewer.entities.values.forEach((entity) => {
    if (entity.id && entity.id.includes(`-${eventId}-`)) {
      if (entity.point) {
        entity.point.pixelSize = 12;
        entity.point.color = Cesium.Color.GOLD;
        entity.label.show = true;
      }
    }
  });
}

function switchTo2D() {
  console.log("Switching to 2D mode...");
  if (currentMapMode === "2d") return;

  currentMapMode = "2d";

  // Hide 3D container
  const cesiumContainer = document.getElementById("cesiumContainer");
  if (cesiumContainer) {
    cesiumContainer.style.display = "none";
    console.log("Hidden 3D container");
  }

  // Show 2D map container
  const mapContainer = document.getElementById("map");
  if (mapContainer) {
    mapContainer.style.display = "block";
    mapContainer.style.position = "relative";
    mapContainer.style.zIndex = "1";
    console.log("Showing 2D container");

    // Force map to refresh its size
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        console.log("2D map size refreshed");
      } else {
        console.log("2D map not initialized, initializing now...");
        initMap();
      }
    }, 100);
  } else {
    console.error("2D map container not found!");
  }

  console.log("Successfully switched to 2D map");
}

// Load Cesium 3D functionality
function loadCesium3D() {
  // Check if Cesium is loaded
  if (typeof Cesium === "undefined") {
    // Load Cesium dynamically
    loadCesiumLibrary().then(() => {
      initCesium3D();
    });
  } else {
    initCesium3D();
  }
}

function loadCesiumLibrary() {
  return new Promise((resolve, reject) => {
    // Load Cesium CSS
    const cesiumCSS = document.createElement("link");
    cesiumCSS.rel = "stylesheet";
    cesiumCSS.href =
      "https://cesium.com/downloads/cesiumjs/releases/1.110/Build/Cesium/Widgets/widgets.css";
    document.head.appendChild(cesiumCSS);

    // Load Cesium JS
    const cesiumJS = document.createElement("script");
    cesiumJS.src =
      "https://cesium.com/downloads/cesiumjs/releases/1.110/Build/Cesium/Cesium.js";
    cesiumJS.onload = resolve;
    cesiumJS.onerror = reject;
    document.head.appendChild(cesiumJS);
  });
}

function initCesium3D() {
  if (cesiumViewer) return; // Already initialized

  try {
    cesiumViewer = new Cesium.Viewer("cesiumContainer", {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      homeButton: false,
      sceneModePicker: true,
      baseLayerPicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: true,
      geocoder: true,
      infoBox: true,
      selectionIndicator: true,
    });

    // Set initial view to India (same as your 3D.js)
    cesiumViewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 3500000.0),
      orientation: {
        heading: 0.0,
        pitch: -0.6,
        roll: 0.0,
      },
    });

    // Transfer current event data to 3D map
    if (lastFetchedRecords.length > 0) {
      render3DRecords(lastFetchedRecords);
    }

    console.log("Cesium 3D map initialized");
  } catch (error) {
    console.error("Failed to initialize Cesium 3D map:", error);
    alert("Failed to load 3D map. Switching back to 2D.");
    document.getElementById("mapToggle").checked = false;
    switchTo2D();
  }
}

// Enhanced 3D rendering with animation support
function render3DRecords(records) {
  if (!cesiumViewer) return;

  // Clear existing entities
  cesiumViewer.entities.removeAll();

  const normalized = records.map(normalizeRecord).filter(Boolean);

  // Group records by event_id for path rendering
  const groups = normalized.reduce((acc, r) => {
    const id = r.event_id;
    acc[id] = acc[id] || [];
    acc[id].push(r);
    return acc;
  }, {});

  Object.keys(groups).forEach((eventId) => {
    const eventRecords = groups[eventId].sort(
      (a, b) => safeDate(a.event_time) - safeDate(b.event_time)
    );

    // Add points for each record
    eventRecords.forEach((record, index) => {
      cesiumViewer.entities.add({
        id: `point-${eventId}-${index}`,
        position: Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          record.altitude_m || 0
        ),
        point: {
          pixelSize: 8,
          color: getColorForSeverity3D(record.severity_level),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: record.event_name,
          font: "12pt sans-serif",
          pixelOffset: new Cesium.Cartesian2(0, -40),
          show: false,
        },
        description: createPopupContent3D(record),
      });
    });

    // Add path line if multiple points
    if (eventRecords.length > 1) {
      const positions = eventRecords.map((record) =>
        Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          record.altitude_m || 0
        )
      );

      cesiumViewer.entities.add({
        id: `path-${eventId}`,
        polyline: {
          positions: positions,
          width: 3,
          material: getColorForSeverity3D(eventRecords[0].severity_level),
          clampToGround: true,
        },
      });
    }
  });
}

function getColorForSeverity3D(sev = 1) {
  const colorMap = {
    1: Cesium.Color.GREEN,
    2: Cesium.Color.YELLOW,
    3: Cesium.Color.RED,
  };
  return colorMap[sev] || Cesium.Color.BLUE;
}

function createPopupContent3D(record) {
  return `
    <h3>${record.event_name}</h3>
    <p><strong>Time:</strong> ${new Date(
      record.event_time
    ).toLocaleString()}</p>
    <p><strong>Coordinates:</strong> ${record.latitude.toFixed(
      6
    )}, ${record.longitude.toFixed(6)}</p>
    <p><strong>Altitude:</strong> ${record.altitude_m || 0} m</p>
    <p><strong>Severity:</strong> ${record.severity_level}</p>
  `;
}

// Initialize the map with enhanced layer control
function initMap() {
  // Clear existing map
  if (map) {
    map.remove();
    map = null;
  }

  // Clear containers
  document.getElementById("map").innerHTML = "";

  // Initialize Leaflet 2D map
  map = L.map("map").setView([20.5937, 78.9629], 5);

  // Create base layers
  baseLayers["OpenStreetMap"] = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "© OpenStreetMap contributors",
    }
  );

  baseLayers["Topographic"] = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 17,
      attribution: "Topographic Contours",
    }
  );

  // Add satellite imagery (using Esri World Imagery)
  baseLayers["Satellite"] = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      maxZoom: 18,
    }
  );

  // Add terrain layer (using USGS US TopoMap)
  baseLayers["Terrain"] = L.tileLayer(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 16,
      attribution:
        'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
    }
  );

  // Add default base layer
  baseLayers["OpenStreetMap"].addTo(map);

  // Create a custom layer control with improved styling
  const layerControl = L.control
    .layers(
      {
        OpenStreetMap: baseLayers["OpenStreetMap"],
        Topographic: baseLayers["Topographic"],
        Satellite: baseLayers["Satellite"],
        Terrain: baseLayers["Terrain"],
      },
      {},
      {
        position: "topright",
        collapsed: true,
      }
    )
    .addTo(map);

  // Enhance the layer control appearance after it's added to the map
  setTimeout(() => {
    const layerControlContainer = document.querySelector(
      ".leaflet-control-layers"
    );
    if (layerControlContainer) {
      // Add group headers to the layer control
      const baseLayersList = layerControlContainer.querySelector(
        ".leaflet-control-layers-base"
      );
      if (baseLayersList) {
        const baseHeader = document.createElement("div");
        baseHeader.className = "layer-group-header";
        baseHeader.innerHTML = '<i class="fas fa-map"></i> Base Maps';
        baseLayersList.parentNode.insertBefore(baseHeader, baseLayersList);
      }
    }
  }, 100);

  pointLayer = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => {
      const sev = feature.properties.severity_level || 1;
      const colorMap = { 1: "#2ecc71", 2: "#f1c40f", 3: "#e74c3c" };
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: colorMap[sev] || "#3498db",
        color: "#2c3e50",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9,
      }).bindPopup(shortPopup(feature.properties));
    },
  }).addTo(map);

  pathLayerGroup = L.layerGroup().addTo(map);

  // Re-render records if we have data
  if (lastFetchedRecords.length) {
    renderRecords(lastFetchedRecords);
  }

  // Update controls
  injectControls();
}

// Initialize location and measurement controls
function initMapControls() {
  // Add locate control
  const locateControl = L.control
    .locate({
      position: "topleft",
      follow: true,
      setView: true,
      keepCurrentZoomLevel: false,
      markerStyle: {
        weight: 2,
        color: "#3498db",
        fillColor: "#3498db",
        fillOpacity: 1,
        radius: 8,
      },
      icon: "fas fa-crosshairs",
      metric: true,
      strings: {
        title: "Show my location",
        popup: "You are here",
      },
      locateOptions: {
        maxZoom: 16,
        watch: true,
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 50,
      },
    })
    .addTo(map);

  /*Custom interactive measurement control*/
  function addCustomMeasureControl(map) {
    // state
    let measuring = false;
    const measureLayer = L.layerGroup().addTo(map);
    let measureMarkers = [];
    let measureLine = L.polyline([], {
      color: "#1abc9c",
      weight: 3,
      dashArray: "4,6",
    });
    let measureSegmentLabels = [];

    // Helper: format distances
    function formatDist(m) {
      if (m >= 1000) return (m / 1000).toFixed(3).replace(/\.?0+$/, "") + " km";
      if (m >= 100) return m.toFixed(1) + " m";
      return m.toFixed(1) + " m";
    }

    // Update map overlays (polyline, segment labels, total)
    function updateMeasure() {
      const latlngs = measureMarkers.map((m) => m.getLatLng());
      measureLine.setLatLngs(latlngs);
      if (!measureLayer.hasLayer(measureLine))
        measureLayer.addLayer(measureLine);

      // Clear old segment labels
      measureSegmentLabels.forEach((lbl) => measureLayer.removeLayer(lbl));
      measureSegmentLabels = [];

      let total = 0;
      for (let i = 0; i < latlngs.length - 1; i++) {
        const a = latlngs[i],
          b = latlngs[i + 1];
        const segDist = a.distanceTo(b); // meters
        total += segDist;

        const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
        const label = L.marker(mid, {
          interactive: false,
          icon: L.divIcon({
            className: "measure-label",
            html: `<div>${formatDist(segDist)}</div>`,
          }),
        }).addTo(measureLayer);
        measureSegmentLabels.push(label);
      }

      // Update total display in info bar
      const totalDiv = document.getElementById("measureTotal");
      if (totalDiv)
        totalDiv.innerHTML = `<strong>Total:</strong> ${formatDist(total)}`;
    }

    // Remove a specific marker
    function removeMarker(marker) {
      const idx = measureMarkers.indexOf(marker);
      if (idx === -1) return;
      measureLayer.removeLayer(marker);
      measureMarkers.splice(idx, 1);
      updateMeasure();
    }

    // Undo last marker
    function undoLast() {
      if (!measureMarkers.length) return;
      const last = measureMarkers.pop();
      measureLayer.removeLayer(last);
      updateMeasure();
    }

    // Clear all
    function clearAll() {
      measureMarkers.forEach((m) => measureLayer.removeLayer(m));
      measureMarkers = [];
      measureSegmentLabels.forEach((l) => measureLayer.removeLayer(l));
      measureSegmentLabels = [];
      if (measureLayer.hasLayer(measureLine))
        measureLayer.removeLayer(measureLine);
      const totalDiv = document.getElementById("measureTotal");
      if (totalDiv) totalDiv.innerHTML = "";
    }

    // Map click handler to create marker
    function onMapClickAddPoint(e) {
      const latlng = e.latlng;
      // Create a tiny circular marker as a draggable point using divIcon
      const marker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({
          className: "measure-point",
          html: '<div class="measure-dot"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(measureLayer);

      // Live update as user drags the marker
      marker.on("drag", updateMeasure);
      marker.on("dragend", updateMeasure);

      // Shift+click on a marker will remove it (helps quick edits)
      marker.on("click", function (ev) {
        if (ev.originalEvent && ev.originalEvent.shiftKey) removeMarker(marker);
      });

      measureMarkers.push(marker);
      updateMeasure();
    }

    // Toggle measure mode on/off
    function toggleMeasureMode() {
      measuring = !measuring;
      const btn = document.querySelector(".custom-measure-btn");
      const info = document.querySelector(".measure-info-control");
      if (measuring) {
        btn.classList.add("active");
        btn.title =
          "Measuring — click map to add points. Shift+click a point to remove it.";
        if (info) info.style.display = "block";
        map.getContainer().style.cursor = "crosshair";
        map.doubleClickZoom.disable();
        // optionally disable dragging so clicks don't move map — improves placement precision
        if (map.dragging) map.dragging.disable();
        map.on("click", onMapClickAddPoint);
      } else {
        btn.classList.remove("active");
        btn.title = "Measure (click to start)";
        if (info) info.style.display = "none";
        map.getContainer().style.cursor = "";
        map.doubleClickZoom.enable();
        if (map.dragging) map.dragging.enable();
        map.off("click", onMapClickAddPoint);
      }
    }

    // Create small information control (Undo/Clear/Finish + total)
    const infoControl = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        const container = L.DomUtil.create(
          "div",
          "measure-info-control leaflet-bar"
        );
        container.innerHTML = `
        <div style="padding:6px 8px; font-size:12px; min-width:160px;">
          <div style="margin-bottom:6px;">Measurement mode<br/><small style="opacity:.8">click points to measure distance</small></div>
          <div style="display:flex; gap:6px; justify-content:space-between; margin-bottom:6px;">
            <button id="measureUndo" class="small-btn">Undo</button>
            <button id="measureClear" class="small-btn">Clear</button>
            <button id="measureFinish" class="small-btn">Finish</button>
          </div>
          <div id="measureTotal" style="font-size:13px; margin-top:4px;"></div>
        </div>
      `;
        // add event listeners
        setTimeout(() => {
          const undo = container.querySelector("#measureUndo");
          const clear = container.querySelector("#measureClear");
          const finish = container.querySelector("#measureFinish");
          if (undo)
            undo.addEventListener("click", (ev) => {
              ev.stopPropagation();
              undoLast();
            });
          if (clear)
            clear.addEventListener("click", (ev) => {
              ev.stopPropagation();
              clearAll();
            });
          if (finish)
            finish.addEventListener("click", (ev) => {
              ev.stopPropagation();
              toggleMeasureMode();
            });
        }, 0);
        container.style.display = "none"; // default hidden until measuring starts
        return container;
      },
    });
    const infoCtrl = new infoControl();
    infoCtrl.addTo(map);

    // Create the toolbar button control
    const measureBtnControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd: function () {
        const wrapper = L.DomUtil.create(
          "div",
          "leaflet-bar leaflet-control custom-measure-control"
        );
        const btn = L.DomUtil.create("a", "custom-measure-btn", wrapper);
        btn.href = "#";
        btn.title = "Measure (click to start)";
        btn.innerHTML = `<i class="fas fa-ruler"></i>`;

        // Hover tooltip
        const tip = L.DomUtil.create("span", "custom-measure-tooltip", wrapper);
        tip.innerText = "Measure distance";
        tip.style.display = "none";

        L.DomEvent.on(
          wrapper,
          "mouseover",
          () => (tip.style.display = "block")
        );
        L.DomEvent.on(wrapper, "mouseout", () => (tip.style.display = "none"));

        L.DomEvent.disableClickPropagation(wrapper);
        L.DomEvent.on(btn, "click", L.DomEvent.preventDefault)
          .on(btn, "click", L.DomEvent.stopPropagation)
          .on(btn, "click", toggleMeasureMode);

        return wrapper;
      },
    });

    map.addControl(new measureBtnControl());
    // expose clearAll to dev console if needed
    return { clearAll };
  }

  // Call this inside your initMapControls() after the locate control etc.
  addCustomMeasureControl(map);

  // Customize the locate control appearance
  const locateButton = document.querySelector(".leaflet-control-locate a");
  if (locateButton) {
    locateButton.innerHTML = '<i class="fas fa-location-arrow"></i>';
    locateButton.title = "Show my location";
  }
}
// Initialize GIS layers
function initializeGisLayers() {
  // Administrative Boundary
  gisLayers.admin = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Basic Map (Districts) of India",
      format: "image/png",
      transparent: true,
      attribution: "Administrative Boundary",
    }
  );

  // Land Use/Land Cover
  gisLayers.lulc = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Landcover-2020",
      format: "image/png",
      transparent: true,
      attribution: "Land Use/Land Cover",
    }
  );

  // Airbase Data
  gisLayers.airbase = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Airports_India",
      format: "image/png",
      transparent: true,
      attribution: "Airport Data",
    }
  );

  // Topographic Contours
  gisLayers.contours = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Contour_india",
      format: "image/png",
      transparent: true,
      attribution: "Topographic Contours",
    }
  );

  // Railway Network
  gisLayers.railway = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Railways",
      format: "image/png",
      transparent: true,
      attribution: "Railway Network",
    }
  );

  // Road Network
  gisLayers.road = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Road_network",
      format: "image/png",
      transparent: true,
      attribution: "Road Network",
    }
  );

  // Police Station
  gisLayers.police = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Police_stations",
      format: "image/png",
      transparent: true,
      attribution: "Police Station",
    }
  );

  // Fire Station
  gisLayers.Fire = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Fire_stations",
      format: "image/png",
      transparent: true,
      attribution: "Fire Station",
    }
  );

  // Religious Places
  gisLayers.religious = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Religious_Places",
      format: "image/png",
      transparent: true,
      attribution: "Religious Places",
    }
  );

  // Energy Plants
  gisLayers.energy = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Energy_plants_IND",
      format: "image/png",
      transparent: true,
      attribution: "EnergyPlants",
    }
  );

  //  Borders
  gisLayers.borders = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Administrative boundary",
      format: "image/png",
      transparent: true,
      attribution: "Country Border",
    }
  );

  // Hydrology
  gisLayers.hydrology = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Waterbodies",
      format: "image/png",
      transparent: true,
      attribution: "Waterbody Layer",
    }
  );

  // Lakes_waterbody Layer
  gisLayers.Lakes = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:Lakes_waterbody",
      format: "image/png",
      transparent: true,
      attribution: "Lakes_River",
    }
  );
  // Highways Layer
  gisLayers.Highways = L.tileLayer.wms(
    "http://192.168.1.30:10011/geoserver/EkVayu/wms",
    {
      layers: "EkVayu:national highway",
      format: "image/png",
      transparent: true,
      attribution: "National Highways",
    }
  );
}

// Add this function to fetch and display legends
async function fetchAndDisplayLegend(layerName, layerKey) {
  const legendContainer = document.getElementById("legendContainer");
  const legendContent = document.getElementById("legendContent");
  const contentWrapper = document.querySelector(".legend-content");
  const collapseArrow = document.querySelector(".collapse-arrow");

  // Ensure legend is expanded when loading new content
  contentWrapper.classList.remove("collapsed");
  collapseArrow.classList.remove("collapsed");

  // Show loading state
  legendContent.innerHTML =
    '<div class="legend-loading">Loading legend...</div>';

  try {
    // Construct WMS GetLegendGraphic request URL
    const legendUrl =
      `http://localhost:8080/geoserver/EkVayu/wms?` +
      `service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&` +
      `width=15&height=15&layer=EkVayu:${encodeURIComponent(layerName)}`;

    // Create legend item
    legendContent.innerHTML = `
      <div class="legend-item">
        <div class="legend-title">${layerKey}</div>
        <img src="${legendUrl}" alt="${layerKey} Legend" class="legend-image" 
             onload="this.style.display='block'" 
             onerror="this.style.display='none'; this.nextElementSibling.style.display='block'">
        <div class="legend-text" style="display: none;">
          No legend available
        </div>
      </div>
    `;
  } catch (error) {
    console.error("Error fetching legend:", error);
    legendContent.innerHTML = `<div class="legend-item">
        <div class="legend-title">${layerKey}</div>
        <div class="legend-error">Could not load legend</div>
      </div>`;
  }
}

// Layer name mapping for legend requests
const layerNames = {
  admin: "Basic Map (Districts) of India",
  lulc: "Landcover-2020",
  airbase: "Airports_India",
  contours: "Contour_india",
  railway: "Railways",
  road: "Road_network",
  police: "Police_stations",
  Fire: "Fire_stations",
  religious: "Religious_Places",
  energy: "Energy_plants_IND",
  borders: "Administrative boundary",
  hydrology: "Waterbodies",
  Lakes: "Lakes_waterbody",
  Highways: "national highway",
};

// Toggle GIS layers with better base map compatibility
function toggleGisLayer() {
  const selectedLayer = document.getElementById("gisLayers").value;
  const legendContainer = document.getElementById("legendContainer");
  const legendContent = document.querySelector(".legend-content");
  const collapseArrow = document.querySelector(".collapse-arrow");

  // Hide legend if no layer is selected
  if (!selectedLayer) {
    legendContainer.style.display = "none";

    // Remove all GIS layers from the map
    Object.keys(gisLayers).forEach((layerKey) => {
      const layer = gisLayers[layerKey];
      if (layer && map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });
    return;
  }

  // Remove all GIS layers first
  Object.keys(gisLayers).forEach((layerKey) => {
    const layer = gisLayers[layerKey];
    if (layer && map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  });

  // Add selected layer if one is chosen
  if (selectedLayer && gisLayers[selectedLayer]) {
    try {
      // Set higher z-index for WMS layers to ensure they appear on top
      const selectedGisLayer = gisLayers[selectedLayer];

      // Add the layer to the map
      map.addLayer(selectedGisLayer);

      // Bring GIS layer to front to ensure visibility
      selectedGisLayer.bringToFront();

      console.log(`Added GIS layer: ${selectedLayer}`);

      // Show legend container and ensure it's expanded
      legendContainer.style.display = "block";
      legendContent.classList.remove("collapsed");
      collapseArrow.classList.remove("collapsed");

      // Fetch and display legend for the selected layer
      if (layerNames[selectedLayer]) {
        fetchAndDisplayLegend(layerNames[selectedLayer], selectedLayer);
      }
    } catch (error) {
      console.error(`Error adding GIS layer ${selectedLayer}:`, error);
      alert(
        `Could not load the ${selectedLayer} layer. Please check if GeoServer is running.`
      );
      legendContainer.style.display = "none";
    }
  }
}
// Fetch full event details by ID
async function fetchEventByIdReturn(id) {
  const res = await fetch(ENDPOINTS.EVENT_BY_ID(id));
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  const data = await res.json();

  if (Array.isArray(data.locations)) {
    return data.locations
      .map((loc) =>
        normalizeRecord({
          event_id: data.event_id,
          event_name: data.event_name,
          event_description: data.event_description,
          severity_level: data.severity_level,
          status: data.status,
          location_name: loc.location_name,
          latitude: loc.lat,
          longitude: loc.lon,
          altitude_m: loc.altitude_m,
          radius_km: loc.radius_km,
          event_time: loc.event_time || data.event_time,
          images: data.images || [],
          audios: data.audios || [],
          videos: data.videos || [],
        })
      )
      .filter(Boolean);
  }
  return [];
}

// Fetch all events with full details
async function fetchAllEventsWithDetails() {
  const summaries = await fetchAllEventsPaginated(ENDPOINTS.ALL_EVENTS);

  const promises = summaries.map(async (ev) => {
    const id = ev.event_id || ev.id;
    if (!id) return [];
    try {
      return await fetchEventByIdReturn(id);
    } catch (err) {
      console.error(`Failed fetching event ${id}:`, err);
      return [];
    }
  });

  const nested = await Promise.all(promises);
  return nested.flat();
}

// HELPERS
function safeFloat(v, fallback = 0) {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : fallback;
}
function safeInt(v, fallback = 1) {
  const i = parseInt(v);
  return Number.isFinite(i) ? i : fallback;
}
function safeDate(v, fallback = new Date(0)) {
  if (!v) return fallback;
  const d = new Date(v);
  return isNaN(d.getTime()) ? fallback : d;
}
function ensureJSONFormat(url) {
  if (!url) return url;
  if (url.includes("format=json")) return url;
  return url + (url.includes("?") ? "&" : "?") + "format=json";
}

function toLatLng(rec) {
  return [rec.latitude, rec.longitude];
}
function toMs(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : null;
}
async function fetchWithJSONCheck(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const ctype = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);
  if (!ctype.includes("application/json"))
    throw new Error(`Expected JSON, got ${ctype}`);
  return res.json();
}

// MEDIA PREVIEW FUNCTIONS
function showMediaPreview(eventId) {
  const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
  const eventRecords = normalized.filter((r) => r.event_id === eventId);

  if (eventRecords.length === 0) return;

  const latestRecord = eventRecords[eventRecords.length - 1];
  const mediaPreview = document.getElementById("mediaPreview");
  const imagePreview = document.getElementById("imagePreview");
  const videoPreview = document.getElementById("videoPreview");
  const audioPreview = document.getElementById("audioPreview");

  // Clear previous previews
  imagePreview.innerHTML = "";
  videoPreview.innerHTML = "";
  audioPreview.innerHTML = "";

  // Show images
  if (latestRecord.images && latestRecord.images.length) {
    latestRecord.images.forEach((img, index) => {
      const imagePath = img.image || img;
      const url = imagePath.startsWith("http")
        ? imagePath
        : `http://192.168.1.30:9008/media/event_images/${imagePath
            .split("/")
            .pop()}`;
      const imgElement = document.createElement("div");
      imgElement.className = "media-item";
      imgElement.innerHTML = `<div class="media-title">Image ${index + 1}</div>
      <img src="${url}" alt="Event Image" onclick="openMediaModal('${url}', 'image')">`;
      imagePreview.appendChild(imgElement);
    });
  }

  // Show videos
  if (latestRecord.videos && latestRecord.videos.length) {
    latestRecord.videos.forEach((vid, index) => {
      const videoPath = vid.video || vid;
      const url = videoPath.startsWith("http")
        ? videoPath
        : `http://192.168.1.30:9008/media/event_videos/${videoPath
            .split("/")
            .pop()}`;
      const videoElement = document.createElement("div");
      videoElement.className = "media-item";
      videoElement.innerHTML = `<div class="media-title">Video ${
        index + 1
      }</div><video controls onclick="event.stopPropagation();">
      <source src="${url}" type="video/mp4">Your browser does not support the video tag.</video>`;
      videoPreview.appendChild(videoElement);
    });
  }

  // Show audio
  if (latestRecord.audios && latestRecord.audios.length) {
    latestRecord.audios.forEach((aud, index) => {
      const audioPath = aud.audio || aud;
      const url = audioPath.startsWith("http")
        ? audioPath
        : `http://192.168.1.30:9008/media/event_audios/${audioPath
            .split("/")
            .pop()}`;
      const audioElement = document.createElement("div");
      audioElement.className = "media-item";
      audioElement.innerHTML = `<div class="media-title">Audio ${
        index + 1
      }</div><audio controls>
      <source src="${url}" type="audio/mpeg">Your browser does not support the audio element.</audio>`;
      audioPreview.appendChild(audioElement);
    });
  }

  // Show media preview section if there's any media
  if (
    latestRecord.images.length ||
    latestRecord.videos.length ||
    latestRecord.audios.length
  ) {
    mediaPreview.style.display = "block";
  } else {
    mediaPreview.style.display = "none";
  }
}

// Modal for larger media preview
function openMediaModal(url, type) {
  const modal = document.createElement("div");
  modal.className = "media-modal";
  modal.onclick = () => document.body.removeChild(modal);

  let content = "";
  if (type === "image") {
    content = `<img src="${url}" alt="Enlarged view">`;
  } else if (type === "video") {
    content = `<video controls autoplay><source src="${url}" type="video/mp4"></video>`;
  }
  modal.innerHTML = `<div class="media-modal-content" onclick="event.stopPropagation()">
  <span class="media-modal-close" onclick="document.body.removeChild(this.parentElement.parentElement)">&times;</span>${content}</div>`;
  document.body.appendChild(modal);
}

// NORMALIZE API RECORD
function normalizeRecord(r) {
  if (!r) return null;
  const lat = r.latitude ?? r.lat ?? r.y;
  const lon = r.longitude ?? r.lon ?? r.lng ?? r.x;
  if (lat == null || lon == null) return null;

  return {
    event_id: String(r.event_id ?? r.id ?? ""),
    event_name: r.event_name ?? "Unknown Event",
    event_description: r.event_description ?? "",
    severity_level: safeInt(r.severity_level ?? 1),
    status: r.status ?? "unknown",
    location_name: r.location_name ?? "",
    latitude: safeFloat(lat, 0),
    longitude: safeFloat(lon, 0),
    altitude_m: safeFloat(r.altitude_m ?? 0),
    radius_km: safeFloat(r.radius_km ?? 0),
    event_time: r.event_time ?? null,
    images: Array.isArray(r.images) ? r.images : [],
    audios: Array.isArray(r.audios) ? r.audios : [],
    videos: Array.isArray(r.videos) ? r.videos : [],
    raw: r,
  };
}

// PAGINATION
async function fetchAllEventsPaginated(apiUrl = ENDPOINTS.ALL_EVENTS) {
  let all = [];
  let next = ensureJSONFormat(apiUrl);
  try {
    while (next) {
      next = ensureJSONFormat(next);
      const page = await fetchWithJSONCheck(next);
      if (Array.isArray(page)) {
        all = all.concat(page);
        break;
      }
      if (page.results && Array.isArray(page.results)) {
        all = all.concat(page.results);
        next = page.next;
      } else if (page.data && Array.isArray(page.data)) {
        all = all.concat(page.data);
        next = page.next ?? null;
      } else {
        if (page.event_id || page.id) all.push(page);
        break;
      }
    }
    return all;
  } catch (err) {
    console.error("fetchAllEventsPaginated error:", err);
    return all;
  }
}

// POPUPS
function shortPopup(p) {
  return `<div class="popup-content">
      <h3>${p.event_name || "Event"}</h3>
      <p><strong>ID:</strong> ${p.event_id || "N/A"}</p>
      <p><strong>Time:</strong> ${
        p.event_time ? new Date(p.event_time).toLocaleString() : "N/A"
      }</p>
      <p><strong>Location:</strong> ${p.location_name || "N/A"}</p>
      <p><strong>Severity:</strong> ${p.severity_level || "N/A"}</p>
      ${mediaLinks(p)}
    </div>`;
}

function detailedPopup(rec) {
  return `<div class="popup-content detailed">
      <h3>${rec.event_name}</h3>
      <p><strong>ID:</strong> ${rec.event_id}</p>
      <p><strong>Description:</strong> ${rec.event_description || "N/A"}</p>
      <p><strong>Time:</strong> ${
        rec.event_time ? new Date(rec.event_time).toLocaleString() : "N/A"
      }</p>
      <p><strong>Coords:</strong> ${rec.latitude.toFixed(
        6
      )}, ${rec.longitude.toFixed(6)}</p>
      <p><strong>Altitude:</strong> ${rec.altitude_m} m</p>
      <p><strong>Radius:</strong> ${rec.radius_km} km</p>
      ${mediaLinks(rec)}</div>`;
}

// MEDIA LINKS GENERATOR
function mediaLinks(rec) {
  if (!rec) return "";
  let html = `<div class="media-container"><strong>Media:</strong><br/>`;

  // Use Django media server URLs
  const baseMediaURL = "http://192.168.1.30:9008/media";

  // Images
  if (rec.images && rec.images.length) {
    rec.images.forEach((img) => {
      // Handle both object format and string format
      const imagePath = img.image || img;
      const url = imagePath.startsWith("http")
        ? imagePath
        : `${baseMediaURL}/event_images/${imagePath.split("/").pop()}`;
      html += `<a href="${url}" target="_blank">📷 Image</a><br/>`;
    });
  }

  // Audios
  if (rec.audios && rec.audios.length) {
    rec.audios.forEach((aud) => {
      // Handle both object format and string format
      const audioPath = aud.audio || aud;
      const url = audioPath.startsWith("http")
        ? audioPath
        : `${baseMediaURL}/event_audios/${audioPath.split("/").pop()}`;
      html += `<a href="${url}" target="_blank">🎵 Audio</a><br/>`;
    });
  }

  // Videos
  if (rec.videos && rec.videos.length) {
    rec.videos.forEach((vid) => {
      // Handle both object format and string format
      const videoPath = vid.video || vid;
      const url = videoPath.startsWith("http")
        ? videoPath
        : `${baseMediaURL}/event_videos/${videoPath.split("/").pop()}`;
      html += `<a href="${url}" target="_blank">🎥 Video</a><br/>`;
    });
  }

  html += `</div>`;
  return html;
}

// RENDERING
function clearMapState() {
  if (pointLayer) pointLayer.clearLayers();
  if (pathLayerGroup) pathLayerGroup.clearLayers();
  Object.keys(animated).forEach((id) => stopAnimation2D(id));
  mapMarkers = {};
  polylines = {};
  animated = {};
}

function renderRecords(records) {
  const normalized = records.map(normalizeRecord).filter(Boolean);
  renderRecords2D(normalized);
}

function renderRecords2D(records) {
  const groups = records.reduce((acc, r) => {
    const id = r.event_id;
    acc[id] = acc[id] || [];
    acc[id].push(r);
    return acc;
  }, {});

  Object.keys(groups).forEach((id) => {
    groups[id].sort((a, b) => safeDate(a.event_time) - safeDate(b.event_time));
  });

  clearMapState();

  const features = [];
  Object.keys(groups).forEach((id) => {
    const arr = groups[id];
    arr.forEach((rec) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [rec.longitude, rec.latitude] },
        properties: { ...rec, _path: arr },
      });
    });

    if (arr.length > 1) {
      const coords = arr.map((r) => [r.latitude, r.longitude]);
      const col = getColorForSeverity(arr[arr.length - 1].severity_level);
      const poly = L.polyline(coords, { color: col, weight: 2, opacity: 0.7 });
      polylines[id] = poly;
      pathLayerGroup.addLayer(poly);
    }
  });

  pointLayer.addData({ type: "FeatureCollection", features });

  pointLayer.eachLayer((layer) => {
    if (!layer?.feature?.properties) return;
    const id = String(layer.feature.properties.event_id);
    if (!mapMarkers[id]) mapMarkers[id] = [];
    mapMarkers[id].push(layer);
  });

  const allLatLngs = features.map((f) => [
    f.geometry.coordinates[1],
    f.geometry.coordinates[0],
  ]);
  if (allLatLngs.length && !selectedEventId) {
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [30, 30] });
  }
}

function getColorForSeverity(sev = 1) {
  const m = { 1: "#2ecc71", 2: "#f1c40f", 3: "#e74c3c" };
  return m[sev] || "#3498db";
}

// CONTROLS
function injectControls() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  // Remove existing controls if any
  const existingControls = document.getElementById("animControls");
  if (existingControls) {
    existingControls.remove();
  }

  const div = document.createElement("div");
  div.id = "animControls";
  div.innerHTML = `
    <h4><i class="fas fa-play-circle"></i> Playback</h4>
    <div class="controls-container">
      <button id="playBtn" title="Play Animation">
        <i class="fas fa-play"></i>
      </button>
      <button id="pauseBtn" title="Pause Animation">
        <i class="fas fa-pause"></i>
      </button>
      <button id="resumeBtn" title="Resume Animation">
        <i class="fas fa-redo"></i>
      </button>
      <button id="stopBtn" title="Stop Animation">
        <i class="fas fa-stop"></i>
      </button>
    </div>
  `;

  // Insert the controls at the beginning of the sidebar
  sidebar.insertBefore(div, sidebar.firstChild);

  // Add event listeners
  document.getElementById("playBtn").addEventListener("click", () => {
    if (!selectedEventId) return alert("Select an event first");
    const markers = mapMarkers[selectedEventId];
    if (markers?.length)
      startAnimation2D(selectedEventId, markers[0].feature.properties._path);
  });

  document.getElementById("pauseBtn").addEventListener("click", () => {
    pauseAnimation2D(selectedEventId);
  });

  document.getElementById("resumeBtn").addEventListener("click", () => {
    resumeAnimation2D(selectedEventId);
  });

  document.getElementById("stopBtn").addEventListener("click", () => {
    stopAnimation2D(selectedEventId);
  });
}

// 2D ANIMATION
function startAnimation2D(eventId, pathRecords) {
  const id = String(eventId);
  stopAnimation2D(id);
  if (!pathRecords?.length) return alert("No path data");

  const markers = mapMarkers[id];
  if (!markers || !markers.length) return alert("No markers for event");
  const mk = markers[0];

  mk.setStyle({
    radius: 10,
    fillColor: "#0000ff",
    color: "#fff",
    weight: 2,
    fillOpacity: 1,
  });

  const pts = pathRecords.map(toLatLng);
  const ts = pathRecords.map((r) => toMs(r.event_time));
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    let dur;
    if (ts[i] && ts[i + 1]) {
      dur = Math.max(250, Math.min(4000, ts[i + 1] - ts[i]));
    } else {
      const R = 6371000;
      const lat1 = (a[0] * Math.PI) / 180,
        lon1 = (a[1] * Math.PI) / 180;
      const lat2 = (b[0] * Math.PI) / 180,
        lon2 = (b[1] * Math.PI) / 180;
      const dLat = lat2 - lat1,
        dLon = lon2 - lon1;
      const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      const dist = 2 * R * Math.asin(Math.sqrt(s));
      dur = Math.max(250, Math.min(4000, (dist / 200) * 1000));
    }
    segs.push({ a, b, dur });
  }

  const progressLine = L.polyline([pts[0]], {
    color: "#0000ff",
    weight: 3,
    opacity: 0.9,
  }).addTo(map);

  animated[id] = {
    marker: mk,
    originalStyle: { ...mk.options },
    progressLine,
    frameId: null,
    paused: false,
    segs,
    segIdx: 0,
    segStart: performance.now(),
    segElapsed: 0,
    recs: pathRecords,
  };

  if (polylines[id])
    polylines[id].setStyle({ color: "#0000ff", weight: 3, opacity: 0.95 });

  function step(now) {
    const st = animated[id];
    if (!st || st.paused) return;

    const seg = st.segs[st.segIdx];
    if (!seg) {
      st.frameId = null;
      return;
    }

    const elapsed = now - st.segStart + st.segElapsed;
    let t = Math.min(1, elapsed / seg.dur);
    const pos = [lerp(seg.a[0], seg.b[0], t), lerp(seg.a[1], seg.b[1], t)];

    mk.setLatLng(pos);

    const latlngs = st.progressLine.getLatLngs();
    if (latlngs.length === st.segIdx + 1)
      latlngs.push(L.latLng(pos[0], pos[1]));
    else latlngs[latlngs.length - 1] = L.latLng(pos[0], pos[1]);
    st.progressLine.setLatLngs(latlngs);

    if (t >= 1) {
      mk.setLatLng(seg.b);
      const rec = st.recs[st.segIdx + 1];
      if (rec) mk.bindPopup(detailedPopup(rec));

      // FLASH intermediate marker
      const targetMarker = markers[st.segIdx + 1];
      if (targetMarker) {
        targetMarker.setStyle({
          radius: 10,
          fillColor: "#ff0000",
          color: "#000",
          weight: 2,
          fillOpacity: 1,
        });
        setTimeout(() => {
          targetMarker.setStyle({
            radius: 6,
            fillColor: getColorForSeverity(rec.severity_level),
            color: "#2c3e50",
            weight: 1,
            fillOpacity: 0.9,
          });
        }, 600);
      }

      st.segIdx += 1;
      st.segStart = now;
      st.segElapsed = 0;
    }

    if (st.segIdx < st.segs.length) st.frameId = requestAnimationFrame(step);
    else st.frameId = null;
  }

  animated[id].frameId = requestAnimationFrame(step);
}

function pauseAnimation2D(eventId) {
  const st = animated[String(eventId)];
  if (!st || st.paused) return;
  st.paused = true;
  if (st.frameId) cancelAnimationFrame(st.frameId);
  st.segElapsed += performance.now() - st.segStart;
}

function resumeAnimation2D(eventId) {
  const st = animated[String(eventId)];
  if (!st || !st.paused) return;
  st.paused = false;
  st.segStart = performance.now();
  st.frameId = requestAnimationFrame((now) =>
    startAnimation2D(eventId, st.recs)
  );
}

function stopAnimation2D(eventId) {
  const id = String(eventId);
  const st = animated[id];
  if (!st) return;
  if (st.frameId) cancelAnimationFrame(st.frameId);
  if (st.progressLine) map.removeLayer(st.progressLine);
  if (st.marker && st.originalStyle) st.marker.setStyle(st.originalStyle);
  delete animated[id];
  if (polylines[id])
    polylines[id].setStyle({
      color: getColorForSeverity(1),
      weight: 2,
      opacity: 0.7,
    });
}

// Helper function for interpolation
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// REFRESH
async function refreshCycle() {
  try {
    const records = await fetchAllEventsWithDetails();
    lastFetchedRecords = records;
    renderRecords(records);
    updateDropdown(records);
  } catch (err) {
    console.error("refreshCycle error:", err);
  }
}

function startAutoRefresh() {
  refreshCycle();
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  refreshIntervalId = setInterval(refreshCycle, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshIntervalId) clearInterval(refreshIntervalId);
}

// DROPDOWN
function updateDropdown(records) {
  const dropdown = document.getElementById("eventDropdown");
  if (!dropdown) return;
  const current = selectedEventId;
  dropdown.innerHTML = `<option value="">-- Select Event --</option>`;

  const normalized = records.map(normalizeRecord).filter(Boolean);
  const groups = normalized.reduce((acc, r) => {
    const id = r.event_id;
    acc[id] = acc[id] || [];
    acc[id].push(r);
    return acc;
  }, {});

  Object.keys(groups).forEach((id) => {
    const arr = groups[id];
    const latest = arr[arr.length - 1];
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${latest.event_name} — ${
      latest.event_time
        ? new Date(latest.event_time).toLocaleString()
        : "no-time"
    } (${arr.length} location${arr.length > 1 ? "s" : ""})`;
    if (current && String(current) === String(id)) opt.selected = true;
    dropdown.appendChild(opt);
  });
}

function attachDropdownListener() {
  const dropdown = document.getElementById("eventDropdown");
  if (!dropdown) return;
  dropdown.addEventListener("change", async (e) => {
    const eid = e.target.value || null;
    selectedEventId = eid;

    // Show media preview for selected event
    if (eid) {
      showMediaPreview(eid);
    } else {
      document.getElementById("mediaPreview").style.display = "none";
    }

    // Stop any running animations
    Object.keys(animated).forEach((id) => {
      if (id !== eid) stopAnimation2D(id);
    });

    if (!eid) {
      const pts = Object.values(mapMarkers)
        .flat()
        .map((m) => m.getLatLng());
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
      return;
    }

    const markers = mapMarkers[eid];
    if (markers?.length && markers[0].feature?.properties?._path) {
      const path = markers[0].feature.properties._path;
      if (path.length) {
        const coords = path.map((r) => [r.latitude, r.longitude]);
        map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
        if (polylines[eid])
          polylines[eid].setStyle({
            color: "#0000ff",
            weight: 3,
            opacity: 0.95,
          });
      }
    } else {
      try {
        const full = await fetchEventByIdReturn(eid);
        if (full.length) {
          const coords = full.map((r) => [r.latitude, r.longitude]);
          map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
        }
      } catch (err) {
        console.error("Failed to fetch full event for dropdown:", err);
      }
    }
  });
}
// Add collapse/expand functionality to legend
function initLegendCollapse() {
  const legendHeader = document.querySelector(".legend-header");
  const legendContent = document.querySelector(".legend-content");
  const collapseArrow = document.querySelector(".collapse-arrow");

  if (legendHeader && legendContent && collapseArrow) {
    legendHeader.addEventListener("click", function () {
      legendContent.classList.toggle("collapsed");
      collapseArrow.classList.toggle("collapsed");
    });
  }
}
// BOOTSTRAP
(async function main() {
  try {
    // Initialize GIS layers first
    initializeGisLayers();

    // Then initialize the map
    initMap();

    // Initialize map controls (location and measurement)
    initMapControls();

    // Initialize map switch functionality
    initMapSwitch();

    // Initialize legend collapse functionality
    initLegendCollapse();

    // Add event listener for GIS layer selection
    document
      .getElementById("gisLayers")
      .addEventListener("change", toggleGisLayer);

    const records = await fetchAllEventsWithDetails();
    lastFetchedRecords = records;
    renderRecords(records);
    updateDropdown(records);
    attachDropdownListener();
    injectControls();
    startAutoRefresh();

    // If URL contained an eventData param, zoom to it
    if (eventData && eventData.event_id) {
      selectedEventId = String(eventData.event_id);
      document.getElementById("eventDropdown").value = selectedEventId;

      const mkArr = mapMarkers[selectedEventId];
      if (mkArr?.length) {
        const path = mkArr[0].feature.properties._path;
        if (path?.length) {
          const coords = path.map((r) => [r.latitude, r.longitude]);
          map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
        }
      }
    }
  } catch (err) {
    console.error("Initialization error:", err);
  }
})();

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  stopAutoRefresh();
  Object.keys(animated).forEach((id) => stopAnimation2D(id));
});
