import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".node-input")).toHaveCount(1);
});

test("initial document renders one empty mindmap node", async ({ page }) => {
  await expect(page.locator(".file-name")).toHaveText("untitled.md");
  await expect(page.getByText("browser preview")).toBeVisible();
  await expect(page.getByLabel("Root heading")).toHaveValue("");
  await expect(nodeInput(page, "right/0")).toBeVisible();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");
});

test("editing the root and first node updates markdown", async ({ page }) => {
  await page.getByLabel("Root heading").fill("Project");
  await nodeInput(page, "right/0").fill("Idea");

  await expect(markdownOutput(page)).toHaveText("# Project\n\n- Idea\n");
});

test("Enter creates a sibling node and undo redo restores it", async ({ page }) => {
  const firstNode = nodeInput(page, "right/0");

  await firstNode.focus();
  await firstNode.press("Enter");

  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n-\n");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n-\n");
});

test("toolbar can add right and left root nodes", async ({ page }) => {
  await page.getByRole("button", { name: "Add right root node" }).click();
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n-\n");

  await page.getByRole("button", { name: "Add left root node" }).click();
  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n## Right\n\n-\n-\n\n## Left\n\n-\n");
});

test("zoom controls can zoom in and reset", async ({ page }) => {
  const resetZoomButton = page.getByRole("button", { name: "Reset zoom" });

  await expect(resetZoomButton).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(resetZoomButton).toHaveText("110%");
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect(resetZoomButton).toHaveText("100%");
});

test("canvas can pan by dragging and reset to center", async ({ page }) => {
  const viewport = page.getByLabel("Mindmap canvas");
  const workspace = page.locator(".workspace");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + 24;
  const startY = box!.y + 24;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 40);
  await page.mouse.up();

  await expect
    .poll(() =>
      workspace.evaluate((element) => ({
        x: getComputedStyle(element).getPropertyValue("--workspace-pan-x").trim(),
        y: getComputedStyle(element).getPropertyValue("--workspace-pan-y").trim()
      }))
    )
    .toEqual({ x: "80px", y: "40px" });

  await page.getByRole("button", { name: "Reset pan" }).click();

  await expect
    .poll(() =>
      workspace.evaluate((element) => ({
        x: getComputedStyle(element).getPropertyValue("--workspace-pan-x").trim(),
        y: getComputedStyle(element).getPropertyValue("--workspace-pan-y").trim()
      }))
    )
    .toEqual({ x: "0px", y: "0px" });
});

test("node action buttons are not shown inline", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Add child node" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add sibling node" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete node" })).toHaveCount(0);
});

test("keyboard shortcut help opens from the toolbar and closes with Escape", async ({
  page
}) => {
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();

  const dialog = page.getByRole("dialog", { name: "키바인딩" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("편집 중")).toBeVisible();
  await expect(dialog.getByText("Cmd/Ctrl+S", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("shortcut help keeps question mark editable and opens from selection mode", async ({
  page
}) => {
  const firstNode = page.locator(".node-input");

  await firstNode.focus();
  await page.keyboard.type("?");
  await expect(firstNode).toHaveValue("?");
  await expect(page.getByRole("dialog", { name: "키바인딩" })).toHaveCount(0);

  await firstNode.press("Escape");
  await page.keyboard.press("Shift+/");

  await expect(page.getByRole("dialog", { name: "키바인딩" })).toBeVisible();
});

test("arrow navigation can move between the first node and the root", async ({ page }) => {
  const root = page.getByLabel("Root heading");
  const firstNode = page.locator(".node-input");

  await firstNode.focus();
  await firstNode.press("Escape");
  await page.keyboard.press("ArrowLeft");

  await expect(root).toHaveClass(/selected/);
  await expect(firstNode).not.toHaveClass(/selected/);

  await page.keyboard.press("ArrowRight");

  await expect(root).not.toHaveClass(/selected/);
  await expect(firstNode).toHaveClass(/selected/);
});

test("ArrowDown moves to the lower sibling instead of the first child", async ({
  page
}) => {
  const parent = nodeInput(page, "right/0");

  await parent.fill("A");
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeFocused();

  await parent.focus();
  await parent.press("Enter");
  await expect(nodeInput(page, "right/1")).toBeFocused();

  await parent.focus();
  await parent.press("Escape");
  await page.keyboard.press("ArrowDown");

  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/0/0")).not.toHaveClass(/selected/);

  await page.keyboard.press("ArrowUp");

  await expect(parent).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/1")).not.toHaveClass(/selected/);
});

test("Tab while editing creates a child node instead of indenting under a sibling", async ({
  page
}) => {
  const firstNode = page.locator(".node-input");

  await firstNode.focus();
  await firstNode.press("Tab");

  await expect(page.locator('.node-input[data-node-path="right/0"]')).toBeVisible();
  await expect(page.locator('.node-input[data-node-path="right/0/0"]')).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n  -\n");
});

test("Escape deletes an empty node while editing", async ({ page }) => {
  const parent = nodeInput(page, "right/0");

  await parent.focus();
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeFocused();

  await nodeInput(page, "right/0/0").press("Escape");

  await expect(nodeInput(page, "right/0/0")).toHaveCount(0);
  await expect(parent).toHaveClass(/selected/);
  await expect(parent).not.toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");
});

test("Enter on a node with children focuses the new sibling", async ({ page }) => {
  const parent = nodeInput(page, "right/0");

  await parent.focus();
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeFocused();

  await parent.focus();
  await parent.press("Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n  -\n-\n");
});

test("a child node is laid out to the right of its parent", async ({ page }) => {
  const parent = page.locator('.node-input[data-node-path="right/0"]');

  await parent.focus();
  await parent.press("Tab");

  const child = page.locator('.node-input[data-node-path="right/0/0"]');
  await expect(child).toBeVisible();

  const relation = await page.evaluate(() => {
    const parentRect = document
      .querySelector('.node-input[data-node-path="right/0"]')
      ?.getBoundingClientRect();
    const childRect = document
      .querySelector('.node-input[data-node-path="right/0/0"]')
      ?.getBoundingClientRect();
    if (!parentRect || !childRect) {
      return null;
    }

    return {
      gap: Math.round(childRect.left - parentRect.right),
      verticalCenterDelta: Math.round(
        childRect.top + childRect.height / 2 - (parentRect.top + parentRect.height / 2)
      )
    };
  });

  expect(relation).not.toBeNull();
  expect(relation!.gap).toBeGreaterThan(0);
  expect(Math.abs(relation!.verticalCenterDelta)).toBeLessThanOrEqual(2);
});

test("node connectors use full bezier SVG paths", async ({ page }) => {
  const parent = page.locator('.node-input[data-node-path="right/0"]');

  await parent.focus();
  await parent.press("Tab");

  await expect(page.locator(".connector-layer path")).toHaveCount(2);

  const connectorState = await page.evaluate(() =>
    Array.from(document.querySelectorAll<SVGPathElement>(".connector-layer path")).map(
      (path) => ({
        d: path.getAttribute("d") ?? "",
        stroke: getComputedStyle(path).stroke
      })
    )
  );

  expect(connectorState.every((connector) => connector.d.includes(" C "))).toBe(true);
  expect(connectorState.every((connector) => connector.stroke !== "none")).toBe(true);
});

test("sibling connectors share one branch trunk", async ({ page }) => {
  const firstNode = nodeInput(page, "right/0");

  await firstNode.focus();
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Enter");
  }

  await expect(page.locator(".connector-layer path")).toHaveCount(1);
  const connectorPath = await page
    .locator(".connector-layer path")
    .first()
    .getAttribute("d");

  expect(connectorPath).toContain(" C ");
  expect(connectorPath).toContain(" L ");
});

test("IME composing Enter does not create a sibling node", async ({ page }) => {
  const firstNode = page.locator(".node-input");

  await firstNode.focus();
  await firstNode.dispatchEvent("keydown", {
    bubbles: true,
    cancelable: true,
    isComposing: true,
    key: "Enter"
  });

  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");
});

test("typing a space into an empty node remains valid markdown", async ({ page }) => {
  const firstNode = page.locator(".node-input");

  await firstNode.focus();
  await firstNode.press("Space");
  await firstNode.press("Escape");

  await expect(firstNode).toHaveValue(" ");
  await expect(firstNode).toHaveClass(/selected/);
  await expect(firstNode).not.toBeFocused();
  await expect(page.locator(".diagnostics")).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n-  \n");
});

test("compact sidebar layout keeps the first right node to the right of the root", async ({
  page
}) => {
  await page.setViewportSize({ width: 636, height: 873 });
  await page.reload();
  await expect(page.locator(".node-input")).toHaveCount(1);

  const relation = await page.evaluate(() => {
    const root = document.querySelector(".root-node input")?.getBoundingClientRect();
    const node = document.querySelector(".node-input")?.getBoundingClientRect();
    if (!root || !node) {
      return null;
    }

    return {
      gap: Math.round(node.left - root.right),
      verticalCenterDelta: Math.round(
        node.top + node.height / 2 - (root.top + root.height / 2)
      )
    };
  });

  expect(relation).not.toBeNull();
  expect(relation!.gap).toBeGreaterThan(0);
  expect(Math.abs(relation!.verticalCenterDelta)).toBeLessThanOrEqual(2);
});

test("mobile viewport keeps curved connectors and draggable pan", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".node-input")).toHaveCount(1);

  const parent = nodeInput(page, "right/0");
  await parent.focus();
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeVisible();

  await page.mouse.move(24, 210);
  await page.mouse.down();
  await page.mouse.move(84, 250);
  await page.mouse.up();

  const mobileState = await page.evaluate(() => {
    const root = document.querySelector(".root-node input")?.getBoundingClientRect();
    const parentNode = document
      .querySelector('.node-input[data-node-path="right/0"]')
      ?.getBoundingClientRect();
    const childNode = document
      .querySelector('.node-input[data-node-path="right/0/0"]')
      ?.getBoundingClientRect();
    const connectorPaths = Array.from(
      document.querySelectorAll<SVGPathElement>(".connector-layer path")
    ).map((path) => path.getAttribute("d") ?? "");
    const workspace = document.querySelector(".workspace");

    if (!root || !parentNode || !childNode || !workspace) {
      return null;
    }

    return {
      rootParentGap: Math.round(parentNode.left - root.right),
      parentChildGap: Math.round(childNode.left - parentNode.right),
      panX: getComputedStyle(workspace).getPropertyValue("--workspace-pan-x").trim(),
      panY: getComputedStyle(workspace).getPropertyValue("--workspace-pan-y").trim(),
      connectorCount: connectorPaths.length,
      allConnectorsAreBezier: connectorPaths.every((path) => path.includes(" C "))
    };
  });

  expect(mobileState).not.toBeNull();
  expect(mobileState!.rootParentGap).toBeGreaterThan(0);
  expect(mobileState!.parentChildGap).toBeGreaterThan(0);
  expect(mobileState!.panX).toBe("60px");
  expect(mobileState!.panY).toBe("40px");
  expect(mobileState!.connectorCount).toBe(2);
  expect(mobileState!.allConnectorsAreBezier).toBe(true);
});

test("empty nodes stay compact and grow with text", async ({ page }) => {
  const node = page.locator(".node-input");
  const emptyWidth = await elementWidth(node);

  expect(emptyWidth).toBeLessThanOrEqual(70);

  await node.fill("마인드맵 테스트");
  const filledWidth = await elementWidth(node);

  expect(filledWidth).toBeGreaterThan(emptyWidth);
});

function markdownOutput(page: Page) {
  return page.locator(".markdown-panel pre");
}

function nodeInput(page: Page, path: string) {
  return page.locator(`.node-input[data-node-path="${path}"]`);
}

async function elementWidth(locator: ReturnType<Page["locator"]>): Promise<number> {
  return locator.evaluate((element) => Math.round(element.getBoundingClientRect().width));
}
