const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const WORLD_HALF = 48;
const STARTING_HEALTH = 100;

const WEAPONS = {
  shotgun: { fireRate: 700, damage: 34, range: 18, spread: 0.45, pellets: 6, color: "#ff7a7a" },
  rifle: { fireRate: 130, damage: 14, range: 42, spread: 0.14, pellets: 1, color: "#5ac8fa" },
  sniper: { fireRate: 1100, damage: 70, range: 90, spread: 0.08, pellets: 1, color: "#d4c1ff" }
};

const SPAWNS = [
  [-30, -30], [30, -30], [0, -36], [-25, 25], [25, 25], [0, 26],
  [-38, 0], [38, 0], [-10, 0], [10, 0]
];

const players = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function randomSpawn() {
  const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  return { x: s[0], z: s[1] };
}

function createPlayer(id, name, weapon, color) {
  const spawn = randomSpawn();
  return {
    id,
    name,
    weapon,
    color,
    x: spawn.x,
    y: 0.9,
    z: spawn.z,
    yaw: 0,
    moveX: 0,
    moveZ: 0,
    fire: false,
    health: STARTING_HEALTH,
    alive: true,
    kills: 0,
    deaths: 0,
    lastShot: 0,
    respawnAt: 0
  };
}

function respawnPlayer(player) {
  const spawn = randomSpawn();
  player.x = spawn.x;
  player.z = spawn.z;
  player.health = STARTING_HEALTH;
  player.alive = true;
  player.respawnAt = 0;
}

function sanitizeName(value) {
  const s = String(value || "Ranger").trim();
  return s.slice(0, 18) || "Ranger";
}

function getPublicPlayers() {
  return Array.from(players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    weapon: p.weapon,
    color: p.color,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    health: p.health,
    alive: p.alive,
    kills: p.kills,
    deaths: p.deaths
  }));
}

function applyDamage(attackerId, target, damage) {
  if (!target || !target.alive) return;

  target.health -= damage;
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.deaths += 1;
    const killer = players.get(attackerId);
    if (killer) {
      killer.kills += 1;
      io.emit("killfeed", { killer: killer.name, victim: target.name });
    }
    target.respawnAt = Date.now() + 2500;
  }
}

function handleShot(player) {
  const cfg = WEAPONS[player.weapon];
  if (!cfg) return;

  let hitTarget = null;
  let bestDistance = Infinity;

  for (const opponent of players.values()) {
    if (opponent.id === player.id || !opponent.alive) continue;

    const dx = opponent.x - player.x;
    const dz = opponent.z - player.z;
    const distance = Math.hypot(dx, dz);

    if (distance > cfg.range) continue;

    const targetAngle = Math.atan2(dx, dz);
    const diff = Math.abs(normalizeAngle(targetAngle - player.yaw));

    if (diff < cfg.spread + 0.2 && distance < bestDistance) {
      bestDistance = distance;
      hitTarget = opponent;
    }
  }

  if (hitTarget) {
    applyDamage(player.id, hitTarget, cfg.damage);
  }
}

function tick() {
  const now = Date.now();

  for (const player of players.values()) {
    if (!player.alive) {
      if (now >= player.respawnAt) {
        respawnPlayer(player);
      }
      continue;
    }

    const moveScale = 0.18;
    const nextX = player.x + (player.moveX * moveScale);
    const nextZ = player.z + (player.moveZ * moveScale);

    player.x = clamp(nextX, -WORLD_HALF, WORLD_HALF);
    player.z = clamp(nextZ, -WORLD_HALF, WORLD_HALF);

    if (player.fire && now - player.lastShot > WEAPONS[player.weapon].fireRate) {
      player.lastShot = now;
      handleShot(player);
    }
  }

  io.emit("state", {
    maxPlayers: MAX_PLAYERS,
    players: getPublicPlayers()
  });
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("joinGame", ({ name, weapon, color }) => {
    if (players.size >= MAX_PLAYERS) {
      socket.emit("join-failed", { message: "最大10人です。満員です。" });
      return;
    }

    const safeWeapon = WEAPONS[weapon] ? weapon : "rifle";
    const safeColor = typeof color === "string" && color ? color : "#5ac8fa";

    const player = createPlayer(socket.id, sanitizeName(name), safeWeapon, safeColor);
    players.set(socket.id, player);

    socket.emit("joined", { id: socket.id, weapons: Object.keys(WEAPONS) });

    io.emit("state", {
      maxPlayers: MAX_PLAYERS,
      players: getPublicPlayers()
    });
  });

  socket.on("input", ({ moveX, moveZ, yaw, fire }) => {
    const player = players.get(socket.id);
    if (!player || !player.alive) return;

    player.moveX = Number(moveX) || 0;
    player.moveZ = Number(moveZ) || 0;
    player.yaw = Number(yaw) || 0;
    player.fire = Boolean(fire);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("state", {
      maxPlayers: MAX_PLAYERS,
      players: getPublicPlayers()
    });
  });
});

app.get("/health", (_, res) => {
  res.json({ ok: true, players: players.size, maxPlayers: MAX_PLAYERS });
});

server.listen(PORT, () => {
  console.log(`Battle shooter running on http://localhost:${PORT}`);
});

setInterval(tick, 1000 / 30);
