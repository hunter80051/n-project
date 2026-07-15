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
const CORRIDOR_RADIUS = 1;
const corridorFootprint = (point) => {
  const cells = [];
  for (let y = point.y - CORRIDOR_RADIUS; y <= point.y + CORRIDOR_RADIUS; y += 1) {
    for (let x = point.x - CORRIDOR_RADIUS; x <= point.x + CORRIDOR_RADIUS; x += 1) cells.push({ x, y });
  }
  return cells;
};
const roomCenter = (room) => ({
  x: room.x + Math.floor(room.width / 2),
  y: room.y + Math.floor(room.height / 2)
});
const roomDistance = (a, b) => {
  const from = roomCenter(a);
  const to = roomCenter(b);
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
};

function createTiles(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(TILE.WALL));
}

function roomsOverlapWithPadding(a, b, padding = 3) {
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

function orderRoomsAsRoute(rooms, width, height) {
  const mapCenter = { x: width / 2, y: height / 2 };
  let startIndex = 0;
  let startDistance = Infinity;
  rooms.forEach((room, index) => {
    const center = roomCenter(room);
    const distance = Math.abs(center.x - mapCenter.x) + Math.abs(center.y - mapCenter.y);
    if (distance < startDistance) {
      startIndex = index;
      startDistance = distance;
    }
  });
  const remaining = rooms.slice();
  const ordered = [remaining.splice(startIndex, 1)[0]];
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

function createSpreadRoom(random, width, height, rooms, roomMinSize, roomMaxSize, roomMinArea) {
  let bestRoom = null;
  let bestDistance = -1;
  for (let sample = 0; sample < 32; sample += 1) {
    const roomWidth = randomInt(random, roomMinSize, roomMaxSize);
    const roomHeight = randomInt(random, roomMinSize, roomMaxSize);
    if (roomWidth * roomHeight < roomMinArea) continue;
    const room = {
      x: randomInt(random, 1, width - roomWidth - 2),
      y: randomInt(random, 1, height - roomHeight - 2),
      width: roomWidth,
      height: roomHeight
    };
    if (rooms.some((placed) => roomsOverlapWithPadding(room, placed))) continue;
    const nearestDistance = rooms.length === 0
      ? 0
      : Math.min(...rooms.map((placed) => roomDistance(room, placed)));
    if (nearestDistance > bestDistance) {
      bestRoom = room;
      bestDistance = nearestDistance;
    }
  }
  return bestRoom;
}

function orthogonalCorridor(from, to, horizontalFirst) {
  const points = [];
  let x = from.x;
  let y = from.y;
  const addPoint = () => {
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
  if (horizontalFirst) {
    moveX();
    moveY();
  } else {
    moveY();
    moveX();
  }
  return points;
}

function canUseCorridorPoint(point, width, height, fromRoom, toRoom, rooms, occupiedCorridors) {
  if (point.x <= CORRIDOR_RADIUS || point.y <= CORRIDOR_RADIUS
    || point.x >= width - CORRIDOR_RADIUS - 1 || point.y >= height - CORRIDOR_RADIUS - 1) return false;
  const clearance = corridorFootprint(point);
  if (clearance.some((neighbor) => !pointInRoom(neighbor, fromRoom)
    && !pointInRoom(neighbor, toRoom)
    && occupiedCorridors.has(pointKey(neighbor)))) return false;
  return !rooms.some((room) => room !== fromRoom && room !== toRoom
    && clearance.some((neighbor) => pointInRoom(neighbor, room)));
}

function findCorridorPath(width, height, fromRoom, toRoom, rooms, occupiedCorridors, random) {
  const from = roomCenter(fromRoom);
  const to = roomCenter(toRoom);
  const maxCorridorLength = Math.max(18, Math.ceil((width + height) * 0.4));
  const directPaths = random() < 0.5
    ? [orthogonalCorridor(from, to, true), orthogonalCorridor(from, to, false)]
    : [orthogonalCorridor(from, to, false), orthogonalCorridor(from, to, true)];
  for (const path of directPaths) {
    if (path.length <= maxCorridorLength && path.every((point) => canUseCorridorPoint(
      point,
      width,
      height,
      fromRoom,
      toRoom,
      rooms,
      occupiedCorridors
    ))) return path;
  }

  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let index = directions.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, 0, index);
    [directions[index], directions[swapIndex]] = [directions[swapIndex], directions[index]];
  }
  const startKey = pointKey(from);
  const goalKey = pointKey(to);
  const queue = [from];
  const previous = new Map([[startKey, null]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const point = queue[cursor];
    if (pointKey(point) === goalKey) break;
    for (const [dx, dy] of directions) {
      const next = { x: point.x + dx, y: point.y + dy };
      const key = pointKey(next);
      if (previous.has(key)) continue;
      if (!canUseCorridorPoint(next, width, height, fromRoom, toRoom, rooms, occupiedCorridors)) continue;
      previous.set(key, point);
      queue.push(next);
    }
  }
  if (!previous.has(goalKey)) return null;

  const path = [];
  let current = to;
  while (current) {
    path.push(current);
    current = previous.get(pointKey(current));
  }
  path.reverse();
  return path.length <= maxCorridorLength ? path : null;
}

function carveCorridorPath(tiles, path) {
  for (const point of path) {
    for (const cell of corridorFootprint(point)) tiles[cell.y][cell.x] = TILE.FLOOR;
  }
}

function findDungeonCorridors(width, height, rooms, parentIndexes, targetOrder, random) {
  const occupiedCorridors = new Set();
  const corridors = Array(rooms.length - 1);
  for (const targetIndex of targetOrder) {
    const corridor = findCorridorPath(
      width,
      height,
      rooms[parentIndexes[targetIndex]],
      rooms[targetIndex],
      rooms,
      occupiedCorridors,
      random
    );
    if (!corridor) return null;
    corridors[targetIndex - 1] = corridor;
    for (const point of corridor) {
      for (const cell of corridorFootprint(point)) {
        if (!rooms.some((room) => pointInRoom(cell, room))) occupiedCorridors.add(pointKey(cell));
      }
    }
  }
  return corridors;
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

function createDoorSideWalls(doors) {
  const walls = [];
  for (const door of doors) {
    const perpendicular = { x: -door.direction.y, y: door.direction.x };
    for (const sign of [-1, 1]) {
      walls.push({
        type: DUNGEON_OBJECT.WALL,
        x: door.x + perpendicular.x * sign,
        y: door.y + perpendicular.y * sign,
        edge: door.direction.x < 0 ? 'west'
          : door.direction.x > 0 ? 'east'
            : door.direction.y < 0 ? 'north' : 'south',
        orientation: door.direction.x !== 0 ? 'axisY' : 'axisX',
        revealGroup: door.revealGroup,
        targetGroup: door.targetGroup
      });
    }
  }
  return walls;
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
      for (const cell of corridorFootprint(point)) {
        if (groups[cell.y][cell.x] < 0 || groups[cell.y][cell.x] > group) groups[cell.y][cell.x] = group;
      }
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
    width = 48,
    height = 28,
    roomCountMin = 5,
    roomCountMax = 7,
    roomMinSize = 6,
    roomMaxSize = 10,
    roomMinArea = 60,
    enemyCount = 6
  } = options;
  const random = createSeededRandom(seed);
  const tiles = createTiles(width, height);
  const rooms = [];
  const targetRoomCount = randomInt(random, roomCountMin, roomCountMax);

  while (rooms.length < targetRoomCount) {
    const room = createSpreadRoom(random, width, height, rooms, roomMinSize, roomMaxSize, roomMinArea);
    if (!room) break;
    rooms.push(room);
    carveRoom(tiles, room);
  }

  if (rooms.length < roomCountMin) return null;
  const orderedRooms = orderRoomsAsRoute(rooms, width, height)
    .map((room, revealGroup) => ({ ...room, revealGroup }));
  const wantsDeadEnd = orderedRooms.length >= 5 && random() < 0.1;
  let deadEndRoomIndex = -1;
  let parentIndexes = orderedRooms.map((room, index) => Math.max(0, index - 1));
  let targetOrder = parentIndexes.slice(1).map((parent, index) => index + 1);
  let corridors = null;
  if (wantsDeadEnd) {
    const candidates = targetOrder.slice(0, -1);
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(random, 0, index);
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    for (const candidate of candidates) {
      const candidateParents = orderedRooms.map((room, index) => Math.max(0, index - 1));
      candidateParents[candidate + 1] = candidate - 1;
      const candidateOrder = targetOrder.filter((index) => index !== candidate);
      candidateOrder.push(candidate);
      const candidateCorridors = findDungeonCorridors(
        width,
        height,
        orderedRooms,
        candidateParents,
        candidateOrder,
        random
      );
      if (!candidateCorridors) continue;
      deadEndRoomIndex = candidate;
      parentIndexes = candidateParents;
      targetOrder = candidateOrder;
      corridors = candidateCorridors;
      break;
    }
  }
  if (!corridors) {
    corridors = findDungeonCorridors(
      width,
      height,
      orderedRooms,
      parentIndexes,
      targetOrder,
      random
    );
  }
  if (!corridors) return null;
  const doors = [];
  const edges = [];
  for (let index = 1; index < orderedRooms.length; index += 1) {
    const fromIndex = parentIndexes[index];
    const corridor = corridors[index - 1];
    carveCorridorPath(tiles, corridor);
    doors.push(findDoor(corridor, orderedRooms[fromIndex], index));
    edges.push([fromIndex, index]);
  }
  const groups = assignRevealGroups(tiles, orderedRooms, corridors);
  const doorSideWalls = createDoorSideWalls(doors);
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
    doorSideWalls,
    maxRevealGroup: orderedRooms.length - 1,
    entrance,
    stairs,
    spawnPoints,
    seed,
    deadEndRoomIndex,
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
    deadEndRoomIndex: -1,
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
      if (visibility?.blocked?.has(key) && key !== goalKey) continue;
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
