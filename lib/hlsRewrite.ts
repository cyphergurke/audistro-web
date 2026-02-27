export function rewriteKeyUri(playlist: string, newKeyUri: string): string {
  const lines = playlist.split(/\r?\n/);
  let changed = false;

  const rewritten = lines.map((line) => {
    if (!line.startsWith("#EXT-X-KEY:")) {
      return line;
    }
    if (!line.includes("METHOD=AES-128")) {
      return line;
    }

    if (/URI="[^"]*"/.test(line)) {
      changed = true;
      return line.replace(/URI="[^"]*"/, `URI="${newKeyUri}"`);
    }

    changed = true;
    return `${line},URI="${newKeyUri}"`;
  });

  return changed ? rewritten.join("\n") : playlist;
}
