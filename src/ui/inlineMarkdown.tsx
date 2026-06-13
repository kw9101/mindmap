import { useMemo, type ReactNode } from "react";
import { Lexer, type Token } from "marked";

export function InlineMarkdownPreview({
  text,
  nodePath
}: {
  text: string;
  nodePath: string;
}) {
  const content = useMemo(() => renderInlineMarkdown(text), [text]);

  return (
    <span
      className="node-markdown-preview"
      data-node-preview-path={nodePath}
    >
      {content}
    </span>
  );
}

export function renderInlineMarkdown(text: string): ReactNode[] {
  try {
    return renderInlineMarkdownTokens(Lexer.lexInline(text, { gfm: true }), "md");
  } catch {
    return [text];
  }
}

function renderInlineMarkdownTokens(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) =>
    renderInlineMarkdownToken(token, `${keyPrefix}-${index}`)
  );
}

function renderInlineMarkdownToken(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "strong":
      return <strong key={key}>{renderInlineMarkdownChildren(token, key)}</strong>;
    case "em":
      return <em key={key}>{renderInlineMarkdownChildren(token, key)}</em>;
    case "codespan":
      return <code key={key}>{token.text}</code>;
    case "del":
      return <del key={key}>{renderInlineMarkdownChildren(token, key)}</del>;
    case "link": {
      const href = safeMarkdownLinkHref(token.href);
      const children = renderInlineMarkdownChildren(token, key);
      if (!href) {
        return (
          <span key={key} className="node-markdown-unsafe-link">
            {children}
          </span>
        );
      }

      return (
        <a
          key={key}
          href={href}
          title={token.title ?? undefined}
          target="_blank"
          rel="noreferrer noopener"
        >
          {children}
        </a>
      );
    }
    case "br":
      return <br key={key} />;
    case "escape":
    case "text":
      return token.text;
    case "html":
      return token.raw;
    case "image":
      return token.raw;
    default: {
      const genericToken = token as {
        raw?: string;
        text?: string;
        tokens?: Token[];
      };
      if (genericToken.tokens) {
        return renderInlineMarkdownTokens(genericToken.tokens, key);
      }

      return genericToken.text ?? genericToken.raw ?? "";
    }
  }
}

function renderInlineMarkdownChildren(
  token: { tokens?: Token[] },
  keyPrefix: string
): ReactNode[] {
  return renderInlineMarkdownTokens(token.tokens ?? [], keyPrefix);
}

export function safeMarkdownLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    return null;
  }

  if (!/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
