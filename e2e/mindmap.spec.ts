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
  const root = page.getByLabel("Root heading");
  await root.click();
  await page.keyboard.press("Enter");
  await root.fill("Project");

  const first = nodeInput(page, "right/0");
  await first.click();
  await page.keyboard.press("Enter");
  await first.fill("Idea");

  await expect(markdownOutput(page)).toHaveText("# Project\n\n- Idea\n");
});

test("focused root Enter starts title editing", async ({ page }) => {
  const root = page.getByLabel("Root heading");

  await root.click();
  await expect(root).toBeFocused();
  await expect(root).toHaveAttribute("readonly", "");

  await root.press("Enter");

  await expect(root).not.toHaveAttribute("readonly", "");
  await root.fill("Title");
  await expect(markdownOutput(page)).toHaveText("# Title\n\n-\n");
});

test("MM018 notice explains root title trailing spaces", async ({ page }) => {
  const root = page.getByLabel("Root heading");

  await root.click();
  await root.press("Enter");
  await root.type("Title ");

  const notice = page.locator(".notice");
  await expect(notice).toContainText("MM018");
  await expect(notice).toContainText("Markdown 줄 끝 또는 파일 끝 형식");
  await expect(notice).toContainText("문제 줄:");
  await expect(notice).toContainText("제목 맨 끝 공백");
  await expect(notice).toContainText("잘못된 예:");
  await expect(notice).toContainText("올바른 예:");
});

test("Enter creates a sibling node and undo redo restores it", async ({ page }) => {
  const firstNode = nodeInput(page, "right/0");

  await firstNode.fill("A");
  await firstNode.focus();
  await firstNode.press("Enter");

  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n-\n");

  await nodeInput(page, "right/1").fill("B");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n-\n");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n-\n");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n");
});

test("Enter moves to an existing next sibling before creating one", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");

  await first.focus();
  await first.press("Enter");
  await first.press("Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n");
});

test("empty leaf nodes are removed when they lose focus", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();

  await first.click();

  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(nodeInput(page, "right/1")).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n");
});

test("creating from an empty leaf replaces it instead of leaving another blank", async ({
  page
}) => {
  const first = nodeInput(page, "right/0");

  await first.focus();
  await first.press("Enter");

  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(nodeInput(page, "right/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");
});

test("toolbar can add right and left root nodes", async ({ page }) => {
  await page.getByRole("button", { name: "Add right root node" }).click();
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n-\n");

  await page.getByRole("button", { name: "Add left root node" }).click();
  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n## Right\n\n-\n\n## Left\n\n-\n");
});

test("zoom controls can zoom in and reset", async ({ page }) => {
  const resetZoomButton = page.getByRole("button", { name: "Reset zoom" });

  await expect(resetZoomButton).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(resetZoomButton).toHaveText("110%");
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect(resetZoomButton).toHaveText("100%");
});

test("mouse wheel zooms the canvas in and out", async ({ page }) => {
  const viewport = page.getByLabel("Mindmap canvas");
  const resetZoomButton = page.getByRole("button", { name: "Reset zoom" });
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(resetZoomButton).toHaveText("110%");

  await page.mouse.wheel(0, 100);
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

test("mouse click selects a node and a second click starts editing", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  await first.click();
  await expect(first).toHaveClass(/selected/);
  await expect(first).toHaveAttribute("readonly", "");

  await page.keyboard.type("X");
  await expect(first).toHaveValue("A");

  await first.click();
  await expect(first).not.toHaveAttribute("readonly", "");
  await page.keyboard.press("End");
  await page.keyboard.type("X");

  await expect(first).toHaveValue("AX");
});

test("mouse drag moves a node before a sibling", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Enter");
  await nodeInput(page, "right/2").fill("C");
  await nodeInput(page, "right/2").press("Escape");

  await dragNodeTo(page, "right/2", "right/0", "before");

  await expect(nodeInput(page, "right/0")).toHaveValue("C");
  await expect(nodeInput(page, "right/1")).toHaveValue("A");
  await expect(nodeInput(page, "right/2")).toHaveValue("B");
  await expect(markdownOutput(page)).toHaveText("#\n\n- C\n- A\n- B\n");
});

test("mouse drag shows a visible node preview while moving", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  const sourceBox = await nodeByPath(page, "right/1").boundingBox();
  const targetBox = await nodeByPath(page, "right/0").boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    (sourceBox!.x + targetBox!.x) / 2,
    (sourceBox!.y + targetBox!.y) / 2,
    { steps: 8 }
  );

  const preview = page.locator(".node-drag-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveText("B");
  await expect(page.locator(".node-drag-snap-line")).toHaveCount(1);
  await expect(page.locator(".node-drag-snap-dot")).toHaveCount(2);

  const previewBox = await preview.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.width).toBeGreaterThan(0);
  expect(previewBox!.height).toBeGreaterThan(0);

  await page.mouse.up();
});

test("mouse drag snaps to a nearby node before dropping", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  const sourceBox = await nodeByPath(page, "right/1").boundingBox();
  const targetBox = await nodeByPath(page, "right/0").boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const snapX = targetBox!.x + targetBox!.width + 52;
  const snapY = targetBox!.y + targetBox!.height / 2;
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(snapX, snapY, { steps: 8 });

  await expect(page.locator(".node-drag-snap-line")).toHaveCount(1);
  await expect(page.locator(".node-drag-snap-dot")).toHaveCount(2);
  await expect(nodeInput(page, "right/0")).toHaveClass(/drop-inside/);

  await page.mouse.up();

  await expect(nodeInput(page, "right/0")).toHaveValue("A");
  await expect(nodeInput(page, "right/0/0")).toHaveValue("B");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  - B\n");
});

test("mouse drag can reparent a node", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  await dragNodeTo(page, "right/1", "right/0", "inside");

  await expect(nodeInput(page, "right/0")).toHaveValue("A");
  await expect(nodeInput(page, "right/0/0")).toHaveValue("B");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  - B\n");
});

test("mouse drag onto the root moves a node to the left branch", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  await dragNodeTo(page, "right/1", "root", "inside", "left");

  await expect(nodeInput(page, "right/0")).toHaveValue("A");
  await expect(nodeInput(page, "left/0")).toHaveValue("B");
  await expect(markdownOutput(page)).toHaveText(
    "#\n\n## Right\n\n- A\n\n## Left\n\n- B\n"
  );
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

test("left branch arrows follow the nearest visible node", async ({ page }) => {
  const root = page.getByLabel("Root heading");

  await page.getByRole("button", { name: "Add left root node" }).click();
  const left = nodeInput(page, "left/0");
  await expect(left).toBeFocused();

  await left.press("Tab");
  const leftChild = nodeInput(page, "left/0/0");
  await expect(leftChild).toBeFocused();
  await leftChild.fill("left child");

  await leftChild.press("Escape");
  await page.keyboard.press("ArrowRight");

  await expect(left).toHaveClass(/selected/);
  await expect(leftChild).not.toHaveClass(/selected/);

  await page.keyboard.press("ArrowLeft");

  await expect(leftChild).toHaveClass(/selected/);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  await expect(root).toHaveClass(/selected/);

  await page.keyboard.press("ArrowLeft");

  await expect(left).toHaveClass(/selected/);
});

test("selection mode Enter starts editing without moving nodes", async ({ page }) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");
  await nodeInput(page, "right/0/0").fill("Child");

  await parent.focus();
  await parent.press("Escape");
  await page.keyboard.press("Enter");

  await expect(parent).not.toHaveAttribute("readonly", "");
  await expect(page.locator(".node-input")).toHaveCount(2);
  await page.keyboard.press("End");
  await page.keyboard.type("!");

  await expect(parent).toHaveValue("Parent!");
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent!\n  - Child\n");
});

test("ArrowDown moves to the nearest lower visible node", async ({
  page
}) => {
  const parent = nodeInput(page, "right/0");

  await parent.fill("A");
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeFocused();
  await nodeInput(page, "right/0/0").fill("A-1");

  await parent.focus();
  await parent.press("Enter");
  await parent.press("Enter");
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await nodeInput(page, "right/1").fill("B");

  await parent.focus();
  await parent.press("Escape");
  await page.keyboard.press("ArrowDown");

  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/0/0")).not.toHaveClass(/selected/);

  await page.keyboard.press("ArrowUp");

  await expect(parent).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/1")).not.toHaveClass(/selected/);
});

test("ArrowUp keeps child-column focus in the same visual lane", async ({
  page
}) => {
  const parentA = nodeInput(page, "right/0");
  await parentA.fill("A");
  await parentA.press("Tab");
  const childA = nodeInput(page, "right/0/0");
  await expect(childA).toBeFocused();
  await childA.fill("A-1");

  await childA.press("Shift+Tab");
  await parentA.press("Enter");
  const parentB = nodeInput(page, "right/1");
  await expect(parentB).toBeFocused();
  await parentB.fill("B");
  await parentB.press("Tab");
  const childB = nodeInput(page, "right/1/0");
  await expect(childB).toBeFocused();
  await childB.fill("B-1");
  await childB.press("Escape");

  await page.keyboard.press("ArrowUp");

  await expect(childA).toHaveClass(/selected/);
  await expect(parentA).not.toHaveClass(/selected/);
  await expect(parentB).not.toHaveClass(/selected/);
});

test("horizontal arrows move one generation at a time", async ({ page }) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");

  const child = nodeInput(page, "right/0/0");
  await expect(child).toBeFocused();
  await child.fill("Child");
  await child.press("Tab");

  const grandchild = nodeInput(page, "right/0/0/0");
  await expect(grandchild).toBeFocused();
  await grandchild.fill("Grandchild");

  await parent.focus();
  await parent.press("Escape");
  await page.keyboard.press("ArrowRight");

  await expect(child).toHaveClass(/selected/);
  await expect(grandchild).not.toHaveClass(/selected/);

  await page.keyboard.press("ArrowRight");

  await expect(grandchild).toHaveClass(/selected/);
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

test("Tab while editing moves to an existing first child before creating one", async ({
  page
}) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");
  await nodeInput(page, "right/0/0").fill("Child");

  await parent.focus();
  await parent.press("Enter");
  await parent.press("Tab");

  await expect(nodeInput(page, "right/0/0")).toBeFocused();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent\n  - Child\n");
});

test("Shift+Enter while editing focuses the previous sibling", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");

  const second = nodeInput(page, "right/1");
  await expect(second).toBeFocused();
  await second.press("Shift+Enter");

  await expect(first).toBeFocused();
  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n");
});

test("Shift+Enter while editing creates a previous sibling when none exists", async ({
  page
}) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Shift+Enter");

  await expect(nodeInput(page, "right/0")).toBeFocused();
  await expect(nodeInput(page, "right/1")).toHaveValue("A");
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n- A\n");
});

test("Shift+Tab while editing focuses the parent without changing structure", async ({
  page
}) => {
  const parent = nodeInput(page, "right/0");
  await parent.focus();
  await parent.press("Tab");

  const child = nodeInput(page, "right/0/0");
  await expect(child).toBeFocused();
  await child.fill("Child");
  await child.press("Shift+Tab");

  await expect(parent).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n  - Child\n");
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
  await nodeInput(page, "right/0/0").fill("Child");

  await parent.focus();
  await parent.press("Enter");
  await parent.press("Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n  - Child\n-\n");
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
  let currentNode = nodeInput(page, "right/0");

  await currentNode.fill("Node 0");
  for (let index = 0; index < 4; index += 1) {
    await currentNode.press("Enter");
    currentNode = nodeInput(page, `right/${index + 1}`);
    await currentNode.fill(`Node ${index + 1}`);
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
    const root = document
      .querySelector('[data-node-path="root"]')
      ?.getBoundingClientRect();
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
  await nodeInput(page, "right/0/0").fill("Child");

  await page.mouse.move(24, 210);
  await page.mouse.down();
  await page.mouse.move(84, 250);
  await page.mouse.up();

  const mobileState = await page.evaluate(() => {
    const root = document
      .querySelector('[data-node-path="root"]')
      ?.getBoundingClientRect();
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

test("long node text wraps instead of clipping", async ({ page }) => {
  const node = nodeInput(page, "right/0");
  const emptyHeight = await elementHeight(node);
  const longText =
    "긴 문장이 들어와도 노드 안에서 자연스럽게 줄바꿈되어야 하고 뒤쪽 문장이 사라지면 안 됩니다. " +
    "This sentence should wrap across multiple visual lines inside the node.";

  await node.fill(longText);

  const wrappedBox = await node.evaluate((element) => {
    const area = element as HTMLTextAreaElement;
    const rect = area.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      clientHeight: area.clientHeight,
      scrollHeight: area.scrollHeight,
      overflowWrap: getComputedStyle(area).overflowWrap
    };
  });

  expect(wrappedBox.width).toBe(340);
  expect(wrappedBox.height).toBeGreaterThan(emptyHeight + 24);
  expect(wrappedBox.scrollHeight - wrappedBox.clientHeight).toBeLessThanOrEqual(4);
  expect(wrappedBox.overflowWrap).toBe("anywhere");
  await expect(node).toHaveValue(longText);
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

function nodeByPath(page: Page, path: string) {
  return page.locator(`[data-node-path="${path}"]`);
}

async function dragNodeTo(
  page: Page,
  sourcePath: string,
  targetPath: string,
  position: "before" | "after" | "inside",
  rootSide: "left" | "right" = "right"
) {
  const sourceBox = await nodeByPath(page, sourcePath).boundingBox();
  const targetBox = await nodeByPath(page, targetPath).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const targetX =
    targetPath === "root"
      ? targetBox!.x + targetBox!.width * (rootSide === "left" ? 0.25 : 0.75)
      : targetBox!.x + targetBox!.width / 2;
  const targetY =
    targetBox!.y +
    targetBox!.height *
      (position === "before" ? 0.12 : position === "after" ? 0.88 : 0.5);

  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();
}

async function elementWidth(locator: ReturnType<Page["locator"]>): Promise<number> {
  return locator.evaluate((element) => Math.round(element.getBoundingClientRect().width));
}

async function elementHeight(locator: ReturnType<Page["locator"]>): Promise<number> {
  return locator.evaluate((element) => Math.round(element.getBoundingClientRect().height));
}
