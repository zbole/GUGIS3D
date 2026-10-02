import { lazy, Suspense } from "react";
import AppErrorBoundary from "./AppErrorBoundary";

const BuildingStudio = lazy(() => import("./studio/CityStudio"));
const CompareShowcase = lazy(() => import("./compare/CompareShowcase"));

export default function App() {
  const comparison = window.location.pathname.replace(/\/$/, "") === "/compare";
  return (
    <AppErrorBoundary>
      <Suspense fallback={<div className="app-loading">GUGIS3D · 正在载入</div>}>
        {comparison ? <CompareShowcase /> : <BuildingStudio />}
      </Suspense>
    </AppErrorBoundary>
  );
}
