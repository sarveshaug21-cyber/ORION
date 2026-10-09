declare module 'glob' {
  export interface GlobOptions {
    cwd?: string;
    nodir?: boolean;
    dot?: boolean;
    absolute?: boolean;
    ignore?: string | string[];
    cwd?: string;
    windowsPathsNoEscape?: boolean;
    withFileTypes?: boolean;
    stat?: boolean;
    follow?: boolean;
    realpath?: boolean;
    posix?: boolean;
  }

  export function glob(pattern: string | string[], options?: GlobOptions): Promise<string[]>;
  
  export default glob;
}