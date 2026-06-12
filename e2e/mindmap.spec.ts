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

  await expect(firstNode).toHaveValue(" ");
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
