import LogicalWorkspace from './components/LogicalWorkspace';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">PIR LED Logical Controller</h1>
          <p className="mt-1 text-sm text-gray-600">
            Domain-first control surface for labels, groups, and reusable moods.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <LogicalWorkspace />
      </main>
    </div>
  );
}

export default App;
