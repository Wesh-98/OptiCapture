import { Suspense, lazy } from 'react';

// Dev-only visual feedback toolbar for AI agents; syncs to the agentation-mcp server.
// Loaded on demand and never on the phone scan page: it is ~750 KB in dev mode, and a
// phone cannot reach the toolbar's localhost endpoint anyway.
// Created only in dev builds: production replaces import.meta.env.DEV with false, so the
// bundler drops the import and no toolbar chunk is emitted.
const Agentation = import.meta.env.DEV
  ? lazy(() => import('agentation').then(m => ({ default: m.Agentation })))
  : null;

export default function DevToolbar() {
  if (!Agentation || globalThis.location.pathname.startsWith('/mobile-scan')) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <Agentation appName="OptiCapture" endpoint="http://localhost:4747" />
    </Suspense>
  );
}
