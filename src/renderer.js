import { DUNGEON_OBJECT, TILE } from './dungeon.js?v=20260716a';
import { getWorldTile, WORLD_OBJECT, WORLD_TERRAIN } from './world-map.js';

const INK = '#392f35';
const CREAM = '#fff8e9';
const WORLD_TILE_WIDTH = 64;
const WORLD_TILE_HEIGHT = 32;
const WORLD_TILE_DEPTH = 6;
const DUNGEON_TILE_WIDTH = 54;
const DUNGEON_TILE_HEIGHT = 27;
const DUNGEON_TILE_DEPTH = 9;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class GameRenderer {
  constructor(canvas, data) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.context.imageSmoothingEnabled = false;
    this.data = data;
  }

  render(snapshot, timeMs) {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (snapshot.scene === 'world') this.renderWorld(snapshot, timeMs);
    else this.renderDungeon(snapshot, timeMs);
  }

  renderWorld(snapshot, timeMs) {
    const ctx = this.context;
    const world = snapshot.worldMap;
    const camera = world.partyPosition;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2 + 24;

    ctx.fillStyle = '#8caed0';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const visibleTiles = [];
    const cameraX = Math.floor(camera.x);
    const cameraY = Math.floor(camera.y);
    for (let y = cameraY - 18; y <= cameraY + 18; y += 1) {
      for (let x = cameraX - 18; x <= cameraX + 18; x += 1) {
        const screen = this.projectWorldPoint(x, y, camera, centerX, centerY);
        if (screen.x < -WORLD_TILE_WIDTH || screen.x > this.canvas.width + WORLD_TILE_WIDTH
          || screen.y < -WORLD_TILE_HEIGHT * 2 || screen.y > this.canvas.height + WORLD_TILE_HEIGHT * 2) continue;
        visibleTiles.push({
          x,
          y,
          screen,
          tile: getWorldTile(world, x, y) ?? { x, y, terrain: WORLD_TERRAIN.WATER, object: null }
        });
      }
    }
    visibleTiles.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);

    for (const entry of visibleTiles) this.drawWorldTile(entry, world, timeMs);
    for (const entry of visibleTiles) {
      if (entry.tile.object) this.drawWorldObject(entry, snapshot.dungeonRun, timeMs);
    }

    snapshot.party.forEach((member) => {
      const screen = this.projectWorldPoint(member.x, member.y, camera, centerX, centerY);
      this.drawCharacter(member, screen.x, screen.y, .78, timeMs);
    });

    const nextDungeon = this.data.dungeons[snapshot.dungeonRun % this.data.dungeons.length];
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgb(255 248 233 / 92%)';
    this.roundRect(24, 24, 390, 104, 16, true, true);
    ctx.fillStyle = INK;
    ctx.font = 'bold 23px Trebuchet MS';
    ctx.fillText(snapshot.worldMap.arrived ? '地下城入口已抵達' : '沿著道路前進中', 45, 59);
    ctx.font = 'bold 18px Trebuchet MS';
    ctx.fillText(`${nextDungeon.name}　難度 ${snapshot.dungeonRun + 1}`, 45, 89);
    ctx.font = '14px Trebuchet MS';
    ctx.fillText(`地圖延展 ${world.destinations.length} 區｜路程 ${Math.round(snapshot.worldTravelProgress * 100)}%`, 45, 114);
  }

  projectWorldPoint(worldX, worldY, camera, centerX, centerY) {
    const dx = worldX - camera.x;
    const dy = worldY - camera.y;
    return {
      x: centerX + (dx - dy) * WORLD_TILE_WIDTH / 2,
      y: centerY + (dx + dy) * WORLD_TILE_HEIGHT / 2
    };
  }

  drawWorldTile(entry, world, timeMs) {
    const ctx = this.context;
    const { x, y, tile, screen } = entry;
    const halfWidth = WORLD_TILE_WIDTH / 2;
    const halfHeight = WORLD_TILE_HEIGHT / 2;
    const isWater = tile.terrain === WORLD_TERRAIN.WATER;
    const parity = Math.abs(x * 7 + y * 11) % 3;
    const colors = tile.terrain === WORLD_TERRAIN.GRASS
      ? ['#91d957', '#98df5e', '#88cf51']
      : tile.terrain === WORLD_TERRAIN.ROAD
        ? ['#d4aa63', '#ddb66f', '#cda05a']
        : ['#8caed0', '#91b4d5', '#87a9cb'];

    if (!isWater) {
      ctx.fillStyle = tile.terrain === WORLD_TERRAIN.ROAD ? '#a87942' : '#5f9c43';
      ctx.beginPath();
      ctx.moveTo(screen.x - halfWidth, screen.y);
      ctx.lineTo(screen.x, screen.y + halfHeight);
      ctx.lineTo(screen.x, screen.y + halfHeight + WORLD_TILE_DEPTH);
      ctx.lineTo(screen.x - halfWidth, screen.y + WORLD_TILE_DEPTH);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = tile.terrain === WORLD_TERRAIN.ROAD ? '#b8894d' : '#72ac4c';
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y + halfHeight);
      ctx.lineTo(screen.x + halfWidth, screen.y);
      ctx.lineTo(screen.x + halfWidth, screen.y + WORLD_TILE_DEPTH);
      ctx.lineTo(screen.x, screen.y + halfHeight + WORLD_TILE_DEPTH);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = colors[parity];
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y - halfHeight);
    ctx.lineTo(screen.x + halfWidth, screen.y);
    ctx.lineTo(screen.x, screen.y + halfHeight);
    ctx.lineTo(screen.x - halfWidth, screen.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = isWater ? 'rgb(65 104 145 / 5%)' : 'rgb(57 47 53 / 12%)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isWater) {
      if ((Math.abs(x * 13 + y * 5) % 7) === 0) {
        ctx.strokeStyle = 'rgb(232 246 255 / 48%)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(screen.x - 9, screen.y + Math.sin(timeMs / 700 + x) * 1.5);
        ctx.lineTo(screen.x + 8, screen.y + Math.sin(timeMs / 700 + y) * 1.5);
        ctx.stroke();
      }
      return;
    }

    const edgeColor = tile.terrain === WORLD_TERRAIN.GRASS ? '#e5f4a8' : '#f2d58d';
    const neighbors = [
      [x - 1, y, [-halfWidth, 0, 0, -halfHeight]],
      [x, y - 1, [0, -halfHeight, halfWidth, 0]],
      [x + 1, y, [halfWidth, 0, 0, halfHeight]],
      [x, y + 1, [0, halfHeight, -halfWidth, 0]]
    ];
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 2;
    for (const [neighborX, neighborY, edge] of neighbors) {
      if (getWorldTile(world, neighborX, neighborY)?.terrain !== WORLD_TERRAIN.WATER
        && getWorldTile(world, neighborX, neighborY) !== null) continue;
      ctx.beginPath();
      ctx.moveTo(screen.x + edge[0], screen.y + edge[1]);
      ctx.lineTo(screen.x + edge[2], screen.y + edge[3]);
      ctx.stroke();
    }
  }

  drawWorldObject(entry, activeDungeonRun, timeMs) {
    const { tile, screen } = entry;
    const ctx = this.context;
    const baseY = screen.y + 7;
    ctx.save();
    ctx.translate(Math.round(screen.x), Math.round(baseY));
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (tile.object === WORLD_OBJECT.TREE) this.drawWorldTree();
    else if (tile.object === WORLD_OBJECT.BUSH) this.drawWorldBush();
    else if (tile.object === WORLD_OBJECT.LARGE_ROCK) this.drawWorldRock(1);
    else if (tile.object === WORLD_OBJECT.SMALL_ROCK) this.drawWorldRock(.62);
    else if (tile.object === WORLD_OBJECT.DUNGEON) {
      this.drawWorldDungeonEntrance(tile, tile.dungeonRun === activeDungeonRun, timeMs);
    }
    ctx.restore();
  }

  drawWorldTree() {
    const ctx = this.context;
    ctx.lineWidth = 2.2;
    ctx.fillStyle = '#8b6542';
    ctx.fillRect(-4, -27, 8, 29);
    ctx.strokeRect(-4, -27, 8, 29);
    const layers = [
      { y: -49, width: 18, color: '#4b9f4f' },
      { y: -37, width: 23, color: '#58ad56' },
      { y: -24, width: 27, color: '#65ba5d' }
    ];
    for (const layer of layers) {
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(0, layer.y - 15);
      ctx.lineTo(layer.width, layer.y + 13);
      ctx.lineTo(-layer.width, layer.y + 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawWorldBush() {
    const ctx = this.context;
    ctx.fillStyle = '#4f9f4b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(-10, -7, 12, 10, -.2, 0, Math.PI * 2);
    ctx.ellipse(3, -11, 14, 13, 0, 0, Math.PI * 2);
    ctx.ellipse(14, -6, 10, 9, .2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawWorldRock(scale) {
    const ctx = this.context;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#918b91';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-13, -18);
    ctx.lineTo(2, -28);
    ctx.lineTo(18, -16);
    ctx.lineTo(22, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#6e686f';
    ctx.beginPath();
    ctx.moveTo(2, -28);
    ctx.lineTo(3, -7);
    ctx.lineTo(18, -16);
    ctx.stroke();
  }

  drawWorldDungeonEntrance(tile, active, timeMs) {
    const ctx = this.context;
    const pulse = active ? 1 + Math.sin(timeMs / 240) * .06 : 1;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = tile.themeColor ?? '#c98975';
    ctx.lineWidth = active ? 3.5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(-24, 1);
    ctx.lineTo(-20, -28);
    ctx.lineTo(0, -45);
    ctx.lineTo(22, -27);
    ctx.lineTo(25, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#312b34';
    ctx.beginPath();
    ctx.arc(0, -8, 10, Math.PI, Math.PI * 2);
    ctx.lineTo(10, 1);
    ctx.lineTo(-10, 1);
    ctx.closePath();
    ctx.fill();
    if (active) {
      ctx.fillStyle = '#ffe88a';
      ctx.beginPath();
      ctx.arc(19, -40, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  renderDungeon(snapshot, timeMs) {
    const { floor } = snapshot;
    const ctx = this.context;
    const theme = snapshot.dungeon?.themeColor ?? '#6d8f72';
    const camera = snapshot.partyPosition;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2 + 38;

    const background = ctx.createRadialGradient(centerX, centerY, 80, centerX, centerY, 620);
    background.addColorStop(0, '#27242c');
    background.addColorStop(1, '#100f14');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const visibleTiles = [];
    for (let y = 0; y < floor.height; y += 1) {
      for (let x = 0; x < floor.width; x += 1) {
        if (!this.isDungeonTileVisible(floor, x, y, snapshot.revealedGroup)) continue;
        const screen = this.projectDungeonPoint(x, y, camera, centerX, centerY);
        if (screen.x < -DUNGEON_TILE_WIDTH || screen.x > this.canvas.width + DUNGEON_TILE_WIDTH
          || screen.y < -90 || screen.y > this.canvas.height + 70) continue;
        visibleTiles.push({ x, y, screen, tile: floor.tiles[y][x] });
      }
    }
    visibleTiles.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
    for (const entry of visibleTiles) this.drawDungeonGround(entry, floor, snapshot.revealedGroup, theme);

    const visibleObjects = [
      ...floor.objects.filter((object) => object.revealGroup <= snapshot.revealedGroup),
      ...this.createRevealBoundaryWalls(floor, snapshot.revealedGroup)
    ]
      .map((object) => ({
        ...object,
        screen: this.projectDungeonPoint(object.x, object.y, camera, centerX, centerY)
      }))
      .sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
    const foregroundObjects = visibleObjects.filter((object) => this.isForegroundDungeonObject(object));
    for (const object of visibleObjects) {
      if (!this.isForegroundDungeonObject(object)) this.drawDungeonObject(object, snapshot, theme, timeMs);
    }

    const actors = [
      ...snapshot.chests.map((chest) => ({ kind: 'chest', actor: chest })),
      ...snapshot.enemies.map((enemy) => ({ kind: 'enemy', actor: enemy })),
      ...snapshot.party.map((member) => ({ kind: 'party', actor: member }))
    ].sort((a, b) => (a.actor.x + a.actor.y) - (b.actor.x + b.actor.y) || a.actor.x - b.actor.x);
    for (const entry of actors) {
      if (entry.kind === 'enemy') this.drawDungeonEnemy(entry.actor, camera, centerX, centerY, timeMs);
      else {
        const screen = this.projectDungeonPoint(entry.actor.x, entry.actor.y, camera, centerX, centerY);
        if (entry.kind === 'party') this.drawCharacter(entry.actor, screen.x, screen.y, .72, timeMs);
        else this.drawChest(screen.x, screen.y, timeMs);
      }
    }
    for (const projectile of snapshot.projectiles) this.drawProjectile(projectile, camera, centerX, centerY, timeMs);
    for (const effect of snapshot.spellEffects) this.drawSpellEffect(effect, snapshot, camera, centerX, centerY, timeMs);
    for (const object of foregroundObjects) this.drawDungeonObject(object, snapshot, theme, timeMs);

    this.drawDungeonHud(snapshot);
    const boss = snapshot.enemies.find((enemy) => enemy.isBoss);
    if (boss) this.drawBossBar(boss);
  }

  projectDungeonPoint(x, y, camera, centerX, centerY) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    return {
      x: centerX + (dx - dy) * DUNGEON_TILE_WIDTH / 2,
      y: centerY + (dx + dy) * DUNGEON_TILE_HEIGHT / 2
    };
  }

  isDungeonTileVisible(floor, x, y, revealedGroup) {
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
    return floor.tiles[y][x] !== TILE.WALL
      && floor.groups[y][x] >= 0
      && floor.groups[y][x] <= revealedGroup;
  }

  createRevealBoundaryWalls(floor, revealedGroup) {
    const edges = [
      { dx: -1, dy: 0, edge: 'west', orientation: 'axisY' },
      { dx: 1, dy: 0, edge: 'east', orientation: 'axisY' },
      { dx: 0, dy: -1, edge: 'north', orientation: 'axisX' },
      { dx: 0, dy: 1, edge: 'south', orientation: 'axisX' }
    ];
    const doorEdges = new Set();
    for (const door of floor.objects) {
      if (door.type !== DUNGEON_OBJECT.DOOR
        || door.revealGroup > revealedGroup) continue;
      const edge = this.directionToEdge(door.direction);
      const perpendicular = { x: -door.direction.y, y: door.direction.x };
      for (const offset of [-1, 0, 1]) {
        doorEdges.add(`${door.x + perpendicular.x * offset},${door.y + perpendicular.y * offset},${edge}`);
      }
    }

    const walls = [];
    for (let y = 0; y < floor.height; y += 1) {
      for (let x = 0; x < floor.width; x += 1) {
        if (!this.isDungeonTileVisible(floor, x, y, revealedGroup)) continue;
        const currentGroup = floor.groups[y][x];
        for (const boundary of edges) {
          const neighborX = x + boundary.dx;
          const neighborY = y + boundary.dy;
          if (neighborX < 0 || neighborY < 0 || neighborX >= floor.width || neighborY >= floor.height) continue;
          const neighborGroup = floor.groups[neighborY][neighborX];
          if (floor.tiles[neighborY][neighborX] === TILE.WALL
            || neighborGroup < 0
            || neighborGroup <= currentGroup) continue;
          if (doorEdges.has(`${x},${y},${boundary.edge}`)) continue;
          walls.push({
            type: DUNGEON_OBJECT.WALL,
            x,
            y,
            edge: boundary.edge,
            orientation: boundary.orientation,
            revealGroup: floor.groups[y][x],
            groupBoundary: true
          });
        }
      }
    }
    return walls;
  }

  shadeColor(hex, amount) {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '6d8f72';
    const value = Number.parseInt(normalized, 16);
    const channel = (shift) => clamp(((value >> shift) & 255) + amount, 0, 255);
    return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
  }

  drawDungeonGround(entry, floor, revealedGroup, theme) {
    const ctx = this.context;
    const { x, y, screen } = entry;
    const halfWidth = DUNGEON_TILE_WIDTH / 2;
    const halfHeight = DUNGEON_TILE_HEIGHT / 2;
    const eastOpen = !this.isDungeonTileVisible(floor, x + 1, y, revealedGroup);
    const southOpen = !this.isDungeonTileVisible(floor, x, y + 1, revealedGroup);

    if (southOpen) {
      ctx.fillStyle = this.shadeColor(theme, -48);
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y + halfHeight);
      ctx.lineTo(screen.x - halfWidth, screen.y);
      ctx.lineTo(screen.x - halfWidth, screen.y + DUNGEON_TILE_DEPTH);
      ctx.lineTo(screen.x, screen.y + halfHeight + DUNGEON_TILE_DEPTH);
      ctx.closePath();
      ctx.fill();
    }
    if (eastOpen) {
      ctx.fillStyle = this.shadeColor(theme, -35);
      ctx.beginPath();
      ctx.moveTo(screen.x + halfWidth, screen.y);
      ctx.lineTo(screen.x, screen.y + halfHeight);
      ctx.lineTo(screen.x, screen.y + halfHeight + DUNGEON_TILE_DEPTH);
      ctx.lineTo(screen.x + halfWidth, screen.y + DUNGEON_TILE_DEPTH);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = this.shadeColor(theme, ((x + y) % 2 === 0 ? 16 : 9));
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y - halfHeight);
    ctx.lineTo(screen.x + halfWidth, screen.y);
    ctx.lineTo(screen.x, screen.y + halfHeight);
    ctx.lineTo(screen.x - halfWidth, screen.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgb(28 24 31 / 24%)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  dungeonEdgePoints(edge) {
    const halfWidth = DUNGEON_TILE_WIDTH / 2;
    const halfHeight = DUNGEON_TILE_HEIGHT / 2;
    if (edge === 'west') return [[-halfWidth, 0], [0, -halfHeight]];
    if (edge === 'east') return [[halfWidth, 0], [0, halfHeight]];
    if (edge === 'north') return [[0, -halfHeight], [halfWidth, 0]];
    return [[0, halfHeight], [-halfWidth, 0]];
  }

  directionToEdge(direction) {
    if (direction.x < 0) return 'west';
    if (direction.x > 0) return 'east';
    if (direction.y < 0) return 'north';
    return 'south';
  }

  isForegroundDungeonObject(object) {
    if (object.type === DUNGEON_OBJECT.WALL) return object.edge === 'south' || object.edge === 'east';
    if (object.type === DUNGEON_OBJECT.DOOR) {
      const edge = this.directionToEdge(object.direction);
      return edge === 'south' || edge === 'east';
    }
    return false;
  }

  drawDungeonObject(object, snapshot, theme, timeMs) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(Math.round(object.screen.x), Math.round(object.screen.y));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (object.type === DUNGEON_OBJECT.WALL) this.drawDungeonWall(object, theme);
    else if (object.type === DUNGEON_OBJECT.DOOR) {
      this.drawDungeonDoor(object, snapshot.revealedGroup >= object.targetGroup, theme);
    } else if (object.type === DUNGEON_OBJECT.ENTRANCE_STAIRS) this.drawEntranceStairs();
    else if (object.type === DUNGEON_OBJECT.STAIRS_DOWN) this.drawStairsDown(snapshot.floorCleared, timeMs);
    else if (object.type === DUNGEON_OBJECT.EXIT_PORTAL) this.drawExitPortal(snapshot.floorCleared, timeMs);
    ctx.restore();
  }

  drawDungeonWall(object, theme) {
    const ctx = this.context;
    const [start, end] = this.dungeonEdgePoints(object.edge);
    const frontEdge = object.edge === 'south' || object.edge === 'east';
    const height = frontEdge ? 19 : 34;
    ctx.fillStyle = this.shadeColor(theme, object.orientation === 'axisX' ? -54 : -42);
    ctx.strokeStyle = '#2f2931';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.lineTo(end[0], end[1] - height);
    ctx.lineTo(start[0], start[1] - height);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgb(255 248 233 / 20%)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1] - height * .54);
    ctx.lineTo(end[0], end[1] - height * .54);
    ctx.stroke();
  }

  drawDungeonDoor(object, open, theme) {
    const ctx = this.context;
    const edge = this.directionToEdge(object.direction);
    const perpendicular = { x: -object.direction.y, y: object.direction.x };
    const sideOffset = {
      x: (perpendicular.x - perpendicular.y) * DUNGEON_TILE_WIDTH / 2,
      y: (perpendicular.x + perpendicular.y) * DUNGEON_TILE_HEIGHT / 2
    };
    for (const sign of [-1, 1]) {
      ctx.save();
      ctx.translate(sideOffset.x * sign, sideOffset.y * sign);
      this.drawDungeonWall({ edge, orientation: object.direction.x !== 0 ? 'axisY' : 'axisX' }, theme);
      ctx.restore();
    }
    const [start, end] = this.dungeonEdgePoints(edge);
    const height = 31;
    const widthX = end[0] - start[0];
    const widthY = end[1] - start[1];
    ctx.strokeStyle = '#302a32';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(start[0], start[1] - height);
    ctx.lineTo(end[0], end[1] - height);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    ctx.strokeStyle = this.shadeColor(theme, -18);
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!open) {
      ctx.fillStyle = '#4d4249';
      ctx.beginPath();
      ctx.moveTo(start[0] + widthX * .16, start[1] + widthY * .16);
      ctx.lineTo(start[0] + widthX * .16, start[1] + widthY * .16 - height + 4);
      ctx.lineTo(end[0] - widthX * .16, end[1] - widthY * .16 - height + 4);
      ctx.lineTo(end[0] - widthX * .16, end[1] - widthY * .16);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawEntranceStairs() {
    const ctx = this.context;
    ctx.strokeStyle = '#302a32';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#596777';
    ctx.beginPath();
    ctx.moveTo(-20, 8);
    ctx.lineTo(20, 8);
    ctx.lineTo(13, -15);
    ctx.lineTo(-13, -15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let step = 0; step < 4; step += 1) {
      const inset = step * 2.4;
      const y = 7 - step * 6;
      ctx.fillStyle = step === 3 ? '#d5e0e8' : '#9eabb8';
      ctx.beginPath();
      ctx.moveTo(-18 + inset, y);
      ctx.lineTo(18 - inset, y);
      ctx.lineTo(15 - inset, y - 5);
      ctx.lineTo(-15 + inset, y - 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawStairsDown(active, timeMs) {
    const ctx = this.context;
    const pulse = active ? .72 + Math.sin(timeMs / 180) * .18 : .36;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#211e25';
    ctx.strokeStyle = active ? '#f5dc82' : '#766b75';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-22, -10);
    ctx.lineTo(22, -10);
    ctx.lineTo(16, 11);
    ctx.lineTo(-16, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let step = 0; step < 4; step += 1) {
      const inset = step * 2.6;
      const y = -7 + step * 5;
      ctx.beginPath();
      ctx.moveTo(-18 + inset, y);
      ctx.lineTo(18 - inset, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawExitPortal(active, timeMs) {
    const ctx = this.context;
    const pulse = active ? 1 + Math.sin(timeMs / 190) * .1 : .75;
    ctx.scale(pulse, pulse * .56);
    ctx.globalAlpha = active ? .9 : .28;
    for (let ring = 0; ring < 4; ring += 1) {
      ctx.strokeStyle = ring === 1 ? '#f7e68b' : '#9dddf0';
      ctx.lineWidth = Math.max(1, 5 - ring);
      ctx.beginPath();
      ctx.arc(0, 0, 36 - ring * 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawChest(x, y, timeMs) {
    const ctx = this.context;
    const bounce = Math.sin(timeMs / 180) * 2;
    ctx.save();
    ctx.translate(x, y - 8 + bounce);
    ctx.fillStyle = '#b96f3e';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(-14, -13, 28, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e7ad4f';
    ctx.fillRect(-14, -5, 28, 6);
    ctx.strokeRect(-14, -5, 28, 6);
    ctx.fillStyle = '#fff0a4';
    ctx.fillRect(-3, -4, 6, 10);
    ctx.strokeRect(-3, -4, 6, 10);
    ctx.restore();
  }

  drawProjectile(projectile, camera, centerX, centerY, timeMs) {
    const ctx = this.context;
    const screen = this.projectDungeonPoint(projectile.x, projectile.y, camera, centerX, centerY);
    ctx.save();
    ctx.translate(screen.x, screen.y - 12);
    if (projectile.attackType === 'magic') {
      const pulse = 5 + Math.sin(timeMs / 70) * 1.5;
      ctx.globalAlpha = .3;
      ctx.fillStyle = '#bcecff';
      ctx.beginPath();
      ctx.arc(0, 0, pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f5fbff';
      ctx.strokeStyle = '#6b70ad';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.rotate(-.35);
      ctx.strokeStyle = '#fff0a4';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(-4, 0);
      ctx.stroke();
      ctx.fillStyle = projectile.color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(2, 0, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSpellEffect(effect, snapshot, camera, centerX, centerY, timeMs) {
    const ctx = this.context;
    const caster = snapshot.party.find((member) => member.characterId === effect.casterCharacterId);
    if (!caster) return;
    const progress = clamp(effect.elapsedMs / effect.durationMs, 0, 1);
    const casterScreen = this.projectDungeonPoint(caster.x, caster.y, camera, centerX, centerY);
    ctx.save();
    ctx.lineCap = 'round';
    if (effect.type === 'partyHeal' || effect.type === 'healPulse') {
      const targets = effect.type === 'partyHeal'
        ? snapshot.party
        : snapshot.party.filter((member) => effect.targetCharacterIds?.includes(member.characterId));
      for (const target of targets) {
        const screen = this.projectDungeonPoint(target.x, target.y, camera, centerX, centerY);
        ctx.globalAlpha = 1 - progress * .7;
        ctx.strokeStyle = '#fff1a6';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y - 12, 8 + progress * 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff8cf';
        ctx.fillRect(screen.x - 2, screen.y - 31 - progress * 8, 4, 14);
        ctx.fillRect(screen.x - 7, screen.y - 26 - progress * 8, 14, 4);
      }
    } else {
      const targets = effect.targetRuntimeIds
        .map((runtimeId) => snapshot.enemies.find((enemy) => enemy.runtimeId === runtimeId))
        .filter(Boolean);
      if (effect.type === 'chainDamage') {
        const points = [caster, ...targets].map((actor) => this.projectDungeonPoint(actor.x, actor.y, camera, centerX, centerY));
        ctx.strokeStyle = '#bff3ff';
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 5]);
        ctx.lineDashOffset = -timeMs / 25;
        ctx.beginPath();
        points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y - 15) : ctx.lineTo(point.x, point.y - 15));
        ctx.stroke();
      } else if (targets[0]) {
        const targetScreen = this.projectDungeonPoint(targets[0].x, targets[0].y, camera, centerX, centerY);
        const travel = clamp(progress / .72, 0, 1);
        const x = casterScreen.x + (targetScreen.x - casterScreen.x) * travel;
        const y = casterScreen.y - 18 + (targetScreen.y - casterScreen.y) * travel;
        ctx.fillStyle = progress < .72 ? '#ffb05f' : '#ffe49b';
        ctx.strokeStyle = '#8f483c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, progress < .72 ? 8 : 12 + (progress - .72) * 45, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawCharacter(member, x, y, scale, timeMs) {
    const ctx = this.context;
    const attackFrame = member.attackingMs > 0 && Math.floor(timeMs / 100) % 2 === 1;
    const lean = attackFrame ? (member.combatStyle === 'melee' ? 6 : 2) * scale : 0;
    const bob = Math.sin(timeMs / 210 + member.characterId.length) * 1.2 * scale;
    const size = 20 * scale;
    ctx.save();
    ctx.translate(Math.round(x + lean), Math.round(y + bob));
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    ctx.strokeStyle = INK;
    ctx.fillStyle = 'rgb(38 31 36 / 25%)';
    ctx.beginPath();
    ctx.ellipse(0, size * .88, size * .62, size * .22, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = member.color;
    if (member.spriteId === 'sprite_dinu' || member.spriteId === 'sprite_bob') {
      ctx.beginPath();
      ctx.arc(-size * .33, -size * .5, size * .24, 0, Math.PI * 2);
      ctx.arc(size * .33, -size * .5, size * .24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (member.spriteId === 'sprite_lynn') {
      ctx.beginPath();
      ctx.moveTo(-size * .48, -size * .32);
      ctx.lineTo(-size * .3, -size * .98);
      ctx.lineTo(-size * .02, -size * .48);
      ctx.lineTo(size * .3, -size * .98);
      ctx.lineTo(size * .48, -size * .32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, -size * .18, size * .58, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, size * .5, size * .5, size * .52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-size * .18, -size * .28, Math.max(1, size * .055), 0, Math.PI * 2);
    ctx.arc(size * .18, -size * .28, Math.max(1, size * .055), 0, Math.PI * 2);
    ctx.fill();

    if (member.spriteId === 'sprite_hoya') {
      ctx.fillStyle = '#ef9a4d';
      ctx.beginPath();
      ctx.moveTo(-size * .12, -size * .1);
      ctx.lineTo(size * .3, 0);
      ctx.lineTo(-size * .12, size * .08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#fff3a6';
      ctx.lineWidth = Math.max(1.5, 3 * scale);
      ctx.beginPath();
      ctx.moveTo(-size * .45, size * .34);
      ctx.quadraticCurveTo(-size * .82, size * .5, -size * .52, size * .72);
      ctx.stroke();
    } else if (member.spriteId === 'sprite_dinu') {
      ctx.fillStyle = '#fff0bf';
      ctx.beginPath();
      ctx.ellipse(size * .08, -size * .02, size * .25, size * .17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(size * .2, -size * .06, size * .055, 0, Math.PI * 2);
      ctx.fill();
    } else if (member.spriteId === 'sprite_lynn') {
      ctx.strokeStyle = '#575064';
      ctx.lineWidth = Math.max(1.5, 3 * scale);
      ctx.beginPath();
      ctx.moveTo(-size * .36, size * .23);
      ctx.quadraticCurveTo(0, size * .42, size * .43, size * .22);
      ctx.stroke();
    } else if (member.spriteId === 'sprite_bob') {
      ctx.fillStyle = '#e49a55';
      ctx.strokeStyle = INK;
      ctx.fillRect(-size * .48, size * .42, size * .96, size * .2);
      ctx.strokeRect(-size * .48, size * .42, size * .96, size * .2);
    }

    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.beginPath();
    const armReach = attackFrame ? size * (member.combatStyle === 'melee' ? 1.08 : .76) : size * .55;
    ctx.moveTo(size * .28, size * .28);
    ctx.lineTo(armReach, attackFrame ? size * .05 : size * .42);
    ctx.stroke();
    if (attackFrame) {
      if (member.combatStyle === 'melee') {
        ctx.fillStyle = member.spriteId === 'sprite_bob' ? '#9c795d' : '#fff7c8';
        ctx.beginPath();
        ctx.roundRect(size * .92, -size * .12, size * .35, size * .25, size * .06);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.globalAlpha = .75;
        ctx.fillStyle = member.attackType === 'magic' ? '#bdefff' : '#fff1a2';
        ctx.beginPath();
        ctx.arc(size * .82, size * .02, size * .18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawDungeonEnemy(enemy, camera, centerX, centerY, timeMs) {
    const ctx = this.context;
    const attackFrame = enemy.attackingMs > 0 && Math.floor(timeMs / 90) % 2 === 1;
    const screen = this.projectDungeonPoint(enemy.x, enemy.y, camera, centerX, centerY);
    const x = screen.x + (attackFrame ? -3 : 0);
    const y = screen.y;
    const radius = enemy.isBoss ? 28 : 14;

    ctx.save();
    ctx.translate(x, y);
    if (attackFrame) ctx.rotate(-.12);
    ctx.fillStyle = enemy.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = enemy.isBoss ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(-radius, radius * .52);
    ctx.quadraticCurveTo(-radius * 1.1, -radius * .65, -radius * .35, -radius * .85);
    ctx.quadraticCurveTo(0, -radius * 1.25, radius * .35, -radius * .85);
    ctx.quadraticCurveTo(radius * 1.1, -radius * .65, radius, radius * .52);
    ctx.quadraticCurveTo(radius * .45, radius * .82, 0, radius * .56);
    ctx.quadraticCurveTo(-radius * .45, radius * .82, -radius, radius * .52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(-radius * .42, -radius * .28, Math.max(2, radius * .13), Math.max(2, radius * .13));
    ctx.fillRect(radius * .28, -radius * .28, Math.max(2, radius * .13), Math.max(2, radius * .13));
    ctx.restore();

    if (!enemy.isBoss) this.drawHealthBar(x - 17, y - 25, 34, 5, enemy.hp / enemy.maxHp);
  }

  drawHealthBar(x, y, width, height, ratio) {
    const ctx = this.context;
    ctx.fillStyle = INK;
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    ctx.fillStyle = '#e4d9d1';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#dd7180';
    ctx.fillRect(x, y, width * clamp(ratio, 0, 1), height);
  }

  drawBossBar(boss) {
    const ctx = this.context;
    const width = 430;
    const x = (this.canvas.width - width) / 2;
    ctx.fillStyle = 'rgb(34 30 37 / 82%)';
    this.roundRect(x - 18, 12, width + 36, 52, 12, true, false);
    ctx.fillStyle = CREAM;
    ctx.font = 'bold 15px Trebuchet MS';
    ctx.textAlign = 'center';
    ctx.fillText(boss.name, this.canvas.width / 2, 33);
    this.drawHealthBar(x, 43, width, 10, boss.hp / boss.maxHp);
  }

  drawDungeonHud(snapshot) {
    const ctx = this.context;
    ctx.fillStyle = 'rgb(34 30 37 / 80%)';
    this.roundRect(12, 12, 260, 58, 10, true, false);
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px Trebuchet MS';
    ctx.fillText(`第 ${snapshot.floorNumber} / 3 層　區域 ${snapshot.revealedGroup + 1} / ${snapshot.floor.maxRevealGroup + 1}`, 26, 35);
    ctx.font = '13px Trebuchet MS';
    const exitReady = snapshot.floorNumber === 3 ? '傳送魔法陣已啟動' : '下層樓梯已解鎖';
    const message = snapshot.floorCleared
      ? exitReady
      : snapshot.enemies.length > 0
        ? `目前區域敵人 ${snapshot.enemies.length}`
        : snapshot.revealedGroup < snapshot.floor.maxRevealGroup ? '前往房門探索下一區' : '傳送處尚未啟動';
    ctx.fillText(message, 26, 57);
  }

  roundRect(x, y, width, height, radius, fill, stroke) {
    const ctx = this.context;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) ctx.fill();
    if (stroke) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

export default GameRenderer;
