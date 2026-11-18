/** An error the caller can act on (bad path, missing file, version conflict). Shown to the model as is. */
export class ToolError extends Error {
  override name = 'ToolError';
}
