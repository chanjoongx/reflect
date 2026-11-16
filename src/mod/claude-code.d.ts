// src/mod/claude-code.d.ts: the slice of Claude Code's mod API that
// src/mod/reflect.ts uses, so the repository typechecks without a Claude Code
// install. Claude Code writes the full types for a loaded mod; the plugin's
// generated module is checked against those with `claude plugin validate`.

declare module "claude-code" {
  export type PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>;

  // The engine interface and each event's input and result are typed per event
  // in Claude Code's own declarations; this slice keeps them open.
  export type Hook = ($: any, e: any, next: any) => unknown;

  export interface HookHandle {
    catch(handler: Hook): HookHandle;
  }

  export interface On {
    (event: string, hook: Hook): HookHandle;
    (event: string, matcher: Readonly<Record<string, unknown>>, hook: Hook): HookHandle;
  }

  export type Register = (on: On, options: PluginOptions) => unknown;
}
