interface StatusBarProps {
  status: string;
  objectCount: number;
  selectedId: string | null;
  backendState: string;
  cameraStatus: string;
}

export default function StatusBar({ status, objectCount, selectedId, backendState, cameraStatus }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{status}</span>
      <span>{objectCount} objects</span>
      <span>{selectedId ? `Selected ${selectedId}` : "No selection"}</span>
      <span>{cameraStatus}</span>
      <span>{backendState}</span>
    </footer>
  );
}
