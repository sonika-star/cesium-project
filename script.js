// Replace with your own token if needed: https://cesium.com/ion/tokens.
Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzNzNkODQxYi0zMGFhLTQ4ZGYtYTUwYy1iM2U0YzQ5MjA0NWYiLCJpZCI6MzMzNzEyLCJpYXQiOjE3NTU2ODY0NDF9.T0Cuo5EdFhNBbp-gtfYXgsXQQ9FCOswiANqDkfIAxRY";

// Map switching variables
let currentMapMode = "3d"; // Start with 3D mode
let leafletMap = null;
let leafletPointLayer = null;
let leafletPathLayerGroup = null;
let leafletMarkers = {};
let leafletPolylines = {};

// Optional event to focus via URL ?eventData
const urlParams = new URLSearchParams(window.location.search);
const eventDataString = urlParams.get("eventData");
const eventData = eventDataString ? JSON.parse(eventDataString) : null;

// CONFIG
// const BASE_API_URL = "http://192.168.1.30:9001/event/event/api";
const BASE_API_URL = "http://192.168.1.30:9008/event/api";
const ENDPOINTS = {
  ALL_EVENTS: `${BASE_API_URL}/events/`,
  EVENT_BY_ID: (id) => `${BASE_API_URL}/events/${id}/full/`,
  EVENT_MEDIA: (id) => `${BASE_API_URL}/events/${id}/media/`,
};
const URL_PARAMS = {
  EVENT_ID: "eventId",
  EVENT_NAME: "eventName",
};
const REFRESH_INTERVAL = 150000; // auto-refresh interval
const ANIMATION_STEP_MS = 70; // ms per step while animating a path

// Cesium viewer instance
let viewer;
let eventEntities = {};
let pathEntities = {};
let animationEntities = {};
let selectedEventId = null;
let refreshIntervalId = null;
let lastFetchedRecords = [];
let animationHandler = null;
let animationState = {
  isPlaying: false,
  isPaused: false,
  currentEventId: null,
};

// New variables for enhanced functionality
let allLocationPoints = {}; // Store all location point entities
let animationTimeline = []; // Store animation timeline
let currentAnimationIndex = 0; // Track current animation position
let pathPositionsByEvent = {};
let activeEventId = null;
let activeAircraftEntity = null;
// Track final rendered full paths (persist until next selection) and
// live trailing (dashed) entities during animation.
let finalPathEntities = {};
let liveTrailEntities = {};
// Track if pan tool is currently enabled so camera tracking doesn't override user panning
let panToolActive = false;

// Aircraft click state for pause/resume functionality
let aircraftClickState = {
  isPaused: false,
  pausedTime: null,
  altitudeLine: null,
  infoPopup: null,
  aircraftPosition: null,
  updateHandler: null,
};

// Screen-space HTML popup element
let aircraftPopupElement = null;

// Initialize Cesium 3D map
function initMap() {
  viewer = new Cesium.Viewer("cesiumContainer", {
    // Use Cesium World Terrain
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

  // Set resolution scale for high-DPI screens to ensure sharp rendering
  viewer.resolutionScale = window.devicePixelRatio;

  // Enable FXAA anti-aliasing for smooth and high-quality visualization
  viewer.scene.postProcessStages.fxaa.enabled = true;

  // Set initial view to India
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 3500000.0),
    orientation: {
      heading: 0.0,
      pitch: -0.6,
      roll: 0.0,
    },
  });

  // Add event handler for entity selection
  viewer.selectedEntityChanged.addEventListener(function () {
    const entity = viewer.selectedEntity;

    // If the animated aircraft model is clicked, pause and show an info popup
    if (entity && entity.id && String(entity.id).startsWith("animation-")) {
      try {
        handleAircraftClick(entity);
      } catch (e) {
        console.error("handleAircraftClick error:", e);
      }
      return;
    }

    // Clear aircraft popup when clicking away / deselecting (but not if clicking on popup itself)
    if (!entity) {
      // Check if click was on the popup element
      const clickedOnPopup =
        aircraftPopupElement &&
        event &&
        event.target &&
        (aircraftPopupElement.contains(event.target) ||
          event.target === aircraftPopupElement);

      if (
        !clickedOnPopup &&
        aircraftClickState.isPaused &&
        animationState.isPlaying
      ) {
        clearAircraftInfoPopup();
        resumeAnimation();
      }
      return;
    }

    if (entity && entity.eventId) {
      selectedEventId = entity.eventId;
      document.getElementById("eventDropdown").value = selectedEventId;

      // Highlight the selected event
      highlightEvent(selectedEventId);

      // Show media preview for selected event
      showMediaPreview(selectedEventId);
    }
  });

  // Add click handler to close popup when clicking outside
  viewer.cesiumWidget.canvas.addEventListener("click", function (event) {
    if (aircraftPopupElement && aircraftClickState.isPaused) {
      // Check if click was outside the popup
      const rect = aircraftPopupElement.getBoundingClientRect();
      const clickX = event.clientX;
      const clickY = event.clientY;

      const clickedOutside =
        clickX < rect.left ||
        clickX > rect.right ||
        clickY < rect.top ||
        clickY > rect.bottom;

      if (clickedOutside) {
        clearAircraftInfoPopup();
        if (animationState.isPlaying) {
          resumeAnimation();
        }
      }
    }
  });
}

// Map switching functionality
function initMapSwitch() {
  const btn2D = document.getElementById("btn2D");
  const btn3D = document.getElementById("btn3D");

  if (!btn2D || !btn3D) {
    console.error("Map view buttons not found!");
    return;
  }

  // Start in 3D mode (3D button is active)
  currentMapMode = "3d";
  btn3D.classList.add("active");
  btn2D.classList.remove("active");

  // Add click event listeners
  btn2D.addEventListener("click", function () {
    if (currentMapMode !== "2d") {
      switchTo2D();
      btn2D.classList.add("active");
      btn3D.classList.remove("active");
    }
  });

  btn3D.addEventListener("click", function () {
    if (currentMapMode !== "3d") {
      switchTo3D();
      btn3D.classList.add("active");
      btn2D.classList.remove("active");
    }
  });

  console.log("Map view buttons initialized");
}

function switchTo2D() {
  if (currentMapMode === "2d") return;

  console.log("Switching to 2D mode...");
  currentMapMode = "2d";

  // Hide 3D map, show 2D map
  document.getElementById("cesiumContainer").style.display = "none";
  document.getElementById("leafletContainer").style.display = "block";

  // Hide zoom controls (only for 3D map)
  const zoomControls = document.querySelector(".zoom-controls");
  if (zoomControls) {
    zoomControls.style.display = "none";
  }

  // Initialize 2D map if not already done
  if (!leafletMap) {
    init2DMap();
  } else {
    // Refresh 2D map size
    setTimeout(() => {
      leafletMap.invalidateSize();
    }, 100);
  }

  // Sync data to 2D map
  if (lastFetchedRecords.length > 0) {
    render2DRecords(lastFetchedRecords);
  }

  // Sync selected event
  if (selectedEventId) {
    highlight2DEvent(selectedEventId);
  }

  // Update impact zones if they were visible
  if (impactZonesVisible) {
    hideImpactZones3D(); // Hide 3D zones
    showImpactZones2D(); // Show 2D zones
  }

  console.log("Switched to 2D mode");
}

function switchTo3D() {
  if (currentMapMode === "3d") return;

  console.log("Switching to 3D mode...");
  currentMapMode = "3d";

  // Hide 2D map, show 3D map
  document.getElementById("leafletContainer").style.display = "none";
  document.getElementById("cesiumContainer").style.display = "block";

  // Show zoom controls (only for 3D map)
  const zoomControls = document.querySelector(".zoom-controls");
  if (zoomControls) {
    zoomControls.style.display = "flex";
  }

  // Refresh 3D map if needed
  if (viewer) {
    viewer.resize();
  }

  // Sync data to 3D map
  if (lastFetchedRecords.length > 0) {
    renderRecords(lastFetchedRecords);
  }

  // Sync selected event
  if (selectedEventId) {
    highlightEvent(selectedEventId);
  }

  // Update impact zones if they were visible
  if (impactZonesVisible) {
    hideImpactZones2D(); // Hide 2D zones
    showImpactZones3D(); // Show 3D zones
  }

  console.log("Switched to 3D mode");
}

// Initialize 2D map
function init2DMap() {
  console.log("Initializing 2D map...");

  // Clear existing map
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }

  // Initialize Leaflet map
  leafletMap = L.map("leafletContainer").setView([20.5937, 78.9629], 5);

  // Add base layers
  const baseLayers = {
    OpenStreetMap: L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: "© OpenStreetMap contributors",
      }
    ),
    Satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
        maxZoom: 18,
      }
    ),
    Topographic: L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 17,
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      }
    ),
  };

  // Add default base layer
  baseLayers["OpenStreetMap"].addTo(leafletMap);

  // Add layer control
  L.control.layers(baseLayers).addTo(leafletMap);

  // Initialize point layer
  leafletPointLayer = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => {
      const sev = feature.properties.severity_level || 1;
      const colorMap = { 1: "#2ecc71", 2: "#f1c40f", 3: "#e74c3c" };
      return L.circleMarker(latlng, {
        radius: 8,
        fillColor: colorMap[sev] || "#3498db",
        color: "#2c3e50",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      }).bindPopup(create2DPopupContent(feature.properties));
    },
  }).addTo(leafletMap);

  leafletPathLayerGroup = L.layerGroup().addTo(leafletMap);

  console.log("2D map initialized");
}

// Render records for 2D map
function render2DRecords(records) {
  if (!leafletMap || currentMapMode !== "2d") return;

  console.log("Rendering 2D records:", records.length);

  // Clear existing layers
  leafletPointLayer.clearLayers();
  leafletPathLayerGroup.clearLayers();
  leafletMarkers = {};
  leafletPolylines = {};

  const normalized = records.map(normalizeRecord).filter(Boolean);
  const groups = normalized.reduce((acc, r) => {
    const id = r.event_id;
    acc[id] = acc[id] || [];
    acc[id].push(r);
    return acc;
  }, {});

  Object.keys(groups).forEach((id) => {
    groups[id].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  });

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
      const poly = L.polyline(coords, { color: col, weight: 3, opacity: 0.7 });
      leafletPolylines[id] = poly;
      leafletPathLayerGroup.addLayer(poly);
    }
  });

  leafletPointLayer.addData({ type: "FeatureCollection", features });

  leafletPointLayer.eachLayer((layer) => {
    if (!layer?.feature?.properties) return;
    const id = String(layer.feature.properties.event_id);
    if (!leafletMarkers[id]) leafletMarkers[id] = [];
    leafletMarkers[id].push(layer);

    // Add click event for marker selection
    layer.on("click", function () {
      selectedEventId = id;
      document.getElementById("eventDropdown").value = selectedEventId;
      highlight2DEvent(selectedEventId);
      showMediaPreview(selectedEventId);
    });
  });

  // Fit bounds to show all events
  const allLatLngs = features.map((f) => [
    f.geometry.coordinates[1],
    f.geometry.coordinates[0],
  ]);
  if (allLatLngs.length && !selectedEventId) {
    leafletMap.fitBounds(L.latLngBounds(allLatLngs), { padding: [30, 30] });
  }
}

// Highlight event in 2D map
function highlight2DEvent(eventId) {
  if (!leafletMap || currentMapMode !== "2d") return;

  // Reset all markers to normal style
  Object.keys(leafletMarkers).forEach((id) => {
    leafletMarkers[id].forEach((marker) => {
      const sev = marker.feature.properties.severity_level || 1;
      const colorMap = { 1: "#2ecc71", 2: "#f1c40f", 3: "#e74c3c" };
      marker.setStyle({
        radius: 8,
        fillColor: colorMap[sev] || "#3498db",
        color: "#2c3e50",
        weight: 2,
        fillOpacity: 0.9,
      });
    });

    if (leafletPolylines[id]) {
      const sev =
        leafletMarkers[id][0]?.feature?.properties?.severity_level || 1;
      leafletPolylines[id].setStyle({
        color: getColorForSeverity(sev),
        weight: 3,
        opacity: 0.7,
      });
    }
  });

  // Highlight selected event
  if (leafletMarkers[eventId]) {
    leafletMarkers[eventId].forEach((marker) => {
      marker.setStyle({
        radius: 12,
        fillColor: "#FFD700",
        color: "#FF6B35",
        weight: 3,
        fillOpacity: 1,
      });
    });

    if (leafletPolylines[eventId]) {
      leafletPolylines[eventId].setStyle({
        color: "#FFD700",
        weight: 5,
        opacity: 1,
      });
    }

    // Zoom to event
    const eventMarkers = leafletMarkers[eventId];
    if (eventMarkers.length > 0) {
      const group = new L.featureGroup(eventMarkers);
      leafletMap.fitBounds(group.getBounds(), { padding: [50, 50] });
    }
  }

  // Update impact zones for the newly selected event
  updateImpactZonesForSelectedEvent();
}

// Create popup content for 2D map
function create2DPopupContent(properties) {
  return `
    <div class="popup-content">
      <h3>${properties.event_name || "Event"}</h3>
      <p><strong>ID:</strong> ${properties.event_id || "N/A"}</p>
      <p><strong>Time:</strong> ${
        properties.event_time
          ? new Date(properties.event_time).toLocaleString()
          : "N/A"
      }</p>
      <p><strong>Location:</strong> ${properties.location_name || "N/A"}</p>
      <p><strong>Coordinates:</strong> ${properties.latitude?.toFixed(
        6
      )}, ${properties.longitude?.toFixed(6)}</p>
      <p><strong>Altitude:</strong> ${properties.altitude_m || 0} m</p>
      <p><strong>Severity:</strong> ${properties.severity_level || "N/A"}</p>
      <p><strong>Status:</strong> ${properties.status || "N/A"}</p>
    </div>
  `;
}

// 2D Animation functions
let leafletAnimated = {};

function startAnimation2D(eventId, pathRecords) {
  console.log(
    "2D Animation - Starting for event:",
    eventId,
    "Records:",
    pathRecords?.length
  );

  const id = String(eventId);
  stopAnimation2D(id);

  if (!pathRecords?.length) {
    console.log("2D Animation - No path data");
    alert("No path data to animate");
    return;
  }

  if (!leafletMarkers[id] || !leafletMarkers[id].length) {
    console.log("2D Animation - No markers found for event:", id);
    alert("No markers found for this event");
    return;
  }

  console.log("2D Animation - Found markers:", leafletMarkers[id].length);

  const marker = leafletMarkers[id][0];

  // Set animation state
  animationState.isPlaying = true;
  animationState.isPaused = false;
  animationState.currentEventId = id;

  // Style the marker for animation
  marker.setStyle({
    radius: 10,
    fillColor: "#0000ff",
    color: "#fff",
    weight: 2,
    fillOpacity: 1,
  });

  // Create animation path points
  const points = pathRecords.map((r) => [r.latitude, r.longitude]);

  // DISTANCE-BASED 2D ANIMATION: Calculate duration based on path distance with minimum segment duration
  let totalDistance = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const distance = leafletMap.distance(
      L.latLng(a[0], a[1]),
      L.latLng(b[0], b[1])
    );
    totalDistance += distance;
  }

  console.log(
    "2D Animation - Total distance:",
    totalDistance,
    "Points:",
    points.length
  );

  const segments = [];

  // Handle case where all points are at the same location (zero distance)
  if (totalDistance === 0) {
    console.log(
      "2D Animation - Zero distance detected, using minimum segment duration"
    );
    // Use minimum duration for each segment when there's no distance
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      segments.push({ start: a, end: b, duration: MIN_SEGMENT_MS });
    }
  } else {
    // Calculate base total animation duration based on constant speed (DISTANCE_SPEED_MPS)
    const baseAnimationDurationMs = Math.max(
      5000,
      (totalDistance / DISTANCE_SPEED_MPS_2D) * 50
    );
    console.log("2D Animation - Base duration:", baseAnimationDurationMs, "ms");

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      // Calculate segment duration based on its distance proportion
      const segmentDistance = leafletMap.distance(
        L.latLng(a[0], a[1]),
        L.latLng(b[0], b[1])
      );
      let segmentDuration =
        (segmentDistance / totalDistance) * baseAnimationDurationMs;

      // Enforce minimum segment duration to prevent too-fast animation for short segments
      segmentDuration = Math.max(MIN_SEGMENT_MS, segmentDuration);

      segments.push({ start: a, end: b, duration: segmentDuration });
    }
  }

  console.log(
    "2D Animation - Segments created:",
    segments.length,
    "First segment duration:",
    segments[0]?.duration
  );

  // Create progress line
  const progressLine = L.polyline([points[0]], {
    color: "#0000ff",
    weight: 4,
    opacity: 0.9,
  }).addTo(leafletMap);

  // Store animation state
  leafletAnimated[id] = {
    marker: marker,
    originalStyle: { ...marker.options },
    progressLine: progressLine,
    segments: segments,
    currentSegment: 0,
    startTime: performance.now(),
    elapsedTime: 0,
    paused: false,
    pathRecords: pathRecords,
    frameId: null,
    speedMultiplier: window.getAnimationSpeed ? window.getAnimationSpeed() : 1,
  };

  // Highlight the path
  if (leafletPolylines[id]) {
    leafletPolylines[id].setStyle({
      color: "#0000ff",
      weight: 4,
      opacity: 0.95,
    });
  }

  // Start animation loop
  function animateStep(currentTime) {
    const animState = leafletAnimated[id];
    if (!animState || animState.paused) {
      console.log("2D Animation - Step skipped, paused or no state");
      return;
    }

    const segment = animState.segments[animState.currentSegment];
    if (!segment) {
      // Animation complete
      console.log("2D Animation - Complete");
      animState.frameId = null;
      animationState.isPlaying = false;
      updateAnimationButtons();
      return;
    }

    const elapsed = currentTime - animState.startTime + animState.elapsedTime;
    const adjustedDuration =
      segment.duration / (animState.speedMultiplier || 1);
    const progress = Math.min(1, elapsed / adjustedDuration);

    console.log(
      "2D Animation - Step:",
      animState.currentSegment,
      "Progress:",
      progress.toFixed(3),
      "Duration:",
      adjustedDuration
    );

    // Interpolate position
    const lat =
      segment.start[0] + (segment.end[0] - segment.start[0]) * progress;
    const lng =
      segment.start[1] + (segment.end[1] - segment.start[1]) * progress;
    const currentPos = [lat, lng];

    // Update marker position
    marker.setLatLng(currentPos);

    // Update progress line
    const lineCoords = animState.progressLine.getLatLngs();
    if (lineCoords.length === animState.currentSegment + 1) {
      lineCoords.push(L.latLng(currentPos[0], currentPos[1]));
    } else {
      lineCoords[lineCoords.length - 1] = L.latLng(
        currentPos[0],
        currentPos[1]
      );
    }
    animState.progressLine.setLatLngs(lineCoords);

    if (progress >= 1) {
      // Move to next segment
      marker.setLatLng(segment.end);

      // Flash the target marker
      const targetMarker = leafletMarkers[id][animState.currentSegment + 1];
      if (targetMarker) {
        const originalStyle = { ...targetMarker.options };
        targetMarker.setStyle({
          radius: 12,
          fillColor: "#ff0000",
          color: "#000",
          weight: 3,
          fillOpacity: 1,
        });

        setTimeout(() => {
          targetMarker.setStyle(originalStyle);
        }, 600);
      }

      animState.currentSegment++;
      animState.startTime = currentTime;
      animState.elapsedTime = 0;
    }

    if (animState.currentSegment < animState.segments.length) {
      animState.frameId = requestAnimationFrame(animateStep);
    } else {
      animState.frameId = null;
      animationState.isPlaying = false;
      updateAnimationButtons();
    }
  }

  leafletAnimated[id].frameId = requestAnimationFrame(animateStep);
  console.log(
    "2D Animation - Started with frameId:",
    leafletAnimated[id].frameId
  );
  updateAnimationButtons();
}

function pauseAnimation2D() {
  const id = animationState.currentEventId;
  if (!id || !leafletAnimated[id]) return;

  const animState = leafletAnimated[id];
  if (animState.paused) return;

  animState.paused = true;
  animationState.isPaused = true;

  if (animState.frameId) {
    cancelAnimationFrame(animState.frameId);
    animState.frameId = null;
  }

  animState.elapsedTime += performance.now() - animState.startTime;
  updateAnimationButtons();
}

function resumeAnimation2D() {
  const id = animationState.currentEventId;
  if (!id || !leafletAnimated[id]) return;

  const animState = leafletAnimated[id];
  if (!animState.paused) return;

  animState.paused = false;
  animationState.isPaused = false;
  animState.startTime = performance.now();

  function animateStep(currentTime) {
    const animState = leafletAnimated[id];
    if (!animState || animState.paused) return;

    const segment = animState.segments[animState.currentSegment];
    if (!segment) {
      animState.frameId = null;
      animationState.isPlaying = false;
      updateAnimationButtons();
      return;
    }

    const elapsed = currentTime - animState.startTime + animState.elapsedTime;
    const adjustedDuration =
      segment.duration / (animState.speedMultiplier || 1);
    const progress = Math.min(1, elapsed / adjustedDuration);

    const lat =
      segment.start[0] + (segment.end[0] - segment.start[0]) * progress;
    const lng =
      segment.start[1] + (segment.end[1] - segment.start[1]) * progress;
    const currentPos = [lat, lng];

    animState.marker.setLatLng(currentPos);

    const lineCoords = animState.progressLine.getLatLngs();
    if (lineCoords.length === animState.currentSegment + 1) {
      lineCoords.push(L.latLng(currentPos[0], currentPos[1]));
    } else {
      lineCoords[lineCoords.length - 1] = L.latLng(
        currentPos[0],
        currentPos[1]
      );
    }
    animState.progressLine.setLatLngs(lineCoords);

    if (progress >= 1) {
      animState.marker.setLatLng(segment.end);

      const targetMarker = leafletMarkers[id][animState.currentSegment + 1];
      if (targetMarker) {
        const originalStyle = { ...targetMarker.options };
        targetMarker.setStyle({
          radius: 12,
          fillColor: "#ff0000",
          color: "#000",
          weight: 3,
          fillOpacity: 1,
        });

        setTimeout(() => {
          targetMarker.setStyle(originalStyle);
        }, 600);
      }

      animState.currentSegment++;
      animState.startTime = currentTime;
      animState.elapsedTime = 0;
    }

    if (animState.currentSegment < animState.segments.length) {
      animState.frameId = requestAnimationFrame(animateStep);
    } else {
      animState.frameId = null;
      animationState.isPlaying = false;
      updateAnimationButtons();
    }
  }

  animState.frameId = requestAnimationFrame(animateStep);
  updateAnimationButtons();
}

function stopAnimation2D() {
  const id = animationState.currentEventId;
  if (!id || !leafletAnimated[id]) return;

  const animState = leafletAnimated[id];

  // Cancel animation frame
  if (animState.frameId) {
    cancelAnimationFrame(animState.frameId);
    animState.frameId = null;
  }

  // Remove progress line
  if (animState.progressLine) {
    leafletMap.removeLayer(animState.progressLine);
  }

  // Restore marker style
  if (animState.marker && animState.originalStyle) {
    animState.marker.setStyle(animState.originalStyle);
  }

  // Restore path style
  if (leafletPolylines[id]) {
    const sev = animState.pathRecords[0]?.severity_level || 1;
    leafletPolylines[id].setStyle({
      color: getColorForSeverity(sev),
      weight: 3,
      opacity: 0.7,
    });
  }

  // Clean up
  delete leafletAnimated[id];

  // Reset animation state
  animationState.isPlaying = false;
  animationState.isPaused = false;
  animationState.currentEventId = null;

  updateAnimationButtons();
}

// Fetch full event details by ID (multi-location flatten)
async function fetchEventByIdReturn(id) {
  try {
    const res = await fetch(ENDPOINTS.EVENT_BY_ID(id));
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();

    // Flatten nested locations if present
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
  } catch (err) {
    console.error(`Failed fetching event ${id}:`, err);
    return [];
  }
}

// Fetch all events with full details (multi-location supported)
async function fetchAllEventsWithDetails() {
  try {
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
  } catch (err) {
    console.error("Failed to fetch events:", err);
    return [];
  }
}

// Fetch media for a specific event
async function fetchEventMedia(eventId) {
  try {
    const res = await fetch(ENDPOINTS.EVENT_MEDIA(eventId));
    if (!res.ok) {
      if (res.status === 404) {
        console.log(`No media endpoint for event ${eventId}, skipping`);
        return [];
      }
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const mediaData = await res.json();
    return mediaData;
  } catch (err) {
    console.error(`Failed fetching media for event ${eventId}:`, err);
    return [];
  }
}

// HELPERS
function safeParseJSON(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
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

// --- Smooth animation config ---
const USE_TIME_BASED_SEGMENTS = false; // use event_time gaps if available
const MIN_SEGMENT_MS = 200; // clamp minimum duration per segment
const MAX_SEGMENT_MS = 4000; // clamp maximum duration per segment
const DISTANCE_SPEED_MPS = 1000; // fallback speed (meters/sec) when no timestamps
// --- 2D animation base speed (separate from 3D) ---
const DISTANCE_SPEED_MPS_2D = 700; // only for 2D animation

function toCartesian(rec) {
  return Cesium.Cartesian3.fromDegrees(
    rec.longitude,
    rec.latitude,
    rec.altitude_m
  );
}

function toLatLng(rec) {
  return [rec.latitude, rec.longitude];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpCartesian(a, b, t) {
  return Cesium.Cartesian3.lerp(a, b, t, new Cesium.Cartesian3());
}

function toMs(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : null;
}

// Haversine (meters)
function haversineMeters(a, b) {
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
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function fetchWithJSONCheck(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const ctype = res.headers.get("content-type") || "";
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `HTTP ${res.status} ${res.statusText} - response body:\n${text}`
    );
  }
  if (!ctype.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Expected JSON but got content-type=${ctype}. Body:\n${text}`
    );
  }
  return res.json();
}

// NORMALIZE API RECORD
function normalizeRecord(r) {
  if (!r) return null;
  const lat = r.latitude ?? r.lat ?? r.y;
  const lon = r.longitude ?? r.longitude ?? r.lon ?? r.lng ?? r.x;
  if (lat == null || lon == null) return null;
  return {
    event_id: String(r.event_id ?? r.id ?? r.pk ?? ""),
    event_name: r.event_name ?? r.name ?? "Unknown Event",
    event_description: r.event_description ?? r.description ?? "",
    severity_level: safeInt(r.severity_level ?? r.severity ?? 1),
    status: r.status ?? "unknown",
    location_name: r.location_name ?? r.location ?? r.place ?? "",
    latitude: safeFloat(lat, 0),
    longitude: safeFloat(lon, 0),
    altitude_m: safeFloat(r.altitude_m ?? r.alt ?? 0),
    radius_km: safeFloat(r.radius_km ?? r.radius ?? 0),
    event_time: r.event_time ?? r.time ?? r.timestamp ?? null,
    images: Array.isArray(r.images) ? r.images : [],
    audios: Array.isArray(r.audios) ? r.audios : [],
    videos: Array.isArray(r.videos) ? r.videos : [],
    raw: r,
  };
}

// PAGINATION-AWARE FETCH
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

// MEDIA LINKS GENERATOR
function mediaLinks(rec) {
  if (!rec) return "";
  let html = `<div class="media-container"><strong>Media:</strong><br/>`;

  // Use Django media server URLs
  const baseMediaURL = "http://192.168.1.25:9008/media";

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
  // Remove all event entities except animation ones
  Object.values(eventEntities).forEach((entity) => {
    if (!entity.isAnimationEntity) {
      viewer.entities.remove(entity);
    }
  });
  eventEntities = {};

  // Remove all path entities
  Object.values(pathEntities).forEach((entity) => {
    viewer.entities.remove(entity);
  });
  pathEntities = {};
  pathPositionsByEvent = {};

  // Clear location points
  allLocationPoints = {};

  // Only remove animation entities if not playing
  if (!animationState.isPlaying) {
    Object.values(animationEntities).forEach((entity) => {
      viewer.entities.remove(entity);
    });
    animationEntities = {};

    // Stop any running animations
    if (animationHandler) {
      viewer.clock.onTick.removeEventListener(animationHandler);
      animationHandler = null;
    }
  }
}

function renderRecords(records) {
  const normalized = records.map(normalizeRecord).filter(Boolean);

  // Render to current map mode
  if (currentMapMode === "2d") {
    render2DRecords(records);
  } else {
    render3DRecords(normalized);
  }
}

function render3DRecords(normalized) {
  const groups = normalized.reduce((acc, r) => {
    const id = r.event_id;
    acc[id] = acc[id] || [];
    acc[id].push(r);
    return acc;
  }, {});

  Object.keys(groups).forEach((id) => {
    groups[id].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  });

  // Clear previous entities but preserve animation if playing
  if (!animationState.isPlaying) {
    clearMapState();
  } else {
    // Only remove non-animation entities
    Object.values(eventEntities).forEach((entity) => {
      if (!entity.isAnimationEntity) {
        viewer.entities.remove(entity);
      }
    });
    Object.values(pathEntities).forEach((entity) => {
      viewer.entities.remove(entity);
    });

    eventEntities = {};
    pathEntities = {};
  }

  // Create entities for each event and all their locations
  Object.keys(groups).forEach((id) => {
    const eventRecords = groups[id];

    // Create points for ALL locations
    eventRecords.forEach((record, index) => {
      const pointId = `event-${id}-${index}`;
      const pointEntity = viewer.entities.add({
        id: pointId,
        eventId: id,
        locationIndex: index,
        name: `${record.event_name} (Location ${index + 1})`,
        position: Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          record.altitude_m
        ),
        point: {
          pixelSize: 8,
          color: getColorForSeverity(record.severity_level),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.NONE,
        },
        label: {
          text: `${record.event_name} #${index + 1}`,
          font: "10pt sans-serif",
          pixelOffset: new Cesium.Cartesian2(0, -20),
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.NONE,
          show: false, // Hide by default, show on highlight
        },
        description: generateEventDescription(record),
      });

      // Store reference to all location points
      if (!allLocationPoints[id]) allLocationPoints[id] = [];
      allLocationPoints[id].push(pointEntity);

      // Also store in eventEntities for general management
      eventEntities[pointId] = pointEntity;
    });

    // Build single source of truth positions array (sorted order already applied)
    const pathPositions = eventRecords.map((record) =>
      Cesium.Cartesian3.fromDegrees(
        record.longitude,
        record.latitude,
        record.altitude_m
      )
    );
    pathPositionsByEvent[id] = pathPositions;

    // Create path if there is at least one location (use same array)
    if (eventRecords.length >= 1) {
      const pathEntity = viewer.entities.add({
        id: `path-${id}`,
        eventId: id,
        polyline: {
          positions: pathPositions,
          width: 3,
          // hide initial solid path; animation will show a dashed trail
          // and final smooth path will be rendered after playback.
          show: false,
          material: getColorForSeverity(
            eventRecords[0].severity_level
          ).withAlpha(0.7),
          clampToGround: false,
          arcType: Cesium.ArcType.NONE, // keep straight segments exactly as provided
        },
      });

      pathEntities[id] = pathEntity;
    }
  });

  // If an event is selected, highlight it
  if (selectedEventId && allLocationPoints[selectedEventId]) {
    highlightEvent(selectedEventId);
  } else if (Object.keys(eventEntities).length > 0) {
    // Zoom to all events if none is selected
    zoomToAllEvents();
  }
}

function getColorForSeverity(sev = 1) {
  const m = {
    1: Cesium.Color.GREEN,
    2: Cesium.Color.YELLOW,
    3: Cesium.Color.RED,
  };
  return m[sev] || Cesium.Color.BLUE;
}

function generateEventDescription(rec) {
  let mediaHtml = "";

  // Check if media exists and has items
  if (
    (rec.images && rec.images.length > 0) ||
    (rec.videos && rec.videos.length > 0) ||
    (rec.audios && rec.audios.length > 0)
  ) {
    mediaHtml =
      '<div class="event-media"><strong>Attachments:</strong><div class="media-container">';

    // Images
    if (rec.images && rec.images.length) {
      rec.images.forEach((img, index) => {
        const imagePath = img.image || img;
        const url = imagePath.startsWith("http")
          ? imagePath
          : `http://192.168.1.30:9008/media/event_images/${imagePath
              .split("/")
              .pop()}`;
        mediaHtml += `<div class="media-item">
          <img src="${url}" alt="Event Image ${
          index + 1
        }" style="max-width: 100%; margin-top: 5px;">
          <div class="media-caption">Image ${index + 1}</div>
        </div>`;
      });
    }

    // Videos
    if (rec.videos && rec.videos.length) {
      rec.videos.forEach((vid, index) => {
        const videoPath = vid.video || vid;
        const url = videoPath.startsWith("http")
          ? videoPath
          : `http://192.168.1.30:9008/media/event_videos/${videoPath
              .split("/")
              .pop()}`;
        mediaHtml += `<div class="media-item">
          <video controls style="max-width: 100%; margin-top: 5px;">
            <source src="${url}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
          <div class="media-caption">Video ${index + 1}</div>
        </div>`;
      });
    }

    // Audios
    if (rec.audios && rec.audios.length) {
      rec.audios.forEach((aud, index) => {
        const audioPath = aud.audio || aud;
        const url = audioPath.startsWith("http")
          ? audioPath
          : `http://192.168.1.30:9008/media/event_audios/${audioPath
              .split("/")
              .pop()}`;
        mediaHtml += `<div class="media-item">
          <audio controls style="width: 100%; margin-top: 5px;">
            <source src="${url}" type="audio/mpeg">
            Your browser does not support the audio element.
          </audio>
          <div class="media-caption">Audio ${index + 1}</div>
        </div>`;
      });
    }

    mediaHtml += "</div></div>";
  }

  return `
    <table class="cesium-infoBox-defaultTable">
      <tbody>
        <tr><td>Event Name</td><td>${rec.event_name}</td></tr>
        <tr><td>ID</td><td>${rec.event_id}</td></tr>
        <tr><td>Description</td><td>${rec.event_description || "N/A"}</td></tr>
        <tr><td>Time</td><td>${
          rec.event_time ? new Date(rec.event_time).toLocaleString() : "N/A"
        }</td></tr>
        <tr><td>Coordinates</td><td>${rec.latitude.toFixed(
          6
        )}, ${rec.longitude.toFixed(6)}</td></tr>
        <tr><td>Altitude</td><td>${rec.altitude_m} m</td></tr>
        <tr><td>Radius</td><td>${rec.radius_km} km</td></tr>
        <tr><td>Severity</td><td><span class="severity-${rec.severity_level}">${
    rec.severity_level
  }</span></td></tr>
        <tr><td>Status</td><td>${rec.status}</td></tr>
        ${mediaHtml ? `<tr><td colspan="2">${mediaHtml}</td></tr>` : ""}
      </tbody>
    </table>
  `;
}

function highlightEvent(eventId) {
  // Highlight in current map mode
  if (currentMapMode === "2d") {
    highlight2DEvent(eventId);
  } else {
    highlight3DEvent(eventId);
  }
}

function highlight3DEvent(eventId) {
  // Reset all events to normal appearance
  Object.keys(allLocationPoints).forEach((id) => {
    allLocationPoints[id].forEach((pointEntity, index) => {
      if (pointEntity.point) {
        pointEntity.point.pixelSize = 6;
        pointEntity.point.color = getColorForSeverity(
          lastFetchedRecords.find((r) => r.event_id === id)?.severity_level || 1
        );
        pointEntity.label.show = false;
      }
    });

    if (pathEntities[id] && pathEntities[id].polyline) {
      pathEntities[id].polyline.width = 2;
      pathEntities[id].polyline.material = getColorForSeverity(
        lastFetchedRecords.find((r) => r.event_id === id)?.severity_level || 1
      ).withAlpha(0.5);
    }
  });

  // Highlight the selected event
  if (allLocationPoints[eventId]) {
    allLocationPoints[eventId].forEach((pointEntity) => {
      if (pointEntity.point) {
        pointEntity.point.pixelSize = 10;
        pointEntity.point.color = Cesium.Color.GOLD;
        pointEntity.label.show = true;
      }
    });

    if (pathEntities[eventId] && pathEntities[eventId].polyline) {
      pathEntities[eventId].polyline.width = 4;
      pathEntities[eventId].polyline.material =
        Cesium.Color.GOLD.withAlpha(0.8);
    }

    // Zoom to the entire event path
    zoomToEvent(eventId);

    // Update event details in sidebar
    updateEventDetails(eventId);

    // Show media preview
    showMediaPreview(eventId);

    // Update impact zones for the newly selected event
    updateImpactZonesForSelectedEvent();
  }
}

function zoomToEvent(eventId) {
  if (allLocationPoints[eventId]) {
    // Get all positions for this event
    const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
    const eventRecords = normalized.filter((r) => r.event_id === eventId);

    if (eventRecords.length > 0) {
      // Create bounding sphere that encompasses all points
      const positions = eventRecords.map((record) =>
        Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          record.altitude_m
        )
      );

      // Calculate bounding sphere
      const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);

      // Fly to the bounding sphere with some padding
      viewer.camera.flyToBoundingSphere(boundingSphere, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(
          0,
          -0.5,
          boundingSphere.radius * 1.5
        ),
      });
    } else {
      // Fallback to just the entity if no records found
      viewer.zoomTo(allLocationPoints[eventId][0]);
    }
  }
}

function zoomToAllEvents() {
  const entities = Object.values(eventEntities).filter(
    (e) => !e.isAnimationEntity
  );
  if (entities.length > 0) {
    viewer.zoomTo(entities);
  }
}

// Add this function to update event details in sidebar
function updateEventDetails(eventId) {
  const eventDetails = document.getElementById("eventDetails");
  const eventMedia = document.getElementById("eventMedia");

  if (!eventId) {
    eventDetails.style.display = "none";
    return;
  }

  // Find the event records
  const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
  const eventRecords = normalized.filter((r) => r.event_id === eventId);

  if (eventRecords.length === 0) {
    eventDetails.style.display = "none";
    return;
  }

  const firstRecord = eventRecords[0];

  // Create HTML for event details
  let detailsHTML = `
    <h4>${firstRecord.event_name}</h4>
    <div class="event-detail-row">
      <span class="event-detail-label">ID:</span>
      <span class="event-detail-value">${firstRecord.event_id}</span>
    </div>
    <div class="event-detail-row">
      <span class="event-detail-label">Locations:</span>
      <span class="event-detail-value">${eventRecords.length}</span>
    </div>
    <div class="event-detail-row">
      <span class="event-detail-label">Severity:</span>
      <span class="event-detail-value severity-${firstRecord.severity_level}">${firstRecord.severity_level}</span>
    </div>
    <div class="event-detail-row">
      <span class="event-detail-label">Status:</span>
      <span class="event-detail-value">${firstRecord.status}</span>
    </div>
  `;

  // Add timeline of locations if multiple exist
  if (eventRecords.length > 1) {
    detailsHTML += `<div class="timeline-container">
      <h5>Location Timeline</h5>`;

    eventRecords.forEach((record, index) => {
      const timeStr = record.event_time
        ? new Date(record.event_time).toLocaleTimeString()
        : "Unknown time";

      detailsHTML += `
        <div class="timeline-event" data-index="${index}">
          <strong>Location ${index + 1}</strong><br>
          <small>${timeStr}</small>
        </div>
      `;
    });

    detailsHTML += `</div>`;
  }

  eventDetails.innerHTML = detailsHTML;
  eventDetails.style.display = "block";

  // Add click handlers for timeline events
  const timelineEvents = eventDetails.querySelectorAll(".timeline-event");
  timelineEvents.forEach((el) => {
    el.addEventListener("click", () => {
      const index = parseInt(el.getAttribute("data-index"));
      flyToLocation(eventId, index);
    });
  });

  // Update media
  updateEventMedia(
    eventId,
    firstRecord.images || [],
    firstRecord.videos || [],
    firstRecord.audios || []
  );
}

// Add this function to update event media
function updateEventMedia(eventId, images, videos, audios) {
  let eventMedia = document.getElementById("eventMedia");
  if (!eventMedia) {
    // If the container is missing (e.g., custom layout), create it so media can render.
    const eventDetails =
      document.getElementById("eventDetails") ||
      document.getElementById("sidebar");
    if (!eventDetails) {
      console.warn("eventMedia container not found in DOM");
      return;
    }
    eventMedia = document.createElement("div");
    eventMedia.id = "eventMedia";
    eventMedia.className = "media-grid";
    eventDetails.appendChild(eventMedia);
  }

  if (
    (!images || images.length === 0) &&
    (!videos || videos.length === 0) &&
    (!audios || audios.length === 0)
  ) {
    eventMedia.innerHTML = "<p>No media available</p>";
    return;
  }

  let mediaHTML = "";

  // Images
  if (images && images.length) {
    images.forEach((img, index) => {
      const imagePath = img.image || img;
      const url = imagePath.startsWith("http")
        ? imagePath
        : `http://192.168.1.30:9008/media/event_images/${imagePath
            .split("/")
            .pop()}`;
      mediaHTML += `
        <div class="media-thumbnail-container" onclick="openMediaModal('${url}', 'image')">
          <img src="${url}" alt="Image ${index + 1}" class="media-thumbnail">
          <div class="media-caption">Image ${index + 1}</div>
        </div>
      `;
    });
  }

  // Videos
  if (videos && videos.length) {
    videos.forEach((vid, index) => {
      const videoPath = vid.video || vid;
      const url = videoPath.startsWith("http")
        ? videoPath
        : `http://192.168.1.30:9008/media/event_videos/${videoPath
            .split("/")
            .pop()}`;
      mediaHTML += `
        <div class="media-thumbnail-container" onclick="openMediaModal('${url}', 'video')">
          <video class="media-thumbnail">
            <source src="${url}" type="video/mp4">
          </video>
          <div class="media-caption">Video ${index + 1}</div>
        </div>
      `;
    });
  }

  eventMedia.innerHTML = mediaHTML;
}

// Add this function to fly to a specific location
function flyToLocation(eventId, locationIndex) {
  if (
    !allLocationPoints[eventId] ||
    !allLocationPoints[eventId][locationIndex]
  ) {
    return;
  }

  const pointEntity = allLocationPoints[eventId][locationIndex];
  const position = pointEntity.position.getValue(Cesium.JulianDate.now());

  viewer.camera.flyTo({
    destination: position,
    duration: 1.0,
    complete: () => {
      // Highlight this specific point
      allLocationPoints[eventId].forEach((entity, idx) => {
        if (entity.point) {
          if (idx === locationIndex) {
            entity.point.pixelSize = 12;
            entity.point.color = Cesium.Color.CYAN;
          } else {
            entity.point.pixelSize = 8;
            entity.point.color = getColorForSeverity(
              lastFetchedRecords.find((r) => r.event_id === eventId)
                ?.severity_level || 1
            );
          }
        }
      });
    },
  });
}

// --- Animation functions for 3D ---
function setCameraFollow(entity) {
  if (!viewer || !entity) return;
  viewer.trackedEntity = entity;
}

function clearCameraFollow() {
  if (!viewer) return;
  viewer.trackedEntity = undefined;
}

function startAnimation(eventId, pathRecords) {
  const id = String(eventId);
  // Enforce single-active animation: stop any current run and reset tracking
  // Clear persisted final paths (we'll render a new final path when done)
  clearFinalPaths();
  // Remove any live trails left over
  clearLiveTrails();
  stopAnimation();

  if (!pathRecords?.length) {
    alert("No path data to animate.");
    return;
  }

  // Sort records by sequence (not by time) for a clean trajectory
  const sorted = [...pathRecords].sort((a, b) => {
    // Use index or sequence number if available, otherwise maintain original order
    return (a.sequence || 0) - (b.sequence || 0);
  });

  // Single source of truth positions array reused for polyline and animation
  let pathPositions = pathPositionsByEvent[id];
  if (!pathPositions || pathPositions.length !== sorted.length) {
    pathPositions = sorted.map((rec) =>
      Cesium.Cartesian3.fromDegrees(rec.longitude, rec.latitude, rec.altitude_m)
    );
    pathPositionsByEvent[id] = pathPositions;
  }

  // DISTANCE-BASED ANIMATION: Calculate duration based on path distance
  let totalDistance = 0;
  for (let i = 0; i < pathPositions.length - 1; i++) {
    const distance = Cesium.Cartesian3.distance(
      pathPositions[i],
      pathPositions[i + 1]
    );
    totalDistance += distance;
  }

  // Calculate animation duration based on constant speed (DISTANCE_SPEED_MPS)
  const animationDurationSeconds = Math.max(
    5,
    totalDistance / DISTANCE_SPEED_MPS
  );
  const startTime = Cesium.JulianDate.now();
  const stopTime = Cesium.JulianDate.addSeconds(
    startTime,
    animationDurationSeconds,
    new Cesium.JulianDate()
  );

  // Create position property with distance-based time distribution
  const positionProperty = new Cesium.SampledPositionProperty();
  let cumulativeDistance = 0;

  pathPositions.forEach((position, index) => {
    let timeOffset = 0;
    if (index > 0) {
      const segmentDistance = Cesium.Cartesian3.distance(
        pathPositions[index - 1],
        position
      );
      cumulativeDistance += segmentDistance;
      timeOffset =
        (cumulativeDistance / totalDistance) * animationDurationSeconds;
    }
    const time = Cesium.JulianDate.addSeconds(
      startTime,
      timeOffset,
      new Cesium.JulianDate()
    );
    positionProperty.addSample(time, position);
  });

  // Use linear interpolation for consistent point-to-point movement
  positionProperty.setInterpolationOptions({
    interpolationDegree: 1,
    interpolationAlgorithm: Cesium.LinearApproximation,
  });

  // Create animation entity (aircraft) using Cesium's built-in orientation helper
  const aircraftEntity = viewer.entities.add({
    id: `animation-${id}`,
    eventId: id,
    isAnimationEntity: true,
    position: positionProperty,
    orientation: new Cesium.VelocityOrientationProperty(positionProperty),
    // Chase-camera offset: behind and slightly above the aircraft
    viewFrom: new Cesium.Cartesian3(-2000, 0, 800),
    model: {
      uri: "models/jf-17_war_thunder.glb",
      // Aggressive size guarantees so the jet is always clearly visible,
      // even when the camera is far away and stable.
      scale: 15.0, // world-scale boost (10–30 is a good range)
      minimumPixelSize: 140, // hard floor on-screen size (80–150 recommended)
      maximumScale: 500, // allow scaling up when close, without clipping
      runAnimations: true,
    },
  });

  // Ensure the displayed polyline uses the exact same positions array
  if (pathEntities[id] && pathEntities[id].polyline) {
    pathEntities[id].polyline.positions = pathPositions;
    pathEntities[id].polyline.clampToGround = false;
    pathEntities[id].polyline.arcType = Cesium.ArcType.NONE;
  }

  animationEntities[id] = aircraftEntity;
  animationState.currentEventId = id;
  activeEventId = id;
  activeAircraftEntity = aircraftEntity;
  animationState.isPlaying = true;
  animationState.isPaused = false;

  // Immediately follow the aircraft with the configured offset
  clearCameraFollow();
  // Only auto-track the aircraft if the pan tool is not active
  if (!panToolActive) {
    setCameraFollow(aircraftEntity);
  }

  // Configure clock with distance-based duration and speed control
  viewer.clock.startTime = startTime.clone();
  viewer.clock.stopTime = stopTime.clone();
  viewer.clock.currentTime = startTime.clone();
  viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;

  // Apply current speed setting (scales the base distance-based speed)
  const currentSpeed = window.getAnimationSpeed
    ? window.getAnimationSpeed()
    : 1;
  viewer.clock.multiplier = currentSpeed;

  // Set the timeline to fit the animation
  if (viewer.timeline) {
    viewer.timeline.zoomTo(startTime, stopTime);
  }

  // Ensure no old tick handler lingers
  if (animationHandler) {
    viewer.clock.onTick.removeEventListener(animationHandler);
    animationHandler = null;
  }

  // Start the animation (model only)
  viewer.clock.shouldAnimate = true;

  // Update button states
  updateAnimationButtons();

  // Hide the static path while animating
  if (pathEntities[id] && pathEntities[id].polyline) {
    try {
      pathEntities[id].polyline.show = false;
    } catch (e) {}
  }

  // Prepare live trail that grows behind the aircraft
  const trailPositions = [];
  const severityLevel = sorted[0]?.severity_level || 1;
  const trailEntity = viewer.entities.add({
    id: `trail-${id}`,
    eventId: id,
    isAnimationEntity: true,
    polyline: {
      positions: new Cesium.CallbackProperty(function () {
        return trailPositions;
      }, false),
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: getColorForSeverity(severityLevel).withAlpha(0.95),
        dashLength: 12,
      }),
      clampToGround: false,
      arcType: Cesium.ArcType.GEODESIC,
    },
  });
  liveTrailEntities[id] = trailEntity;

  // Track progress to highlight nearest waypoint and stop cleanly at the end
  animationHandler = viewer.clock.onTick.addEventListener(function () {
    const currentTime = viewer.clock.currentTime;

    // Grow trail by sampling the aircraft position
    try {
      const curPos = positionProperty.getValue(currentTime);
      if (curPos) {
        const last = trailPositions[trailPositions.length - 1];
        const MIN_TRAIL_SPACING = 4; // meters
        if (
          !last ||
          Cesium.Cartesian3.distance(last, curPos) > MIN_TRAIL_SPACING
        ) {
          trailPositions.push(Cesium.Cartesian3.clone(curPos));
        }
      }
    } catch (e) {}

    // Stop when we reach (or pass) the stop time
    if (Cesium.JulianDate.greaterThanOrEquals(currentTime, stopTime)) {
      // Remove live trail
      try {
        if (liveTrailEntities[id]) {
          viewer.entities.remove(liveTrailEntities[id]);
          delete liveTrailEntities[id];
        }
      } catch (e) {}

      // Render final complete path through all waypoints and keep it visible until next selection
      try {
        // Create a final path that goes through ALL event points in sequence
        // Use all pathPositions to show the complete flight path
        let finalPositions;
        if (pathPositions && pathPositions.length >= 1) {
          // Use ALL positions to show complete path through every event point
          finalPositions = [...pathPositions]; // Copy all positions
        } else {
          finalPositions = [];
        }
        const finalEntity = viewer.entities.add({
          id: `finalPath-${id}`,
          eventId: id,
          polyline: {
            positions: finalPositions,
            width: 4,
            material: new Cesium.PolylineDashMaterialProperty({
              color: getColorForSeverity(severityLevel).withAlpha(0.95),
              dashLength: 12,
            }),
            // Use ArcType.NONE so the polyline uses the provided Cartesian3 positions directly
            // and shows the complete path through all waypoints
            clampToGround: false,
            arcType: Cesium.ArcType.NONE,
          },
        });
        finalPathEntities[id] = finalEntity;
      } catch (e) {
        console.error("finalize path error", e);
      }

      // Stop the clock and set currentTime to stopTime so the aircraft remains
      // at the final position without looping back.
      try {
        viewer.clock.shouldAnimate = false;
        viewer.clock.currentTime = stopTime.clone();
      } catch (e) {}

      // Remove the tick handler to prevent repeated finalization.
      try {
        if (animationHandler) {
          viewer.clock.onTick.removeEventListener(animationHandler);
          animationHandler = null;
        }
      } catch (e) {}

      clearCameraFollow();
      animationState.isPlaying = false;
      updateAnimationButtons();
    }

    // Simple waypoint highlighting based on animation progress
    if (allLocationPoints[id]) {
      const totalDuration = Cesium.JulianDate.secondsDifference(
        stopTime,
        startTime
      );
      const elapsed = Cesium.JulianDate.secondsDifference(
        currentTime,
        startTime
      );
      const progress = Math.max(0, Math.min(1, elapsed / totalDuration));
      const closestIndex = Math.round(progress * (pathPositions.length - 1));

      allLocationPoints[id].forEach((pointEntity, index) => {
        if (pointEntity.point) {
          if (index === closestIndex) {
            pointEntity.point.pixelSize = 12;
            pointEntity.point.color = Cesium.Color.CYAN;
          } else {
            pointEntity.point.pixelSize = 8;
            pointEntity.point.color = getColorForSeverity(
              lastFetchedRecords.find((r) => r.event_id === id)
                ?.severity_level || 1
            );
          }
        }
      });
    }
  });
}

function getInterpolatedPosition(time, positions, times) {
  // Find the segment that contains the current time
  for (let i = 0; i < times.length - 1; i++) {
    if (
      Cesium.JulianDate.lessThanOrEquals(times[i], time) &&
      Cesium.JulianDate.lessThanOrEquals(time, times[i + 1])
    ) {
      const t =
        Cesium.JulianDate.secondsDifference(time, times[i]) /
        Cesium.JulianDate.secondsDifference(times[i + 1], times[i]);

      return Cesium.Cartesian3.lerp(
        positions[i],
        positions[i + 1],
        t,
        new Cesium.Cartesian3()
      );
    }
  }

  // If time is outside the range, return the first or last position
  if (Cesium.JulianDate.lessThan(time, times[0])) {
    return positions[0];
  } else {
    return positions[positions.length - 1];
  }
}

function getOrientation(time, positions, times) {
  // Find the current segment for orientation calculation
  for (let i = 0; i < times.length - 1; i++) {
    if (
      Cesium.JulianDate.lessThanOrEquals(times[i], time) &&
      Cesium.JulianDate.lessThanOrEquals(time, times[i + 1])
    ) {
      // Calculate direction vector
      const direction = Cesium.Cartesian3.subtract(
        positions[i + 1],
        positions[i],
        new Cesium.Cartesian3()
      );

      // Normalize the direction vector
      Cesium.Cartesian3.normalize(direction, direction);

      // Calculate orientation using heading, pitch and roll
      const heading = Math.atan2(direction.y, direction.x);
      const pitch = Math.asin(direction.z);

      return Cesium.Transforms.headingPitchRollQuaternion(
        positions[i],
        new Cesium.HeadingPitchRoll(heading, pitch, 0)
      );
    }
  }

  return Cesium.Quaternion.IDENTITY;
}

// Densify positions along geodesic segments to produce a smooth curved line
function densifyPositions(positions, minSpacing = 8) {
  if (!positions || positions.length < 2) return positions.slice();
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const out = [];
  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    const cartoA = ellipsoid.cartesianToCartographic(a);
    const cartoB = ellipsoid.cartesianToCartographic(b);
    const geodesic = new Cesium.EllipsoidGeodesic(cartoA, cartoB);
    const surfaceDistance = geodesic.surfaceDistance || 0;
    const num = Math.max(2, Math.ceil(surfaceDistance / minSpacing));
    for (let j = 0; j < num; j++) {
      const frac = j / num;
      const interpCarto = geodesic.interpolateUsingFraction(
        frac,
        new Cesium.Cartographic()
      );
      out.push(ellipsoid.cartographicToCartesian(interpCarto));
    }
  }
  out.push(positions[positions.length - 1]);
  return out;
}

function clearAircraftInfoPopup() {
  // Remove HTML popup element
  if (aircraftPopupElement) {
    try {
      aircraftPopupElement.remove();
    } catch (e) {}
    aircraftPopupElement = null;
  }

  // Clear any altitude line if it exists
  if (aircraftClickState.altitudeLine && viewer) {
    try {
      viewer.entities.remove(aircraftClickState.altitudeLine);
    } catch (e) {}
    aircraftClickState.altitudeLine = null;
  }

  // Remove update handler for popup positioning
  if (aircraftClickState.updateHandler && viewer) {
    try {
      viewer.scene.preRender.removeEventListener(
        aircraftClickState.updateHandler
      );
    } catch (e) {}
    aircraftClickState.updateHandler = null;
  }

  // Clear stored position
  aircraftClickState.aircraftPosition = null;
}

function handleAircraftClick(entity) {
  if (!viewer || !entity || !entity.position) return;

  // Pause the animation immediately
  pauseAnimation();

  // Store the paused state
  aircraftClickState.isPaused = true;
  aircraftClickState.pausedTime = viewer.clock.currentTime.clone();
  aircraftClickState.currentAircraftEntity = entity;

  // Compute current aircraft position at click time
  const currentTime = viewer.clock.currentTime;
  let pos;
  try {
    pos = entity.position.getValue(currentTime);
  } catch (e) {
    pos = null;
  }
  if (!pos) return;

  // Store aircraft position for continuous updates
  aircraftClickState.aircraftPosition = pos;

  // Calculate real-time aircraft data
  calculateAircraftData(pos);

  // Create thin yellow altitude line from terrain to aircraft (exactly like reference)
  createAltitudeLine(pos);

  // Create screen-space HTML popup (exactly like reference)
  createAircraftInfoPopup();

  // Setup continuous updates for real-time positioning
  setupAircraftPopupUpdates();
}

// Calculate real-time aircraft data from current position
function calculateAircraftData(position) {
  const cartographic = Cesium.Cartographic.fromCartesian(position);

  // Get terrain height from Cesium terrain
  let terrainHeight = 0;
  try {
    if (viewer.scene && viewer.scene.globe) {
      const height = viewer.scene.globe.getHeight(cartographic);
      if (Cesium.defined(height)) {
        terrainHeight = height;
      }
    }
  } catch (e) {
    console.warn("Error getting terrain height:", e);
  }

  // Calculate values
  const altitudeMSL = cartographic.height || 0;
  const agl = altitudeMSL - terrainHeight;
  const latitude = Cesium.Math.toDegrees(cartographic.latitude);
  const longitude = Cesium.Math.toDegrees(cartographic.longitude);

  // Store in state for popup updates
  aircraftClickState.terrainHeight = Number.isFinite(terrainHeight)
    ? terrainHeight
    : 0;
  aircraftClickState.altitudeMSL = Number.isFinite(altitudeMSL)
    ? altitudeMSL
    : 0;
  aircraftClickState.agl = Number.isFinite(agl) ? agl : 0;
  aircraftClickState.latitude = Number.isFinite(latitude) ? latitude : 0;
  aircraftClickState.longitude = Number.isFinite(longitude) ? longitude : 0;
}

// Create thin yellow altitude line (exactly like reference image)
function createAltitudeLine(aircraftPosition) {
  // Remove existing line
  if (aircraftClickState.altitudeLine && viewer) {
    try {
      viewer.entities.remove(aircraftClickState.altitudeLine);
    } catch (e) {}
    aircraftClickState.altitudeLine = null;
  }

  const cartographic = Cesium.Cartographic.fromCartesian(aircraftPosition);

  // Create terrain position
  const terrainPosition = Cesium.Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    aircraftClickState.terrainHeight
  );

  // Create thin altitude line (thickness 1.5, exactly like reference)
  aircraftClickState.altitudeLine = viewer.entities.add({
    id: "aircraft-altitude-line",
    isAnimationEntity: true,
    polyline: {
      positions: [terrainPosition, aircraftPosition],
      width: 1.5, // Thin smooth line as specified
      material: Cesium.Color.WHITE, // White line for better visibility
      clampToGround: false,
      arcType: Cesium.ArcType.NONE,
    },
  });
}

// Create screen-space HTML popup (exactly like reference image)
function createAircraftInfoPopup() {
  // Remove existing popup
  if (aircraftPopupElement) {
    try {
      aircraftPopupElement.remove();
    } catch (e) {}
    aircraftPopupElement = null;
  }

  // Create popup element
  aircraftPopupElement = document.createElement("div");
  aircraftPopupElement.id = "aircraftInfoPopup";
  aircraftPopupElement.className = "aircraft-popup";
  aircraftPopupElement.style.display = "none"; // Initially hidden

  // Create popup content exactly like reference image
  updateAircraftPopupContent();

  // Add to DOM
  document.body.appendChild(aircraftPopupElement);

  // Position popup above aircraft
  updateAircraftPopupPosition();
}

// Update popup content with real-time data (exactly like reference format)
function updateAircraftPopupContent() {
  if (!aircraftPopupElement) return;

  // Format exactly like reference image with close button
  aircraftPopupElement.innerHTML = `
    <div class="popup-content">
      <button class="popup-close" onclick="window.closeAircraftPopup()">&times;</button>
      <div class="info-line">Lat: ${aircraftClickState.latitude.toFixed(6)}</div>
      <div class="info-line">Lon: ${aircraftClickState.longitude.toFixed(6)}</div>
      <div class="info-line">Terrain: ${aircraftClickState.terrainHeight.toFixed(1)} m</div>
      <div class="info-line">Altitude (MSL): ${aircraftClickState.altitudeMSL.toFixed(1)} m</div>
      <div class="info-line">AGL: ${aircraftClickState.agl.toFixed(1)} m</div>
    </div>
  `;
}

// Setup continuous updates for popup positioning and data
function setupAircraftPopupUpdates() {
  // Remove existing handler
  if (aircraftClickState.updateHandler && viewer) {
    try {
      viewer.scene.preRender.removeEventListener(
        aircraftClickState.updateHandler
      );
    } catch (e) {}
  }

  // Create update handler for real-time positioning
  aircraftClickState.updateHandler = function () {
    if (
      !aircraftClickState.isPaused ||
      !aircraftPopupElement ||
      !aircraftClickState.currentAircraftEntity
    ) {
      return;
    }

    try {
      // Get current aircraft position (real-time)
      const currentTime =
        aircraftClickState.pausedTime || viewer.clock.currentTime;
      const position =
        aircraftClickState.currentAircraftEntity.position.getValue(currentTime);

      if (position) {
        // Update stored position
        aircraftClickState.aircraftPosition = position;

        // Recalculate data in real-time
        calculateAircraftData(position);

        // Update popup content
        updateAircraftPopupContent();

        // Update popup position
        updateAircraftPopupPosition();

        // Update altitude line
        updateAltitudeLinePosition(position);
      }
    } catch (e) {
      console.warn("Error in aircraft popup update:", e);
    }
  };

  // Add handler
  viewer.scene.preRender.addEventListener(aircraftClickState.updateHandler);
}

// Update popup position using SceneTransforms (exactly as specified)
function updateAircraftPopupPosition() {
  if (
    !aircraftPopupElement ||
    !aircraftClickState.aircraftPosition ||
    !viewer
  ) {
    return;
  }

  try {
    // Convert 3D world position to screen coordinates
    const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      viewer.scene,
      aircraftClickState.aircraftPosition
    );

    if (screenPosition) {
      // Get popup dimensions
      const popupWidth = aircraftPopupElement.offsetWidth || 200;
      const popupHeight = aircraftPopupElement.offsetHeight || 120;

      // Position above aircraft (exactly like reference image)
      let left = screenPosition.x - popupWidth / 2;
      let top = screenPosition.y - popupHeight - 40; // 40px above aircraft

      // Keep within viewport bounds
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < 10) left = 10;
      if (left + popupWidth > viewportWidth - 10)
        left = viewportWidth - popupWidth - 10;
      if (top < 10) top = screenPosition.y + 40; // Show below if no room above
      if (top + popupHeight > viewportHeight - 10)
        top = viewportHeight - popupHeight - 10;

      // Use integer pixel values for sharp rendering
      aircraftPopupElement.style.left = Math.round(left) + "px";
      aircraftPopupElement.style.top = Math.round(top) + "px";
      aircraftPopupElement.style.display = "block";
    } else {
      // Hide if aircraft not visible
      aircraftPopupElement.style.display = "none";
    }
  } catch (e) {
    console.warn("Error updating aircraft popup position:", e);
  }
}

// Update altitude line position in real-time
function updateAltitudeLinePosition(aircraftPosition) {
  if (!aircraftClickState.altitudeLine || !viewer) return;

  try {
    const cartographic = Cesium.Cartographic.fromCartesian(aircraftPosition);
    const terrainPosition = Cesium.Cartesian3.fromRadians(
      cartographic.longitude,
      cartographic.latitude,
      aircraftClickState.terrainHeight
    );

    // Update line positions
    aircraftClickState.altitudeLine.polyline.positions = [
      terrainPosition,
      aircraftPosition,
    ];
  } catch (e) {
    console.warn("Error updating altitude line:", e);
  }
}

function createAircraftPopup(lat, lon, terrainHeight, altitudeMSL, agl) {
  // Remove any existing popup
  if (aircraftPopupElement) {
    aircraftPopupElement.remove();
  }

  // Create HTML popup element
  aircraftPopupElement = document.createElement("div");
  aircraftPopupElement.id = "aircraftPopup";
  aircraftPopupElement.className = "aircraft-popup";
  aircraftPopupElement.style.display = "none"; // Initially hidden until positioned

  // Create popup content with sharp, clear text
  aircraftPopupElement.innerHTML = `
    <div class="popup-content">
      <button class="popup-close" onclick="window.closeAircraftPopup()">&times;</button>
      <h3>Aircraft Information</h3>
      <pre>Lat: ${lat.toFixed(6)}
Lon: ${lon.toFixed(6)}
Terrain: ${terrainHeight.toFixed(1)} m
Altitude (MSL): ${altitudeMSL.toFixed(1)} m
AGL: ${agl.toFixed(1)} m</pre>
    </div>
  `;

  // Add to DOM
  document.body.appendChild(aircraftPopupElement);

  // Position the popup and make it visible
  updateAircraftPopupPosition();

  // Set up continuous position updates
  aircraftClickState.updateHandler = function () {
    updateAircraftPopupPosition();
  };

  viewer.scene.preRender.addEventListener(aircraftClickState.updateHandler);
}

function updateAircraftPopupPosition() {
  if (
    !aircraftPopupElement ||
    !aircraftClickState.aircraftPosition ||
    !viewer
  ) {
    return;
  }

  try {
    // Convert 3D world position to screen coordinates
    const screenPosition = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      viewer.scene,
      aircraftClickState.aircraftPosition
    );

    if (screenPosition) {
      // Position popup above the aircraft
      const popupWidth = aircraftPopupElement.offsetWidth || 220;
      const popupHeight = aircraftPopupElement.offsetHeight || 120;

      let left = screenPosition.x - popupWidth / 2;
      let top = screenPosition.y - popupHeight - 20; // 20px above aircraft

      // Keep popup within viewport bounds
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < 10) left = 10;
      if (left + popupWidth > viewportWidth - 10)
        left = viewportWidth - popupWidth - 10;
      if (top < 10) top = screenPosition.y + 20; // Show below if no room above
      if (top + popupHeight > viewportHeight - 10)
        top = viewportHeight - popupHeight - 10;

      // Use integer pixel values to avoid sub-pixel blur
      aircraftPopupElement.style.left = Math.round(left) + "px";
      aircraftPopupElement.style.top = Math.round(top) + "px";
      aircraftPopupElement.style.display = "block";
    } else {
      // Hide popup if aircraft is not visible
      aircraftPopupElement.style.display = "none";
    }
  } catch (e) {
    console.warn("Error updating aircraft popup position:", e);
  }
}

// Global function to close aircraft popup (called from HTML)
window.closeAircraftPopup = function () {
  clearAircraftInfoPopup();
  if (aircraftClickState.isPaused && animationState.isPlaying) {
    resumeAnimation();
  }
};

function clearFinalPaths() {
  try {
    Object.keys(finalPathEntities).forEach((k) => {
      try {
        viewer.entities.remove(finalPathEntities[k]);
      } catch (e) {}
    });
  } catch (e) {}
  finalPathEntities = {};
}

function clearLiveTrails() {
  try {
    Object.keys(liveTrailEntities).forEach((k) => {
      try {
        viewer.entities.remove(liveTrailEntities[k]);
      } catch (e) {}
    });
  } catch (e) {}
  liveTrailEntities = {};
}

function pauseAnimation() {
  if (animationState.isPlaying && !animationState.isPaused) {
    viewer.clock.shouldAnimate = false;
    animationState.isPaused = true;
    updateAnimationButtons();
  }
}

function resumeAnimation() {
  if (animationState.isPlaying && animationState.isPaused) {
    viewer.clock.shouldAnimate = true;
    animationState.isPaused = false;

    // Clear aircraft click state
    aircraftClickState.isPaused = false;
    aircraftClickState.pausedTime = null;

    // Hide any aircraft info popup and altitude line when resuming flight
    clearAircraftInfoPopup();

    updateAnimationButtons();
  }
}

function stopAnimation() {
  const id = animationState.currentEventId;
  if (id && animationEntities[id]) {
    viewer.entities.remove(animationEntities[id]);
    delete animationEntities[id];
  }
  // Remove any live dotted trail entities left from animations
  try {
    Object.keys(liveTrailEntities).forEach((tid) => {
      const tEnt = liveTrailEntities[tid];
      if (tEnt) {
        try {
          viewer.entities.remove(tEnt);
        } catch (e) {}
      }
      delete liveTrailEntities[tid];
    });
  } catch (e) {}

  clearCameraFollow();
  activeAircraftEntity = null;
  activeEventId = null;

  // Clear aircraft click state and popup
  aircraftClickState.isPaused = false;
  aircraftClickState.pausedTime = null;
  clearAircraftInfoPopup();

  if (animationHandler) {
    viewer.clock.onTick.removeEventListener(animationHandler);
    animationHandler = null;
  }

  viewer.clock.shouldAnimate = false;
  viewer.clock.multiplier = 1;
  viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
  if (viewer.clock.startTime) {
    viewer.clock.currentTime = viewer.clock.startTime.clone();
  }

  animationState.isPlaying = false;
  animationState.isPaused = false;
  animationState.currentEventId = null;

  updateAnimationButtons();
}

function updateAnimationButtons() {
  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const stopBtn = document.getElementById("stopBtn");

  if (animationState.isPlaying) {
    playBtn.disabled = true;
    stopBtn.disabled = false;

    if (animationState.isPaused) {
      pauseBtn.disabled = true;
      resumeBtn.disabled = false;
    } else {
      pauseBtn.disabled = false;
      resumeBtn.disabled = true;
    }
  } else {
    playBtn.disabled = !selectedEventId;
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    stopBtn.disabled = true;
  }
}

// --- REFRESH CYCLE ---
async function refreshCycle() {
  try {
    const records = await fetchAllEventsWithDetails();
    lastFetchedRecords = records;

    // Get unique event IDs
    const eventIds = [...new Set(records.map((r) => r.event_id))];

    // Fetch media for all events in parallel
    const mediaPromises = eventIds.map((id) => fetchEventMedia(id));
    const mediaResults = await Promise.all(mediaPromises);

    // Create a media map for easy lookup
    const mediaMap = {};
    mediaResults.forEach((media, index) => {
      if (media && media.length > 0) {
        mediaMap[eventIds[index]] = media;
      }
    });

    // Add media to records
    records.forEach((record) => {
      if (mediaMap[record.event_id]) {
        // Merge the fetched media with existing media
        record.images = [
          ...(record.images || []),
          ...(mediaMap[record.event_id].images || []),
        ];
        record.videos = [
          ...(record.videos || []),
          ...(mediaMap[record.event_id].videos || []),
        ];
        record.audios = [
          ...(record.audios || []),
          ...(mediaMap[record.event_id].audios || []),
        ];
      }
    });

    renderRecords(records);
    updateDropdown(records);

    if (selectedEventId && allLocationPoints[selectedEventId]) {
      highlightEvent(selectedEventId);
    }

    // Update animation button states
    updateAnimationButtons();
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

// --- DROPDOWN ---
function setEventInURL(eventId, eventName) {
  const url = new URL(window.location.href);
  if (eventId && eventName) {
    url.searchParams.set(URL_PARAMS.EVENT_ID, eventId);
    url.searchParams.set(URL_PARAMS.EVENT_NAME, eventName);
  } else {
    url.searchParams.delete(URL_PARAMS.EVENT_ID);
    url.searchParams.delete(URL_PARAMS.EVENT_NAME);
  }
  window.history.replaceState({}, "", url.toString());
}

function getEventFromURL() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get(URL_PARAMS.EVENT_ID);
  const eventName = params.get(URL_PARAMS.EVENT_NAME);
  if (eventId && eventName) {
    return { eventId: String(eventId), eventName };
  }
  return null;
}

function autoSelectEventOnLoad(records) {
  const fromUrl = getEventFromURL();
  if (!fromUrl) return;

  const { eventId } = fromUrl;
  const normalized = records.map(normalizeRecord).filter(Boolean);
  const exists = normalized.some((r) => String(r.event_id) === String(eventId));
  if (!exists) return;

  selectedEventId = String(eventId);
  const dropdown = document.getElementById("eventDropdown");
  if (dropdown) {
    dropdown.value = selectedEventId;
  }

  showMediaPreview(selectedEventId);
  highlightEvent(selectedEventId);
  updateAnimationButtons();
}

function updateDropdown(records) {
  const dropdown = document.getElementById("eventDropdown");
  if (!dropdown) return;
  const current = selectedEventId;
  dropdown.innerHTML = `<option value="">-- Select Event --</option>`;

  // normalize & group
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

  // Update animation button states
  updateAnimationButtons();
}

function attachDropdownListener() {
  const dropdown = document.getElementById("eventDropdown");
  if (!dropdown) return;
  dropdown.addEventListener("change", async (e) => {
    const eid = e.target.value || null;

    selectedEventId = eid;
    const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
    const matched = normalized.find((r) => String(r.event_id) === String(eid));
    const evName = matched?.event_name || "";

    // Show media preview for selected event
    if (eid) {
      setEventInURL(eid, evName);
      showMediaPreview(eid);
    } else {
      setEventInURL(null, null);
      document.getElementById("mediaPreview").style.display = "none";
    }

    // Stop any running animations
    stopAnimation();
    // Clear previously rendered final paths when a new event is selected
    clearFinalPaths();

    if (!eid) {
      zoomToAllEvents();
      return;
    }

    highlightEvent(selectedEventId);
  });
}

// Setup animation controls
function setupAnimationControls() {
  document.getElementById("playBtn").addEventListener("click", () => {
    if (!selectedEventId) return alert("Select an event first");

    // Enforce single-active rule: stop any current animation before starting another
    if (animationState.isPlaying && animationState.currentEventId) {
      if (currentMapMode === "2d") {
        stopAnimation2D();
      } else {
        stopAnimation();
      }
    }

    // Get the path records for this event
    const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
    const groups = normalized.reduce((acc, r) => {
      const id = r.event_id;
      acc[id] = acc[id] || [];
      acc[id].push(r);
      return acc;
    }, {});

    if (groups[selectedEventId]) {
      if (currentMapMode === "2d") {
        startAnimation2D(selectedEventId, groups[selectedEventId]);
      } else {
        startAnimation(selectedEventId, groups[selectedEventId]);
      }
    }
  });

  document.getElementById("pauseBtn").addEventListener("click", () => {
    if (currentMapMode === "2d") {
      pauseAnimation2D();
    } else {
      pauseAnimation();
    }
  });

  document.getElementById("resumeBtn").addEventListener("click", () => {
    if (currentMapMode === "2d") {
      resumeAnimation2D();
    } else {
      resumeAnimation();
    }
  });

  document.getElementById("stopBtn").addEventListener("click", () => {
    if (currentMapMode === "2d") {
      stopAnimation2D();
    } else {
      stopAnimation();
    }
  });

  // Initialize button states
  updateAnimationButtons();

  // Setup speed control
  setupSpeedControl();
}

// Speed control functionality
function setupSpeedControl() {
  const speedSlider = document.getElementById("speedSlider");
  const speedValueLabel = document.getElementById("speedValueLabel");

  if (!speedSlider || !speedValueLabel) {
    console.warn("Speed control elements not found");
    return;
  }

  // Initialize speed value
  let currentSpeed = parseInt(speedSlider.value);
  speedValueLabel.textContent = `Speed: ${currentSpeed}x`;

  // Handle speed slider changes
  speedSlider.addEventListener("input", function () {
    currentSpeed = parseInt(this.value);
    speedValueLabel.textContent = `Speed: ${currentSpeed}x`;

    // Apply speed change to current animation
    if (animationState.isPlaying) {
      if (currentMapMode === "3d" && viewer) {
        // For 3D animations, adjust Cesium clock multiplier
        viewer.clock.multiplier = currentSpeed * 20; // Base multiplier is 20
      } else if (currentMapMode === "2d") {
        // For 2D animations, we need to adjust the animation speed
        updateAnimation2DSpeed(currentSpeed);
      }
    }
  });

  // Store speed getter function globally
  window.getAnimationSpeed = () => currentSpeed;
}

// Impact Zone functionality
let impactZonesVisible = false;
let impactZoneEntities = {}; // For 3D mode
let impactZoneCircles = {}; // For 2D mode

function setupImpactZone() {
  const radiusToggleBtn = document.getElementById("radiusToggleBtn");

  if (!radiusToggleBtn) {
    console.warn("Impact Zone button not found");
    return;
  }

  radiusToggleBtn.addEventListener("click", function () {
    // Check if an event is selected
    if (!selectedEventId) {
      alert("Please select an event first to view its impact zone.");
      return;
    }

    impactZonesVisible = !impactZonesVisible;

    // Update button state
    this.setAttribute("aria-pressed", impactZonesVisible.toString());
    if (impactZonesVisible) {
      this.classList.add("active");
    } else {
      this.classList.remove("active");
    }

    // Show/hide impact zones based on current map mode
    if (currentMapMode === "2d") {
      toggleImpactZones2D();
    } else {
      toggleImpactZones3D();
    }
  });
}

function toggleImpactZones3D() {
  if (!viewer) return;

  if (impactZonesVisible) {
    showImpactZones3D();
  } else {
    hideImpactZones3D();
  }
}

function showImpactZones3D() {
  if (!selectedEventId || !lastFetchedRecords.length) return;

  // Clear existing impact zones first
  hideImpactZones3D();

  const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
  const selectedEventRecords = normalized.filter(
    (r) => r.event_id === selectedEventId
  );

  selectedEventRecords.forEach((record) => {
    if (record.radius_km > 0) {
      const entityId = `impact-zone-${record.event_id}-${record.latitude}-${record.longitude}`;

      // Create impact zone circle for selected event only
      const impactEntity = viewer.entities.add({
        id: entityId,
        position: Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          record.altitude_m || 0
        ),
        ellipse: {
          semiMajorAxis: record.radius_km * 1000, // Convert km to meters
          semiMinorAxis: record.radius_km * 1000,
          height: record.altitude_m || 0,
          material: getColorForSeverity(record.severity_level).withAlpha(0.3),
          outline: true,
          outlineColor: getColorForSeverity(record.severity_level),
          outlineWidth: 2,
        },
        label: {
          text: `Impact Zone: ${record.radius_km} km`,
          font: "14px sans-serif",
          pixelOffset: new Cesium.Cartesian2(0, -50),
          fillColor: Cesium.Color.BLACK,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.WHITE.withAlpha(0.9),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: true,
        },
      });

      impactZoneEntities[entityId] = impactEntity;
    }
  });
}

function hideImpactZones3D() {
  Object.keys(impactZoneEntities).forEach((entityId) => {
    if (impactZoneEntities[entityId]) {
      viewer.entities.remove(impactZoneEntities[entityId]);
      delete impactZoneEntities[entityId];
    }
  });
}

function toggleImpactZones2D() {
  if (!leafletMap) return;

  if (impactZonesVisible) {
    showImpactZones2D();
  } else {
    hideImpactZones2D();
  }
}

function showImpactZones2D() {
  if (!selectedEventId || !lastFetchedRecords.length) return;

  // Clear existing impact zones first
  hideImpactZones2D();

  const normalized = lastFetchedRecords.map(normalizeRecord).filter(Boolean);
  const selectedEventRecords = normalized.filter(
    (r) => r.event_id === selectedEventId
  );

  selectedEventRecords.forEach((record) => {
    if (record.radius_km > 0) {
      const circleId = `impact-zone-${record.event_id}-${record.latitude}-${record.longitude}`;

      // Create impact zone circle for selected event only
      const circle = L.circle([record.latitude, record.longitude], {
        radius: record.radius_km * 1000, // Convert km to meters
        fillColor: getColorForSeverity(record.severity_level),
        color: getColorForSeverity(record.severity_level),
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.3,
      }).addTo(leafletMap);

      // Add popup to the circle
      circle.bindPopup(`
        <div class="impact-zone-popup">
          <h4>Impact Zone</h4>
          <p><strong>Event:</strong> ${record.event_name}</p>
          <p><strong>Radius:</strong> ${record.radius_km} km</p>
          <p><strong>Severity:</strong> ${record.severity_level}</p>
        </div>
      `);

      impactZoneCircles[circleId] = circle;
    }
  });
}

function hideImpactZones2D() {
  Object.keys(impactZoneCircles).forEach((circleId) => {
    if (impactZoneCircles[circleId]) {
      leafletMap.removeLayer(impactZoneCircles[circleId]);
      delete impactZoneCircles[circleId];
    }
  });
}

// Update impact zones when event selection changes
function updateImpactZonesForSelectedEvent() {
  if (!impactZonesVisible) return;

  if (currentMapMode === "2d") {
    showImpactZones2D();
  } else {
    showImpactZones3D();
  }
}

// Update 2D animation speed
function updateAnimation2DSpeed(speedMultiplier) {
  const id = animationState.currentEventId;
  if (!id || !leafletAnimated[id]) return;

  const animState = leafletAnimated[id];

  // Store the speed multiplier for use in animation calculations
  animState.speedMultiplier = speedMultiplier;

  // If animation is currently running, the speed will be applied in the next frame
  // The actual speed adjustment happens in the animation loop by dividing duration by speedMultiplier
}

// Measurement tool: simple distance between clicked points
function setupMeasurementTool() {
  const btn = document.getElementById("measureBtn");
  if (!btn) return;

  let measuring = false;
  let handler = null;
  const entities = [];
  const pointsEntities = [];
  let prevDepthTest = null;

  function clearMeasurement() {
    measuring = false;
    btn.classList.remove("active");
    if (handler) {
      handler.destroy();
      handler = null;
    }
    // remove entities
    entities.forEach((e) => viewer.entities.remove(e));
    entities.length = 0;
    // restore previous depthTestAgainstTerrain if we changed it
    try {
      if (prevDepthTest !== null && viewer.scene && viewer.scene.globe) {
        viewer.scene.globe.depthTestAgainstTerrain = prevDepthTest;
      }
    } catch (e) {}
    prevDepthTest = null;
  }

  function formatMeters(m) {
    if (m >= 1000) return (m / 1000).toFixed(2) + " km";
    return m.toFixed(1) + " m";
  }

  btn.addEventListener("click", function () {
    if (!viewer) return;
    if (measuring) {
      // toggle off
      clearMeasurement();
      return;
    }

    // start measuring
    measuring = true;
    btn.classList.add("active");

    // Keep existing depthTestAgainstTerrain value and enable it for accurate pickPosition
    try {
      if (viewer.scene && viewer.scene.globe) {
        prevDepthTest = viewer.scene.globe.depthTestAgainstTerrain;
        viewer.scene.globe.depthTestAgainstTerrain = true;
      }
    } catch (e) {
      prevDepthTest = null;
    }

    const positions = [];
    let lineEntity = null;
    let labelEntity = null;

    function smoothPositions(inputPositions) {
      if (!inputPositions || inputPositions.length < 2)
        return inputPositions.slice();
      const ellipsoid = viewer.scene.globe.ellipsoid;
      const out = [];
      for (let i = 0; i < inputPositions.length - 1; i++) {
        const a = inputPositions[i];
        const b = inputPositions[i + 1];
        const cartoA = ellipsoid.cartesianToCartographic(a);
        const cartoB = ellipsoid.cartesianToCartographic(b);
        const geodesic = new Cesium.EllipsoidGeodesic(
          cartoA,
          cartoB,
          ellipsoid
        );
        const surfaceDistance = geodesic.surfaceDistance || 0;
        const minSpacing = 30; // meters between interpolated points
        const num = Math.min(
          Math.max(Math.ceil(surfaceDistance / minSpacing), 2),
          300
        );
        for (let j = 0; j < num; j++) {
          const frac = j / num;
          const interpCarto = geodesic.interpolateUsingFraction(
            frac,
            new Cesium.Cartographic()
          );
          const interpCart = ellipsoid.cartographicToCartesian(interpCarto);
          out.push(interpCart);
        }
      }
      out.push(inputPositions[inputPositions.length - 1]);
      return out;
    }

    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    function screenToCartesian(pos) {
      // Try pickPosition (preferred), then globe.pick with camera ray, then camera.pickEllipsoid
      let cart = null;
      try {
        if (viewer.scene && viewer.scene.pickPositionSupported) {
          cart = viewer.scene.pickPosition(pos);
        }
      } catch (e) {
        cart = null;
      }

      try {
        if (!cart && viewer.camera) {
          const ray = viewer.camera.getPickRay(pos);
          if (ray && viewer.scene && viewer.scene.globe) {
            cart = viewer.scene.globe.pick(ray, viewer.scene);
          }
        }
      } catch (e) {
        cart = cart || null;
      }

      try {
        if (!cart && viewer.camera) {
          cart = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
        }
      } catch (e) {
        cart = cart || null;
      }

      return cart;
    }

    handler.setInputAction(function (click) {
      const cartesian = screenToCartesian(click.position);
      if (!cartesian) return;
      positions.push(cartesian);
      const point = viewer.entities.add({
        position: cartesian,
        point: {
          pixelSize: 6,
          color: Cesium.Color.CYAN,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      entities.push(point);
      pointsEntities.push(point);

      // update point colors: first and last should be black
      for (let i = 0; i < pointsEntities.length; i++) {
        try {
          const ent = pointsEntities[i];
          if (ent && ent.point) {
            ent.point.color =
              i === 0 || i === pointsEntities.length - 1
                ? Cesium.Color.BLACK
                : Cesium.Color.CYAN;
          }
        } catch (e) {}
      }

      if (positions.length > 1) {
        // update line (use smoothed positions for visual smoothness)
        if (lineEntity) viewer.entities.remove(lineEntity);
        const smooth = smoothPositions(positions);
        lineEntity = viewer.entities.add({
          polyline: {
            positions: smooth,
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.CYAN,
              dashLength: 12,
            }),
            clampToGround: true,
            depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.CYAN,
              dashLength: 12,
            }),
            arcType: Cesium.ArcType.GEODESIC,
          },
        });
        entities.push(lineEntity);

        // compute distance using raw clicked positions
        let total = 0;
        for (let i = 0; i < positions.length - 1; i++) {
          total += Cesium.Cartesian3.distance(positions[i], positions[i + 1]);
        }

        // update label at last point
        if (labelEntity) viewer.entities.remove(labelEntity);
        labelEntity = viewer.entities.add({
          position: positions[positions.length - 1],
          label: {
            text: formatMeters(total),
            font: "14px sans-serif",
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
            pixelOffset: new Cesium.Cartesian2(12, -12),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
        entities.push(labelEntity);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // finish on double click
    handler.setInputAction(function () {
      // leave marker and label, but end measuring
      clearMeasurement();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // cancel on right click
    handler.setInputAction(function () {
      clearMeasurement();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  });
}

// --- BOOTSTRAP ---
(async function main() {
  try {
    initMap();
    // Initialize map switching functionality
    initMapSwitch();
    // Setup impact zone functionality
    setupImpactZone();
    // Setup measurement tool UI
    if (typeof setupMeasurementTool === "function") {
      setupMeasurementTool();
      setupPanTool();
    }
    setupAnimationControls();
    const records = await fetchAllEventsWithDetails();
    lastFetchedRecords = records;
    renderRecords(records);
    updateDropdown(records);
    attachDropdownListener();
    startAutoRefresh();
    // Prefer query params (eventId/eventName). Fallback to legacy eventData param.
    const hasUrlEvent = getEventFromURL();
    // If no URL-selected event and no eventData provided, zoom to show all events
    if (!getEventFromURL() && !eventData) {
      zoomToAllEvents();
    }

    if (hasUrlEvent) {
      autoSelectEventOnLoad(records);
    } else if (eventData && eventData.event_id) {
      selectedEventId = String(eventData.event_id);
      document.getElementById("eventDropdown").value = selectedEventId;
      highlightEvent(selectedEventId);
    }
  } catch (err) {
    console.error("Failed to initialize events:", err);
    alert("Failed to load event data (see console).");
  }
})();
// SAFE custom zoom buttons (press-and-hold support)
(function setupZoomControls() {
  // Larger step and faster interval to make zoom feel responsive when holding
  const ZOOM_STEP = 70000; // camera.zoomIn/zoomOut amount per step
  const ZOOM_INTERVAL_MS = 40; // repeat frequency while holding (ms)

  const inBtn = document.getElementById("zoomInBtn");
  const outBtn = document.getElementById("zoomOutBtn");
  if (!inBtn || !outBtn) return;

  let zoomTimer = null;

  function clearZoomTimer() {
    if (zoomTimer) {
      clearInterval(zoomTimer);
      zoomTimer = null;
    }
  }

  function startZoomIn() {
    // immediate response
    try {
      viewer.camera.zoomIn(ZOOM_STEP);
    } catch (e) {}
    clearZoomTimer();
    zoomTimer = setInterval(() => {
      try {
        viewer.camera.zoomIn(ZOOM_STEP);
      } catch (e) {}
    }, ZOOM_INTERVAL_MS);
  }

  function startZoomOut() {
    try {
      viewer.camera.zoomOut(ZOOM_STEP);
    } catch (e) {}
    clearZoomTimer();
    zoomTimer = setInterval(() => {
      try {
        viewer.camera.zoomOut(ZOOM_STEP);
      } catch (e) {}
    }, ZOOM_INTERVAL_MS);
  }

  // Mouse events
  inBtn.addEventListener("mousedown", startZoomIn);
  outBtn.addEventListener("mousedown", startZoomOut);
  window.addEventListener("mouseup", clearZoomTimer);
  inBtn.addEventListener("mouseleave", clearZoomTimer);
  outBtn.addEventListener("mouseleave", clearZoomTimer);

  // Touch events (preventDefault to avoid synthetic mouse events)
  inBtn.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      startZoomIn();
    },
    { passive: false }
  );
  outBtn.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      startZoomOut();
    },
    { passive: false }
  );
  window.addEventListener("touchend", clearZoomTimer);
  window.addEventListener("touchcancel", clearZoomTimer);

  // Also support keyboard +/- when buttons focused
  inBtn.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      startZoomIn();
    }
  });
  outBtn.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      startZoomOut();
    }
  });
  inBtn.addEventListener("keyup", clearZoomTimer);
  outBtn.addEventListener("keyup", clearZoomTimer);
})();

// Pan tool: toggled hand button enabling click-drag world-space panning
function setupPanTool() {
  const handBtn = document.getElementById("panToolBtn");
  if (!handBtn || !viewer) return;

  let enabled = false;
  let prevTracked = null;
  let dragging = false;
  let lastPos = null;
  let handler = null;

  function setCursor(c) {
    try {
      viewer.container.style.cursor = c;
    } catch (e) {}
  }

  function enable() {
    enabled = true;
    panToolActive = true;
    // remember any existing tracked entity and clear tracking so user can pan
    try {
      prevTracked = viewer.trackedEntity;
    } catch (e) {
      prevTracked = null;
    }
    clearCameraFollow();
    handBtn.classList.add("active");
    setCursor("grab");

    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(function (down) {
      dragging = true;
      lastPos = down.position;
      setCursor("grabbing");
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction(function (movement) {
      if (!dragging || !lastPos) return;
      const newPos = movement.endPosition || movement.position;
      const dx = newPos.x - lastPos.x;
      const dy = newPos.y - lastPos.y;
      lastPos = newPos;

      // Compute pan scale based on camera height so feel is consistent
      const cam = viewer.camera;
      const height = cam.positionCartographic
        ? cam.positionCartographic.height
        : Cesium.Cartesian3.distance(cam.position, Cesium.Cartesian3.ZERO);
      const pixelToMeter = Math.max(height / 1000, 1); // tunable

      // Move camera in world-space using camera.moveRight / moveUp (meters)
      try {
        cam.moveRight(-dx * pixelToMeter);
        cam.moveUp(dy * pixelToMeter);
      } catch (e) {}
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function () {
      dragging = false;
      lastPos = null;
      setCursor("grab");
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // also cancel on leave
    handler.setInputAction(function () {
      dragging = false;
      lastPos = null;
      setCursor("grab");
    }, Cesium.ScreenSpaceEventType.MOUSE_LEAVE);

    // keyboard arrows while enabled
    window.addEventListener("keydown", keyPan);
  }

  function disable() {
    enabled = false;
    panToolActive = false;
    handBtn.classList.remove("active");
    setCursor("");
    dragging = false;
    lastPos = null;
    try {
      if (handler) handler.destroy();
    } catch (e) {}
    handler = null;
    window.removeEventListener("keydown", keyPan);
    // restore tracking if animation is running (or restore previous tracked entity)
    try {
      if (animationState.isPlaying && activeAircraftEntity) {
        setCameraFollow(activeAircraftEntity);
      } else if (prevTracked) {
        setCameraFollow(prevTracked);
      }
    } catch (e) {}
  }

  function keyPan(e) {
    if (!enabled) return;
    const cam = viewer.camera;
    const height = cam.positionCartographic
      ? cam.positionCartographic.height
      : Cesium.Cartesian3.distance(cam.position, Cesium.Cartesian3.ZERO);
    const step = Math.max(height / 10, 10);
    if (e.key === "ArrowLeft") cam.moveRight(-step);
    if (e.key === "ArrowRight") cam.moveRight(step);
    if (e.key === "ArrowUp") cam.moveUp(step);
    if (e.key === "ArrowDown") cam.moveUp(-step);
  }

  handBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!enabled) enable();
    else disable();
  });

  // disable when other tools activate (measurement toggles depthTest etc.)
  const measureBtn = document.getElementById("measureBtn");
  if (measureBtn) {
    measureBtn.addEventListener("click", () => {
      // toggle off pan when measurement starts
      if (enabled) disable();
    });
  }
}

// Position zoom/measure controls under Cesium's base layer / Bing widget
function positionControlsUnderBaseLayer() {
  try {
    const controls =
      document.querySelector(".zoom-controls") ||
      document.querySelector(".controls-wrapper");
    if (!controls || !viewer) return;
    // Try to locate the Bing Maps / Aerial logo element first (img or link to bing.com)
    function findBingLogo() {
      // common patterns: <a href="...bing.com..."><img src="...bing..."></a>
      let el = document.querySelector('a[href*="bing.com"] img');
      if (el) return el;
      el = document.querySelector('img[src*="bing"]');
      if (el) return el;
      // also check for links pointing to bing without img
      el = document.querySelector('a[href*="bing.com"]');
      if (el) return el;
      // last resort: search for any element containing the word 'Bing'
      const all = document.querySelectorAll(".cesium-viewer *");
      for (let i = 0; i < all.length; i++) {
        const n = all[i];
        if (n && n.innerText && /bing/i.test(n.innerText)) return n;
      }
      return null;
    }

    const bingEl = findBingLogo();
    let rect = null;
    if (bingEl) {
      rect = bingEl.getBoundingClientRect();
    } else {
      // fallback to baseLayerPicker or toolbar
      const widget =
        document.querySelector(".cesium-baseLayerPicker") ||
        document.querySelector(".cesium-viewer-toolbar") ||
        document.querySelector(".cesium-viewer .cesium-viewer-toolbar");
      if (!widget) return;
      rect = widget.getBoundingClientRect();
    }

    const ctrlRect = controls.getBoundingClientRect();

    // small horizontal offset to nudge controls left/right (negative = left, positive = right)
    const CONTROL_OFFSET_X = 0; // pixels (adjustable)

    // Use fixed positioning so controls stay aligned to the viewport under the logo
    controls.style.position = "fixed";

    // center controls horizontally under the detected widget/logo (precise center)
    const left = Math.round(
      rect.left + rect.width / 2 - ctrlRect.width / 2 + CONTROL_OFFSET_X
    );
    const top = Math.round(rect.bottom + 6); // 6px gap below logo
    controls.style.left = left + "px";
    controls.style.top = top + "px";
    // clear right so CSS right doesn't interfere
    controls.style.right = "auto";

    // enforce vertical stacking and uniform spacing to avoid overlap
    controls.style.display = "flex";
    controls.style.flexDirection = "column";
    controls.style.gap = "8px";
  } catch (e) {
    // ignore
  }
}

// Zoom to all non-animation events with a tilted 3D view
function zoomToAllEvents() {
  try {
    const positions = [];
    Object.keys(allLocationPoints).forEach((id) => {
      allLocationPoints[id].forEach((ent) => {
        try {
          const p =
            ent.position && ent.position.getValue(Cesium.JulianDate.now());
          if (p) positions.push(p);
        } catch (e) {}
      });
    });

    if (positions.length === 0) return;

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(
        0,
        -0.6,
        boundingSphere.radius * 1.5
      ),
    });
  } catch (e) {
    // fallback to simple zoomTo of entities
    try {
      const ents = Object.values(eventEntities).filter(
        (e) => !e.isAnimationEntity
      );
      if (ents.length) viewer.zoomTo(ents);
    } catch (ee) {}
  }
}

// Reposition on resize and when viewer widgets may change
window.addEventListener("resize", function () {
  setTimeout(positionControlsUnderBaseLayer, 100);
});

// Initial positioning after widgets render
setTimeout(positionControlsUnderBaseLayer, 500);
