export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  ENTRANCE: 2,
  STAIRS: 3
});

export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const randomInt = (random, min, max) => Math.floor(random() * (max - min + 1)) + min;
const pointKey = (point) => `${point.x},${point.y}`;
const roomCenter = (room) => ({
  x: room.x + Math.floor(room.width / 2),
  y: room.y + Math.floor(room.height / 2)
});

function createTiles(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(TILE.WALL));
}

function roomsOverlapWithPadding(a, b, padding = 1) {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

function carveRoom(tiles, room) {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) tiles[y][x] = TILE.FLOOR;
  }
}

function carveHorizontal(tiles, fromX, toX, y) {
  const start = Math.min(fromX, toX);
  const end = Math.max(fromX, toX);
  for (let x = start; x <= end; x += 1) tiles[y][x] = TILE.FLOOR;
}

function carveVertical(tiles, fromY, toY, x) {
  const start = Math.min(fromY, toY);
  const end = Math.max(fromY, toY);
  for (let y = start; y <= end; y += 1) tiles[y][x] = TILE.FLOOR;
}

function carveCorridor(tiles, from, to, random) {
  if (random() < 0.5) {
    carveHorizontal(tiles, from.x, to.x, from.y);
    carveVertical(tiles, from.y, to.y, to.x);
  } else {
    carveVertical(tiles, from.y, to.y, from.x);
    carveHorizontal(tiles, from.x, to.x, to.y);
  }
}

function connectRooms(tiles, rooms, random) {
  const connected = new Set([0]);
  const edges = [];

  while (connected.size < rooms.length) {
    let best = null;
    for (const fromIndex of connected) {
      const from = roomCenter(rooms[fromIndex]);
      for (let toIndex = 0; toIndex < rooms.length; toIndex += 1) {
        if (connected.has(toIndex)) continue;
        const to = roomCenter(rooms[toIndex]);
        const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        if (!best || distance < best.distance) best = { fromIndex, toIndex, from, to, distance };
      }
    }
    carveCorridor(tiles, best.from, best.to, random);
    edges.push([best.fromIndex, best.toIndex]);
    connected.add(best.toIndex);
  }

  const extraCount = randomInt(random, 0, Math.min(2, Math.max(0, rooms.length - 2)));
  for (let extra = 0; extra < extraCount; extra += 1) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const fromIndex = randomInt(random, 0, rooms.length - 1);
      const toIndex = randomInt(random, 0, rooms.length - 1);
      if (fromIndex === toIndex) continue;
      const exists = edges.some(([a, b]) =>
        (a === fromIndex && b === toIndex) || (a === toIndex && b === fromIndex));
      if (exists) continue;
      carveCorridor(tiles, roomCenter(rooms[fromIndex]), roomCenter(rooms[toIndex]), random);
      edges.push([fromIndex, toIndex]);
      break;
    }
  }

  return edges;
}

function collectSpawnPoints(tiles, count, entrance, stairs, random) {
  const blocked = new Set([pointKey(entrance), pointKey(stairs)]);
  const candidates = [];
  for (let y = 1; y < tiles.length - 1; y += 1) {
    for (let x = 1; x < tiles[y].length - 1; x += 1) {
      if (!isWalkable(tiles[y][x]) || blocked.has(`${x},${y}`)) continue;
      if (Math.abs(x - entrance.x) + Math.abs(y - entrance.y) < 5) continue;
      candidates.push({ x, y });
    }
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, 0, index);
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  return candidates.slice(0, Math.min(count, candidates.length));
}

function tryGenerateDungeon(options, seed) {
  const {
    width = 40,
    height = 22,
    roomCountMin = 5,
    roomCountMax = 7,
    roomMinSize = 4,
    roomMaxSize = 7,
    enemyCount = 6
  } = options;
  const random = createSeededRandom(seed);
  const tiles = createTiles(width, height);
  const rooms = [];
  const targetRoomCount = randomInt(random, roomCountMin, roomCountMax);

  for (let attempt = 0; attempt < 1200 && rooms.length < targetRoomCount; attempt += 1) {
    const roomWidth = randomInt(random, roomMinSize, roomMaxSize);
    const roomHeight = randomInt(random, roomMinSize, roomMaxSize);
    const room = {
      x: randomInt(random, 1, width - roomWidth - 2),
      y: randomInt(random, 1, height - roomHeight - 2),
      width: roomWidth,
      height: roomHeight
    };
    if (rooms.some((placed) => roomsOverlapWithPadding(room, placed))) continue;
    rooms.push(room);
    carveRoom(tiles, room);
  }

  if (rooms.length < roomCountMin) return null;
  const edges = connectRooms(tiles, rooms, random);
  const entrance = roomCenter(rooms[0]);
  const stairsRoom = rooms.reduce((farthest, room) => {
    const center = roomCenter(room);
    const distance = Math.abs(center.x - entrance.x) + Math.abs(center.y - entrance.y);
    return distance > farthest.distance ? { room, distance } : farthest;
  }, { room: rooms[rooms.length - 1], distance: -1 }).room;
  const stairs = roomCenter(stairsRoom);
  tiles[entrance.y][entrance.x] = TILE.ENTRANCE;
  tiles[stairs.y][stairs.x] = TILE.STAIRS;
  const spawnPoints = collectSpawnPoints(tiles, enemyCount, entrance, stairs, random);

  return {
    width,
    height,
    tiles,
    rooms,
    edges,
    entrance,
    stairs,
    spawnPoints,
    seed,
    isBossFloor: false
  };
}

export function generateDungeonFloor(options = {}) {
  const baseSeed = Number(options.seed ?? Date.now()) >>> 0;
  for (let offset = 0; offset < 50; offset += 1) {
    const floor = tryGenerateDungeon(options, baseSeed + offset);
    if (floor) return floor;
  }
  throw new Error('嘗試 50 個 seed 後仍無法生成足夠房間的地下城');
}

export function generateBossFloor(options = {}) {
  const width = options.width ?? 40;
  const height = options.height ?? 22;
  const enemyCount = options.enemyCount ?? 1;
  const seed = Number(options.seed ?? Date.now()) >>> 0;
  const tiles = createTiles(width, height);
  const room = { x: 4, y: 3, width: width - 8, height: height - 6 };
  carveRoom(tiles, room);

  const entrance = { x: room.x + 1, y: room.y + Math.floor(room.height / 2) };
  const stairs = { x: room.x + room.width - 2, y: entrance.y };
  const bossPoint = roomCenter(room);
  tiles[entrance.y][entrance.x] = TILE.ENTRANCE;
  tiles[stairs.y][stairs.x] = TILE.STAIRS;

  const spawnPoints = [bossPoint];
  if (enemyCount > 1) {
    const random = createSeededRandom(seed);
    spawnPoints.push(...collectSpawnPoints(tiles, enemyCount - 1, entrance, stairs, random));
  }

  return {
    width,
    height,
    tiles,
    rooms: [room],
    edges: [],
    entrance,
    stairs,
    spawnPoints: spawnPoints.slice(0, enemyCount),
    seed,
    isBossFloor: true
  };
}

export function isWalkable(tile) {
  return tile === TILE.FLOOR || tile === TILE.ENTRANCE || tile === TILE.STAIRS;
}

export function findPath(tiles, start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  const width = tiles[0]?.length ?? 0;
  const height = tiles.length;
  const startKey = pointKey(start);
  const goalKey = pointKey(goal);
  const queue = [{ x: start.x, y: start.y }];
  const previous = new Map([[startKey, null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const point = queue[cursor];
    if (pointKey(point) === goalKey) break;
    for (const [dx, dy] of directions) {
      const next = { x: point.x + dx, y: point.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;
      const key = pointKey(next);
      if (previous.has(key) || !isWalkable(tiles[next.y][next.x])) continue;
      previous.set(key, point);
      queue.push(next);
    }
  }

  if (!previous.has(goalKey)) return [];
  const path = [];
  let current = { x: goal.x, y: goal.y };
  while (pointKey(current) !== startKey) {
    path.push(current);
    current = previous.get(pointKey(current));
  }
  path.reverse();
  return path;
}
