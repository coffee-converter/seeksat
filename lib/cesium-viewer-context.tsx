"use client";

// lib/cesium-viewer-context.tsx — React context holding the Cesium
// viewer instance + its load status, so descendants don't have to
// prop-drill or reach for window globals.
//
// Pattern: composition roots own the container ref + call
// useCesiumViewer, then wrap children in <CesiumViewerProvider
// viewer={...} status={...}>. Any descendant calls useViewer() to
// get { viewer, status } back — null/"waiting" until the CDN
// script + container both land.

import { createContext, useContext, type ReactNode } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CesiumViewer = any;
export type CesiumViewerStatus = "waiting" | "ready" | "error";

export interface CesiumViewerContextValue {
  viewer: CesiumViewer | null;
  status: CesiumViewerStatus;
}

const DEFAULT_VALUE: CesiumViewerContextValue = {
  viewer: null,
  status: "waiting",
};

const CesiumViewerContext =
  createContext<CesiumViewerContextValue>(DEFAULT_VALUE);

export function CesiumViewerProvider({
  viewer,
  status,
  children,
}: {
  viewer: CesiumViewer | null;
  status: CesiumViewerStatus;
  children: ReactNode;
}) {
  return (
    <CesiumViewerContext.Provider value={{ viewer, status }}>
      {children}
    </CesiumViewerContext.Provider>
  );
}

/** Returns the Cesium viewer + its load status. Safe to call from
 *  any descendant of CesiumViewerProvider; returns the default
 *  { viewer: null, status: "waiting" } when used outside a
 *  provider, so SSR / unwrapped previews don't crash. */
export function useViewer(): CesiumViewerContextValue {
  return useContext(CesiumViewerContext);
}
