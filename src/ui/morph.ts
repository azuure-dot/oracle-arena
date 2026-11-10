/**
 * Mise à jour « en place » d'un écran HTML : au lieu de tout reconstruire (innerHTML), on compare
 * le nouveau HTML à l'existant et on ne touche qu'à ce qui change (attributs, textes, éléments).
 * Les éléments gardés ne rejouent pas leurs animations d'apparition, gardent le focus, le défilement
 * et leurs images déjà décodées : un clic ne donne plus l'impression d'un rechargement.
 *
 * `data-morph-key` : deux éléments dont la clé diffère sont remplacés au lieu d'être mis à jour
 * (utile quand on VEUT rejouer une apparition, par exemple l'illustration d'un nouveau héros).
 */
export function morph(target: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(target, tpl.content);
}

function morphChildren(from: Node, to: Node): void {
  const oldNodes = Array.from(from.childNodes);
  const newNodes = Array.from(to.childNodes);
  newNodes.forEach((nb, i) => {
    const na = oldNodes[i];
    if (!na) from.appendChild(nb);
    else if (!sameKind(na, nb)) from.replaceChild(nb, na);
    else morphNode(na, nb);
  });
  for (let i = newNodes.length; i < oldNodes.length; i++) oldNodes[i].remove();
}

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const ea = a as Element;
  const eb = b as Element;
  return ea.tagName === eb.tagName && ea.getAttribute('data-morph-key') === eb.getAttribute('data-morph-key');
}

function morphNode(a: Node, b: Node): void {
  if (a.nodeType !== Node.ELEMENT_NODE) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  if (a.isEqualNode(b)) return;
  const ea = a as Element;
  const eb = b as Element;
  for (const { name } of Array.from(ea.attributes)) if (!eb.hasAttribute(name)) ea.removeAttribute(name);
  for (const { name, value } of Array.from(eb.attributes)) if (ea.getAttribute(name) !== value) ea.setAttribute(name, value);
  morphChildren(ea, eb);
}
