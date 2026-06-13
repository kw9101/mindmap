import { expect, test, type Locator, type Page } from "@playwright/test";

const actualConnectorSelector = ".connector-layer path:not(.virtual-connector)";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(virtualRightRootInput(page)).toBeVisible();
});

test("initial document renders virtual start nodes", async ({ page }) => {
  await expect(page.locator(".file-name")).toHaveText("untitled.md");
  await expect(page.getByText("browser preview")).toBeVisible();
  await expect(page.getByLabel("Root heading")).toHaveValue("");
  await expect(page.locator(".node-input")).toHaveCount(0);
  await expect(virtualRightRootInput(page)).toBeVisible();
  await expect(virtualRightRootInput(page)).toHaveClass(/transient-empty/);
  await expect(virtualLeftRootInput(page)).toBeVisible();
  await expect(virtualLeftRootInput(page)).toHaveClass(/transient-empty/);
  await expect(page.locator(".connector-layer path.virtual-connector")).toHaveCount(2);
  await expect(markdownOutput(page)).toHaveText("#\n");
});

test("layout overview mirrors the visible mindmap", async ({ page }) => {
  await expect(page.locator(".layout-overview")).toBeVisible();
  await expect(page.locator(".layout-overview-node")).toHaveCount(3);
  await expect(
    page.locator(".layout-overview-connector.virtual-connector")
  ).toHaveCount(2);
  await expect(page.locator(".layout-overview-viewport")).toBeVisible();

  await virtualRightRootInput(page).press("Enter");
  await nodeInput(page, "right/0").fill("Parent");
  await nodeInput(page, "right/0").press("Tab");
  await nodeInput(page, "right/0/0").fill("Child");

  await expect(page.locator(".layout-overview-node")).toHaveCount(4);
  await expect(page.locator(".layout-overview-node.node-level-1")).toHaveCount(1);
  await expect(page.locator(".layout-overview-node.node-level-2")).toHaveCount(1);
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

test("IME composition in the first node commits after the syllable is composed", async ({
  page
}) => {
  await virtualRightRootInput(page).press("Enter");
  const first = nodeInput(page, "right/0");
  await expect(first).toBeFocused();

  await startComposition(first);
  await updateComposedText(first, "ㅁ");
  await expect(first).toHaveValue("ㅁ");
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");

  await updateComposedText(first, "뭐지?");
  await endComposition(first, "뭐지?");

  await expect(first).toHaveValue("뭐지?");
  await expect(markdownOutput(page)).toHaveText("#\n\n- 뭐지?\n");
});

test("IME composition keeps the composed syllable before following text", async ({
  page
}) => {
  await virtualRightRootInput(page).press("Enter");
  const first = nodeInput(page, "right/0");
  await expect(first).toBeFocused();

  await startComposition(first);
  await updateComposedText(first, "뭐");
  await endComposition(first, "뭐");
  await updateInputText(first, "뭐지");
  await updateInputText(first, "뭐지?");

  await expect(first).toHaveValue("뭐지?");
  await expect(markdownOutput(page)).toHaveText("#\n\n- 뭐지?\n");
});

test("IME composition keeps the first phrase at the front of a longer sentence", async ({
  page
}) => {
  await virtualRightRootInput(page).press("Enter");
  const first = nodeInput(page, "right/0");
  await expect(first).toBeFocused();

  await startComposition(first);
  await updateComposedText(first, "이번에도");
  await endComposition(first, "이번에도");
  await updateInputText(first, "이번에도 ");
  await startComposition(first);
  await updateComposedText(first, "이번에도 잘");
  await endComposition(first, "잘");
  await updateInputText(first, "이번에도 잘 되나 ");
  await startComposition(first);
  await updateComposedText(first, "이번에도 잘 되나 보자");
  await endComposition(first, "보자");
  await updateInputText(first, "이번에도 잘 되나 보자?");

  await expect(first).toHaveValue("이번에도 잘 되나 보자?");
  await expect(markdownOutput(page)).toHaveText("#\n\n- 이번에도 잘 되나 보자?\n");
});

test("IME composition stays ordered after virtual right and left roots materialize", async ({
  page
}) => {
  await virtualRightRootInput(page).focus();
  const right = nodeInput(page, "right/0");
  await expect(right).toBeFocused();

  await startComposition(right);
  await updateComposedText(right, "뭐");
  await endComposition(right, "뭐");
  await updateInputText(right, "뭐지?");

  await expect(right).toHaveValue("뭐지?");
  await expect(markdownOutput(page)).toHaveText("#\n\n- 뭐지?\n");

  await virtualLeftRootInput(page).focus();
  const left = nodeInput(page, "left/0");
  await expect(left).toBeFocused();

  await startComposition(left);
  await updateComposedText(left, "왼쪽");
  await endComposition(left, "왼쪽");
  await updateInputText(left, "왼쪽?");

  await expect(left).toHaveValue("왼쪽?");
  await expect(markdownOutput(page)).toHaveText(
    "#\n\n## Right\n\n- 뭐지?\n\n## Left\n\n- 왼쪽?\n"
  );
});

test("focused root Enter starts title editing", async ({ page }) => {
  const root = page.getByLabel("Root heading");

  await root.click();
  await expect(root).toBeFocused();
  await expect(root).toHaveAttribute("readonly", "");

  await root.press("Enter");

  await expect(root).not.toHaveAttribute("readonly", "");
  await root.fill("Title");
  await expect(markdownOutput(page)).toHaveText("# Title\n");
});

test("root title trailing spaces stay local while markdown remains canonical", async ({
  page
}) => {
  const root = page.getByLabel("Root heading");

  await root.click();
  await root.press("Enter");
  await updateInputText(root, "이번에도 잘 되나");
  await expect(markdownOutput(page)).toHaveText("# 이번에도 잘 되나\n");

  await updateInputText(root, "이번에도 잘 되나 ");

  await expect(root).toHaveValue("이번에도 잘 되나 ");
  await expect(markdownOutput(page)).toHaveText("# 이번에도 잘 되나\n");
  await expect(page.locator(".notice")).toHaveCount(0);

  await updateInputText(root, "이번에도 잘 되나 보자?");

  await expect(root).toHaveValue("이번에도 잘 되나 보자?");
  await expect(markdownOutput(page)).toHaveText("# 이번에도 잘 되나 보자?\n");
});

test("root title keeps the caret after a trailing space", async ({ page }) => {
  const root = page.getByLabel("Root heading");

  await root.click();
  await root.press("Enter");
  await updateInputText(root, "이번에도");
  await expect(markdownOutput(page)).toHaveText("# 이번에도\n");

  await updateInputText(root, "이번에도 ");

  await expect(root).toHaveValue("이번에도 ");
  await expect(markdownOutput(page)).toHaveText("# 이번에도\n");
  await expect.poll(() => textSelection(root)).toEqual({
    start: "이번에도 ".length,
    end: "이번에도 ".length
  });

  await insertTextAtSelection(root, "잘 되나 보자?");

  await expect(root).toHaveValue("이번에도 잘 되나 보자?");
  await expect(markdownOutput(page)).toHaveText("# 이번에도 잘 되나 보자?\n");
});

test("root title IME composition keeps following text after the first phrase", async ({
  page
}) => {
  const root = page.getByLabel("Root heading");

  await root.click();
  await root.press("Enter");
  await startComposition(root);
  await updateComposedText(root, "이번에도");
  await endComposition(root, "이번에도");
  await expect(markdownOutput(page)).toHaveText("# 이번에도\n");

  await updateInputText(root, "이번에도 ");

  await expect(root).toHaveValue("이번에도 ");
  await expect(markdownOutput(page)).toHaveText("# 이번에도\n");
  await expect.poll(() => textSelection(root)).toEqual({
    start: "이번에도 ".length,
    end: "이번에도 ".length
  });

  await insertTextAtSelection(root, "잘 되나 보자?");

  await expect(root).toHaveValue("이번에도 잘 되나 보자?");
  await expect(markdownOutput(page)).toHaveText("# 이번에도 잘 되나 보자?\n");
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

  await openMoreActions(page);
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

test("Cmd/Ctrl+Enter while editing inserts a sibling below", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");

  await first.click();
  await page.keyboard.press("Enter");
  await expect(first).not.toHaveAttribute("readonly", "");

  await page.keyboard.press("Control+Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(nodeInput(page, "right/1")).toHaveValue("");
  await expect(nodeInput(page, "right/2")).toHaveValue("B");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n-\n- B\n");
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

test("empty leaf nodes look transient until content is typed", async ({ page }) => {
  await virtualRightRootInput(page).press("Enter");
  const node = page.locator('.node-input[data-node-path="right/0"]');
  const transientConnector = page.locator(".connector-layer path.transient-connector");

  await expect(node).toHaveClass(/transient-empty/);
  await expect(transientConnector).toHaveCount(1);
  await expect.poll(() => elementBorderStyle(node)).toBe("dashed");
  await expect.poll(() => elementBorderColor(node)).not.toBe("rgb(77, 136, 255)");
  await expect.poll(() => elementBoxShadow(node)).not.toContain("220, 232, 255");
  await expect.poll(() => elementOutlineStyle(node)).toBe("none");
  await expect.poll(() => elementStrokeDasharray(transientConnector)).toBe("5px, 5px");
  await expect.poll(() => elementOpacity(node)).toBe("0.62");

  await node.fill("A");

  await expect(node).not.toHaveClass(/transient-empty/);
  await expect(transientConnector).toHaveCount(0);
  await expect.poll(() => elementBorderStyle(node)).toBe("solid");
  await expect.poll(() => elementOpacity(node)).toBe("1");
});

test("empty parent nodes are not shown as transient", async ({ page }) => {
  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");

  await parent.hover();
  await page
    .getByRole("button", { exact: true, name: "Add child to Node right/0" })
    .click();

  await expect(parent).not.toHaveClass(/transient-empty/);
  await expect(nodeInput(page, "right/0/0")).toHaveClass(/transient-empty/);
});

test("keyboard navigation into the virtual left root materializes a left node", async ({
  page
}) => {
  await virtualRightRootInput(page).press("Enter");
  const first = nodeInput(page, "right/0");

  await first.fill("A");
  await first.press("Escape");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");

  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(virtualLeftRootInput(page)).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText(
    "#\n\n## Right\n\n- A\n\n## Left\n\n-\n"
  );
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

test("Enter on an empty leaf keeps focus instead of jumping to the previous node", async ({
  page
}) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");

  const empty = nodeInput(page, "right/1");
  await expect(empty).toBeFocused();

  await empty.press("Enter");

  await expect(page.locator(".node-input")).toHaveCount(2);
  await expect(empty).toBeFocused();
  await expect(nodeInput(page, "right/0")).not.toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n-\n");
});

test("virtual start nodes create right and left root nodes", async ({ page }) => {
  await virtualRightRootInput(page).press("Enter");
  await expect(nodeInput(page, "right/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");

  await virtualLeftRootInput(page).press("Enter");
  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n## Right\n\n-\n\n## Left\n\n-\n");
});

test("focusing virtual start nodes materializes real editable nodes before typing", async ({
  page
}) => {
  await virtualRightRootInput(page).focus();

  await expect(nodeInput(page, "right/0")).toBeFocused();
  await expect(virtualRightRootInput(page)).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");

  await virtualLeftRootInput(page).focus();

  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(virtualLeftRootInput(page)).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n## Right\n\n-\n\n## Left\n\n-\n");
});

test("Normalize reports when markdown is already canonical", async ({ page }) => {
  const node = nodeInput(page, "right/0");
  await node.fill("A");

  await openMoreActions(page);
  await page.getByRole("button", { name: "Normalize" }).click();

  await expect(page.locator(".notice")).toContainText("이미 정규화된 Markdown입니다.");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n");
});

test("parse errors offer auto normalize from the diagnostics screen", async ({
  page
}) => {
  await mockTauriOpenMarkdown(page, "# Broken \n\n- A\n");

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".diagnostics")).toContainText("MM018");

  await page.getByRole("button", { name: "Auto Normalize" }).click();

  await expect(page.locator(".diagnostics")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("Markdown을 정규화했습니다.");
  await expect(markdownOutput(page)).toHaveText("# Broken\n\n- A\n");
});

test("zoom controls can zoom in and reset", async ({ page }) => {
  await openMoreActions(page);
  const resetZoomButton = page.getByRole("button", { name: "Reset zoom" });

  await expect(resetZoomButton).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(resetZoomButton).toHaveText("110%");
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect(resetZoomButton).toHaveText("100%");
});

test("mouse wheel zooms the canvas in and out", async ({ page }) => {
  await openMoreActions(page);
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

  await openMoreActions(page);
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

test("pan controls display and nudge the workspace offset", async ({ page }) => {
  await openMoreActions(page);
  const workspace = page.locator(".workspace");
  const panOffset = page.getByLabel("Pan offset");

  await expect(panOffset).toHaveText("X 0 Y 0");
  await page.getByRole("button", { name: "Pan right" }).click();
  await page.getByRole("button", { name: "Pan down" }).click();

  await expect(panOffset).toHaveText("X 8 Y 8");
  await expect
    .poll(() =>
      workspace.evaluate((element) => ({
        x: getComputedStyle(element).getPropertyValue("--workspace-pan-x").trim(),
        y: getComputedStyle(element).getPropertyValue("--workspace-pan-y").trim()
      }))
    )
    .toEqual({ x: "8px", y: "8px" });

  await page.getByRole("button", { name: "Pan left" }).click();
  await page.getByRole("button", { name: "Pan up" }).click();

  await expect(panOffset).toHaveText("X 0 Y 0");
});

test("markdown panel starts left and can resize and dock by dragging", async ({
  page
}) => {
  const layout = page.locator(".document-layout");
  const panel = page.getByLabel("Markdown output");
  const canvas = page.getByLabel("Mindmap canvas");
  const resizeHandle = page.getByRole("separator", {
    name: "Resize Markdown panel"
  });
  const dockHandle = page.getByRole("button", { name: "Move Markdown pane" });

  await expect(layout).toHaveClass(/markdown-left/);
  await expect(page.getByLabel("Markdown pane controls")).toBeVisible();
  await expect(dockHandle).toBeVisible();
  await expect(markdownOutput(page)).toHaveText("#\n");
  expect(await elementWidth(panel)).toBeGreaterThanOrEqual(300);

  const initialLeftLayout = await sideBySideLayout(panel, canvas);
  expect(initialLeftLayout).not.toBeNull();
  expect(initialLeftLayout!.panelRight).toBeLessThanOrEqual(
    initialLeftLayout!.canvasLeft + 2
  );

  await dragLocatorBy(page, resizeHandle, 100, 0);
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "420");
  expect(await elementWidth(panel)).toBeGreaterThanOrEqual(400);

  await dragLocatorBy(page, dockHandle, 1120, 0);
  await expect(layout).toHaveClass(/markdown-right/);
  expect(await elementWidth(panel)).toBeGreaterThanOrEqual(400);

  await dragLocatorBy(page, resizeHandle, -80, 0);
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "500");
  expect(await elementWidth(panel)).toBeGreaterThanOrEqual(490);

  const rightLayout = await sideBySideLayout(panel, canvas);
  expect(rightLayout).not.toBeNull();
  expect(rightLayout!.panelLeft).toBeGreaterThanOrEqual(rightLayout!.canvasRight - 2);

  await dragLocatorBy(page, dockHandle, -520, 0);
  await expect(layout).toHaveClass(/markdown-bottom/);
});

test("node search highlights matches and jumps between nodes", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("Alpha");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("Beta Alpha");

  await page.keyboard.press("Control+F");
  const search = page.getByLabel("Search nodes");
  await expect(search).toBeFocused();
  await search.fill("alpha");

  await expect(page.getByLabel("Search result count")).toHaveText("1/2");
  await expect(nodeInput(page, "right/0")).toHaveClass(/search-match/);
  await expect(nodeInput(page, "right/1")).toHaveClass(/search-match/);

  await search.press("Enter");

  await expect(page.getByLabel("Search result count")).toHaveText("2/2");
  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/1")).toHaveAttribute("readonly", "");

  await page.getByRole("button", { name: "Previous search match" }).click();

  await expect(page.getByLabel("Search result count")).toHaveText("1/2");
  await expect(nodeInput(page, "right/0")).toHaveClass(/selected/);
});

test("node search expands collapsed ancestors before selecting a match", async ({
  page
}) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");
  await nodeInput(page, "right/0/0").fill("Hidden Alpha");
  await nodeInput(page, "right/0/0").press("Escape");
  await nodeInput(page, "right/0").focus();
  await page.keyboard.press("Space");

  await expect(nodeInput(page, "right/0/0")).toHaveCount(0);

  const search = page.getByLabel("Search nodes");
  await search.fill("hidden");
  await search.press("Enter");

  await expect(nodeInput(page, "right/0/0")).toBeVisible();
  await expect(nodeInput(page, "right/0/0")).toHaveClass(/selected/);
  await expect(page.getByLabel("Search result count")).toHaveText("1/1");
});

test("node action buttons are not shown inline", async ({ page }) => {
  await expect(page.getByRole("button", { exact: true, name: "Add child node" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Add sibling node" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Delete node" })).toHaveCount(0);
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

test("command palette opens from shortcut and focuses node search", async ({
  page
}) => {
  await page.keyboard.press("Control+K");

  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  const input = page.getByLabel("Command palette input");
  await expect(input).toBeFocused();

  await input.fill("find");
  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Search nodes")).toBeFocused();
});

test("command palette can run node commands", async ({ page }) => {
  await page.keyboard.press("Control+K");
  const input = page.getByLabel("Command palette input");
  await input.fill("left root");
  await page.keyboard.press("Enter");

  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n## Right\n\n## Left\n\n-\n");
});

test("shortcut help keeps question mark editable and opens from selection mode", async ({
  page
}) => {
  const firstNode = nodeInput(page, "right/0");

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

test("selection and editing modes have distinct visual states", async ({ page }) => {
  const node = nodeInput(page, "right/0");
  await node.fill("Idea");
  await node.press("Escape");

  await expect(node).toHaveAttribute("readonly", "");
  await expect(node).toHaveClass(/selected/);
  await expect(node).not.toHaveClass(/editing/);

  await node.press("Enter");

  await expect(node).not.toHaveAttribute("readonly", "");
  await expect(node).toHaveClass(/selected/);
  await expect(node).toHaveClass(/editing/);
});

test("node levels have distinct visual styles", async ({ page }) => {
  const level1 = nodeInput(page, "right/0");
  await level1.fill("Level 1");
  await level1.press("Tab");

  const level2 = nodeInput(page, "right/0/0");
  await level2.fill("Level 2");
  await level2.press("Tab");

  const level3 = nodeInput(page, "right/0/0/0");
  await level3.fill("Level 3");
  await level3.press("Tab");

  const level4 = nodeInput(page, "right/0/0/0/0");
  await level4.fill("Level 4");
  await level4.press("Escape");
  await page.getByLabel("Root heading").click();

  await expect(level1).toHaveClass(/node-level-1/);
  await expect(level2).toHaveClass(/node-level-2/);
  await expect(level3).toHaveClass(/node-level-3/);
  await expect(level4).toHaveClass(/node-level-deep/);

  const styles = await Promise.all(
    [level1, level2, level3, level4].map(async (node) => ({
      backgroundImage: await elementBackgroundImage(node),
      backgroundColor: await elementBackgroundColor(node),
      borderColor: await elementBorderColor(node),
      color: await elementColor(node),
      fontWeight: await elementFontWeight(node)
    }))
  );
  expect(styles.every(({ backgroundImage }) => backgroundImage === "none")).toBe(true);
  expect(new Set(styles.map(({ backgroundColor }) => backgroundColor)).size).toBe(4);
  expect(new Set(styles.map(({ borderColor }) => borderColor)).size).toBe(4);
  expect(new Set(styles.map(({ color }) => color)).size).toBe(4);
  expect(new Set(styles.map(({ fontWeight }) => fontWeight)).size).toBe(4);

  const markdownLineColors = await page.evaluate(() =>
    ["1", "2", "3", "deep"].map((level) => {
      const element = document.querySelector(`.markdown-line-level-${level}`);
      return element ? getComputedStyle(element).color : null;
    })
  );
  expect(markdownLineColors.every((color) => color !== null)).toBe(true);
  expect(new Set(markdownLineColors).size).toBe(4);

  const connectorWidths = await Promise.all(
    [
      page.locator(".connector-layer path.connector-level-1"),
      page.locator(".connector-layer path.connector-level-2"),
      page.locator(".connector-layer path.connector-level-3"),
      page.locator(".connector-layer path.connector-level-deep")
    ].map((connector) => elementStrokeWidth(connector))
  );
  expect(connectorWidths).toEqual([2.6, 2.2, 1.8, 1.5]);
});

test("node hover handles add children siblings and delete nodes", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Escape");
  await expect.poll(() => nodeActionOpacity(page, "right/0")).toBe("0");

  await first.hover();
  await expect.poll(() => nodeActionOpacity(page, "right/0")).toBe("1");
  await page
    .getByRole("button", { exact: true, name: "Add child to Node right/0" })
    .click();
  await expect(nodeInput(page, "right/0/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  -\n");
  await nodeInput(page, "right/0/0").fill("Child");

  await first.hover();
  await page
    .getByRole("button", { exact: true, name: "Add sibling after Node right/0" })
    .click();
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  - Child\n-\n");

  await nodeInput(page, "right/1").hover();
  await page.getByRole("button", { exact: true, name: "Delete Node right/1" }).click();
  await expect(nodeInput(page, "right/1")).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  - Child\n");
});

test("node hover handles stay visible while moving from node to action", async ({
  page
}) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Escape");

  const addChild = page.getByRole("button", {
    exact: true,
    name: "Add child to Node right/0"
  });

  await first.hover();
  await expect.poll(() => nodeActionOpacity(page, "right/0")).toBe("1");

  const actionBox = await addChild.boundingBox();
  expect(actionBox).not.toBeNull();
  await page.mouse.move(actionBox!.x - 4, actionBox!.y + actionBox!.height / 2);

  await expect.poll(() => nodeActionOpacity(page, "right/0")).toBe("1");

  await addChild.click();
  await expect(nodeInput(page, "right/0/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  -\n");
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

test("mouse drag snaps to a horizontal inside target from farther away", async ({
  page
}) => {
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
    targetBox!.x + targetBox!.width + 148,
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 }
  );

  await expect(page.locator(".node-drag-snap-line")).toHaveCount(1);
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

test("Enter on the remaining right root node creates a right sibling after dragging another node left", async ({
  page
}) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  await dragNodeTo(page, "right/1", "root", "inside", "left");

  const remainingRight = nodeInput(page, "right/0");
  await remainingRight.click();
  await remainingRight.press("Enter");
  await remainingRight.press("Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(nodeInput(page, "left/0")).not.toBeFocused();
  await expect(markdownOutput(page)).toHaveText(
    "#\n\n## Right\n\n- A\n-\n\n## Left\n\n- B\n"
  );
});

test("arrow navigation can move between the first node and the root", async ({ page }) => {
  const root = page.getByLabel("Root heading");
  const firstNode = nodeInput(page, "right/0");

  await firstNode.fill("A");
  await firstNode.focus();
  await firstNode.press("Escape");
  await page.keyboard.press("ArrowLeft");

  await expect(root).toHaveClass(/selected/);
  await expect(firstNode).not.toHaveClass(/selected/);

  await page.keyboard.press("ArrowRight");

  await expect(root).not.toHaveClass(/selected/);
  await expect(firstNode).toHaveClass(/selected/);
});

test("Enter edits the root after arrow navigation selects it", async ({ page }) => {
  const root = page.getByLabel("Root heading");
  const firstNode = nodeInput(page, "right/0");

  await firstNode.fill("A");
  await firstNode.press("Escape");
  await page.keyboard.press("ArrowLeft");

  await expect(root).toHaveClass(/selected/);
  await expect(root).toBeFocused();
  await expect(root).toHaveAttribute("readonly", "");

  await page.keyboard.press("Enter");

  await expect(root).not.toHaveAttribute("readonly", "");
  await expect(root).toBeFocused();
});

test("left branch arrows follow the nearest visible node", async ({ page }) => {
  const root = page.getByLabel("Root heading");

  await virtualLeftRootInput(page).press("Enter");
  const left = nodeInput(page, "left/0");
  await expect(left).toBeFocused();

  await left.fill("left parent");
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
  await expect(parent).toBeFocused();
  await expect(page.locator(".node-input")).toHaveCount(2);
  await parent.evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    input.setSelectionRange(input.value.length, input.value.length);
  });
  await page.keyboard.type("!");

  await expect(parent).toHaveValue("Parent!");
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent!\n  - Child\n");
});

test("selection mode Cmd/Ctrl+Enter inserts a sibling below", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  await first.click();
  await expect(first).toHaveAttribute("readonly", "");

  await page.keyboard.press("Control+Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(nodeInput(page, "right/1")).not.toHaveAttribute("readonly", "");
  await expect(nodeInput(page, "right/2")).toHaveValue("B");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n-\n- B\n");
});

test("selection mode Tab stays in the app and creates or selects child nodes", async ({
  page
}) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Escape");

  await page.keyboard.press("Tab");

  const child = nodeInput(page, "right/0/0");
  await expect(child).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent\n  -\n");

  await child.fill("Child");
  await child.press("Shift+Tab");
  await expect(parent).toBeFocused();
  await parent.press("Escape");

  await page.keyboard.press("Tab");

  await expect(child).toHaveClass(/selected/);
  await expect(child).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Open" })).not.toBeFocused();

  await page.keyboard.press("Shift+Tab");

  await expect(parent).toHaveClass(/selected/);
  await expect(child).not.toHaveClass(/selected/);
});

test("selection mode clipboard copies and pastes subtrees", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:1421"
  });

  const parent = nodeInput(page, "right/0");
  await parent.fill("A");
  await parent.press("Tab");
  const child = nodeInput(page, "right/0/0");
  await child.fill("A-1");
  await child.press("Shift+Tab");
  await parent.press("Enter");
  const target = nodeInput(page, "right/1");
  await target.fill("B");

  await parent.click();
  await expect(parent).toHaveClass(/selected/);
  await expect(parent).toHaveAttribute("readonly", "");

  await page.keyboard.press("Control+C");
  await expect(
    page.evaluate(() => navigator.clipboard.readText())
  ).resolves.toBe("- A\n  - A-1\n");

  await target.click();
  await page.keyboard.press("Control+V");

  await expect(nodeInput(page, "right/2")).toHaveValue("A");
  await expect(nodeInput(page, "right/2/0")).toHaveValue("A-1");
  await expect(markdownOutput(page)).toHaveText(
    "#\n\n- A\n  - A-1\n- B\n- A\n  - A-1\n"
  );
});

test("multi selection copies deletes and moves node blocks", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:1421"
  });

  let current = nodeInput(page, "right/0");
  await current.fill("A");
  for (const [index, text] of ["B", "C", "D"].entries()) {
    await current.press("Enter");
    current = nodeInput(page, `right/${index + 1}`);
    await current.fill(text);
  }
  await current.press("Escape");

  await nodeInput(page, "right/1").click();
  await nodeInput(page, "right/2").click({ modifiers: ["Control"] });

  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/2")).toHaveClass(/selected/);

  await page.keyboard.press("Control+C");
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(
    "- B\n- C\n"
  );

  await nodeInput(page, "right/3").click();
  await page.keyboard.press("Control+V");

  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n- C\n- D\n- B\n- C\n");

  await nodeInput(page, "right/1").click();
  await nodeInput(page, "right/2").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");

  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- D\n- B\n- C\n");

  await nodeInput(page, "right/2").click();
  await nodeInput(page, "right/3").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+ArrowUp");

  await expect(nodeInput(page, "right/1")).toHaveValue("B");
  await expect(nodeInput(page, "right/2")).toHaveValue("C");
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n- C\n- D\n");
});

test("selection mode cuts and pastes subtrees", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:1421"
  });

  const parent = nodeInput(page, "right/0");
  await parent.fill("A");
  await parent.press("Tab");
  await nodeInput(page, "right/0/0").fill("A-1");
  await nodeInput(page, "right/0/0").press("Shift+Tab");
  await parent.press("Enter");
  const target = nodeInput(page, "right/1");
  await target.fill("B");

  await parent.click();
  await page.keyboard.press("Control+X");

  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(
    "- A\n  - A-1\n"
  );
  await expect(markdownOutput(page)).toHaveText("#\n\n- B\n");

  await page.keyboard.press("Control+V");

  await expect(markdownOutput(page)).toHaveText("#\n\n- B\n- A\n  - A-1\n");
});

test("selection mode Cmd/Ctrl arrows move the selected node", async ({ page }) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  await nodeInput(page, "right/1").fill("B");
  await nodeInput(page, "right/1").press("Escape");

  await page.keyboard.press("Control+ArrowUp");

  await expect(nodeInput(page, "right/0")).toHaveValue("B");
  await expect(nodeInput(page, "right/0")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/0")).toBeFocused();
  await expect(nodeInput(page, "right/0")).toHaveAttribute("readonly", "");
  await expect(markdownOutput(page)).toHaveText("#\n\n- B\n- A\n");

  await page.keyboard.press("Control+ArrowDown");

  await expect(nodeInput(page, "right/1")).toHaveValue("B");
  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n");

  await page.keyboard.press("Control+ArrowRight");

  await expect(nodeInput(page, "right/0/0")).toHaveValue("B");
  await expect(nodeInput(page, "right/0/0")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/0/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  - B\n");

  await page.keyboard.press("Control+ArrowLeft");

  await expect(nodeInput(page, "right/1")).toHaveValue("B");
  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n- B\n");

  await page.keyboard.press("Control+ArrowLeft");

  await expect(nodeInput(page, "left/0")).toHaveValue("B");
  await expect(nodeInput(page, "left/0")).toHaveClass(/selected/);
  await expect(nodeInput(page, "left/0")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText(
    "#\n\n## Right\n\n- A\n\n## Left\n\n- B\n"
  );

  await page.keyboard.press("Control+ArrowRight");

  await expect(nodeInput(page, "right/1")).toHaveValue("B");
  await expect(nodeInput(page, "right/1")).toHaveClass(/selected/);
  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n## Right\n\n- A\n- B\n");
});

test("editing mode Cmd/Ctrl arrows move the node and keep editing", async ({
  page
}) => {
  const first = nodeInput(page, "right/0");
  await first.fill("A");
  await first.press("Enter");
  const second = nodeInput(page, "right/1");
  await second.fill("B");

  await second.press("Control+ArrowUp");

  const moved = nodeInput(page, "right/0");
  await expect(moved).toHaveValue("B");
  await expect(moved).toBeFocused();
  await expect(moved).not.toHaveAttribute("readonly", "");

  await page.keyboard.press("End");
  await page.keyboard.type("!");

  await expect(markdownOutput(page)).toHaveText("#\n\n- B!\n- A\n");
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

test("Space collapses and expands selected node children", async ({ page }) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");
  const child = nodeInput(page, "right/0/0");
  await child.fill("Child");
  await child.press("Shift+Tab");
  await parent.press("Escape");

  await page.keyboard.press("Space");

  await expect(nodeInput(page, "right/0/0")).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent\n  - Child\n");

  await page.keyboard.press("Space");

  await expect(nodeInput(page, "right/0/0")).toHaveValue("Child");
});

test("collapsing a node keeps sibling connector layout stable", async ({ page }) => {
  const parent = nodeInput(page, "right/0");
  await parent.fill("Research");
  await parent.press("Tab");
  const child = nodeInput(page, "right/0/0");
  await child.fill("Sources");
  await child.press("Shift+Tab");
  await parent.press("Enter");
  const draft = nodeInput(page, "right/1");
  await draft.fill("Draft");
  await draft.press("Enter");
  const review = nodeInput(page, "right/2");
  await review.fill("Review");
  await review.press("Escape");

  const before = await connectorLayoutSnapshot(page);
  expect(before.connectorCount).toBe(2);

  await parent.click();
  await page.keyboard.press("Space");

  const after = await connectorLayoutSnapshot(page);
  expect(after.connectorCount).toBe(1);
  expect(after.positions).toEqual(before.positions);
  await expect(nodeInput(page, "right/0/0")).toHaveCount(0);
});

test("Tab on an empty leaf keeps focus instead of creating another blank node", async ({
  page
}) => {
  await virtualRightRootInput(page).press("Enter");
  const firstNode = page.locator('.node-input[data-node-path="right/0"]');

  await firstNode.focus();
  await firstNode.press("Tab");

  await expect(page.locator(".node-input")).toHaveCount(1);
  await expect(firstNode).toBeFocused();
  await expect(page.locator('.node-input[data-node-path="right/0/0"]')).toHaveCount(0);
  await expect(markdownOutput(page)).toHaveText("#\n\n-\n");
});

test("Tab while editing creates a child node from a non-empty node", async ({
  page
}) => {
  const firstNode = nodeInput(page, "right/0");
  await firstNode.fill("A");

  await firstNode.press("Tab");

  await expect(page.locator('.node-input[data-node-path="right/0"]')).toBeVisible();
  await expect(page.locator('.node-input[data-node-path="right/0/0"]')).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- A\n  -\n");
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
  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");

  const child = nodeInput(page, "right/0/0");
  await expect(child).toBeFocused();
  await child.fill("Child");
  await child.press("Shift+Tab");

  await expect(parent).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent\n  - Child\n");
});

test("Escape deletes an empty node while editing", async ({ page }) => {
  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");

  await parent.fill("Parent");
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeFocused();

  await nodeInput(page, "right/0/0").press("Escape");

  await expect(nodeInput(page, "right/0/0")).toHaveCount(0);
  await expect(parent).toHaveClass(/selected/);
  await expect(parent).not.toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent\n");
});

test("Enter on a node with children focuses the new sibling", async ({ page }) => {
  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");

  await parent.fill("Parent");
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeFocused();
  await nodeInput(page, "right/0/0").fill("Child");

  await parent.focus();
  await parent.press("Enter");
  await parent.press("Enter");

  await expect(nodeInput(page, "right/1")).toBeFocused();
  await expect(markdownOutput(page)).toHaveText("#\n\n- Parent\n  - Child\n-\n");
});

test("a child node is laid out to the right of its parent", async ({ page }) => {
  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");

  await parent.fill("Parent");
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
  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");

  await parent.fill("Parent");
  await parent.press("Tab");

  await expect(page.locator(actualConnectorSelector)).toHaveCount(2);

  const connectorState = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<SVGPathElement>(
        ".connector-layer path:not(.virtual-connector)"
      )
    ).map((path) => ({
      d: path.getAttribute("d") ?? "",
      stroke: getComputedStyle(path).stroke
    }))
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

  await expect(page.locator(actualConnectorSelector)).toHaveCount(1);
  const connectorPath = await page
    .locator(actualConnectorSelector)
    .getAttribute("d");

  expect(connectorPath).toContain(" C ");
  expect(connectorPath).toContain(" L ");
});

test("IME composing Enter does not create a sibling node", async ({ page }) => {
  await virtualRightRootInput(page).focus();
  const firstNode = nodeInput(page, "right/0");

  await expect(firstNode).toBeFocused();
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
  const firstNode = nodeInput(page, "right/0");

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
  await expect(virtualRightRootInput(page)).toBeVisible();

  const relation = await page.evaluate(() => {
    const root = document
      .querySelector('[data-node-path="root"]')
      ?.getBoundingClientRect();
    const node = document
      .querySelector('[data-node-path="right/__virtual"]')
      ?.getBoundingClientRect();
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
  await expect(virtualRightRootInput(page)).toBeVisible();

  await virtualRightRootInput(page).press("Enter");
  const parent = nodeInput(page, "right/0");
  await parent.fill("Parent");
  await parent.press("Tab");
  await expect(nodeInput(page, "right/0/0")).toBeVisible();
  await nodeInput(page, "right/0/0").fill("Child");

  const viewport = page.getByLabel("Mindmap canvas");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + 24;
  const startY = box!.y + 24;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 40);
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
      document.querySelectorAll<SVGPathElement>(
        ".connector-layer path:not(.virtual-connector)"
      )
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

test("large mindmap layout keeps deep nodes separated and scrollable", async ({
  page
}) => {
  let path = "right/0";
  let current = nodeInput(page, path);
  await current.fill("Depth 0");

  for (let depth = 1; depth <= 13; depth += 1) {
    await current.press("Tab");
    path = `${path}/0`;
    current = nodeInput(page, path);
    await current.fill(`Depth ${depth}`);
  }

  const layout = await page.evaluate(() => {
    const viewport = document.querySelector(".workspace-viewport");
    const workspace = document.querySelector(".workspace");
    const rects = Array.from(document.querySelectorAll(".node-input")).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      };
    });
    const overlapping = rects.some((rect, index) =>
      rects.slice(index + 1).some(
        (other) =>
          rect.left < other.right - 1 &&
          rect.right > other.left + 1 &&
          rect.top < other.bottom - 1 &&
          rect.bottom > other.top + 1
      )
    );

    return {
      overlapping,
      viewportWidth: viewport?.clientWidth ?? 0,
      scrollWidth: viewport?.scrollWidth ?? 0,
      workspaceWidth: workspace?.getBoundingClientRect().width ?? 0
    };
  });

  expect(layout.overlapping).toBe(false);
  expect(layout.scrollWidth).toBeGreaterThan(layout.viewportWidth);
  expect(layout.workspaceWidth).toBeGreaterThan(layout.viewportWidth);
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
  const node = nodeInput(page, "right/0");
  const emptyWidth = await elementWidth(node);

  expect(emptyWidth).toBeLessThanOrEqual(70);

  await node.fill("마인드맵 테스트");
  const filledWidth = await elementWidth(node);

  expect(filledWidth).toBeGreaterThan(emptyWidth);
});

async function connectorLayoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const rectForPath = (path: string) => {
      const element = document.querySelector<HTMLElement>(
        `[data-node-path="${path}"]`
      );
      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom)
      };
    };

    const rawPositions = {
      root: rectForPath("root"),
      parent: rectForPath("right/0"),
      draft: rectForPath("right/1"),
      review: rectForPath("right/2")
    };
    const root = rawPositions.root;
    const normalize = (rect: ReturnType<typeof rectForPath>) =>
      rect && root
        ? {
            left: rect.left - root.left,
            right: rect.right - root.left,
            top: rect.top - root.top,
            bottom: rect.bottom - root.top
          }
        : rect;

    return {
      connectorCount: document.querySelectorAll(
        ".connector-layer path:not(.virtual-connector)"
      ).length,
      positions: {
        root: normalize(rawPositions.root),
        parent: normalize(rawPositions.parent),
        draft: normalize(rawPositions.draft),
        review: normalize(rawPositions.review)
      }
    };
  });
}

async function sideBySideLayout(
  panel: ReturnType<Page["locator"]>,
  canvas: ReturnType<Page["locator"]>
): Promise<{
  panelLeft: number;
  panelRight: number;
  canvasLeft: number;
  canvasRight: number;
} | null> {
  const panelBox = await panel.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!panelBox || !canvasBox) {
    return null;
  }

  return {
    panelLeft: Math.round(panelBox.x),
    panelRight: Math.round(panelBox.x + panelBox.width),
    canvasLeft: Math.round(canvasBox.x),
    canvasRight: Math.round(canvasBox.x + canvasBox.width)
  };
}

async function dragLocatorBy(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 6 });
  await page.mouse.up();
}

function markdownOutput(page: Page) {
  return page.locator(".markdown-panel pre");
}

function nodeInput(page: Page, path: string) {
  if (path === "right/0") {
    return page.locator(
      '.node-input[data-node-path="right/0"], .virtual-node-input[data-node-path="right/__virtual"]'
    );
  }

  return page.locator(`.node-input[data-node-path="${path}"]`);
}

function virtualRootInput(page: Page, direction: "left" | "right") {
  return page.locator(
    `.virtual-node-input[data-node-path="${direction}/__virtual"]`
  );
}

function virtualLeftRootInput(page: Page) {
  return virtualRootInput(page, "left");
}

function virtualRightRootInput(page: Page) {
  return virtualRootInput(page, "right");
}

async function openMoreActions(page: Page): Promise<void> {
  const moreMenu = page.locator(".more-menu");
  const isOpen = await moreMenu.evaluate((element) => element.hasAttribute("open"));
  if (!isOpen) {
    await page.getByRole("button", { name: "More actions" }).click();
  }
}

async function mockTauriOpenMarkdown(page: Page, contents: string): Promise<void> {
  await page.addInitScript((source) => {
    let callbackId = 0;
    const callbacks = new Map<number, unknown>();
    const path = "/tmp/broken.md";
    const snapshot = {
      path,
      name: "broken.md",
      contents: source,
      hash: "mock-hash",
      mtimeMs: 1,
      size: source.length
    };

    window.__TAURI_INTERNALS__ = {
      transformCallback(callback: unknown) {
        callbackId += 1;
        callbacks.set(callbackId, callback);
        return callbackId;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string) {
        if (command === "plugin:dialog|open") {
          return path;
        }

        if (command === "read_markdown_file") {
          return snapshot;
        }

        if (command === "read_markdown_metadata") {
          const { contents: _contents, ...metadata } = snapshot;
          return metadata;
        }

        if (command === "read_app_state") {
          return null;
        }

        if (command === "plugin:event|listen") {
          return "mock-event-listener";
        }

        return null;
      }
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {
        return undefined;
      }
    };
  }, contents);
  await page.reload();
  await expect(page.getByText("clean")).toBeVisible();
}

async function nodeActionOpacity(page: Page, path: string) {
  return nodeInput(page, path).evaluate((element) => {
    const actions = element.parentElement?.querySelector<HTMLElement>(".node-actions");
    return actions ? getComputedStyle(actions).opacity : null;
  });
}

function nodeByPath(page: Page, path: string) {
  return page.locator(`[data-node-path="${path}"]`);
}

async function startComposition(locator: Locator): Promise<void> {
  await locator.dispatchEvent("compositionstart", { data: "" });
}

async function updateComposedText(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const textarea = element as HTMLTextAreaElement;
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    );
    descriptor?.set?.call(textarea, nextValue);
    textarea.setSelectionRange(nextValue.length, nextValue.length);
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: nextValue,
        inputType: "insertCompositionText",
        isComposing: true
      })
    );
  }, value);
}

async function endComposition(locator: Locator, value: string): Promise<void> {
  await locator.dispatchEvent("compositionend", { data: value });
}

async function updateInputText(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const textarea = element as HTMLTextAreaElement;
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    );
    descriptor?.set?.call(textarea, nextValue);
    textarea.setSelectionRange(nextValue.length, nextValue.length);
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: nextValue,
        inputType: "insertText",
        isComposing: false
      })
    );
  }, value);
}

async function insertTextAtSelection(locator: Locator, text: string): Promise<void> {
  await locator.evaluate((element, insertion) => {
    const textarea = element as HTMLTextAreaElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue =
      textarea.value.slice(0, start) + insertion + textarea.value.slice(end);
    const nextCaret = start + insertion.length;
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    );
    descriptor?.set?.call(textarea, nextValue);
    textarea.setSelectionRange(nextCaret, nextCaret);
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: insertion,
        inputType: "insertText",
        isComposing: false
      })
    );
  }, text);
}

async function textSelection(locator: Locator): Promise<{ start: number; end: number }> {
  return locator.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd
    };
  });
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

async function elementOpacity(locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).opacity);
}

async function elementBackgroundColor(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function elementBackgroundImage(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).backgroundImage);
}

async function elementBorderStyle(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).borderStyle);
}

async function elementBorderColor(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).borderColor);
}

async function elementColor(locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).color);
}

async function elementFontWeight(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).fontWeight);
}

async function elementBoxShadow(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).boxShadow);
}

async function elementOutlineStyle(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).outlineStyle);
}

async function elementStrokeDasharray(
  locator: ReturnType<Page["locator"]>
): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).strokeDasharray);
}

async function elementStrokeWidth(
  locator: ReturnType<Page["locator"]>
): Promise<number> {
  return locator.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).strokeWidth)
  );
}
