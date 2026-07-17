import { MoonIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <section className="flex w-full max-w-lg flex-col items-start gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">Gbox</p>
          <h1 className="text-4xl font-semibold tracking-tight">
            Your workspace is ready.
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            Tauri, React, and shadcn/ui are configured as a clean foundation for
            the application.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => document.documentElement.classList.toggle("dark")}
        >
          <MoonIcon data-icon="inline-start" />
          Toggle theme
        </Button>
      </section>
    </main>
  );
}

export default App;
