// Main game module: sets up Three.js scene, player controls, weapons with skins,
// raycast shooting, AI opponents, and a large terrain to roam.

// External imports via CDN for simplicity
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

// --------------------------- Config ---------------------------
const WORLD_SIZE = 3200; // Large open area (approx "CODM" scale for demo)
const NUM_COVER_BOXES = 160;
const ENEMY_TARGET_COUNT = 18;
const GRAVITY = 64; // units/s^2
const PLAYER_SPEED = 180; // walk speed units/s
const PLAYER_SPRINT_MULTIPLIER = 1.7;
const PLAYER_JUMP_VELOCITY = 260;
const PLAYER_MAX_HEALTH = 100;

// --------------------------- State ---------------------------
let renderer, scene, camera, controls;
let clock;
let terrain;
let player = {
  velocity: new THREE.Vector3(),
  onGround: true,
  health: PLAYER_MAX_HEALTH,
  lastDamageTime: 0
};
let input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  shooting: false
};
let raycaster = new THREE.Raycaster();
let shootPoint = new THREE.Vector3();
let shootDirection = new THREE.Vector3();

// HUD elements
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const healthFill = document.getElementById('healthFill');
const weaponNameEl = document.getElementById('weaponName');
const ammoEl = document.getElementById('ammo');
const statusText = document.getElementById('statusText');
const weaponWheel = document.getElementById('weaponWheel');

// --------------------------- Utilities ---------------------------
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(randFloat(min, max)); }
function choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeRepeatingGridTexture(size = 256, grid = 32, colorA = '#3a5f3a', colorB = '#355a35') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colorB;
  for (let y = 0; y < size; y += grid) {
    for (let x = 0; x < size; x += grid) {
      if (((x / grid) + (y / grid)) % 2 === 0) ctx.fillRect(x, y, grid, grid);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeStripedTexture(size = 256, stripe = 18, colors = ['#666', '#999']) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colors[1];
  for (let y = 0; y < size; y += stripe * 2) {
    ctx.fillRect(0, y, size, stripe);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function createBillboardText(text, options = {}) {
  const { font = '12px sans-serif', color = '#fff', bg = 'rgba(0,0,0,0.4)'} = options;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = color; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(16, 4, 1);
  return sprite;
}

// --------------------------- Weapons ---------------------------
const SKIN_LIBRARY = [
  { name: 'Carbon', tex: () => makeStripedTexture(256, 16, ['#2c2c2c', '#3c3c3c']) },
  { name: 'Desert', tex: () => makeRepeatingGridTexture(256, 32, '#6b5b43', '#5f523f') },
  { name: 'Arctic', tex: () => makeRepeatingGridTexture(256, 32, '#96b0c7', '#7e9bb7') },
  { name: 'Neon', tex: () => makeStripedTexture(256, 12, ['#1b1b1b', '#16c1ff']) },
  { name: 'Crimson', tex: () => makeStripedTexture(256, 10, ['#320e12', '#b0192d']) },
  { name: 'Forest', tex: () => makeRepeatingGridTexture(256, 32, '#2c4a2c', '#406b40') },
];

const WEAPON_DEFS = [
  { key: 'pistol', name: 'Pistol', damage: 22, rpm: 420, mag: 15, reserve: 90, reload: 1.2, spread: 0.006, range: 1000, auto: false },
  { key: 'smg', name: 'SMG', damage: 16, rpm: 900, mag: 32, reserve: 192, reload: 1.6, spread: 0.010, range: 850, auto: true },
  { key: 'ar', name: 'Assault Rifle', damage: 28, rpm: 700, mag: 30, reserve: 180, reload: 1.8, spread: 0.008, range: 1100, auto: true },
  { key: 'shotgun', name: 'Shotgun', damage: 12, rpm: 85, mag: 8, reserve: 48, reload: 2.2, spread: 0.035, range: 250, pellets: 8, auto: false },
  { key: 'sniper', name: 'Sniper', damage: 95, rpm: 55, mag: 5, reserve: 25, reload: 2.8, spread: 0.001, range: 2200, auto: false },
  { key: 'lmg', name: 'LMG', damage: 24, rpm: 720, mag: 60, reserve: 360, reload: 3.0, spread: 0.012, range: 1200, auto: true },
];

let currentWeaponIndex = 2; // start with AR
let weaponState = WEAPON_DEFS.map((def) => ({
  ammo: def.mag,
  reserve: def.reserve,
  lastShotTime: 0,
  reloading: false,
  skinIndex: randInt(0, SKIN_LIBRARY.length)
}));

let weaponModelGroup; // First-person weapon model
let muzzleFlash;

function getCurrentWeaponDef() { return WEAPON_DEFS[currentWeaponIndex]; }
function getCurrentWeaponState() { return weaponState[currentWeaponIndex]; }

function updateHUD() {
  const def = getCurrentWeaponDef();
  const st = getCurrentWeaponState();
  weaponNameEl.textContent = `${def.name} · ${SKIN_LIBRARY[st.skinIndex].name}`;
  ammoEl.textContent = `${st.ammo} / ${st.reserve}`;
  healthFill.style.width = `${clamp((player.health / PLAYER_MAX_HEALTH) * 100, 0, 100)}%`;
  document.querySelectorAll('.weapon-chip').forEach((el, i) => {
    if (i === currentWeaponIndex) el.classList.add('active'); else el.classList.remove('active');
  });
}

function buildWeaponWheel() {
  WEAPON_DEFS.forEach((w, i) => {
    const chip = document.createElement('div');
    chip.className = 'weapon-chip';
    chip.textContent = `${i+1}. ${w.name}`;
    weaponWheel.appendChild(chip);
  });
}

function buildWeaponModel() {
  if (weaponModelGroup) {
    camera.remove(weaponModelGroup);
  }
  const def = getCurrentWeaponDef();
  const st = getCurrentWeaponState();
  const skinTex = SKIN_LIBRARY[st.skinIndex].tex();

  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(0.4, 0.2, 0.8);
  const barrelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
  const gripGeo = new THREE.BoxGeometry(0.12, 0.2, 0.2);
  const mat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.7, metalness: 0.2 });

  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.set(0.3, -0.3, -0.6);

  const barrel = new THREE.Mesh(barrelGeo, mat);
  barrel.position.set(0.38, -0.28, -1.0);

  const grip = new THREE.Mesh(gripGeo, mat);
  grip.position.set(0.25, -0.42, -0.5);

  group.add(body, barrel, grip);

  // Muzzle flash sprite
  const flashTex = makeStripedTexture(128, 12, ['#ff9d00', '#ffd966']);
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0.0, depthWrite: false });
  muzzleFlash = new THREE.Sprite(flashMat);
  muzzleFlash.scale.set(0.35, 0.35, 1);
  muzzleFlash.position.set(0.38, -0.28, -1.32);
  group.add(muzzleFlash);

  weaponModelGroup = group;
  camera.add(group);
}

function switchWeapon(nextIndex) {
  if (nextIndex < 0) nextIndex = WEAPON_DEFS.length - 1;
  if (nextIndex >= WEAPON_DEFS.length) nextIndex = 0;
  if (currentWeaponIndex === nextIndex) return;
  currentWeaponIndex = nextIndex;
  buildWeaponModel();
  updateHUD();
}

function tryReload() {
  const def = getCurrentWeaponDef();
  const st = getCurrentWeaponState();
  if (st.reloading) return;
  if (st.ammo >= def.mag || st.reserve <= 0) return;
  st.reloading = true;
  statusText.textContent = 'Reloading...';
  setTimeout(() => {
    const needed = def.mag - st.ammo;
    const take = Math.min(needed, st.reserve);
    st.ammo += take;
    st.reserve -= take;
    st.reloading = false;
    statusText.textContent = '';
    updateHUD();
  }, def.reload * 1000);
}

function canShoot() {
  const def = getCurrentWeaponDef();
  const st = getCurrentWeaponState();
  if (st.reloading) return false;
  if (st.ammo <= 0) { tryReload(); return false; }
  const now = performance.now();
  const msPerShot = 60000 / def.rpm;
  return now - st.lastShotTime >= msPerShot;
}

function shoot() {
  const def = getCurrentWeaponDef();
  const st = getCurrentWeaponState();
  if (!canShoot()) return;

  st.lastShotTime = performance.now();
  if (def.key === 'shotgun') {
    // Fire pellets
    for (let i = 0; i < (def.pellets || 8); i++) performRaycastShot(def, st, def.damage);
  } else {
    performRaycastShot(def, st, def.damage);
  }
  st.ammo -= 1;
  updateHUD();
  flashMuzzle();
}

function flashMuzzle() {
  if (!muzzleFlash) return;
  muzzleFlash.material.opacity = 1.0;
  // quick fade
  const start = performance.now();
  const fade = () => {
    const t = (performance.now() - start) / 90;
    muzzleFlash.material.opacity = Math.max(0, 1 - t);
    if (t < 1) requestAnimationFrame(fade);
  };
  requestAnimationFrame(fade);
}

function performRaycastShot(def, st, damage) {
  // compute shoot direction with spread
  shootPoint.copy(camera.position);
  shootDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
  // apply random spread in camera local space
  const spread = def.spread;
  shootDirection.x += (Math.random() - 0.5) * spread;
  shootDirection.y += (Math.random() - 0.5) * spread;
  shootDirection.z += (Math.random() - 0.5) * spread * 0.2;
  shootDirection.normalize();

  raycaster.set(shootPoint, shootDirection);
  raycaster.far = def.range;

  const intersects = raycaster.intersectObjects(enemyManager.hitMeshes, true);
  if (intersects.length > 0) {
    const hit = intersects[0];
    const enemy = enemyManager.meshToEnemy.get(hit.object);
    if (enemy) {
      applyDamageToEnemy(enemy, damage);
      spawnHitMarker(hit.point);
      return;
    }
  }
  // If not hit enemy, intersect world for impact effect
  const worldHits = raycaster.intersectObjects(worldColliders, true);
  if (worldHits.length > 0) spawnImpact(worldHits[0].point, worldHits[0].face?.normal);
}

function spawnImpact(point, normal) {
  const geo = new THREE.SphereGeometry(2, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(point);
  scene.add(m);
  setTimeout(() => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }, 250);
}

function spawnHitMarker(point) {
  const sprite = createBillboardText('✚', { color: '#ffeb3b', bg: 'rgba(0,0,0,0)' });
  sprite.position.copy(point);
  sprite.scale.set(6, 6, 1);
  scene.add(sprite);
  setTimeout(() => scene.remove(sprite), 220);
}

// --------------------------- Enemies ---------------------------
const enemyManager = {
  enemies: [],
  hitMeshes: [], // meshes for raycast
  meshToEnemy: new Map(),
};

function createEnemy() {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CapsuleGeometry(12, 24, 4, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5) });
  const mesh = new THREE.Mesh(bodyGeo, mat);
  mesh.castShadow = false; mesh.receiveShadow = true;
  group.add(mesh);

  // Health bar sprite
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(22, 3), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  barBg.position.set(0, 28, 0);
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(22, 3), new THREE.MeshBasicMaterial({ color: 0x00ff6a }));
  bar.position.set(0, 28, 0.1);
  bar.scale.x = 1;
  group.add(barBg, bar);

  const enemy = {
    group,
    mesh,
    bar,
    health: 100,
    state: 'patrol', // 'patrol' | 'chase' | 'attack'
    nextWanderTime: 0,
    wanderDir: new THREE.Vector3(1, 0, 0),
    lastShotTime: 0,
  };

  setEnemyRandomPosition(enemy);
  enemyManager.enemies.push(enemy);
  enemyManager.hitMeshes.push(mesh);
  enemyManager.meshToEnemy.set(mesh, enemy);
  scene.add(group);
}

function setEnemyRandomPosition(enemy) {
  enemy.group.position.set(randFloat(-WORLD_SIZE/2, WORLD_SIZE/2), 12, randFloat(-WORLD_SIZE/2, WORLD_SIZE/2));
}

function applyDamageToEnemy(enemy, damage) {
  enemy.health -= damage;
  enemy.bar.scale.x = clamp(enemy.health / 100, 0, 1);
  enemy.bar.material.color.set(enemy.health > 30 ? 0x00ff6a : 0xff3b30);
  if (enemy.health <= 0) {
    // Remove and respawn later
    scene.remove(enemy.group);
    enemyManager.meshToEnemy.delete(enemy.mesh);
    enemyManager.hitMeshes = enemyManager.hitMeshes.filter(m => m !== enemy.mesh);
    enemyManager.enemies = enemyManager.enemies.filter(e => e !== enemy);
    setTimeout(() => {
      createEnemy();
    }, 2000);
  }
}

function updateEnemies(delta) {
  const playerPos = camera.position;
  const now = performance.now();

  for (const e of enemyManager.enemies) {
    const toPlayer = new THREE.Vector3().subVectors(playerPos, e.group.position);
    const dist = toPlayer.length();
    toPlayer.normalize();

    if (dist < 700) e.state = 'attack';
    else if (dist < 1100) e.state = 'chase';
    else e.state = 'patrol';

    if (e.state === 'patrol') {
      if (now > e.nextWanderTime) {
        e.wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        e.nextWanderTime = now + randInt(1500, 3500);
      }
      e.group.position.addScaledVector(e.wanderDir, delta * 60);
    } else if (e.state === 'chase') {
      e.group.position.addScaledVector(toPlayer, delta * 80);
    } else if (e.state === 'attack') {
      e.group.position.addScaledVector(toPlayer, delta * 20);
      // Fire at player with some inaccuracy
      const msPerShot = 800; // slow ROF for enemies
      if (now - e.lastShotTime >= msPerShot) {
        e.lastShotTime = now;
        attemptEnemyShot(e, playerPos);
      }
    }

    // Keep within world bounds
    e.group.position.x = clamp(e.group.position.x, -WORLD_SIZE/2 + 20, WORLD_SIZE/2 - 20);
    e.group.position.z = clamp(e.group.position.z, -WORLD_SIZE/2 + 20, WORLD_SIZE/2 - 20);

    // Face player
    const look = new THREE.Vector3().copy(toPlayer).multiplyScalar(-1);
    const target = new THREE.Vector3().addVectors(e.group.position, look);
    e.group.lookAt(target.x, e.group.position.y, target.z);
  }
}

function attemptEnemyShot(enemy, playerPos) {
  // Hit chance scales with distance
  const dist = enemy.group.position.distanceTo(playerPos);
  const hitChance = clamp(0.6 - dist / 2000, 0.05, 0.35);
  if (Math.random() < hitChance) {
    const dmg = randInt(6, 14);
    applyDamageToPlayer(dmg);
  } else {
    // miss impact near player
    const miss = new THREE.Vector3().copy(playerPos).add(new THREE.Vector3(randFloat(-8,8), randFloat(-2,6), randFloat(-8,8)));
    spawnImpact(miss, new THREE.Vector3(0,1,0));
  }
}

function applyDamageToPlayer(dmg) {
  const now = performance.now();
  if (now - player.lastDamageTime < 200) return; // brief i-frames
  player.lastDamageTime = now;
  player.health -= dmg;
  if (player.health <= 0) {
    player.health = 0;
    statusText.textContent = 'You are down. Respawning...';
    setTimeout(respawnPlayer, 2000);
  }
  updateHUD();
}

function respawnPlayer() {
  camera.position.set(0, 24, 0);
  player.velocity.set(0, 0, 0);
  player.health = PLAYER_MAX_HEALTH;
  statusText.textContent = '';
  updateHUD();
}

// --------------------------- World ---------------------------
const worldColliders = []; // cover boxes for bullet impacts

function initWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111214);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 6000);
  camera.position.set(0, 24, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.getElementById('game').appendChild(renderer.domElement);

  // Lights
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x223322, 0.85);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.65);
  dir.position.set(500, 800, 500);
  scene.add(dir);

  // Terrain
  const tex = makeRepeatingGridTexture(512, 32, '#3a4f3a', '#2e442e');
  tex.repeat.set(WORLD_SIZE / 64, WORLD_SIZE / 64);
  const groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0 });
  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 64, 64);
  terrain = new THREE.Mesh(groundGeo, groundMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Borders (simple visual)
  const borderMat = new THREE.LineBasicMaterial({ color: 0x335a33 });
  const borderGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-WORLD_SIZE/2, 0, -WORLD_SIZE/2),
    new THREE.Vector3(WORLD_SIZE/2, 0, -WORLD_SIZE/2),
    new THREE.Vector3(WORLD_SIZE/2, 0, WORLD_SIZE/2),
    new THREE.Vector3(-WORLD_SIZE/2, 0, WORLD_SIZE/2),
    new THREE.Vector3(-WORLD_SIZE/2, 0, -WORLD_SIZE/2),
  ]);
  const border = new THREE.Line(borderGeo, borderMat);
  scene.add(border);

  // Cover boxes
  const boxGeo = new THREE.BoxGeometry(30, 30, 30);
  for (let i = 0; i < NUM_COVER_BOXES; i++) {
    const color = new THREE.Color().setHSL(0.33 + Math.random() * 0.1, 0.4, 0.25 + Math.random() * 0.15);
    const mat = new THREE.MeshStandardMaterial({ color });
    const box = new THREE.Mesh(boxGeo, mat);
    box.position.set(randFloat(-WORLD_SIZE/2 + 60, WORLD_SIZE/2 - 60), 15, randFloat(-WORLD_SIZE/2 + 60, WORLD_SIZE/2 - 60));
    box.castShadow = true; box.receiveShadow = true;
    scene.add(box);
    worldColliders.push(box);
  }

  // Controls
  controls = new PointerLockControls(camera, renderer.domElement);
  controls.minPolarAngle = Math.PI / 2; // keep horizontal view (no pitch limit from API, but we can limit input)
  controls.maxPolarAngle = Math.PI / 2;

  clock = new THREE.Clock();

  // Create initial weapon model
  buildWeaponModel();

  // Enemies
  for (let i = 0; i < ENEMY_TARGET_COUNT; i++) createEnemy();

  // HUD
  buildWeaponWheel();
  updateHUD();

  // Events
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: true });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(e) {
  if (e.code === 'KeyW') input.forward = true;
  if (e.code === 'KeyS') input.backward = true;
  if (e.code === 'KeyA') input.left = true;
  if (e.code === 'KeyD') input.right = true;
  if (e.code === 'Space') input.jump = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = true;
  if (e.code === 'KeyR') tryReload();

  if (e.code >= 'Digit1' && e.code <= 'Digit6') {
    const idx = parseInt(e.code.replace('Digit', ''), 10) - 1;
    switchWeapon(idx);
  }
}

function onKeyUp(e) {
  if (e.code === 'KeyW') input.forward = false;
  if (e.code === 'KeyS') input.backward = false;
  if (e.code === 'KeyA') input.left = false;
  if (e.code === 'KeyD') input.right = false;
  if (e.code === 'Space') input.jump = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false;
}

function onMouseDown(e) {
  if (e.button === 0) {
    input.shooting = true;
    shoot();
  }
}

function onMouseUp(e) {
  if (e.button === 0) input.shooting = false;
}

function onWheel(e) {
  const delta = Math.sign(e.deltaY);
  if (delta > 0) switchWeapon(currentWeaponIndex + 1);
  else if (delta < 0) switchWeapon(currentWeaponIndex - 1);
}

// --------------------------- Movement ---------------------------
const keyDir = new THREE.Vector3();

function updateMovement(delta) {
  // compute intended direction in camera space
  keyDir.set(0, 0, 0);
  if (input.forward) keyDir.z -= 1;
  if (input.backward) keyDir.z += 1;
  if (input.left) keyDir.x -= 1;
  if (input.right) keyDir.x += 1;

  if (keyDir.lengthSq() > 0) {
    keyDir.normalize();
    // rotate by camera yaw only (ignore pitch)
    const yaw = controls.getObject().rotation.y;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const dirX = keyDir.x * cos - keyDir.z * sin;
    const dirZ = keyDir.x * sin + keyDir.z * cos;
    keyDir.set(dirX, 0, dirZ);
  }

  const speed = PLAYER_SPEED * (input.sprint ? PLAYER_SPRINT_MULTIPLIER : 1);
  const accel = 600; // ground accel

  // accelerate towards keyDir on XZ plane
  const targetVel = new THREE.Vector3().copy(keyDir).multiplyScalar(speed);
  const dv = new THREE.Vector3().subVectors(targetVel, player.velocity);
  const accelStep = clamp(accel * delta, 0, 1);
  player.velocity.addScaledVector(dv, accelStep);

  // gravity and jump
  if (!player.onGround) player.velocity.y -= GRAVITY * delta;
  if (player.onGround && input.jump) {
    player.velocity.y = PLAYER_JUMP_VELOCITY;
    player.onGround = false;
  }

  // integrate
  controls.getObject().position.addScaledVector(player.velocity, delta);

  // ground collision at y=24 (camera eye level above terrain)
  const groundY = 24;
  if (controls.getObject().position.y <= groundY) {
    controls.getObject().position.y = groundY;
    player.velocity.y = 0;
    player.onGround = true;
  }

  // keep within world bounds
  controls.getObject().position.x = clamp(controls.getObject().position.x, -WORLD_SIZE/2 + 10, WORLD_SIZE/2 - 10);
  controls.getObject().position.z = clamp(controls.getObject().position.z, -WORLD_SIZE/2 + 10, WORLD_SIZE/2 - 10);
}

// --------------------------- Game Loop ---------------------------
function animate() {
  const delta = clamp(clock.getDelta(), 0, 0.05);

  updateMovement(delta);
  if (input.shooting && getCurrentWeaponDef().auto) shoot();
  updateEnemies(delta);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// --------------------------- Bootstrap ---------------------------
startBtn.addEventListener('click', () => {
  overlay.classList.add('hidden');
  initWorld();
  controls.lock();
  animate();
});

// Unlock/lock feedback
if (document.pointerLockElement === null) {
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer?.domElement;
    if (!locked) overlay.classList.remove('hidden');
  });
}

