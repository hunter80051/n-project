export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  ENTRANCE: 2,
  STAIRS: 3
});

export const DUNGEON_OBJECT = Object.freeze({
  WALL: 'wall',
  DOOR: 'door',
  ENTRANCE_STAIRS: 'entranceStairs',
  STAIRS_DOWN: 'stairsDown',
  EXIT_PORTAL: 'exitPortal'
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

function roomsOverlapWithPadding(a, b, padding = 5) {
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

function orderRoomsAsRoute(rooms) {
  const ordered = [rooms[0]];
  const remaining = rooms.slice(1);
  while (remaining.length > 0) {
    const from = roomCenter(ordered.at(-1));
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    remaining.forEach((room, index) => {
      const to = roomCenter(room);
      const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    ordered.push(remaining.splice(nearestIndex, 1)[0]);
  }
  return ordered;
}

function carveCorridorPath(tiles, from, to, random) {
  const points = [];
  let x = from.x;
  let y = from.y;
  const addPoint = () => {
    tiles[y][x] = TILE.FLOOR;
    if (points.at(-1)?.x !== x || points.at(-1)?.y !== y) points.push({ x, y });
  };
  const moveX = () => {
    while (x !== to.x) {
      x += Math.sign(to.x - x);
      addPoint();
    }
  };
  const moveY = () => {
    while (y !== to.y) {
      y += Math.sign(to.y - y);
      addPoint();
    }
  };
  addPoint();
  if (random() < 0.5) {
    moveX();
    moveY();
  } else {
    moveY();
    moveX();
  }
  return points;
}

function pointInRoom(point, room) {
  return point.x >= room.x && point.x < room.x + room.width
    && point.y >= room.y && point.y < room.y + room.height;
}

function findDoor(corridor, fromRoom, targetGroup) {
  for (let index = 1; index < corridor.length; index += 1) {
    if (pointInRoom(corridor[index], fromRoom)) continue;
    const inside = corridor[index - 1];
    const outside = corridor[index];
    const dx = outside.x - inside.x;
    const dy = outside.y - inside.y;
    return {
      type: DUNGEON_OBJECT.DOOR,
      x: inside.x,
      y: inside.y,
      direction: { x: dx, y: dy },
      orientation: dx !== 0 ? 'axisX' : 'axisY',
      revealGroup: targetGroup - 1,
      targetGroup,
      trigger: { ...inside }
    };
  }
  const fallback = corridor[Math.max(0, corridor.length - 2)];
  return {
    type: DUNGEON_OBJECT.DOOR,
    x: fallback.x,
    y: fallback.y,
    direction: { x: 1, y: 0 },
    orientation: 'axisX',
    revealGroup: targetGroup - 1,
    targetGroup,
    trigger: { ...fallback }
  };
}

function assignRevealGroups(tiles, rooms, corridors) {
  const groups = tiles.map((row) => row.map(() => -1));
  rooms.forEach((room, group) => {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) groups[y][x] = group;
    }
  });
  corridors.forEach((corridor, index) => {
    const group = index + 1;
    for (const point of corridor) {
      if (groups[point.y][point.x] < 0 || groups[point.y][point.x] > group) groups[point.y][point.x] = group;
    }
  });
  return groups;
}

function boundaryObjects(tiles, groups) {
  const objects = [];
  const edges = [
    { dx: -1, dy: 0, edge: 'west', orientation: 'axisY' },
    { dx: 1, dy: 0, edge: 'east', orientation: 'axisY' },
    { dx: 0, dy: -1, edge: 'north', orientation: 'axisX' },
    { dx: 0, dy: 1, edge: 'south', orientation: 'axisX' }
  ];
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[y].length; x += 1) {
      if (!isWalkable(tiles[y][x])) continue;
      for (const edge of edges) {
        const neighborX = x + edge.dx;
        const neighborY = y + edge.dy;
        const neighbor = tiles[neighborY]?.[neighborX] ?? TILE.WALL;
        if (isWalkable(neighbor)) continue;
        objects.push({
          type: DUNGEON_OBJECT.WALL,
          x,
          y,
          edge: edge.edge,
          orientation: edge.orientation,
          revealGroup: groups[y][x]
        });
      }
    }
  }
  return objects;
}

function collectRoomSpawnPoints(rooms, count, entrance, stairs, random) {
  const blocked = new Set([pointKey(entrance), pointKey(stairs)]);
  const candidatesByGroup = rooms.map((room, revealGroup) => {
    const candidates = [];
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        if (!blocked.has(`${x},${y}`)) candidates.push({ x, y, revealGroup });
      }
    }
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(random, 0, index);
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    return candidates;
  });
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const group = index % rooms.length;
    const point = candidatesByGroup[group].pop();
    if (point) result.push(point);
  }
  for (const candidates of candidatesByGroup) {
    while (result.length < count && candidates.length > 0) result.push(candidates.pop());
  }
  return result;
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
  const orderedRooms = orderRoomsAsRoute(rooms).map((room, revealGroup) => ({ ...room, revealGroup }));
  const corridors = [];
  const doors = [];
  const edges = [];
  for (let index = 1; index < orderedRooms.length; index += 1) {
    const corridor = carveCorridorPath(
      tiles,
      roomCenter(orderedRooms[index - 1]),
      roomCenter(orderedRooms[index]),
      random
    );
    corridors.push(corridor);
    doors.push(findDoor(corridor, orderedRooms[index - 1], index));
    edges.push([index - 1, index]);
  }
  const groups = assignRevealGroups(tiles, orderedRooms, corridors);
  const entrance = roomCenter(orderedRooms[0]);
  const stairs = roomCenter(orderedRooms.at(-1));
  tiles[entrance.y][entrance.x] = TILE.ENTRANCE;
  tiles[stairs.y][stairs.x] = TILE.STAIRS;
  const spawnPoints = collectRoomSpawnPoints(orderedRooms, enemyCount, entrance, stairs, random);
  const objects = [
    ...boundaryObjects(tiles, groups),
    ...doors,
    {
      type: DUNGEON_OBJECT.ENTRANCE_STAIRS,
      x: entrance.x,
      y: entrance.y,
      orientation: 'axisX',
      revealGroup: 0
    },
    {
      type: DUNGEON_OBJECT.STAIRS_DOWN,
      x: stairs.x,
      y: stairs.y,
      orientation: 'axisY',
      revealGroup: orderedRooms.length - 1
    }
  ];

  return {
    width,
    height,
    tiles,
    rooms: orderedRooms,
    edges,
    corridors,
    groups,
    objects,
    doorTriggers: doors.map((door) => ({ ...door.trigger, targetGroup: door.targetGroup })),
    maxRevealGroup: orderedRooms.length - 1,
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
  room.revealGroup = 0;

  const entrance = { x: room.x + 1, y: room.y + Math.floor(room.height / 2) };
  const stairs = { x: room.x + room.width - 2, y: entrance.y };
  const bossPoint = roomCenter(room);
  tiles[entrance.y][entrance.x] = TILE.ENTRANCE;
  tiles[stairs.y][stairs.x] = TILE.STAIRS;

  const groups = assignRevealGroups(tiles, [room], []);
  const spawnPoints = [{ ...bossPoint, revealGroup: 0 }];
  if (enemyCount > 1) {
    const random = createSeededRandom(seed);
    spawnPoints.push(...collectRoomSpawnPoints([room], enemyCount - 1, entrance, stairs, random));
  }
  const objects = [
    ...boundaryObjects(tiles, groups),
    {
      type: DUNGEON_OBJECT.ENTRANCE_STAIRS,
      x: entrance.x,
      y: entrance.y,
      orientation: 'axisX',
      revealGroup: 0
    },
    {
      type: DUNGEON_OBJECT.EXIT_PORTAL,
      x: stairs.x,
      y: stairs.y,
      orientation: 'axisY',
      revealGroup: 0
    }
  ];

  return {
    width,
    height,
    tiles,
    rooms: [room],
    edges: [],
    corridors: [],
    groups,
    objects,
    doorTriggers: [],
    maxRevealGroup: 0,
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

export function findPath(tiles, start, goal, visibility = null) {
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
      if (visibility?.groups && visibility.groups[next.y][next.x] > visibility.maxGroup) continue;
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
