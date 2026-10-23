"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "../ui/States";
import type { MapProps } from "./LeafletMap";

/** Leaflet needs the browser, so the map is loaded only on the client, after the page shell. */
export const HazeMap = dynamic<MapProps>(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[28rem] w-full" />,
});

export type { MapMarker, MapPoint, MapProps } from "./LeafletMap";
