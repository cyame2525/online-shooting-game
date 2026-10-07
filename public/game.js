const socket = io();

const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const joinButton = document.getElementById("join-button");
const nameInput = document.getElementById("player-name");
const weaponSelect = document.getElementById("weapon-select");
const colorInput = document.getElementById("skin-color");
const healthValue = document.getElementById("health-value");
const killsValue = document.getElementById("kills-value");
const playersCount = document.getElementById("players-count");
const killfeed = document.getElementById("killfeed");
const canvas = document.getElementById("gameCanvas");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x091d2d);
scene.fog = new THREE.Fog(0x091d2d, 26, 110);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const ambient = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambient);

const sunlight = new THREE.DirectionalLight(0xbfe1ff, 1.2);
sunlight.position.set(18, 28, 12);
scene.add(sunlight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x244d3d, roughness: 0.95, metalness: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const safeZone = new THREE.Mesh(
  new THREE.RingGeometry(26, 30, 64),
  new THREE.MeshBasicMaterial({ color: 0x66d4ff, side: THREE.DoubleSide, transparent: true, opacity: 0.3 })
);
safeZone.rotation.x = -Math.PI / 2;
safeZone.position.y = 0.02;
scene.add(safeZone);

const obstaclePositions = [
  [-12, -10, 4, 4], [12, -12, 4, 4], [-20, 18, 6, 3], [20, 18, 5, 4],
  [-30, 8, 5, 5], [30, 0, 5, 5], [0, -22, 6, 3], [0, 22, 6, 3],
  [-8, 28, 4, 4], [8, -28, 4, 4], [28, -22, 4, 4], [-28, -18, 4, 4]
];

for (const [x, z, width, depth] of obstaclePositions) {
  const obstacle = new THREE.Mesh(
    new THREE.BoxGeometry(width, 4, depth),
    new THREE.MeshStandardMaterial({ color: 0x4b647a, roughness: 1 })
  );
  obstacle.position.set(x, 2, z);
  scene.add(obstacle);
}

const playerMeshes = new Map();
const state = {
  yaw: 0,
  pitch: 0.25,
  fire: false,
  joined: false,
  localId: null,
  localPlayer: null
};
const keys = {};

function createNameSprite(name) {
  const canvasLabel = document.createElement("canvas");
  canvasLabel.width = 256;
  canvasLabel.height = 64;
  const ctx = canvasLabel.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.strokeRect(0, 0, 256, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvasLabel);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(5.5, 1.35, 1);
  return sprite;
}

function createPlayerMesh(player) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: player.color || "#5ec2ff", roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.8, 4, 8), bodyMat);
  body.position.y = 1.7;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf3d7ba, roughness: 0.9 })
  );
  head.position.y = 3.2;
  group.add(head);

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.2, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 })
  );
  gun.position.set(0.8, 2.2, 0.3);
  group.add(gun);

  const label = createNameSprite(player.name || "Ranger");
  label.position.set(0, 4.5, 0);
  group.add(label);

  group.position.set(player.x, 0, player.z);
  group.rotation.y = player.yaw || 0;
  scene.add(group);

  playerMeshes.set(player.id, { group, body, gun, label, player });
}

function updatePlayerMesh(player) {
  const existing = playerMeshes.get(player.id);
  if (!existing) {
    createPlayerMesh(player);
    return;
  }

  const { group, label } = existing;
  group.position.set(player.x, 0, player.z);
  group.rotation.y = player.yaw || 0;
  if (player.health <= 0) {
    group.visible = false;
  } else {
    group.visible = true;
    const material = existing.body.material;
    material.color = new THREE.Color(player.color || "#5ec2ff");
    existing.label.material.map.needsUpdate = true;
  }
  label.position.y = 4.5;
}

function removeMissingPlayers(currentPlayers) {
  const currentIds = new Set(currentPlayers.map((player) => player.id));
  for (const [id, meshInfo] of playerMeshes.entries()) {
    if (!currentIds.has(id)) {
      scene.remove(meshInfo.group);
      playerMeshes.delete(id);
    }
  }
}

function renderKillfeed(text) {
  const item = document.createElement("div");
  item.className = "killfeed-item";
  item.textContent = text;
  killfeed.appendChild(item);
  setTimeout(() => item.remove(), 2800);
}

function updateHud(player) {
  if (!player) return;
  healthValue.textContent = Math.max(0, Math.round(player.health));
  killsValue.textContent = player.kills || 0;
}

function processState(data) {
  const currentPlayers = data.players || [];
  for (const player of currentPlayers) {
    updatePlayerMesh(player);
  }
  removeMissingPlayers(currentPlayers);

  const localPlayer = currentPlayers.find((player) => player.id === state.localId) || state.localPlayer;
  state.localPlayer = localPlayer || state.localPlayer;
  if (localPlayer) {
    updateHud(localPlayer);
  }

  playersCount.textContent = `${currentPlayers.length} / ${data.maxPlayers || 10}`;
}

socket.on("join-failed", (payload) => {
  alert(payload.message || "Join failed");
});

socket.on("joined", ({ id }) => {
  state.joined = true;
  state.localId = id;
  menu.classList.add("hidden");
  hud.classList.remove("hidden");
  document.body.requestPointerLock?.();
});

socket.on("state", processState);

socket.on("killfeed", ({ killer, victim }) => {
  renderKillfeed(`${killer} eliminated ${victim}`);
});

joinButton.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Ranger";
  const weapon = weaponSelect.value || "rifle";
  const color = colorInput.value || "#5ec2ff";
  socket.emit("joinGame", { name, weapon, color });
});

window.addEventListener("keydown", (event) => {
  keys[event.code] = true;
  if (event.code === "KeyQ") {
    state.fire = true;
  }
});

window.addEventListener("keyup", (event) => {
  keys[event.code] = false;
  if (event.code === "KeyQ") {
    state.fire = false;
  }
});

window.addEventListener("mousedown", () => {
  state.fire = true;
});

window.addEventListener("mouseup", () => {
  state.fire = false;
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== document.body) {
    state.fire = false;
  }
});

window.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement === document.body) {
    state.yaw -= event.movementX * 0.004;
    state.pitch = Math.max(-1.1, Math.min(1.1, state.pitch - event.movementY * 0.0022));
  }
});

function cameraFollow() {
  const local = state.localPlayer;
  if (!local || !local.alive) {
    return;
  }

  const targetPos = new THREE.Vector3(
    local.x - Math.sin(state.yaw) * 11,
    8 + state.pitch * 2,
    local.z - Math.cos(state.yaw) * 11
  );

  camera.position.lerp(targetPos, 0.12);
  camera.lookAt(local.x, 2.2, local.z);
}

function animate() {
  requestAnimationFrame(animate);

  const moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);

  if (state.joined && state.localId) {
    const normalizedLength = Math.hypot(moveX, moveZ) || 1;
    const worldX = (moveZ * Math.sin(state.yaw) + moveX * Math.cos(state.yaw)) / normalizedLength;
    const worldZ = (moveZ * Math.cos(state.yaw) - moveX * Math.sin(state.yaw)) / normalizedLength;

    socket.emit("input", {
      moveX: Number((Math.abs(moveX) || Math.abs(moveZ)) ? worldX : 0),
      moveZ: Number((Math.abs(moveX) || Math.abs(moveZ)) ? worldZ : 0),
      yaw: state.yaw,
      fire: state.fire
    });
  }

  cameraFollow();
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

camera.position.set(0, 8, 16);
camera.lookAt(0, 1.5, 0);
animate();
