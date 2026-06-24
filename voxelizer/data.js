/* Sample sprites, drawn procedurally onto small canvases.
   They run through the SAME pixel pipeline as a dropped PNG, so the
   voxelizer treats them identically. Arc edges produce a few
   semi-transparent pixels, which makes the alpha threshold meaningful. */

function _cv(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return c;
}

function drawSlime(n) {
  const c = _cv(n), g = c.getContext('2d'), s = n / 24;
  g.scale(s, s);
  // body dome
  g.fillStyle = '#56c25a';
  g.beginPath();
  g.arc(12, 14, 9, Math.PI, 2 * Math.PI);
  g.lineTo(21, 19);
  g.quadraticCurveTo(12, 23, 3, 19);
  g.closePath();
  g.fill();
  // shaded base
  g.fillStyle = '#2f8a3e';
  g.beginPath();
  g.moveTo(3, 17); g.quadraticCurveTo(12, 22, 21, 17);
  g.lineTo(21, 19); g.quadraticCurveTo(12, 23, 3, 19);
  g.closePath(); g.fill();
  // eyes
  g.fillStyle = '#f3fff1';
  g.fillRect(8, 11, 3, 4); g.fillRect(14, 11, 3, 4);
  g.fillStyle = '#11260f';
  g.fillRect(9, 13, 2, 2); g.fillRect(15, 13, 2, 2);
  return c;
}

function drawPotion(n) {
  const c = _cv(n), g = c.getContext('2d'), s = n / 24;
  g.scale(s, s);
  // body
  g.fillStyle = '#cfeef5';
  g.beginPath(); g.arc(12, 15, 7, 0, 2 * Math.PI); g.fill();
  g.fillRect(9, 5, 6, 8); // neck
  // liquid
  g.fillStyle = '#e5476d';
  g.beginPath(); g.arc(12, 16, 6, 0, Math.PI); g.fill();
  g.fillRect(6, 15, 12, 1);
  g.fillStyle = '#ff89a6';
  g.fillRect(8, 16, 2, 3);
  // glass rim + cork
  g.fillStyle = '#9fd4e0';
  g.fillRect(9, 5, 6, 2);
  g.fillStyle = '#a7692f';
  g.fillRect(9, 2, 6, 3);
  g.fillStyle = '#c98a4f';
  g.fillRect(9, 2, 6, 1);
  return c;
}

function drawSword(n) {
  const c = _cv(n), g = c.getContext('2d'), s = n / 24;
  g.scale(s, s);
  // blade
  g.fillStyle = '#d9dee9';
  g.beginPath();
  g.moveTo(12, 2); g.lineTo(14, 5); g.lineTo(14, 15); g.lineTo(10, 15); g.lineTo(10, 5);
  g.closePath(); g.fill();
  g.fillStyle = '#9aa6b2'; // blade shade
  g.fillRect(12, 4, 2, 11);
  // guard
  g.fillStyle = '#e6b34a';
  g.fillRect(6, 15, 12, 2);
  g.fillStyle = '#b07d24';
  g.fillRect(6, 16, 12, 1);
  // handle
  g.fillStyle = '#6b4a2b';
  g.fillRect(11, 17, 2, 4);
  // pommel
  g.fillStyle = '#e6b34a';
  g.fillRect(10, 21, 4, 2);
  return c;
}

function drawHeart(n) {
  const c = _cv(n), g = c.getContext('2d'), s = n / 24;
  g.scale(s, s);
  g.fillStyle = '#e23b56';
  g.beginPath(); g.arc(8.5, 9, 4.2, 0, 2 * Math.PI); g.fill();
  g.beginPath(); g.arc(15.5, 9, 4.2, 0, 2 * Math.PI); g.fill();
  g.beginPath();
  g.moveTo(4.5, 11); g.lineTo(12, 20); g.lineTo(19.5, 11); g.closePath(); g.fill();
  g.fillStyle = '#ff7088'; // highlight
  g.beginPath(); g.arc(8, 8, 1.6, 0, 2 * Math.PI); g.fill();
  return c;
}

function drawTree(n) {
  const c = _cv(n), g = c.getContext('2d'), s = n / 24;
  g.scale(s, s);
  g.fillStyle = '#7a5230'; // trunk
  g.fillRect(10, 15, 4, 7);
  g.fillStyle = '#3f9a4e'; // foliage
  g.beginPath(); g.arc(12, 9, 7, 0, 2 * Math.PI); g.fill();
  g.beginPath(); g.arc(7, 12, 4.5, 0, 2 * Math.PI); g.fill();
  g.beginPath(); g.arc(17, 12, 4.5, 0, 2 * Math.PI); g.fill();
  g.fillStyle = '#2c7038';
  g.beginPath(); g.arc(13, 12, 5, 0, 2 * Math.PI); g.fill();
  g.fillStyle = '#62c06f'; // highlight
  g.beginPath(); g.arc(10, 6, 2.4, 0, 2 * Math.PI); g.fill();
  return c;
}

const SAMPLE_SPRITES = [
  { name: 'slime.png',  size: 24, draw: drawSlime },
  { name: 'potion.png', size: 24, draw: drawPotion },
  { name: 'sword.png',  size: 24, draw: drawSword },
  { name: 'heart.png',  size: 24, draw: drawHeart },
  { name: 'oak.png',    size: 24, draw: drawTree },
];

window.SAMPLE_SPRITES = SAMPLE_SPRITES;
