"use client";

import { useEffect, useRef } from "react";

type Point = { name: string; lat: number; lon: number };

export default function RouteMap({ from, to }: { from: Point; to: Point }) {
  const mapNode = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;

    void import("leaflet").then((L) => {
      if (!mapNode.current || disposed) return;
      map = L.map(mapNode.current, { zoomControl: false, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const route: [number, number][] = [[from.lat, from.lon], [to.lat, to.lon]];
      L.polyline(route, { color: "#ff4b2b", weight: 5, dashArray: "8 10" }).addTo(map);
      for (const point of [from, to]) {
        L.circleMarker([point.lat, point.lon], { radius: 9, color: "#13120f", weight: 3, fillColor: "#3278ff", fillOpacity: 1 })
          .bindTooltip(point.name, { permanent: true, direction: "top", offset: [0, -10] })
          .addTo(map);
      }
      map.fitBounds(route, { padding: [55, 55], maxZoom: 7 });
    });

    return () => { disposed = true; map?.remove(); };
  }, [from, to]);

  return <div ref={mapNode} className="route-map" role="img" aria-label={`Маршрут на карте: ${from.name} — ${to.name}`} />;
}
