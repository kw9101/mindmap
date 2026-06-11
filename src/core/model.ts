export type Direction = "right" | "left";

export type MindmapNode = {
  id: string;
  path: string;
  text: string;
  direction: Direction;
  children: MindmapNode[];
};

export type Mindmap = {
  title: string;
  children: MindmapNode[];
  usesDirectionSections: boolean;
  sectionOrder: Direction[];
  emptySections: Direction[];
};

export type ParseSuccess = {
  ok: true;
  mindmap: Mindmap;
};

export type ParseFailure = {
  ok: false;
  diagnostics: import("./diagnostics").Diagnostic[];
};

export type ParseResult = ParseSuccess | ParseFailure;
