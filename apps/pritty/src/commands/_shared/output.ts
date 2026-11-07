export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const consoleIo: Io = {
  out: (l) => console.log(l),
  err: (l) => console.error(l),
};

/**
 * The `--json` contract every command keeps: stdout carries exactly one JSON
 * line, the result, so a caller (workbrokr, an agent) can parse it whole.
 * `say` is for human lines; under `--json` they move to stderr, never away.
 * Failures stay what they always were: a message on stderr and exit 1.
 */
export function output(json: boolean | undefined, io: Io = consoleIo) {
  return {
    say: json ? io.err : io.out,
    result<T>(o: T): T {
      if (json) io.out(JSON.stringify(o));
      return o;
    },
  };
}
