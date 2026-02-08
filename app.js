// Animation : CuO(s) + H2(g) -> Cu(s) + H2O(g) (sans écrire l'équation)
// Cahier des charges :
// - Pas d'indices textuels sur équation/limitant/excès
// - Température visible (agitation + cinétique)
// - Solide : amas compact, immobile ; réaction à l'interface gaz/solide
// - Anti-chevauchement
// - Bouton Pause
// - Prof masqué : P (diagnostic), T (mode piège), R (vitesse réaction)

const canvas = document.getElementById("simu");
const ctx = canvas.getContext("2d");

const tempSlider = document.getElementById("temp");
const tempVal = document.getElementById("tempVal");

const h2Slider = document.getElementById("h2");
const h2Val = document.getElementById("h2Val");

const cuoSlider = document.getElementById("cuo");
const cuoVal = document.getElementById("cuoVal");

const restartBtn = document.getElementById("restart");
const toggleAtomsBtn = document.getElementById("toggleAtoms");
const pauseBtn = document.getElementById("pauseBtn");

let animId;
let paused = false;

let showAtoms = false;
let showDiag = false;
let trapMode = false;

// vitesse réaction prof (masquée) : R pour cycler
const rLevels = [0.5, 1.0, 1.8, 2.8];
let rIdx = 1; // défaut = 1.0

// --- Paramètres visuels ---
const AT = {
  H: { r: 6, color: "#fff", label: "H" },
  O: { r: 8, color: "#e53935", label: "O" },     // rouge
  Cu: { r: 10, color: "#b87333", label: "Cu" }   // cuivre
};

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function dist(ax, ay, bx, by) { const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }
function normalize(dx, dy) {
  const d = Math.sqrt(dx*dx + dy*dy) || 1;
  return { x: dx/d, y: dy/d };
}

// --- Espèces ---
class GasMol {
  constructor(type) {
    this.type = type; // "H2" ou "H2O"
    this.x = rand(60, canvas.width - 60);
    this.y = rand(60, canvas.height - 220); // garder loin du tas initial
    this.vx = rand(-1, 1);
    this.vy = rand(-1, 1);
    this.used = false;
  }
  envelopeRadius() {
    if (this.type === "H2") return AT.H.r + AT.H.r + 4;
    if (this.type === "H2O") return AT.O.r + AT.H.r + AT.H.r + 6;
    return 22;
  }
  move(speed) {
    this.x += this.vx * speed;
    this.y += this.vy * speed;

    const r = this.envelopeRadius();
    if (this.x < r) { this.x = r; this.vx *= -1; }
    if (this.x > canvas.width - r) { this.x = canvas.width - r; this.vx *= -1; }
    if (this.y < r) { this.y = r; this.vy *= -1; }
    if (this.y > canvas.height - r) { this.y = canvas.height - r; this.vy *= -1; }
  }
  draw() {
    if (this.type === "H2") drawBond(this.x, this.y, AT.H, AT.H);
    if (this.type === "H2O") drawWater(this.x, this.y);
  }
}

class SolidParticle {
  constructor(kind, x, y) {
    this.kind = kind; // "CuO" ou "Cu"
    this.x = x;
    this.y = y;
    this.vib = rand(0, Math.PI*2); // petite vibration
  }
  // solide quasi immobile : vibration très faible autour de la position
  draw() {
    const Tc = parseFloat(tempSlider.value);
    const vibAmp = 0.2 + (Tc/120)*0.5; // très faible
    const ox = Math.cos(this.vib) * vibAmp;
    const oy = Math.sin(this.vib) * vibAmp;
    this.vib += 0.03;

    if (this.kind === "CuO") drawCuO(this.x + ox, this.y + oy);
    if (this.kind === "Cu") drawCu(this.x + ox, this.y + oy);
  }
}

// --- Dessins moléculaires compacts ---
function drawAtom(x, y, atom) {
  ctx.beginPath();
  ctx.fillStyle = atom.color;
  ctx.arc(x, y, atom.r, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.stroke();

  if (showAtoms) {
    ctx.fillStyle = "#000";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(atom.label, x, y);
  }
}

function drawBond(cx, cy, a1, a2) {
  // liaison horizontale implicite
  ctx.beginPath();
  ctx.strokeStyle = "#777";
  ctx.lineWidth = 2;
  ctx.moveTo(cx - a1.r + 1, cy);
  ctx.lineTo(cx + a2.r - 1, cy);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";

  drawAtom(cx - a1.r, cy, a1);
  drawAtom(cx + a2.r, cy, a2);
}

function drawWater(cx, cy) {
  // modèle compact H-O-H (angle simplifié)
  const O = AT.O, H = AT.H;
  drawAtom(cx, cy, O);
  drawAtom(cx - (O.r + H.r - 2), cy + (O.r - 2), H);
  drawAtom(cx + (O.r + H.r - 2), cy + (O.r - 2), H);
}

function drawCuO(cx, cy) {
  // Cu-O collés (compact)
  const Cu = AT.Cu, O = AT.O;
  // liaison
  ctx.beginPath();
  ctx.strokeStyle = "#777";
  ctx.lineWidth = 2;
  ctx.moveTo(cx - Cu.r + 1, cy);
  ctx.lineTo(cx + O.r - 1, cy);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";

  drawAtom(cx - Cu.r, cy, Cu);
  drawAtom(cx + O.r, cy, O);
}

function drawCu(cx, cy) {
  drawAtom(cx, cy, AT.Cu);
}

// --- Monde ---
let gas = [];     // H2 + H2O
let solid = [];   // CuO + Cu (dans le même tas)

let initial = { H2: 0, CuO: 0 };

function buildSolidPile(nCuO) {
  solid = [];
  // tas compact au bas de la cuve
  const baseY = canvas.height - 90;
  const baseX = canvas.width * 0.50;
  const spacing = 18;

  // construire par couches pour un "tas" (pas aligné)
  let placed = 0;
  let row = 0;
  while (placed < nCuO) {
    const inRow = Math.min(nCuO - placed, 6 + Math.floor(row/2)); // un peu plus large en bas
    const y = baseY - row * (spacing * 0.9);
    const xStart = baseX - (inRow-1) * (spacing * 0.55);
    for (let k = 0; k < inRow && placed < nCuO; k++) {
      const jitterX = rand(-3, 3);
      const jitterY = rand(-2, 2);
      const x = xStart + k * spacing + jitterX;
      solid.push(new SolidParticle("CuO", x, y + jitterY));
      placed += 1;
    }
    row += 1;
    if (row > 8) break; // sécurité
  }
}

function enforceStoichDefaultOnly() {
  // Ici, on n'impose PAS une contrainte permanente.
  // On impose seulement le *défaut* stœchiométrique au chargement initial (10/10).
  // Les curseurs restent libres : l'élève peut créer excès/limitant.
  h2Val.textContent = h2Slider.value;
  cuoVal.textContent = cuoSlider.value;
}

// --- Cinétique ---
function kineticParams() {
  const Tc = parseFloat(tempSlider.value);
  const Tk = Tc + 273.15;

  // agitation (visible) : [0.45 ; 3.8]
  let speed = 0.45 + ((Tc - 10) / (120 - 10)) * 3.35;
  speed = clamp(speed, 0.40, 3.8);

  // probabilité réaction sur interface (Arrhenius douce)
  const Rgas = 8.314;
  const Ea = 10500;
  const A = 0.65; // base
  let p = A * Math.exp(-Ea / (Rgas * Tk));

  // multiplier prof R
  p *= rLevels[rIdx];

  // plafonner
  p = clamp(p, 0, 0.55);

  // basse T : ralenti fort (piège optionnel)
  if (Tc < 25) {
    const factor = trapMode ? 0.015 : 0.08;
    p *= factor;
    speed *= trapMode ? 0.55 : 0.78;
  }

  return { speed, p };
}

// --- Anti-chevauchement gaz ---
function resolveOverlapsGas(list) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.used) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.used) continue;

      const ra = a.envelopeRadius();
      const rb = b.envelopeRadius();
      const d = dist(a.x, a.y, b.x, b.y);
      const minD = ra + rb;

      if (d < minD && d > 0.001) {
        const overlap = (minD - d);
        const n = normalize(a.x - b.x, a.y - b.y);
        a.x += n.x * (overlap * 0.55);
        a.y += n.y * (overlap * 0.55);
        b.x -= n.x * (overlap * 0.55);
        b.y -= n.y * (overlap * 0.55);
      }
    }
  }
}

// --- Réaction à l'interface gaz/solide ---
function interfaceReactions(pReact) {
  // réaction : 1 H2 + 1 CuO -> 1 H2O + 1 Cu (sans l'écrire)
  // condition : H2 suffisamment proche d'une particule CuO (surface)
  const contactFactor = 1.25;

  for (const m of gas) {
    if (m.used || m.type !== "H2") continue;

    // chercher une particule CuO proche
    for (const sp of solid) {
      if (sp.kind !== "CuO") continue;

      // distance seuil : enveloppe H2 + taille du solide
      const rGas = m.envelopeRadius();
      const rSol = 18; // taille approx d'une unité CuO (Cu-O)
      const threshold = (rGas + rSol) * contactFactor;

      // uniquement à l'interface : on privilégie les CuO les plus "haut" du tas
      // (approx : on rend plus réactifs ceux qui ont moins de solides au-dessus)
      // => facteur simple via y (plus petit y = plus haut)
      const surfaceBoost = clamp((canvas.height - sp.y) / 220, 0.35, 1.0);

      if (dist(m.x, m.y, sp.x, sp.y) <= threshold) {
        // rebond du gaz
        m.vx *= -1;
        m.vy *= -1;

        // tirage réaction
        if (Math.random() < pReact * surfaceBoost) {
          m.used = true;

          // convertir le CuO en Cu sur place
          sp.kind = "Cu";

          // produire une molécule d'eau (gaz)
          const w = new GasMol("H2O");
          w.x = sp.x + rand(-20, 20);
          w.y = sp.y - rand(10, 30);
          w.vx = rand(-1, 1);
          w.vy = rand(-1, 1);
          gas.push(w);

          reactionsDone += 1;
          break;
        }
      }
    }
  }

  // purge H2 consommés
  gas = gas.filter(m => !m.used);
}

let reactionsDone = 0;

function counts() {
  const h2 = gas.filter(m => m.type === "H2").length;
  const h2o = gas.filter(m => m.type === "H2O").length;
  const cuo = solid.filter(s => s.kind === "CuO").length;
  const cu = solid.filter(s => s.kind === "Cu").length;
  return { h2, h2o, cuo, cu };
}

function diagOverlay() {
  const Tc = parseFloat(tempSlider.value);
  const c = counts();

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "#111";
  ctx.fillRect(12, 12, 360, 154);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";

  ctx.font = "14px Arial";
  ctx.fillText("Diagnostic prof (P)", 22, 34);

  ctx.font = "13px Arial";
  ctx.fillText(`T = ${Tc.toFixed(0)} °C   |   Mode piège (T) : ${trapMode ? "ON" : "OFF"}`, 22, 56);
  ctx.fillText(`Vitesse réaction (R) : ×${rLevels[rIdx].toFixed(1)}`, 22, 76);

  ctx.fillText(`Initial : H2=${initial.H2}   CuO=${initial.CuO}`, 22, 98);
  ctx.fillText(`Restant : H2=${c.h2}   CuO=${c.cuo}`, 22, 118);
  ctx.fillText(`Produits : H2O=${c.h2o}   Cu=${c.cu}`, 22, 138);
  ctx.fillText(`Événements réaction : ${reactionsDone}`, 22, 158);

  ctx.restore();
}

// --- Boucle ---
function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // dessiner solide (tas) en premier
  for (const sp of solid) sp.draw();

  // dessiner gaz
  for (const m of gas) m.draw();

  if (showDiag) diagOverlay();
}

function step() {
  if (paused) {
    drawScene();
    animId = requestAnimationFrame(step);
    return;
  }

  const { speed, p } = kineticParams();

  for (const m of gas) m.move(speed);

  resolveOverlapsGas(gas);

  // interface gaz/solide
  interfaceReactions(p);

  drawScene();
  animId = requestAnimationFrame(step);
}

// --- Initialisation ---
function init() {
  cancelAnimationFrame(animId);
  paused = false;
  pauseBtn.textContent = "Pause";

  reactionsDone = 0;
  gas = [];

  enforceStoichDefaultOnly();

  const nH2 = parseInt(h2Slider.value, 10);
  const nCuO = parseInt(cuoSlider.value, 10);

  for (let i = 0; i < nH2; i++) gas.push(new GasMol("H2"));

  buildSolidPile(nCuO);

  initial = { H2: nH2, CuO: nCuO };

  // petit "nettoyage" initial des gaz
  for (let k = 0; k < 140; k++) resolveOverlapsGas(gas);

  step();
}

// --- UI ---
tempSlider.oninput = () => tempVal.textContent = tempSlider.value;

h2Slider.oninput = () => { h2Val.textContent = h2Slider.value; };
cuoSlider.oninput = () => { cuoVal.textContent = cuoSlider.value; };

toggleAtomsBtn.onclick = () => {
  showAtoms = !showAtoms;
  toggleAtomsBtn.textContent = `Atomes : ${showAtoms ? "ON" : "OFF"}`;
};

pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Lecture" : "Pause";
};

restartBtn.onclick = init;

// touches masquées
window.addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if (k === "p") showDiag = !showDiag;
  if (k === "t") trapMode = !trapMode;
  if (k === "r") {
    rIdx = (rIdx + 1) % rLevels.length;
  }
});

// Valeurs initiales demandées : proportions stœchiométriques par défaut (10/10) et T=50°C
tempVal.textContent = tempSlider.value;
h2Val.textContent = h2Slider.value;
cuoVal.textContent = cuoSlider.value;

init();
