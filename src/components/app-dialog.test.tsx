import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppDialog } from "@/components/app-dialog";

describe("AppDialog", () => {
  it("places long content in the shared scroll area", () => {
    const { baseElement } = render(
      <AppDialog
        open
        onOpenChange={vi.fn()}
        title="Verification dossier"
        description="A long verification record"
      >
        <div>Evidence body</div>
      </AppDialog>,
    );

    expect(screen.getByRole("heading", { name: "Verification dossier" })).toBeInTheDocument();
    expect(baseElement.querySelector("[data-slot='scroll-area']")).toHaveClass("app-dialog__scroll");
    expect(baseElement.querySelector("[data-slot='scroll-area-viewport']")).toHaveTextContent("Evidence body");
  });
});
