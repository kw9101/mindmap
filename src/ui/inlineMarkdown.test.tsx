import {
  isValidElement,
  type ReactElement,
  type ReactNode
} from "react";
import { describe, expect, it } from "vitest";
import { renderInlineMarkdown, safeMarkdownLinkHref } from "./inlineMarkdown";

type InlineElementProps = {
  children?: ReactNode;
  className?: string;
  href?: string;
  rel?: string;
  target?: string;
};

describe("inline markdown preview", () => {
  it("renders supported inline markdown tokens as React elements", () => {
    const nodes = renderInlineMarkdown(
      "**Bold** _em_ `code` [site](https://example.com) ~~gone~~ <b>raw</b>"
    );

    expect(textContent(nodes)).toContain("Bold");
    expect(textContent(nodes)).toContain("em");
    expect(textContent(nodes)).toContain("code");
    expect(textContent(nodes)).toContain("site");
    expect(textContent(nodes)).toContain("gone");
    expect(textContent(nodes)).toContain("<b>raw</b>");
    expect(collectElements(nodes, "strong")).toHaveLength(1);
    expect(collectElements(nodes, "em")).toHaveLength(1);
    expect(collectElements(nodes, "code")).toHaveLength(1);
    expect(collectElements(nodes, "del")).toHaveLength(1);

    const [link] = collectElements(nodes, "a");
    expect(link?.props.href).toBe("https://example.com/");
    expect(link?.props.target).toBe("_blank");
    expect(link?.props.rel).toContain("noopener");
  });

  it("renders unsafe links without clickable anchors", () => {
    const nodes = renderInlineMarkdown(
      "[script](javascript:alert(1)) [relative](/notes)"
    );

    expect(collectElements(nodes, "a")).toHaveLength(0);
    expect(collectElementsByClass(nodes, "node-markdown-unsafe-link")).toHaveLength(2);
    expect(textContent(nodes)).toContain("script");
    expect(textContent(nodes)).toContain("relative");
  });
});

describe("safe markdown link href", () => {
  it("allows only safe absolute protocols", () => {
    expect(safeMarkdownLinkHref(" https://example.com/path ")).toBe(
      "https://example.com/path"
    );
    expect(safeMarkdownLinkHref("HTTP://EXAMPLE.COM")).toBe("http://example.com/");
    expect(safeMarkdownLinkHref("mailto:name@example.com")).toBe(
      "mailto:name@example.com"
    );
    expect(safeMarkdownLinkHref("tel:+821012345678")).toBe("tel:+821012345678");
  });

  it("rejects relative, script, data, and control-character URLs", () => {
    expect(safeMarkdownLinkHref("/relative")).toBeNull();
    expect(safeMarkdownLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeMarkdownLinkHref("data:text/html,hi")).toBeNull();
    expect(safeMarkdownLinkHref("https://example.com/\nnext")).toBeNull();
  });
});

function collectElements(
  nodes: ReactNode | ReactNode[],
  type: string
): ReactElement<InlineElementProps>[] {
  const found: ReactElement<InlineElementProps>[] = [];

  for (const node of asNodeList(nodes)) {
    if (!isValidElement<InlineElementProps>(node)) {
      continue;
    }

    if (node.type === type) {
      found.push(node);
    }

    found.push(...collectElements(node.props.children, type));
  }

  return found;
}

function collectElementsByClass(
  nodes: ReactNode | ReactNode[],
  className: string
): ReactElement<InlineElementProps>[] {
  const found: ReactElement<InlineElementProps>[] = [];

  for (const node of asNodeList(nodes)) {
    if (!isValidElement<InlineElementProps>(node)) {
      continue;
    }

    if (node.props.className === className) {
      found.push(node);
    }

    found.push(...collectElementsByClass(node.props.children, className));
  }

  return found;
}

function textContent(nodes: ReactNode | ReactNode[]): string {
  return asNodeList(nodes)
    .map((node) => {
      if (typeof node === "string" || typeof node === "number") {
        return String(node);
      }

      if (isValidElement<InlineElementProps>(node)) {
        return textContent(node.props.children);
      }

      return "";
    })
    .join("");
}

function asNodeList(nodes: ReactNode | ReactNode[]): ReactNode[] {
  return Array.isArray(nodes) ? nodes : [nodes];
}
