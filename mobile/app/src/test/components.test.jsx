import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { Ring, Donut } from "../components/Ring";
import EmptyState from "../components/EmptyState";
import { Ic, MealIcon } from "../components/icons";

describe("Ring", () => {
  test("renders children content", () => {
    render(<Ring percent={68}><span>68%</span></Ring>);
    expect(screen.getByText("68%")).toBeInTheDocument();
  });
});

describe("Donut", () => {
  test("renders an svg with segments", () => {
    const { container } = render(<Donut segments={[{ value: 30, color: "#22C55E" }, { value: 70, color: "#3B82F6" }]} />);
    expect(container.querySelector("svg")).toBeTruthy();
    // base track + 2 segments
    expect(container.querySelectorAll("circle").length).toBe(3);
  });
});

describe("EmptyState", () => {
  test("renders title and subtitle", () => {
    render(<EmptyState icon="camera" title="Пока нет записей" sub="Добавьте приём пищи" />);
    expect(screen.getByText("Пока нет записей")).toBeInTheDocument();
    expect(screen.getByText("Добавьте приём пищи")).toBeInTheDocument();
  });
});

describe("Icons", () => {
  test("Ic renders an svg", () => {
    const { container } = render(<Ic name="home" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
  test("MealIcon renders an svg", () => {
    const { container } = render(<MealIcon kind="breakfast" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
