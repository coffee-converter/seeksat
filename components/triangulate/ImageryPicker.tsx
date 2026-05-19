"use client";

import { useEffect } from "react";
import { useViewer } from "@/lib/cesium-viewer-context";

// Imagery picker. The list is no-auth tile sources (Esri / OSM /
// CartoDB) — same set the legacy bundle shipped with. Viewer comes
// from the CesiumViewerProvider; until it lands the select is
// rendered but inert and no layer install runs.
const IMAGERY_PROVIDERS = [
  { id: "esri-imagery",  label: "Esri Imagery (satellite)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri, Maxar, Earthstar Geographics", maximumLevel: 19 },
  { id: "esri-topo",     label: "Esri Topographic",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri", maximumLevel: 19 },
  { id: "esri-natgeo",   label: "Esri National Geographic",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri, National Geographic", maximumLevel: 12 },
  { id: "esri-dark",     label: "Esri Dark Gray Canvas",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri", maximumLevel: 16 },
  { id: "esri-light",    label: "Esri Light Gray Canvas",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    credit: "Tiles © Esri", maximumLevel: 16 },
  { id: "osm",           label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors", maximumLevel: 19 },
  { id: "carto-dark",    label: "CartoDB Dark Matter",
    url: "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
    credit: "© CartoDB", maximumLevel: 19 },
  { id: "carto-voyager", label: "CartoDB Voyager",
    url: "https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png",
    credit: "© CartoDB", maximumLevel: 19 },
];

import { useState } from "react";

export default function ImageryPicker() {
  const { viewer } = useViewer();
  const [providerId, setProviderId] = useState("esri-imagery");

  useEffect(() => {
    if (!viewer) return;
    const p = IMAGERY_PROVIDERS.find((x) => x.id === providerId)
      ?? IMAGERY_PROVIDERS[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Cesium = (window as any).Cesium;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: p.url,
        credit: p.credit,
        maximumLevel: p.maximumLevel,
      }),
    );
  }, [viewer, providerId]);

  return (
    <div id="imagery-picker">
      <span className="picker-label">Globe</span>
      <select
        id="imagery-select"
        value={providerId}
        onChange={(e) => setProviderId(e.target.value)}
      >
        {IMAGERY_PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
