export type ToolType =
  | "read_file"
  | "bash"
  | "grep"
  | "test_runner"
  | "list_dir"
  | "web"
  | "unknown";

export interface CompressionInput {
  toolType: ToolType;
  rawOutput: string;
  // Optional hints. Different tools provide different metadata.
  filePath?: string;
  exitCode?: number;
  command?: string;
}

export interface CompressionResult {
  compressed: string;
  strategy: string;
  // For observability / stats.
  rawTokens: number;
  compressedTokens: number;
}
