"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { MAP_TILES } from "@/lib/site";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  /** Text shown on the marker itself, so the value is never conveyed by colour alone. */
  text: string;
  color: string;
  /** Accessible name, e.g. "West region, Singapore: 24-hour PSI 142, Unhealthy". */
  title: string;
  shape?: "pill" | "square";
  muted?: boolean;
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  radius: number;
  color: string;
  opacity: number;
  tooltip: string;
}

export interface MapProps {
  markers?: MapMarker[];
  points?: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onPointSelect?: (id: string) => void;
  center?: [number, number];
  zoom?: number;
  fitTo?: [[number, number], [number, number]] | null;
  outlines?: boolean;
  imagery?: { url: string; attribution: string; maxNativeZoom: number; label: string } | null;
  className?: string;
  ariaLabel: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function markerIcon(m: MapMarker, selected: boolean): L.DivIcon {
  const ring = selected ? "box-shadow:0 0 0 3px #e4e1d8;" : "box-shadow:0 0 0 1px rgba(0,0,0,.55);";
  const radius = m.shape === "square" ? "4px" : "999px";
  const bg = m.muted ? "#2a3f34" : m.color;
  const fg = m.muted ? "#a9b2aa" : "#101512";
  const html = `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:24px;padding:0 7px;border-radius:${radius};background:${bg};color:${fg};font:600 12.5px/1 var(--font-sans);${ring}">${escapeHtml(m.text)}</span>`;
  return L.divIcon({ html, className: "hw-marker", iconSize: undefined, iconAnchor: [17, 12] });
}

export default function LeafletMap({
  markers = [],
  points = [],
  selectedId = null,
  onSelect,
  onPointSelect,
  center = [4.5, 108],
  zoom = 5,
  fitTo = null,
  outlines = true,
  imagery = null,
  className = "h-[28rem]",
  ariaLabel,
}: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const pointLayer = useRef<L.LayerGroup | null>(null);
  const imageryLayer = useRef<L.TileLayer | null>(null);
  const renderer = useRef<L.Canvas | null>(null);
  const onSelectRef = useRef(onSelect);
  const onPointRef = useRef(onPointSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onPointRef.current = onPointSelect;
  }, [onSelect, onPointSelect]);

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center, zoom, minZoom: 3, maxZoom: 12, zoomControl: true, worldCopyJump: false, attributionControl: true });
    L.tileLayer(MAP_TILES.url, { attribution: MAP_TILES.attribution, subdomains: "abcd", maxZoom: 19 }).addTo(m);
    renderer.current = L.canvas({ padding: 0.3 });
    pointLayer.current = L.layerGroup().addTo(m);
    markerLayer.current = L.layerGroup().addTo(m);
    map.current = m;

    let cancelled = false;
    if (outlines) {
      fetch("/geo/sea-50m.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((geo) => {
          if (cancelled || !geo || !map.current) return;
          L.geoJSON(geo, {
            interactive: false,
            style: { color: "#6f8a7a", weight: 0.8, opacity: 0.7, fill: false },
          }).addTo(map.current);
        })
        .catch(() => {
          /* outlines are decorative context; the map works without them */
        });
    }
    return () => {
      cancelled = true;
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current && fitTo) map.current.fitBounds(fitTo, { padding: [24, 24], maxZoom: 9 });
  }, [fitTo]);

  // Station markers.
  useEffect(() => {
    const layer = markerLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const m of markers) {
      const marker = L.marker([m.lat, m.lon], {
        icon: markerIcon(m, m.id === selectedId),
        title: m.title,
        alt: m.title,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: m.id === selectedId ? 1000 : m.muted ? -100 : 0,
      });
      marker.on("click", () => onSelectRef.current?.(m.id));
      marker.on("keypress", (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") onSelectRef.current?.(m.id);
      });
      marker.addTo(layer);
    }
  }, [markers, selectedId]);

  // Hotspot points, drawn on canvas for performance.
  useEffect(() => {
    const layer = pointLayer.current;
    if (!layer || !renderer.current) return;
    layer.clearLayers();
    for (const p of points) {
      const c = L.circleMarker([p.lat, p.lon], {
        renderer: renderer.current,
        radius: p.radius,
        color: p.color,
        weight: 0.6,
        fillColor: p.color,
        fillOpacity: p.opacity,
        opacity: Math.min(1, p.opacity + 0.2),
      });
      c.bindTooltip(p.tooltip, { direction: "top", sticky: true });
      c.on("click", () => onPointRef.current?.(p.id));
      c.addTo(layer);
    }
  }, [points]);

  // Optional satellite imagery overlay.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (imageryLayer.current) {
      imageryLayer.current.remove();
      imageryLayer.current = null;
    }
    if (imagery) {
      imageryLayer.current = L.tileLayer(imagery.url, { attribution: imagery.attribution, maxNativeZoom: imagery.maxNativeZoom, maxZoom: 12, opacity: 0.9 });
      imageryLayer.current.addTo(m);
      imageryLayer.current.bringToBack();
    }
  }, [imagery]);

  return <div ref={el} role="region" aria-label={ariaLabel} className={`w-full overflow-hidden rounded-[var(--radius-panel)] border border-line ${className}`} />;
}
