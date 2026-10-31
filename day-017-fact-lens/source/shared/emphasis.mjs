// Only paired **text** is formatting. HTML, links and unmatched markers stay text.
export function emphasisParts(value) {
  const text = String(value || ''), parts = [];
  const pattern = /\*\*([^*\n]+)\*\*/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > start) parts.push({ text: text.slice(start, match.index), strong: false });
    parts.push({ text: match[1], strong: true }); start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ text: text.slice(start), strong: false });
  return parts;
}
export function appendEmphasis(node, value) {
  for (const part of emphasisParts(value)) {
    const child = node.ownerDocument.createElement(part.strong ? 'strong' : 'span');
    child.textContent = part.text; node.append(child);
  }
  return node;
}
