import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DemoUsers, demoSignIn } from "./DemoUsers";

describe("demo sign-in", () => {
  it("is offered only when the build sets VITE_DEMO_SIGN_IN=1", () => {
    vi.stubEnv("VITE_DEMO_SIGN_IN", "1");
    expect(demoSignIn()).toBe(true);
    vi.stubEnv("VITE_DEMO_SIGN_IN", "0");
    expect(demoSignIn()).toBe(false);
    vi.stubEnv("VITE_DEMO_SIGN_IN", "");
    expect(demoSignIn()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("lists every seeded user with what they may do", () => {
    render(<DemoUsers onPick={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: /Admin.*admin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tom Berg.*editor.*development, uat/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Support Desk.*viewer/ })).toBeInTheDocument();
  });

  it("a click fills in that user's e-mail and the demo password", () => {
    const onPick = vi.fn();
    render(<DemoUsers onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /Maria Lopez/ }));
    expect(onPick).toHaveBeenCalledWith("maria.lopez@example.com", "demo");
  });
});
