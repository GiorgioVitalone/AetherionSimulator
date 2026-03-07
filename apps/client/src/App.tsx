export function App() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-black tracking-normal">Aetherion Simulator</h1>
        <p className="font-body text-[var(--color-text-secondary)] text-lg">
          Game engine initializing...
        </p>
        <div className="w-16 h-0.5 bg-accent mx-auto opacity-60" />
      </div>
    </div>
  );
}
