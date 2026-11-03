import MapLayoutShell from "@/components/map/MapLayoutShell";

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return <MapLayoutShell>{children}</MapLayoutShell>;
}
