export const WORLD_TERRAIN = Object.freeze({
  WATER: 'water',
  GRASS: 'grass',
  ROAD: 'road'
});

export const WORLD_OBJECT = Object.freeze({
  TREE: 'tree',
  BUSH: 'bush',
  DUNGEON: 'dungeon',
  LARGE_ROCK: 'largeRock',
  SMALL_ROCK: 'smallRock'
});

const keyOf = (x, y) => `${x},${y}`;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const TRAVEL_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 }
];

function hash01(seed, x, y, salt = 0) {
  let value = (seed ^ Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function createRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function setTerrain(world, x, y, terrain, routeKind = '') {
  const key = keyOf(x, y);
  const current = world.tiles.get(key);
  if (current?.terrain === WORLD_TERRAIN.ROAD && terrain !== WORLD_TERRAIN.ROAD) return current;
  if (current?.terrain === WORLD_TERRAIN.GRASS && terrain === WORLD_TERRAIN.WATER) return current;
  const tile = current ?? { x, y, terrain, routeKind: '', object: null };
  tile.terrain = terrain;
  if (routeKind === 'main' || (routeKind && tile.routeKind !== 'main')) tile.routeKind = routeKind;
  world.tiles.set(key, tile);
  return tile;
}

function buildConnectedPath(start, end, random) {
  const path = [{ ...start }];
  let x = start.x;
  let y = start.y;
  let preferHorizontal = random() > 0.35;

  while (x !== end.x || y !== end.y) {
    const remainingX = Math.abs(end.x - x);
    const remainingY = Math.abs(end.y - y);
    const moveHorizontal = remainingX > 0 && (remainingY === 0 || preferHorizontal);
    const remaining = moveHorizontal ? remainingX : remainingY;
    let run = Math.min(remaining, 2 + Math.floor(random() * 3));
    if (remaining - run === 1) run = remaining;
    for (let step = 0; step < run; step += 1) {
      if (moveHorizontal) x += Math.sign(end.x - x);
      else y += Math.sign(end.y - y);
      path.push({ x, y });
    }
    preferHorizontal = !moveHorizontal;
  }
  return path;
}

function routeClearance(world, path, start) {
  const oldRoads = [...world.tiles.values()].filter((tile) =>
    tile.terrain === WORLD_TERRAIN.ROAD
    && Math.abs(tile.x - start.x) + Math.abs(tile.y - start.y) > 3);
  if (oldRoads.length === 0) return Infinity;

  let clearance = Infinity;
  for (const point of path.slice(3)) {
    for (const road of oldRoads) {
      clearance = Math.min(clearance, Math.abs(point.x - road.x) + Math.abs(point.y - road.y));
      if (clearance === 0) return 0;
    }
  }
  return clearance;
}

function chooseMainSegment(world, start, random) {
  const directions = TRAVEL_DIRECTIONS.slice();
  for (let index = directions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [directions[index], directions[swapIndex]] = [directions[swapIndex], directions[index]];
  }

  let bestCandidate = null;
  for (const direction of directions) {
    const distance = 13 + Math.floor(random() * 5);
    const diagonal = direction.x !== 0 && direction.y !== 0;
    const end = {
      x: start.x + direction.x * (diagonal ? Math.ceil(distance / 2) : distance),
      y: start.y + direction.y * (diagonal ? Math.floor(distance / 2) : distance)
    };
    const path = buildConnectedPath(start, end, random);
    const clearance = routeClearance(world, path, start);
    if (!bestCandidate || clearance > bestCandidate.clearance) {
      bestCandidate = { end, path, clearance };
    }
  }
  return bestCandidate;
}

function addBranch(world, origin, direction, length) {
  const points = [];
  let { x, y } = origin;
  for (let step = 0; step < length; step += 1) {
    x += direction.x;
    y += direction.y;
    const tile = setTerrain(world, x, y, WORLD_TERRAIN.ROAD, 'branch');
    tile.object = null;
    points.push({ x, y });
  }
  if (points.length > 0) world.branchEnds.push(points.at(-1));
  return points;
}

function fillGrass(world, roadPoints, seed) {
  for (const road of roadPoints) {
    const radius = 7 + (hash01(seed, road.x, road.y, 91) > 0.72 ? 1 : 0);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance > radius + 1) continue;
        setTerrain(world, road.x + dx, road.y + dy, WORLD_TERRAIN.GRASS);
      }
    }
  }
}

function fillWaterBoundary(world) {
  for (const [key, tile] of world.tiles) {
    if (tile.terrain === WORLD_TERRAIN.WATER) world.tiles.delete(key);
  }
  const land = [...world.tiles.values()].filter((tile) => tile.terrain !== WORLD_TERRAIN.WATER);
  for (const tile of land) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const key = keyOf(tile.x + dx, tile.y + dy);
        if (!world.tiles.has(key)) setTerrain(world, tile.x + dx, tile.y + dy, WORLD_TERRAIN.WATER);
      }
    }
  }
}

function nearestRoadDistance(world, x, y) {
  for (let radius = 1; radius <= 2; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        if (world.tiles.get(keyOf(x + dx, y + dy))?.terrain === WORLD_TERRAIN.ROAD) return radius;
      }
    }
  }
  return Infinity;
}

function decorateGrass(world, tiles, seed, segmentIndex) {
  for (const tile of tiles) {
    if (tile.terrain !== WORLD_TERRAIN.GRASS || tile.object) continue;
    const roadDistance = nearestRoadDistance(world, tile.x, tile.y);
    const roll = hash01(seed, tile.x, tile.y, 200 + segmentIndex);

    if (roadDistance === 1) {
      if (roll < 0.035) tile.object = hash01(seed, tile.x, tile.y, 301) < 0.58
        ? WORLD_OBJECT.BUSH
        : WORLD_OBJECT.TREE;
      continue;
    }

    if (roll >= 0.16) continue;
    const kind = hash01(seed, tile.x, tile.y, 401);
    if (kind < 0.48) tile.object = WORLD_OBJECT.TREE;
    else if (kind < 0.63) tile.object = WORLD_OBJECT.BUSH;
    else if (kind < 0.80) tile.object = WORLD_OBJECT.LARGE_ROCK;
    else tile.object = WORLD_OBJECT.SMALL_ROCK;
  }
}

function decorateBranchEnds(world, branchEnds, seed, segmentIndex) {
  const options = [WORLD_OBJECT.TREE, WORLD_OBJECT.LARGE_ROCK, WORLD_OBJECT.SMALL_ROCK];
  for (const point of branchEnds) {
    const tile = world.tiles.get(keyOf(point.x, point.y));
    if (!tile || tile.routeKind !== 'branch' || hash01(seed, point.x, point.y, 500 + segmentIndex) > 0.7) continue;
    tile.object = options[Math.floor(hash01(seed, point.x, point.y, 601) * options.length)];
  }
}

function updateBounds(world) {
  const values = [...world.tiles.values()];
  world.bounds = values.reduce((bounds, tile) => ({
    minX: Math.min(bounds.minX, tile.x),
    maxX: Math.max(bounds.maxX, tile.x),
    minY: Math.min(bounds.minY, tile.y),
    maxY: Math.max(bounds.maxY, tile.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

export function createWorldMap(seed = Date.now()) {
  return {
    seed: seed >>> 0,
    tiles: new Map(),
    mainPath: [{ x: 0, y: 0 }],
    branchEnds: [],
    destinations: [],
    partyPosition: { x: 0, y: 0 },
    pathIndex: 0,
    targetPathIndex: 0,
    arrived: false,
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  };
}

export function extendWorldMap(world, dungeonRun, dungeon) {
  if (world.destinations.some((destination) => destination.dungeonRun === dungeonRun)) return world;

  const segmentIndex = world.destinations.length;
  const random = createRandom(world.seed + segmentIndex * 7919 + 37);
  const start = { ...world.mainPath.at(-1) };
  const { end, path: mainSegment } = chooseMainSegment(world, start, random);
  const newRoadPoints = [];
  const existingLandKeys = new Set([...world.tiles.values()]
    .filter((tile) => tile.terrain !== WORLD_TERRAIN.WATER)
    .map((tile) => keyOf(tile.x, tile.y)));
  const firstNewBranch = world.branchEnds.length;

  for (const point of mainSegment) {
    const tile = setTerrain(world, point.x, point.y, WORLD_TERRAIN.ROAD, 'main');
    tile.object = null;
    newRoadPoints.push(point);
  }
  world.mainPath.push(...mainSegment.slice(1));

  const branchCount = 1 + Math.floor(random() * 2);
  for (let branch = 0; branch < branchCount; branch += 1) {
    const usableLength = Math.max(1, mainSegment.length - 7);
    const originIndex = 3 + Math.floor(random() * usableLength);
    const origin = mainSegment[Math.min(originIndex, mainSegment.length - 4)];
    const previous = mainSegment[Math.max(0, originIndex - 1)];
    const next = mainSegment[Math.min(mainSegment.length - 1, originIndex + 1)];
    const horizontal = Math.abs(next.x - previous.x) >= Math.abs(next.y - previous.y);
    const sign = random() < 0.5 ? -1 : 1;
    const direction = horizontal ? { x: 0, y: sign } : { x: sign, y: 0 };
    newRoadPoints.push(...addBranch(world, origin, direction, 3 + Math.floor(random() * 3)));
  }

  fillGrass(world, newRoadPoints, world.seed + segmentIndex * 101);

  const segmentTiles = [...world.tiles.values()].filter((tile) =>
    tile.x >= Math.min(start.x, end.x) - 9 && tile.x <= Math.max(start.x, end.x) + 9
    && tile.y >= Math.min(start.y, end.y) - 9
    && tile.y <= Math.max(start.y, end.y) + 9
    && !existingLandKeys.has(keyOf(tile.x, tile.y)));
  decorateGrass(world, segmentTiles, world.seed, segmentIndex);
  decorateBranchEnds(world, world.branchEnds.slice(firstNewBranch), world.seed, segmentIndex);

  const startTile = setTerrain(world, start.x, start.y, WORLD_TERRAIN.ROAD, 'main');
  startTile.object = WORLD_OBJECT.DUNGEON;
  startTile.dungeonRun = Math.max(-1, dungeonRun - 1);
  const endTile = setTerrain(world, end.x, end.y, WORLD_TERRAIN.ROAD, 'main');
  endTile.object = WORLD_OBJECT.DUNGEON;
  endTile.dungeonRun = dungeonRun;
  endTile.dungeonId = dungeon.dungeonId;
  endTile.themeColor = dungeon.themeColor;
  endTile.label = dungeon.name;

  fillWaterBoundary(world);
  updateBounds(world);

  const destination = {
    dungeonRun,
    dungeonId: dungeon.dungeonId,
    name: dungeon.name,
    themeColor: dungeon.themeColor,
    x: end.x,
    y: end.y,
    pathIndex: world.mainPath.length - 1
  };
  world.destinations.push(destination);
  world.targetPathIndex = Math.max(world.pathIndex, destination.pathIndex - 1);
  world.arrived = world.pathIndex >= world.targetPathIndex;
  return world;
}

export function updateWorldTravel(world, distanceToMove) {
  let remaining = Math.max(0, distanceToMove);
  while (remaining > 0 && world.pathIndex < world.targetPathIndex) {
    const target = world.mainPath[world.pathIndex + 1];
    const dx = target.x - world.partyPosition.x;
    const dy = target.y - world.partyPosition.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= remaining || distance < 0.0001) {
      world.partyPosition.x = target.x;
      world.partyPosition.y = target.y;
      world.pathIndex += 1;
      remaining -= distance;
    } else {
      world.partyPosition.x += (dx / distance) * remaining;
      world.partyPosition.y += (dy / distance) * remaining;
      remaining = 0;
    }
  }
  world.arrived = world.pathIndex >= world.targetPathIndex;
  return world.arrived;
}

export function getWorldTravelProgress(world) {
  if (world.targetPathIndex <= 0) return 1;
  const previousDestination = world.destinations.at(-2);
  const startIndex = previousDestination ? Math.max(0, previousDestination.pathIndex - 1) : 0;
  const segmentLength = Math.max(1, world.targetPathIndex - startIndex);
  return clamp01((world.pathIndex - startIndex) / segmentLength);
}

export function getWorldTile(world, x, y) {
  return world.tiles.get(keyOf(x, y)) ?? null;
}
