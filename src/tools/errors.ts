// ---------------------------------------------------------------------------
// Tool error class
// ---------------------------------------------------------------------------

export class ToolError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}
