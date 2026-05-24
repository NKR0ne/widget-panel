const fs = require("node:fs");
const path = require("node:path");

const output = path.join(__dirname, "fiche-entrevue-camp-de-jour.pdf");
const W = 612;
const H = 792;
const M = 42;
const content = [];

function esc(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function rgb(hex) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function rect(x, y, w, h, fill, stroke = null) {
  if (fill) content.push(`${rgb(fill)} rg`);
  if (stroke) content.push(`${rgb(stroke)} RG`);
  content.push(`${x} ${y} ${w} ${h} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
}

function line(x1, y1, x2, y2, color, width = 1) {
  content.push(`${rgb(color)} RG`);
  content.push(`${width} w`);
  content.push(`${x1} ${y1} m ${x2} ${y2} l S`);
}

function text(x, y, value, size = 10, color = "#1e2732", font = "F1") {
  content.push("BT");
  content.push(`/${font} ${size} Tf`);
  content.push(`${rgb(color)} rg`);
  content.push(`${x} ${y} Td`);
  content.push(`(${esc(value)}) Tj`);
  content.push("ET");
}

function wrap(value, maxChars) {
  const words = value.split(/\s+/);
  const lines = [];
  let lineText = "";
  for (const word of words) {
    const next = lineText ? `${lineText} ${word}` : word;
    if (next.length > maxChars && lineText) {
      lines.push(lineText);
      lineText = word;
    } else {
      lineText = next;
    }
  }
  if (lineText) lines.push(lineText);
  return lines;
}

function paragraph(x, y, value, maxChars, size = 10, leading = 13, color = "#1e2732") {
  let cursor = y;
  for (const lineText of wrap(value, maxChars)) {
    text(x, cursor, lineText, size, color);
    cursor -= leading;
  }
  return cursor;
}

function bulletList(x, y, items, maxChars, size = 9.3, leading = 12.2) {
  let cursor = y;
  for (const item of items) {
    const lines = wrap(item, maxChars);
    text(x, cursor, "-", size, "#254252");
    text(x + 10, cursor, lines[0], size, "#1e2732");
    cursor -= leading;
    for (const extra of lines.slice(1)) {
      text(x + 10, cursor, extra, size, "#1e2732");
      cursor -= leading;
    }
  }
  return cursor;
}

function section(x, y, w, h, title, items) {
  rect(x, y - h, w, h, "#fbfcfc", "#d9e1e4");
  text(x + 12, y - 20, title, 12, "#254252", "F2");
  bulletList(x + 14, y - 39, items, Math.floor(w / 5.2));
}

function buildPage() {
  text(M, 738, "Preparer une entrevue sans stress", 25, "#254252", "F2");
  text(M, 716, "Pour un premier emploi comme aide dans un camp de jour", 11.5, "#53616d");
  line(M, 702, W - M, 702, "#8fb996", 3);

  rect(M, 645, W - M * 2, 43, "#fff7ed");
  rect(M, 645, 5, 43, "#d68c45");
  paragraph(
    M + 15,
    672,
    "L'objectif n'est pas d'etre parfaite. C'est d'etre chaleureuse, honnete, attentive et prete a apprendre.",
    88,
    13,
    15,
    "#2b3138",
  );

  const colW = (W - M * 2 - 12) / 2;
  section(M, 628, colW, 118, "Le bon etat d'esprit", [
    "Voir l'entrevue comme une conversation, pas comme un examen.",
    "Se rappeler que c'est normal d'etre un peu nerveuse.",
    "Repondre simplement, avec des exemples vrais.",
    "Dire qu'elle est prete a apprendre et a demander de l'aide.",
  ]);
  section(M + colW + 12, 628, colW, 118, "Ce que le camp cherche", [
    "Gentillesse, patience et respect avec les enfants.",
    "Fiabilite: arriver a l'heure, suivre les consignes.",
    "Attention a la securite et aux regles.",
    "Energie positive, esprit d'equipe et bon jugement.",
  ]);

  rect(M, 376, W - M * 2, 113, "#fbfcfc", "#d9e1e4");
  text(M + 12, 468, "Questions a pratiquer doucement", 12, "#254252", "F2");
  const qs = [
    "Parle-moi de toi.",
    "Pourquoi veux-tu travailler dans un camp de jour?",
    "Quelle experience as-tu avec les enfants?",
    "Que ferais-tu si un enfant etait triste ou fache?",
    "Que ferais-tu si tu ne savais pas quoi faire?",
    "Quelles sont tes forces?",
  ];
  bulletList(M + 16, 446, qs.slice(0, 3), 47);
  bulletList(M + 286, 446, qs.slice(3), 47);

  rect(M, 169, 316, 187, "#fbfcfc", "#d9e1e4");
  text(M + 12, 335, "Une reponse simple a adapter", 12, "#254252", "F2");
  let y = paragraph(
    M + 12,
    312,
    '"Je suis responsable, j\'aime aider et je suis a l\'aise avec les enfants. Ce serait mon premier emploi, mais j\'ai envie d\'apprendre. Si je ne suis pas certaine de quoi faire, je vais demander a une personne responsable."',
    58,
    9.5,
    12.4,
  );
  rect(M + 12, y - 58, 292, 48, "#eaf3f0");
  paragraph(
    M + 22,
    y - 28,
    'Phrase rassurante: "Peu importe le resultat, c\'est une belle experience. Je suis fier/fiere de toi parce que tu essaies quelque chose de nouveau."',
    52,
    9.3,
    11.7,
    "#243d3c",
  );

  rect(M + 328, 169, 200, 187, "#fbfcfc", "#d9e1e4");
  text(M + 340, 335, "Avant l'entrevue", 12, "#254252", "F2");
  bulletList(M + 342, 312, [
    "Choisir les vetements la veille.",
    "Planifier le transport et arriver un peu en avance.",
    "Manger quelque chose de leger.",
    "Respirer, sourire, prendre son temps.",
    "Prevoir quelque chose d'agreable apres, peu importe le resultat.",
  ], 34);

  line(M, 146, W - M, 146, "#d9e1e4", 1);
  paragraph(
    M,
    130,
    'Petit exercice de confiance: trouver trois raisons pour lesquelles elle serait bonne avec les enfants, par exemple "je suis patiente", "je remarque quand quelqu\'un est exclu", "j\'aime aider", "je respecte les regles".',
    105,
    9.5,
    12,
    "#53616d",
  );
}

buildPage();

const stream = content.join("\n");
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
];

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i += 1) {
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (const offset of offsets.slice(1)) {
  pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

fs.writeFileSync(output, Buffer.from(pdf, "latin1"));
console.log(output);
