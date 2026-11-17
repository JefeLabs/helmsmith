/**
 * All of stdin as UTF-8 text, read to its end; `''` when nothing is piped in.
 * Callers refuse a terminal stdin before calling this, so it never waits on a
 * person typing.
 */
export async function readStdin(
  stream: AsyncIterable<string | Uint8Array> = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
